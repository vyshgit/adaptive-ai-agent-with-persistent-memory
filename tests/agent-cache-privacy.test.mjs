import test from 'node:test'
import assert from 'node:assert/strict'
import { browserStorage, scopedCacheKey, flushCacheOnExit } from '../src/agent/clientSafety.ts'
import { createWorkspaceCache, workspaceCacheScope, clearInactiveWorkspaceCaches, legacyWorkspaceCacheKeys, clearLegacyWorkspaceCaches } from '../src/agent/workspaceCache.ts'
import { createSession, loadSessions, saveSessions, SESSION_KEY } from '../src/agent/sessionStore.ts'
import { loadProject, saveProject, starterProject, PROJECT_KEY } from '../src/agent/project.ts'
import { walletAgentId } from '../server/agent/wallet-auth.mjs'

function storage() {
  const data = new Map()
  return { data, get length() { return data.size }, key: index => [...data.keys()][index] || null,
    getItem: key => data.get(key) || null, setItem: (key, value) => { data.set(key, value) }, removeItem: key => { data.delete(key) } }
}
const a = walletAgentId('0xa'), b = walletAgentId('0xb'), tagA = 'a'.repeat(32), tagB = 'b'.repeat(32)

test('default browser caches use tab session storage and never load persistent localStorage content', t => {
  const descriptors = Object.fromEntries(['sessionStorage', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  t.after(() => { for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } })
  const tab = storage(), persistent = storage(), scope = workspaceCacheScope(a, tagA)
  const project = starterProject(true)
  project.files[0].content = 'OLD_PERSISTENT_PRIVATE_PROJECT'
  saveProject(project, persistent, scope)
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: tab })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: persistent })
  assert.equal(browserStorage(), tab)
  assert.equal(loadProject(undefined, scope, true).files[0].content.includes('OLD_PERSISTENT'), false)
  assert.equal(saveProject(starterProject(true), undefined, scope), true)
  assert.equal(tab.data.size, 1)
  assert.equal(persistent.data.size, 1)
  assert.match(persistent.getItem(scopedCacheKey(PROJECT_KEY, scope)), /OLD_PERSISTENT/)
})

test('workspace leases are wallet/login-scoped, reloadable in the same login, and cannot read or write another scope', () => {
  const tab = storage(), cache = createWorkspaceCache(a, tagA, tab)
  const session = createSession(), project = starterProject(true)
  session.title = 'USER_A_PRIVATE_CHAT'
  project.files[0].content = 'USER_A_PRIVATE_PROJECT'
  assert.equal(saveSessions([session], cache.storage, cache.scope), true)
  assert.equal(saveProject(project, cache.storage, cache.scope), true)
  const reload = createWorkspaceCache(a, tagA, tab)
  assert.equal(loadSessions(reload.storage, reload.scope).sessions[0].title, 'USER_A_PRIVATE_CHAT')
  assert.equal(loadProject(reload.storage, reload.scope).files[0].content, 'USER_A_PRIVATE_PROJECT')
  for (const next of [createWorkspaceCache(a, tagB, tab), createWorkspaceCache(b, tagA, tab)]) {
    assert.equal(loadSessions(next.storage, next.scope).sessions.length, 0)
    assert.equal(loadProject(next.storage, next.scope, true).files[0].content.includes('USER_A_PRIVATE'), false)
    assert.equal(next.storage.getItem(scopedCacheKey(SESSION_KEY, cache.scope)), null)
    assert.throws(() => next.storage.setItem(scopedCacheKey(PROJECT_KEY, cache.scope), 'FORGED_WRITE'))
  }
  assert.equal(cache.scope.length, 80)
  for (const tag of ['', 'old-tab', 'x'.repeat(32), 'a'.repeat(33)]) assert.throws(() => workspaceCacheScope(a, tag))
})

test('logout revocation wins over pending autosave, pagehide, hidden visibility, and React teardown flushing', () => {
  const tab = storage(), cache = createWorkspaceCache(a, tagA, tab), other = createWorkspaceCache(b, tagB, tab)
  const page = new EventTarget(), visibility = Object.assign(new EventTarget(), { visibilityState: 'hidden' })
  const session = createSession(), project = starterProject(true)
  session.title = 'PRIVATE_BEFORE_LOGOUT'
  project.files[0].content = 'PRIVATE_BEFORE_LOGOUT'
  const lateAutosave = () => { saveSessions([session], cache.storage, cache.scope); saveProject(project, cache.storage, cache.scope) }
  const unmount = flushCacheOnExit(lateAutosave, page, visibility)
  lateAutosave()
  saveProject(starterProject(true), other.storage, other.scope)
  assert.equal(cache.revoke(), true)
  assert.equal(cache.active, false)
  session.title = 'MUST_NOT_RESURRECT'
  project.files[0].content = 'MUST_NOT_RESURRECT'
  lateAutosave()
  page.dispatchEvent(new Event('pagehide'))
  visibility.dispatchEvent(new Event('visibilitychange'))
  unmount()
  assert.equal(tab.getItem(scopedCacheKey(SESSION_KEY, cache.scope)), null)
  assert.equal(tab.getItem(scopedCacheKey(PROJECT_KEY, cache.scope)), null)
  assert.equal(loadSessions(cache.storage, cache.scope).sessions.length, 0)
  assert.ok(tab.getItem(scopedCacheKey(PROJECT_KEY, other.scope)))
  assert.equal(cache.revoke(), true, 'revocation is idempotent')
})

test('expired or changed logins prune only inactive login-tagged caches, including after a reload', () => {
  const tab = storage(), cache = createWorkspaceCache(a, tagA, tab), next = createWorkspaceCache(b, tagB, tab)
  saveProject(starterProject(true), cache.storage, cache.scope)
  saveSessions([createSession()], cache.storage, cache.scope)
  saveProject(starterProject(true), next.storage, next.scope)
  tab.setItem('recallloop.theme', 'dark')
  tab.setItem(`${SESSION_KEY}:old-wallet-cache`, 'OLDER_CACHE_NOT_AUTO_MIGRATED')
  tab.setItem(`unrelated.app:${cache.scope}`, 'UNRELATED_DATA')
  assert.deepEqual(clearInactiveWorkspaceCaches(next.scope, tab), { removed: 2, failed: false })
  assert.ok(tab.getItem(scopedCacheKey(PROJECT_KEY, next.scope)))
  assert.deepEqual(clearInactiveWorkspaceCaches(null, tab), { removed: 1, failed: false })
  assert.equal(tab.getItem('recallloop.theme'), 'dark')
  assert.equal(tab.data.size, 3)
})

test('explicit legacy cleanup inspects names only and leaves current tab work, theme, and unrelated data alone', () => {
  const persistent = storage(), tab = storage(), cache = createWorkspaceCache(a, tagA, tab)
  for (const key of [SESSION_KEY, `${SESSION_KEY}:wallet-old`, 'recallloop.sessions.v1', `${PROJECT_KEY}:wallet-old`]) persistent.setItem(key, 'PRIVATE_OLD_CONTENT')
  persistent.setItem('recallloop.theme', 'light')
  persistent.setItem('another-app.private-data', 'UNRELATED_PRIVATE_CONTENT')
  persistent.getItem = () => assert.fail('Cleanup must never inspect old cache content')
  saveProject(starterProject(true), cache.storage, cache.scope)
  assert.equal(legacyWorkspaceCacheKeys(persistent).length, 4)
  assert.deepEqual(clearLegacyWorkspaceCaches(persistent), { removed: 4, failed: false })
  assert.deepEqual([...persistent.data.keys()], ['recallloop.theme', 'another-app.private-data'])
  assert.equal(tab.data.size, 1)
})

test('blocked cache removal reports failure but never re-enables a revoked storage lease', () => {
  const cache = createWorkspaceCache(a, tagA, { getItem: () => null, setItem() { assert.fail('No writes after logout') }, removeItem() { throw new Error('blocked') } })
  assert.equal(cache.revoke(), false)
  assert.equal(cache.active, false)
  assert.equal(saveSessions([createSession()], cache.storage, cache.scope), false)
  assert.equal(saveProject(starterProject(true), cache.storage, cache.scope), false)
  const persistent = storage()
  persistent.setItem(SESSION_KEY, 'private')
  persistent.removeItem = () => { throw new Error('blocked') }
  assert.deepEqual(clearLegacyWorkspaceCaches(persistent), { removed: 0, failed: true })
})

test('reloaded capture outcomes retain validated status metadata and reject forged flags or counters', () => {
  const tab = storage(), cache = createWorkspaceCache(a, tagA, tab), session = createSession()
  session.messages = [
    { id: 'duplicate', role: 'assistant', content: 'Complete.', createdAt: session.createdAt, status: 'complete', stored: { facts: 1, verbatim: 0, failed: 0, blobs: [], deduplicated: true } },
    { id: 'unavailable', role: 'assistant', content: 'Complete.', createdAt: session.createdAt, status: 'complete', stored: { facts: 0, verbatim: 0, failed: 1, blobs: [], code: 'capture_unavailable' } },
    { id: 'irrelevant', role: 'assistant', content: 'Complete.', createdAt: session.createdAt, status: 'complete', stored: { facts: 0, verbatim: 0, failed: 0, blobs: [], skipped: true, reason: 'no_context' } },
    { id: 'forged', role: 'assistant', content: 'Complete.', createdAt: session.createdAt, status: 'complete', stored: { facts: -1, verbatim: '3', failed: Infinity, blobs: [], skipped: 'true', pending: {}, deduplicated: 'true', reason: 'untrusted', code: 'untrusted' } },
  ]
  saveSessions([session], cache.storage, cache.scope)
  const messages = loadSessions(cache.storage, cache.scope).sessions[0].messages
  assert.equal(messages[0].stored.deduplicated, true)
  assert.equal(messages[1].stored.code, 'capture_unavailable')
  assert.equal(messages[2].stored.reason, 'no_context')
  assert.equal(messages[2].stored.skipped, true)
  const forged = messages[3].stored
  for (const count of ['facts', 'verbatim', 'failed']) assert.equal(forged[count], 0)
  for (const flag of ['skipped', 'pending', 'deduplicated']) assert.equal(forged[flag], false)
  assert.equal(forged.reason, undefined)
  assert.equal(forged.code, undefined)
})
