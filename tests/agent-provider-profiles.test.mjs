import test from 'node:test'
import assert from 'node:assert/strict'
import { createConnectionStore, validateConnection, validateModelDiscovery, publicConnection, MAX_MODEL_CONNECTIONS } from '../server/agent/connections.mjs'
import { createLlm } from '../server/agent/llm.mjs'
import { AppError } from '../server/safety.mjs'
import { workspaceHttp, deferred } from './helpers/workspace-http.mjs'
import { parseSse } from '../server/agent/sse.mjs'

const profile = (profileId, apiKey = `SYNTHETIC_PROFILE_KEY_${profileId}`) => ({ profileId, profileName: `Account ${profileId}`,
  baseUrl: 'https://api.openai.com/v1', apiStyle: 'responses', model: 'shared-model', apiKey })
const verified = config => ({ verified: true, verification: { model: config.model, apiStyle: config.apiStyle, generation: 'verified', streaming: 'not_checked', tools: 'not_checked' } })
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

test('multiple connected profiles route duplicate model IDs by identity across browser clients', async t => {
  const calls = [], staged = []
  let fail = false
  const f = await workspaceHttp(t, { llm: {
    async models(config) { staged.push(config); return { models: [config.model, 'other-model'], discovered: true } },
    async verify(config) { if (fail) throw new AppError('provider_unauthorized', 'Synthetic rejected credential', 401); return verified(config) },
    async *streamCompletion({ config }) { calls.push({ source: 'chat', id: config.id, apiKey: config.apiKey }); yield { type: 'delta', text: `Using ${config.id}` }; yield { type: 'finish', reason: 'stop' } },
  } })
  const browser = f.client(), other = f.client()
  await browser.login(); await other.login()
  for (const id of ['first', 'second']) assert.equal((await browser.json('/connect', { body: profile(id) })).status, 200)
  const references = [...f.sessions[0].modelConnections.values()]
  assert.ok(staged.every(config => config.apiKey === ''))
  const status = (await browser.json('/status')).data
  assert.deepEqual(status.modelConnections.map(connection => connection.id), ['first', 'second'])
  assert.equal((await other.json('/status')).data.modelConnections.length, 0)
  assert.equal(JSON.stringify(status).includes('SYNTHETIC_PROFILE_KEY_'), false)
  const task = { sessionId: 's', message: 'Inspect the code.', model: 'shared-model', capture: false, stream: false }
  assert.equal((await browser.json('/chat', { body: task })).data.code, 'connection_required')
  for (const connectionId of ['first', 'second']) {
    const result = await browser.json('/chat', { body: { ...task, connectionId } })
    assert.equal(result.status, 200)
    assert.equal(result.data.answer, `Using ${connectionId}`)
  }
  assert.equal((await other.json('/chat', { body: { ...task, connectionId: 'first' } })).data.code, 'connection_not_found')
  assert.deepEqual(calls.map(call => call.apiKey), [profile('first').apiKey, profile('second').apiKey])
  assert.ok(calls.every(call => call.source === 'chat'))
  fail = true
  assert.equal((await browser.json('/connect', { body: profile('first', 'SYNTHETIC_REJECTED_NEW_KEY') })).status, 401)
  assert.equal(references[0].apiKey, profile('first').apiKey)
  assert.equal(staged.at(-1).apiKey, '')
  fail = false
  assert.equal((await browser.json('/verify', { body: { connectionId: 'first' } })).status, 200)
  assert.equal(references[0].apiKey, '', 'superseded in-process config is scrubbed')
  const remaining = [...f.sessions[0].modelConnections.values()]
  assert.equal((await browser.json('/disconnect', { body: { connectionId: 'first' } })).status, 200)
  assert.equal(remaining[0].apiKey, '')
  assert.equal((await browser.json('/status')).data.modelConnections[0].id, 'second')
  assert.equal((await browser.json('/chat', { body: { ...task, connectionId: 'first' } })).data.code, 'connection_not_found')
  await browser.json('/auth/logout', { body: {} })
  assert.ok(remaining.every(config => config.apiKey === ''))
  assert.equal(f.sessions[0].modelConnections.size, 0)
  assert.equal((await browser.json('/models?connectionId=second')).status, 401)
})

test('profile admission is bounded and expired sessions cannot select retained credentials', () => {
  let now = 100
  const connections = createConnectionStore({ clock: () => now })
  const session = { kind: 'wallet', expiresAt: 200, config: null }, req = { workspaceSession: session }
  for (let i = 0; i < MAX_MODEL_CONNECTIONS; i++) connections.connect(req, validateConnection(profile(`profile-${i}`)))
  assert.throws(() => connections.admit(req, validateConnection(profile('overflow'))), { code: 'connection_limit' })
  assert.equal(connections.list(req).length, MAX_MODEL_CONNECTIONS)
  const old = connections.select(req, 'profile-0')
  connections.connect(req, validateConnection(profile('profile-0', 'SYNTHETIC_ROTATED_PROFILE_KEY')))
  assert.equal(old.apiKey, '')
  assert.equal(connections.list(req).length, MAX_MODEL_CONNECTIONS)
  now = 200
  assert.throws(() => connections.select(req, 'profile-0'), { code: 'wallet_required' })
})

test('Hugging Face discovery and chat use the compatible router with the selected token and never infer free access', async () => {
  const config = validateConnection({ ...profile('hf'), baseUrl: 'https://router.huggingface.co/v1', apiStyle: 'chat', model: 'org/chat-model:provider' })
  const requests = []
  const llm = createLlm({ env: {}, fetchImpl: async (url, options) => {
    requests.push({ url, options })
    assert.equal(options.headers.get('Authorization'), `Bearer ${config.apiKey}`)
    if (url.endsWith('/models')) return json({ data: [{ id: config.model, providers: [{ is_free: true }], pricing: { prompt: 0, completion: 0 } }] })
    assert.equal(JSON.parse(options.body).model, config.model)
    return json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] })
  } })
  const discovered = await llm.models(config)
  assert.deepEqual(discovered.catalogue, [{ id: config.model }])
  assert.equal((await llm.verify(config)).verified, true)
  assert.deepEqual(requests.map(request => request.url), ['https://router.huggingface.co/v1/models', 'https://router.huggingface.co/v1/chat/completions'])
})

test('only zero-priced OpenRouter catalogue entries get free labels; names and conflicting prices do not', async () => {
  const config = validateModelDiscovery({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'SYNTHETIC_OPENROUTER_KEY', apiStyle: 'chat' })
  const data = [
    { id: 'paid:free', pricing: { prompt: '0.01', completion: '0.02' } },
    { id: 'genuinely-free', pricing: { prompt: '0', completion: '0.000', request: 0 } },
    { id: 'unpriced:free', is_free: true }, { id: 'request-fee', pricing: { prompt: 0, completion: 0, request: '1' } },
    { id: 'missing-price', pricing: { prompt: 0 } }, { id: 'null-prices', pricing: { prompt: null, completion: null } },
    { id: 'conflicting-price', pricing: { prompt: 0, completion: 0 } }, { id: 'conflicting-price', pricing: { prompt: 1, completion: 0 } },
    { id: config.apiKey, pricing: { prompt: 0, completion: 0 } },
  ]
  const llm = createLlm({ env: {}, fetchImpl: async () => json({ data }) })
  const discovered = await llm.models(config)
  const result = publicConnection({ ...config, ...discovered })
  assert.equal(result.models[0].id, 'genuinely-free')
  assert.deepEqual(result.models.filter(model => model.cost).map(model => model.id), ['genuinely-free'])
  assert.equal(JSON.stringify(result).includes(config.apiKey), false)
  assert.equal(result.verified, false)
})

test('Hugging Face HTTP and streamed quota failures explain billing without retrying or echoing upstream details', async t => {
  const input = { ...profile('hf-billing'), baseUrl: 'https://router.huggingface.co/v1', apiStyle: 'chat', model: 'org/chat-model' }
  const config = validateConnection(input), requests = []
  let mode = 'http'
  const llm = createLlm({ env: {}, fetchImpl: async (url, options) => {
    requests.push(url)
    if (url.endsWith('/models')) return json({ data: [{ id: config.model }] })
    const error = { status: 402, message: `Payment required ${config.apiKey} UPSTREAM_PRIVATE_DETAIL` }
    return mode === 'http' ? json({ error }, 402) : new Response(`data: ${JSON.stringify({ error })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const f = await workspaceHttp(t, { llm }), browser = f.client()
  await browser.login()
  const discovery = await browser.json('/models/discover', { body: { baseUrl: input.baseUrl, apiKey: input.apiKey, apiStyle: 'chat' } })
  assert.equal(discovery.status, 200)
  const failed = await browser.json('/connect', { body: input })
  assert.equal(failed.status, 502)
  assert.equal(failed.data.code, 'provider_quota')
  assert.equal(failed.data.retryable, false)
  assert.match(failed.data.error, /Hugging Face/)
  assert.match(failed.data.error, /Free accounts have no included inference credits/)
  assert.match(failed.data.error, /Billing and Inference Providers/)
  assert.equal((await browser.json('/status')).data.modelConnections.length, 0)
  assert.equal(requests.filter(url => url.endsWith('/chat/completions')).length, 1)
  mode = 'stream'
  await assert.rejects(async () => {
    for await (const _event of llm.streamCompletion({ config, model: config.model, messages: [] })) assert.fail('Quota failure cannot generate')
  }, error => error.code === 'provider_quota' && error.message.includes('Hugging Face') && !error.message.includes(config.apiKey) && !error.message.includes('UPSTREAM_PRIVATE_DETAIL'))
  assert.equal(requests.filter(url => url.endsWith('/chat/completions')).length, 2)
  assert.equal(JSON.stringify(failed.data).includes(config.apiKey), false)
  assert.equal(JSON.stringify(failed.data).includes('UPSTREAM_PRIVATE_DETAIL'), false)
})

test('logout during an additional provider verification clears staged and all installed profile credentials', async t => {
  const started = deferred(), gate = deferred(), staged = []
  const f = await workspaceHttp(t, { llm: { async models(config) { staged.push(config); return { models: [config.model] } }, async verify(config) {
    if (config.id === 'late') { started.resolve(); await gate.promise }
    return verified(config)
  } } })
  const browser = f.client()
  await browser.login()
  await browser.json('/connect', { body: profile('first') })
  const installed = [...f.sessions[0].modelConnections.values()]
  const pending = browser.json('/connect', { body: profile('late') })
  await started.promise
  await browser.json('/auth/logout', { body: {} })
  gate.resolve()
  assert.equal((await pending).status, 401)
  assert.ok([...staged, ...installed].every(config => config.apiKey === ''))
  assert.equal(f.sessions[0].modelConnections.size, 0)
})
