import { useEffect, useRef, useState } from 'react'
import { Layers2, Settings, Sun, Moon, X, ShieldCheck, LogOut, Wallet, LoaderCircle } from 'lucide-react'
import type { WorkspaceStatus, MemoryOverview, WalletSession, Connection } from './types.ts'
import type { ChainStatus } from './MemoryRail.tsx'
import { agentJson } from './api.ts'
import { redactBrowserText } from './clientSafety.ts'
import { Button, IconButton, Modal, CopyButton } from './ui.tsx'
import SettingsModal, { type SettingsSection } from './SettingsModal.tsx'
import type { WorkspaceCache } from './workspaceCache.ts'
import type { DeviceVault } from './deviceVault.ts'
import { useDeviceVault } from './useDeviceVault.ts'
import BuilderWorkspace from './BuilderWorkspace.tsx'
import ConversationWorkspace from './ConversationWorkspace.tsx'
import { useWorkspacePreferences } from './useWorkspacePreferences.ts'

export default function AgentApp({ dark, onTheme, identity, cache, vault, onLogout }: { dark: boolean; onTheme: () => void; identity: WalletSession; cache: WorkspaceCache; vault: DeviceVault | null; onLogout: () => Promise<void> }) {
  const vaultState = useDeviceVault(vault)
  const preferences = useWorkspacePreferences(cache)
  const [status, setStatus] = useState<WorkspaceStatus>()
  const [overview, setOverview] = useState<MemoryOverview>()
  const [chain, setChain] = useState<ChainStatus>()
  const [loading, setLoading] = useState(true)
  const [memoryLoading, setMemoryLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [settings, setSettings] = useState<SettingsSection | null>(null)
  const [walletDetails, setWalletDetails] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState('')
  const [busy, setBusy] = useState(false)
  const [localModels, setLocalModels] = useState({ busy: false, message: '' })
  const localDiscovery = useRef<AbortController | null>(null)
  const localChecked = useRef(false)
  const stopTask = useRef<(() => void) | null>(null)
  const refreshId = useRef(0)
  const memoryId = useRef(0)
  const chainId = useRef(0)
  const activeWorkspace = useRef(true)
  const builderEnabled = status?.coding?.localBuilder === true

  async function refreshMemory() {
    if (!activeWorkspace.current) return
    const id = ++memoryId.current
    setMemoryLoading(true)
    try { const result = await agentJson<MemoryOverview>('/memory'); if (id === memoryId.current) setOverview(result) }
    catch (error) { if (id === memoryId.current) setNotice(error instanceof Error ? error.message : 'Memory inventory could not be loaded.') }
    finally { if (id === memoryId.current) setMemoryLoading(false) }
  }
  async function refreshChain() {
    if (!activeWorkspace.current) return
    const id = ++chainId.current
    try { const result = await agentJson<ChainStatus>('/chain'); if (id === chainId.current) setChain(result) }
    catch { if (id === chainId.current) setChain({ configured: false, checkpoint: null, account: null }) }
  }
  async function refresh(related = true) {
    if (!activeWorkspace.current) return false
    const id = ++refreshId.current
    setLoading(true); setError('')
    try {
      const result = await agentJson<WorkspaceStatus>('/status')
      if (id !== refreshId.current) return false
      setStatus(result)
      if (related) { void refreshMemory(); void refreshChain() }
      return true
    } catch (error) {
      // A temporary connection/status failure must not dispose a local editor
      // and its page-only drafts. Keep the last shell, but disable new tasks.
      if (id === refreshId.current) setError(error instanceof Error ? error.message : 'Workspace status could not be loaded.')
      return false
    } finally { if (id === refreshId.current) setLoading(false) }
  }
  useEffect(() => {
    activeWorkspace.current = true; void refresh()
    const focus = () => { void refresh(false) }
    window.addEventListener('focus', focus)
    return () => { activeWorkspace.current = false; localDiscovery.current?.abort(); refreshId.current++; memoryId.current++; chainId.current++; window.removeEventListener('focus', focus) }
  }, [])
  async function discoverLocalModels() {
    if (!builderEnabled || identity.demo || busy || localDiscovery.current) return
    const controller = new AbortController()
    localDiscovery.current = controller; setLocalModels({ busy: true, message: 'Checking installed Ollama models…' })
    try {
      const result = await agentJson<{ available: boolean; connection: Connection | null }>('/models/local', { method: 'POST', body: '{}', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
      if (!activeWorkspace.current || controller.signal.aborted) return
      setLocalModels({ busy: false, message: result.available ? `${result.connection?.models.length || 0} installed local models available without an API key.` : 'No installed local Ollama models found. Start Ollama, pull a model, then refresh.' })
      await refresh(false)
    } catch (error) {
      if (activeWorkspace.current && !controller.signal.aborted) setLocalModels({ busy: false, message: redactBrowserText(error instanceof Error ? error.message : 'Local model discovery is unavailable. Try refreshing.') })
    } finally { if (localDiscovery.current === controller) localDiscovery.current = null }
  }
  useEffect(() => {
    if (builderEnabled && !identity.demo && !localChecked.current) { localChecked.current = true; void discoverLocalModels() }
  }, [builderEnabled, identity.demo])
  async function disconnect() {
    if (disconnecting) return
    stopTask.current?.(); setDisconnecting(true); setDisconnectError('')
    try { await onLogout() }
    catch (error) {
      if (!activeWorkspace.current) return
      const message = redactBrowserText(error instanceof Error ? error.message : 'Disconnect failed. Reconnect to the server and try again.')
      setDisconnectError(message); setNotice(message)
    }
    finally { if (activeWorkspace.current) setDisconnecting(false) }
  }

  const headerActions = <>
        <Button quiet size="sm" aria-label={identity.demo ? 'Demo session details' : 'Wallet session details'} title={identity.address || 'Isolated offline demo'} onClick={() => { setDisconnectError(''); setWalletDetails(true) }}><Wallet size={15} className="shrink-0" aria-hidden="true" />{!builderEnabled && <span className="hidden font-mono text-xs sm:inline">{identity.address ? `${identity.address.slice(0, 6)}…${identity.address.slice(-4)}` : 'Demo'}</span>}</Button>
        <IconButton label="Workspace settings" onClick={() => setSettings('model')}><Settings size={18} aria-hidden="true" /></IconButton>
        <IconButton label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={onTheme}>{dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</IconButton>
  </>
  const headerNotices = <>
    {vaultState.exists && !vaultState.unlocked && status?.llm.mode === 'unconfigured' && <section className="flex shrink-0 flex-wrap items-center justify-between gap-sm border-b border-secondary bg-secondary px-xl py-md text-xs text-secondary" aria-label="Saved connection vault"><span>Encrypted connections are saved for this wallet on this device.</span><Button quiet size="sm" onClick={() => setSettings('advanced')}>Unlock saved connections</Button></section>}
    {(error || notice) && <div className="flex shrink-0 items-start justify-between gap-md border-b border-secondary bg-secondary px-lg py-md">
      <div role={error ? 'alert' : 'status'} className="min-w-0 text-xs">
        {error ? <span className="text-error-primary">{error} <button className="ml-sm rounded-md underline focus-visible:ring-2 focus-visible:ring-focus-ring" onClick={() => setSettings('model')}>Open settings</button><button className="ml-sm rounded-md underline focus-visible:ring-2 focus-visible:ring-focus-ring" onClick={() => { void refresh() }}>Retry status</button></span>
          : notice}
      </div>
      {!error && notice && <IconButton label="Dismiss notice" onClick={() => setNotice('')}><X size={13} /></IconButton>}
    </div>}
  </>

  return <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-primary text-primary">
    {status ? builderEnabled
      ? <main className="flex min-h-0 flex-1"><BuilderWorkspace connection={status.llm} connections={status.modelConnections} connectionBlocked={loading || localModels.busy || Boolean(error)} memoryStatus={overview?.status || status.memory} memoryBinding={`${status.memory.mode}:${status.memoryConnection?.accountId || ''}:${status.memoryConnection?.publicKey || ''}:${status.memoryConnection?.verifiedAt || ''}`} handoffAccountId={!identity.demo && status.memoryConnection?.verified ? status.memoryConnection.accountId : null} preferences={preferences.values} onPreferences={preferences.update} onBusy={setBusy} onStored={() => { void refreshMemory() }} onModelSettings={() => setSettings('model')} onMemorySettings={() => setSettings('walrus')} headerActions={headerActions} headerNotices={headerNotices} demo={identity.demo} /></main>
      : <ConversationWorkspace status={status} overview={overview} chain={chain} loading={loading || Boolean(error)} memoryLoading={memoryLoading} cache={cache} preferences={preferences.values} onPreferences={preferences.update} headerActions={headerActions} headerNotices={headerNotices} demo={identity.demo} onMemoryRefresh={refreshMemory} onChainRefresh={refreshChain} onSettings={setSettings} onNotice={setNotice} onBusy={setBusy} stopTask={stopTask} />
      : <><header className="flex shrink-0 flex-wrap items-center justify-between gap-sm border-b border-secondary px-xl py-md"><h1 className="flex items-center gap-sm text-sm font-semibold"><Layers2 size={19} className="shrink-0 text-fg-secondary" aria-hidden="true" />RecallLoop</h1><div className="flex items-center gap-xs">{headerActions}</div></header>{headerNotices}<main className="flex min-h-0 flex-1 items-center justify-center p-xl"><p className="flex items-center gap-sm text-sm text-tertiary">{loading && <LoaderCircle size={17} className="shrink-0 animate-spin" aria-hidden="true" />}{loading ? 'Loading workspace…' : 'Retry connection status to open your workspace.'}</p></main></>}
    {loading && !status && <span className="sr-only" role="status">Loading workspace connection status…</span>}
    {settings && <SettingsModal connection={status?.llm} status={status} identity={identity} vault={vault} preferences={preferences.values} onPreferences={preferences.update} onClearPreferences={preferences.clear} preferenceWarning={preferences.warning} initialSection={settings} onClose={() => setSettings(null)} onRefresh={refresh} busy={busy || localModels.busy} localWorkspace={builderEnabled} localModels={localModels} onLocalModels={() => { void discoverLocalModels() }} />}
    {walletDetails && <Modal title={identity.demo ? 'Offline demo session' : 'Wallet session'} onClose={() => setWalletDetails(false)} footer={<><Button onClick={() => setWalletDetails(false)}>Done</Button><Button disabled={disconnecting} onClick={() => { void disconnect() }}>{disconnecting ? <LoaderCircle size={15} className="shrink-0 animate-spin" aria-hidden="true" /> : <LogOut size={15} className="shrink-0" aria-hidden="true" />}{identity.demo ? 'Leave offline demo' : 'Disconnect wallet'}</Button></>}>
      {identity.address ? <><p className="mb-sm text-xs text-tertiary">Authenticated address</p><div className="flex items-start gap-md"><code className="min-w-0 break-all text-sm text-secondary">{identity.address}</code><CopyButton text={identity.address} label="Copy wallet address" /></div></> : <p className="text-sm text-secondary">An isolated scripted-model demo. Its in-process memories are ephemeral and do not establish Mainnet evidence.</p>}
      <dl className="mt-xl grid grid-cols-2 gap-xl border-y border-secondary py-xl text-sm"><div><dt className="text-xs text-tertiary">Network</dt><dd className="mt-sm">{identity.demo ? 'Offline · no chain writes' : 'Sui Mainnet'}</dd></div><div><dt className="text-xs text-tertiary">Session ends</dt><dd className="mt-sm">{identity.expiresAt ? new Date(identity.expiresAt).toLocaleTimeString() : 'Unavailable'}</dd></div></dl>
      <p className="mt-xl flex items-start gap-md text-sm text-secondary"><ShieldCheck size={17} className="mt-xxs shrink-0 text-fg-tertiary" aria-hidden="true" />{identity.demo ? 'Leave the demo to sign in with your wallet and connect live APIs.' : 'Your personal-message signature authenticates this session. It is not a transaction, grants no spending permission, and does not authorize Walrus access.'}</p>
      <p className="mt-lg text-xs text-tertiary">Disconnect ends this RecallLoop session, clears its API connections, locks the optional device vault, and removes this tab’s chat/project cache. Export edited files or chats first if you need them. An explicitly saved encrypted vault remains until forgotten in Advanced settings. Remote memories are untouched; extension permissions are managed by your wallet. Chat/project caches are unencrypted conveniences, not a security boundary.</p>
       {builderEnabled && <p className="mt-lg text-xs text-tertiary">Local tasks are stopped, approvals and preview links are revoked, and page-only source/drafts/terminal history are cleared. Applied disk changes remain on your machine; logout does not revert them.</p>}
      {disconnecting && <p role="status" className="mt-xl flex items-center gap-md text-sm text-secondary"><LoaderCircle size={15} className="shrink-0 animate-spin" aria-hidden="true" />Ending the RecallLoop session and clearing its API connections…</p>}
      {disconnectError && <p role="alert" className="mt-xl break-words text-sm text-error-primary">{disconnectError} Your session has not been confirmed disconnected. Retry when the server is reachable.</p>}
    </Modal>}
  </div>
}
