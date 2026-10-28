import { retrieveMemories } from '../server/memory-retrieval.mjs'

// Small, deterministic baseline benchmark. Expected IDs are hand-labelled for these
// fixtures; expand this set before using metrics to justify a semantic-search migration.
const memories = [
  { id: 'timeout-retry', agentId: 'bench-agent', title: 'Provider timeout during refund', lesson: 'Check request status before retrying', metadata: { tags: ['payments', 'timeout'] }, timestamp: '2026-01-04T00:00:00.000Z' },
  { id: 'db-backup', agentId: 'bench-agent', title: 'Database migration', lesson: 'Take a backup and verify rollback', metadata: { tags: ['database'] }, timestamp: '2026-01-03T00:00:00.000Z' },
  { id: 'auth-token', agentId: 'bench-agent', title: 'Expired access token', lesson: 'Refresh credentials before calling the API', metadata: { tags: ['authentication'] }, timestamp: '2026-01-02T00:00:00.000Z' },
  { id: 'other-agent', agentId: 'other-agent', title: 'Provider timeout refund retry', lesson: 'Private cross-agent record', timestamp: '2026-01-05T00:00:00.000Z' },
  { id: 'monitoring', agentId: 'bench-agent', title: 'Service latency monitoring', lesson: 'Track p95 response time and alert on spikes', metadata: { tags: ['observability'] }, timestamp: '2026-01-01T00:00:00.000Z' },
]

const cases = [
  { query: 'provider timeout refund retry', relevant: ['timeout-retry'] },
  { query: 'database migration rollback backup', relevant: ['db-backup'] },
  { query: 'expired token refresh credentials', relevant: ['auth-token'] },
  { query: 'p95 latency response monitoring', relevant: ['monitoring'] },
]

let hitsAt3 = 0
let reciprocalRankSum = 0
for (const item of cases) {
  const results = retrieveMemories(memories, 'bench-agent', item.query, 3)
  const relevantIndex = results.findIndex(memory => item.relevant.includes(memory.id))
  if (relevantIndex >= 0) {
    hitsAt3 += 1
    reciprocalRankSum += 1 / (relevantIndex + 1)
  }
  console.log(JSON.stringify({ query: item.query, expected: item.relevant, returned: results.map(memory => memory.id), reciprocalRank: relevantIndex < 0 ? 0 : 1 / (relevantIndex + 1) }))
}
const recallAt3 = hitsAt3 / cases.length
const meanReciprocalRank = reciprocalRankSum / cases.length
console.log(JSON.stringify({ cases: cases.length, recallAt3, meanReciprocalRank, note: 'Small synthetic lexical baseline; not evidence of semantic retrieval quality.' }))
if (recallAt3 < 0.75) process.exitCode = 1
