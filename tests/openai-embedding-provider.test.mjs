import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpenAIEmbeddingProvider, embeddingProviderDefaults } from '../server/openai-embedding-provider.mjs'

test('provider defaults to text-embedding-3-small with reduced dimensions', () => {
  assert.deepEqual(embeddingProviderDefaults, { model: 'text-embedding-3-small', dimensions: 384 })
})

test('provider sends model, input, and dimensions and validates response', async () => {
  let request
  const embed = createOpenAIEmbeddingProvider({
    apiKey: 'test-key',
    dimensions: 3,
    fetchImpl: async (url, options) => {
      request = { url, options }
      return { ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) }
    },
  })
  assert.deepEqual(await embed('a short query'), [0.1, 0.2, 0.3])
  assert.equal(request.url, 'https://api.openai.com/v1/embeddings')
  assert.equal(request.options.headers.authorization, 'Bearer test-key')
  assert.deepEqual(JSON.parse(request.options.body), {
    model: 'text-embedding-3-small',
    input: 'a short query',
    dimensions: 3,
    encoding_format: 'float',
  })
})

test('provider fails closed without an API key', () => {
  assert.throws(() => createOpenAIEmbeddingProvider({ apiKey: '' }), /OPENAI_API_KEY is required/)
})

test('provider rejects empty text and malformed or wrong-sized vectors', async () => {
  const embed = createOpenAIEmbeddingProvider({
    apiKey: 'test-key',
    dimensions: 3,
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ embedding: [1, 2] }] }) }),
  })
  await assert.rejects(embed('valid input'), /invalid vector or unexpected dimensions/)
  await assert.rejects(embed('   '), /non-empty string/)
})

test('provider surfaces HTTP failures without exposing a full response body', async () => {
  const embed = createOpenAIEmbeddingProvider({
    apiKey: 'test-key',
    dimensions: 3,
    fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate limit exceeded' }),
  })
  await assert.rejects(embed('query'), /HTTP 429: rate limit exceeded/)
})

test('provider attaches a bounded timeout signal and validates timeout configuration', async () => {
  let requestOptions
  const embed = createOpenAIEmbeddingProvider({
    apiKey: 'test-key',
    dimensions: 3,
    timeoutMs: 1234,
    fetchImpl: async (_url, options) => {
      requestOptions = options
      return { ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) }
    },
  })
  await embed('timeout test')
  assert.ok(requestOptions.signal instanceof AbortSignal)
  assert.equal(requestOptions.signal.aborted, false)
  assert.throws(() => createOpenAIEmbeddingProvider({ apiKey: 'test-key', timeoutMs: 0 }), /timeout must be an integer/)
})
