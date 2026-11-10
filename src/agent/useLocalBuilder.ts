import { useEffect, useRef, useState } from 'react'
import { agentFetch, agentJson, readAgentSse, responseError } from './api.ts'
import { redactBrowserText } from './clientSafety.ts'
import { dismissReview, editorAfterApply, workingHistory } from './builderState.ts'
import type { BuilderApproval, BuilderMode, BuilderRecall, BuilderStatus, CheckpointDraft, LocalFile, LocalListing, LocalRun, LocalSearch, LocalTool, PermissionMode, StaticPreview } from './builderTypes.ts'
import type { StoredCapture } from './types.ts'

// Native source, terminal output, task transcripts and approval capabilities are
// page memory ONLY. Auto-memory separately extracts current user prose on the
// server; it never uploads this hook's source, tool output or conversation log.
export function useLocalBuilder(onBusy: (busy: boolean) => void, onStored: () => void, memoryBinding: string) {
  const [status, setStatus] = useState<BuilderStatus>()
  const [listing, setListing] = useState<LocalListing>({ path: '.', entries: [], truncated: false })
  const [search, setSearch] = useState<LocalSearch | null>(null)
  const [file, setFile] = useState<LocalFile | null>(null)
  const [draft, updateDraft] = useState('')
  const [approvals, setApprovals] = useState<BuilderApproval[]>([])
  const [reviewing, setReviewing] = useState<BuilderApproval | null>(null)
  const [runs, setRuns] = useState<LocalRun[]>([])
  const [terminal, setTerminal] = useState('')
  const [terminalOutcome, setTerminalOutcome] = useState('No command has run.')
  const [terminalVersion, setTerminalVersion] = useState(0)
  const [taskId, setTaskId] = useState('')
  const [running, setRunning] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [requests, setRequests] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [recall, setRecall] = useState<BuilderRecall | null>(null)
  const [recallExpired, setRecallExpired] = useState(false)
  const [memoryIds, setMemoryIds] = useState<string[]>([])
  const [preview, setPreview] = useState<StaticPreview | null>(null)
  const alive = useRef(false), generation = useRef(0), controllers = useRef(new Set<AbortController>())
  const executing = useRef<{ controller: AbortController; taskId: string; stopping: boolean; commandActive: boolean } | null>(null)
  const decidingId = useRef(''), currentWorkspace = useRef<string | null>(null), observedTask = useRef('')
  const currentFile = useRef<LocalFile | null>(null), currentDraft = useRef(''), currentListing = useRef(listing)
  const sequence = useRef({ status: 0, listing: 0, selection: 0, search: 0, recall: 0, preview: 0, edits: 0, memory: 0, disk: 0, apply: 0 })
  const memoryEpoch = useRef(0), changingWorkspace = useRef(false)
  const actions = useRef(new Map<string, BuilderApproval>())
  const onStoredRef = useRef(onStored)
  onStoredRef.current = onStored
  const dirty = Boolean(file && draft !== (file.content ?? ''))
  const busy = running || requests > 0 || deciding || Boolean(taskId)
  const message = (value: unknown) => redactBrowserText(value instanceof Error ? value.message : 'The local operation failed. Nothing was declared successful.')
  const live = (version: number) => alive.current && generation.current === version
  function report(value: unknown, version = generation.current) {
    if (live(version) && (value as Error)?.name !== 'AbortError') setError(message(value))
  }
  function setDraft(value: string) { sequence.current.edits++; currentDraft.current = value; updateDraft(value) }
  function setEditor(next: LocalFile | null, value: string) { currentFile.current = next; setFile(next); setDraft(value) }
  function observeTask(id: string) { observedTask.current = id; setTaskId(id) }
  function invalidate() {
    generation.current++; sequence.current.status++; sequence.current.selection++; sequence.current.listing++
    for (const controller of controllers.current) controller.abort()
    controllers.current.clear(); executing.current = null; decidingId.current = ''
    setRequests(0); setRunning(false); setDeciding(false); observeTask('')
  }
  function clearPage() {
    setEditor(null, ''); actions.current.clear(); setSearch(null)
    currentListing.current = { path: '.', entries: [], truncated: false }; setListing(currentListing.current)
    setApprovals([]); setReviewing(null); setRecall(null); setRecallExpired(false); setMemoryIds([]); setPreview(null); setRuns([]); setTerminal(''); setTerminalOutcome('No command has run.'); setTerminalVersion(value => value + 1)
  }
  function installStatus(next: BuilderStatus) {
    if (currentWorkspace.current !== next.workspaceId) { invalidate(); clearPage(); currentWorkspace.current = next.workspaceId }
    if (memoryEpoch.current !== next.memoryEpoch) { memoryEpoch.current = next.memoryEpoch; invalidateMemory() }
    setStatus(next); setApprovals(next.approvals || [])
    for (const approval of next.approvals || []) actions.current.set(approval.id, approval)
    if (!executing.current) observeTask(next.task?.id || '')
  }

  async function request<T>(path: string, body?: object): Promise<T> {
    const controller = new AbortController(), version = generation.current
    controllers.current.add(controller)
    if (alive.current) setRequests(value => value + 1)
    try {
      const value = await agentJson<T>(`/builder${path}`, { signal: controller.signal, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) })
      controller.signal.throwIfAborted()
      if (!live(version)) throw new DOMException('Workspace ended', 'AbortError')
      return value
    } finally {
      controllers.current.delete(controller)
      if (alive.current && generation.current === version) setRequests(value => Math.max(0, value - 1))
    }
  }
  function scoped(body: object = {}) {
    if (!currentWorkspace.current) throw new Error('Choose and open a local project folder first.')
    return { ...body, workspaceId: currentWorkspace.current }
  }
  async function refresh() {
    const token = ++sequence.current.status
    const next = await request<BuilderStatus>('/status')
    if (token !== sequence.current.status) throw new DOMException('Status superseded', 'AbortError')
    const changed = currentWorkspace.current !== next.workspaceId
    installStatus(next)
    if (next.task && !executing.current) setNotice('A task is running in another tab. Stop it here before starting another.')
    if (changed && next.opened) await list('.')
    return next
  }
  async function list(path = currentListing.current.path) {
    const token = ++sequence.current.listing, version = generation.current
    try {
      const query = new URLSearchParams(scoped({ path }) as Record<string, string>)
      const next = await request<LocalListing>(`/files?${query}`)
      if (token !== sequence.current.listing) return
      currentListing.current = next; setListing(next)
    } catch (value) { if (token === sequence.current.listing) report(value, version) }
  }
  async function findFiles(name: string) {
    const token = ++sequence.current.search, version = generation.current
    setError('')
    if (!name.trim()) { setSearch(null); return }
    try {
      const next = await request<LocalSearch>('/search', scoped({ name, path: '.' }))
      if (token === sequence.current.search) setSearch(next)
    } catch (value) { if (token === sequence.current.search) report(value, version) }
  }
  async function open(permissionMode: PermissionMode = 'standard', directory?: string) {
    if (changingWorkspace.current || executing.current || observedTask.current) return false
    if (currentWorkspace.current && !allowDiscard()) return false
    changingWorkspace.current = true
    const version = generation.current
    setError(''); sequence.current.status++
    try {
      const next = await request<BuilderStatus>('/open', { confirm: 'open-local-folder', permissionMode, workspaceId: currentWorkspace.current,
        ...(directory !== undefined ? { directory } : {}) })
      installStatus(next)
      setNotice(permissionMode === 'standard' ? 'Project open. Routine edits and hardened inspection run automatically; risky actions ask.' : 'Project open with strict review. Every edit and command asks for permission.')
      await list('.')
      return true
    } catch (value) {
      report(value, version)
      // The switch may have committed before a response was interrupted.
      if (live(version)) await refresh().catch(error => report(error, version))
      return false
    } finally { changingWorkspace.current = false }
  }
  function allowDiscard() { return !currentFile.current || currentDraft.current === (currentFile.current.content ?? '') || window.confirm('Discard the unsaved editor draft? Approved disk files are unchanged.') }
  async function selectFile(path: string) {
    if (!allowDiscard()) return
    const token = ++sequence.current.selection, version = generation.current, edits = sequence.current.edits, disk = sequence.current.disk
    setError('')
    try {
      const query = new URLSearchParams(scoped({ path }) as Record<string, string>)
      const next = await request<LocalFile>(`/file?${query}`)
      if (token !== sequence.current.selection) return
      if (disk !== sequence.current.disk) { setNotice('The disk changed while that file was loading. Select it again to load a fresh version.'); return }
      if (edits !== sequence.current.edits) { setNotice('A newer editor draft was kept. Select the file again when you are ready to discard or refresh it.'); return }
      setEditor(next, next.content ?? '')
    } catch (value) { if (token === sequence.current.selection) report(value, version) }
  }
  function newFile(path: string) {
    if (!path.trim() || !allowDiscard()) return false
    sequence.current.selection++
    setEditor({ path: path.trim(), content: null, version: null, bytes: 0, redacted: false }, ''); setError('')
    return true
  }
  function addReview(approval: BuilderApproval) {
    actions.current.set(approval.id, approval)
    setApprovals(items => [...items.filter(item => item.id !== approval.id), approval].slice(-8))
    setReviewing(approval)
  }
  async function reviewFile(remove = false) {
    const selected = currentFile.current, content = currentDraft.current
    if (!selected || selected.redacted) return
    const version = generation.current
    setError('')
    try {
      const result = await request<{ approval: BuilderApproval }>('/reviews/file', scoped({ path: selected.path, version: selected.version,
        content: remove ? null : content, reason: remove ? 'Delete this exact local file.' : 'Save this reviewed editor draft to disk.' }))
      addReview(result.approval)
    } catch (value) { report(value, version) }
  }
  async function saveFile() {
    const selected = currentFile.current, content = currentDraft.current
    if (!selected || selected.redacted || busy) return
    await execute('/write', scoped({ path: selected.path, version: selected.version, content, reason: 'Save this exact editor draft to disk.' }), undefined, undefined, { kind: 'file', after: content })
  }
  async function setPermissions(permissionMode: PermissionMode) {
    const version = generation.current
    setError('')
    try {
      const next = await request<BuilderStatus>('/permissions', scoped({ permissionMode }))
      installStatus(next); setReviewing(current => current?.kind === 'memory' ? current : null)
      for (const [id, action] of actions.current) if (action.kind !== 'memory') actions.current.delete(id)
      setNotice(permissionMode === 'standard' ? 'Standard permissions enabled. Routine text edits and hardened inspection are automatic; other actions ask.' : 'Strict review enabled. Every disk change and native command asks for permission.')
    } catch (value) { report(value, version) }
  }
  async function reviewCommand(command: string, cwd: string, seconds: number) {
    const version = generation.current
    setError('')
    try { addReview((await request<{ approval: BuilderApproval }>('/reviews/command', scoped({ command, cwd, timeoutMs: seconds * 1000, reason: 'Run the exact command entered in the local terminal.' }))).approval) }
    catch (value) { report(value, version) }
  }
  async function runCommand(command: string, cwd: string, seconds: number) {
    if (busy || !command.trim()) return
    await execute('/command', scoped({ command, cwd, timeoutMs: seconds * 1000, reason: 'Run the exact command entered in the project terminal.' }))
  }
  async function applied(path: string, deleted: boolean, approval?: BuilderApproval | { kind: 'file'; after: string | null }) {
    if (!alive.current) return
    sequence.current.disk++
    const token = sequence.current.selection, refresh = ++sequence.current.apply, version = generation.current
    void list()
    if (currentFile.current?.path !== path) return
    try {
      const query = new URLSearchParams(scoped({ path }) as Record<string, string>)
      const next: LocalFile = deleted ? { path, content: null, version: null, bytes: 0, redacted: false } : await request<LocalFile>(`/file?${query}`)
      if (!live(version) || token !== sequence.current.selection || refresh !== sequence.current.apply || currentFile.current?.path !== path) return
      const result = editorAfterApply(currentFile.current, currentDraft.current, next, approval)
      setEditor(result.file, result.draft)
      if (result.keptDraft) setNotice('The reviewed edit is on disk. Your later unsaved editor draft was kept; inspect it against the refreshed file before saving.')
    } catch (value) { if (token === sequence.current.selection) report(value, version) }
  }
  async function execute(path: string, body: object, runId?: string, approval?: BuilderApproval, submitted?: { kind: 'file'; after: string | null }) {
    const ownExecution = !approval || (approval.source === 'manual' && (body as { decision: string }).decision === 'approve')
    if (ownExecution && (executing.current || observedTask.current)) return
    const controller = new AbortController(), version = generation.current
    const execution = { controller, taskId: '', stopping: false, commandActive: false }
    controllers.current.add(controller)
    if (ownExecution) { executing.current = execution; setRunning(true) }
    setError('')
    let completed = false, captured = false, failure: Error | null = null
    const unconfirmedCapture = (): StoredCapture => (body as { capture?: boolean }).capture === false
      ? { verbatim: 0, facts: 0, failed: 0, blobs: [], skipped: true, message: 'Auto-memory is off for this turn.' }
      : { verbatim: 0, facts: 0, failed: 0, blobs: [], pending: true, message: 'Memory confirmation was interrupted. Accepted writes may still complete; refresh Walrus inventory.' }
    try {
      const response = await agentFetch(`/builder${path}`, { method: 'POST', body: JSON.stringify(body), signal: controller.signal })
      if (!response.ok) throw await responseError(response)
      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        const result = await response.json()
        controller.signal.throwIfAborted()
        if (live(version)) {
          if (result.requiresApproval && result.approval) { addReview(result.approval); setNotice('This action needs permission. Review its exact contents before approving.') }
          else setNotice(result.pendingExecution ? 'Approval accepted. Wait for the task’s confirmed execution result.' : 'Action rejected. Nothing ran.')
          completed = true
        }
      } else await readAgentSse(response, (type, unknown) => {
        if (!live(version) || controller.signal.aborted) return
        const data = unknown as Record<string, unknown>
        if (type === 'task_started' && typeof data.taskId === 'string') { execution.taskId = data.taskId; observeTask(data.taskId) }
        if (type === 'approval') addReview(unknown as BuilderApproval)
        if (type === 'tool' && typeof data.name === 'string') {
          if (runId) setRuns(items => items.map(item => item.id === runId ? { ...item, tools: [...item.tools, { id: String(data.id || crypto.randomUUID()), name: data.name as string,
            ...(typeof data.path === 'string' ? { path: redactBrowserText(data.path) } : {}), ...(typeof data.command === 'string' ? { command: redactBrowserText(data.command) } : {}), status: 'running' } as LocalTool].slice(-32) } : item))
        }
        if ((type === 'tool_waiting' || type === 'tool_result') && runId) setRuns(items => items.map(item => item.id === runId ? { ...item,
          tools: item.tools.map(tool => tool.id === data.id ? { ...tool, status: type === 'tool_waiting' ? 'waiting' : data.status as LocalTool['status'],
            summary: redactBrowserText(String(data.summary || data.reason || '')), ...(typeof data.output === 'string' ? { output: redactBrowserText(data.output).slice(0, 4000) } : {}),
            ...(typeof data.exitCode === 'number' || data.exitCode === null ? { exitCode: data.exitCode as number | null } : {}), ...(typeof data.commandStatus === 'string' ? { commandStatus: data.commandStatus } : {}) } : tool) } : item))
        if (type === 'memory_started' && runId) setRuns(items => items.map(item => item.id === runId ? { ...item, recalling: true } : item))
        if (type === 'memory' && runId) setRuns(items => items.map(item => item.id === runId ? { ...item, recalling: false, memories: Array.isArray(data.memories) ? data.memories as LocalRun['memories'] : [], memoryUnavailable: data.unavailable === true, memoryTruncated: data.truncated === true } : item))
        if (type === 'stored' && runId) {
          captured = true
          const stored = unknown as StoredCapture
          setRuns(items => items.map(item => item.id === runId ? { ...item, stored } : item))
          if (!stored.skipped) onStoredRef.current()
        }
        if (type === 'delta' && runId && typeof data.text === 'string') setRuns(items => items.map(item => item.id === runId ? { ...item, answer: (item.answer + data.text).slice(0, 100_000) } : item))
        if (type === 'terminal_started') { execution.commandActive = true; setTerminal(''); setTerminalOutcome('Native command running…'); setTerminalVersion(value => value + 1) }
        if (type === 'terminal_output' && typeof data.text === 'string') setTerminal(value => (value + data.text).slice(0, 256_000))
        if (type === 'terminal_done') { execution.commandActive = false; setTerminalOutcome(data.status === 'exited' ? `Exited with code ${data.exitCode ?? 'unknown'}.` : `Stopped: ${String(data.status || 'unknown')}. Not a passed test.`) }
        if (type === 'terminal_failed') { execution.commandActive = false; setTerminalOutcome(`Command failed: ${redactBrowserText(String(data.message || data.code || 'unknown'))} Not a passed test.`) }
        if (type === 'file_applied' && typeof data.path === 'string') {
          setNotice(`Confirmed on disk: ${data.path}. No test result is implied.`)
          const reviewed = typeof data.approvalId === 'string' ? actions.current.get(data.approvalId) : approval || submitted
          void applied(data.path, data.deleted === true, reviewed)
          if (typeof data.approvalId === 'string') actions.current.delete(data.approvalId)
        }
        if (type === 'done') {
          completed = true
          if (runId) setRuns(items => items.map(item => item.id === runId ? { ...item, status: 'complete', recalling: false,
            ...(typeof data.answer === 'string' ? { answer: redactBrowserText(data.answer).slice(0, 100_000) } : {}),
            ...(typeof data.requests === 'number' ? { requests: data.requests } : {}) } : item))
          if (approval?.kind === 'command' || path === '/command') {
            const result = data.result as { exitCode?: number; status?: string; output?: string } | undefined
            if (typeof result?.output === 'string') setTerminal(redactBrowserText(result.output).slice(0, 256_000))
            setTerminalOutcome(result?.status === 'exited' ? `Exited with code ${result.exitCode ?? 'unknown'}.` : `Stopped: ${result?.status || 'unknown'}. Not a passed test.`)
          }
          if (approval?.kind === 'memory') {
            const result = data.result as { blobId?: string; namespace?: string } | undefined
            setNotice(`Checkpoint write confirmed${result?.blobId ? ` · ${result.blobId}` : ''}${result?.namespace ? ` · ${result.namespace}` : ''}. Reviewed context only, not a project backup.`)
            onStoredRef.current()
          }
        }
        if (type === 'error') {
          failure = new Error(typeof data.message === 'string' ? redactBrowserText(data.message) : 'The local task failed.')
          if (data.code === 'wallet_required' || data.code === 'session_changed') window.dispatchEvent(new Event('recallloop-auth-changed'))
        }
      }, controller.signal)
      if (failure) throw failure
      if (!completed) throw new Error('The stream ended without a confirmed completion. Already-approved disk changes may remain; inspect them before retrying.')
      if (runId && !captured) setRuns(items => items.map(item => item.id === runId ? { ...item, stored: unconfirmedCapture() } : item))
      if (live(version) && approval) { setApprovals(items => items.filter(item => item.id !== approval.id)); setReviewing(current => dismissReview(current, approval.id)) }
    } catch (value) {
      if (!live(version)) return
      if (completed && runId) {
        // A completed coding task stays complete when only memory confirmation
        // is interrupted. Never invite a repeat disk edit as a storage retry.
        setRuns(items => items.map(item => item.id === runId ? { ...item, stored: item.stored || unconfirmedCapture() } : item))
        return
      }
      const stopped = controller.signal.aborted || execution.stopping
      const error = stopped ? 'Task stopped. Applied edits remain on disk.' : message(value)
      setError(error)
      if (runId) setRuns(items => items.map(item => item.id === runId ? { ...item, status: stopped ? 'stopped' : 'error', error, recalling: false,
        tools: item.tools.map(tool => tool.status === 'running' || tool.status === 'waiting' ? { ...tool, status: stopped ? 'blocked' : 'error', summary: 'Interrupted · result not confirmed. Inspect partial disk changes before retrying.' } : tool) } : item))
      if (approval?.kind === 'command' || path === '/command' || execution.commandActive) setTerminalOutcome(stopped ? 'Stopped by user. Not a passed test.' : 'Command failed or exceeded its budget. Not a passed test.')
      if (approval) { setApprovals(items => items.filter(item => item.id !== approval.id)); setReviewing(current => dismissReview(current, approval.id)) }
    } finally {
      controllers.current.delete(controller)
      if (ownExecution && executing.current === execution) {
        executing.current = null
        if (live(version)) {
          setRunning(false)
          if (observedTask.current === execution.taskId) observeTask('')
          setApprovals(items => items.filter(item => item.source !== 'agent'))
          setReviewing(current => current?.source === 'agent' ? null : current)
          for (const [id, action] of actions.current) if (action.source === 'agent') actions.current.delete(id)
          void refresh().catch(value => report(value, version))
        }
      }
    }
  }
  function send(text: string, options: { mode: BuilderMode; model: string; connectionId?: string; useMemory: boolean; capture: boolean }) {
    if (!text.trim() || busy || executing.current || observedTask.current) return false
    if (memoryIds.length && (!recall || recall.expiresAt <= Date.now())) { setError('The selected recall expired. Recall again or explicitly clear the attachment before sending.'); return false }
    if (!currentWorkspace.current) { setError('Choose and open a local project folder first.'); return false }
    const selected = currentFile.current, id = crypto.randomUUID()
    const history = workingHistory(runs)
    setNotice('')
    setRuns(items => [...items, { id, prompt: redactBrowserText(text), answer: '', status: 'running', mode: options.mode, model: options.model, tools: [] } as LocalRun].slice(-12))
    const attached = recall && recall.expiresAt > Date.now() ? memoryIds : []
    void execute('/prompt', scoped({ text, ...options, history, ...(selected ? { selectedPath: selected.path } : {}),
      ...(attached.length ? { recallId: recall!.recallId, memoryIds: attached } : {}) }), id)
    return true
  }
  function newSession() {
    if (busy || executing.current || observedTask.current) return
    setRuns([]); clearRecall(); setTerminal(''); setTerminalOutcome('No command has run.'); setTerminalVersion(value => value + 1); setError('')
    setNotice('New page session. Recent conversation and recalled attachments were cleared; project files, editor drafts and remote memories are unchanged.')
  }
  async function decide(approval: BuilderApproval, decision: 'approve' | 'reject') {
    if (decidingId.current || approval.workspaceId !== currentWorkspace.current) return
    if (decision === 'approve' && approval.source === 'manual' && (executing.current || observedTask.current)) return
    const version = generation.current
    decidingId.current = approval.id; setDeciding(true)
    try { await execute('/approvals', { workspaceId: approval.workspaceId, id: approval.id, digest: approval.digest, decision }, undefined, approval) }
    finally { if (live(version) && decidingId.current === approval.id) { decidingId.current = ''; setDeciding(false) } }
  }
  async function stop() {
    const active = executing.current
    const id = observedTask.current, version = generation.current
    if (active) { active.stopping = true; active.controller.abort() }
    setReviewing(null)
    try {
      if (id) await request('/stop', scoped({ taskId: id }))
      await refresh()
      setNotice('Stopped. Applied edits remain on disk. Check the turn’s memory status; accepted writes may still finish.')
    } catch (value) { report(value, version) }
  }
  async function close() {
    if (changingWorkspace.current || !currentWorkspace.current || !allowDiscard()) return
    changingWorkspace.current = true
    const body = scoped()
    invalidate()
    const version = generation.current
    setError('')
    try {
      const next = await request<BuilderStatus>('/close', body)
      installStatus(next); clearPage()
      setNotice('Local folder closed. Approved disk changes remain; no filesystem restoration or memory write took place.')
    } catch (value) { report(value, version); if (live(version)) void refresh().catch(error => report(error, version)) }
    finally { changingWorkspace.current = false }
  }
  async function recallMemory(query: string, includeRaw: boolean) {
    const token = ++sequence.current.recall, version = generation.current, binding = sequence.current.memory
    setError(''); setRecall(null); setRecallExpired(false); setMemoryIds([])
    try { const next = await request<BuilderRecall>('/recall', scoped({ query, includeRaw })); if (token === sequence.current.recall && binding === sequence.current.memory) setRecall(next) }
    catch (value) { if (token === sequence.current.recall) report(value, version) }
  }
  function clearRecall() {
    sequence.current.recall++; setRecall(null); setRecallExpired(false); setMemoryIds([])
  }
  function invalidateMemory() {
    sequence.current.memory++; clearRecall()
    for (const [id, action] of actions.current) if (action.kind === 'memory') actions.current.delete(id)
    setApprovals(items => items.filter(item => item.kind !== 'memory'))
    setReviewing(current => current?.kind === 'memory' ? null : current)
  }
  async function reviewCheckpoint(draft: CheckpointDraft) {
    const version = generation.current, binding = sequence.current.memory
    setError('')
    try {
      const result = await request<{ approval: BuilderApproval }>('/reviews/checkpoint', scoped(draft))
      if (binding === sequence.current.memory) addReview(result.approval)
    }
    catch (value) { report(value, version) }
  }
  async function createPreview(path: string, entry: string) {
    const token = ++sequence.current.preview, version = generation.current
    setError('')
    try { const next = await request<StaticPreview>('/preview', scoped({ path, entry })); if (token === sequence.current.preview) setPreview(next) }
    catch (value) { if (token === sequence.current.preview) report(value, version) }
  }
  async function closePreview() {
    const version = generation.current
    sequence.current.preview++; setPreview(null)
    try { await request('/preview/close', scoped()) }
    catch (value) { report(value, version) }
  }
  useEffect(() => {
    alive.current = true; setRequests(0)
    const version = generation.current
    void refresh().catch(value => report(value, version))
    return () => {
      alive.current = false; generation.current++
      for (const controller of controllers.current) controller.abort()
      controllers.current.clear(); executing.current = null; actions.current.clear(); currentFile.current = null; currentDraft.current = ''
    }
  }, [])
  useEffect(() => { onBusy(busy) }, [busy, onBusy])
  useEffect(() => () => onBusy(false), [onBusy])
  useEffect(() => {
    invalidateMemory()
    if (alive.current && currentWorkspace.current) void refresh().catch(value => report(value))
  }, [memoryBinding])
  useEffect(() => {
    const focused = () => { if (alive.current && !executing.current && !changingWorkspace.current) void refresh().catch(value => report(value)) }
    window.addEventListener('focus', focused)
    return () => window.removeEventListener('focus', focused)
  }, [])
  useEffect(() => {
    if (!recall) return
    const timer = setTimeout(() => { setRecallExpired(true); setNotice('The reviewed recall expired. Recall again or clear its attachment before sending another task.') }, Math.max(0, recall.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [recall])
  useEffect(() => {
    if (!approvals.length) return
    const timer = setInterval(() => {
      const now = Date.now()
      setApprovals(items => items.some(item => item.expiresAt <= now) ? items.filter(item => item.expiresAt > now) : items)
      for (const [id, action] of actions.current) if (action.expiresAt <= now) actions.current.delete(id)
    }, 1000)
    return () => clearInterval(timer)
  }, [Boolean(approvals.length)])
  useEffect(() => {
    if (!preview) return
    const timer = setTimeout(() => { setPreview(null); setNotice('The static preview expired. Request a fresh snapshot to continue.') }, Math.max(0, preview.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [preview])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || running) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, running])
  return { status, listing, search, file, draft, setDraft, dirty, approvals, reviewing, setReviewing, runs, terminal, terminalOutcome, terminalVersion, taskId, running, busy, deciding,
    error, clearError: () => setError(''), notice, recall, recallExpired, memoryIds, setMemoryIds, preview, open, close, list, findFiles, selectFile, newFile, saveFile, setPermissions, reviewFile, reviewCommand, runCommand, send, newSession, decide, stop,
    refresh, recallMemory, clearRecall, reviewCheckpoint, createPreview, closePreview }
}
