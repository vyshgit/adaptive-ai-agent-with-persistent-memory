import { useId, useRef, useState, useEffect } from 'react'
import { LockKeyhole, LoaderCircle } from 'lucide-react'
import type { DeviceVault } from './deviceVault.ts'
import { useDeviceVault } from './useDeviceVault.ts'
import { Badge, Button, Checkbox, fieldClass } from './ui.tsx'

export default function DeviceVaultPanel({ vault, busy, onReconnect }: { vault: DeviceVault | null; busy: boolean; onReconnect: (profileId?: string) => void }) {
  const state = useDeviceVault(vault)
  const id = useId()
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [consent, setConsent] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean }>()
  const mounted = useRef(true)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    mounted.current = true
    const off = vault?.subscribe(() => {
      const state = vault.getSnapshot()
      if (!state.unlocked) {
        if (!state.busy) controller.current?.abort()
        setPassphrase(''); setConfirmation(''); setConsent(false)
      }
    })
    return () => {
      mounted.current = false; off?.()
      if (controller.current) { controller.current.abort(); controller.current = null; vault?.lock() }
    }
  }, [vault])
  const disabled = busy || state.busy || !vault || !state.available
  async function unlock() {
    if (disabled || !vault || (!state.exists && (!consent || passphrase !== confirmation))) return
    const value = passphrase, exists = state.exists
    const abort = new AbortController()
    controller.current = abort
    setPassphrase(''); setConfirmation(''); setConsent(false); setFeedback(undefined)
    try {
      if (exists) await vault.unlock(value, abort.signal)
      else await vault.create(value, abort.signal)
      if (mounted.current && controller.current === abort && !abort.signal.aborted && vault.getSnapshot().unlocked) setFeedback({ message: exists
        ? 'Vault unlocked locally. Reconnect only when you are ready to run the normal API verification checks.'
        : 'Vault created. New verified connections are saved by default while unlocked; you can uncheck saving per connection. Existing session keys cannot be recovered from the server.' })
    } catch (error) { if (mounted.current && controller.current === abort && !abort.signal.aborted) setFeedback({ message: error instanceof Error ? error.message : 'The device vault could not be unlocked.', error: true }) }
    finally { if (controller.current === abort) controller.current = null }
  }
  function forget() {
    if (!vault || busy) return
    setPassphrase(''); setConfirmation(''); setConsent(false); setConfirmForget(false)
    try { vault.forget(); setFeedback({ message: 'This wallet’s saved connections were forgotten on this device. Current server connections and other wallets are unchanged.' }) }
    catch (error) { setFeedback({ message: error instanceof Error ? error.message : 'The saved vault could not be removed.', error: true }) }
  }
  async function forgetProfile(profileId: string) {
    if (!vault || disabled) return
    const abort = new AbortController()
    controller.current = abort; setFeedback(undefined)
    try { await vault.forgetModel(profileId, abort.signal); if (mounted.current) setFeedback({ message: 'Saved provider profile removed. Its current API session remains connected.' }) }
    catch (error) { if (mounted.current && !abort.signal.aborted) setFeedback({ error: true, message: error instanceof Error ? error.message : 'The saved profile could not be removed.' }) }
    finally { if (controller.current === abort) controller.current = null }
  }
  return <section className="space-y-lg border-t border-secondary pt-xl" aria-label="Encrypted device vault">
    <div className="flex flex-wrap items-center justify-between gap-md"><h3 className="flex items-center gap-sm text-sm font-semibold"><LockKeyhole size={17} className="shrink-0 text-fg-tertiary" aria-hidden="true" />Remember connections on this device</h3><Badge>{state.unlocked ? 'Unlocked · this wallet session' : state.exists ? 'Encrypted · locked' : 'Off by default'}</Badge></div>
    <p className="text-sm text-tertiary">Optional, wallet-specific encrypted storage in this browser profile—not MemWal, chats, or plaintext caches. Use a long, unique passphrase; it is never sent to the server and cannot be recovered. Anyone controlling an unlocked tab or browser can still access its keys.</p>
    <p className="text-xs text-tertiary">Switching browser tabs or closing Settings keeps existing wallet/API connections and this page’s unlock active. Lock, logout, session expiry or leaving this page clears the unlock. Only ciphertext persists; another page needs its own passphrase unlock to read saved keys.</p>
    {!vault ? <p className="text-xs text-secondary">Sign in with a wallet to use an encrypted device vault. It is unavailable in the offline demo.</p>
      : !state.available ? <p role="alert" className="text-sm text-error-primary">Encrypted device storage is unavailable. Use a supported browser on localhost or HTTPS with site storage enabled. Session-only connections still work.</p>
        : !state.unlocked && <form className="space-y-lg" onSubmit={event => { event.preventDefault(); void unlock() }}>
          <div><label htmlFor={`${id}-passphrase`} className="mb-sm block text-sm font-medium text-secondary">Device vault passphrase</label><input id={`${id}-passphrase`} type="password" autoComplete="off" data-lpignore="true" minLength={12} maxLength={256} required disabled={disabled} className={fieldClass} value={passphrase} onChange={event => setPassphrase(event.target.value)} aria-describedby={`${id}-hint`} /><p id={`${id}-hint`} className="mt-sm text-xs text-tertiary">At least 12 characters. This is a separate passphrase, not your wallet key or login signature.</p></div>
          {!state.exists && <>
            <div><label htmlFor={`${id}-confirm`} className="mb-sm block text-sm font-medium text-secondary">Confirm vault passphrase</label><input id={`${id}-confirm`} type="password" autoComplete="off" data-lpignore="true" minLength={12} maxLength={256} required disabled={disabled} className={fieldClass} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></div>
            <Checkbox checked={consent} onChange={setConsent} disabled={disabled}>I want encrypted credentials saved on this device</Checkbox>
          </>}
          <Button primary type="submit" disabled={disabled || passphrase.length < 12 || (!state.exists && (!consent || passphrase !== confirmation))}>{state.exists ? 'Unlock device vault' : 'Create encrypted vault'}</Button>
        </form>}
    {state.unlocked && <>
      <p className="text-sm text-secondary">Saved connections: {state.saved.length ? state.saved.map(name => ({ model: 'Model', tatum: 'Tatum', walrus: 'Walrus' })[name]).join(', ') : 'None yet. Verified connections save here by default while unlocked.'}</p>
      {state.profiles.length > 0 && <ul className="divide-y divide-secondary border-y border-secondary" aria-label="Saved provider profiles">{state.profiles.map(profile => <li key={profile.id} className="flex flex-wrap items-center justify-between gap-sm py-md"><span className="min-w-0 break-words text-sm text-secondary">{profile.name}</span><div className="flex items-center gap-sm"><Button quiet size="sm" disabled={disabled} aria-label={`Reconnect saved ${profile.name}`} onClick={() => onReconnect(profile.id)}>Reconnect</Button><Button quiet size="sm" disabled={disabled} aria-label={`Forget saved ${profile.name}`} onClick={() => { void forgetProfile(profile.id) }}>Forget</Button></div></li>)}</ul>}
      <p className="text-xs text-tertiary">Reconnect runs the same model-generation, Tatum, and Walrus ownership/delegate checks as manual setup. It can consume provider/delegate quota and replace current connections after verification. It does not write memories; streaming/tool capability probes are not repeated.</p>
      <div className="flex flex-wrap items-center gap-sm"><Button primary disabled={disabled || !state.saved.length} onClick={() => onReconnect()}>Reconnect saved connections</Button><Button disabled={disabled} onClick={() => { vault?.lock(); setFeedback(undefined) }}>Lock device vault</Button></div>
    </>}
    {state.exists && !confirmForget && <Button quiet size="sm" disabled={busy} onClick={() => { vault?.lock(); setConfirmForget(true); setFeedback(undefined) }}>Forget saved connections</Button>}
    {confirmForget && <div className="space-y-md border-t border-secondary pt-lg"><p className="text-sm text-secondary">Delete only this wallet’s encrypted saved connections from this browser? This cannot be undone. Current server connections and remote memories remain; no onchain delegate is revoked.</p><div className="flex flex-wrap items-center gap-sm"><Button disabled={busy} onClick={forget}>Confirm forget saved connections</Button><Button disabled={busy} onClick={() => setConfirmForget(false)}>Cancel forget</Button></div></div>}
    {state.busy && <p role="status" className="flex items-center gap-sm text-sm text-secondary"><LoaderCircle size={15} className="shrink-0 animate-spin" aria-hidden="true" />Encrypting or unlocking on this device…</p>}
    {(feedback || state.error) && <p role={feedback?.error || state.error ? 'alert' : 'status'} className={`text-sm ${feedback?.error || state.error ? 'text-error-primary' : 'text-secondary'}`}>{state.error || feedback?.message}</p>}
  </section>
}
