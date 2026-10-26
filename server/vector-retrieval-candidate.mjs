function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) return null
  if (![...left, ...right].every(value => Number.isFinite(value))) return null
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0)
  const leftNorm = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0))
  const rightNorm = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0))
  if (leftNorm === 0 || rightNorm === 0) return null
  return dot / (leftNorm * rightNorm)
}

/**
 * Optional vector-retrieval candidate. The caller injects an embedding function
 * so model choice, network access, caching and dimensions stay outside this module.
 * Not wired into the API until evaluated with a real embedding model.
 */
export async function retrieveVectorMemories(memories, agentId, query, embed, limit = 5) {
  const owner = typeof agentId === 'string' ? agentId.trim() : ''
  const q = typeof query === 'string' ? query.trim() : ''
  if (!owner || !q || !Array.isArray(memories) || typeof embed !== 'function') return []
  const requested = Number(limit)
  const cap = Number.isInteger(requested) ? Math.max(1, Math.min(requested, 20)) : 5
  const owned = memories.filter(memory => memory && memory.agentId === owner)
  if (!owned.length) return []
  const queryVector = await embed(q)
  if (!Array.isArray(queryVector) || !queryVector.length || !queryVector.every(Number.isFinite)) return []
  const scored = await Promise.all(owned.map(async memory => {
    const text = [memory.title, memory.taskTitle, memory.feedback, memory.lesson,
      memory.metadata ? JSON.stringify(memory.metadata) : '', memory.outcome].filter(Boolean).join(' ')
    const vector = await embed(text)
    return { memory, score: cosineSimilarity(queryVector, vector) }
  }))
  return scored.filter(item => item.score !== null)
    .sort((a, b) => b.score - a.score || new Date(b.memory.timestamp) - new Date(a.memory.timestamp))
    .slice(0, cap).map(({ memory, score }) => ({ ...memory, score }))
}
