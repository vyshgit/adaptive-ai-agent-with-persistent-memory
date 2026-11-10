import { useEffect, useId, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import { Layers2, Plus, X, FileCode2, GitPullRequest, Database, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { WorkspaceStatus, MemoryOverview, Proposal, ChatMessage, WorkspaceMode } from './types.ts'
import type { ChainStatus } from './MemoryRail.tsx'
import type { SettingsSection } from './SettingsModal.tsx'
import type { WorkspaceCache } from './workspaceCache.ts'
import { applyProposal, loadProject, saveProject, contextCharacters, MAX_CONTEXT_CHARS } from './project.ts'
import { flushCacheOnExit } from './clientSafety.ts'
import { useAgentSession } from './useAgentSession.ts'
import { Button, IconButton, Tabs, fieldClass } from './ui.tsx'
import SessionSidebar from './SessionSidebar.tsx'
import ChatPane from './ChatPane.tsx'
import ProjectPane from './ProjectPane.tsx'
import ReviewPane from './ReviewPane.tsx'
import MemoryRail from './MemoryRail.tsx'
import FeedbackModal from './FeedbackModal.tsx'
import type { UpdatePreferences, WorkspacePreferences } from './workspacePreferences.ts'
import { availableConnections } from './providers.ts'
import { useModelSelection } from './useModelSelection.ts'

type Panel = 'project' | 'review' | 'memory'
type MobileView = Panel | 'sessions' | 'chat'

// Browser-only conversation/project state is never mounted in a local launch.
// That workspace owns disk tools and page-only source, drafts and task history.
export default function ConversationWorkspace({ status, overview, chain, loading, memoryLoading, cache, preferences, onPreferences, headerActions, headerNotices, demo,
  onMemoryRefresh, onChainRefresh, onSettings, onNotice, onBusy, stopTask }: {
  status: WorkspaceStatus; overview?: MemoryOverview; chain?: ChainStatus; loading: boolean; memoryLoading: boolean; cache: WorkspaceCache
  headerActions: ReactNode; headerNotices: ReactNode; demo: boolean; onMemoryRefresh: () => Promise<void>; onChainRefresh: () => Promise<void>
  onSettings: (section: SettingsSection) => void; onNotice: (message: string) => void; onBusy: (busy: boolean) => void
  stopTask: MutableRefObject<(() => void) | null>
  preferences: WorkspacePreferences; onPreferences: UpdatePreferences
}) {
  const [project, setProject] = useState(() => loadProject(cache.storage, cache.scope))
  const currentProject = useRef(project)
  currentProject.current = project
  const connections = availableConnections(status.llm, status.modelConnections)
  const selection = useModelSelection(connections, status.llm, preferences.conversation?.model, model => cacheOptions({ model }))
  const { connection, model } = selection
  const capture = preferences.autoMemory !== false
  const [captureRaw, setCaptureRaw] = useState(false)
  const [stream, setStream] = useState(preferences.conversation?.stream !== false)
  const [mode, setMode] = useState<WorkspaceMode>(preferences.conversation?.mode || 'talk')
  const [panel, setPanel] = useState<Panel>('project')
  const [panelOpen, setPanelOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(preferences.conversation?.sidebar !== false)
  const [mobile, setMobile] = useState<MobileView>('chat')
  const [feedback, setFeedback] = useState<ChatMessage | null>(null)
  const tabsId = useId(), sidebarId = useId()
  const agent = useAgentSession(() => { void onMemoryRefresh() }, cache)
  const busy = agent.busy
  stopTask.current = agent.stop

  useEffect(() => { onBusy(busy) }, [busy, onBusy])
  useEffect(() => () => { stopTask.current = null; onBusy(false) }, [stopTask, onBusy])
  useEffect(() => {
    const timer = setTimeout(() => { if (cache.active && !saveProject(project, cache.storage, cache.scope)) onNotice('Tab project cache could not be saved. Download your edited files before leaving this page.') }, 350)
    return () => clearTimeout(timer)
  }, [project, cache])
  useEffect(() => flushCacheOnExit(() => { if (cache.active) saveProject(currentProject.current, cache.storage, cache.scope) }), [cache])

  function cacheOptions(patch: Partial<NonNullable<WorkspacePreferences['conversation']>>) {
    onPreferences(current => ({ ...current, conversation: { ...current.conversation, ...patch } }))
  }

  const proposals = agent.activeSession.messages.flatMap(message => message.proposals || [])
  const pending = proposals.filter(proposal => proposal.status === 'pending').length
  const selectedFiles = project.files.filter(file => file.selected).length
  const tooMuchContext = contextCharacters(project) > MAX_CONTEXT_CHARS
  const canSend = !loading && Boolean(connection && model) && !tooMuchContext
  function showPanel(next: Panel) { setPanel(next); setPanelOpen(true); setMobile(next) }
  function togglePanel(next: Panel) {
    if (panelOpen && panel === next) { setPanelOpen(false); setMobile('chat') }
    else showPanel(next)
  }
  function closePanel() { setPanelOpen(false); setMobile('chat') }
  function newSession() { agent.newSession(); setMobile('chat'); onNotice('New local session. The browser project and remote memories are unchanged.') }
  function review(proposal: Proposal) {
    try { setProject(applyProposal(project, proposal)); agent.reviewProposal(proposal.id, 'applied'); onNotice(`Applied ${proposal.path} in the browser. No disk files changed or tests ran. Record an outcome after verifying it locally.`) }
    catch (error) { onNotice(error instanceof Error ? error.message : 'The proposal was not applied.') }
  }
  const options = () => ({ model, connectionId: connection?.id, project, capture, captureMode: captureRaw ? 'both' as const : 'facts' as const, stream, mode })

  return <>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-sm border-b border-secondary px-lg py-md sm:px-xl">
      <div className="flex min-w-0 items-center gap-lg">
        <IconButton className="hidden lg:inline-flex" label={sidebarOpen ? 'Collapse session sidebar' : 'Expand session sidebar'} aria-expanded={sidebarOpen} aria-controls={sidebarId} onClick={() => { setSidebarOpen(!sidebarOpen); cacheOptions({ sidebar: !sidebarOpen }) }}>{sidebarOpen ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}</IconButton>
        <Layers2 size={20} className="shrink-0 text-fg-secondary" aria-hidden="true" /><div className="min-w-0"><h1 className="text-md font-semibold">RecallLoop</h1><p className="hidden text-xs text-tertiary sm:block">{demo ? 'Offline demo workspace' : 'Wallet workspace'}</p></div>
      </div>
      <div className="flex items-center gap-xs sm:gap-md">
        <div className="hidden items-center gap-xs lg:flex" role="group" aria-label="Workspace tools">
          <Button quiet size="sm" aria-pressed={panelOpen && panel === 'project'} onClick={() => togglePanel('project')}><FileCode2 size={15} className="shrink-0" aria-hidden="true" />Files</Button>
          <Button quiet size="sm" aria-pressed={panelOpen && panel === 'review'} onClick={() => togglePanel('review')}><GitPullRequest size={15} className="shrink-0" aria-hidden="true" />Review{pending ? ` (${pending})` : ''}</Button>
          <Button quiet size="sm" aria-pressed={panelOpen && panel === 'memory'} onClick={() => togglePanel('memory')}><Database size={15} className="shrink-0" aria-hidden="true" />Memory</Button>
        </div>
        <IconButton label="New session" disabled={busy} onClick={newSession}><Plus size={18} aria-hidden="true" /></IconButton>
        {headerActions}
      </div>
    </header>
    {demo && <div className="shrink-0 border-b border-secondary bg-secondary px-xl py-md text-xs text-tertiary"><span className="font-medium text-warning-primary">Offline demo</span> · Scripted model and ephemeral memory. No Mainnet writes.</div>}
    {headerNotices}
    {(agent.cacheWarning || tooMuchContext) && <p role={tooMuchContext ? 'alert' : 'status'} className={`shrink-0 border-b border-secondary bg-secondary px-lg py-md text-xs ${tooMuchContext ? 'text-error-primary' : 'text-tertiary'}`}>{tooMuchContext ? 'Selected file context exceeds 160,000 characters. Uncheck files before sending.' : agent.cacheWarning}</p>}
    <div className="shrink-0 border-b border-secondary p-md lg:hidden"><label htmlFor="mobile-panel" className="sr-only">Workspace view</label><select id="mobile-panel" value={mobile} onChange={event => { const next = event.target.value as MobileView; setMobile(next); if (['project', 'review', 'memory'].includes(next)) { setPanel(next as Panel); setPanelOpen(true) } }} className={fieldClass}><option value="chat">Conversation</option><option value="sessions">Sessions</option><option value="project">Project files</option><option value="review">Review changes ({pending})</option><option value="memory">Portable memory</option></select></div>
    <main className="flex min-h-0 flex-1">
      <aside id={sidebarId} aria-label="Sessions sidebar" className={`${mobile === 'sessions' ? 'block' : 'hidden'} ${sidebarOpen ? 'lg:block' : 'lg:hidden'} h-full w-full shrink-0 border-r border-secondary lg:w-60`}>
        <SessionSidebar sessions={agent.sessions} activeId={agent.activeSession.id} busy={busy} onSelect={id => { agent.selectSession(id); setMobile('chat') }} onRename={agent.renameSession} onDelete={agent.deleteSession}
          onClear={() => { agent.clearCache(); setMobile('chat'); onNotice('Conversation history cleared. Walrus memories and the browser project are untouched.') }} />
      </aside>
      <div className={`${mobile === 'chat' ? 'flex' : 'hidden'} h-full min-w-0 flex-1 lg:flex`}>
        <ChatPane session={agent.activeSession} connection={connection} connections={connections} modelChoice={selection.value} busy={agent.busy} phase={agent.phase} canSend={canSend} model={model} onModel={selection.choose} capture={capture} onCapture={value => { onPreferences(current => ({ ...current, autoMemory: value })); if (!value) setCaptureRaw(false) }} captureRaw={captureRaw} onCaptureRaw={setCaptureRaw} stream={stream} onStream={value => { setStream(value); cacheOptions({ stream: value }) }} mode={mode} onMode={value => { setMode(value); cacheOptions({ mode: value }) }}
          memoryStatus={overview?.status || status.memory} selectedFiles={selectedFiles} onFiles={() => showPanel('project')} onSend={text => { void agent.send(text, options()) }} onStop={agent.stop} onRetry={message => {
            const index = agent.activeSession.messages.findIndex(item => item.id === message.id)
            const user = agent.activeSession.messages.slice(0, index).findLast(item => item.role === 'user')
            if (user) void agent.send(user.content, options(), user.id)
          }} onReview={() => showPanel('review')} onFeedback={setFeedback} onSettings={() => onSettings('model')} />
      </div>
      <aside aria-label="Project and memory panels" data-state={panelOpen ? 'open' : 'closed'} className={`workspace-panel ${['project', 'review', 'memory'].includes(mobile) ? 'flex' : 'hidden'} ${panelOpen ? 'lg:flex' : 'lg:hidden'} h-full min-h-0 w-full shrink-0 flex-col border-l border-secondary bg-secondary lg:w-80 xl:w-96`}>
        <div className="flex shrink-0 items-center border-b border-secondary"><div className="min-w-0 flex-1"><Tabs value={panel} onChange={showPanel} id={tabsId} label="Workspace panels" tabs={[{ id: 'project', label: 'Files' }, { id: 'review', label: `Review${pending ? ` (${pending})` : ''}` }, { id: 'memory', label: 'Memory' }]} /></div><IconButton label="Close workspace panel" className="mr-sm" onClick={closePanel}><X size={16} aria-hidden="true" /></IconButton></div>
        <div key={panel} role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${panel}`} className="workspace-detail-enter min-h-0 flex-1">
          {panel === 'project' ? <ProjectPane project={project} onChange={setProject} busy={busy} onNotice={onNotice} />
            : panel === 'review' ? <ReviewPane proposals={proposals} project={project} busy={busy} onApply={review} onReject={proposal => { agent.reviewProposal(proposal.id, 'rejected'); onNotice(`Rejected ${proposal.path}. The project is unchanged.`) }} />
              : <MemoryRail overview={overview} loading={memoryLoading} busy={busy} chain={chain} handoffAccountId={!demo && status.memoryConnection?.verified ? status.memoryConnection.accountId : null} onRefresh={onMemoryRefresh} onChain={onChainRefresh} onNotice={onNotice} onSettings={() => onSettings('walrus')} />}
        </div>
      </aside>
    </main>
    {feedback && <FeedbackModal message={feedback} session={agent.activeSession} onClose={() => setFeedback(null)} onStored={message => { onNotice(message); void onMemoryRefresh() }} />}
  </>
}
