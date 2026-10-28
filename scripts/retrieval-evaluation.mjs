import { retrieveMemories } from '../server/memory-retrieval.mjs'

// Manually labelled synthetic cases designed to expose lexical retrieval limits.
// This is an evaluation report, not a quality gate: paraphrase misses are expected
// until a semantic candidate is implemented and compared on the same fixture set.
export const evaluationMemories = [
  { id: 'refund-status', agentId: 'eval-agent', title: 'Provider timeout during refund', lesson: 'Check the provider request status before retrying a submitted refund', metadata: { tags: ['payments', 'timeout'] }, timestamp: '2026-02-04T00:00:00.000Z' },
  { id: 'refund-reconciliation', agentId: 'eval-agent', title: 'Daily payment reconciliation', lesson: 'Compare settlement totals with the ledger and investigate unmatched transfers', metadata: { tags: ['payments', 'ledger'] }, timestamp: '2026-02-03T00:00:00.000Z' },
  { id: 'schema-rollback', agentId: 'eval-agent', title: 'Database schema migration', lesson: 'Back up the database and rehearse rollback before changing production tables', metadata: { tags: ['database', 'migration'] }, timestamp: '2026-02-02T00:00:00.000Z' },
  { id: 'token-expiry', agentId: 'eval-agent', title: 'Expired API access token', lesson: 'Refresh credentials when authorization fails after a token expires', metadata: { tags: ['auth', 'credentials'] }, timestamp: '2026-02-01T00:00:00.000Z' },
  { id: 'latency-alerts', agentId: 'eval-agent', title: 'Service latency monitoring', lesson: 'Track p95 response time and alert on sustained latency spikes', metadata: { tags: ['observability', 'performance'] }, timestamp: '2026-01-31T00:00:00.000Z' },
  { id: 'network-timeout', agentId: 'eval-agent', title: 'Outbound network timeout', lesson: 'Check DNS, connectivity, and upstream reachability when a connection times out', metadata: { tags: ['networking'] }, timestamp: '2026-01-30T00:00:00.000Z' },
  { id: 'queue-backlog', agentId: 'eval-agent', title: 'Background queue backlog', lesson: 'Scale workers and inspect queue age when asynchronous jobs accumulate', metadata: { tags: ['workers', 'queue'] }, timestamp: '2026-01-29T00:00:00.000Z' },
  { id: 'other-agent-secret', agentId: 'different-agent', title: 'Database schema migration rollback', lesson: 'Private cross-agent record that must never be returned', timestamp: '2026-02-05T00:00:00.000Z' },
]

export const retrievalEvaluationCases = [
  { id: 'lexical-refund', category: 'lexical', query: 'provider timeout refund retry', relevant: ['refund-status'], hardNegatives: ['refund-reconciliation'] },
  { id: 'paraphrase-refund', category: 'paraphrase', query: 'What should I verify before resubmitting a failed payment reversal?', relevant: ['refund-status'], hardNegatives: ['refund-reconciliation'] },
  { id: 'paraphrase-migration', category: 'paraphrase', query: 'How do I prevent data loss while changing the production schema?', relevant: ['schema-rollback'], hardNegatives: [] },
  { id: 'paraphrase-auth', category: 'paraphrase', query: 'My API calls suddenly return unauthorized after working for a while', relevant: ['token-expiry'], hardNegatives: [] },
  { id: 'paraphrase-latency', category: 'paraphrase', query: 'Which performance signal should trigger an alert when the service slows down?', relevant: ['latency-alerts'], hardNegatives: [] },
  { id: 'network-vs-provider', category: 'hard-negative', query: 'network connection timeout DNS upstream reachability', relevant: ['network-timeout'], hardNegatives: ['refund-status'] },
  { id: 'payment-vs-reconciliation', category: 'hard-negative', query: 'payment ledger settlement unmatched transfers', relevant: ['refund-reconciliation'], hardNegatives: ['refund-status'] },
  { id: 'queue-backlog', category: 'lexical', query: 'queue backlog workers queue age', relevant: ['queue-backlog'], hardNegatives: [] },
]

export function evaluateRetrieval(retrieve = retrieveMemories) {
  const rows = retrievalEvaluationCases.map(testCase => {
    const results = retrieve(evaluationMemories, 'eval-agent', testCase.query, 3)
    const ids = results.map(memory => memory.id)
    const rank = ids.findIndex(id => testCase.relevant.includes(id))
    return {
      id: testCase.id,
      category: testCase.category,
      query: testCase.query,
      relevant: testCase.relevant,
      hardNegatives: testCase.hardNegatives,
      returned: ids,
      hitAt3: rank >= 0,
      reciprocalRank: rank >= 0 ? 1 / (rank + 1) : 0,
      hardNegativeReturned: ids.some(id => testCase.hardNegatives.includes(id)),
      crossAgentLeak: ids.includes('other-agent-secret'),
    }
  })
  const total = rows.length
  const count = predicate => rows.filter(predicate).length
  return {
    cases: total,
    recallAt3: count(row => row.hitAt3) / total,
    meanReciprocalRank: rows.reduce((sum, row) => sum + row.reciprocalRank, 0) / total,
    hardNegativeRate: count(row => row.hardNegativeReturned) / total,
    crossAgentLeaks: count(row => row.crossAgentLeak),
    byCategory: Object.fromEntries([...new Set(rows.map(row => row.category))].map(category => {
      const subset = rows.filter(row => row.category === category)
      return [category, { cases: subset.length, recallAt3: subset.filter(row => row.hitAt3).length / subset.length }]
    })),
    rows,
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const report = evaluateRetrieval()
  for (const row of report.rows) {
    console.log(JSON.stringify({
      id: row.id,
      category: row.category,
      expected: row.relevant,
      returned: row.returned,
      hitAt3: row.hitAt3,
      reciprocalRank: row.reciprocalRank,
      hardNegativeReturned: row.hardNegativeReturned,
    }))
  }
  console.log(JSON.stringify({
    cases: report.cases,
    recallAt3: Number(report.recallAt3.toFixed(3)),
    meanReciprocalRank: Number(report.meanReciprocalRank.toFixed(3)),
    hardNegativeRate: Number(report.hardNegativeRate.toFixed(3)),
    crossAgentLeaks: report.crossAgentLeaks,
    byCategory: report.byCategory,
    note: 'Synthetic manually labelled evaluation. Paraphrase misses are expected for lexical search; metrics are a baseline, not a production quality claim.',
  }))
  if (report.crossAgentLeaks > 0) process.exitCode = 1
}
