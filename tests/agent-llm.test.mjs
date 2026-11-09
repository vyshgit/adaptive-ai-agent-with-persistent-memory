import test from 'node:test'
import assert from 'node:assert/strict'
import { createLlm, toResponsesInput } from '../server/agent/llm.mjs'
import { validateConnection } from '../server/agent/connections.mjs'
import { TOOL_SCHEMAS } from '../server/agent/tools.mjs'
import { runChat, validateChat } from '../server/agent/chat.mjs'

const config = apiStyle => validateConnection({ baseUrl: 'https://api.openai.com/v1', apiKey: 'synthetic-provider-key', model: 'test-model', apiStyle })
const collect = async iterator => { const result = []; for await (const item of iterator) result.push(item); return result }
const messages = [{ role: 'system', content: 'RecallLoop test instructions' }, { role: 'user', content: 'Fix the greeting' }]
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const wire = (data, event) => `${event ? `event: ${event}\r\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\r\n\r\n`
function sse(frames, chunkSize = 7) {
  const bytes = new TextEncoder().encode(frames.join(''))
  const body = new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize))
    controller.close()
  } })
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}
function run(fetchImpl, style = 'chat', options = {}) {
  return collect(createLlm({ fetchImpl, mockDelayMs: 0 }).streamCompletion({ messages, config: config(style), model: 'test-model', tools: TOOL_SCHEMAS, ...options }))
}

test('Responses input encodes tool calls/results without sending system content as user input', () => {
  const input = toResponsesInput([...messages, { role: 'assistant', content: 'Inspecting', toolCalls: [{ id: 'call-a', name: 'read_file', args: { path: 'src/a.ts' } }] },
    { role: 'tool', toolCallId: 'call-a', content: '{"content":"example"}' }])
  assert.equal(input.some(item => item.role === 'system'), false)
  assert.equal(input[1].content[0].type, 'output_text')
  assert.deepEqual(input[2], { type: 'function_call', call_id: 'call-a', name: 'read_file', arguments: '{"path":"src/a.ts"}' })
  assert.deepEqual(input[3], { type: 'function_call_output', call_id: 'call-a', output: '{"content":"example"}' })
})

test('Responses tool rounds and follow-up turns resend local text without provider-stored response, message or reasoning state', async () => {
  const connection = validateConnection({ baseUrl: 'https://agentrouter.org/v1', apiKey: 'synthetic-provider-key', model: 'test-model', apiStyle: 'responses' })
  const project = { name: 'Stateless workspace', files: [{ path: 'src/a.ts', content: 'export const value = 1\n' }], activeFile: 'src/a.ts' }
  const memory = { recall: async () => ({ context: 'No relevant memories yet.', memories: [], strategy: 'mock-lexical', meta: { tokenEstimate: 0 } }) }
  let requests = 0
  const llm = createLlm({ env: {}, fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body)
    assert.equal(body.store, false)
    assert.equal(Object.hasOwn(body, 'previous_response_id'), false)
    assert.equal(Object.hasOwn(body, 'conversation'), false)
    assert.ok(body.input.every(item => !Object.hasOwn(item, 'id') && !Object.hasOwn(item, 'encrypted_content')
      && !['reasoning', 'item_reference'].includes(item.type)))
    assert.equal(JSON.stringify(body).includes('provider-only-'), false)
    requests++
    if (requests === 1) return json({ id: 'provider-only-response', status: 'completed', output: [
      { type: 'reasoning', id: 'provider-only-reasoning', encrypted_content: 'provider-only-encrypted' },
      { type: 'message', id: 'provider-only-message', content: [{ type: 'output_text', text: 'Inspecting the selected file.' }] },
      { type: 'function_call', id: 'provider-only-function', call_id: 'call-read', name: 'read_file', arguments: '{"path":"src/a.ts"}' },
    ] })
    if (requests === 2) {
      assert.deepEqual(body.input.find(item => item.type === 'function_call'), { type: 'function_call', call_id: 'call-read', name: 'read_file', arguments: '{"path":"src/a.ts"}' })
      assert.match(body.input.find(item => item.type === 'function_call_output').output, /export const value = 1/)
    } else {
      assert.ok(body.input.some(item => item.role === 'assistant' && item.content[0].text.includes('The selected file defines value.')))
      assert.equal(body.input.some(item => item.type === 'function_call'), false)
    }
    return json({ id: 'provider-only-next-response', status: 'completed', output: [
      { type: 'message', id: 'provider-only-next-message', content: [{ type: 'output_text', text: 'The selected file defines value.' }] },
    ] })
  } })
  const input = validateChat({ sessionId: 'stateless', message: 'Inspect the selected file.', project, capture: false, stream: false }, connection)
  const events = await collect(runChat({ input, memory, llm, agentId: 'a', config: connection }))
  const answer = events.filter(event => event.type === 'delta').map(event => event.data.text).join('')
  const followUp = validateChat({ sessionId: 'stateless', message: 'Explain the value.', project, capture: false, stream: false,
    history: [{ role: 'user', content: input.message }, { role: 'assistant', content: answer }] }, connection)
  await collect(runChat({ input: followUp, memory, llm, agentId: 'a', config: connection }))
  assert.equal(requests, 3)
})

test('Chat Completions SSE assembles fragmented tool IDs, names, and JSON arguments', async () => {
  const events = await run(async (url, request) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions')
    assert.equal(request.redirect, 'error')
    assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-provider-key')
    const body = JSON.parse(request.body)
    assert.equal(body.store, false)
    assert.equal(body.stream, true)
    assert.equal(body.messages[0].role, 'system')
    assert.deepEqual(body.tools, TOOL_SCHEMAS)
    return sse([
      ': heartbeat\r\n\r\n',
      wire({ choices: [{ delta: { content: 'Hello 🌍', tool_calls: [{ index: 0, id: 'call-', function: { name: 'read_', arguments: '{"path":' } }] } }] }),
      wire({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'file', arguments: '"src/a.ts"}' } }] } }] }),
      wire({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }), wire('[DONE]'),
    ], 1)
  })
  assert.deepEqual(events.find(event => event.type === 'tool_call'), { type: 'tool_call', id: 'call-a', name: 'read_file', args: { path: 'src/a.ts' } })
  assert.equal(events[0].text, 'Hello 🌍')
  assert.equal(events.at(-1).reason, 'tool_calls')
})

test('Responses SSE maps function arguments and completed output with the actual call ID', async () => {
  const events = await run(async (url, request) => {
    assert.equal(url, 'https://api.openai.com/v1/responses')
    const body = JSON.parse(request.body)
    assert.equal(body.instructions, messages[0].content)
    assert.deepEqual(body.tools.map(tool => tool.name), TOOL_SCHEMAS.map(tool => tool.function.name))
    assert.equal(body.tools.find(tool => tool.name === 'plan_task').parameters.properties.steps.maxItems, 6)
    assert.equal(body.tools.find(tool => tool.name === 'ask_user').parameters.properties.options.maxItems, 4)
    assert.equal(body.store, false)
    return sse([
      wire({ type: 'response.output_text.delta', delta: 'Inspecting. ' }),
      wire({ type: 'response.output_item.added', item: { type: 'function_call', id: 'item-a', call_id: 'call-a', name: 'read_file', arguments: '' } }),
      wire({ type: 'response.function_call_arguments.delta', item_id: 'item-a', delta: '{"path":"src/' }),
      wire({ type: 'response.function_call_arguments.delta', item_id: 'item-a', delta: 'a.ts"}' }),
      wire({ type: 'response.completed', response: { status: 'completed', output: [] } }),
    ])
  }, 'responses')
  assert.equal(events[0].text, 'Inspecting. ')
  assert.equal(events[1].id, 'call-a')
  assert.deepEqual(events[1].args, { path: 'src/a.ts' })
})

test('Responses completion-only function calls are recovered and incomplete answers are labelled', async () => {
  const events = await run(async () => sse([wire({ type: 'response.completed', response: { output: [
    { type: 'function_call', id: 'item-final', call_id: 'call-final', name: 'list_files', arguments: '{}' },
  ] } })]), 'responses')
  assert.equal(events[0].id, 'call-final')
  const incomplete = await run(async () => sse([wire({ type: 'response.output_text.delta', delta: 'Partial' }), wire({ type: 'response.incomplete' })]), 'responses')
  assert.equal(incomplete.at(-1).reason, 'length')
})

test('both API styles accept honest non-streamed JSON responses', async () => {
  for (const style of ['chat', 'responses']) {
    const data = style === 'responses' ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'JSON answer' }] }] }
      : { choices: [{ message: { content: 'JSON answer' }, finish_reason: 'stop' }] }
    const events = await run(async () => json(data), style)
    assert.equal(events[0].text, 'JSON answer')
    assert.equal(events.at(-1).reason, 'stop')
  }
})

test('stream fallback is attempted once only for an explicit unsupported-stream response', async () => {
  let attempts = 0
  const events = await run(async (_url, request) => {
    attempts++
    assert.equal(JSON.parse(request.body).stream, attempts === 1)
    return attempts === 1 ? json({ error: 'Streaming is not supported by this model' }, 400) : json({ choices: [{ message: { content: 'Fallback answer' } }] })
  })
  assert.equal(events[0].text, 'Fallback answer')
  assert.equal(attempts, 2)
  attempts = 0
  await assert.rejects(run(async () => { attempts++; return json({ error: 'Invalid model' }, 400) }), { code: 'provider_model_unavailable' })
  assert.equal(attempts, 1)
})

test('provider refusals, client restrictions, and error bodies never echo credentials or spoof identity', async () => {
  for (const status of [401, 403, 402, 429, 500]) {
    await assert.rejects(run(async (_url, request) => {
      assert.equal(request.headers.get('User-Agent'), 'RecallLoop/0.2.0')
      return json({ error: 'synthetic-provider-key upstream debug' }, status)
    }), error => error.code.startsWith('provider_') && !error.message.includes('synthetic-provider-key'))
  }
  const llm = createLlm({ env: { AGENT_LLM_EXTRA_HEADERS: '{"User-Agent":"another-approved-client"}' }, fetchImpl: () => { assert.fail('An impersonation header must not reach fetch') } })
  await assert.rejects(collect(llm.streamCompletion({ messages, config: config('responses'), model: 'test-model' })), /Only legitimate attribution/)
})

test('truncated or malformed SSE preserves deltas but does not declare completion', async () => {
  const events = []
  const llm = createLlm({ fetchImpl: async () => sse([wire({ choices: [{ delta: { content: 'Partial answer' } }] })]) })
  await assert.rejects((async () => {
    for await (const event of llm.streamCompletion({ messages, config: config('chat'), model: 'test-model' })) events.push(event)
  })(), /ended before completion/)
  assert.equal(events[0].text, 'Partial answer')
  await assert.rejects(run(async () => sse([wire('{bad JSON')])), /malformed stream/)
  await assert.rejects(run(async () => sse([wire({ type: 'response.failed' })]), 'responses'), /generation failure/)
})

test('tool argument corruption and excessive streamed IDs/arguments are bounded', async () => {
  const malformed = await run(async () => json({ choices: [{ message: { tool_calls: [{ id: 'a', function: { name: 'read_file', arguments: '{bad' } }] } }] }))
  assert.deepEqual(malformed[0].args, { invalidArguments: true })
  for (const field of ['id', 'name', 'arguments']) {
    const call = { id: 'call-a', function: { name: 'read_file', arguments: '{}' }, index: 0 }
    if (field === 'id') call.id = 'x'.repeat(129)
    else call.function[field] = 'x'.repeat(field === 'name' ? 65 : 32_001)
    await assert.rejects(run(async () => sse([wire({ choices: [{ delta: { tool_calls: [call] }, finish_reason: 'tool_calls' }] })], 1000)), /size limit|invalid format/)
  }
})

test('models discovery is bounded, deduplicated, and honest about fallback/authorization', async () => {
  const llm = createLlm({ fetchImpl: async () => json({ data: [{ id: 'other-model' }, { id: 'other-model' }, { id: 'bad model with spaces' }] }) })
  assert.deepEqual(await llm.models(config('responses')), { models: ['test-model', 'other-model'], discovered: true, verified: false })
  const unsupported = createLlm({ fetchImpl: async () => json({}, 404) })
  assert.deepEqual(await unsupported.models(config('chat')), { models: ['test-model'], discovered: false, verified: false })
  const denied = createLlm({ fetchImpl: async () => json({}, 403) })
  await assert.rejects(denied.models(config('chat')), /client allowlist/)
  const malformed = createLlm({ fetchImpl: async () => json({ models: [] }) })
  await assert.rejects(malformed.models(config('chat')), /data array/)
})

test('mock generation and cancellation make no provider requests', async () => {
  const llm = createLlm({ fetchImpl: () => { assert.fail('The mock must stay offline') }, mockDelayMs: 0 })
  const mock = validateConnection({ mode: 'mock' })
  const events = await collect(llm.streamCompletion({ messages, config: mock, model: mock.model, project: { files: [] } }))
  assert.match(events.filter(event => event.type === 'delta').map(event => event.text).join(''), /deterministic offline demo/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(collect(llm.streamCompletion({ messages, config: mock, project: { files: [] }, signal: controller.signal })), { name: 'AbortError' })
})
