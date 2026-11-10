import test from 'node:test'
import assert from 'node:assert/strict'
import { validateChat, runChat } from '../server/agent/chat.mjs'
import { buildSystemPrompt } from '../server/agent/prompt.mjs'
import { recallQueries, recallForTurn } from '../server/agent/recall.mjs'
import { createTools } from '../server/agent/tools.mjs'
import { createLlm } from '../server/agent/llm.mjs'
import { validateConnection } from '../server/agent/connections.mjs'
import { createMemoryService } from '../server/memory/service.mjs'
import { formatContext } from '../server/memory/context.mjs'

const config = validateConnection({ mode: 'mock' })
const project = { name: 'Everyday workspace', files: [], activeFile: null }
const input = overrides => validateChat({ sessionId: 'workflow-one', message: 'Plan a quick trip to Alaska.', project, capture: false, ...overrides }, config)
const collect = async iterator => { const events = []; for await (const event of iterator) events.push(event); return events }
const empty = () => ({ context: 'No relevant memories yet.', memories: [], strategy: 'mock-lexical', meta: { tokenEstimate: 0 } })
const fixture = overrides => ({ recall: async () => empty(), ingest: async () => ({ stored: { verbatim: 2, facts: 0, failed: 0 }, blobs: [] }), ...overrides })
function scripted(script) {
  let round = 0
  return { async *streamCompletion(request) {
    const events = script(request, round++)
    yield* events
    if (!events.some(event => event.type === 'finish')) yield { type: 'finish', reason: events.some(event => event.type === 'tool_call') ? 'tool_calls' : 'stop' }
  } }
}
const answer = events => events.filter(event => event.type === 'delta').map(event => event.data.text).join('')
function mockMemory(t) {
  const memory = createMemoryService({ env: { RECALLLOOP_MEMORY_MODE: 'mock' }, chain: { checkpoint: async () => null } })
  t.after(() => memory.destroy())
  return memory
}
const teach = (memory, text, sessionId, occurredAt) => memory.ingest({ agentId: 'a', sessionId, occurredAt, messages: [{ role: 'user', content: text }] })

test('Talk is the safe default, and all modes support memory-first everyday planning without new action permissions', () => {
  assert.equal(input().mode, 'talk')
  for (const mode of ['talk', 'plan', 'build']) {
    const prompt = buildSystemPrompt({ contextBlock: 'No relevant memories yet.', project, toolsEnabled: true, mode })
    assert.match(prompt, /memory-first assistant for everyday questions, planning, and reviewed coding work/)
    assert.match(prompt, /Before asking for a personal detail, look for it/)
    assert.match(prompt, /home city is not necessarily this trip's departure city/)
    assert.match(prompt, /recent explicit user corrections in the current message or history/)
    assert.match(prompt, /Never book, purchase, publish, send messages, or submit transactions/)
    assert.match(prompt, /Call ask_user alone/)
    assert.match(prompt, /not completed actions or private internal reasoning/)
    if (mode !== 'build') assert.match(prompt, /propose_file is unavailable/)
  }
  assert.match(buildSystemPrompt({ contextBlock: '', project, toolsEnabled: false }), /Write the working plan or clarification directly/)
})

test('initial recall adds at most one compact travel-context lookup and short follow-ups use only preceding user context', () => {
  const queries = recallQueries({ message: 'Plan a quick trip to Alaska.' })
  assert.equal(queries.length, 2)
  assert.equal(queries[0], 'Plan a quick trip to Alaska.')
  assert.match(queries[1], /departure city/)
  const follow = recallQueries({ message: 'Next weekend.', history: [{ role: 'user', content: 'Plan a short trip.' }, { role: 'assistant', content: 'Invented departure in secret-city.' }] })
  assert.equal(follow.length, 2)
  assert.match(follow[0], /Plan a short trip/)
  assert.equal(follow.join('\n').includes('secret-city'), false)
  assert.equal(recallQueries({ message: 'Explain a TypeScript type.' }).length, 1)
  assert.ok(recallQueries({ message: 'x'.repeat(4000) }).every(query => query.length <= 2000))
})

test('both bounded lookups complete before generation, stay scoped/redacted, and merge within the normal context budget', async () => {
  const calls = [], key = 'synthetic-workflow-recall-key'
  const hit = { blobId: 'saved-departure', text: 'My departure city is London.', distance: 0.2, tier: 'facts' }
  const memory = fixture({ recall: async ({ agentId, query }) => {
    assert.equal(agentId, 'a'); assert.equal(query.includes(key), false); calls.push('recall')
    return { ...formatContext([hit, { ...hit, distance: 0.3 }]), strategy: 'mock-lexical' }
  } })
  const llm = scripted(request => {
    calls.push('generate')
    assert.match(request.messages[0].content, /My departure city is London/)
    return [{ type: 'delta', text: 'I can use the saved departure city; timing needs confirmation.' }]
  })
  const events = await collect(runChat({ input: input({ message: `Plan a trip. ${key}` }), memory, llm, agentId: 'a', config, secrets: [key] }))
  assert.deepEqual(calls, ['recall', 'recall', 'generate'])
  assert.equal(events[0].data.lookups, 2)
  assert.equal(events[0].data.memories.length, 1)
  assert.ok(events[0].data.tokenEstimate <= 800)
})

test('partial travel recall is explicit and a failed lookup does not mean the user never supplied a detail', async () => {
  let calls = 0
  const result = await recallForTurn({ input: input(), memory: fixture({ recall: async () => {
    if (++calls === 2) throw new Error('offline')
    return { ...formatContext([{ blobId: 'known', text: 'I prefer calm trips.', distance: 0.1, tier: 'facts' }]), strategy: 'mock-lexical' }
  } }), agentId: 'a' })
  assert.equal(result.meta.error, 'memory_unavailable')
  assert.equal(result.memories[0].blobId, 'known')
  const prompt = buildSystemPrompt({ contextBlock: result.context, project, toolsEnabled: true, memoryUnavailable: true })
  assert.match(prompt, /not proof that the user never supplied it/)
  assert.match(prompt, /could not be fully checked/)
})

test('cancelled initial travel recall never starts generation or capture', async () => {
  const controller = new AbortController()
  let generated = 0, writes = 0
  const memory = fixture({ recall: async () => { controller.abort(); return empty() }, ingest: async () => { writes++; return {} } })
  const llm = scripted(() => { generated++; return [] })
  await assert.rejects(collect(runChat({ input: input({ capture: true }), memory, llm, agentId: 'a', config, signal: controller.signal })), { name: 'AbortError' })
  assert.equal(generated, 0); assert.equal(writes, 0)
})

test('offline trip demonstration recalls a previously supplied departure in a new session before asking for missing dates', async t => {
  const memory = mockMemory(t)
  await teach(memory, 'My departure city is London. I prefer short trips and EUR prices.', 'taught', '2026-11-08T09:00:00Z')
  const events = await collect(runChat({ input: input(), memory, llm: createLlm({ mockDelayMs: 0 }), agentId: 'a', config }))
  assert.ok(events[0].data.memories.some(hit => hit.text.includes('departure city is London')))
  assert.equal(events[0].data.lookups, 2)
  assert.equal(events.find(event => event.type === 'question').data.question, 'What dates and length should this trip cover?')
  assert.match(events.find(event => event.type === 'question').data.why, /London from saved context \[mock-blob-/)
  assert.ok(events.some(event => event.type === 'plan'))
  assert.equal(events.some(event => event.type === 'proposal'), false)
  assert.equal(events.at(-2).data.finishReason, 'question')
  assert.equal(events.at(-1).data.skipped, true)
  assert.equal((await memory.recall({ agentId: 'other-wallet', query: 'departure city London' })).memories.length, 0)
})

test('missing, uncertain, and home-only departure context triggers a question, never a guessed departure', async t => {
  for (const text of ['', 'Maybe I depart from Paris.', 'I live in Paris.']) {
    const memory = mockMemory(t)
    if (text) await teach(memory, text, 'context', '2026-11-08T09:00:00Z')
    const events = await collect(runChat({ input: input(), memory, llm: createLlm({ mockDelayMs: 0 }), agentId: 'a', config }))
    const question = events.find(event => event.type === 'question').data
    assert.match(question.question, /Which city will you depart from/)
    assert.deepEqual(question.options, [])
    assert.equal(answer(events).includes('Departure: **Paris**'), false)
    assert.equal(events.some(event => event.type === 'proposal'), false)
  }
})

test('unresolved conflicting departure memories are shown as a choice, not silently resolved by recency', async t => {
  const memory = mockMemory(t)
  await teach(memory, 'My departure city is Paris.', 'old', '2026-11-08T09:00:00Z')
  await teach(memory, 'My departure city is London.', 'new', '2026-11-08T10:00:00Z')
  const events = await collect(runChat({ input: input(), memory, llm: createLlm({ mockDelayMs: 0 }), agentId: 'a', config }))
  const question = events.find(event => event.type === 'question').data
  assert.match(question.why, /conflict/)
  assert.deepEqual(new Set(question.options), new Set(['I depart from Paris.', 'I depart from London.']))
  assert.equal(Object.hasOwn(question, 'selected'), false)
})

test('a clear same-day saved correction uses its full timestamp and supersedes older departure context', async t => {
  const memory = mockMemory(t)
  await teach(memory, 'My departure city is Paris.', 'old', '2026-11-08T09:00:00Z')
  await teach(memory, 'Correction: I now depart from London.', 'correction', '2026-11-08T10:00:00Z')
  const events = await collect(runChat({ input: input(), memory, llm: createLlm({ mockDelayMs: 0 }), agentId: 'a', config }))
  assert.match(events[0].data.context, /2026-11-08T09:00:00\.000Z/)
  assert.match(events[0].data.context, /2026-11-08T10:00:00\.000Z/)
  const question = events.find(event => event.type === 'question').data
  assert.match(question.question, /dates and length/)
  assert.match(question.why, /London/)
})

test('a current explicit correction overrides old memory and a scripted result never claims live travel checks or bookings', async t => {
  const memory = mockMemory(t)
  await teach(memory, 'My departure city is Paris.', 'old', '2026-11-08T09:00:00Z')
  const events = await collect(runChat({ input: input({ message: 'Actually I now depart from London. Plan a quick trip to Alaska next weekend for 3 days.' }),
    memory, llm: createLlm({ mockDelayMs: 0 }), agentId: 'a', config }))
  assert.match(answer(events), /Departure: \*\*London\*\*/)
  assert.equal(answer(events).includes('Departure: **Paris**'), false)
  assert.match(answer(events), /No live travel facts were checked, no booking was made/)
  assert.equal(events.some(event => ['question', 'proposal'].includes(event.type)), false)
})

test('unavailable memory produces an honest clarification and tools-disabled planning falls back to ordinary text', async () => {
  const memory = fixture({ recall: async () => { throw new Error('offline') } })
  const enabled = await collect(runChat({ input: input(), memory, llm: createLlm({ mockDelayMs: 0 }), agentId: 'a', config }))
  assert.equal(enabled[0].data.memoryUnavailable, true)
  assert.match(enabled.find(event => event.type === 'question').data.why, /could not be fully checked/)
  const disabled = await collect(runChat({ input: input(), memory, llm: createLlm({ mockDelayMs: 0 }), agentId: 'a', config: { ...config, toolsEnabled: false } }))
  assert.equal(disabled.some(event => ['plan', 'question', 'tool'].includes(event.type)), false)
  assert.match(answer(disabled), /Which city will you depart from/)
})

test('simple offline questions do not get a fabricated plan, tool activity, or extra travel lookup', async () => {
  const events = await collect(runChat({ input: input({ message: 'Hello.' }), memory: fixture(), llm: createLlm({ mockDelayMs: 0 }), agentId: 'a', config }))
  assert.equal(events[0].data.lookups, 1)
  assert.equal(events.some(event => ['plan', 'question', 'tool'].includes(event.type)), false)
})

test('workflow tools are available without capture in every mode, but do not grant code, write, or execution permissions', async () => {
  for (const mode of ['talk', 'plan', 'build']) {
    const tools = createTools({ memory: fixture(), agentId: 'a', project, capture: false, mode })
    assert.ok(tools.schemas.some(schema => schema.function.name === 'plan_task'))
    assert.ok(tools.schemas.some(schema => schema.function.name === 'ask_user'))
    assert.equal(tools.schemas.some(schema => schema.function.name === 'remember'), false)
    assert.equal(tools.schemas.some(schema => schema.function.name === 'propose_file'), mode === 'build')
    const result = await tools.execute({ name: 'plan_task', args: { summary: 'Confirm context', steps: ['Ask for the missing date.'] } })
    assert.equal(result.result.executed, false)
    assert.equal(result.result.approvalGranted, false)
    assert.equal(result.proposal, undefined)
  }
})

test('plan/question argument arrays and text are bounded, validated, and redacted before user-visible events', async () => {
  const key = 'synthetic-workflow-tool-key'
  const tools = createTools({ memory: fixture(), agentId: 'a', project, secrets: [key] })
  for (const call of [
    { name: 'plan_task', args: { summary: 'Plan', steps: [] } },
    { name: 'plan_task', args: { summary: 'Plan', steps: Array(7).fill('Step') } },
    { name: 'plan_task', args: { summary: 'Plan', steps: [' '] } },
    { name: 'plan_task', args: { summary: 'Plan', steps: [{ command: 'shell' }] } },
    { name: 'plan_task', args: { summary: 'Plan', steps: ['x'.repeat(241)] } },
    { name: 'ask_user', args: { question: 'City?', options: Array(5).fill('City') } },
    { name: 'ask_user', args: { question: 'City?', options: ['London', 'london'] } },
    { name: 'ask_user', args: { question: 'City?', options: [true] } },
    { name: 'ask_user', args: { question: 'City?', selected: 'London' } },
    { name: 'ask_user', args: { question: 'x'.repeat(401) } },
  ]) assert.equal((await tools.execute(call)).error, true)
  const plan = await tools.execute({ name: 'plan_task', args: { summary: key, steps: [key] } })
  const question = await tools.execute({ name: 'ask_user', args: { question: key, why: key, options: [key] } })
  assert.equal(JSON.stringify([plan, question]).includes(key), false)
  assert.equal(question.result.awaitingUser, true)
  assert.equal(question.result.answered, false)
})

test('a clarification hard-pauses generation and blocks every other queued call, including writes before the question', async () => {
  let generations = 0, explicitWrites = 0, captures = 0
  const memory = fixture({ remember: async () => { explicitWrites++; return {} }, ingest: async captured => {
    captures++
    assert.deepEqual(captured.messages.filter(message => message.role === 'user').map(message => message.content), ['Help me choose a trip.'])
    assert.ok(captured.messages.some(message => message.role === 'assistant' && message.content.includes('Which city?')))
    return { stored: { verbatim: 2, facts: 0, failed: 0 }, blobs: [] }
  } })
  const llm = scripted(() => {
    generations++
    return [
      { type: 'tool_call', id: 'write-before', name: 'remember', args: { text: 'Invented departure city is London.' } },
      { type: 'tool_call', id: 'question', name: 'ask_user', args: { question: 'Which city?' } },
      { type: 'tool_call', id: 'change-after', name: 'propose_file', args: { path: 'a.ts', content: 'changed', reason: 'Unanswered' } },
      { type: 'tool_call', id: 'plan-after', name: 'plan_task', args: { summary: 'Not run', steps: ['Do not proceed.'] } },
    ]
  })
  const events = await collect(runChat({ input: input({ message: 'Help me choose a trip.', mode: 'build', capture: true }), memory, llm, agentId: 'a', config }))
  assert.equal(generations, 1); assert.equal(explicitWrites, 0); assert.equal(captures, 1)
  assert.equal(events.some(event => ['proposal', 'plan'].includes(event.type)), false)
  assert.deepEqual(events.filter(event => event.type === 'tool' && event.data.status === 'blocked').map(event => event.data.id), ['write-before', 'change-after', 'plan-after'])
  assert.equal(events.at(-2).data.finishReason, 'question')
})

test('a question-only tool response completes without fabricating a prose answer or answering on the user’s behalf', async () => {
  const events = await collect(runChat({ input: input(), memory: fixture(), llm: scripted(() => [
    { type: 'tool_call', id: 'question-only', name: 'ask_user', args: { question: 'Which city?', options: [] } },
  ]), agentId: 'a', config }))
  assert.equal(answer(events), '')
  assert.equal(events.find(event => event.type === 'question').data.question, 'Which city?')
  assert.deepEqual(events.slice(-2).map(event => event.type), ['done', 'stored'])
})

test('stopping after a clarification event but before done starts no capture or queued action', async () => {
  const controller = new AbortController()
  let writes = 0
  const memory = fixture({ ingest: async () => { writes++; return {} } })
  const iterator = runChat({ input: input({ capture: true }), memory, llm: scripted(() => [
    { type: 'tool_call', id: 'question', name: 'ask_user', args: { question: 'Which city?' } },
  ]), agentId: 'a', config, signal: controller.signal })
  let event
  do { event = await iterator.next() } while (event.value.type !== 'question')
  controller.abort()
  await assert.rejects(iterator.next(), { name: 'AbortError' })
  assert.equal(writes, 0)
})

test('targeted follow-up recall updates citation context and token estimates instead of reusing stale metadata', async () => {
  let recalls = 0
  const memory = fixture({ recall: async () => ++recalls === 1 ? empty() : {
    ...formatContext([{ blobId: 'follow-up', text: 'I prefer short plans.', distance: 0.1, tier: 'facts' }]), strategy: 'mock-lexical',
  } })
  const events = await collect(runChat({ input: input({ message: 'Use my planning preferences.' }), memory, llm: scripted((_request, round) => round
    ? [{ type: 'delta', text: 'Using the confirmed planning context.' }]
    : [{ type: 'tool_call', id: 'targeted', name: 'recall_memory', args: { query: 'short plans preferences' } }]), agentId: 'a', config }))
  const last = events.filter(event => event.type === 'memory').at(-1).data
  assert.match(last.context, /I prefer short plans/)
  assert.ok(last.tokenEstimate > 0 && last.tokenEstimate <= 800)
})
