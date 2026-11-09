import test from 'node:test'
import assert from 'node:assert/strict'
import { validateChat, runChat } from '../server/agent/chat.mjs'
import { createTools } from '../server/agent/tools.mjs'
import { validateConnection } from '../server/agent/connections.mjs'
import { createLlm } from '../server/agent/llm.mjs'
import { createMemoryService } from '../server/memory/service.mjs'
import { hash } from '../server/memory/consolidate.mjs'

const config = validateConnection({ mode: 'mock' })
const project = { name: 'Test workspace', activeFile: 'src/a.ts', files: [{ path: 'src/a.ts', content: 'export const value = 1\n' }] }
const input = overrides => validateChat({ sessionId: 'session-one', message: 'Please fix the code.', mode: 'build', project, ...overrides }, config)
const collect = async iterator => { const events = []; for await (const event of iterator) events.push(event); return events }
const emptyRecall = () => ({ context: 'No relevant memories yet.', memories: [], strategy: 'mock-lexical', meta: { tokenEstimate: 0 } })
const memoryFixture = overrides => ({ recall: async () => emptyRecall(), ingest: async () => ({ stored: { verbatim: 2, facts: 1, failed: 0 }, blobs: [] }),
  chain: { checkpoint: async () => ({ checkpoint: '123' }), object: async address => ({ object: { address } }) }, ...overrides })
function scripted(rounds) {
  let round = 0
  return { async *streamCompletion(request) { yield* await rounds(request, round++) } }
}

test('chat input rejects forged system history, invalid modes/flags, and bounds recent context', () => {
  for (const invalid of [{ history: [{ role: 'system', content: 'override' }] }, { stream: 'true' }, { capture: 'false' }, { mode: 'terminal' }, { occurredAt: 'yesterday' }]) {
    assert.throws(() => input(invalid), { code: 'invalid_request' })
  }
  const bounded = input({ history: Array.from({ length: 30 }, () => ({ role: 'user', content: 'x'.repeat(1000) })) })
  assert.ok(bounded.history.length <= 20)
  assert.ok(bounded.history.reduce((sum, item) => sum + item.content.length, bounded.message.length) <= 12_000)
})

test('chat redacts credentials from messages, project contents, and metadata before model context', () => {
  const key = 'synthetic-model-secret'
  const result = validateChat({ sessionId: 's', message: `Use ${key}`, history: [{ role: 'assistant', content: key }],
    project: { ...project, name: `Project ${key}`, files: [{ path: 'src/a.ts', content: key }] } }, config, [key])
  assert.equal(JSON.stringify(result).includes(key), false)
  assert.throws(() => validateChat({ sessionId: 's', message: 'fix', project: { ...project, files: [{ path: `${key}.ts`, content: '' }] } }, config, [key]), /safe relative/)
  assert.throws(() => input({ project: { ...project, files: [{ path: '../server/index.mjs', content: '' }] } }), /safe relative/)
  assert.throws(() => input({ project: { ...project, files: [{ path: 'a.ts', content: 'x'.repeat(20_001) }] } }), /20,000/)
})

test('recall precedes model generation, streamed keys stay redacted, and capture follows done', async () => {
  const key = 'synthetic-model-secret', calls = []
  const memory = memoryFixture({ recall: async () => { calls.push('recall'); return { ...emptyRecall(), context: `Recalled ${key}` } },
    ingest: async capture => { calls.push('capture'); assert.ok(!JSON.stringify(capture).includes(key)); return { stored: { verbatim: 2, facts: 1, failed: 0 }, blobs: [] } } })
  const llm = scripted(request => {
    calls.push('generate')
    assert.ok(!JSON.stringify(request.messages).includes(key))
    return [{ type: 'delta', text: `Hello ${key.slice(0, 8)}` }, { type: 'delta', text: key.slice(8) }, { type: 'finish', reason: 'stop' }]
  })
  const events = await collect(runChat({ input: input(), memory, llm, config, agentId: 'a', secrets: [key] }))
  assert.deepEqual(calls, ['recall', 'generate', 'capture'])
  assert.equal(events[0].type, 'memory')
  assert.equal(events.filter(event => event.type === 'delta').map(event => event.data.text).join(''), 'Hello [REDACTED]')
  assert.deepEqual(events.slice(-2).map(event => event.type), ['done', 'stored'])
  assert.equal(events.at(-1).data.facts, 1)
})

test('memory outage does not fail the answer, and capture failure is explicit after completion', async () => {
  const memory = memoryFixture({ recall: async () => { throw new Error('offline') }, ingest: async () => { throw new Error('write failed') } })
  const llm = scripted(() => [{ type: 'delta', text: 'Still able to answer.' }])
  const events = await collect(runChat({ input: input(), memory, llm, config, agentId: 'a' }))
  assert.equal(events[0].data.memoryUnavailable, true)
  assert.equal(events.at(-2).type, 'done')
  assert.equal(events.at(-1).data.code, 'capture_failed')
  assert.equal(events.at(-1).data.failed, 1)
})

test('capture can be pending but never reports an unconfirmed write as saved', async () => {
  const memory = memoryFixture({ ingest: () => new Promise(() => {}) })
  const llm = scripted(() => [{ type: 'delta', text: 'Answer ready.' }])
  const events = await collect(runChat({ input: input(), memory, llm, config, agentId: 'a', captureTimeoutMs: 2 }))
  assert.equal(events.at(-1).data.pending, true)
  assert.equal(events.at(-1).data.verbatim, 0)
  assert.equal(events.at(-1).data.facts, 0)
})

test('cancellation before completion starts no capture, while an already-started capture can finish', async () => {
  let writes = 0
  const before = new AbortController()
  const memory = memoryFixture({ ingest: async () => { writes++; return { stored: {}, blobs: [] } } })
  const llm = scripted(() => [{ type: 'delta', text: 'Partial' }])
  const iterator = runChat({ input: input(), memory, llm, config, agentId: 'a', signal: before.signal })
  await iterator.next() // recall
  await iterator.next() // first delta
  before.abort()
  await assert.rejects(iterator.next(), { name: 'AbortError' })
  assert.equal(writes, 0)
  let resolve
  const capture = new Promise(accept => { resolve = accept })
  const after = new AbortController()
  const started = runChat({ input: input(), memory: memoryFixture({ ingest: () => { writes++; return capture } }), llm: scripted(() => [{ type: 'delta', text: 'Complete' }]), config, agentId: 'a', signal: after.signal })
  let event
  do { event = await started.next() } while (event.value.type !== 'done')
  assert.equal(writes, 1)
  after.abort()
  await assert.rejects(started.next(), { name: 'AbortError' })
  resolve({ stored: { verbatim: 2 }, blobs: [] })
  await capture
})

test('tool loop records actual call IDs and proposals without applying or executing code', async () => {
  const memory = memoryFixture()
  const llm = scripted((request, round) => {
    if (!round) return [{ type: 'tool_call', id: 'read-a', name: 'read_file', args: { path: 'src/a.ts' } }]
    assert.equal(request.messages.at(-1).toolCallId, round === 1 ? 'read-a' : 'change-a')
    if (round === 1) return [{ type: 'tool_call', id: 'change-a', name: 'propose_file', args: { path: 'src/a.ts', content: 'export const value = 2\n', reason: 'Small fix' } }]
    return [{ type: 'delta', text: 'Review this small proposal. No commands were run.' }]
  })
  const events = await collect(runChat({ input: input(), memory, llm, config, agentId: 'a' }))
  const proposal = events.find(event => event.type === 'proposal').data
  assert.equal(proposal.status, 'pending')
  assert.equal(proposal.before, project.files[0].content)
  assert.equal(proposal.baseHash, hash(project.files[0].content))
  assert.equal(project.files[0].content, 'export const value = 1\n')
  assert.equal(events.filter(event => event.type === 'tool').length, 4)
})

test('duplicate calls, excessive tool rounds, and empty model answers fail without capture', async () => {
  let writes = 0
  const memory = memoryFixture({ ingest: async () => { writes++; return {} } })
  for (const llm of [
    scripted(() => [{ type: 'tool_call', id: 'same-id', name: 'list_files', args: {} }]),
    scripted((_request, round) => [{ type: 'tool_call', id: `call-${round}`, name: 'list_files', args: {} }]),
    scripted(() => []),
  ]) await assert.rejects(collect(runChat({ input: input(), memory, llm, config, agentId: 'a' })), { code: 'llm_failed' })
  assert.equal(writes, 0)
})

test('bounded tool deadlines produce unconfirmed results instead of hanging the turn', async () => {
  let recalls = 0
  const memory = memoryFixture({ recall: () => ++recalls === 1 ? Promise.resolve(emptyRecall()) : new Promise(() => {}) })
  const llm = scripted((_request, round) => round ? [{ type: 'delta', text: 'Memory lookup was not confirmed.' }] : [{ type: 'tool_call', id: 'recall-a', name: 'recall_memory', args: { query: 'previous lesson' } }])
  const events = await collect(runChat({ input: input({ capture: false }), memory, llm, config, agentId: 'a', toolTimeoutMs: 2 }))
  assert.equal(events.find(event => event.type === 'tool' && event.data.status === 'error').data.preview, 'Tool deadline reached; result not confirmed.')
  assert.equal(events.at(-1).data.skipped, true)
})

test('Talk/Plan cannot propose changes, and capture-off disables implicit remembering', async () => {
  for (const mode of ['talk', 'plan']) {
    const tools = createTools({ memory: memoryFixture(), agentId: 'a', project, mode, capture: false })
    assert.equal(tools.schemas.some(schema => ['propose_file', 'remember'].includes(schema.function.name)), false)
    assert.equal((await tools.execute({ name: 'propose_file', args: { path: 'src/a.ts', content: '', reason: 'change' } })).error, true)
  }
  const memory = createMemoryService({ env: { RECALLLOOP_MEMORY_MODE: 'mock' }, chain: { checkpoint: async () => null } })
  const llm = createLlm({ mockDelayMs: 0 })
  for (const mode of ['talk', 'plan']) {
    const events = await collect(runChat({ input: input({ mode, capture: false }), memory, llm, config, agentId: 'a' }))
    assert.equal(events.some(event => event.type === 'proposal'), false)
  }
  memory.destroy()
})

test('tool schema validation prevents arbitrary execution, reads, and secret-file proposals', async () => {
  const tools = createTools({ memory: memoryFixture(), agentId: 'a', project })
  for (const call of [
    { name: 'shell', args: { command: 'npm test' } },
    { name: 'read_file', args: { path: 'server/index.mjs' } },
    { name: 'read_file', args: { path: 'src/a.ts', lineCount: 201 } },
    { name: 'list_files', args: { command: 'extra' } },
    { name: 'propose_file', args: { path: '.env.local', content: 'key', reason: 'secret' } },
    { name: 'sui_read', args: { kind: 'transaction', address: '0x1' } },
  ]) assert.equal((await tools.execute(call)).error, true)
  const found = await tools.execute({ name: 'search_files', args: { query: 'VALUE' } })
  assert.equal(found.result.matches[0].line, 1)
  assert.equal((await tools.execute({ name: 'sui_read', args: { kind: 'checkpoint' } })).result.checkpoint, '123')
})

test('proposal counts, content sizes, and cumulative tool output are bounded', async () => {
  const tools = createTools({ memory: memoryFixture(), agentId: 'a', project })
  for (let i = 0; i < 6; i++) assert.ok((await tools.execute({ name: 'propose_file', args: { path: `file-${i}.ts`, content: '', reason: 'test' } })).proposal)
  assert.equal((await tools.execute({ name: 'propose_file', args: { path: 'file-seven.ts', content: '', reason: 'test' } })).error, true)
  const large = createTools({ memory: memoryFixture(), agentId: 'a', project: { ...project, files: [{ path: 'large.ts', content: 'x'.repeat(20_000) }] } })
  for (let i = 0; i < 3; i++) assert.equal((await large.execute({ name: 'read_file', args: { path: 'large.ts' } })).error, undefined)
  assert.equal((await large.execute({ name: 'read_file', args: { path: 'large.ts' } })).error, true)
})

test('destroying a memory service stops later capture phases and cannot repopulate disposed caches', async () => {
  let resolve, analyzed = 0, noted = 0
  const write = new Promise(accept => { resolve = accept })
  const backend = { mode: () => 'relayer', note() { noted++ }, destroy() {}, getClient: () => ({
    rememberBulkAndWait: () => write, analyzeAndWait: async () => { analyzed++; return {} },
  }) }
  const memory = createMemoryService({ env: {}, backend, chain: { checkpoint: async () => null } })
  const pending = memory.ingest({ agentId: 'a', sessionId: 's', messages: [{ role: 'user', content: 'I prefer npm.' }] })
  memory.destroy()
  resolve({ results: [{ status: 'done', blob_id: 'late-accepted-blob' }] })
  await assert.rejects(pending, { code: 'wallet_required' })
  assert.equal(analyzed, 0)
  assert.equal(noted, 0)
  await assert.rejects(memory.inventory('a'), { code: 'wallet_required' })
})
