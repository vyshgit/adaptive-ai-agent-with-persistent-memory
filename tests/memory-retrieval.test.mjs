import test from 'node:test'
import assert from 'node:assert/strict'
import { retrieveMemories } from '../server/memory-retrieval.mjs'

const memories = [
  { id: 'a1', agentId: 'agent-a', title: 'Provider timeout', lesson: 'Retry with backoff', metadata: { service: 'payments' }, timestamp: '2026-01-01T00:00:00.000Z' },
  { id: 'a2', agentId: 'agent-a', title: 'Database migration', lesson: 'Take a backup first', timestamp: '2026-01-02T00:00:00.000Z' },
  { id: 'b1', agentId: 'agent-b', title: 'Provider timeout secret', lesson: 'Private memory', timestamp: '2026-01-03T00:00:00.000Z' }
]

test('recall never returns another agent records', () => {
  const results = retrieveMemories(memories, 'agent-a', 'provider timeout')
  assert.deepEqual(results.map(memory => memory.id), ['a1'])
  assert.ok(results.every(memory => memory.agentId === 'agent-a'))
})
test('search includes metadata and lesson fields', () => {
  assert.equal(retrieveMemories(memories, 'agent-a', 'payments backoff')[0].id, 'a1')
})
test('ranks more term matches ahead of fewer matches', () => {
  const results = retrieveMemories(memories, 'agent-a', 'database migration backup')
  assert.equal(results[0].id, 'a2')
  assert.equal(results[0].score, 3)
})
test('clamps result count and defaults invalid limits', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), agentId: 'agent-a', title: 'timeout', timestamp: new Date(i * 1000).toISOString() }))
  assert.equal(retrieveMemories(many, 'agent-a', 'timeout', 100).length, 20)
  assert.equal(retrieveMemories(many, 'agent-a', 'timeout', 'invalid').length, 5)
})
test('returns no results for blank queries or malformed collections', () => {
  assert.deepEqual(retrieveMemories(memories, 'agent-a', '  '), [])
  assert.deepEqual(retrieveMemories(null, 'agent-a', 'timeout'), [])
})
