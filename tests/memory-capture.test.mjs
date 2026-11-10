import test from 'node:test'
import assert from 'node:assert/strict'
import { relevantContext, captureTurn } from '../server/memory/capture.mjs'
import { createMemoryService } from '../server/memory/service.mjs'
import { AppError } from '../server/safety.mjs'
import { walletAgentId } from '../server/agent/wallet-auth.mjs'
import { memoryNamespace } from '../server/memory/memwal-client.mjs'
import { deferred } from './helpers/workspace-http.mjs'

const occurredAt = '2026-11-10T10:00:00.000Z'
const input = overrides => ({ agentId: 'capture-agent', sessionId: 'first-chat', occurredAt, mode: 'facts',
  messages: [{ role: 'user', content: 'I prefer TypeScript; keep the interface minimal.' }], ...overrides })
const confirmed = (text, namespace, id = 'confirmed-fact') => ({ facts: [{ text }], results: [{ status: 'done', blob_id: id, namespace }] })
function fixture(t, analyze, overrides = {}) {
  const calls = [], notes = []
  const backend = { mode: () => 'relayer', note: blobs => notes.push(...blobs), destroy() {},
    getClient: () => ({ analyzeAndWait: async (text, options) => {
      calls.push({ text, options })
      return analyze ? analyze(text, options, calls.length) : confirmed(text, options.namespace, `fact-${calls.length}`)
    } }), ...overrides }
  const memory = createMemoryService({ backend, chain: { checkpoint: async () => null } })
  t.after(() => memory.destroy())
  return { memory, backend, calls, notes }
}
const automatic = (memory, overrides) => memory.ingest(input(overrides), { automatic: true })

test('relevant prose keeps punctuation, Unicode, bullets, project decisions and relative dates', () => {
  for (const text of ['I prefer TypeScript; keep this project on npm.', 'Our release is tomorrow at 10:00 UTC.',
    'Use `pnpm` for this project.', 'Préférence : une interface simple.', 'Keep server data behind /api/* endpoints.']) {
    assert.equal(relevantContext(text), text)
  }
  assert.equal(relevantContext('- I prefer concise answers.\r\n* Use TypeScript for this project.'), 'I prefer concise answers.\nUse TypeScript for this project.')
  assert.ok(relevantContext('Useful context '.repeat(1000)).length <= 4000)
})

test('automatic relevance filtering omits filler, quotes, fenced/indented code, commands and logs', () => {
  for (const text of ['Hello!', 'Thanks, sounds good.', 'ok, go ahead', 'continue', 'yes', '👍',
    '> I prefer Python.', '"I prefer Python."', '“I prefer Python.”', '    I prefer Python.',
    'const language = "Python";', 'console.log("I prefer Python");', 'git status', '$ npm test',
    '2026-11-10T10:00:00Z I prefer Python', 'at execute (script.js:1:1)', '{ "preference": "Python" }',
    '```text\nI prefer Python.\n```', '~~~log\nI prefer Python.\n~~~',
    '````markdown\n```\nI prefer Python.\n```\n````', '```\nI prefer Python.']) assert.equal(relevantContext(text), '', text)
  assert.equal(relevantContext('I prefer TypeScript.\n```js\nconst key = 1\n```\nUse npm for the project.'), 'I prefer TypeScript.\nUse npm for the project.')
})

test('privacy requests, role-prefixed transcripts and exported conversation dumps are not automatic facts', () => {
  for (const instruction of ['Off the record', 'Keep this private', 'Please do not store this conversation',
    "Don't save my preference", 'Don’t remember any of this', 'Never memorize this', 'Do not save anything from this turn']) {
    assert.equal(relevantContext(`${instruction}.\nI prefer TypeScript.`), '')
  }
  for (const transcript of ['USER: I prefer Python.\nASSISTANT: Noted.', '[Assistant]: I deployed the app.',
    '### User: I prefer Python.', '<conversation-checkpoint>\nI prefer Python.\n</conversation-checkpoint>',
    '<|im_start|>assistant\nI prefer Python.', 'BEGIN TRANSCRIPT\nI prefer Python.\nEND TRANSCRIPT']) {
    assert.equal(relevantContext(`Here is a pasted conversation.\n${transcript}`), '')
  }
  // A role label inside excluded code must not discard unrelated current prose.
  assert.equal(relevantContext('I prefer TypeScript.\n```\nUSER: an example\n```'), 'I prefer TypeScript.')
})

test('redacted credential lines never enter automatic memory alongside otherwise relevant context', async () => {
  const key = 'SYNTHETIC_CAPTURE_PRIVATE_KEY_ONLY'
  const text = `My provider key is ${key}.\nI prefer TypeScript.`
  assert.equal(relevantContext(text, [key]), 'I prefer TypeScript.')
  let captured
  await captureTurn({ memory: { ingest: async (value, options) => { captured = { value, options }; return { stored: { facts: 1 }, blobs: [] } } },
    agentId: 'a', sessionId: 's', message: text, project: `Project ${key}`, answer: 'ASSISTANT_ONLY', toolCapture: [{ role: 'tool', name: 'read_file', content: 'FILE_ONLY' }], secrets: [key] })
  assert.deepEqual(captured.value.messages, [{ role: 'user', content: 'I prefer TypeScript.' }])
  assert.equal(captured.value.mode, 'facts')
  assert.equal(captured.options.automatic, true)
})

test('capture reports disabled, irrelevant, no-facts, unavailable and failed outcomes without claiming saves', async () => {
  const base = { agentId: 'a', sessionId: 's', message: 'I prefer TypeScript.' }
  const untouched = { ingest() { assert.fail('Skipped input must not reach the backend') } }
  assert.equal((await captureTurn({ ...base, memory: untouched, capture: false })).reason, 'disabled')
  assert.equal((await captureTurn({ ...base, memory: untouched, message: 'Thank you!' })).reason, 'no_context')
  const empty = await captureTurn({ ...base, memory: { ingest: async () => ({ stored: { facts: 0, verbatim: 0, failed: 0 }, blobs: [] }) } })
  assert.equal(empty.reason, 'no_facts')
  for (const code of ['memory_not_configured', 'capture_failed']) {
    const result = await captureTurn({ ...base, memory: { ingest() { throw new AppError(code, 'Synthetic safe error', 503) } } })
    assert.equal(result.facts, 0)
    assert.equal(result.failed, 1)
    assert.equal(result.code, code === 'memory_not_configured' ? 'capture_unavailable' : 'capture_failed')
  }
})

test('identical pending captures share one write before capacity and per-service admission', async t => {
  const gate = deferred()
  t.after(() => gate.resolve())
  let capacityChecks = 0, full = false
  const f = fixture(t, async (text, options, count) => { await gate.promise; return confirmed(text, options.namespace, `fact-${count}`) }, {
    assertCapacity() { capacityChecks++; if (full) throw new AppError('memory_limit', 'Synthetic capacity limit', 429) },
  })
  const first = automatic(f.memory)
  const other = automatic(f.memory, { messages: [{ role: 'user', content: 'Use npm for the project.' }] })
  assert.equal(f.calls.length, 2)
  await assert.rejects(automatic(f.memory, { messages: [{ role: 'user', content: 'A third unique request.' }] }), { code: 'memory_busy' })
  full = true
  const duplicate = automatic(f.memory, { sessionId: 'second-chat' })
  assert.equal(f.calls.length, 2)
  assert.equal(capacityChecks, 2)
  gate.resolve()
  const [a, b, c] = await Promise.all([first, other, duplicate])
  assert.equal(c.deduplicated, true)
  assert.deepEqual(c.blobs, a.blobs)
  assert.notDeepEqual(b.blobs, a.blobs)
  assert.equal((await automatic(f.memory, { sessionId: 'third-chat' })).deduplicated, true)
  assert.equal(capacityChecks, 2)
})

test('automatic date boundaries and explicit timestamped analyses cannot collide', async t => {
  const f = fixture(t)
  await automatic(f.memory)
  assert.equal((await automatic(f.memory, { occurredAt: '2026-11-10T23:59:00Z' })).deduplicated, true)
  assert.equal((await automatic(f.memory, { occurredAt: '2026-11-11T00:00:00Z' })).deduplicated, undefined)
  await f.memory.ingest(input({ sessionId: 'automatic' }))
  await f.memory.ingest(input({ sessionId: 'automatic', occurredAt: '2026-11-10T12:00:00Z' }))
  assert.equal(f.calls.length, 4)
  assert.equal(f.calls[1].options.occurredAt, '2026-11-11T00:00:00.000Z')
})

test('failed analyses can be retried; valid empty analyses are deduplicated and malformed results fail', async t => {
  const f = fixture(t, (text, options, count) => {
    if (count === 1) throw new Error('Synthetic outage')
    return confirmed(text, options.namespace)
  })
  await assert.rejects(automatic(f.memory), { code: 'capture_failed' })
  assert.equal((await automatic(f.memory)).stored.facts, 1)
  assert.equal(f.calls.length, 2)
  const empty = fixture(t, () => ({ facts: [], results: [] }))
  assert.equal((await automatic(empty.memory)).stored.facts, 0)
  assert.equal((await automatic(empty.memory)).deduplicated, true)
  assert.equal(empty.calls.length, 1)
  for (const result of [{}, { facts: [{}] }, { facts: [], results: [{ status: 'done', blob_id: 'unmatched-blob' }] }]) {
    await assert.rejects(automatic(fixture(t, () => result).memory), { code: 'capture_failed' })
  }
})

test('accepted jobs survive the dedupe window but disposal cannot repopulate memory metadata', async t => {
  const gate = deferred()
  t.after(() => gate.resolve())
  const f = fixture(t, async (text, options, count) => {
    if (count === 1) await gate.promise
    return confirmed(text, options.namespace, `fact-${count}`)
  })
  const pending = automatic(f.memory)
  for (let i = 0; i < 501; i++) await automatic(f.memory, { messages: [{ role: 'user', content: `Project decision number ${i}.` }] })
  const duplicate = automatic(f.memory, { sessionId: 'another-chat' })
  assert.equal(f.calls.length, 502, 'the first pending job was not evicted')
  const notes = f.notes.length
  f.memory.destroy()
  gate.resolve()
  const results = await Promise.allSettled([pending, duplicate])
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'wallet_required'))
  assert.equal(f.notes.length, notes)
  await assert.rejects(automatic(f.memory), { code: 'wallet_required' })
})

test('automatic facts recall across conversations but remain bound to their authenticated wallet', async t => {
  const a = walletAgentId('0xa'), b = walletAgentId('0xb')
  const memories = [a, b].map(principal => createMemoryService({ principal, env: { RECALLLOOP_MEMORY_MODE: 'mock' }, chain: { checkpoint: async () => null } }))
  t.after(() => memories.forEach(memory => memory.destroy()))
  const result = await automatic(memories[0], { agentId: a })
  assert.equal(result.blobs[0].namespace, memoryNamespace(a, 'facts'))
  assert.equal((await automatic(memories[0], { agentId: a, sessionId: 'later-conversation' })).deduplicated, true)
  assert.match((await memories[0].recall({ agentId: a, query: 'TypeScript minimal' })).context, /TypeScript/)
  assert.equal((await memories[1].recall({ agentId: b, query: 'TypeScript minimal' })).memories.length, 0)
  await assert.rejects(automatic(memories[0], { agentId: b }), { code: 'scope_forbidden' })
  assert.equal((await automatic(memories[1], { agentId: b })).deduplicated, undefined)
})
