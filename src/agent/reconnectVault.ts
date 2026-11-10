import type { DeviceVault, VaultConnectionMap, VaultConnectionName } from './deviceVault.ts'
import { redactBrowserText, registerBrowserSecret } from './clientSafety.ts'

const labels = { model: 'Model', tatum: 'Tatum', walrus: 'Walrus' }
export interface ReconnectionResult { connection: VaultConnectionName; profileId?: string; status: 'verified' | 'failed' | 'skipped'; message: string }

// This is called only by the explicit Reconnect button. Never on login/unlock.
// Reuse normal verification routes: stored ciphertext is NOT authorization.
export async function reconnectVault({ vault, signal, send, onStep = () => {}, tatumConnected = false, profileId }:
  { vault: DeviceVault; signal: AbortSignal; send: (path: string, body: object, signal: AbortSignal) => Promise<unknown>;
    onStep?: (message: string) => void; tatumConnected?: boolean; profileId?: string }) {
  const saved = vault.readConnections()
  const unlocked = vault.getSnapshot()
  const results: ReconnectionResult[] = []
  function check() {
    signal.throwIfAborted()
    if (!vault.active || !vault.getSnapshot().unlocked || vault.getSnapshot() !== unlocked) throw new Error('Saved reconnection stopped because this wallet workspace or vault was locked or changed.')
  }
  for (const key of [...(saved.models || []).map(profile => profile.apiKey), saved.tatum?.apiKey, saved.walrus?.delegateKey]) if (key) registerBrowserSecret(key)
  try {
    const jobs: { name: VaultConnectionName; connection: VaultConnectionMap[VaultConnectionName]; profileId: string; label: string }[] = (saved.models || []).filter(profile => !profileId || profile.profileId === profileId).map(profile => ({ name: 'model', connection: profile, profileId: profile.profileId, label: profile.profileName }))
    if (profileId && !jobs.length) throw new Error('That provider profile is no longer saved in this wallet’s vault.')
    if (!profileId) for (const name of ['tatum', 'walrus'] as const) if (saved[name]) jobs.push({ name, connection: saved[name], profileId: '', label: labels[name] })
    for (const job of jobs) {
      check()
      const { name, connection, label } = job
      const identity = { connection: name, ...(job.profileId ? { profileId: job.profileId } : {}) }
      if (name === 'walrus' && !tatumConnected) {
        results.push({ ...identity, status: 'skipped', message: 'Walrus: skipped. Connect and verify Tatum before reconnecting this saved delegate.' })
        continue
      }
      onStep(`Reconnecting ${label} with your saved credential…`)
      const path = name === 'model' ? '/connect' : `/connections/${name === 'walrus' ? 'memwal' : 'tatum'}`
      const body = name === 'model' ? { mode: 'live', ...connection, checkCapabilities: false } : connection
      try {
        check()
        await send(path, body, signal)
        check()
        if (name === 'tatum') tatumConnected = true
        results.push({ ...identity, status: 'verified', message: `${label}: verified in this wallet session.` })
      } catch (error) {
        check()
        if (['wallet_required', 'session_changed'].includes((error as { code?: string })?.code || '')) throw error
        if (name === 'tatum') tatumConnected = false
        results.push({ ...identity, status: 'failed', message: `${label}: ${redactBrowserText(error instanceof Error ? error.message : 'Verification failed.')}` })
      } finally {
        if ('apiKey' in body) body.apiKey = ''
        if ('delegateKey' in body) body.delegateKey = ''
      }
    }
    return results
  } finally {
    // Do not retain a second plaintext snapshot beyond the explicit operation.
    for (const profile of saved.models || []) profile.apiKey = ''
    if (saved.tatum) saved.tatum.apiKey = ''
    if (saved.walrus) saved.walrus.delegateKey = ''
    delete saved.models; delete saved.tatum; delete saved.walrus
  }
}
