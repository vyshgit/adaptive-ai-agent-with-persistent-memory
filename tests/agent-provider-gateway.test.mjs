import test from 'node:test'
import assert from 'node:assert/strict'
import { createLlm } from '../server/agent/llm.mjs'
import { validateConnection, publicModels } from '../server/agent/connections.mjs'
import { providerHeaders, providerHeaderOverrides, dispatchProviderRequest, normalizeProviderPayload } from '../server/agent/provider-request.mjs'
import { providerFailure } from '../server/agent/provider-errors.mjs'
import { deferred } from './helpers/workspace-http.mjs'

const key = 'SYNTHETIC_GATEWAY_KEY'
const openrouter = 'https://openrouter.ai/api/v1'
const credentials = ['authorization', 'x-api-key', 'x-goog-api-key']
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const answer = style => style === 'responses' ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }
  : { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }
const collect = async iterator => { const events = []; for await (const event of iterator) events.push(event); return events }
const connection = (baseUrl = openrouter, apiStyle = 'chat', apiKey = key) => validateConnection({ baseUrl, apiStyle, apiKey, model: 'catalogue-model' }, {})
const tool = { type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }

test('catalogue and generation share provider-specific authentication while descriptors and settled headers contain no credential', async () => {
  for (const [baseUrl, style, apiKey] of [
    ['https://api.openai.com/v1', 'responses', key], ['https://api.anthropic.com/v1', 'chat', key],
    ['https://generativelanguage.googleapis.com/v1beta/openai', 'chat', key], [openrouter, 'chat', key],
    ['http://127.0.0.1:11434/v1', 'chat', ''], ['https://router.huggingface.co/v1', 'chat', key],
  ]) {
    const config = connection(baseUrl, style, apiKey), sent = []
    assert.ok(credentials.every(name => !providerHeaders(config).has(name)))
    const llm = createLlm({ env: {}, fetchImpl: async (url, options) => {
      sent.push({ url, headers: options.headers })
      const discovery = url.endsWith('/models'), anthropic = baseUrl.includes('api.anthropic.com')
      const auth = anthropic && discovery ? 'x-api-key' : 'authorization'
      assert.equal(options.headers.get(auth), apiKey ? auth === 'authorization' ? `Bearer ${apiKey}` : apiKey : null)
      assert.ok(credentials.filter(name => name !== auth).every(name => !options.headers.has(name)))
      assert.equal(options.headers.get('anthropic-version'), anthropic ? '2023-06-01' : null)
      assert.equal(options.headers.get('http-referer'), baseUrl === openrouter ? 'http://localhost:3000' : null)
      assert.equal(options.headers.get('x-title'), baseUrl === openrouter ? 'RecallLoop' : null)
      assert.equal(options.redirect, 'error')
      if (discovery) return json({ data: [{ id: config.model }] })
      assert.equal(url, `${baseUrl}/${style === 'responses' ? 'responses' : 'chat/completions'}`)
      const body = JSON.parse(options.body)
      assert.equal(options.headers.get('accept'), 'application/json')
      assert.equal(body.model, config.model)
      assert.equal(body.store, false)
      assert.equal(body.systemInstruction, undefined)
      assert.equal(body.contents, undefined)
      assert.equal(JSON.stringify(body).includes(key), false)
      if (style === 'chat') assert.equal(body.messages[0].role, 'system')
      return json(answer(style))
    } })
    assert.deepEqual((await llm.models(config)).models, [config.model])
    assert.equal((await llm.verify(config)).verified, true)
    assert.equal(sent.length, 2)
    for (const request of sent) assert.ok(credentials.every(name => !request.headers.has(name)), `${baseUrl} must release dispatch headers`)
    assert.equal(config.apiKey, apiKey, 'the intentionally retained session credential still supports the next task')
  }
})

test('attribution overrides are host-scoped, bounded and unable to replace credentials or client identity', () => {
  const env = { AGENT_LLM_EXTRA_HEADERS: JSON.stringify({ 'HTTP-Referer': 'https://recallloop.example', 'X-Title': 'My RecallLoop',
    'OpenAI-Organization': 'org-test', 'OpenAI-Project': 'proj-test', 'anthropic-workspace-id': 'workspace-test' }) }
  const scoped = [
    [openrouter, ['http-referer', 'x-title']], ['https://api.openai.com/v1', ['openai-organization', 'openai-project']],
    ['https://api.anthropic.com/v1', ['anthropic-workspace-id']], ['http://127.0.0.1:11434/v1', []],
  ]
  for (const [baseUrl, allowed] of scoped) {
    const headers = providerHeaders(connection(baseUrl), { env })
    for (const [name, value] of Object.entries(providerHeaderOverrides(env))) assert.equal(headers.get(name), allowed.includes(name) ? value : null)
    assert.equal(headers.get('user-agent'), 'RecallLoop/0.2.0')
  }
  for (const extra of [null, [], { Authorization: 'Bearer other' }, { 'x-goog-api-key': key }, { 'User-Agent': 'Codex' },
    { 'X-Title': 'line\nbreak' }, { 'X-Title': 'a'.repeat(1001) }, { 'x-title': 'one', 'X-Title': 'two' },
    { 'HTTP-Referer': 'https://user:password@example.com' }, { 'HTTP-Referer': 'https://example.com/?key=secret' },
    { 'HTTP-Referer': 'file:///tmp/example' }, { 'X-Title': key }]) {
    assert.throws(() => providerHeaders(connection(), { env: { AGENT_LLM_EXTRA_HEADERS: JSON.stringify(extra) } }), error => {
      assert.equal(error.code, 'llm_not_configured')
      assert.equal(error.message.includes(key), false)
      return true
    })
  }
})

test('concurrent dispatches isolate profile headers and clear them independently after success, failure and abort', async () => {
  const seeds = new Headers({ authorization: 'Bearer stale', 'x-api-key': 'stale-native', 'x-goog-api-key': 'stale-google' })
  const configs = ['FIRST_PROFILE_KEY', 'SECOND_PROFILE_KEY', ''].map(value => connection(value ? openrouter : 'http://127.0.0.1:11434/v1', 'chat', value))
  const gates = configs.map(() => deferred()), controller = new AbortController(), sent = []
  const pending = configs.map((config, index) => dispatchProviderRequest(`${config.baseUrl}/models`, { headers: seeds, signal: controller.signal }, config, (_url, options) => {
    sent.push(options.headers)
    if (index === 2) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
    return gates[index].promise
  }))
  const failed = assert.rejects(pending[1], /synthetic transport failure/), aborted = assert.rejects(pending[2], { name: 'AbortError' })
  assert.notEqual(sent[0], sent[1])
  for (const [index, headers] of sent.entries()) {
    assert.equal(headers.get('authorization'), configs[index].apiKey ? `Bearer ${configs[index].apiKey}` : null)
    assert.equal(headers.has('x-api-key') || headers.has('x-goog-api-key'), false)
  }
  gates[0].resolve(json({ error: 'synthetic HTTP failure' }, 402))
  assert.equal((await pending[0]).status, 402)
  assert.equal(sent[0].has('authorization'), false)
  assert.equal(sent[1].get('authorization'), 'Bearer SECOND_PROFILE_KEY', 'another in-flight profile remains intact')
  gates[1].reject(new Error('synthetic transport failure'))
  controller.abort()
  await Promise.all([failed, aborted])
  assert.ok(sent.every(headers => credentials.every(name => !headers.has(name))))
  assert.equal(seeds.get('authorization'), 'Bearer stale', 'caller-owned input is never mutated')
})

test('the dispatch gate rejects credential redirects and method changes; native Anthropic and malformed OpenRouter settings fail before generation', async () => {
  const config = connection()
  for (const [url, method] of [[`${openrouter}/models`, 'POST'], [`${openrouter}/chat/completions`, 'GET'],
    [`${openrouter}/models?key=secret`, 'GET'], ['https://other.invalid/models', 'GET'], [`${openrouter}/chat/completions/extra`, 'POST']]) {
    await assert.rejects(dispatchProviderRequest(url, { method }, config, () => assert.fail('No inadmissible request may leave')), { code: 'network_denied' })
  }
  for (const baseUrl of ['https://api.anthropic.com', 'https://api.anthropic.com/v1/messages', 'https://openrouter.ai', 'https://openrouter.ai/v1']) {
    assert.throws(() => connection(baseUrl), error => ['invalid_request', 'provider_protocol_unsupported'].includes(error.code))
  }
  const llm = createLlm({ env: {}, fetchImpl: () => assert.fail('Native/Responses mismatch must fail before fetching') })
  const wrong = { ...connection('https://api.anthropic.com/v1'), apiStyle: 'responses' }
  await assert.rejects(llm.models(wrong), { code: 'provider_protocol_unsupported' })
  await assert.rejects(llm.verify(wrong), { code: 'provider_protocol_unsupported' })
})

test('OpenRouter capability metadata strips tools only for the selected model/protocol and explicit verification overrides catalogue hints', async () => {
  let outgoing
  const config = connection()
  const llm = createLlm({ env: {}, fetchImpl: async (url, options) => {
    if (url.endsWith('/models')) return json({ data: [
      { id: 'text-model', supported_parameters: ['temperature'] }, { id: 'tool-model', supported_parameters: ['tools', 'tool_choice'] },
      { id: 'named-text-only:free' }, { id: 'conflicting', supported_parameters: ['tools'] }, { id: 'conflicting', supported_parameters: [] },
    ] })
    outgoing = JSON.parse(options.body)
    return json(answer('chat'))
  } })
  Object.assign(config, await llm.models(config))
  const metadata = publicModels(config)
  assert.equal(metadata.find(item => item.id === 'text-model').tools, false)
  assert.equal(metadata.find(item => item.id === 'tool-model').tools, true)
  assert.equal(metadata.find(item => item.id === 'named-text-only:free').tools, undefined)
  assert.equal(metadata.find(item => item.id === 'conflicting').tools, false)
  const check = (model, apiStyle, tools) => ({ model, apiStyle, tools, generation: 'verified' })
  for (const [model, verification, enabled, expected] of [
    ['text-model', null, true, false], ['tool-model', null, true, true], ['named-text-only:free', null, true, true],
    ['text-model', check('text-model', 'chat', 'verified'), true, true], ['tool-model', check('tool-model', 'chat', 'unsupported'), true, false],
    ['tool-model', check('other-model', 'chat', 'unsupported'), true, true], ['tool-model', check('tool-model', 'responses', 'unsupported'), true, true],
    ['tool-model', check('tool-model', 'chat', 'failed'), true, true], ['tool-model', check('tool-model', 'chat', 'verified'), false, false],
  ]) {
    await collect(llm.streamCompletion({ config: { ...config, verification, toolsEnabled: enabled }, model, tools: [tool], toolChoice: 'read_file',
      messages: [{ role: 'user', content: 'Inspect if supported.' }], stream: false }))
    assert.equal(Boolean(outgoing.tools), expected)
    assert.equal(Boolean(outgoing.tool_choice), expected)
  }
})

test('text-only normalization removes orphaned tool history without promoting it to user prose or mutating the original', async () => {
  const config = { ...connection(), toolsEnabled: false }
  const messages = [{ role: 'system', content: 'Trusted system' }, { role: 'user', content: 'Current task' },
    { role: 'assistant', content: 'Visible prose', tool_calls: [{ id: 'old-call', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'assistant', content: null, function_call: { name: 'read_file', arguments: '{}' } },
    { role: 'tool', tool_call_id: 'old-call', content: 'PRIVATE_TOOL_RESULT' }, { role: 'function', name: 'read_file', content: 'PRIVATE_LEGACY_RESULT' }]
  const input = { model: config.model, messages, tools: [tool], functions: [tool.function], tool_choice: 'auto', function_call: 'auto', parallel_tool_calls: false }
  const original = JSON.stringify(input), plain = normalizeProviderPayload(input, config)
  assert.deepEqual(plain.messages, [{ role: 'system', content: 'Trusted system' }, { role: 'user', content: 'Current task' }, { role: 'assistant', content: 'Visible prose' }])
  for (const name of ['tools', 'functions', 'tool_choice', 'function_call', 'parallel_tool_calls']) assert.equal(Object.hasOwn(plain, name), false)
  assert.equal(JSON.stringify(input), original)
  // The same normalization must hold on the live dispatch path, including the
  // Responses-style adapter's converted tool history and the credential-free headers.
  let admitted
  const resConfig = { ...config, apiStyle: 'responses' }
  const llm = createLlm({ env: {}, fetchImpl: async (_url, options) => { admitted = JSON.parse(options.body); return json(answer('responses')) } })
  await collect(llm.streamCompletion({ config: resConfig, model: config.model, tools: [tool], stream: false,
    messages: [{ role: 'user', content: 'Current task' }, { role: 'assistant', content: '', tool_calls: [{ id: 'old-call', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'old-call', content: 'PRIVATE_RESULT' }] }))
  assert.equal(admitted.input.length, 1)
  assert.equal(admitted.tools, undefined)
  assert.equal(admitted.tool_choice, undefined)
  assert.equal(JSON.stringify(admitted).includes('PRIVATE_RESULT'), false)
})

test('token budgets and sampling settings match each provider protocol without propagating credentials', async () => {
  for (const [baseUrl, model, expectedToken] of [
    ['https://generativelanguage.googleapis.com/v1beta/openai', 'catalogue-model', 'max_tokens'],
    ['https://api.openai.com/v1', 'gpt-5-catalogue-model', 'max_completion_tokens'],
    ['https://api.anthropic.com/v1', 'catalogue-model', 'max_tokens'],
  ]) {
    const config = { ...connection(baseUrl), model }
    let admitted, admittedHeaders
    const llm = createLlm({ env: {}, fetchImpl: async (_url, options) => { admitted = JSON.parse(options.body); admittedHeaders = options.headers; return json(answer('chat')) } })
    await collect(llm.streamCompletion({ config, model, tools: [tool], stream: false,
      messages: [{ role: 'system', content: 'Trusted system' }, { role: 'user', content: 'Task' }] }))
    const google = baseUrl.includes('googleapis'), anthropic = baseUrl.includes('anthropic')
    assert.equal(admitted[expectedToken], 4000)
    assert.equal(admitted[expectedToken === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'], undefined)
    assert.equal(admitted.parallel_tool_calls, google ? undefined : undefined)
    assert.equal(admitted.temperature, undefined)
    assert.equal(admitted.top_p, undefined)
    assert.equal(admitted.messages[0].role, 'system')
    assert.ok(credentials.every(name => !admittedHeaders.has(name)))
  }
})

test('failed forced-tool checks do not disable automatic tools and explicit rechecks can probe a previously unsupported model', async () => {
  const config = connection('https://api.anthropic.com/v1'), sent = []
  const llm = createLlm({ env: {}, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); sent.push(body)
    if (body.tools) return json({ error: { message: `Forced tool use is not supported ${key}` } }, 400)
    return body.stream ? new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }) : json(answer('chat'))
  } })
  const result = await llm.verify({ ...config, verification: { model: config.model, apiStyle: 'chat', generation: 'verified', tools: 'unsupported' } }, { checkCapabilities: true })
  assert.equal(result.verified, true)
  assert.equal(result.verification.tools, 'failed')
  assert.equal(result.verification.toolsError.code, 'provider_tool_choice_unsupported')
  assert.equal(sent.length, 3)
  assert.ok(sent[2].tools?.length)
  assert.equal(JSON.stringify(result).includes(key), false)
})

test('restriction, quota and incompatible-request diagnostics stay actionable without echoing provider bodies', () => {
  for (const [status, body, expected, hint] of [
    [400, 'Invalid system schema', 'provider_request_failed', /system schema/],
    [402, 'Payment required', 'provider_quota', /OpenRouter credits/],
    [403, 'Unsupported country', 'provider_region_restricted', /region eligibility/],
    [403, 'Proxy access blocked', 'provider_network_restricted', /proxy/],
    [403, 'Account is unverified', 'provider_account_restricted', /verification/],
    [403, 'Permission denied', 'provider_forbidden', /account\/project permissions/],
    [429, 'Too many requests', 'provider_rate_limited', /daily or per-minute/],
  ]) {
    const failure = providerFailure(status, `${body}; ${key}; PRIVATE_UPSTREAM_PROMPT`, openrouter)
    assert.equal(failure.code, expected)
    assert.match(failure.message, hint)
    assert.equal(failure.message.includes(key) || failure.message.includes('PRIVATE_UPSTREAM_PROMPT'), false)
  }
})
