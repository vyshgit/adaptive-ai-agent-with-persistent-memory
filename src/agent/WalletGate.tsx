import { useEffect, useRef, useState } from 'react'
import { getWallets } from '@wallet-standard/app'
import { isWalletWithRequiredFeatureSet } from '@mysten/wallet-standard'
import type { WalletWithFeatures, StandardConnectFeature, StandardDisconnectFeature, StandardEventsFeature, SuiSignPersonalMessageFeature, WalletAccount } from '@mysten/wallet-standard'
import { Layers2, Wallet, ShieldCheck, Sun, Moon, KeyRound, Database, ExternalLink, LoaderCircle } from 'lucide-react'
import { agentJson, resetSessionSecrets, setSessionTag, setWorkspaceToken } from './api.ts'
import { redactBrowserText } from './clientSafety.ts'
import type { WalletSession } from './types.ts'
import { Button, IconButton, fieldClass } from './ui.tsx'
import AgentApp from './AgentApp.tsx'
import { clearInactiveWorkspaceCaches, createWorkspaceCache, workspaceCacheScope } from './workspaceCache.ts'
import type { WorkspaceCache } from './workspaceCache.ts'
import LegacyCacheCleanup from './LegacyCacheCleanup.tsx'
import { createDeviceVault } from './deviceVault.ts'
import type { DeviceVault } from './deviceVault.ts'

type SigningWallet = WalletWithFeatures<StandardConnectFeature & StandardEventsFeature & SuiSignPersonalMessageFeature & Partial<StandardDisconnectFeature>>
function availableWallets(): SigningWallet[] {
  return getWallets().get().filter((wallet): wallet is SigningWallet =>
    wallet.chains.some(chain => chain.startsWith('sui:')) && isWalletWithRequiredFeatureSet<SuiSignPersonalMessageFeature>(wallet, ['sui:signPersonalMessage']))
}
function sameAddress(a: string, b: string) { return a.toLowerCase().replace(/^0x0*/, '0x') === b.toLowerCase().replace(/^0x0*/, '0x') }
async function disconnectExtension(wallet?: SigningWallet) {
  try { await wallet?.features['standard:disconnect']?.disconnect() }
  catch { /* Optional extension permission removal cannot undo server logout. */ }
}

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
  const cache = useRef<WorkspaceCache | null>(null)
  const vault = useRef<DeviceVault | null>(null)
  const channel = useRef<BroadcastChannel | null>(null)
  const current = useRef(auth)
  current.current = auth

  function forgetWorkspace() {
    vault.current?.destroy(); vault.current = null
    const cleared = cache.current?.revoke() !== false
    cache.current = null; current.current = undefined
    setAuth(undefined); setSessionTag(null)
    if (clearInactiveWorkspaceCaches(null).failed || !cleared) setError('This session’s tab cache could not be cleared. Close the tab and clear site data before sharing this browser.')
  }
  function accept(next: WalletSession) {
    const valid = Boolean(next.sessionTag && next.agentId && (next.authenticated || next.demo))
    const scope = valid ? workspaceCacheScope(next.agentId!, next.sessionTag!) : null
    let cleared = true
    if (cache.current && cache.current.scope !== scope) { vault.current?.destroy(); vault.current = null; cleared = cache.current.revoke(); cache.current = null }
    const cleanup = clearInactiveWorkspaceCaches(scope)
    if (valid && !cache.current) cache.current = createWorkspaceCache(next.agentId!, next.sessionTag!)
    if (next.authenticated && cache.current && !vault.current) {
      const workspace = cache.current
      vault.current = createDeviceVault(next.agentId!, { isActive: () => workspace.active && Date.parse(next.expiresAt || '') > Date.now() })
    }
    current.current = next; setSessionTag(next.sessionTag); setAuth(next)
    if (!cleared || cleanup.failed) setError('This session’s tab cache could not be cleared. Close the tab and clear site data before sharing this browser.')
    return cleared && !cleanup.failed
  }
  function notifySessionChange() { try { channel.current?.postMessage('changed') } catch { /* closed/blocked channel */ } }
  async function refresh() {
    if (mutation.current) return
    const id = ++generation.current
    try {
      const result = await agentJson<WalletSession>('/auth/session')
      if (id === generation.current && accept(result)) setError('')
    } catch (error) { if (id === generation.current) { if (!current.current?.sessionTag) forgetWorkspace(); setError(error instanceof Error ? error.message : 'Session check failed.') } }
    finally { if (id === generation.current) setPending('') }
  }
  async function logout() {
    if (mutation.current) return
    const id = ++generation.current
    mutation.current = true
    vault.current?.lock()
    setPending('Ending wallet session…'); setError('')
    try {
      const result = await agentJson<WalletSession>('/auth/logout', { method: 'POST', body: '{}' })
      if (id === generation.current) {
        accept(result); notifySessionChange(); setConnected(undefined); setAccounts([]); setAccountAddress('')
        // The server session has already ended. Extension disconnect is optional
        // and cannot restore that session if the extension declines it.
        void disconnectExtension(connected)
      }
    } catch (error) { if (id === generation.current) setError(redactBrowserText(error instanceof Error ? error.message : 'Logout failed. Reconnect to the server and retry.')); throw error }
    finally { if (id === generation.current) { mutation.current = false; setPending('') } }
  }
  useEffect(() => {
    const registry = getWallets()
    const update = () => { setWallets(availableWallets()); setWalletIndex(0) }
    const off = [registry.on('register', update), registry.on('unregister', update)]
    const changed = () => { forgetWorkspace(); void refresh() }
    const focus = () => { void refresh() }
    const leaving = () => { vault.current?.lock() }
    const storageChanged = (event: StorageEvent) => { if (event.key === null || event.key === vault.current?.storageKey) vault.current?.sync() }
    window.addEventListener('recallloop-auth-changed', changed)
    window.addEventListener('focus', focus)
    window.addEventListener('pagehide', leaving)
    window.addEventListener('storage', storageChanged)
    try { channel.current = new BroadcastChannel('recallloop-auth'); channel.current.onmessage = event => { if (event.data === 'changed') changed() } } catch { /* API/focus/expiry checks remain the fallback */ }
    void refresh()
    return () => { generation.current++; vault.current?.destroy(); vault.current = null; off.forEach(remove => remove()); window.removeEventListener('recallloop-auth-changed', changed); window.removeEventListener('focus', focus); window.removeEventListener('pagehide', leaving); window.removeEventListener('storage', storageChanged); channel.current?.close(); channel.current = null }
  }, [])
  useEffect(() => {
    // Revocation blocks the previous workspace's pending autosave/unmount flushes.
    resetSessionSecrets()
  }, [auth?.sessionTag])
  useEffect(() => {
    if (!auth?.expiresAt) return
    const timeout = setTimeout(() => { forgetWorkspace(); void refresh() }, Math.max(0, Date.parse(auth.expiresAt) - Date.now()) + 100)
    return () => clearTimeout(timeout)
  }, [auth?.expiresAt])
  useEffect(() => {
    if (!connected || !auth?.authenticated || !accounts.some(account => auth.address && sameAddress(account.address, auth.address))) return
    let active = true
    const sessionTag = auth.sessionTag
    const remove = connected.features['standard:events'].on('change', event => {
      if (!active || current.current?.sessionTag !== sessionTag) return
      if (event.accounts && !event.accounts.some(account => current.current?.address && sameAddress(account.address, current.current.address))) {
        void logout().catch(() => {})
      }
    })
    return () => { active = false; remove() }
  }, [connected, auth?.sessionTag])

  async function connectWallet() {
    if (mutation.current) return
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
    } catch (error) { if (id === generation.current) setError(redactBrowserText(error instanceof Error ? error.message : 'Wallet connection was declined.')) }
    finally { if (id === generation.current) { mutation.current = false; setPending('') } }
  }
  async function signIn(wallet: SigningWallet, account: WalletAccount) {
    const id = ++generation.current
    mutation.current = true
    setPending('Requesting sign-in challenge…'); setError('')
    try {
      const challenge = await agentJson<{ challengeId: string; message: string; address: string }>('/auth/challenge', { method: 'POST', body: JSON.stringify({ address: account.address }) })
      if (id !== generation.current) return
      if (!challenge.message.includes(`Origin: ${window.location.origin}\n`) || !sameAddress(challenge.address, account.address)) throw new Error('The sign-in challenge did not match this app and wallet.')
      setPending('Sign the personal message in your wallet…')
      const signed = await wallet.features['sui:signPersonalMessage'].signPersonalMessage({ message: new TextEncoder().encode(challenge.message), account, chain: 'sui:mainnet' })
      if (id !== generation.current) return
      setPending('Verifying wallet ownership…')
      const result = await agentJson<WalletSession>('/auth/verify', { method: 'POST', body: JSON.stringify({ address: account.address, challengeId: challenge.challengeId, signature: signed.signature }) })
      if (id === generation.current) { accept(result); notifySessionChange() }
    } catch (error) { if (id === generation.current) setError(redactBrowserText(error instanceof Error ? error.message : 'Wallet sign-in was declined or failed.')) }
    finally { if (id === generation.current) { mutation.current = false; setPending('') } }
  }
  function disconnectSelection() {
    const wallet = connected
    setConnected(undefined); setAccounts([]); setAccountAddress(''); setError('')
    void disconnectExtension(wallet)
  }
  if (auth?.sessionTag && cache.current && (auth.authenticated || auth.demo)) return <AgentApp key={auth.sessionTag} identity={auth} cache={cache.current} vault={vault.current} dark={dark} onTheme={onTheme} onLogout={logout} />

  return <div className="flex min-h-dvh flex-col bg-primary text-primary">
    <header className="flex shrink-0 items-center justify-between gap-lg border-b border-secondary px-xl py-lg sm:px-3xl">
      <h1 className="flex items-center gap-md text-lg font-semibold"><Layers2 size={23} className="shrink-0 text-fg-secondary" aria-hidden="true" />RecallLoop</h1>
      <div className="flex items-center gap-lg"><span className="hidden text-xs text-tertiary sm:inline">Sui Mainnet</span><IconButton label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={onTheme}>{dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</IconButton></div>
    </header>
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-4xl px-xl py-4xl sm:p-4xl lg:flex-row lg:items-center lg:gap-6xl">
      <div className="workspace-enter min-w-0 flex-1">
        <p className="mb-lg text-sm font-medium text-utility-brand-700">Your workspace, with memory</p>
        <h2 className="text-heading-sm font-semibold sm:text-heading-md">Keep the context.<br />Move things forward.</h2>
        <p className="mt-xl max-w-lg text-md leading-relaxed text-secondary">Talk through an idea, plan a trip, or review a code change. Bring your own model and carry preferences and lessons into the next session with Walrus Memory.</p>
        <ol className="mt-3xl divide-y divide-secondary text-sm text-secondary">
          <li className="flex items-start gap-lg py-lg"><Wallet size={18} className="mt-xxs shrink-0 text-fg-tertiary" aria-hidden="true" /><div className="min-w-0"><span className="font-medium">Connect your wallet</span><p className="mt-xs text-xs text-tertiary">Sign a login message. No transaction or spending permission.</p></div></li>
          <li className="flex items-start gap-lg py-lg"><KeyRound size={18} className="mt-xxs shrink-0 text-fg-tertiary" aria-hidden="true" /><div className="min-w-0"><span className="font-medium">Choose your model</span><p className="mt-xs text-xs text-tertiary">Connect AgentRouter or another supported API in your isolated session.</p></div></li>
          <li className="flex items-start gap-lg py-lg"><Database size={18} className="mt-xxs shrink-0 text-fg-tertiary" aria-hidden="true" /><div className="min-w-0"><span className="font-medium">Add portable memory when you need it</span><p className="mt-xs text-xs text-tertiary">Tatum verifies your Walrus account owner; a dedicated delegate authorizes memory access.</p></div></li>
        </ol>
      </div>
      <section className="workspace-enter w-full min-w-0 rounded-xl border border-primary bg-secondary p-2xl shadow-xs lg:max-w-sm" aria-label="Wallet sign-in">
        <div className="mb-xl flex items-center gap-lg"><span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-secondary bg-primary"><Wallet size={20} className="shrink-0 text-fg-secondary" aria-hidden="true" /></span><div><h3 className="text-lg font-semibold">Open your workspace</h3><p className="mt-xxs text-xs text-tertiary">Sui Mainnet · one-hour session</p></div></div>
        <p className="mb-xl text-sm text-secondary">Connect, then sign a single-use personal message to verify ownership. This is authentication, not a transaction.</p>
        {wallets.length ? <div className="flex flex-col gap-lg">
          {wallets.length > 1 ? <div><label className="mb-sm block text-sm text-secondary" htmlFor="sign-in-wallet">Wallet</label><select id="sign-in-wallet" className={fieldClass} value={walletIndex} disabled={Boolean(pending)} onChange={event => { disconnectSelection(); setWalletIndex(Number(event.target.value)) }}>{wallets.map((wallet, index) => <option key={`${wallet.name}-${index}`} value={index}>{wallet.name}</option>)}</select></div>
            : <p className="truncate text-xs text-tertiary" title={wallets[0].name}>{wallets[0].name}</p>}
          {accounts.length > 1 && <div><label className="mb-sm block text-sm text-secondary" htmlFor="sign-in-account">Sui account</label><select id="sign-in-account" className={fieldClass} value={accountAddress} disabled={Boolean(pending)} onChange={event => setAccountAddress(event.target.value)}>{accounts.map(account => <option key={account.address} value={account.address}>{account.label || account.address}</option>)}</select></div>}
          {connected && accountAddress && <div className="border-y border-secondary py-lg text-xs"><p className="mb-xs text-tertiary">Selected address · Sui Mainnet</p><code className="break-all text-secondary">{accountAddress}</code></div>}
          <Button primary className="w-full" disabled={Boolean(pending)} onClick={() => { const account = accounts.find(account => account.address === accountAddress); if (connected && account) void signIn(connected, account); else void connectWallet() }}><Wallet size={16} className="shrink-0" aria-hidden="true" />{connected ? 'Sign in with this account' : 'Connect Wallet'}</Button>
          {connected && <Button quiet size="sm" disabled={Boolean(pending)} onClick={disconnectSelection}>Disconnect wallet</Button>}
        </div> : <div className="space-y-lg"><Button primary disabled className="w-full"><Wallet size={16} className="shrink-0" aria-hidden="true" />Connect Wallet</Button><p className="text-sm text-secondary">No compatible wallet found. Install or unlock a Sui Wallet Standard wallet and enable Mainnet, then return here.</p><a href="https://slush.app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-sm rounded-md text-sm text-secondary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-focus-ring">Get a Sui wallet<ExternalLink size={13} className="shrink-0 text-fg-tertiary" aria-hidden="true" /></a><p className="text-xs text-tertiary">zkLogin and multisig login are not supported in this release.</p></div>}
        <div className="mt-lg min-h-5 text-xs">{pending && <p role="status" className="flex items-center gap-sm text-secondary"><LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden="true" />{pending}</p>}{error && <p role="alert" className="break-words text-error-primary">{error}</p>}</div>
        <div className="mt-lg flex flex-wrap items-center gap-sm"><Button quiet size="sm" disabled={Boolean(pending)} onClick={() => { setPending('Checking wallet session…'); void refresh() }}>Retry session check</Button>
          {auth?.demoAvailable && <Button disabled={Boolean(pending)} onClick={async () => {
            const id = ++generation.current
            mutation.current = true
            setPending('Opening offline demo…'); setError('')
            try { const result = await agentJson<WalletSession>('/auth/demo', { method: 'POST', body: '{}' }); if (id === generation.current) { accept(result); notifySessionChange() } }
            catch (error) { if (id === generation.current) setError(redactBrowserText(error instanceof Error ? error.message : 'Demo unavailable.')) } finally { if (id === generation.current) { mutation.current = false; setPending('') } }
          }} quiet size="sm">Try offline demo</Button>}</div>
        <p className="mt-xl flex items-start gap-sm border-t border-secondary pt-xl text-xs text-tertiary"><ShieldCheck size={15} className="shrink-0" aria-hidden="true" />No funds are spent during login. Never enter a seed phrase or wallet private key. You approve every code edit separately.</p>
      </section>
    </main>
    <footer className="mx-auto w-full max-w-5xl border-t border-secondary px-xl py-xl sm:px-4xl">
      <details className="mb-lg"><summary className="cursor-pointer rounded-md text-xs text-tertiary focus-visible:ring-2 focus-visible:ring-focus-ring">Operator access token (only if configured)</summary><form className="mt-md flex flex-wrap items-center gap-sm" onSubmit={event => { event.preventDefault(); setWorkspaceToken(token); setToken(''); void refresh() }}><label htmlFor="gate-token" className="sr-only">Optional workspace bearer token</label><input id="gate-token" type="password" autoComplete="off" maxLength={4096} disabled={Boolean(pending)} className={`${fieldClass} min-w-0 flex-1`} value={token} onChange={event => setToken(event.target.value)} /><Button type="submit" disabled={Boolean(pending) || !token}>Unlock</Button></form></details>
      <LegacyCacheCleanup />
      <p className="text-xs leading-relaxed text-tertiary">Use localhost or HTTPS on a server you trust. Wallet login does not encrypt browser caches or grant Walrus access. Memory adaptation is not model retraining. <a className="rounded-md text-secondary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-focus-ring" href="#/console">Legacy operator console</a></p>
    </footer>
  </div>
}
