const DEFAULT_MODEL = 'text-embedding-3-small'
const DEFAULT_DIMENSIONS = 384

export function createOpenAIEmbeddingProvider({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.RECALLLOOP_EMBEDDING_MODEL || DEFAULT_MODEL,
  dimensions = Number(process.env.RECALLLOOP_EMBEDDING_DIMENSIONS || DEFAULT_DIMENSIONS),
  baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  timeoutMs = Number(process.env.RECALLLOOP_EMBEDDING_TIMEOUT_MS || 15000),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for vector retrieval evaluation')
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required')
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 2048) {
    throw new Error('Embedding dimensions must be an integer between 1 and 2048')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new Error('Embedding timeout must be an integer between 1 and 120000 milliseconds')
  }

  return async function embed(text) {
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('Embedding input must be a non-empty string')
    const response = await fetchImpl(`${baseURL.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, input: text, dimensions, encoding_format: 'float' }),
    })
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300)
      throw new Error(`Embedding provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
    }
    const payload = await response.json()
    const vector = payload?.data?.[0]?.embedding
    if (!Array.isArray(vector) || vector.length !== dimensions || !vector.every(Number.isFinite)) {
      throw new Error('Embedding provider returned an invalid vector or unexpected dimensions')
    }
    return vector
  }
}

export const embeddingProviderDefaults = Object.freeze({
  model: DEFAULT_MODEL,
  dimensions: DEFAULT_DIMENSIONS,
})
