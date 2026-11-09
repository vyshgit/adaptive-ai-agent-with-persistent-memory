import { redactValue, redactSecrets } from '../safety.mjs'
import { formatContext } from '../memory/context.mjs'

const travel = /\b(trip|travel|travelling|traveling|flight|fly|flying|itinerary|holiday|vacation|getaway)\b/i

export function recallQueries({ message, history = [] }) {
  const previous = history.findLast(item => item.role === 'user')?.content || ''
  // Short replies need the user's preceding task, not an assistant's guesses.
  const query = message.length < 300 && previous ? `${message}\nPrevious user context: ${previous.slice(0, 1400)}` : message
  return [query.slice(0, 2000), ...(travel.test(`${message}\n${previous}`)
    ? ['departure city depart from live in travel preferences'] : [])]
}

export async function recallForTurn({ input, memory, agentId, signal, secrets = [] }) {
  const queries = recallQueries(input)
  const results = await Promise.all(queries.map(async query => {
    try { return redactValue(await memory.recall({ agentId, query: redactSecrets(query, secrets) }, { signal }), secrets) }
    catch (error) {
      if (signal?.aborted) throw error
      return { context: 'No relevant memories yet.', memories: [], strategy: 'unavailable', meta: { tokenEstimate: 0, error: 'memory_unavailable' } }
    }
  }))
  signal?.throwIfAborted()
  const unavailable = results.some(result => result.meta.error)
  if (results.length === 1) return { ...results[0], meta: { ...results[0].meta, lookups: 1 } }
  const formatted = formatContext(results.flatMap(result => result.memories), { maxTokens: 800, limit: 8 })
  return { ...formatted, strategy: results.find(result => result.strategy !== 'unavailable')?.strategy || 'unavailable',
    meta: { ...formatted.meta, lookups: queries.length, ...(unavailable ? { error: 'memory_unavailable' } : {}) } }
}
