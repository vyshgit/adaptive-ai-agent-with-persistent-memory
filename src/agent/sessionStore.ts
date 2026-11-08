import type { Session, ChatMessage, MemoryContext, Proposal } from './types.ts'
import type { CacheStorage } from './clientSafety.ts'
import { browserStorage, newId, redactBrowserText, redactBrowserValue, scopedCacheKey } from './clientSafety.ts'
import { validFilePath } from './project.ts'

export const SESSION_KEY = 'recallloop.sessions.v2'
export const MAX_SESSIONS = 50
export const MAX_MESSAGES = 200
const MAX_CACHE_CHARS = 2_000_000

export function createSession(model?: string): Session {
  const now = new Date().toISOString()
  return { id: newId(), title: 'New session', createdAt: now, updatedAt: now, model, messages: [] }
}

function safeMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const item = redactBrowserValue(raw) as Partial<ChatMessage>
  if (typeof item.id !== 'string' || !['user', 'assistant'].includes(item.role || '') || typeof item.content !== 'string' || typeof item.createdAt !== 'string') return null
  const memory: MemoryContext | undefined = item.memory && Array.isArray(item.memory.memories) ? {
    // Cache citation metadata only. Recall text is re-fetched from Walrus for each turn.
    memories: item.memory.memories.filter(hit => hit && typeof hit.blobId === 'string' && Number.isFinite(hit.distance)).slice(0, 20)
      .map(hit => ({ blobId: hit.blobId.slice(0, 160), text: '', distance: hit.distance, tier: hit.tier })),
    tokenEstimate: Number(item.memory.tokenEstimate) || 0,
    strategy: item.memory.strategy,
    memoryUnavailable: item.memory.memoryUnavailable === true,
  } : undefined
  const proposals: Proposal[] = (Array.isArray(item.proposals) ? item.proposals : []).filter(proposal => proposal && typeof proposal.id === 'string'
    && typeof proposal.path === 'string' && validFilePath(proposal.path) && typeof proposal.after === 'string'
    && proposal.after.length <= 20_000 && (proposal.before === null || (typeof proposal.before === 'string' && proposal.before.length <= 20_000)))
    .slice(0, 6).map(proposal => ({ id: proposal.id, path: proposal.path, before: proposal.before === null ? null : redactBrowserText(proposal.before.slice(0, 20_000)),
      after: redactBrowserText(proposal.after.slice(0, 20_000)), reason: redactBrowserText(String(proposal.reason || '').slice(0, 1000)),
      baseHash: String(proposal.baseHash || ''), status: ['applied', 'rejected'].includes(proposal.status) ? proposal.status : 'pending' }))
  return { id: item.id.slice(0, 128), role: item.role as 'user' | 'assistant', content: redactBrowserText(item.content.slice(0, 40_000)),
    createdAt: item.createdAt, model: typeof item.model === 'string' ? item.model.slice(0, 128) : undefined,
    status: ['complete', 'stopped', 'error'].includes(item.status || '') ? item.status! : 'stopped', memory, proposals,
    tools: Array.isArray(item.tools) ? item.tools.filter(tool => tool && typeof tool.id === 'string' && typeof tool.name === 'string'
      && ['running', 'done', 'error'].includes(tool.status)).slice(0, 12).map(tool => ({ id: tool.id.slice(0, 128), name: tool.name.slice(0, 64),
      status: tool.status === 'running' ? 'error' : tool.status, preview: redactBrowserText(String(tool.preview || '').slice(0, 500)) })) : [],
    stored: item.stored ? { verbatim: Number(item.stored.verbatim) || 0, facts: Number(item.stored.facts) || 0, failed: Number(item.stored.failed) || 0,
      blobs: Array.isArray(item.stored.blobs) ? item.stored.blobs.filter(blob => blob && typeof blob.blobId === 'string'
        && typeof blob.namespace === 'string').slice(0, 100).map(blob => ({ blobId: blob.blobId.slice(0, 160), namespace: blob.namespace.slice(0, 128), tier: blob.tier })) : [],
      pending: item.stored.pending, skipped: item.stored.skipped, message: redactBrowserText(String(item.stored.message || '').slice(0, 500)) } : undefined,
    error: typeof item.error === 'string' ? redactBrowserText(item.error.slice(0, 1000)) : undefined, retryable: item.retryable === true }
}

export function normaliseSessions(raw: unknown): Session[] {
  if (!Array.isArray(raw)) return []
  const ids = new Set<string>()
  const sessions: Session[] = []
  for (const item of raw) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || !Array.isArray(item.messages)
      || typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string') continue
    ids.add(item.id)
    const clean = redactBrowserValue(item)
    sessions.push({ id: clean.id.slice(0, 128), title: String(clean.title || 'New session').slice(0, 60),
      createdAt: clean.createdAt, updatedAt: clean.updatedAt, model: typeof clean.model === 'string' ? clean.model.slice(0, 128) : undefined,
      messages: clean.messages.slice(-MAX_MESSAGES).map(safeMessage).filter((message: ChatMessage | null): message is ChatMessage => Boolean(message)) })
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_SESSIONS)
}

export function loadSessions(storage: CacheStorage | null = browserStorage(), scope = 'offline'): { sessions: Session[]; warning?: string } {
  if (!storage) return { sessions: [], warning: 'Browser storage is unavailable. Sessions will last only while this page is open.' }
  try {
    const value = storage.getItem(scopedCacheKey(SESSION_KEY, scope))
    if (!value) return { sessions: [] }
    if (value.length > MAX_CACHE_CHARS + 100_000) throw new Error('oversized cache')
    const parsed = JSON.parse(value)
    if (parsed?.version !== 2 || !Array.isArray(parsed.sessions)) throw new Error('unknown cache version')
    return { sessions: normaliseSessions(parsed.sessions) }
  } catch {
    try { storage.removeItem(scopedCacheKey(SESSION_KEY, scope)) } catch { /* restricted storage */ }
    return { sessions: [], warning: 'The local conversation cache was unreadable and has been reset. Walrus memories are untouched.' }
  }
}

export function saveSessions(sessions: Session[], storage: CacheStorage | null = browserStorage(), scope = 'offline') {
  if (!storage) return false
  const safe = normaliseSessions(sessions)
  let value = JSON.stringify({ version: 2, sessions: safe })
  // Prune oldest cache entries, never remote memories. Bound quota use as well as item counts.
  while (value.length > MAX_CACHE_CHARS && safe.length) {
    const oldest = safe.at(-1)!
    if (oldest.messages.length > 2) oldest.messages.splice(0, 2)
    else safe.pop()
    value = JSON.stringify({ version: 2, sessions: safe })
  }
  try { storage.setItem(scopedCacheKey(SESSION_KEY, scope), value); return true } catch { return false }
}

export function clearSessionCache(storage: CacheStorage | null = browserStorage(), scope = 'offline') {
  try { storage?.removeItem(scopedCacheKey(SESSION_KEY, scope)); return true } catch { return false }
}
