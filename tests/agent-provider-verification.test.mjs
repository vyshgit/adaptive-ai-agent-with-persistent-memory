import test from 'node:test'
import assert from 'node:assert/strict'
import { createLlm } from '../server/agent/llm.mjs'
import { validateConnection, publicConnection, validateProviderUrl } from '../server/agent/connections.mjs'
import { providerFailure } from '../server/agent/provider-errors.mjs'
import { within } from '../server/safety.mjs'
import { workspaceHttp, deferred } from './helpers/workspace-http.mjs'
import { suiAddress } from '../server/agent/wallet-auth.mjs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

const input = { baseUrl: 'https://agentrouter.org/v1', apiKey: 'synthetic-provider-check-key', model: 'exact-account-model', apiStyle: 'responses' }
const config = (style = 'responses') => validateConnection({ ...input, apiStyle: style }, {})
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const answer = (style = 'responses', text = 'OK') => style === 'responses'
  ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
  : { choices: [{ message: { content: text }, finish_reason: 'stop' }] }
const toolAnswer = style => style === 'responses'
  ? { status: 'completed', output: [{ type: 'function_call', call_id: 'check-call', name: 'recallloop_connection_check', arguments: '{"ok":true}' }] }
  : { choices: [{ message: { tool_calls: [{ id: 'check-call', type: 'function', function: { name: 'recallloop_connection_check', arguments: '{"ok":true}' } }] }, finish_reason: 'tool_calls' }] }
const streamedAnswer = style => new Response(style === 'responses'
  ? 'data: {"type":"response.output_text.delta","delta":"OK"}\n\ndata: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n'
  : 'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
const collect = async iterator => { const events = []; for await (const event of iterator) events.push(event); return events }

test('provider diagnostics distinguish keys, client approval, quota, models, protocols, tools, streaming and transient errors without echoing bodies', () => {
  const cases = [
    [401, 'invalid key', 'provider_invalid_key', false],
    [403, 'Only approved clients may use this service', 'provider_client_unapproved', false],
    [403, 'Project permission denied', 'provider_forbidden', false],
    [402, 'Budget pool quota has been exhausted.', 'provider_quota', false],
    [429, 'insufficient_quota', 'provider_quota', false],
    [429, 'Too many requests', 'provider_rate_limited', true],
    [503, 'no available channel', 'provider_model_unavailable', true],
    [400, 'Invalid model', 'provider_model_unavailable', false],
    [404, 'route not found', 'provider_protocol_unsupported', false],
    [400, 'Streaming is not supported', 'provider_streaming_unsupported', false],
    [422, 'tools are not supported', 'provider_tools_unsupported', false],
    [504, 'upstream timeout', 'provider_timeout', true],
    [500, 'upstream failure', 'provider_request_failed', true],
  ]
  for (const [status, body, code, retryable] of cases) {
    const error = providerFailure(status, `${body}; synthetic-provider-check-key; private upstream prompt`)
    assert.equal(error.code, code)
    assert.equal(error.retryable, retryable)
    assert.equal(error.message.includes(input.apiKey), false)
    assert.equal(error.message.includes('private upstream prompt'), false)
  }
  assert.match(providerFailure(403, 'unsupported client').message, /does not impersonate/)
})

test('both protocols verify actual generation with one bounded non-streamed coding request and no private context', async () => {
  for (const style of ['chat', 'responses']) {
    const requests = []
    const llm = createLlm({ env: {}, fetchImpl: async (url, request) => {
      requests.push({ url, body: JSON.parse(request.body) })
      assert.equal(request.headers.get('User-Agent'), 'RecallLoop/0.2.0')
      assert.equal(request.headers.get('Authorization'), `Bearer ${input.apiKey}`)
      assert.equal(request.redirect, 'error')
      return json(answer(style))
    } })
    const result = await llm.verify(config(style))
    assert.equal(result.verified, true)
    assert.equal(result.verification.model, input.model)
    assert.equal(result.verification.apiStyle, style)
    assert.equal(result.verification.generation, 'verified')
    assert.equal(result.verification.streaming, 'not_checked')
    assert.equal(result.verification.tools, 'not_checked')
    assert.equal(requests.length, 1)
    const request = requests[0]
    assert.equal(request.url, `${input.baseUrl}/${style === 'responses' ? 'responses' : 'chat/completions'}`)
    assert.equal(request.body.stream, false)
    assert.equal(request.body.max_output_tokens || request.body.max_tokens, 256)
    assert.equal(request.body.store, false)
    assert.equal(request.body.tools, undefined)
    assert.equal(JSON.stringify(request.body).includes(input.apiKey), false)
    assert.equal(JSON.stringify(result).includes('content'), false, 'probe output is not returned or cached')
  }
})

test('empty, incomplete, and malformed generation cannot establish verification', async () => {
  for (const data of [answer('responses', ''), { status: 'incomplete', output: answer().output }, { status: 'completed', output: {} },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: { debug: input.apiKey } }] }] }]) {
    const llm = createLlm({ env: {}, fetchImpl: async () => json(data) })
    await assert.rejects(llm.verify(config()), error => ['provider_invalid_response', 'provider_incomplete'].includes(error.code) && !error.message.includes(input.apiKey))
  }
})

test('optional streaming and non-executing function checks establish only the selected model and protocol capabilities', async () => {
  for (const style of ['chat', 'responses']) {
    const requests = []
    const llm = createLlm({ env: {}, fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      requests.push(body)
      return body.tools ? json(toolAnswer(style)) : body.stream ? streamedAnswer(style) : json(answer(style))
    } })
    const result = await llm.verify(config(style), { checkCapabilities: true })
    assert.equal(requests.length, 3)
    assert.deepEqual(requests.map(body => body.stream), [false, true, false])
    assert.equal(result.verification.streaming, 'verified')
    assert.equal(result.verification.tools, 'verified')
    assert.equal(requests[2].tools.length, 1)
    assert.equal(JSON.stringify(requests[2].tools).includes('propose_file'), false)
    assert.equal(style === 'responses' ? requests[2].tool_choice.name : requests[2].tool_choice.function.name, 'recallloop_connection_check')
  }
})

test('unsupported or ignored streaming and unsupported tools are reported separately from successful plain generation', async () => {
  for (const ignoreStreaming of [false, true]) {
    let requests = 0
    const llm = createLlm({ env: {}, fetchImpl: async (_url, request) => {
      requests++
      const body = JSON.parse(request.body)
      return body.tools ? json({ error: 'tools not supported; synthetic-provider-check-key' }, 400)
        : body.stream && !ignoreStreaming ? json({ error: 'streaming not supported' }, 422) : json(answer())
    } })
    const result = await llm.verify(config(), { checkCapabilities: true })
    assert.equal(requests, 3, 'capability checks do not retry or execute tools')
    assert.equal(result.verified, true)
    assert.equal(result.verification.streaming, 'unsupported')
    assert.equal(result.verification.tools, 'unsupported')
    assert.equal(JSON.stringify(result).includes(input.apiKey), false)
  }
})

test('modern OpenAI Chat uses its completion token parameter; other compatible providers keep max_tokens', async () => {
  for (const baseUrl of ['https://api.openai.com/v1', input.baseUrl]) {
    const connection = validateConnection({ ...input, apiStyle: 'chat', baseUrl, model: 'gpt-5-account-model' }, {})
    const llm = createLlm({ env: {}, fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      assert.equal(body[baseUrl.includes('api.openai.com') ? 'max_completion_tokens' : 'max_tokens'], 256)
      return json(answer('chat'))
    } })
    assert.equal((await llm.verify(connection)).verified, true)
  }
})

test('discovery, generation, and verification preserve cancellation, distinguish network errors, and reject impersonation', async () => {
  const controller = new AbortController()
  controller.abort()
  const offline = createLlm({ env: {}, fetchImpl: () => assert.fail('Cancelled requests must not start') })
  await assert.rejects(offline.models(config(), controller.signal), { name: 'AbortError' })
  await assert.rejects(offline.verify(config(), { signal: controller.signal }), { name: 'AbortError' })
  const broken = createLlm({ env: {}, fetchImpl: async () => { throw new Error(input.apiKey) } })
  await assert.rejects(broken.models(config()), { code: 'provider_network' })
  await assert.rejects(broken.verify(config()), error => error.code === 'provider_network' && !error.message.includes(input.apiKey))
  const spoofed = createLlm({ env: { AGENT_LLM_EXTRA_HEADERS: '{"User-Agent":"Codex"}' }, fetchImpl: () => assert.fail('No spoofed request may leave RecallLoop') })
  await assert.rejects(spoofed.models(config()), /Only legitimate attribution/)
  await assert.rejects(spoofed.verify(config()), /Only legitimate attribution/)
  const timeout = createLlm({ env: {}, fetchImpl: (_url, request) => new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })) })
  await assert.rejects(collect(timeout.streamCompletion({ config: config(), model: input.model, messages: [], requestTimeoutMs: 5 })), { code: 'provider_timeout' })
})

test('full endpoint URLs are rejected and a discovery-only legacy flag cannot imply generation verification', () => {
  for (const suffix of ['/responses', '/chat/completions', '/models', '/messages']) assert.throws(() => validateProviderUrl(`${input.baseUrl}${suffix}`, {}), /API base URL/)
  assert.equal(publicConnection({ ...config(), verified: true }).verified, false)
  assert.equal(publicConnection({ ...config(), verification: { generation: 'verified', model: 'another-model', apiStyle: 'responses' } }).verified, false)
})

test('HTTP connect is staged until generation succeeds; failed replacement and re-verification do not lose the saved key', async t => {
  let rejected = false, candidate, discoveryRequests = 0, generationRequests = 0
  const transport = createLlm({ env: {}, fetchImpl: async (url, request) => {
    if (url.endsWith('/models')) { discoveryRequests++; return json({ data: [{ id: 'listed-but-not-verified' }] }) }
    generationRequests++
    return rejected ? json({ error: 'Only approved clients may connect; synthetic-provider-check-key' }, 403) : json(answer())
  } })
  const llm = { ...transport, verify(config, options) { candidate = config; return transport.verify(config, options) } }
  const f = await workspaceHttp(t, { llm })
  const browser = f.client()
  await browser.login()
  const first = await browser.json('/connect', { body: input })
  assert.equal(first.status, 200)
  assert.equal(first.data.connection.verified, true)
  assert.equal(first.data.connection.verification.discovery, 'available')
  assert.equal(first.data.connection.verification.streaming, 'not_checked')
  assert.equal(discoveryRequests, 1)
  assert.equal(generationRequests, 1)
  assert.equal(candidate.apiKey, '', 'staged key is wiped after committing an isolated copy')
  assert.equal(first.data.connection.models.length, 2)
  const saved = f.sessions[0].config
  rejected = true
  const replacement = await browser.json('/connect', { body: { ...input, model: 'replacement-model' } })
  assert.equal(replacement.status, 502)
  assert.equal(replacement.data.code, 'provider_client_unapproved')
  assert.equal(f.sessions[0].config, saved)
  assert.equal(candidate.apiKey, '')
  assert.equal(saved.apiKey, input.apiKey)
  assert.equal((await browser.json('/status')).data.llm.verified, true, 'a different failed candidate does not invalidate a working connection')
  const rechecked = await browser.json('/verify', { body: {} })
  assert.equal(rechecked.status, 502)
  const failedStatus = (await browser.json('/status')).data.llm
  assert.equal(failedStatus.verified, false)
  assert.equal(failedStatus.lastVerificationFailure.code, 'provider_client_unapproved')
  assert.equal(saved.apiKey, input.apiKey)
  rejected = false
  const restored = await browser.json('/verify', { body: { toolsEnabled: false } })
  assert.equal(restored.status, 200)
  assert.equal(restored.data.connection.verified, true)
  assert.equal(restored.data.connection.toolsEnabled, false)
  assert.equal(restored.data.connection.lastVerificationFailure, null)
  assert.equal(saved.apiKey, '', 'replacement wipes the previous credential object')
  assert.equal(JSON.stringify([first.data, replacement.data, failedStatus, restored.data]).includes(input.apiKey), false)
  const other = f.client()
  await other.login()
  assert.equal((await other.json('/status')).data.llm.mode, 'unconfigured')
  assert.equal((await other.json('/verify', { body: {} })).status, 412)
})

test('logout during actual generation verification cancels the staged operation and cannot install credentials late', async t => {
  const started = deferred(), gate = deferred()
  let candidate
  const llm = { models: async () => ({ models: [input.model], discovered: true, verified: false }), async verify(config, { signal }) {
    candidate = config
    started.resolve()
    await within(gate.promise, 1000, null, signal)
    return { verified: true, verification: { model: config.model, apiStyle: config.apiStyle, generation: 'verified' } }
  } }
  const f = await workspaceHttp(t, { llm })
  const browser = f.client()
  await browser.login()
  const connecting = browser.json('/connect', { body: input })
  await started.promise
  assert.equal((await browser.json('/verify', { body: {} })).status, 429)
  await browser.json('/auth/logout', { body: {} })
  assert.equal((await connecting).status, 401)
  assert.equal(candidate.apiKey, '')
  assert.equal(f.sessions[0].config, null)
  gate.resolve()
  const fresh = f.client()
  await fresh.login()
  assert.equal((await fresh.json('/status')).data.llm.mode, 'unconfigured')
})

test('HTTP generation can verify without discovery, and stream:false reaches the provider rather than buffering SSE', async t => {
  const requestedStreams = []
  const llm = createLlm({ env: {}, fetchImpl: async (url, request) => {
    if (url.endsWith('/models')) return json({}, 404)
    const body = JSON.parse(request.body)
    requestedStreams.push(body.stream)
    return body.stream ? streamedAnswer('responses') : json(answer())
  } })
  const f = await workspaceHttp(t, { llm })
  const browser = f.client()
  await browser.login()
  const connection = await browser.json('/connect', { body: { ...input, toolsEnabled: false } })
  assert.equal(connection.data.connection.verified, true)
  assert.equal(connection.data.connection.verification.discovery, 'unavailable')
  const turn = { sessionId: 'provider-http-check', message: 'Explain a small TypeScript change.', capture: false, stream: false }
  const nonstream = await browser.json('/chat', { body: turn })
  assert.equal(nonstream.status, 200)
  assert.equal(nonstream.data.answer, 'OK')
  const stream = await browser.request('/chat', { body: { ...turn, stream: true } })
  await stream.text()
  assert.deepEqual(requestedStreams, [false, false, true])
})

test('Tatum and Walrus have independent session-bound verification and disconnect controls with no memory writes', async t => {
  const packageId = suiAddress('0xb'), accountId = suiAddress('0xa'), delegate = Ed25519Keypair.generate()
  let owner, metadataReads = 0, signedReads = 0
  const keys = []
  const f = await workspaceHttp(t, { services: {
    graphql: async (query, _variables, { apiKey }) => {
      keys.push(apiKey)
      return query.includes('Checkpoint') ? { checkpoint: { sequenceNumber: '123' } } : { object: {
        address: accountId, owner: { __typename: 'Shared' }, version: '4',
        asMoveObject: { contents: { json: { owner }, type: { repr: `${packageId}::account::MemWalAccount` } } },
      } }
    },
    deployment: async () => { metadataReads++; return { packageId, network: 'mainnet' } },
    backendFactory: () => ({ status: async () => ({ mode: 'relayer', network: 'mainnet', healthy: true, writeReady: true }), destroy() {},
      getClient: () => ({ getPublicKeyHex: async () => Buffer.from(delegate.getPublicKey().toRawBytes()).toString('hex'), listNamespaces: async () => { signedReads++; return { namespaces: [] } } }) }),
    memoryFactory: ({ backend }) => ({ status: async () => ({ mode: 'unconfigured' }), destroy() { backend?.destroy() } }),
  } })
  const browser = f.client()
  owner = (await browser.login()).pair.toSuiAddress()
  assert.equal((await browser.json('/connections/tatum', { body: { apiKey: 'synthetic-tatum-session-key' } })).status, 200)
  assert.equal((await browser.json('/connections/memwal', { body: { accountId, delegateKey: '1'.repeat(64) } })).status, 200)
  assert.equal((await browser.json('/connections/tatum/verify', { body: { apiKey: 'ignored-client-key' } })).status, 200)
  assert.equal((await browser.json('/connections/memwal/verify', { body: {} })).status, 200)
  assert.equal(metadataReads, 2)
  assert.equal(signedReads, 2)
  assert.equal(keys.includes('ignored-client-key'), false)
  assert.equal((await browser.json('/connections/memwal/disconnect', { body: {} })).status, 200)
  assert.equal(f.sessions[0].tatumKey, 'synthetic-tatum-session-key')
  assert.equal(f.sessions[0].memoryConnection, null)
  assert.equal((await browser.json('/connections/tatum/disconnect', { body: {} })).status, 200)
  assert.equal(f.sessions[0].tatumKey, '')
})
