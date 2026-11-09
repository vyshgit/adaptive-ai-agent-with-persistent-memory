import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { request as httpRequest } from 'node:http'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { workspaceHttp, deferred, testEnv } from './helpers/workspace-http.mjs'
import { walletAgentId, suiAddress } from '../server/agent/wallet-auth.mjs'
import { within } from '../server/safety.mjs'
import { parseSse } from '../server/agent/sse.mjs'

const chat = overrides => ({ sessionId: 'http-session', message: 'I prefer TypeScript and npm for coding.', mode: 'talk', ...overrides })
const live = { baseUrl: 'https://api.openai.com/v1', apiKey: 'synthetic-model-key', model: 'test-model', apiStyle: 'responses' }
const collectSse = async response => {
  const events = []
  for await (const frame of parseSse(response.body)) events.push({ type: frame.event, data: JSON.parse(frame.data) })
  return events
}

test('HTTP onboarding uses signed single-use proofs, cookie rotation, and session tags', async t => {
  const f = await workspaceHttp(t)
  const browser = f.client()
  const fresh = await browser.json('/auth/session')
  assert.equal(fresh.data.authenticated, false)
  assert.equal(fresh.headers.get('set-cookie'), null)
  assert.equal((await browser.json('/models')).status, 401)
  const signed = await browser.login()
  assert.equal(signed.status, 200)
  assert.equal(signed.data.agentId, walletAgentId(signed.pair.toSuiAddress()))
  assert.match(signed.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
  assert.match(signed.headers.get('set-cookie'), /Path=\/api\/agent/)
  assert.notEqual(signed.headers.get('set-cookie'), signed.challenge.headers.get('set-cookie'))
  const status = await browser.json('/status')
  assert.equal(status.status, 200)
  assert.equal(status.data.llm.mode, 'unconfigured')
  assert.equal(status.data.memory.mode, 'unconfigured')
  assert.equal(status.headers.get('cache-control'), 'no-store')
  assert.equal(status.headers.get('x-content-type-options'), 'nosniff')
  const noTag = f.client({ cookie: browser.cookie })
  assert.equal((await noTag.json('/models')).status, 409)
  const stale = f.client({ cookie: browser.cookie, tag: 'old-tab-tag' })
  for (const path of ['/auth/logout', '/auth/challenge', '/auth/demo']) {
    assert.equal((await stale.json(path, { body: { address: '0x1' } })).status, 409)
  }
  assert.equal((await browser.json('/auth/session')).data.authenticated, true)
  const replay = f.client({ cookie: signed.challenge.headers.get('set-cookie').split(';')[0] })
  assert.equal((await replay.json('/auth/verify', { body: { address: signed.pair.toSuiAddress(), challengeId: signed.challenge.data.challengeId, signature: 'dGVzdA==' } })).status, 401)
})

test('HTTP mock loop delivers memory, deltas, done, stored and recalls in a fresh local session', async t => {
  const f = await workspaceHttp(t)
  const browser = f.client()
  assert.equal((await browser.demo()).data.demo, true)
  const response = await browser.request('/chat', { body: chat({ stream: true }) })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  assert.equal(response.headers.get('x-accel-buffering'), 'no')
  const events = await collectSse(response)
  assert.equal(events[0].type, 'memory')
  assert.deepEqual(events.slice(-2).map(event => event.type), ['done', 'stored'])
  assert.ok(events.at(-1).data.verbatim >= 2)
  assert.ok(events.at(-1).data.facts >= 1)
  const next = await browser.json('/chat', { body: chat({ sessionId: 'fresh-session', history: [], stream: false, message: 'Which TypeScript and npm coding workflow do I prefer?' }) })
  assert.equal(next.status, 200)
  assert.ok(next.data.memory.memories.length)
  assert.match(next.data.answer, /TypeScript and npm/)
  assert.equal(next.data.stored.failed, 0)
  const inventory = await browser.json('/memory')
  assert.ok(inventory.data.inventory.total >= 3)
  assert.equal(inventory.data.inventory.meetsHackathonMinimum, false)
  assert.equal(inventory.data.status.network, null)
  const separate = f.client()
  await separate.demo()
  assert.equal((await separate.json('/memory')).data.inventory.total, 0)
  assert.equal((await browser.json('/connect', { body: live })).status, 403)
  assert.equal((await browser.json('/memory/seed', { body: { confirm: 'seed-mainnet' } })).status, 412)
})

test('HTTP trip planning carries scoped recall, plan and clarification through JSON, then continues with a real user reply over SSE', async t => {
  const f = await workspaceHttp(t)
  const browser = f.client()
  await browser.demo()
  await browser.json('/chat', { body: chat({ sessionId: 'departure', stream: false, message: 'My departure city is London. I prefer short trips and EUR.' }) })
  const planned = await browser.json('/chat', { body: chat({ sessionId: 'trip', mode: 'plan', stream: false, capture: false, message: 'Plan a quick trip to Alaska.' }) })
  assert.equal(planned.status, 200)
  assert.equal(planned.data.memory.lookups, 2)
  assert.ok(planned.data.memory.memories.some(hit => hit.text.includes('departure city is London')))
  assert.ok(planned.data.plan.steps.length)
  assert.match(planned.data.question.question, /dates and length/)
  assert.match(planned.data.question.why, /London/)
  assert.equal(planned.data.finishReason, 'question')
  assert.deepEqual(planned.data.proposals, [])
  const continued = await browser.request('/chat', { body: chat({ sessionId: 'trip', mode: 'plan', capture: false, stream: true,
    message: 'Next weekend, for 3 days.', history: [{ role: 'user', content: 'Plan a quick trip to Alaska.' },
      { role: 'assistant', content: `${planned.data.question.question}\n${planned.data.question.why}` }] }) })
  const events = await collectSse(continued)
  const text = events.filter(event => event.type === 'delta').map(event => event.data.text).join('')
  assert.match(text, /Departure: \*\*London\*\*/)
  assert.match(text, /No live travel facts were checked, no booking was made/)
  assert.equal(events.some(event => ['question', 'proposal'].includes(event.type)), false)
  assert.equal(events.at(-1).data.skipped, true)
})

test('HTTP question-only completion does not fabricate an answer or execute a write queued in the clarification round', async t => {
  let explicitWrites = 0
  const f = await workspaceHttp(t, { llm: { async *streamCompletion() {
    yield { type: 'tool_call', id: 'queued-write', name: 'remember', args: { text: 'Guessed departure city.' } }
    yield { type: 'tool_call', id: 'ask', name: 'ask_user', args: { question: 'Which city?', options: [] } }
  } }, initialise(session) { session.memory.remember = async () => { explicitWrites++; return {} } } })
  const browser = f.client()
  await browser.demo()
  const result = await browser.json('/chat', { body: chat({ stream: false, capture: false, message: 'Plan a trip.' }) })
  assert.equal(result.status, 200)
  assert.equal(result.data.answer, '')
  assert.equal(result.data.question.question, 'Which city?')
  assert.equal(result.data.finishReason, 'question')
  assert.equal(result.data.tools.find(tool => tool.id === 'queued-write').status, 'blocked')
  assert.equal(explicitWrites, 0)
  assert.equal((await browser.json('/memory')).data.inventory.total, 0)
})

test('HTTP parsers accept bounded projects above 32 KB but reject bad JSON, compression and oversized requests', async t => {
  const f = await workspaceHttp(t)
  const browser = f.client()
  await browser.demo()
  const project = { files: Array.from({ length: 4 }, (_, i) => ({ path: `file-${i}.txt`, content: 'x'.repeat(20_000) })) }
  assert.equal((await browser.json('/chat', { body: chat({ stream: false, capture: false, project }) })).status, 200)
  assert.equal((await browser.json('/api/legacy-limit', { body: { content: 'x'.repeat(40_000) } })).status, 413)
  assert.equal((await browser.json('/chat', { body: { padding: 'x'.repeat(1_050_000) } })).status, 413)
  assert.equal((await browser.json('/chat', { body: '{not-json' })).status, 400)
  assert.equal((await browser.json('/chat', { body: gzipSync(JSON.stringify(chat())), headers: { 'Content-Encoding': 'gzip' } })).status, 415)
  const attack = await browser.json('/chat', { body: chat(), headers: { Origin: 'https://evil.example' } })
  assert.equal(attack.status, 403)
  // Native fetch derives Host from its URL; use HTTP directly for a rebinding probe.
  const rebinding = await new Promise((resolve, reject) => {
    const request = httpRequest(`${f.origin}/api/agent/status`, { headers: { Host: 'evil.example', Origin: f.origin } }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode))
    })
    request.on('error', reject); request.end()
  })
  assert.equal(rebinding, 403)
  assert.equal((await browser.json('/unknown-route')).status, 404)
})

test('the optional HTTP operator gate never substitutes for wallet authentication or bypasses origin checks', async t => {
  const token = 'synthetic-operator-gate-token-with-32-characters'
  const f = await workspaceHttp(t, { env: { RECALLLOOP_WORKSPACE_TOKEN: token, NODE_ENV: 'production' } })
  assert.equal((await f.client().json('/auth/session')).status, 401)
  const browser = f.client({ headers: { Authorization: `Bearer ${token}` } })
  assert.equal((await browser.json('/auth/session')).data.authenticated, false)
  assert.equal((await browser.json('/status')).status, 401)
  assert.equal((await browser.json('/auth/session', { headers: { Origin: 'https://evil.example' } })).status, 403)
  assert.equal((await browser.login()).status, 200)
  assert.equal((await browser.json('/status')).status, 200)
})

test('logout during model discovery clears staged keys and cannot resurrect the old connection', async t => {
  const gate = deferred(), started = deferred()
  let staged
  const f = await workspaceHttp(t, { llm: { models: async (config, signal) => {
    staged = config; started.resolve()
    await within(gate.promise, 1000, null, signal)
    return { models: [config.model], verified: true }
  } } })
  const browser = f.client()
  const signed = await browser.login()
  const pending = browser.json('/connect', { body: live })
  await started.promise
  assert.equal((await browser.json('/remember', { body: { text: 'A conflicting write' } })).status, 429)
  assert.equal((await browser.json('/auth/logout', { body: {} })).status, 200)
  const refused = await pending
  assert.equal(refused.status, 401)
  assert.equal(staged.apiKey, '')
  assert.equal(f.sessions[0].config, null)
  assert.equal(refused.headers.get('set-cookie'), null)
  gate.resolve()
  const fresh = f.client()
  await fresh.login(signed.pair)
  assert.equal((await fresh.json('/status')).data.llm.mode, 'unconfigured')
})

test('logout during Tatum verification wipes retained keys and refuses late checkpoint installation', async t => {
  const started = deferred(), gate = deferred()
  let held
  const f = await workspaceHttp(t, { services: { graphql: async (_query, _variables, credentials) => {
    if (!credentials.apiKey) throw new Error('unconfigured')
    held = credentials; started.resolve()
    return gate.promise
  } } })
  const browser = f.client()
  await browser.login()
  const pending = browser.json('/connections/tatum', { body: { apiKey: 'synthetic-tatum-key' } })
  await started.promise
  await browser.json('/auth/logout', { body: {} })
  assert.equal((await pending).status, 401)
  assert.equal(held.apiKey, '')
  gate.resolve({ checkpoint: { sequenceNumber: '999', digest: 'late-checkpoint' } })
  await gate.promise
  assert.equal(f.sessions[0].tatumKey, '')
  assert.equal(f.sessions[0].tatum.configured, false)
})

test('logout during Walrus verification destroys the uncommitted client and delegate environment', async t => {
  const started = deferred(), gate = deferred(), packageId = suiAddress('0xb')
  let backend, candidateEnv, owner
  const f = await workspaceHttp(t, { services: {
    graphql: async query => query.includes('Checkpoint') ? { checkpoint: { sequenceNumber: '12' } } : { object: {
      address: suiAddress('0xa'), owner: { __typename: 'Shared' },
      asMoveObject: { contents: { json: { owner }, type: { repr: `${packageId}::account::MemWalAccount` } } },
    } },
    deployment: async () => ({ network: 'mainnet', packageId }),
    backendFactory: ({ env }) => {
      candidateEnv = env
      backend = { destroyed: false, status: () => { started.resolve(); return gate.promise }, destroy() { this.destroyed = true },
        getClient() { assert.fail('Authorization must not continue after logout') } }
      return backend
    },
  } })
  const browser = f.client()
  const signed = await browser.login()
  owner = signed.pair.toSuiAddress()
  await browser.json('/connections/tatum', { body: { apiKey: 'synthetic-tatum-key' } })
  const pending = browser.json('/connections/memwal', { body: { accountId: '0xa', delegateKey: '1'.repeat(64) } })
  await started.promise
  await browser.json('/auth/logout', { body: {} })
  assert.equal((await pending).status, 401)
  assert.equal(candidateEnv.MEMWAL_PRIVATE_KEY, '')
  assert.equal(backend.destroyed, true)
  gate.resolve({ mode: 'relayer', network: 'mainnet', healthy: true, writeReady: true })
  assert.equal(f.sessions[0].memoryConnection, undefined)
})

test('logout ends an in-progress non-streamed HTTP turn promptly and releases its request slot', async t => {
  const started = deferred(), gate = deferred()
  let writes = 0
  const f = await workspaceHttp(t, { llm: { async *streamCompletion({ signal }) {
    yield { type: 'delta', text: 'Partial answer.' }
    started.resolve()
    await within(gate.promise, 1000, null, signal)
  } }, initialise(session) { session.memory.ingest = async () => { writes++; return {} } } })
  const browser = f.client()
  await browser.demo()
  const pending = browser.json('/chat', { body: chat({ stream: false }) })
  await started.promise
  await browser.json('/auth/logout', { body: {} })
  const result = await pending
  assert.equal(result.status, 401)
  assert.equal(result.data.code, 'wallet_required')
  assert.equal(writes, 0)
  assert.equal(f.sessions[0].active, 0)
  assert.equal(f.sessions[0].controllers.size, 0)
})

test('disconnecting an HTTP stream cancels generation, but a capture already started after done can finish', async t => {
  const aborted = deferred(), generation = deferred()
  let writes = 0
  const f = await workspaceHttp(t, { llm: { async *streamCompletion({ signal }) {
    try {
      yield { type: 'delta', text: 'Partial.' }
      await within(generation.promise, 1000, null, signal)
    } finally { aborted.resolve(signal.aborted) }
  } }, initialise(session) { session.memory.ingest = async () => { writes++; return {} } } })
  const browser = f.client()
  await browser.demo()
  const controller = new AbortController()
  const response = await browser.request('/chat', { body: chat(), signal: controller.signal })
  const reader = response.body.getReader()
  await reader.read()
  controller.abort()
  await reader.cancel().catch(() => {})
  reader.releaseLock()
  assert.equal(await aborted.promise, true)
  await browser.json('/models')
  assert.equal(f.sessions[0].active, 0)
  assert.equal(writes, 0)

  const capture = deferred(), captured = deferred()
  const second = await workspaceHttp(t, { initialise(session) {
    session.memory.ingest = () => { captured.resolve(); return capture.promise }
  } })
  const other = second.client()
  await other.demo()
  const stop = new AbortController()
  const stream = await other.request('/chat', { body: chat(), signal: stop.signal })
  const frames = parseSse(stream.body)
  for await (const frame of frames) if (frame.event === 'done') break
  await captured.promise
  stop.abort()
  capture.resolve({ stored: { verbatim: 2, facts: 1, failed: 0 }, blobs: [] })
  await capture.promise
  await other.json('/models')
  assert.equal(second.sessions[0].disposed, false)
})

test('HTTP request concurrency is bounded per session and globally and recovers after completion', async t => {
  for (const kind of ['session', 'global']) {
    const gate = deferred(), started = deferred()
    let calls = 0
    const target = kind === 'session' ? 8 : 48
    const f = await workspaceHttp(t, { initialise(session) {
      const status = session.memory.status
      session.memory.status = async () => { if (++calls === target) started.resolve(); await gate.promise; return status() }
    } })
    const browsers = Array.from({ length: kind === 'session' ? 1 : 7 }, () => f.client())
    for (const browser of browsers) await browser.demo()
    const pending = browsers.slice(0, kind === 'session' ? 1 : 6).flatMap(browser => Array.from({ length: 8 }, () => browser.json('/status')))
    await started.promise
    assert.equal((await browsers.at(-1).json('/models')).status, 429)
    gate.resolve()
    assert.ok((await Promise.all(pending)).every(result => result.status === 200))
    assert.equal((await browsers.at(-1).json('/models')).status, 200)
  }
})

test('only four HTTP chats can run globally and connection mutations cannot overlap an active turn', async t => {
  const gate = deferred(), started = deferred()
  let running = 0
  const f = await workspaceHttp(t, { llm: { async *streamCompletion({ signal }) {
    if (++running === 4) started.resolve()
    await within(gate.promise, 1000, null, signal)
    yield { type: 'delta', text: 'Finished.' }
  } } })
  const browsers = Array.from({ length: 5 }, () => f.client())
  for (const browser of browsers) await browser.demo()
  const pending = browsers.slice(0, 4).map(browser => browser.json('/chat', { body: chat({ stream: false, capture: false }) }))
  await started.promise
  assert.equal((await browsers[4].json('/chat', { body: chat({ stream: false }) })).status, 429)
  assert.equal((await browsers[0].json('/connect', { body: { mode: 'mock' } })).status, 429)
  gate.resolve()
  assert.ok((await Promise.all(pending)).every(result => result.status === 200))
  assert.ok(f.sessions.every(session => session.active === 0))
})

test('HTTP response redaction keeps request-time credentials after logout wipes the session', async t => {
  const gate = deferred(), started = deferred()
  const key = 'synthetic-model-key'
  const f = await workspaceHttp(t, { initialise(session) {
    session.config = { mode: 'mock', model: 'recallloop-mock', models: ['recallloop-mock'], apiKey: key, baseUrl: '', apiStyle: 'chat', toolsEnabled: true }
    session.memory.status = async () => { started.resolve(); await gate.promise; return { error: `Do not leak ${key}` } }
  } })
  const browser = f.client()
  await browser.demo()
  const pending = browser.json('/status')
  await started.promise
  await browser.json('/auth/logout', { body: {} })
  assert.equal(f.sessions[0].config, null)
  gate.resolve()
  const result = await pending
  assert.equal(JSON.stringify(result.data).includes(key), false)
  assert.match(result.data.memory.error, /\[REDACTED\]/)
})

test('external HTTP memory APIs bind bearer identities, keep wallet namespaces separate, and enforce admin seed auth', async t => {
  const key = 'synthetic-external-agent-api-key-32-chars', admin = 'synthetic-admin-api-key-at-least-32-chars'
  testEnv(t, { RECALLLOOP_API_KEYS: JSON.stringify({ 'external-agent': key }), RECALLLOOP_ADMIN_API_KEY: admin })
  const f = await workspaceHttp(t)
  const external = f.client({ headers: { Authorization: `Bearer ${key}` } })
  const ingest = await external.json('/api/memory/ingest', { body: { agentId: 'external-agent', sessionId: 'one', messages: [{ role: 'user', content: 'I prefer npm for coding.' }] } })
  assert.equal(ingest.status, 200)
  assert.ok(ingest.data.blobs.length)
  assert.equal((await external.json('/api/memory/recall', { body: { agentId: 'other-agent', query: 'npm coding' } })).status, 403)
  assert.equal((await external.json('/api/memory/inventory?agentId=external-agent')).data.total, ingest.data.blobs.length)
  assert.equal((await external.json('/api/memory/seed', { body: { confirm: 'seed-mainnet' } })).status, 401)
  const operator = f.client({ headers: { Authorization: `Bearer ${admin}` } })
  assert.equal((await operator.json('/api/memory/seed', { body: { confirm: 'seed-mainnet' } })).status, 412)
  assert.equal((await external.json('/api/memory/ingest', { body: { agentId: 'external-agent', sessionId: 'bad', messages: [{ role: 'tool', content: 'missing name' }] } })).status, 400)
  const wallet = f.client()
  await wallet.login(Ed25519Keypair.generate())
  assert.equal((await wallet.json('/memory')).data.inventory.success, false)
  assert.equal((await wallet.json('/memory')).data.inventory.total, 0)
})
