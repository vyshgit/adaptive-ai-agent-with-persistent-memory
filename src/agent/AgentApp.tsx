import { useEffect, useId, useRef, useState } from 'react'
import { Brain, Settings, Sun, Moon, Plus, ArrowUpRight, X, ShieldCheck, LogOut, Wallet } from 'lucide-react'
import type { WorkspaceStatus, MemoryOverview, Proposal, ChatMessage, WalletSession, WorkspaceMode } from './types.ts'
import type { ChainStatus } from './MemoryRail.tsx'
import { agentJson } from './api.ts'
import { applyProposal, loadProject, saveProject, contextCharacters, MAX_CONTEXT_CHARS } from './project.ts'
import { flushCacheOnExit } from './clientSafety.ts'
import { useAgentSession } from './useAgentSession.ts'
import { Badge, Button, IconButton, Tabs } from './ui.tsx'
import SessionSidebar from './SessionSidebar.tsx'
import ChatPane from './ChatPane.tsx'
import ProjectPane from './ProjectPane.tsx'
import ReviewPane from './ReviewPane.tsx'
import MemoryRail, { MemoryModeBadge } from './MemoryRail.tsx'
import SettingsModal from './SettingsModal.tsx'
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
  const [settings, setSettings] = useState(false)
  const [feedback, setFeedback] = useState<ChatMessage | null>(null)
  const [project, setProject] = useState(() => loadProject(undefined, scope))
  const currentProject = useRef(project)
  currentProject.current = project
  const [model, setModel] = useState('')
  const [capture, setCapture] = useState(true)
  const [stream, setStream] = useState(true)
  const [mode, setMode] = useState<WorkspaceMode>('build')
  const [panel, setPanel] = useState<Panel>('project')
  const [mobile, setMobile] = useState<MobileView>('chat')
  const refreshId = useRef(0)
  const memoryId = useRef(0)
  const tabsId = useId()

  async function refreshMemory() {
    const id = ++memoryId.current
    setMemoryLoading(true)
    try { const result = await agentJson<MemoryOverview>('/memory'); if (id === memoryId.current) setOverview(result) }
    catch (error) { if (id === memoryId.current) setNotice(error instanceof Error ? error.message : 'Memory inventory could not be loaded.') }
    finally { if (id === memoryId.current) setMemoryLoading(false) }
  }
  async function refreshChain() {
    try { setChain(await agentJson<ChainStatus>('/chain')) }
    catch { setChain({ configured: false, checkpoint: null, account: null }) }
  }
  async function refresh() {
    const id = ++refreshId.current
    setLoading(true); setError('')
    try {
      const result = await agentJson<WorkspaceStatus>('/status')
      if (id !== refreshId.current) return
      setStatus(result)
      setModel(old => result.llm.models.some(model => model.id === old) ? old : result.llm.model || result.llm.models[0]?.id || '')
      void refreshMemory(); void refreshChain()
    } catch (error) {
      if (id === refreshId.current) { setStatus(undefined); setError(error instanceof Error ? error.message : 'Workspace status could not be loaded.') }
    } finally { if (id === refreshId.current) setLoading(false) }
  }
  const agent = useAgentSession(() => { void refreshMemory() }, scope)
  useEffect(() => { void refresh(); return () => { refreshId.current++; memoryId.current++ } }, [])
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
  function showPanel(next: Panel) { setPanel(next); setMobile(next) }
  function newSession() { agent.newSession(); setMobile('chat'); setNotice('New local session. The browser project and remote memories are unchanged.') }
  function review(proposal: Proposal) {
    try { setProject(applyProposal(project, proposal)); agent.reviewProposal(proposal.id, 'applied'); setNotice(`Applied ${proposal.path} in the browser. No disk files changed or tests ran. Record an outcome after verifying it locally.`) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'The proposal was not applied.') }
  }
  const options = () => ({ model, project, capture, stream, mode })

  return <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-primary text-primary">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-md border-b border-secondary px-lg py-md lg:px-xl">
      <div className="flex min-w-0 items-center gap-md"><span className="rounded-md border border-utility-brand-200 bg-utility-brand-50 p-sm"><Brain size={21} className="shrink-0 text-fg-brand-primary" /></span>
        <div><h1 className="text-lg font-semibold">RecallLoop</h1><p className="text-xs text-tertiary">{identity.demo ? 'Offline demo workspace' : 'Wallet workspace'} · Talk / Plan / Build</p></div></div>
      <div className="flex flex-wrap items-center gap-sm"><span className="hidden sm:inline-flex"><MemoryModeBadge status={overview?.status || status?.memory} /></span>
        <span className="hidden items-center gap-xs text-xs text-tertiary md:inline-flex" title={identity.address || 'Isolated offline demo'}><Wallet size={14} className="shrink-0" />{identity.address ? `${identity.address.slice(0, 6)}…${identity.address.slice(-4)}` : 'Demo'}</span>
        <Button disabled={agent.busy} onClick={newSession}><Plus size={15} className="shrink-0" /><span className="hidden sm:inline">New session</span><span className="sm:hidden">New</span></Button>
        <IconButton label="Workspace settings" onClick={() => setSettings(true)}><Settings size={18} /></IconButton>
        <IconButton label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={onTheme}>{dark ? <Sun size={18} /> : <Moon size={18} />}</IconButton>
        <IconButton label={identity.demo ? 'Leave offline demo' : 'Log out and clear API connections'} onClick={() => { agent.stop(); void onLogout().catch(error => setNotice(error instanceof Error ? error.message : 'Logout failed.')) }}><LogOut size={18} /></IconButton>
        <a href="#/console" onClick={agent.stop} className="hidden items-center gap-xs rounded-md px-sm py-sm text-xs text-tertiary hover:text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring sm:inline-flex">Console<ArrowUpRight size={14} className="shrink-0" /></a>
      </div>
    </header>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-sm border-b border-secondary bg-secondary px-lg py-sm text-xs text-tertiary lg:px-xl">
      <span className="inline-flex items-center gap-sm"><ShieldCheck size={14} className="shrink-0" />Selected files only · bounded tools · explicit code approval</span>
      <span className="hidden md:inline">Recall → code → review → remember</span>
    </div>
    {identity.demo ? <div className="shrink-0 border-b border-secondary bg-utility-warning-50 px-lg py-sm text-xs text-utility-warning-700">Offline demo: scripted model, isolated in-process memory, no Mainnet writes. Leave the demo to sign in and connect live APIs.</div>
      : status && (!status.tatum.configured || !status.memoryConnection?.verified || status.llm.mode !== 'live') && <div className="flex shrink-0 flex-wrap items-center justify-between gap-sm border-b border-secondary bg-secondary px-lg py-md text-xs text-secondary"><span>Connect your APIs: Tatum {status.tatum.configured ? '✓' : '—'} · Walrus Memory {status.memoryConnection?.verified ? '✓' : '—'} · Model {status.llm.mode === 'live' ? '✓' : '—'}. Without a live memory connection, capture cannot persist to Mainnet.</span><Button onClick={() => setSettings(true)}>Connect APIs</Button></div>}
    {(error || notice || agent.cacheWarning || tooMuchContext) && <div className="flex shrink-0 items-start justify-between gap-md border-b border-secondary bg-secondary px-lg py-md">
      <div role={error || tooMuchContext ? 'alert' : 'status'} className="min-w-0 text-xs">
        {error ? <span className="text-error-primary">{error} <button className="ml-sm rounded-md underline focus-visible:ring-2 focus-visible:ring-focus-ring" onClick={() => setSettings(true)}>Open settings</button><button className="ml-sm rounded-md underline focus-visible:ring-2 focus-visible:ring-focus-ring" onClick={() => { void refresh() }}>Retry status</button></span>
          : tooMuchContext ? <span className="text-error-primary">Selected file context exceeds 160,000 characters. Uncheck files before sending.</span> : notice || agent.cacheWarning}
      </div>
      {!error && !tooMuchContext && notice && <IconButton label="Dismiss notice" onClick={() => setNotice('')}><X size={13} /></IconButton>}
    </div>}
    <div className="shrink-0 border-b border-secondary p-md lg:hidden"><label htmlFor="mobile-panel" className="sr-only">Workspace view</label><select id="mobile-panel" value={mobile} onChange={event => { const next = event.target.value as MobileView; setMobile(next); if (['project', 'review', 'memory'].includes(next)) setPanel(next as Panel) }}
      className="w-full rounded-md border border-primary bg-primary px-lg py-sm text-sm text-primary focus-visible:ring-2 focus-visible:ring-focus-ring"><option value="chat">Conversation</option><option value="sessions">Sessions</option><option value="project">Project files</option><option value="review">Review changes ({pending})</option><option value="memory">Portable memory</option></select></div>
    <main className="flex min-h-0 flex-1">
      <aside aria-label="Sessions sidebar" className={`${mobile === 'sessions' ? 'block' : 'hidden'} h-full w-full shrink-0 border-r border-secondary lg:block lg:w-56`}>
        <SessionSidebar sessions={agent.sessions} activeId={agent.activeSession.id} busy={agent.busy} onNew={newSession} onSelect={id => { agent.selectSession(id); setMobile('chat') }} onRename={agent.renameSession} onDelete={agent.deleteSession}
          onClear={() => { agent.clearCache(); setMobile('chat'); setNotice('Conversation history cleared. Walrus memories and the browser project are untouched.') }} />
      </aside>
      <div className={`${mobile === 'chat' ? 'flex' : 'hidden'} h-full min-w-0 flex-1 lg:flex`}>
        <ChatPane session={agent.activeSession} connection={status?.llm} busy={agent.busy} phase={agent.phase} canSend={canSend} model={model} onModel={setModel} capture={capture} onCapture={setCapture} stream={stream} onStream={setStream} mode={mode} onMode={setMode}
          selectedFiles={selectedFiles} onSend={text => { void agent.send(text, options()) }} onStop={agent.stop} onRetry={message => {
            const index = agent.activeSession.messages.findIndex(item => item.id === message.id)
            const user = agent.activeSession.messages.slice(0, index).findLast(item => item.role === 'user')
            if (user) void agent.send(user.content, options(), user.id)
          }} onReview={() => showPanel('review')} onFeedback={setFeedback} onSettings={() => setSettings(true)} />
      </div>
      <aside aria-label="Project and memory panels" className={`${['project', 'review', 'memory'].includes(mobile) ? 'flex' : 'hidden'} h-full min-h-0 w-full shrink-0 flex-col border-l border-secondary lg:flex lg:w-80 xl:w-96`}>
        <Tabs value={panel} onChange={showPanel} id={tabsId} tabs={[{ id: 'project', label: 'Files' }, { id: 'review', label: `Review${pending ? ` (${pending})` : ''}` }, { id: 'memory', label: 'Memory' }]} />
        <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${panel}`} className="min-h-0 flex-1">
          {panel === 'project' ? <ProjectPane project={project} onChange={setProject} busy={agent.busy} onNotice={setNotice} />
            : panel === 'review' ? <ReviewPane proposals={proposals} project={project} busy={agent.busy} onApply={review} onReject={proposal => { agent.reviewProposal(proposal.id, 'rejected'); setNotice(`Rejected ${proposal.path}. The project is unchanged.`) }} />
              : <MemoryRail overview={overview} loading={memoryLoading} busy={agent.busy} chain={chain} onRefresh={refreshMemory} onChain={refreshChain} onNotice={setNotice} />}
        </div>
      </aside>
    </main>
    {loading && !status && <span className="sr-only" role="status">Loading workspace connection status…</span>}
    {settings && <SettingsModal connection={status?.llm} status={status} identity={identity} onClose={() => setSettings(false)} onRefresh={refresh} busy={agent.busy} />}
    {feedback && <FeedbackModal message={feedback} session={agent.activeSession} onClose={() => setFeedback(null)} onStored={message => { setNotice(message); void refreshMemory() }} />}
  </div>
}
