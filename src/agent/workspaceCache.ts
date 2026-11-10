import type { CacheStorage } from './clientSafety.ts'
import { browserStorage, scopedCacheKey } from './clientSafety.ts'
import { SESSION_KEY } from './sessionStore.ts'
import { PROJECT_KEY } from './project.ts'
import { PREFERENCES_KEY } from './workspacePreferences.ts'

const CACHE_BASES = [SESSION_KEY, PROJECT_KEY, PREFERENCES_KEY]

export interface WorkspaceCache {
  scope: string
  readonly active: boolean
  storage: CacheStorage | null
  revoke: () => boolean
}

export function workspaceCacheScope(agentId: string, sessionTag: string) {
  if (!/^[a-f0-9]{32}$/.test(sessionTag)) throw new Error('Invalid browser cache session.')
  const scope = `${agentId}.${sessionTag}`
  scopedCacheKey(SESSION_KEY, scope)
  return scope
}

// The lease is captured by every autosave and exit callback. Revoking it before
// unmount both deletes this session's cache and prevents old callbacks restoring it.
export function createWorkspaceCache(agentId: string, sessionTag: string, storage: CacheStorage | null = browserStorage()): WorkspaceCache {
  const scope = workspaceCacheScope(agentId, sessionTag)
  const keys = new Set(CACHE_BASES.map(base => scopedCacheKey(base, scope)))
  let active = true
  const lease: CacheStorage | null = storage ? {
    getItem(key) { return active && keys.has(key) ? storage.getItem(key) : null },
    setItem(key, value) {
      if (!active || !keys.has(key)) throw new Error('This browser workspace cache has ended.')
      storage.setItem(key, value)
    },
    removeItem(key) { if (keys.has(key)) storage.removeItem(key) },
  } : null
  return { scope, get active() { return active }, storage: lease, revoke() {
    active = false
    let cleared = true
    for (const key of keys) {
      try { storage?.removeItem(key) } catch { cleared = false }
    }
    return cleared
  } }
}

interface IndexableStorage extends CacheStorage { readonly length: number; key(index: number): string | null }
export function clearInactiveWorkspaceCaches(activeScope: string | null, storage: CacheStorage | null = browserStorage()) {
  const indexed = storage as IndexableStorage | null
  const keys: string[] = []
  const keep = new Set(activeScope ? CACHE_BASES.map(base => scopedCacheKey(base, activeScope)) : [])
  let failed = false
  try {
    if (indexed && typeof indexed.key === 'function') {
      for (let i = 0; i < indexed.length; i++) {
        const key = indexed.key(i)
        // Only new login-tagged tab caches, never old persistent/user caches.
        if (key && CACHE_BASES.some(base => key.startsWith(`${base}:`))
          && /\.[a-f0-9]{32}$/.test(key) && !keep.has(key)) keys.push(key)
      }
    }
  } catch { failed = true }
  let removed = 0
  for (const key of keys) { try { indexed?.removeItem(key); removed++ } catch { failed = true } }
  return { removed, failed }
}

function persistentStorage(): IndexableStorage | null {
  try { return globalThis.localStorage || null } catch { return null }
}
const LEGACY_BASES = ['recallloop.sessions.v1', SESSION_KEY, PROJECT_KEY]

export function legacyWorkspaceCacheKeys(storage: IndexableStorage | null = persistentStorage()) {
  const keys: string[] = []
  try {
    for (let i = 0; storage && i < storage.length; i++) {
      const key = storage.key(i)
      if (key && LEGACY_BASES.some(base => key === base || key.startsWith(`${base}:`))) keys.push(key)
    }
  } catch { /* blocked browser storage; never inspect cache contents */ }
  return keys
}

// Explicit user action only. Never migrate old plaintext caches into a login,
// and never clear theme preferences or unrelated application storage.
export function clearLegacyWorkspaceCaches(storage: IndexableStorage | null = persistentStorage()) {
  let removed = 0, failed = false
  for (const key of legacyWorkspaceCacheKeys(storage)) {
    try { storage?.removeItem(key); removed++ } catch { failed = true }
  }
  return { removed, failed }
}
