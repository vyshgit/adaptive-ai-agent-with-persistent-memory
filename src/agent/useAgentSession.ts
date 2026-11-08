import { useEffect, useRef, useState } from 'react'
import type { Session, ChatMessage, Project, Phase, AgentEvent, StoredCapture, WorkspaceMode } from './types.ts'
import { createSession, loadSessions, saveSessions, clearSessionCache, MAX_SESSIONS, MAX_MESSAGES } from './sessionStore.ts'
import { newId, redactBrowserText, flushCacheOnExit } from './clientSafety.ts'
import { agentFetch, readAgentSse, responseError } from './api.ts'
import { selectedProject } from './project.ts'

interface SendOptions { model: string; project: Project; capture: boolean; stream: boolean; mode: WorkspaceMode }

export function useAgentSession(onStored: () => void, scope = 'offline') {
  const [initial] = useState(() => loadSessions(undefined, scope))
  const [sessions, setSessions] = useState<Session[]>(() => initial.sessions.length ? initial.sessions : [createSession()])
  const [activeId, setActiveId] = useState(() => sessions[0].id)
  const [phase, setPhase] = useState<Phase>('idle')
  const [cacheWarning, setCacheWarning] = useState(initial.warning || '')
  const request = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const current = useRef(sessions)
  current.current = sessions
  const storedCallback = useRef(onStored)
  storedCallback.current = onStored

  useEffect(() => {
    const timer = setTimeout(() => { if (!saveSessions(sessions, undefined, scope)) setCacheWarning('Local cache could not be saved. Keep this tab open or export your work. Walrus memories are unaffected.') }, 350)
    return () => clearTimeout(timer)
  }, [sessions, scope])
  useEffect(() => {
    mounted.current = true
    const unbind = flushCacheOnExit(() => { saveSessions(current.current, undefined, scope) })
    return () => { mounted.current = false; request.current?.abort(); unbind() }
  }, [scope])

  function updateSession(id: string, update: (session: Session) => Session) {
    if (!mounted.current) return
    setSessions(previous => previous.map(session => session.id === id ? update(session) : session).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  }
  function updateMessage(sessionId: string, messageId: string, update: (message: ChatMessage) => ChatMessage) {
    updateSession(sessionId, session => ({ ...session, messages: session.messages.map(message => message.id === messageId ? update(message) : message) }))
  }

  async function send(text: string, options: SendOptions, retryUserId?: string) {
    if (request.current || !text.trim() || text.length > 4000) return
    const session = current.current.find(session => session.id === activeId)
    if (!session) return
    const sessionId = session.id
    const controller = new AbortController()
    request.current = controller
    setPhase('recalling')
    const content = redactBrowserText(text.trim())
    const now = new Date().toISOString()
    const userIndex = retryUserId ? session.messages.findIndex(message => message.id === retryUserId && message.role === 'user') : -1
    const user = userIndex >= 0 ? session.messages[userIndex] : { id: newId(), role: 'user' as const, content, createdAt: now, status: 'complete' as const }
    const history = (userIndex >= 0 ? session.messages.slice(0, userIndex) : session.messages)
      .filter(message => message.status === 'complete' && message.content.trim()).slice(-20)
      .map(message => ({ role: message.role, content: message.content.slice(0, 20_000) }))
    const assistantId = newId()
    const assistant: ChatMessage = { id: assistantId, role: 'assistant', content: '', createdAt: now, status: 'pending', model: options.model, tools: [], proposals: [] }
    updateSession(sessionId, old => ({ ...old, updatedAt: now, model: options.model,
      title: old.messages.some(message => message.role === 'user') ? old.title : content.slice(0, 60),
      messages: [...old.messages, ...(userIndex >= 0 ? [] : [user]), assistant].slice(-MAX_MESSAGES) }))
    let done = false, captured = false
    function event(type: string, raw: unknown) {
      if (!mounted.current || controller.signal.aborted) return
      const incoming = { type, data: raw } as AgentEvent
      if (incoming.type === 'memory') {
        updateMessage(sessionId, assistantId, old => ({ ...old, memory: incoming.data, status: 'streaming' }))
        setPhase('thinking')
      }
      if (incoming.type === 'delta' && typeof incoming.data.text === 'string') {
        updateMessage(sessionId, assistantId, old => ({ ...old, content: (old.content + incoming.data.text).slice(0, 40_000), status: 'streaming' }))
        setPhase('thinking')
      }
      if (incoming.type === 'tool') {
        const tool = incoming.data
        updateMessage(sessionId, assistantId, old => ({ ...old, tools: [...(old.tools || []).filter(item => item.id !== tool.id), tool] }))
        setPhase('tools')
      }
      if (incoming.type === 'proposal') updateMessage(sessionId, assistantId, old => ({ ...old, proposals: [...(old.proposals || []), incoming.data].slice(0, 6) }))
      if (incoming.type === 'done') {
        done = true
        updateMessage(sessionId, assistantId, old => ({ ...old, status: 'complete', model: incoming.data.model }))
        setPhase('storing')
      }
      if (incoming.type === 'stored') {
        captured = true
        updateMessage(sessionId, assistantId, old => ({ ...old, stored: incoming.data }))
        storedCallback.current()
      }
      if (incoming.type === 'error') throw Object.assign(new Error(incoming.data.message), { retryable: incoming.data.retryable })
    }
    try {
      const response = await agentFetch('/chat', { method: 'POST', signal: controller.signal,
        body: JSON.stringify({ sessionId, message: user.content, occurredAt: user.createdAt, history,
          model: options.model, mode: options.mode, project: selectedProject(options.project), capture: options.capture, stream: options.stream }) })
      if (!response.ok) throw await responseError(response)
      if (response.headers.get('content-type')?.includes('text/event-stream')) await readAgentSse(response, event, controller.signal)
      else {
        const data = await response.json()
        if (data.memory) event('memory', data.memory)
        for (const tool of data.tools || []) event('tool', tool)
        for (const proposal of data.proposals || []) event('proposal', proposal)
        event('delta', { text: data.answer || '' })
        event('done', { model: data.model, finishReason: data.finishReason })
        if (data.stored) event('stored', data.stored)
      }
      if (!done) throw new Error('The stream ended before the answer completed. Your partial answer is preserved.')
      if (!captured) updateMessage(sessionId, assistantId, old => ({ ...old, stored: pendingCapture('The connection closed before capture was confirmed. Refresh memory inventory before retrying.') }))
    } catch (error) {
      if (done) updateMessage(sessionId, assistantId, old => ({ ...old, status: 'complete', stored: old.stored || pendingCapture('Capture confirmation was interrupted. Accepted writes may still complete; refresh inventory.') }))
      else updateMessage(sessionId, assistantId, old => ({ ...old, status: controller.signal.aborted ? 'stopped' : 'error',
        error: controller.signal.aborted ? undefined : redactBrowserText(error instanceof Error ? error.message : 'The request failed.'),
        retryable: !controller.signal.aborted && (error as { retryable?: boolean }).retryable !== false,
        tools: old.tools?.map(tool => tool.status === 'running' ? { ...tool, status: 'error', preview: 'Interrupted; result not confirmed.' } : tool) }))
    } finally {
      if (request.current === controller) request.current = null
      if (mounted.current) setPhase('idle')
    }
  }

  function newSession() {
    if (request.current) return
    const session = createSession()
    setSessions(old => [session, ...old].slice(0, MAX_SESSIONS))
    setActiveId(session.id)
  }
  function selectSession(id: string) { if (!request.current) setActiveId(id) }
  function renameSession(id: string, title: string) {
    if (title.trim()) updateSession(id, old => ({ ...old, title: redactBrowserText(title.trim()).slice(0, 60), updatedAt: new Date().toISOString() }))
  }
  function deleteSession(id: string) {
    if (request.current) return
    const remaining = current.current.filter(session => session.id !== id)
    if (!remaining.length) remaining.push(createSession())
    setSessions(remaining)
    if (activeId === id) setActiveId(remaining[0].id)
  }
  function clearCache() {
    if (request.current) return
    clearSessionCache(undefined, scope)
    const session = createSession()
    setSessions([session]); setActiveId(session.id)
  }
  function reviewProposal(id: string, status: 'applied' | 'rejected') {
    updateSession(activeId, old => ({ ...old, updatedAt: new Date().toISOString(), messages: old.messages.map(message => ({ ...message,
      proposals: message.proposals?.map(proposal => proposal.id === id ? { ...proposal, status } : proposal) })) }))
  }
  const activeSession = sessions.find(session => session.id === activeId) || sessions[0]
  return { sessions, activeSession, busy: phase !== 'idle', phase, cacheWarning, send, stop: () => request.current?.abort(),
    newSession, selectSession, renameSession, deleteSession, clearCache, reviewProposal }
}

function pendingCapture(message: string): StoredCapture { return { verbatim: 0, facts: 0, failed: 0, blobs: [], pending: true, message } }
