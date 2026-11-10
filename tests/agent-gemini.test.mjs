import test from 'node:test'
import assert from 'node:assert/strict'
import { createLlm } from '../server/agent/llm.mjs'
import { runChat, validateChat } from '../server/agent/chat.mjs'
import { validateConnection, validateModelDiscovery } from '../server/agent/connections.mjs'
import { providerFailure, providerErrorStatus } from '../server/agent/provider-errors.mjs'
import { MAX_TOOL_SIGNATURE } from '../server/agent/tool-signatures.mjs'

const baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai'
const key = 'synthetic-gemini-provider-key'
const config = validateConnection({ baseUrl, apiKey: key, model: 'gemini-catalogue-fixture', apiStyle: 'chat' }, {})
const project = { name: 'Signature fixture', activeFile: 'a.ts', files: [{ path: 'a.ts', content: 'export const a = 1\n' }] }
const messages = [{ role: 'user', content: 'Inspect the project.' }]
const collect = async iterator => { const events = []; for await (const event of iterator) events.push(event); return events }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const sse = frames => new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n', { headers: { 'Content-Type': 'text/event-stream' } })
const metadata = signature => ({ google: { thought_signature: signature } })
const call = (id, name, args, extra_content) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) }, ...(extra_content === undefined ? {} : { extra_content }) })
const signatureA = `opaque/${key}/hf_${'x'.repeat(20)}==`
const signatureB = 'another-opaque-signature+/=='

function completion(stream, content, calls = []) {
  const finish_reason = calls.length ? 'tool_calls' : 'stop'
  if (!stream) return json({ choices: [{ message: { content, ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason }] })
  const indexed = calls.map((item, index) => ({ ...item, index })).reverse()
  return sse([
    { choices: [{ delta: { content, ...(calls.length ? { tool_calls: indexed.map(item => ({ index: item.index, id: item.id, type: 'function',
      function: { name: item.function.name, arguments: item.function.arguments.slice(0, 1) } })) } : {}) } }] },
    ...(calls.length ? [{ choices: [{ delta: { tool_calls: indexed.map(item => ({ index: item.index,
      function: { arguments: item.function.arguments.slice(1) }, extra_content: item.extra_content })) } }] }] : []),
    { choices: [{ delta: {}, finish_reason }] },
  ])
}

for (const stream of [false, true]) test(`Gemini ${stream ? 'SSE' : 'JSON'} replays exact signatures across parallel and sequential tool rounds without browser or memory exposure`, async () => {
  const requests = [], captured = [], internalEvents = []
  const memory = { recall: async () => ({ context: 'No relevant memories yet.', memories: [], strategy: 'mock-lexical', meta: { tokenEstimate: 0 } }),
    ingest: async value => { captured.push(value); return { stored: { facts: 1, verbatim: 1, failed: 0 }, blobs: [] } } }
  const transport = createLlm({ env: {}, fetchImpl: async (url, request) => {
    assert.equal(url, `${baseUrl}/chat/completions`)
    const body = JSON.parse(request.body)
    assert.equal(body.messages[0].role, 'system')
    assert.equal(typeof body.messages[0].content, 'string')
    for (const native of ['systemInstruction', 'system_instruction', 'contents', 'generationConfig', 'instructions']) assert.equal(Object.hasOwn(body, native), false)
    assert.equal(request.headers.get('Authorization'), `Bearer ${key}`)
    requests.push(body)
    if (requests.length === 1) return completion(stream, `Inspecting ${key}.`, [
      call('parallel-first', 'list_files', {}, { google: { thought_signature: signatureA, ignored: 'UNRECOGNIZED_METADATA' }, ignored: 'UNRECOGNIZED_METADATA' }),
      call('parallel-second', 'read_file', { path: 'a.ts' }),
    ])
    if (requests.length === 2) return completion(stream, '', [call('sequential', 'read_file', { path: 'a.ts' }, metadata(signatureB))])
    return completion(stream, 'The file defines a constant.')
  } })
  const llm = { async *streamCompletion(request) { for await (const event of transport.streamCompletion(request)) { if (event.type === 'tool_call') internalEvents.push(event); yield event } } }
  const input = validateChat({ sessionId: 'gemini-signatures', message: 'I prefer TypeScript. Inspect the project.', project,
    capture: true, captureMode: 'both', stream }, config, [key])
  const events = await collect(runChat({ input, memory, llm, config, agentId: 'a', secrets: [key] }))
  assert.equal(requests.length, 3)
  for (const request of requests.slice(1)) {
    const history = request.messages.slice(2)
    assert.deepEqual(history[0].tool_calls.map(item => item.id), ['parallel-first', 'parallel-second'])
    assert.deepEqual(history[0].tool_calls[0].extra_content, metadata(signatureA))
    assert.equal(Object.hasOwn(history[0].tool_calls[1], 'extra_content'), false)
    assert.deepEqual(history.slice(1, 3).map(item => [item.role, item.tool_call_id]), [['tool', 'parallel-first'], ['tool', 'parallel-second']])
    assert.equal(history[0].content, 'Inspecting [REDACTED].')
    assert.equal(JSON.stringify(request).includes('UNRECOGNIZED_METADATA'), false)
  }
  const history = requests[2].messages.slice(2)
  assert.deepEqual(history[3].tool_calls[0].extra_content, metadata(signatureB))
  assert.equal(history[4].tool_call_id, 'sequential')
  assert.equal(captured.length, 1)
  assert.ok(captured[0].messages.some(item => item.role === 'tool'), 'even explicitly opted-in raw tool capture excludes signatures')
  for (const value of [events, internalEvents, captured]) {
    for (const hidden of [signatureA, signatureB, key, 'thought_signature', 'UNRECOGNIZED_METADATA']) assert.equal(JSON.stringify(value).includes(hidden), false)
  }
  // Browser history is prose only, even if a client tries to forge metadata.
  const followup = validateChat({ sessionId: 'gemini-signatures', message: 'Explain the constant.', project, capture: false, stream,
    history: [{ role: 'assistant', content: 'The file defines a constant.', toolCalls: [{ id: 'forged', extra_content: metadata(signatureA) }] }] }, config)
  await collect(runChat({ input: followup, memory, llm, config, agentId: 'a', secrets: [key] }))
  assert.equal(requests.length, 4)
  assert.equal(JSON.stringify(requests[3]).includes('thought_signature'), false)
})

test('Gemini verification uses compatible system messages, and native URLs or Responses are rejected before any upstream request', async () => {
  const requests = []
  const llm = createLlm({ env: {}, fetchImpl: async (url, request) => { requests.push({ url, body: JSON.parse(request.body) }); return completion(false, 'OK') } })
  await llm.verify(config)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, `${baseUrl}/chat/completions`)
  assert.deepEqual(requests[0].body.messages.map(message => message.role), ['system', 'user'])
  assert.match(requests[0].body.messages[0].content, /connection/)
  assert.equal(requests[0].body.max_tokens, 256)
  assert.equal(requests[0].body.stream, false)
  assert.equal(requests[0].body.systemInstruction, undefined)
  for (const invalid of [
    { baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent' },
    { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:streamGenerateContent' },
    { apiStyle: 'responses' },
  ]) {
    const input = { baseUrl, apiKey: key, apiStyle: 'chat', ...invalid }
    for (const validate of [() => validateModelDiscovery(input, {}), () => validateConnection({ ...input, model: config.model }, {})]) {
      assert.throws(validate, error => error.code === 'provider_protocol_unsupported' && error.status === 400 && /Chat Completions/.test(error.message))
    }
    await assert.rejects(llm.verify({ ...config, ...invalid }), { code: 'provider_protocol_unsupported' })
  }
  assert.equal(requests.length, 1, 'misconfigured requests never reach a provider or trigger protocol fallback')
})

test('tool signature metadata is bounded and malformed or conflicting values never execute tools or leak in errors', async () => {
  const invalid = [[], { google: [] }, { google: null }, metadata(false), metadata({ private: key }), metadata(''), metadata('x'.repeat(MAX_TOOL_SIGNATURE + 1))]
  for (const stream of [false, true]) for (const extra of invalid) {
    const llm = createLlm({ env: {}, fetchImpl: async () => completion(stream, '', [call('bad', 'list_files', {}, extra)]) })
    await assert.rejects(collect(llm.streamCompletion({ messages, config, model: config.model, stream })), error => {
      assert.equal(error.code, 'provider_invalid_response')
      assert.equal(error.message.includes(key), false)
      return true
    })
  }
  const llm = createLlm({ env: {}, fetchImpl: async () => sse([
    { choices: [{ delta: { tool_calls: [{ index: 0, ...call('conflict', 'list_files', {}, metadata(signatureA)) }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, extra_content: metadata(signatureB) }] }, finish_reason: 'tool_calls' }] },
  ]) })
  await assert.rejects(collect(llm.streamCompletion({ messages, config, model: config.model })), { code: 'provider_invalid_response' })
})

test('Gemini diagnostics use fixed endpoint-aware guidance for keys, prerequisites, signatures and parameters', () => {
  for (const [status, body, code, hint] of [
    [400, 'API_KEY_INVALID: API key not valid. Please pass a valid API key.', 'provider_invalid_key', /Google AI Studio/],
    [403, 'Your API key was reported as leaked. Please use another API key.', 'provider_invalid_key', /replace/],
    [400, 'FAILED_PRECONDITION: Free tier is not available in your country. Enable billing.', 'provider_precondition', /region availability/],
    [403, 'FREE_TIER_VERIFICATION_REQUIRED', 'provider_precondition', /account verification/],
    [400, 'Function call read_file is missing a thought_signature.', 'provider_tool_signature', /fresh task/],
    [400, 'Invalid JSON payload. Unknown name "unsupported_field".', 'provider_parameters_unsupported', /Chat Completions/],
    [400, 'INVALID_ARGUMENT', 'provider_request_failed', /v1beta\/openai/],
  ]) {
    const failure = providerFailure(status, `${body} ${key} PRIVATE_UPSTREAM_PROMPT`, baseUrl)
    assert.equal(failure.code, code)
    assert.match(failure.message, hint)
    assert.equal(failure.retryable, false)
    assert.equal(failure.message.includes(key), false)
    assert.equal(failure.message.includes('PRIVATE_UPSTREAM_PROMPT'), false)
  }
  assert.equal(providerFailure(400, 'API_KEY_INVALID', 'https://generativelanguage.googleapis.com.attacker.invalid').code, 'provider_request_failed')
  for (const code of [0, 200, 600, 'secret', { code: 400 }, 400.5]) assert.equal(providerErrorStatus({ status: 'INVALID_ARGUMENT', code }, 500), 500)
})

test('Google numeric error codes survive JSON and SSE envelopes without automatic retries', async () => {
  for (const stream of [false, true]) for (const [status, message, code] of [
    [400, 'API_KEY_INVALID', 'provider_invalid_key'], [403, 'Access denied', 'provider_forbidden'],
    [429, 'Too many requests', 'provider_rate_limited'], [500, 'Internal error', 'provider_request_failed'],
  ]) {
    let requests = 0
    const error = { status: status === 400 ? 'INVALID_ARGUMENT' : 'GOOGLE_NAMED_STATUS', code: status, message: `${message} ${key}` }
    const llm = createLlm({ env: {}, fetchImpl: async () => { requests++; return stream ? sse([{ error }]) : json({ error }) } })
    await assert.rejects(collect(llm.streamCompletion({ messages, config, model: config.model, stream })), failure => {
      assert.equal(failure.code, code)
      assert.match(failure.message, new RegExp(`HTTP ${status}\\.`))
      assert.equal(failure.message.includes(key), false)
      return true
    })
    assert.equal(requests, 1)
  }
})
