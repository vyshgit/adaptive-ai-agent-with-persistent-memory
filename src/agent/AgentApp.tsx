import { useEffect, useId, useRef, useState } from 'react'
import { Layers2, Settings, Sun, Moon, Plus, X, ShieldCheck, LogOut, Wallet, FileCode2, GitPullRequest, Database, PanelLeftClose, PanelLeftOpen, LoaderCircle } from 'lucide-react'
import type { WorkspaceStatus, MemoryOverview, Proposal, ChatMessage, WalletSession, WorkspaceMode } from './types.ts'
import type { ChainStatus } from './MemoryRail.tsx'
import { agentJson } from './api.ts'
import { applyProposal, loadProject, saveProject, contextCharacters, MAX_CONTEXT_CHARS } from './project.ts'
import { flushCacheOnExit, redactBrowserText } from './clientSafety.ts'
import { useAgentSession } from './useAgentSession.ts'
import { Button, IconButton, Tabs, Modal, CopyButton, fieldClass } from './ui.tsx'
import SessionSidebar from './SessionSidebar.tsx'
import ChatPane from './ChatPane.tsx'
import ProjectPane from './ProjectPane.tsx'
import ReviewPane from './ReviewPane.tsx'
import MemoryRail from './MemoryRail.tsx'
import SettingsModal, { type SettingsSection } from './SettingsModal.tsx'
import FeedbackModal from './FeedbackModal.tsx'

type Panel = 'project' | 'review' | 'memory'
type MobileView = Panel | 'sessions' | 'chat'

export default function AgentApp({ dark, onTheme, identity, onLogout }: { dark: boolean; onTheme: () => void; identity: WalletSession; onLogout: () => Promise<void> }) {
  const scope = identity.agentId!
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
  const [feedback, setFeedback] = useState<ChatMessage | null>(null)
  const [project, setProject] = useState(() => loadProject(undefined, scope))
  const currentProject = useRef(project)
  currentProject.current = project
  const [model, setModel] = useState('')
  const [capture, setCapture] = useState(true)
  const [stream, setStream] = useState(true)
  const [mode, setMode] = useState<WorkspaceMode>('talk')
  const [panel, setPanel] = useState<Panel>('project')
  const [panelOpen, setPanelOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobile, setMobile] = useState<MobileView>('chat')
  const refreshId = useRef(0)
  const memoryId = useRef(0)
  const chainId = useRef(0)
  const activeWorkspace = useRef(true)
  const tabsId = useId()
  const sidebarId = useId()

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
  async function refresh() {
    if (!activeWorkspace.current) return false
    const id = ++refreshId.current
    setLoading(true); setError('')
    try {
      const result = await agentJson<WorkspaceStatus>('/status')
      if (id !== refreshId.current) return false
      setStatus(result)
      setModel(old => result.llm.models.some(model => model.id === old) ? old : result.llm.model || result.llm.models[0]?.id || '')
      void refreshMemory(); void refreshChain()
      return true
    } catch (error) {
      if (id === refreshId.current) { setStatus(undefined); setError(error instanceof Error ? error.message : 'Workspace status could not be loaded.') }
      return false
    } finally { if (id === refreshId.current) setLoading(false) }
  }
  const agent = useAgentSession(() => { void refreshMemory() }, scope)
  useEffect(() => {
    activeWorkspace.current = true; void refresh()
    return () => { activeWorkspace.current = false; refreshId.current++; memoryId.current++; chainId.current++ }
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => { if (!saveProject(project, undefined, scope)) setNotice('Browser project cache could not be saved. Download your edited files before leaving this page.') }, 350)
    return () => clearTimeout(timer)
  }, [project, scope])
  useEffect(() => flushCacheOnExit(() => { saveProject(currentProject.current, undefined, scope) }), [scope])
  useEffect(() => {
    if (!agent.busy && agent.activeSession.model && status?.llm.models.some(model => model.id === agent.activeSession.model)) setModel(agent.activeSession.model)
  }, [agent.activeSession.id, status?.llm.models])
  const proposals = agent.activeSession.messages.flatMap(message => message.proposals || [])
  const pending = proposals.filter(proposal => proposal.status === 'pending').length
  const selectedFiles = project.files.filter(file => file.selected).length
  const tooMuchContext = contextCharacters(project) > MAX_CONTEXT_CHARS
  const canSend = !loading && Boolean(status && status.llm.mode !== 'unconfigured' && model) && !tooMuchContext
  function showPanel(next: Panel) { setPanel(next); setPanelOpen(true); setMobile(next) }
  function togglePanel(next: Panel) {
    if (panelOpen && panel === next) { setPanelOpen(false); setMobile('chat') }
    else showPanel(next)
  }
  function closePanel() { setPanelOpen(false); setMobile('chat') }
  function newSession() { agent.newSession(); setMobile('chat'); setNotice('New local session. The browser project and remote memories are unchanged.') }
  function review(proposal: Proposal) {
    try { setProject(applyProposal(project, proposal)); agent.reviewProposal(proposal.id, 'applied'); setNotice(`Applied ${proposal.path} in the browser. No disk files changed or tests ran. Record an outcome after verifying it locally.`) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'The proposal was not applied.') }
  }
  const options = () => ({ model, project, capture, stream, mode })
  async function disconnect() {
    if (disconnecting) return
    agent.stop(); setDisconnecting(true); setDisconnectError('')
    try { await onLogout() }
    catch (error) {
      if (!activeWorkspace.current) return
      const message = redactBrowserText(error instanceof Error ? error.message : 'Disconnect failed. Reconnect to the server and try again.')
      setDisconnectError(message); setNotice(message)
    }
    finally { if (activeWorkspace.current) setDisconnecting(false) }
  }

  return <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-primary text-primary">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-sm border-b border-secondary px-lg py-md sm:px-xl">
      <div className="flex min-w-0 items-center gap-lg">
        <IconButton className="hidden lg:inline-flex" label={sidebarOpen ? 'Collapse session sidebar' : 'Expand session sidebar'} aria-expanded={sidebarOpen} aria-controls={sidebarId} onClick={() => setSidebarOpen(old => !old)}>{sidebarOpen ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}</IconButton>
        <Layers2 size={20} className="shrink-0 text-fg-secondary" aria-hidden="true" /><div className="min-w-0"><h1 className="text-md font-semibold">RecallLoop</h1><p className="hidden text-xs text-tertiary sm:block">{identity.demo ? 'Offline demo workspace' : 'Wallet workspace'}</p></div>
      </div>
      <div className="flex items-center gap-xs sm:gap-md">
        <div className="hidden items-center gap-xs lg:flex" role="group" aria-label="Workspace tools">
          <Button quiet size="sm" aria-pressed={panelOpen && panel === 'project'} onClick={() => togglePanel('project')}><FileCode2 size={15} className="shrink-0" aria-hidden="true" />Files</Button>
          <Button quiet size="sm" aria-pressed={panelOpen && panel === 'review'} onClick={() => togglePanel('review')}><GitPullRequest size={15} className="shrink-0" aria-hidden="true" />Review{pending ? ` (${pending})` : ''}</Button>
          <Button quiet size="sm" aria-pressed={panelOpen && panel === 'memory'} onClick={() => togglePanel('memory')}><Database size={15} className="shrink-0" aria-hidden="true" />Memory</Button>
        </div>
        <IconButton label="New session" disabled={agent.busy} onClick={newSession}><Plus size={18} aria-hidden="true" /></IconButton>
        <Button quiet size="sm" aria-label={identity.demo ? 'Demo session details' : 'Wallet session details'} title={identity.address || 'Isolated offline demo'} onClick={() => { setDisconnectError(''); setWalletDetails(true) }}><Wallet size={15} className="shrink-0" aria-hidden="true" /><span className="hidden font-mono text-xs sm:inline">{identity.address ? `${identity.address.slice(0, 6)}…${identity.address.slice(-4)}` : 'Demo'}</span><span className="hidden text-xs text-tertiary xl:inline">{identity.demo ? 'Offline' : 'Sui Mainnet'}</span></Button>
        <IconButton label="Workspace settings" onClick={() => setSettings('model')}><Settings size={18} aria-hidden="true" /></IconButton>
        <IconButton label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={onTheme}>{dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</IconButton>
      </div>
    </header>
    {identity.demo && <div className="shrink-0 border-b border-secondary bg-secondary px-xl py-md text-xs text-tertiary"><span className="font-medium text-warning-primary">Offline demo</span> · Scripted model and ephemeral memory. No Mainnet writes.</div>}
    {(error || notice || agent.cacheWarning || tooMuchContext) && <div className="flex shrink-0 items-start justify-between gap-md border-b border-secondary bg-secondary px-lg py-md">
      <div role={error || tooMuchContext ? 'alert' : 'status'} className="min-w-0 text-xs">
        {error ? <span className="text-error-primary">{error} <button className="ml-sm rounded-md underline focus-visible:ring-2 focus-visible:ring-focus-ring" onClick={() => setSettings('model')}>Open settings</button><button className="ml-sm rounded-md underline focus-visible:ring-2 focus-visible:ring-focus-ring" onClick={() => { void refresh() }}>Retry status</button></span>
          : tooMuchContext ? <span className="text-error-primary">Selected file context exceeds 160,000 characters. Uncheck files before sending.</span> : notice || agent.cacheWarning}
      </div>
      {!error && !tooMuchContext && notice && <IconButton label="Dismiss notice" onClick={() => setNotice('')}><X size={13} /></IconButton>}
    </div>}
    <div className="shrink-0 border-b border-secondary p-md lg:hidden"><label htmlFor="mobile-panel" className="sr-only">Workspace view</label><select id="mobile-panel" value={mobile} onChange={event => { const next = event.target.value as MobileView; setMobile(next); if (['project', 'review', 'memory'].includes(next)) { setPanel(next as Panel); setPanelOpen(true) } }}
      className={fieldClass}><option value="chat">Conversation</option><option value="sessions">Sessions</option><option value="project">Project files</option><option value="review">Review changes ({pending})</option><option value="memory">Portable memory</option></select></div>
    <main className="flex min-h-0 flex-1">
      <aside id={sidebarId} aria-label="Sessions sidebar" className={`${mobile === 'sessions' ? 'block' : 'hidden'} ${sidebarOpen ? 'lg:block' : 'lg:hidden'} h-full w-full shrink-0 border-r border-secondary lg:w-60`}>
        <SessionSidebar sessions={agent.sessions} activeId={agent.activeSession.id} busy={agent.busy} onSelect={id => { agent.selectSession(id); setMobile('chat') }} onRename={agent.renameSession} onDelete={agent.deleteSession}
          onClear={() => { agent.clearCache(); setMobile('chat'); setNotice('Conversation history cleared. Walrus memories and the browser project are untouched.') }} />
      </aside>
      <div className={`${mobile === 'chat' ? 'flex' : 'hidden'} h-full min-w-0 flex-1 lg:flex`}>
        <ChatPane session={agent.activeSession} connection={status?.llm} busy={agent.busy} phase={agent.phase} canSend={canSend} model={model} onModel={setModel} capture={capture} onCapture={setCapture} stream={stream} onStream={setStream} mode={mode} onMode={setMode}
          memoryStatus={overview?.status || status?.memory} selectedFiles={selectedFiles} onFiles={() => showPanel('project')} onSend={text => { void agent.send(text, options()) }} onStop={agent.stop} onRetry={message => {
            const index = agent.activeSession.messages.findIndex(item => item.id === message.id)
            const user = agent.activeSession.messages.slice(0, index).findLast(item => item.role === 'user')
            if (user) void agent.send(user.content, options(), user.id)
          }} onReview={() => showPanel('review')} onFeedback={setFeedback} onSettings={() => setSettings('model')} />
      </div>
      <aside aria-label="Project and memory panels" data-state={panelOpen ? 'open' : 'closed'} className={`workspace-panel ${['project', 'review', 'memory'].includes(mobile) ? 'flex' : 'hidden'} ${panelOpen ? 'lg:flex' : 'lg:hidden'} h-full min-h-0 w-full shrink-0 flex-col border-l border-secondary bg-secondary lg:w-80 xl:w-96`}>
        <div className="flex shrink-0 items-center border-b border-secondary"><div className="min-w-0 flex-1"><Tabs value={panel} onChange={showPanel} id={tabsId} label="Workspace panels" tabs={[{ id: 'project', label: 'Files' }, { id: 'review', label: `Review${pending ? ` (${pending})` : ''}` }, { id: 'memory', label: 'Memory' }]} /></div><IconButton label="Close workspace panel" className="mr-sm" onClick={closePanel}><X size={16} aria-hidden="true" /></IconButton></div>
        <div key={panel} role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${panel}`} className="workspace-detail-enter min-h-0 flex-1">
          {panel === 'project' ? <ProjectPane project={project} onChange={setProject} busy={agent.busy} onNotice={setNotice} />
            : panel === 'review' ? <ReviewPane proposals={proposals} project={project} busy={agent.busy} onApply={review} onReject={proposal => { agent.reviewProposal(proposal.id, 'rejected'); setNotice(`Rejected ${proposal.path}. The project is unchanged.`) }} />
              : <MemoryRail overview={overview} loading={memoryLoading} busy={agent.busy} chain={chain} onRefresh={refreshMemory} onChain={refreshChain} onNotice={setNotice} onSettings={() => setSettings('walrus')} />}
        </div>
      </aside>
    </main>
    {loading && !status && <span className="sr-only" role="status">Loading workspace connection status…</span>}
    {settings && <SettingsModal connection={status?.llm} status={status} identity={identity} initialSection={settings} onClose={() => setSettings(null)} onRefresh={refresh} busy={agent.busy} />}
    {walletDetails && <Modal title={identity.demo ? 'Offline demo session' : 'Wallet session'} onClose={() => setWalletDetails(false)} footer={<><Button onClick={() => setWalletDetails(false)}>Done</Button><Button disabled={disconnecting} onClick={() => { void disconnect() }}>{disconnecting ? <LoaderCircle size={15} className="shrink-0 animate-spin" aria-hidden="true" /> : <LogOut size={15} className="shrink-0" aria-hidden="true" />}{identity.demo ? 'Leave offline demo' : 'Disconnect wallet'}</Button></>}>
      {identity.address ? <><p className="mb-sm text-xs text-tertiary">Authenticated address</p><div className="flex items-start gap-md"><code className="min-w-0 break-all text-sm text-secondary">{identity.address}</code><CopyButton text={identity.address} label="Copy wallet address" /></div></> : <p className="text-sm text-secondary">An isolated scripted-model demo. Its in-process memories are ephemeral and do not establish Mainnet evidence.</p>}
      <dl className="mt-xl grid grid-cols-2 gap-xl border-y border-secondary py-xl text-sm"><div><dt className="text-xs text-tertiary">Network</dt><dd className="mt-sm">{identity.demo ? 'Offline · no chain writes' : 'Sui Mainnet'}</dd></div><div><dt className="text-xs text-tertiary">Session ends</dt><dd className="mt-sm">{identity.expiresAt ? new Date(identity.expiresAt).toLocaleTimeString() : 'Unavailable'}</dd></div></dl>
      <p className="mt-xl flex items-start gap-md text-sm text-secondary"><ShieldCheck size={17} className="mt-xxs shrink-0 text-fg-tertiary" aria-hidden="true" />{identity.demo ? 'Leave the demo to sign in with your wallet and connect live APIs.' : 'Your personal-message signature authenticates this session. It is not a transaction, grants no spending permission, and does not authorize Walrus access.'}</p>
      <p className="mt-lg text-xs text-tertiary">Disconnect ends the RecallLoop session and clears its API connections, not browser history or remote memories. Extension permissions are managed by your wallet. Browser caches are unencrypted conveniences.</p>
      {disconnecting && <p role="status" className="mt-xl flex items-center gap-md text-sm text-secondary"><LoaderCircle size={15} className="shrink-0 animate-spin" aria-hidden="true" />Ending the RecallLoop session and clearing its API connections…</p>}
      {disconnectError && <p role="alert" className="mt-xl break-words text-sm text-error-primary">{disconnectError} Your session has not been confirmed disconnected. Retry when the server is reachable.</p>}
    </Modal>}
    {feedback && <FeedbackModal message={feedback} session={agent.activeSession} onClose={() => setFeedback(null)} onStored={message => { setNotice(message); void refreshMemory() }} />}
  </div>
}
