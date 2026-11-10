import { clampNumber } from '../safety.mjs'

export const estimateTokens = text => Math.ceil([...text].length / 4)

export function formatContext(hits, { maxTokens = 800, limit = 8, preserveOrder = false } = {}) {
  const budget = Math.floor(clampNumber(maxTokens, 800, 64, 4000))
  const cap = Math.floor(clampNumber(limit, 8, 1, 20))
  const unique = new Map()
  for (const hit of hits || []) {
    const blobId = hit.blobId || hit.blob_id
    if (!blobId || typeof hit.text !== 'string' || !hit.text.trim() || !Number.isFinite(hit.distance)) continue
    const memory = { blobId, text: hit.text, distance: hit.distance,
      ...(hit.createdAt || hit.created_at ? { createdAt: hit.createdAt || hit.created_at } : {}), tier: hit.tier || 'facts' }
    if (!unique.has(blobId) || unique.get(blobId).distance > memory.distance) unique.set(blobId, memory)
  }
  const ordered = [...unique.values()]
  if (!preserveOrder) ordered.sort((a, b) =>
    (a.tier === 'profile' ? 0 : 1) - (b.tier === 'profile' ? 0 : 1) || a.distance - b.distance)
  const memories = []
  const lines = []
  let truncated = ordered.length > cap
  for (const memory of ordered.slice(0, cap)) {
    // Keep the time: same-day corrections must not look equally recent.
    const date = memory.createdAt || 'date unavailable'
    const line = `- [${date}; ${memory.tier}; blob=${memory.blobId}] ${memory.text.replace(/\r?\n/g, ' ')}`
    const proposed = `## Relevant memories (${lines.length + 1})\n${[...lines, line].join('\n')}`
    if (estimateTokens(proposed) > budget) { truncated = true; continue }
    lines.push(line)
    memories.push(memory)
  }
  const context = lines.length ? `## Relevant memories (${lines.length})\n${lines.join('\n')}` : 'No relevant memories yet.'
  return { context, memories, meta: { tokenEstimate: estimateTokens(context), truncated } }
}
