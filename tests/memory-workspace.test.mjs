import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryService } from '../server/memory/service.mjs'
import { createMemoryBackend, memoryNamespace, resolveMemoryMode } from '../server/memory/memwal-client.mjs'
import { consolidate, chunkItems, batchKey } from '../server/memory/consolidate.mjs'
import { formatContext, estimateTokens } from '../server/memory/context.mjs'
import { createChainReader } from '../server/memory/chain-anchor.mjs'
import { DEMO_MEMORIES } from '../scripts/demo-memories.mjs'

const chain = { checkpoint: async () => null }
const mock = () => createMemoryService({ env: { RECALLLOOP_MEMORY_MODE: 'mock' }, chain })
const input = (agentId = 'agent-a', content = 'I prefer TypeScript with EUR prices.') => ({ agentId, sessionId: 's-one', occurredAt: '2026-11-08T00:00:00Z', messages: [{ role: 'user', content }] })

test('memory mode never silently falls back, and namespace sanitisation does not merge identities', () => {
  assert.equal(resolveMemoryMode({}), 'unconfigured')
  assert.equal(resolveMemoryMode({ MEMWAL_PRIVATE_KEY: 'key', MEMWAL_ACCOUNT_ID: 'account' }), 'relayer')
  assert.throws(() => resolveMemoryMode({ RECALLLOOP_MEMORY_MODE: 'automatic' }), /must be/)
  assert.notEqual(memoryNamespace('agent a', 'facts'), memoryNamespace('agent-a', 'facts'))
  assert.notEqual(memoryNamespace('a/b', 'raw'), memoryNamespace('a-b', 'raw'))
  assert.ok(memoryNamespace('x'.repeat(128), 'profile').length < 90)
  assert.throws(() => memoryNamespace('a', 'private'), /tier/)
  assert.throws(() => createMemoryBackend({ env: {} }).getClient(), /Configure/)
})

test('consolidation validates roles/timestamps, bounds batches and extracts only user statements', () => {
  const normal = consolidate({ ...input(), messages: [{ role: 'user', content: 'I prefer EUR. private-session-key' }, { role: 'assistant', content: 'I applied unapproved code.' }] }, { secrets: ['private-session-key'] })
  assert.equal(normal.raw.length, 2)
  assert.equal(normal.transcript.includes('unapproved'), false)
  assert.equal(normal.transcript.includes('private-session-key'), false)
  assert.equal(batchKey(['b', 'a']), batchKey(['a', 'b']))
  assert.deepEqual(chunkItems(Array.from({ length: 41 }, (_, i) => i)).map(chunk => chunk.length), [20, 20, 1])
  assert.throws(() => consolidate({ ...input(), occurredAt: 'yesterday' }), /UTC/)
  assert.throws(() => consolidate({ ...input(), messages: [{ role: 'tool', content: 'result' }] }), /tool.name/)
})

test('mock ingestion is idempotent, recalls after a new session, and isolates agents', async () => {
  const memory = mock()
  const first = await memory.ingest(input())
  const retry = await memory.ingest(input())
  assert.deepEqual(first.blobs.map(record => record.blobId), retry.blobs.map(record => record.blobId))
  assert.equal((await memory.inventory('agent-a')).total, 2)
  const recalled = await memory.recall({ agentId: 'agent-a', query: 'TypeScript EUR' })
  assert.equal(recalled.strategy, 'mock-lexical')
  assert.match(recalled.context, /EUR/)
  assert.equal(recalled.memories.length, 1)
  assert.equal((await memory.recall({ agentId: 'agent-b', query: 'TypeScript EUR' })).memories.length, 0)
  assert.equal((await memory.inventory('agent-b')).total, 0)
  assert.equal((await memory.inventory('agent-a')).meetsHackathonMinimum, false)
  assert.equal((await mock().inventory('agent-a')).total, 0, 'mock state is process-local, not persistent storage')
})

test('profile preferences are pinned; context is deduplicated and fits its token budget', () => {
  const hits = [{ blob_id: 'fact', text: 'Use npm.', distance: 0.1 }, { blob_id: 'profile', text: 'I prefer EUR.', tier: 'profile', distance: 0.8 },
    { blob_id: 'fact', text: 'Use npm.', distance: 0.2 }, { blob_id: 'huge', text: 'very long '.repeat(200), distance: 0.3 }]
  const result = formatContext(hits, { maxTokens: 64 })
  assert.equal(result.memories[0].blobId, 'profile')
  assert.equal(result.memories.filter(item => item.blobId === 'fact').length, 1)
  assert.ok(estimateTokens(result.context) <= 64)
  assert.equal(result.meta.truncated, true)
})

test('partial writes count confirmed blobs only and failed recall does not masquerade as empty success', async () => {
  const sdk = { rememberBulkAndWait: async items => ({ results: items.map((item, i) => i ? { status: 'failed', blob_id: '' } : { status: 'done', blob_id: 'confirmed-blob', namespace: item.namespace }) }),
    recall: async () => { throw new Error('offline') } }
  const backend = { getClient: () => sdk, mode: () => 'relayer', note() {} }
  const memory = createMemoryService({ backend, chain })
  const result = await memory.ingest({ ...input(), mode: 'verbatim', messages: [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'second' }] })
  assert.deepEqual(result.stored, { verbatim: 1, facts: 0, failed: 1 })
  assert.equal(result.blobs.length, 1)
  assert.equal((await memory.recall({ agentId: 'a', query: 'anything' })).strategy, 'unavailable')
})

test('recall deadline and abort do not block a chat turn', async () => {
  const memory = createMemoryService({ backend: { getClient: () => ({ recall: () => new Promise(() => {}) }) }, chain, recallTimeoutMs: 2 })
  assert.equal((await memory.recall({ agentId: 'a', query: 'anything' })).meta.error, 'memory_unavailable')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(memory.recall({ agentId: 'a', query: 'anything' }, { signal: controller.signal }), { name: 'AbortError' })
})

test('inventory follows empty pages and tombstones, excluding other agents and pending/expired blobs', async () => {
  const ns = memoryNamespace('agent-a', 'facts')
  const record = (id, overrides = {}) => ({ memory_id: id, blob_id: `blob-${id}`, namespace_id: ns, status: 'active', ...overrides })
  const backend = { status: async () => ({ network: 'mainnet' }), list: async ({ namespace, cursor }) => {
    if (namespace !== ns) return { memories: [], has_more: false }
    if (!cursor) return { memories: [record('deleted')], has_more: true, next_cursor: 'one' }
    if (cursor === 'one') return { memories: [], deleted: [{ memory_id: 'deleted', namespace_id: ns }], has_more: true, next_cursor: 'two' }
    return { memories: [record('valid'), record('pending', { status: 'uploaded' }), record('expired', { expires_at: '2000-01-01T00:00:00Z' }), record('foreign', { namespace_id: 'rl:agent-b:facts' })], has_more: false }
  } }
  const result = await createMemoryService({ backend, chain }).inventory('agent-a')
  assert.deepEqual(result.memories.map(record => record.blobId), ['blob-valid'])
})

test('inventory rejects repeated/missing cursors and resync instead of claiming evidence', async () => {
  for (const page of [{ memories: [], has_more: true }, { memories: [], has_more: true, next_cursor: 'same' }, { memories: [], must_resync: true }]) {
    const backend = { list: async () => page }
    await assert.rejects(createMemoryService({ backend, chain }).inventory('a'), /cursor|snapshot/)
  }
})

test('seed refuses mock and requires independently listed confirmed Mainnet blobs', async () => {
  await assert.rejects(mock().seed({ agentId: 'a', confirm: 'seed-mainnet' }), { code: 'seed_refused' })
  const ns = memoryNamespace('a', 'facts')
  let writes = 0
  const sdk = { rememberBulkAndWait: async items => { writes++; return { results: items.map((_, i) => ({ status: 'done', blob_id: `real-${i}`, namespace: ns })) } }, getPublicKeyHex: async () => 'public-key' }
  const backend = { mode: () => 'relayer', getClient: () => sdk, note() {}, status: async () => ({ mode: 'relayer', network: 'mainnet', writeReady: true }),
    list: async ({ namespace }) => ({ memories: namespace === ns ? DEMO_MEMORIES.map((_, i) => ({ memory_id: `memory-${i}`, blob_id: `real-${i}`, namespace_id: ns, status: 'active' })) : [], has_more: false }) }
  const memory = createMemoryService({ backend, chain })
  await assert.rejects(memory.seed({ agentId: 'a', confirm: 'yes' }), { code: 'seed_refused' })
  assert.equal(writes, 0)
  const result = await memory.seed({ agentId: 'a', confirm: 'seed-mainnet' })
  assert.equal(result.verified, 12)
  assert.equal(result.success, true)
  backend.list = async () => ({ memories: [], has_more: false })
  assert.equal((await memory.seed({ agentId: 'a', confirm: 'seed-mainnet' })).success, false)
})

test('Mainnet status requires official production relayer, explicit network, and never mock', async () => {
  for (const env of [
    { RECALLLOOP_MEMORY_MODE: 'mock', WALRUS_NETWORK: 'mainnet' },
    { RECALLLOOP_MEMORY_MODE: 'relayer', MEMWAL_PRIVATE_KEY: 'key', MEMWAL_ACCOUNT_ID: 'account' },
    { RECALLLOOP_MEMORY_MODE: 'relayer', MEMWAL_PRIVATE_KEY: 'key', MEMWAL_ACCOUNT_ID: 'account', WALRUS_NETWORK: 'mainnet', MEMWAL_SERVER_URL: 'https://custom.example' },
  ]) {
    const backend = createMemoryBackend({ env, clientFactory: () => ({ health: async () => ({ status: 'ok', mode: 'production', write_ready: true }) }) })
    assert.equal((await backend.status()).network, null)
  }
})

test('Tatum checkpoint reads are single-flight cached observations, not storage proof', async () => {
  let calls = 0, now = 1
  const reader = createChainReader({ clock: () => now, ttlMs: 10, graphql: async () => { calls++; return { checkpoint: { sequenceNumber: 42, digest: 'digest' } } } })
  const [a, b] = await Promise.all([reader.checkpoint(), reader.checkpoint()])
  assert.deepEqual(a, b)
  assert.equal(calls, 1)
  assert.equal(a.via, 'tatum')
  now += 11
  await reader.checkpoint()
  assert.equal(calls, 2)
  const failed = createChainReader({ graphql: () => { throw new Error('no key') } })
  assert.equal(await failed.checkpoint(), null)
  assert.equal(await failed.checkpoint(), null)
  await assert.rejects(reader.object('not-an-address'), /address/)
})
