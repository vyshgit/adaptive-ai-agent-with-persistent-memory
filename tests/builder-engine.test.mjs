import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createOpencodeEngine, engineEnvironment } from '../server/builder/opencode-engine.mjs'
import { createLocalFiles } from '../server/builder/filesystem.mjs'
import { temporaryProject, offlineModel, chatFrames, responsesFrames } from './helpers/builder-fixture.mjs'
import { deferred } from './helpers/workspace-http.mjs'
import { BUILDER_LIMITS } from '../server/builder/policy.mjs'

const engineFor = async (t, directory) => {
  const engine = await createOpencodeEngine({ directory })
  t.after(() => engine.close())
  return engine
}
const command = (directory, text, timeoutMs = 10_000) => ({ command: text, cwd: '.', absoluteCwd: directory, timeoutMs })

test('worker environment is allowlisted and private, not a shared OpenCode login or app credential environment', () => {
  const env = engineEnvironment('/project', '/private', { PATH: '/project/bin:.:/usr/bin', HOME: '/shared/home',
    OPENAI_API_KEY: 'synthetic-secret', TATUM_API_KEY: 'synthetic-secret', NODE_OPTIONS: '--import bad',
    HTTP_PROXY: 'http://proxy.invalid', OPENCODE_CONFIG_CONTENT: 'unexpected', AWS_SECRET_ACCESS_KEY: 'synthetic-secret' })
  assert.equal(env.HOME, '/private/home')
  assert.equal(env.XDG_CONFIG_HOME, '/private/config')
  assert.equal(env.PATH.includes('/project'), false)
  assert.equal(env.PATH.split(':').includes('.'), false)
  for (const name of ['OPENAI_API_KEY', 'TATUM_API_KEY', 'NODE_OPTIONS', 'HTTP_PROXY', 'OPENCODE_CONFIG_CONTENT', 'AWS_SECRET_ACCESS_KEY']) {
    assert.equal(Object.hasOwn(env, name), false)
  }
})

test('the actual SDK ignores checkout configuration/plugins and runs a real offline command with streamed output and cleanup', { timeout: 60_000 }, async t => {
  const root = await temporaryProject(t)
  await mkdir(path.join(root, '.opencode', 'plugins', 'unexpected'), { recursive: true })
  await writeFile(path.join(root, '.opencode', 'plugins', 'unexpected', 'index.mjs'),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(path.join(root, 'inherited-plugin-ran'))}, 'unsafe'); export default {}`)
  await writeFile(path.join(root, 'opencode.json'), JSON.stringify({ plugins: ['./.opencode/plugins/unexpected/index.mjs'],
    model: 'unexpected/model', mcp: { servers: { unexpected: { command: ['touch', path.join(root, 'inherited-mcp-ran')] } } } }))
  const engine = await engineFor(t, root), events = []
  const result = await engine.command(command(root, 'node -p "6 * 7"'), { onEvent: event => events.push(event), signal: AbortSignal.timeout(20_000) })
  assert.equal(result.output, '42\n')
  assert.equal(result.exitCode, 0)
  assert.deepEqual(events.map(event => event.type), ['terminal_started', 'terminal_output', 'terminal_done'])
  await assert.rejects(stat(path.join(root, 'inherited-plugin-ran')), { code: 'ENOENT' })
  await assert.rejects(stat(path.join(root, 'inherited-mcp-ran')), { code: 'ENOENT' })
  const runtime = engine.runtimeDirectory
  await engine.close()
  await assert.rejects(stat(runtime), { code: 'ENOENT' })
  assert.equal(engine.closed, true)
})

test('the SDK scripted tool loop streams its final answer and only calls the supplied bounded file handler', { timeout: 60_000 }, async t => {
  const root = await temporaryProject(t)
  await writeFile(path.join(root, 'greet.ts'), 'export function greet(name: string) {\n  return `Hello, ${name.trim()}!`\n}\n')
  const files = createLocalFiles(root), engine = await engineFor(t, root), calls = [], events = []
  const result = await engine.prompt({ config: { mode: 'mock' }, text: 'Fix empty names', selectedPath: 'greet.ts' }, {
    onEvent: event => events.push(event), signal: AbortSignal.timeout(20_000), tool: async (name, input) => {
      calls.push(name)
      if (name === 'read_file') return files.read(input.path)
      // Fixture-only application. Service/HTTP tests separately enforce approval.
      if (name === 'propose_file') return files.apply(await files.proposal(input))
      assert.fail(`Unexpected tool ${name}`)
    },
  })
  assert.deepEqual(calls, ['read_file', 'propose_file'])
  assert.equal(result.requests, 3)
  assert.equal(events.filter(event => event.type === 'delta').map(event => event.data.text).join(''), result.answer)
  assert.match(await readFile(path.join(root, 'greet.ts'), 'utf8'), /name\.trim\(\) \|\| 'friend'/)
})

for (const style of ['chat', 'responses']) test(`actual SDK ${style} adapter stays on its selected loopback endpoint and replays full local tool results without stored references`, { timeout: 60_000 }, async t => {
  const root = await temporaryProject(t)
  await writeFile(path.join(root, 'a.ts'), 'export const a = 42\n')
  const files = createLocalFiles(root)
  const model = await offlineModel(t, (request, response, count) => {
    assert.equal(request.path, `/v1/${style === 'responses' ? 'responses' : 'chat/completions'}`)
    assert.equal(request.headers.authorization, 'Bearer synthetic-provider-key')
    assert.equal(request.body.model, 'test-model')
    assert.equal(request.body.store, false)
    // V2's compatible Chat adapter selects max_completion_tokens for an
    // otherwise unknown endpoint. The boundary caps either supported field.
    const budget = style === 'responses' ? request.body.max_output_tokens : request.body.max_tokens ?? request.body.max_completion_tokens
    assert.equal(Number.isInteger(budget) && budget > 0 && budget <= 4096, true)
    assert.deepEqual((request.body.tools || []).map(tool => style === 'responses' ? tool.name : tool.function.name).sort(),
      ['list_files', 'propose_file', 'read_file', 'run_command', 'search_files'])
    if (style === 'responses') {
      assert.equal(Object.hasOwn(request.body, 'previous_response_id'), false)
      assert.equal(Object.hasOwn(request.body, 'conversation'), false)
      assert.equal(JSON.stringify(request.body).includes('provider-only'), false)
      assert.ok(request.body.input.every(item => !Object.hasOwn(item, 'id') && !['reasoning', 'item_reference'].includes(item.type)))
    }
    if (count === 2) assert.match(JSON.stringify(request.body), /export const a = 42/)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const frame = style === 'responses' ? responsesFrames : chatFrames
    response.end(frame(count === 1 ? { call: { name: 'read_file', input: { path: 'a.ts' } } } : { text: 'Offline adapter result: a is 42.' }))
  })
  const engine = await engineFor(t, root), calls = []
  const result = await engine.prompt({ config: { mode: 'live', ...model, model: 'test-model', apiKey: 'synthetic-provider-key', apiStyle: style }, text: 'Inspect a.ts' }, {
    signal: AbortSignal.timeout(20_000), tool: async (name, input) => { calls.push(name); assert.equal(name, 'read_file'); return files.read(input.path) },
  })
  assert.deepEqual(calls, ['read_file'])
  assert.equal(result.requests, 2)
  assert.match(result.answer, /Offline adapter result/)
  assert.equal(model.requests.length, 2)
})

test('a refused provider request fails honestly without an automatic retry and still cleans up', { timeout: 60_000 }, async t => {
  const root = await temporaryProject(t)
  const model = await offlineModel(t, (_request, response) => { response.writeHead(429, { 'Content-Type': 'application/json' }); response.end('{"error":{"message":"offline rate limit"}}') })
  const engine = await engineFor(t, root)
  await assert.rejects(engine.prompt({ config: { mode: 'live', baseUrl: model.baseUrl, model: 'test-model', apiKey: 'synthetic-provider-key', apiStyle: 'chat' }, text: 'Offline failure fixture' },
    { signal: AbortSignal.timeout(20_000) }), { code: 'provider_rate_limited' })
  assert.equal(model.requests.length, 1)
  const runtime = engine.runtimeDirectory
  await engine.close()
  await assert.rejects(stat(runtime), { code: 'ENOENT' })
})

test('actual SDK text-only tasks omit tools, deny unsolicited execution and restore isolated tool access for the next profile', { timeout: 60_000 }, async t => {
  const root = await temporaryProject(t), calls = [], events = []
  await writeFile(path.join(root, 'a.ts'), 'export const current = 42 // PRIVATE_CURRENT_FILE\n')
  const files = createLocalFiles(root)
  let phase = 'plain', step = 0
  const model = await offlineModel(t, (request, response) => {
    const body = request.body, serialized = JSON.stringify(body)
    assert.equal(request.headers.authorization, `Bearer ${phase === 'tools' ? 'SECOND_PROFILE_KEY' : 'FIRST_PROFILE_KEY'}`)
    assert.equal(serialized.includes('FIRST_PROFILE_KEY') || serialized.includes('SECOND_PROFILE_KEY'), false)
    const count = ++step
    if (phase !== 'tools') {
      for (const name of ['tools', 'functions', 'tool_choice', 'function_call', 'parallel_tool_calls']) assert.equal(body[name], undefined)
      assert.match(serialized, /text-only project assistant/)
      assert.equal(serialized.includes('PRIVATE_CURRENT_FILE'), false)
      assert.equal(body.messages.some(message => message.role === 'tool'), false)
    } else {
      assert.equal(body.model, 'second-model')
      assert.equal(body.tools.length, 5)
      assert.equal(serialized.includes('FIRST_TASK_PROSE'), false)
      if (count > 1) assert.match(serialized, /PRIVATE_CURRENT_FILE/)
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(chatFrames(count === 1 && phase !== 'plain' ? { call: { name: 'read_file', input: { path: 'a.ts' } } }
      : { text: phase === 'tools' ? 'Read the current file with the new profile.' : 'A text-only suggestion without local actions.' }))
  })
  const engine = await engineFor(t, root)
  const config = { mode: 'live', baseUrl: model.baseUrl, model: 'test-model', apiStyle: 'chat', apiKey: 'FIRST_PROFILE_KEY', toolsEnabled: false }
  const options = () => ({ signal: AbortSignal.timeout(20_000), onEvent: event => events.push(event), tool: async (name, input) => {
    assert.equal(phase, 'tools', 'disabled tool calls must never cross worker IPC')
    calls.push(name); return files.read(input.path)
  } })
  const plain = await engine.prompt({ config, text: 'FIRST_TASK_PROSE: suggest an approach.' }, options())
  assert.equal(plain.requests, 1)
  assert.equal(plain.answer, 'A text-only suggestion without local actions.')
  phase = 'unsolicited'; step = 0
  // The provider ignores the empty tool list. The SDK can report its invalid
  // tool result back internally, but the worker may never execute it in RecallLoop.
  const invalid = await engine.prompt({ config, text: 'FIRST_TASK_PROSE: another text-only suggestion.' }, options())
  assert.equal(invalid.answer, 'A text-only suggestion without local actions.')
  assert.equal(calls.length, 0)
  phase = 'tools'; step = 0
  const next = await engine.prompt({ config: { ...config, apiKey: 'SECOND_PROFILE_KEY', model: 'second-model', toolsEnabled: true }, text: 'Inspect the current a.ts.' }, options())
  assert.deepEqual(calls, ['read_file'])
  assert.equal(next.requests, 2)
  assert.equal(next.answer, 'Read the current file with the new profile.')
  assert.equal(config.apiKey, 'FIRST_PROFILE_KEY', 'the caller profile is retained, not the dispatched worker copy')
  assert.equal(JSON.stringify(events).includes('FIRST_PROFILE_KEY') || JSON.stringify(events).includes('SECOND_PROFILE_KEY'), false)
})

test('the actual SDK replays Gemini signatures through context redaction for parallel and sequential calls, then discards them before a new task', { timeout: 60_000 }, async t => {
  const root = await temporaryProject(t), key = 'synthetic-sdk-signature-key', events = [], tools = []
  const signatures = [`opaque/${key}/hf_${'x'.repeat(20)}==`, 'opaque-sequential+/==']
  const extra = signature => ({ google: { thought_signature: signature } })
  const model = await offlineModel(t, (_request, response, count) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(chatFrames(count === 1 ? { calls: [
      { id: 'parallel-first', name: 'list_files', input: { path: '.' }, extraContent: extra(signatures[0]) },
      { id: 'parallel-second', name: 'read_file', input: { path: 'a.ts' } },
    ] } : count === 2 ? { call: { id: 'sequential', name: 'read_file', input: { path: 'b.ts' }, extraContent: extra(signatures[1]) } }
      : { text: 'Completed the offline signature fixture.' }))
  })
  const engine = await engineFor(t, root)
  const config = { mode: 'live', baseUrl: model.baseUrl, model: 'test-model', apiKey: key, apiStyle: 'chat' }
  const options = () => ({ signal: AbortSignal.timeout(20_000), onEvent: event => events.push(event), tool: async (name, input) => {
    tools.push({ name, input }); return { content: `File data ${key}` }
  } })
  const result = await engine.prompt({ config, text: 'Inspect the project for this offline fixture.' }, options())
  assert.equal(result.requests, 3)
  for (const request of model.requests) {
    assert.equal(request.body.messages[0].role, 'system', 'the compatible adapter keeps the documented system-message shape')
    assert.equal(request.body.systemInstruction, undefined)
    assert.equal(request.body.contents, undefined)
  }
  for (const request of model.requests.slice(1)) {
    const messages = request.body.messages
    const first = messages.findIndex(message => message.tool_calls?.some(call => call.id === 'parallel-first'))
    assert.ok(first >= 0)
    assert.deepEqual(messages[first].tool_calls.map(call => call.id), ['parallel-first', 'parallel-second'])
    assert.deepEqual(messages[first].tool_calls[0].extra_content, extra(signatures[0]))
    assert.equal(messages[first].tool_calls[1].extra_content, undefined)
    assert.deepEqual(messages.slice(first + 1, first + 3).map(message => message.tool_call_id), ['parallel-first', 'parallel-second'])
    const results = messages.filter(message => message.role === 'tool')
    assert.ok(results.length >= 2)
    assert.equal(JSON.stringify(results).includes(key), false)
    assert.match(JSON.stringify(results), /\[REDACTED\]/)
  }
  assert.deepEqual(model.requests[2].body.messages.flatMap(message => message.tool_calls || []).at(-1).extra_content, extra(signatures[1]))
  for (const signature of signatures) assert.equal(JSON.stringify([events, tools, result]).includes(signature), false)
  const fresh = await engine.prompt({ config, text: 'A fresh independent task.' }, options())
  assert.equal(fresh.requests, 1)
  assert.equal(JSON.stringify(model.requests[3].body).includes('thought_signature'), false)
  assert.equal(model.requests[3].body.messages.some(message => message.role === 'tool'), false)
})

test('actual SDK HTTP and streamed error envelopes reach the caller as sanitized provider failures without retries', { timeout: 60_000 }, async t => {
  const root = await temporaryProject(t), key = 'synthetic-sdk-error-key'
  const cases = [
    { status: 400, error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Missing thought_signature' }, expected: 'provider_tool_signature' },
    { status: 402, error: { message: 'Payment required' }, expected: 'provider_quota' },
    { stream: true, error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Missing thought_signature' }, expected: 'provider_tool_signature' },
    { stream: true, error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Too many requests' }, expected: 'provider_rate_limited' },
    { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Missing thought_signature' }, expected: 'provider_tool_signature' },
  ]
  const model = await offlineModel(t, (_request, response, count) => {
    const item = cases[count - 1]
    if (!item) { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(chatFrames({ text: 'Recovered in a new task.' })); return }
    const body = { error: { ...item.error, message: `${item.error.message} ${key} PRIVATE_UPSTREAM_PROMPT` } }
    response.writeHead(item.status || 200, { 'Content-Type': item.stream ? 'text/event-stream' : 'application/json' })
    response.end(item.stream ? `data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n` : JSON.stringify(body))
  })
  const engine = await engineFor(t, root)
  const config = { mode: 'live', baseUrl: model.baseUrl, model: 'test-model', apiKey: key, apiStyle: 'chat' }
  for (const [index, item] of cases.entries()) {
    await assert.rejects(engine.prompt({ config, text: 'Offline provider failure fixture.' }, { signal: AbortSignal.timeout(20_000) }), error => {
      assert.equal(error.code, item.expected, `provider fixture ${index + 1} (${item.stream ? 'SSE' : 'JSON'}, HTTP ${item.status || 200})`)
      assert.equal(error.message.includes(key), false)
      assert.equal(error.message.includes('PRIVATE_UPSTREAM_PROMPT'), false)
      return true
    })
    assert.equal(model.requests.length, index + 1)
  }
  const recovered = await engine.prompt({ config, text: 'A fresh task after resolving the provider issue.' }, { signal: AbortSignal.timeout(20_000) })
  assert.equal(recovered.answer, 'Recovered in a new task.')
  assert.equal(recovered.requests, 1)
})

test('cancellation closes the worker and terminates the tracked shell and its ordinary descendants', { timeout: 60_000 }, async t => {
  const root = await temporaryProject(t), engine = await engineFor(t, root), controller = new AbortController(), started = deferred()
  let output = ''
  const script = 'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); console.log(process.pid+","+child.pid); setInterval(()=>{},1000)'
  const result = engine.command(command(root, `node -e '${script}'`), { signal: controller.signal, onEvent: event => {
    if (event.type === 'terminal_output') { output += event.data.text; if (/\d+,\d+\n/.test(output)) started.resolve() }
  } })
  const rejected = assert.rejects(result, { code: 'engine_stopped' })
  await Promise.race([started.promise, delay(10_000).then(() => { throw new Error('Fixture command did not start') })])
  const pids = output.trim().split(',').map(Number)
  controller.abort()
  await rejected; await engine.close()
  for (const pid of pids) {
    let running = true
    for (let i = 0; i < 30 && running; i++) {
      try {
        process.kill(pid, 0)
        if (process.platform === 'linux') running = !/\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8'))
      } catch { running = false }
      if (running) await delay(50)
    }
    assert.equal(running, false, `fixture descendant ${pid} must not keep running`)
  }
  await assert.rejects(stat(engine.runtimeDirectory), { code: 'ENOENT' })
})

test('native command timeouts and terminal output limits stop work without declaring success', { timeout: 60_000 }, async t => {
  const root = await temporaryProject(t), engine = await engineFor(t, root)
  const timed = await engine.command(command(root, 'node -e "setInterval(()=>{},1000)"', 1000), { signal: AbortSignal.timeout(10_000) })
  assert.equal(timed.status, 'timeout')
  assert.notEqual(timed.exitCode, 0)
  await assert.rejects(engine.command(command(root, 'node -e "process.stdout.write(\'x\'.repeat(400000))"'), { signal: AbortSignal.timeout(10_000) }), { code: 'output_limit' })
})

test('a second actual SDK prompt starts with fresh history, without the previous task or tool results', { timeout: 60_000 }, async t => {
  const root = await temporaryProject(t), privateText = 'PRIVATE_PREVIOUS_TASK_AND_FILE_RESULT'
  await writeFile(path.join(root, 'a.ts'), `export const a = '${privateText}'\n`)
  const files = createLocalFiles(root)
  const model = await offlineModel(t, (request, response, count) => {
    if (count === 2) assert.match(JSON.stringify(request.body), new RegExp(privateText))
    if (count === 3) {
      assert.equal(JSON.stringify(request.body).includes(privateText), false)
      assert.match(JSON.stringify(request.body), /FRESH_INDEPENDENT_TASK/)
      assert.equal(request.body.messages.some(message => message.role === 'tool'), false)
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(chatFrames(count === 1 ? { call: { name: 'read_file', input: { path: 'a.ts' } } } : { text: count === 2 ? privateText : 'Fresh task result.' }))
  })
  const engine = await engineFor(t, root)
  const config = { mode: 'live', baseUrl: model.baseUrl, model: 'test-model', apiKey: 'synthetic-provider-key', apiStyle: 'chat' }
  await engine.prompt({ config, text: `Inspect a.ts. ${privateText}` }, { signal: AbortSignal.timeout(20_000), tool: (_name, input) => files.read(input.path) })
  const result = await engine.prompt({ config, text: 'FRESH_INDEPENDENT_TASK, do not inspect any file.' }, { signal: AbortSignal.timeout(20_000), tool: () => assert.fail('The second task requested no tool') })
  assert.equal(result.answer, 'Fresh task result.')
  assert.equal(result.requests, 1)
  assert.equal(model.requests.length, 3)
})

test('an endless actual SDK tool loop cannot send more than the six-request model budget or retry afterward', { timeout: 60_000 }, async t => {
  const root = await temporaryProject(t), calls = []
  let complete = false
  const model = await offlineModel(t, (_request, response, count) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(chatFrames(complete && count === 2 * BUILDER_LIMITS.modelCalls ? { text: 'Final checkpoint within the budget.' } : { call: { name: 'list_files', input: { path: '.' } } }))
  })
  const engine = await engineFor(t, root)
  const config = { mode: 'live', baseUrl: model.baseUrl, model: 'test-model', apiKey: 'synthetic-provider-key', apiStyle: 'chat' }
  const options = () => ({ signal: AbortSignal.timeout(20_000), tool: name => { calls.push(name); return { entries: [], truncated: false } } })
  await assert.rejects(engine.prompt({ config, text: 'Offline model-budget fixture.' }, options()), { code: 'budget_exhausted' })
  assert.equal(model.requests.length, BUILDER_LIMITS.modelCalls)
  assert.ok(calls.length <= BUILDER_LIMITS.modelCalls)
  complete = true
  const result = await engine.prompt({ config, text: 'A fresh task can finish normally at the exact request limit.' }, options())
  assert.equal(result.requests, BUILDER_LIMITS.modelCalls)
  assert.equal(result.finishReason, 'stop')
  assert.equal(result.answer, 'Final checkpoint within the budget.')
  assert.equal(model.requests.length, 2 * BUILDER_LIMITS.modelCalls)
  const runtime = engine.runtimeDirectory
  await engine.close()
  await assert.rejects(stat(runtime), { code: 'ENOENT' })
})

test('an actual SDK token-truncated answer remains partial, never a completion or an automatic retry', { timeout: 60_000 }, async t => {
  const root = await temporaryProject(t), events = []
  const model = await offlineModel(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(chatFrames({ text: 'Partial offline answer.', finish: 'length' }))
  })
  const engine = await engineFor(t, root)
  await assert.rejects(engine.prompt({ config: { mode: 'live', baseUrl: model.baseUrl, model: 'test-model', apiKey: 'synthetic-provider-key', apiStyle: 'chat' }, text: 'Offline token-limit fixture.' }, {
    signal: AbortSignal.timeout(20_000), onEvent: event => events.push(event),
  }), { code: 'budget_exhausted' })
  assert.equal(model.requests.length, 1)
  assert.equal(events.filter(event => event.type === 'delta').map(event => event.data.text).join(''), 'Partial offline answer.')
})
