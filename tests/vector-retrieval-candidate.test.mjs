import test from 'node:test'
import assert from 'node:assert/strict'
import { retrieveVectorMemories } from '../server/vector-retrieval-candidate.mjs'

// Controlled vectors validate ranking and isolation only. These are not a real
// language model and must not be used to claim semantic-search quality.
async function fixtureEmbed(text) {
  const value = String(text).toLowerCase()
  if (/refund|payment reversal|provider timeout|failed payment/.test(value)) return [1, 0, 0]
  if (/database|schema|migration|data loss/.test(value)) return [0, 1, 0]
  if (/token|unauthorized|credentials/.test(value)) return [0, 0, 1]
  return [0.1, 0.1, 0.1]
}

const memories = [
  { id: 'refund', agentId: 'agent-a', title: 'Provider timeout during refund', lesson: 'Check status before retrying a payment reversal' },
  { id: 'database', agentId: 'agent-a', title: 'Database schema migration', lesson: 'Back up before changes to avoid data loss' },
  { id: 'private-refund', agentId: 'agent-b', title: 'Provider timeout refund', lesson: 'Private record' },
]

test('vector candidate ranks by cosine similarity', async () => {
  const results = await retrieveVectorMemories(memories, 'agent-a', 'failed payment reversal', fixtureEmbed, 3)
  assert.equal(results[0].id, 'refund')
  assert.ok(results[0].score > results[1].score)
})

test('vector candidate isolates agent records before embedding', async () => {
  const seen = []
  const embed = async text => {
    seen.push(text)
    return fixtureEmbed(text)
  }
  const results = await retrieveVectorMemories(memories, 'agent-a', 'provider timeout', embed, 5)
  assert.ok(results.every(memory => memory.agentId === 'agent-a'))
  assert.ok(!seen.some(text => text === 'Private record'))
})

test('vector candidate handles invalid inputs and malformed vectors', async () => {
  assert.deepEqual(await retrieveVectorMemories(memories, '', 'query', fixtureEmbed), [])
  assert.deepEqual(await retrieveVectorMemories(memories, 'agent-a', 'query', null), [])
  assert.deepEqual(await retrieveVectorMemories(memories, 'agent-a', 'query', async () => []), [])
})
