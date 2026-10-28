import test from 'node:test'
import assert from 'node:assert/strict'
import { retrieveMemories } from '../server/memory-retrieval.mjs'

const memories = [
  { id: 'timeout-retry', agentId: 'bench-agent', title: 'Provider timeout during refund', lesson: 'Check request status before retrying', metadata: { tags: ['payments', 'timeout'] }, timestamp: '2026-01-04T00:00:00.000Z' },
  { id: 'db-backup', agentId: 'bench-agent', title: 'Database migration', lesson: 'Take a backup and verify rollback', metadata: { tags: ['database'] }, timestamp: '2026-01-03T00:00:00.000Z' },
  { id: 'auth-token', agentId: 'bench-agent', title: 'Expired access token', lesson: 'Refresh credentials before calling the API', metadata: { tags: ['authentication'] }, timestamp: '2026-01-02T00:00:00.000Z' },
  { id: 'other-agent', agentId: 'other-agent', title: 'Provider timeout refund retry', lesson: 'Private cross-agent record', timestamp: '2026-01-05T00:00:00.000Z' },
  { id: 'monitoring', agentId: 'bench-agent', title: 'Service latency monitoring', lesson: 'Track p95 response time and alert on spikes', metadata: { tags: ['observability'] }, timestamp: '2026-01-01T00:00:00.000Z' },
]
const cases = [
  { query: 'provider timeout refund retry', relevant: 'timeout-retry' },
  { query: 'database migration rollback backup', relevant: 'db-backup' },
  { query: 'expired token refresh credentials', relevant: 'auth-token' },
  { query: 'p95 latency response monitoring', relevant: 'monitoring' },
]
test('lexical baseline benchmark meets its minimum Recall@3 and keeps agent isolation', () => {
  let hits = 0
  for (const item of cases) {
    const results = retrieveMemories(memories, 'bench-agent', item.query, 3)
    assert.ok(results.every(memory => memory.agentId === 'bench-agent'))
    if (results.some(memory => memory.id === item.relevant)) hits += 1
  }
  assert.ok(hits / cases.length >= 0.75, `Recall@3 was ${hits / cases.length}`)
})
