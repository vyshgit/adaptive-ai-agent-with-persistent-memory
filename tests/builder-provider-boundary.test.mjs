import test from 'node:test'
import assert from 'node:assert/strict'
import { modelRequest, boundedModelResponse, redactModelMessages, sdkProviderFailure } from '../server/builder/provider-boundary.mjs'

const config = { baseUrl: 'http://127.0.0.1:8000/v1', model: 'chosen-model', apiKey: 'synthetic-provider-key', apiStyle: 'responses' }
const body = { model: config.model, stream: true, store: true, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Task' }] }] }
const request = (payload = body, url = `${config.baseUrl}/responses`, init = {}) => new Request(url, { method: 'POST',
  body: JSON.stringify(payload), headers: { 'X-Shared-Credential': 'must-not-inherit', Authorization: 'Bearer wrong' }, ...init })

test('the model fetch gate admits only the exact selected endpoint/model and explicit headers with bounded tokens', async () => {
  const admitted = await modelRequest(request({ ...body, max_output_tokens: 100_000 }), config)
  const payload = JSON.parse(admitted.body)
  assert.equal(payload.store, false)
  assert.equal(payload.max_output_tokens, 4096)
  assert.equal(payload.parallel_tool_calls, undefined, 'tool directives are omitted on a request without tools')
  assert.equal(admitted.redirect, 'error')
  assert.equal(admitted.headers.has('authorization'), false, 'credentials are injected only by the dispatch boundary')
  assert.equal(JSON.stringify({ ...admitted, headers: [...admitted.headers] }).includes(config.apiKey), false)
  assert.equal(admitted.headers.has('X-Shared-Credential'), false)
  for (const url of [`${config.baseUrl}/models`, `${config.baseUrl}/responses?query=x`, `${config.baseUrl}/chat/completions`, 'http://127.0.0.1:8001/v1/responses']) {
    await assert.rejects(modelRequest(request(body, url), config), { code: 'network_denied' })
  }
  for (const payload of [{ ...body, model: 'another-model' }, { ...body, stream: false }, { ...body, max_output_tokens: -1 }]) {
    await assert.rejects(modelRequest(request(payload), config), { code: 'network_denied' })
  }
  await assert.rejects(modelRequest(request(), null), { code: 'network_denied' })
})

test('Responses replay is local full text, without provider references, opaque reasoning, hosted tools or compaction', async () => {
  const admitted = await modelRequest(request({ ...body, input: [
    ...body.input, { type: 'reasoning', id: 'provider-only-reasoning', summary: [], encrypted_content: 'opaque' },
    { type: 'function_call', id: 'provider-only-function', call_id: 'local-call', name: 'read_file', arguments: '{}' },
    { type: 'function_call_output', call_id: 'local-call', output: 'local result' },
  ] }), config)
  const payload = JSON.parse(admitted.body)
  assert.equal(admitted.body.includes('provider-only'), false)
  assert.equal(admitted.body.includes('opaque'), false)
  assert.equal(payload.input[1].call_id, 'local-call')
  assert.equal(payload.input[2].output, 'local result')
  for (const extra of [{ previous_response_id: 'remote' }, { conversation: 'remote' }, { context_management: [] },
    { input: [{ type: 'item_reference', id: 'remote' }] }, { tools: [{ type: 'web_search' }] }, { background: true }]) {
    await assert.rejects(modelRequest(request({ ...body, ...extra }), config), { code: 'network_denied' })
  }
})

test('oversized request and response bodies are stopped at the byte boundary', async () => {
  await assert.rejects(modelRequest(request({ ...body, instructions: 'x'.repeat(512_001) }), config), { code: 'network_denied' })
  const response = boundedModelResponse(new Response('x'.repeat(1001)), { maxBytes: 1000 })
  await assert.rejects(response.text(), { code: 'output_limit' })
  assert.equal(await boundedModelResponse(new Response('small')).text(), 'small')
})

test('SDK context redaction preserves only the bounded assistant tool signature and still scrubs tool input, output and other metadata', () => {
  const signature = `opaque/${config.apiKey}/hf_${'x'.repeat(20)}==`
  const extraContent = { google: { thought_signature: signature, unwanted: config.apiKey }, unwanted: config.apiKey }
  const messages = [
    { role: 'user', content: [{ type: 'text', text: config.apiKey }] },
    { role: 'assistant', content: [{ type: 'text', text: config.apiKey }, { type: 'tool-call', id: 'read', name: 'read_file', input: { path: config.apiKey,
      providerMetadata: { 'openai-compatible': { extraContent } } }, providerMetadata: { 'openai-compatible': { extraContent, other: config.apiKey } } }] },
    { role: 'tool', content: [{ type: 'tool-result', id: 'read', name: 'read_file', result: { type: 'text', value: config.apiKey } }] },
  ]
  const clean = redactModelMessages(messages, [config.apiKey])
  assert.deepEqual(clean[1].content[1].providerMetadata['openai-compatible'].extraContent, { google: { thought_signature: signature } })
  assert.equal(clean[1].content[1].providerMetadata['openai-compatible'].other, '[REDACTED]')
  delete clean[1].content[1].providerMetadata['openai-compatible'].extraContent
  assert.equal(JSON.stringify(clean).includes(config.apiKey), false)
  assert.equal(JSON.stringify(clean).includes(signature), false)
  assert.equal(messages[1].content[1].providerMetadata['openai-compatible'].extraContent, extraContent, 'the SDK history is not mutated')
})

test('SDK structured Google errors preserve numeric envelope codes and never expose provider bodies', () => {
  const failure = sdkProviderFailure({ type: 'provider.invalid-output', status: 200,
    response: { body: JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: `API_KEY_INVALID ${config.apiKey}` } }) } },
  'https://generativelanguage.googleapis.com/v1beta/openai')
  assert.equal(failure.code, 'provider_invalid_key')
  assert.match(failure.message, /HTTP 400/)
  assert.equal(failure.message.includes(config.apiKey), false)
  assert.equal(sdkProviderFailure({ type: 'tool.execution', message: config.apiKey }, config.baseUrl), null)
})
