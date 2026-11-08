import { useEffect, useRef, useState } from 'react'
import { getWallets } from '@wallet-standard/app'
import { isWalletWithRequiredFeatureSet } from '@mysten/wallet-standard'
import type { WalletWithFeatures, StandardConnectFeature, StandardEventsFeature, SuiSignPersonalMessageFeature, WalletAccount } from '@mysten/wallet-standard'
import { Brain, Wallet, ShieldCheck, Sun, Moon, KeyRound } from 'lucide-react'
import { agentJson, resetSessionSecrets, setSessionTag, setWorkspaceToken } from './api.ts'
import { redactBrowserText } from './clientSafety.ts'
import type { WalletSession } from './types.ts'
import { Button, IconButton, Badge, fieldClass } from './ui.tsx'
import AgentApp from './AgentApp.tsx'

type SigningWallet = WalletWithFeatures<StandardConnectFeature & StandardEventsFeature & SuiSignPersonalMessageFeature>
function availableWallets(): SigningWallet[] {
  return getWallets().get().filter((wallet): wallet is SigningWallet =>
    wallet.chains.some(chain => chain.startsWith('sui:')) && isWalletWithRequiredFeatureSet<SuiSignPersonalMessageFeature>(wallet, ['sui:signPersonalMessage']))
}
function sameAddress(a: string, b: string) { return a.toLowerCase().replace(/^0x0*/, '0x') === b.toLowerCase().replace(/^0x0*/, '0x') }

export default function WalletGate({ dark, onTheme }: { dark: boolean; onTheme: () => void }) {
  const [auth, setAuth] = useState<WalletSession>()
  const [wallets, setWallets] = useState<SigningWallet[]>(availableWallets)
  const [walletIndex, setWalletIndex] = useState(0)
  const [accounts, setAccounts] = useState<readonly WalletAccount[]>([])
  const [accountAddress, setAccountAddress] = useState('')
  const [connected, setConnected] = useState<SigningWallet>()
  const [pending, setPending] = useState('Checking wallet session…')
  const [error, setError] = useState('')
  const [token, setToken] = useState('')
  const generation = useRef(0)
  const mutation = useRef(false)
  const current = useRef(auth)
  current.current = auth

  function accept(next: WalletSession) { setSessionTag(next.sessionTag); setAuth(next) }
  async function refresh() {
    if (mutation.current) return
    const id = ++generation.current
    try {
      const result = await agentJson<WalletSession>('/auth/session')
      if (id === generation.current) { accept(result); setError('') }
    } catch (error) { if (id === generation.current) { setAuth(undefined); setSessionTag(null); setError(error instanceof Error ? error.message : 'Session check failed.') } }
    finally { if (id === generation.current) setPending('') }
  }
  async function logout() {
    const id = ++generation.current
    mutation.current = true
    setPending('Ending wallet session…'); setError('')
    try {
      const result = await agentJson<WalletSession>('/auth/logout', { method: 'POST', body: '{}' })
      if (id === generation.current) { accept(result); setConnected(undefined); setAccounts([]); setAccountAddress('') }
    } catch (error) { setError(error instanceof Error ? error.message : 'Logout failed. Reconnect to the server and retry.'); throw error }
    finally { mutation.current = false; setPending('') }
  }
  useEffect(() => {
    const registry = getWallets()
    const update = () => { setWallets(availableWallets()); setWalletIndex(0) }
    const off = [registry.on('register', update), registry.on('unregister', update)]
    const changed = () => { setAuth(undefined); setSessionTag(null); void refresh() }
    const focus = () => { void refresh() }
    window.addEventListener('recallloop-auth-changed', changed)
    window.addEventListener('focus', focus)
    void refresh()
    return () => { generation.current++; off.forEach(remove => remove()); window.removeEventListener('recallloop-auth-changed', changed); window.removeEventListener('focus', focus) }
  }, [])
  useEffect(() => {
    // Previous workspace cleanup has flushed its already-redacted caches before this runs.
    resetSessionSecrets()
  }, [auth?.sessionTag])
  useEffect(() => {
    if (!auth?.expiresAt) return
    const timeout = setTimeout(() => { setAuth(undefined); setSessionTag(null); void refresh() }, Math.max(0, Date.parse(auth.expiresAt) - Date.now()) + 100)
    return () => clearTimeout(timeout)
  }, [auth?.expiresAt])
  useEffect(() => {
    if (!connected || !auth?.authenticated || !accounts.some(account => auth.address && sameAddress(account.address, auth.address))) return
    return connected.features['standard:events'].on('change', event => {
      if (event.accounts && !event.accounts.some(account => current.current?.address && sameAddress(account.address, current.current.address))) {
        void logout().catch(() => {})
      }
    })
  }, [connected, auth?.sessionTag])

  async function connectWallet() {
    const wallet = wallets[walletIndex]
    if (!wallet) return
    const id = ++generation.current
    mutation.current = true
    setPending('Connecting wallet…'); setError('')
    try {
      const result = await wallet.features['standard:connect'].connect()
      if (id !== generation.current) return
      const suiAccounts = result.accounts.filter(account => account.chains.includes('sui:mainnet') && account.features.includes('sui:signPersonalMessage'))
      if (!suiAccounts.length) throw new Error('Select a Sui Mainnet account with personal-message signing in your wallet.')
      setConnected(wallet); setAccounts(suiAccounts); setAccountAddress(suiAccounts[0].address)
      if (suiAccounts.length === 1) await signIn(wallet, suiAccounts[0])
    } catch (error) { setError(redactBrowserText(error instanceof Error ? error.message : 'Wallet connection was declined.')) }
    finally { mutation.current = false; setPending('') }
  }
  async function signIn(wallet: SigningWallet, account: WalletAccount) {
    const id = ++generation.current
    mutation.current = true
    setPending('Requesting sign-in challenge…'); setError('')
    try {
      const challenge = await agentJson<{ challengeId: string; message: string; address: string }>('/auth/challenge', { method: 'POST', body: JSON.stringify({ address: account.address }) })
      if (!challenge.message.includes(`Origin: ${window.location.origin}\n`) || !sameAddress(challenge.address, account.address)) throw new Error('The sign-in challenge did not match this app and wallet.')
      setPending('Sign the personal message in your wallet…')
      const signed = await wallet.features['sui:signPersonalMessage'].signPersonalMessage({ message: new TextEncoder().encode(challenge.message), account, chain: 'sui:mainnet' })
      if (id !== generation.current) return
      setPending('Verifying wallet ownership…')
      const result = await agentJson<WalletSession>('/auth/verify', { method: 'POST', body: JSON.stringify({ address: account.address, challengeId: challenge.challengeId, signature: signed.signature }) })
      if (id === generation.current) accept(result)
    } catch (error) { setError(redactBrowserText(error instanceof Error ? error.message : 'Wallet sign-in was declined or failed.')) }
    finally { mutation.current = false; setPending('') }
  }
  if (auth?.sessionTag && (auth.authenticated || auth.demo)) return <AgentApp key={auth.sessionTag} identity={auth} dark={dark} onTheme={onTheme} onLogout={logout} />

  return <div className="flex min-h-dvh flex-col bg-primary text-primary">
    <header className="flex items-center justify-between gap-lg border-b border-secondary px-xl py-lg">
      <h1 className="flex items-center gap-md text-lg font-semibold"><Brain size={23} className="shrink-0 text-fg-brand-primary" />RecallLoop</h1>
      <IconButton label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={onTheme}>{dark ? <Sun size={18} /> : <Moon size={18} />}</IconButton>
    </header>
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-xl p-xl md:p-4xl">
      <div><Badge tone="brand">Talk · Plan · Build</Badge><h2 className="mt-lg text-heading-sm font-semibold">Your workspace. Your wallet. Portable memory.</h2>
        <p className="mt-md text-sm text-secondary">Sign in with your Sui wallet, connect your own APIs, and work with an agent that recalls your preferences, corrections, and lessons in later sessions.</p></div>
      <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs" aria-label="Wallet sign-in">
        <h3 className="mb-md flex items-center gap-sm text-lg font-semibold"><Wallet size={20} className="shrink-0 text-fg-tertiary" />Sign in with Sui</h3>
        <p className="mb-lg text-xs text-tertiary">Connecting an address is not a login. RecallLoop verifies an expiring, single-use personal-message signature. No funds are spent and no transaction is requested.</p>
        {wallets.length ? <div className="flex flex-col gap-lg">
          <div><label className="mb-sm block text-sm text-secondary" htmlFor="sign-in-wallet">Wallet</label><select id="sign-in-wallet" className={fieldClass} value={walletIndex} disabled={Boolean(pending)} onChange={event => { setWalletIndex(Number(event.target.value)); setConnected(undefined); setAccounts([]) }}>{wallets.map((wallet, index) => <option key={`${wallet.name}-${index}`} value={index}>{wallet.name}</option>)}</select></div>
          {accounts.length > 1 && <div><label className="mb-sm block text-sm text-secondary" htmlFor="sign-in-account">Sui account</label><select id="sign-in-account" className={fieldClass} value={accountAddress} disabled={Boolean(pending)} onChange={event => setAccountAddress(event.target.value)}>{accounts.map(account => <option key={account.address} value={account.address}>{account.label || account.address}</option>)}</select></div>}
          <Button primary disabled={Boolean(pending)} onClick={() => { const account = accounts.find(account => account.address === accountAddress); if (connected && account) void signIn(connected, account); else void connectWallet() }}>{pending || (connected ? 'Sign in with this account' : 'Connect & sign in')}</Button>
        </div> : <p className="text-sm text-secondary">No compatible wallet found. Install or unlock a Sui Wallet Standard wallet (such as Slush), enable Mainnet, then return to this page. zkLogin and multisig login are not supported in this release.</p>}
        {pending && <p role="status" className="mt-md text-xs text-secondary">{pending}</p>}
        {error && <p role="alert" className="mt-md text-sm text-error-primary">{error}</p>}
        <div className="mt-lg flex flex-wrap gap-sm"><Button disabled={Boolean(pending)} onClick={() => { setPending('Checking wallet session…'); void refresh() }}>Retry session check</Button>
          {auth?.demoAvailable && <Button disabled={Boolean(pending)} onClick={async () => {
            const id = ++generation.current
            mutation.current = true
            setPending('Opening offline demo…'); setError('')
            try { const result = await agentJson<WalletSession>('/auth/demo', { method: 'POST', body: '{}' }); if (id === generation.current) accept(result) }
            catch (error) { setError(error instanceof Error ? error.message : 'Demo unavailable.') } finally { mutation.current = false; setPending('') }
          }}>Try offline demo</Button>}</div>
      </section>
      <ol className="divide-y divide-secondary text-sm text-secondary">
        <li className="flex items-start gap-md py-lg"><KeyRound size={18} className="shrink-0 text-fg-tertiary" /><div>Connect Tatum, a Walrus Memory delegate key, and AgentRouter.<p className="mt-xs text-xs text-tertiary">Each signed-in session has its own temporary server credentials. Never enter your wallet private key.</p></div></li>
        <li className="flex items-start gap-md py-lg"><ShieldCheck size={18} className="shrink-0 text-fg-tertiary" /><div>Review changes and see which memories were recalled.<p className="mt-xs text-xs text-tertiary">With live capture, confirmed memories are stored through the official Walrus Mainnet relayer. Offline demo memory is ephemeral. Adaptation is not model retraining.</p></div></li>
      </ol>
      <details className="border-t border-secondary pt-lg"><summary className="cursor-pointer rounded-md text-xs text-tertiary focus-visible:ring-2 focus-visible:ring-focus-ring">Operator access token (only if configured)</summary>
        <form className="mt-md flex items-center gap-sm" onSubmit={event => { event.preventDefault(); setWorkspaceToken(token); setToken(''); void refresh() }}><label htmlFor="gate-token" className="sr-only">Optional workspace bearer token</label><input id="gate-token" type="password" autoComplete="off" className={fieldClass} value={token} onChange={event => setToken(event.target.value)} /><Button type="submit">Unlock</Button></form>
      </details>
      <p className="text-xs text-tertiary">Use localhost or HTTPS on a server you trust. Wallet login does not encrypt browser caches or authorize a delegate key. <a className="rounded-md text-brand-primary underline focus-visible:ring-2 focus-visible:ring-focus-ring" href="#/console">Legacy operator console</a></p>
    </main>
  </div>
}
