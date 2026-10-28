export function retrieveMemories(memories, agentId, query, limit = 5) {
  const owner = typeof agentId === 'string' ? agentId.trim() : ''
  const q = typeof query === 'string' ? query.trim() : ''
  if (!owner || !q || !Array.isArray(memories)) return []
  const requested = Number(limit)
  const cap = Number.isInteger(requested) ? Math.max(1, Math.min(requested, 20)) : 5
  const terms = [...new Set(q.toLowerCase().split(/[^a-z0-9_-]+/i).filter(term => term.length > 1))]
  if (!terms.length) return []
  return memories.filter(m => m && m.agentId === owner).map(memory => {
    const searchable = [memory.title, memory.taskTitle, memory.feedback, memory.lesson,
      memory.metadata ? JSON.stringify(memory.metadata) : '', memory.outcome].filter(Boolean).join(' ').toLowerCase()
    const score = terms.reduce((sum, term) => sum + (searchable.includes(term) ? 1 : 0), 0)
    return { memory, score }
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.memory.timestamp) - new Date(a.memory.timestamp))
    .slice(0, cap).map(({ memory, score }) => ({ ...memory, score }))
}
