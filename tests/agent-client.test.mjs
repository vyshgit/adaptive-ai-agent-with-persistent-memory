import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { registerBrowserSecret, clearBrowserSecrets, redactBrowserText, scopedCacheKey, flushCacheOnExit } from '../src/agent/clientSafety.ts'
import { createSession, normaliseSessions, loadSessions, saveSessions, clearSessionCache, SESSION_KEY, MAX_SESSIONS, MAX_MESSAGES } from '../src/agent/sessionStore.ts'
import { starterProject, normaliseProject, loadProject, saveProject, selectedProject, validFilePath, importTextFiles, applyProposal, PROJECT_KEY } from '../src/agent/project.ts'
import { agentFetch, agentJson, readAgentSse, responseError, resetSessionSecrets, setSessionTag, setWorkspaceToken } from '../src/agent/api.ts'

function storage() {
  const data = new Map()
  return { data, getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
}
const message = overrides => ({ id: 'message-one', role: 'assistant', content: 'A response', createdAt: '2026-11-08T10:00:00Z', status: 'complete', ...overrides })
const proposal = overrides => ({ id: 'proposal-one', path: 'src/greet.ts', before: starterProject().files[0].content,
  after: 'export const greeting = "Hello"\n', reason: 'Synthetic test change', baseHash: 'test-hash', status: 'pending', ...overrides })

test('browser session/project caches are wallet-scoped and do not migrate an unscoped cache into a wallet', t => {
  t.after(clearBrowserSecrets)
  const cache = storage(), session = createSession()
  session.messages.push(message())
  assert.equal(saveSessions([session], cache, 'wallet-first'), true)
  assert.equal(saveProject(starterProject(), cache, 'wallet-first'), true)
  assert.equal(loadSessions(cache, 'wallet-first').sessions.length, 1)
  assert.equal(loadSessions(cache, 'wallet-second').sessions.length, 0)
  cache.setItem(SESSION_KEY, JSON.stringify({ version: 2, sessions: [session] }))
  assert.equal(loadSessions(cache, 'wallet-second').sessions.length, 0)
  assert.equal(clearSessionCache(cache, 'wallet-first'), true)
  assert.ok(cache.getItem(scopedCacheKey(PROJECT_KEY, 'wallet-first')), 'clearing history must not clear the browser project')
  assert.ok(cache.getItem(SESSION_KEY), 'an unrelated cache must not be removed')
  for (const scope of ['', '../wallet', 'wallet:other', 'x'.repeat(81)]) assert.throws(() => scopedCacheKey(SESSION_KEY, scope), /identity/)
})

test('browser cache lifecycle flushes latest snapshots on pagehide, hidden visibility and unmount, then removes listeners', () => {
  const page = new EventTarget(), visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const flushed = []
  let latest = 'initial'
  const unbind = flushCacheOnExit(() => { flushed.push(latest) }, page, visibility)
  latest = 'before reload'
  page.dispatchEvent(new Event('pagehide'))
  visibility.dispatchEvent(new Event('visibilitychange'))
  assert.deepEqual(flushed, ['before reload'], 'visible transitions must not force extra saves')
  latest = 'before background'
  visibility.visibilityState = 'hidden'
  visibility.dispatchEvent(new Event('visibilitychange'))
  latest = 'before unmount'
  unbind()
  assert.deepEqual(flushed, ['before reload', 'before background', 'before unmount'])
  page.dispatchEvent(new Event('pagehide'))
  visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(flushed.length, 3, 'disposed workspaces must not keep cache-exit listeners')
})

test('cache-exit flushing preserves redaction and wallet scopes without reviving disposed workspace snapshots', t => {
  t.after(clearBrowserSecrets)
  const page = new EventTarget(), visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const cache = storage(), key = 'synthetic-cache-exit-secret-value'
  registerBrowserSecret(key)
  const firstProject = starterProject(), firstSession = createSession()
  firstProject.files[0].content = key
  firstSession.messages = [message({ content: key })]
  const closeFirst = flushCacheOnExit(() => {
    saveProject(firstProject, cache, 'wallet-first')
    saveSessions([firstSession], cache, 'wallet-first')
  }, page, visibility)
  closeFirst() // Flush before WalletGate clears the previous wallet's redaction set.
  const firstProjectKey = scopedCacheKey(PROJECT_KEY, 'wallet-first')
  const firstSessionKey = scopedCacheKey(SESSION_KEY, 'wallet-first')
  const savedProject = cache.getItem(firstProjectKey), savedSession = cache.getItem(firstSessionKey)
  assert.equal(savedProject.includes(key), false)
  assert.equal(savedSession.includes(key), false)
  assert.ok(savedProject.includes('[REDACTED]'))
  assert.ok(savedSession.includes('[REDACTED]'))
  clearBrowserSecrets()
  firstProject.files[0].content = 'A disposed wallet must not save this later change.'
  const secondProject = starterProject(), secondSession = createSession()
  secondProject.files[0].content = 'Second wallet only.'
  const closeSecond = flushCacheOnExit(() => {
    saveProject(secondProject, cache, 'wallet-second')
    saveSessions([secondSession], cache, 'wallet-second')
  }, page, visibility)
  page.dispatchEvent(new Event('pagehide'))
  assert.equal(loadProject(cache, 'wallet-second').files[0].content, 'Second wallet only.')
  assert.equal(cache.getItem(firstProjectKey), savedProject)
  assert.equal(cache.getItem(firstSessionKey), savedSession)
  closeSecond()
})

test('browser caches redact credentials in content and metadata before truncation and exclude recalled text', t => {
  t.after(clearBrowserSecrets)
  const key = 'synthetic-secret-key-for-cache-tests'
  registerBrowserSecret(key)
  const cache = storage(), session = createSession()
  session.title = `${'t'.repeat(55)}${key}`
  session.model = key
  session.messages = [message({ content: key, model: key, error: key,
    memory: { context: `never cache this recalled context ${key}`, tokenEstimate: 12, memories: [{ blobId: key, text: 'private recalled memory', distance: 0.2 }] },
    tools: [{ id: key, name: key, status: 'running', preview: key }],
    stored: { verbatim: 2, facts: 1, failed: 0, message: key, blobs: [{ blobId: key, namespace: key, tier: 'facts' }] },
    proposals: [proposal({ reason: key, before: key, after: key }), proposal({ path: `${key}.ts` })],
  })]
  assert.equal(saveSessions([session], cache, 'wallet-first'), true)
  const raw = cache.getItem(scopedCacheKey(SESSION_KEY, 'wallet-first'))
  assert.equal(raw.includes(key), false)
  assert.equal(raw.includes('private recalled memory'), false)
  assert.equal(raw.includes('never cache this recalled context'), false)
  assert.equal(loadSessions(cache, 'wallet-first').sessions[0].title, `${'t'.repeat(55)}[REDA`)
  const restored = loadSessions(cache, 'wallet-first').sessions[0].messages[0]
  assert.equal(restored.tools[0].status, 'error')
  assert.equal(restored.proposals.length, 1)
  assert.equal(restored.proposals[0].after, '[REDACTED]')
  assert.equal(restored.memory.memories[0].text, '')
  const project = starterProject()
  project.name = `${'n'.repeat(75)}${key}`
  project.files[0].content = key
  assert.equal(saveProject(project, cache, 'wallet-first'), true)
  const exported = JSON.stringify(normaliseProject(project))
  assert.equal(exported.includes(key), false)
  assert.equal(loadProject(cache, 'wallet-first').name, `${'n'.repeat(75)}[REDA`)
  assert.equal(JSON.stringify(selectedProject(project)).includes(key), false)
})

test('corrupt, oversized and unsupported-version browser caches reset without crashing or touching other wallets', () => {
  const cache = storage(), key = scopedCacheKey(SESSION_KEY, 'wallet-first')
  cache.setItem(scopedCacheKey(SESSION_KEY, 'wallet-other'), 'leave-this-alone')
  for (const raw of ['{broken', JSON.stringify({ version: 1, sessions: [] }), 'x'.repeat(2_100_001)]) {
    cache.setItem(key, raw)
    const loaded = loadSessions(cache, 'wallet-first')
    assert.equal(loaded.sessions.length, 0)
    assert.match(loaded.warning, /reset/)
    assert.equal(cache.getItem(key), null)
  }
  assert.equal(cache.getItem(scopedCacheKey(SESSION_KEY, 'wallet-other')), 'leave-this-alone')
  assert.match(loadSessions(null).warning, /unavailable/)
  assert.equal(saveSessions([], null), false)
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') }, removeItem() { throw new Error('blocked') } }
  assert.equal(loadSessions(blocked).sessions.length, 0)
  assert.equal(saveSessions([], blocked), false)
  assert.equal(saveProject(starterProject(), blocked), false)
  assert.equal(loadProject(blocked).name, 'RecallLoop sandbox')
})

test('session counts/messages/quota are bounded, interrupted messages are stopped, and malformed nested entries are ignored', () => {
  const sessions = Array.from({ length: 55 }, (_, i) => ({ ...createSession(), updatedAt: `2026-11-08T${String(i).padStart(2, '0')}:00:00Z`,
    messages: Array.from({ length: 205 }, (_, j) => message({ id: `message-${j}`, status: 'streaming' })) }))
  const bounded = normaliseSessions(sessions)
  assert.equal(bounded.length, MAX_SESSIONS)
  assert.equal(bounded[0].messages.length, MAX_MESSAGES)
  assert.equal(bounded[0].messages[0].status, 'stopped')
  const broken = createSession()
  broken.messages = [message({ proposals: {}, tools: [null, { id: 'bad' }], stored: { blobs: [null, {}, { blobId: 'ok', namespace: 'rl:wallet:facts' }] } })]
  const clean = normaliseSessions([null, broken])[0].messages[0]
  assert.deepEqual(clean.proposals, [])
  assert.deepEqual(clean.tools, [])
  assert.equal(clean.stored.blobs.length, 1)
  const cache = storage(), large = Array.from({ length: 2 }, () => ({ ...createSession(), messages: Array.from({ length: 40 }, (_, i) => message({ id: `large-${i}`, content: 'x'.repeat(40_000) })) }))
  assert.equal(saveSessions(large, cache, 'wallet-first'), true)
  assert.ok(cache.getItem(scopedCacheKey(SESSION_KEY, 'wallet-first')).length <= 2_000_000)
  assert.equal(large[1].messages.length, 40, 'quota pruning must not mutate live session objects')
})

test('project validation rejects traversal, secret files, duplicate paths, binary and oversized content', t => {
  t.after(clearBrowserSecrets)
  const paths = ['../file.ts', '/file.ts', 'src/../file.ts', '.git/config', 'node_modules/a.ts', '.ssh/key', '.aws/config',
    '.env', '.env.local', 'src/credentials.json', 'id_rsa', 'id_ed25519', 'certificate.pem', 'wallet.key', 'keystore.p12', 'wallet.pfx', ' src/a.ts', 'src/a.ts ']
  for (const path of paths) {
    assert.equal(validFilePath(path), false, path)
    assert.throws(() => normaliseProject({ files: [{ path, content: '' }] }), /unsafe/)
  }
  registerBrowserSecret('synthetic-filename-key')
  assert.equal(validFilePath('synthetic-filename-key.ts'), false)
  assert.equal(validFilePath('src/my file@v2+test.ts'), true)
  for (const files of [[{ path: 'a.ts', content: '\0binary' }], [{ path: 'a.ts', content: 'x'.repeat(20_001) }],
    [{ path: 'a.ts', content: '' }, { path: 'a.ts', content: '' }], Array.from({ length: 65 }, (_, i) => ({ path: `${i}.ts`, content: '' }))]) {
    assert.throws(() => normaliseProject({ files }), /files/)
  }
  assert.throws(() => normaliseProject({ files: Array.from({ length: 31 }, (_, i) => ({ path: `${i}.ts`, content: 'x'.repeat(20_000) })) }), /600,000/)
  const project = starterProject()
  project.files[0].selected = false
  assert.equal(selectedProject(project).files.some(file => file.path === 'src/greet.ts'), false)
})

test('text-file import preserves safe relative paths, skips binary/secret/oversized files, and round-trips export', async t => {
  t.after(clearBrowserSecrets)
  const key = 'synthetic-import-key'
  registerBrowserSecret(key)
  function file(name, content, relative) {
    const result = new File([content], name)
    if (relative) Object.defineProperty(result, 'webkitRelativePath', { value: relative })
    return result
  }
  const imported = await importTextFiles([
    file('a.ts', `export const text = '${key}'\n`, 'workspace/src/a.ts'),
    file('.env', key, 'workspace/.env'), file('binary.dat', new Uint8Array([0, 255]), 'workspace/binary.dat'),
    file('large.txt', 'x'.repeat(20_001), 'workspace/large.txt'), file('a.ts', 'duplicate', 'workspace/src/a.ts'),
  ])
  assert.equal(imported.project.name, 'workspace')
  assert.equal(imported.project.files[0].path, 'src/a.ts')
  assert.equal(imported.skipped.length, 4)
  assert.equal(JSON.stringify(imported.project).includes(key), false)
  assert.deepEqual(normaliseProject(JSON.parse(JSON.stringify(imported.project))), imported.project)
  const loose = await importTextFiles([file('loose.md', '# Safe text\n')])
  assert.equal(loose.project.files[0].path, 'loose.md')
})

test('proposal application is browser-only, requires an unchanged preimage, and rejects unsafe/oversized changes', () => {
  const project = starterProject(), change = proposal()
  const changed = applyProposal(project, change)
  assert.equal(changed.files[0].content, change.after)
  assert.notEqual(project.files[0].content, change.after)
  assert.equal(change.status, 'pending', 'review status is updated separately from project data')
  for (const invalid of [proposal({ status: 'applied' }), proposal({ before: 'stale content' }), proposal({ before: null }),
    proposal({ path: '../outside.ts' }), proposal({ path: '.env' }), proposal({ after: 'x'.repeat(20_001) })]) assert.throws(() => applyProposal(project, invalid))
  const created = applyProposal(project, proposal({ path: 'src/new.ts', before: null }))
  assert.equal(created.files.length, project.files.length + 1)
  assert.equal(created.activeFile, 'src/new.ts')
})

test('browser API binds the current session and keeps its operator token in memory through session-secret resets', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original; setWorkspaceToken(''); setSessionTag(null); clearBrowserSecrets() })
  let init
  globalThis.fetch = async (url, options) => { assert.equal(url, '/api/agent/models'); init = options; return new Response('[]', { headers: { 'Content-Type': 'application/json' } }) }
  const token = 'synthetic-operator-token-at-least-32-chars'
  setWorkspaceToken(token); setSessionTag('current-tag')
  registerBrowserSecret('synthetic-previous-model-key')
  resetSessionSecrets()
  assert.equal(redactBrowserText(token), '[REDACTED]')
  assert.equal(redactBrowserText('synthetic-previous-model-key'), 'synthetic-previous-model-key')
  await agentFetch('/models')
  assert.equal(init.headers.get('Authorization'), `Bearer ${token}`)
  assert.equal(init.headers.get('X-RecallLoop-Session'), 'current-tag')
  assert.equal(init.credentials, 'same-origin')
  assert.equal(init.cache, 'no-store')
  assert.deepEqual(await agentJson('/models'), [])
})

test('browser HTTP failures respect retryability, refresh changed auth, and never render upstream HTML', async t => {
  const original = globalThis.window
  globalThis.window = new EventTarget()
  t.after(() => { globalThis.window = original; clearBrowserSecrets() })
  let events = 0
  window.addEventListener('recallloop-auth-changed', () => { events++ })
  registerBrowserSecret('synthetic-error-secret')
  const error = await responseError(new Response(JSON.stringify({ code: 'session_changed', error: 'No synthetic-error-secret', retryable: false }), { status: 409 }))
  assert.equal(error.retryable, false)
  assert.equal(error.message, 'No [REDACTED]')
  assert.equal(events, 1)
  assert.equal((await responseError(new Response('<html>upstream debug</html>', { status: 502 }))).message, 'The server returned HTTP 502.')
})

test('browser SSE decoder handles byte-split Unicode/CRLF and reads stored after done', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\n\r\nevent: delta\r\ndata: {"text":"Hello 🌍"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\nevent: stored\r\ndata: {"facts":1}\r\n\r\n')
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close() } })
  const events = []
  await readAgentSse(new Response(body), (type, data) => events.push({ type, data }))
  assert.deepEqual(events.map(event => event.type), ['delta', 'done', 'stored'])
  assert.equal(events[0].data.text, 'Hello 🌍')
  const invalid = new Response('event: delta\ndata: {bad-json}\n\n')
  await assert.rejects(readAgentSse(invalid, () => {}), SyntaxError)
  const oversized = new Response(`data: ${'x'.repeat(300_001)}`)
  await assert.rejects(readAgentSse(oversized, () => {}), /size limit/)
})

test('browser known-secret redaction handles overlapping keys and common key formats', t => {
  t.after(clearBrowserSecrets)
  registerBrowserSecret('synthetic-key-prefix')
  registerBrowserSecret('synthetic-key-prefix-and-suffix')
  assert.equal(redactBrowserText('synthetic-key-prefix-and-suffix synthetic-key-prefix'), '[REDACTED] [REDACTED]')
  assert.equal(redactBrowserText(`sk-${'a'.repeat(30)}`), '[REDACTED]')
  // Synthetic hashes/public IDs must not be mistaken for private keys.
  const publicHash = createHash('sha256').update('public-id').digest('hex')
  assert.equal(redactBrowserText(publicHash), publicHash)
})
