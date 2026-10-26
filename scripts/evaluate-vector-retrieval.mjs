import { createOpenAIEmbeddingProvider, embeddingProviderDefaults } from '../server/openai-embedding-provider.mjs'
import { retrieveVectorMemories } from '../server/vector-retrieval-candidate.mjs'
import { evaluationMemories, retrievalEvaluationCases } from './retrieval-evaluation.mjs'

async function main() {
  const provider = createOpenAIEmbeddingProvider()
  const cache = new Map()
  const embed = async text => {
    if (!cache.has(text)) cache.set(text, provider(text))
    return cache.get(text)
  }
  const rows = []
  for (const testCase of retrievalEvaluationCases) {
    const results = await retrieveVectorMemories(evaluationMemories, 'eval-agent', testCase.query, embed, 3)
    const ids = results.map(memory => memory.id)
    const rank = ids.findIndex(id => testCase.relevant.includes(id))
    rows.push({
      id: testCase.id,
      category: testCase.category,
      expected: testCase.relevant,
      returned: ids,
      hitAt3: rank >= 0,
      reciprocalRank: rank >= 0 ? 1 / (rank + 1) : 0,
      hardNegativeReturned: ids.some(id => testCase.hardNegatives.includes(id)),
      crossAgentLeak: ids.includes('other-agent-secret'),
    })
    console.log(JSON.stringify(rows.at(-1)))
  }
  const report = {
    provider: 'OpenAI embeddings API',
    model: embeddingProviderDefaults.model,
    dimensions: embeddingProviderDefaults.dimensions,
    cases: rows.length,
    recallAt3: rows.filter(row => row.hitAt3).length / rows.length,
    meanReciprocalRank: rows.reduce((sum, row) => sum + row.reciprocalRank, 0) / rows.length,
    hardNegativeRate: rows.filter(row => row.hardNegativeReturned).length / rows.length,
    crossAgentLeaks: rows.filter(row => row.crossAgentLeak).length,
    embeddingRequests: cache.size,
    note: 'Synthetic labelled evaluation. Compare with npm run evaluate:retrieval; API production retrieval is unchanged.',
  }
  console.log(JSON.stringify(report))
  if (report.crossAgentLeaks > 0) process.exitCode = 1
}

main().catch(error => {
  console.error(`Vector evaluation failed: ${error.message}`)
  process.exitCode = 1
})
