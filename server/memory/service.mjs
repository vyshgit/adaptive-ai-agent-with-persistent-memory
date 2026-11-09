import { AppError, clampNumber, requireText, redactSecrets, within } from '../safety.mjs'
import { TIERS, memoryNamespace, createMemoryBackend } from './memwal-client.mjs'
import { consolidate, hash, chunkItems, batchKey } from './consolidate.mjs'
import { formatContext } from './context.mjs'
import { createChainReader } from './chain-anchor.mjs'
import { DEMO_MEMORIES } from '../../scripts/demo-memories.mjs'

// These slots outlive an HTTP turn that reports capture as pending. Keeping them
// until the SDK job settles also bounds writes started by tools with short deadlines.
let activeWrites = 0
const MAX_GLOBAL_WRITES = 8
const MAX_SERVICE_WRITES = 2

export function createMemoryService({ env = process.env, backend = createMemoryBackend({ env }),
  chain = createChainReader(), clock = () => new Date(), recallTimeoutMs = 15_000 } = {}) {
  const analyses = new Map()
  const recent = new Map()
  let destroyed = false
  let writes = 0
  function assertActive() {
    if (destroyed) throw new AppError('wallet_required', 'This memory session has ended. Reconnect your wallet and APIs.', 401)
  }
  async function writeOperation(task) {
    assertActive()
    if (activeWrites >= MAX_GLOBAL_WRITES || writes >= MAX_SERVICE_WRITES) {
      throw new AppError('memory_busy', 'Too many memory writes are still pending. Refresh inventory and wait before retrying.', 429, true)
    }
    activeWrites++; writes++
    try { return await task() }
    finally { activeWrites--; writes-- }
  }

  function noteResults(result, items, tier, occurredAt) {
    assertActive()
    const blobs = []
    let failed = 0
    const results = Array.isArray(result?.results) ? result.results : []
    for (const [i, entry] of results.entries()) {
      if (entry?.status !== 'done' || typeof entry.blob_id !== 'string' || !entry.blob_id.trim()) { failed++; continue }
      const namespace = items[i]?.namespace || entry.namespace
      if (!namespace) { failed++; continue }
      const record = { tier, blobId: entry.blob_id, namespace, createdAt: occurredAt || clock().toISOString(),
        size: backend.mode() === 'mock' ? Buffer.byteLength(items[i]?.text || '') : 0 }
      blobs.push(record)
      recent.set(record.blobId, record)
    }
    failed += Math.max(0, items.length - results.length)
    while (recent.size > 100) recent.delete(recent.keys().next().value)
    backend.note(blobs)
    return { blobs, failed }
  }

  async function ingestWork(input, options = {}) {
    assertActive()
    const normal = consolidate(input, { ...options, env })
    const sdk = backend.getClient()
    backend.assertCapacity?.(normal.raw.length + (normal.mode === 'verbatim' ? 0 : 1),
      Buffer.byteLength(normal.raw.map(item => item.text).join('') + (normal.mode === 'verbatim' ? '' : normal.transcript)))
    const stored = { verbatim: 0, facts: 0, failed: 0 }
    const blobs = []
    const anchorPromise = Promise.resolve().then(() => chain.checkpoint()).catch(() => null)
    if (normal.mode !== 'facts') {
      for (const chunk of chunkItems(normal.raw)) {
        assertActive()
        try {
          const result = await sdk.rememberBulkAndWait(chunk.map(({ text, namespace }) => ({ text, namespace })),
            { idempotencyKey: batchKey(chunk.map(item => item.key)), timeoutMs: 120_000 })
          const noted = noteResults(result, chunk, 'raw', normal.occurredAt)
          stored.verbatim += noted.blobs.length
          stored.failed += noted.failed
          blobs.push(...noted.blobs)
        } catch (error) {
          if (error.status === 409) throw new AppError('idempotency_conflict', 'This idempotency key was reused with different content. Keep occurredAt stable on retries.', 409)
          stored.failed += chunk.length
        }
      }
    }
    assertActive()
    if (normal.mode !== 'verbatim' && normal.transcript) {
      const key = hash(`${normal.agentId}\n${normal.sessionId}\n${normal.transcript}`)
      let operation = analyses.get(key)
      if (!operation) {
        if (analyses.size >= 500) analyses.delete(analyses.keys().next().value)
        operation = (async () => {
          try {
            const namespace = memoryNamespace(normal.agentId, 'facts')
            const result = await sdk.analyzeAndWait(normal.transcript, { namespace, ...(normal.occurredAt ? { occurredAt: normal.occurredAt } : {}) }, { timeoutMs: 180_000 })
            const facts = (result.facts || []).map(fact => ({ text: fact.text, namespace }))
            return noteResults(result, facts, 'facts', normal.occurredAt)
          } catch { return { blobs: [], failed: 1 } }
        })()
        analyses.set(key, operation)
      }
      const analyzed = await operation
      assertActive()
      stored.facts += analyzed.blobs.length
      stored.failed += analyzed.failed
      blobs.push(...analyzed.blobs)
    }
    const chainAnchor = await within(anchorPromise, 1000, null)
    if (!stored.verbatim && !stored.facts && stored.failed) {
      throw new AppError('capture_failed', 'No memory writes were confirmed. Inspect Walrus inventory before retrying; accepted jobs may still finish.', 502, true)
    }
    return { success: true, stored, blobs, chainAnchor }
  }

  async function recall(input, { signal } = {}) {
    assertActive()
    const agentId = requireText(input.agentId, 'agentId', 128)
    const query = requireText(input.query, 'query', 2000)
    const limit = Math.floor(clampNumber(input.limit, 8, 1, 20))
    const maxTokens = Math.floor(clampNumber(input.maxTokens, 800, 64, 4000))
    const maxDistance = clampNumber(input.maxDistance, 0.8, 0.01, 2)
    if (input.includeRaw !== undefined && typeof input.includeRaw !== 'boolean') throw new AppError('invalid_request', 'includeRaw must be a boolean.')
    const tiers = input.includeRaw ? TIERS : ['profile', 'facts']
    const namespaces = tiers.map(tier => memoryNamespace(agentId, tier))
    const unavailable = () => ({ success: true, strategy: 'unavailable', context: 'No relevant memories yet.', memories: [],
      meta: { tokenEstimate: 0, truncated: false, namespaces, error: 'memory_unavailable' }, chainAnchor: null })
    try {
      const sdk = backend.getClient()
      const requests = tiers.map(async tier => {
        const hits = await sdk.recall({ query: tier === 'profile' ? 'User preferences personal context travel planning coding workflow constraints' : query,
          namespace: memoryNamespace(agentId, tier), limit, maxTokens, maxDistance: tier === 'profile' ? 2 : maxDistance,
          sort: tier === 'profile' ? 'recent' : 'relevance', timeoutMs: 10_000 })
        return (hits.results || []).map(hit => ({ ...hit, text: redactSecrets(hit.text, [], env), tier,
          ...(backend.mode() === 'mock' && recent.has(hit.blob_id) ? { createdAt: recent.get(hit.blob_id).createdAt } : {}) }))
      })
      const result = await within(Promise.allSettled(requests), recallTimeoutMs, null, signal)
      if (!result) return unavailable()
      const partial = result.some(item => item.status === 'rejected')
      if (result.every(item => item.status === 'rejected')) return unavailable()
      const hits = result.flatMap(item => item.status === 'fulfilled' ? item.value : [])
      const formatted = formatContext(hits, { maxTokens, limit })
      return { success: true, strategy: backend.mode() === 'mock' ? 'mock-lexical' : 'semantic', ...formatted,
        meta: { ...formatted.meta, namespaces, ...(partial ? { error: 'memory_unavailable' } : {}) }, chainAnchor: null }
    } catch (error) {
      if (signal?.aborted) throw error
      return unavailable()
    }
  }

  async function inventory(agentId) {
    assertActive()
    requireText(agentId, 'agentId', 128)
    const records = new Map()
    const deleted = new Set()
    const deadline = Date.now() + 20_000
    let truncated = false
    const namespaces = TIERS.map(tier => memoryNamespace(agentId, tier))
    for (const namespace of namespaces) {
      let cursor
      const seen = new Set()
      for (let pages = 0; pages < 100; pages++) {
        assertActive()
        const page = await within(backend.list({ namespace, cursor, limit: 100 }), Math.max(0, deadline - Date.now()), null)
        if (!page) throw new AppError('memory_unavailable', 'Walrus inventory timed out. Refresh to try again.', 502, true)
        if (page.must_resync) throw new AppError('inventory_resync', 'Walrus inventory changed during pagination. Refresh to start a new snapshot.', 502, true)
        if (!Array.isArray(page.memories)) throw new AppError('memory_unavailable', 'Invalid Walrus inventory response.', 502, true)
        for (const entry of page.memories) {
          if (entry.namespace_id !== namespace || typeof entry.blob_id !== 'string' || !entry.blob_id.trim()
            || !['active', 'done', 'stored'].includes(entry.status) || deleted.has(entry.memory_id)) continue
          if (entry.expires_at && Date.parse(entry.expires_at) <= clock().getTime()) continue
          if (records.size >= 2000) { truncated = true; break }
          records.set(entry.blob_id, { memoryId: entry.memory_id, blobId: entry.blob_id, namespace, createdAt: entry.created_at, size: entry.size || 0,
            ...(entry.end_epoch != null ? { endEpoch: entry.end_epoch } : {}) })
        }
        for (const tombstone of page.deleted || []) {
          if (tombstone.namespace_id !== namespace) continue
          deleted.add(tombstone.memory_id)
          for (const [id, record] of records) if (record.memoryId === tombstone.memory_id) records.delete(id)
        }
        if (!page.has_more || truncated) break
        if (!page.next_cursor || seen.has(page.next_cursor)) throw new AppError('memory_unavailable', 'Walrus inventory returned a missing or repeated cursor.', 502, true)
        seen.add(page.next_cursor)
        cursor = page.next_cursor
        if (pages === 99) truncated = true
      }
      if (truncated) break
    }
    const status = await backend.status()
    const memories = [...records.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    return { success: true, agentId, total: memories.length, truncated,
      meetsHackathonMinimum: status.network === 'mainnet' && memories.length >= 10 && memories.every(record => !record.blobId.startsWith('mock-')),
      namespaces: namespaces.map(name => ({ name, count: memories.filter(record => record.namespace === name).length })),
      memories, recentWrites: [...recent.values()].filter(record => namespaces.includes(record.namespace)).reverse() }
  }

  async function rememberWork({ agentId, text, tier = 'facts' }, { secrets = [] } = {}) {
    assertActive()
    requireText(text, 'text', 20_000)
    if (!['profile', 'facts'].includes(tier)) throw new AppError('invalid_request', 'tier must be profile or facts.')
    const namespace = memoryNamespace(agentId, tier)
    const clean = redactSecrets(text, secrets, env)
    backend.assertCapacity?.(1, Buffer.byteLength(clean))
    const result = await backend.getClient().rememberBulkAndWait([{ text: clean, namespace }],
      { idempotencyKey: hash(`${namespace}\n${clean}`), timeoutMs: 120_000 })
    const noted = noteResults(result, [{ text: clean, namespace }], tier)
    if (!noted.blobs.length) throw new AppError('capture_failed', 'The memory write was not confirmed.', 502, true)
    return { success: true, ...noted.blobs[0] }
  }

  async function seedWork({ agentId = env.RECALLLOOP_AGENT_ID || 'recallloop-workspace', confirm }) {
    assertActive()
    const status = await backend.status()
    if (confirm !== 'seed-mainnet' || status.mode !== 'relayer' || status.network !== 'mainnet' || !status.writeReady) {
      throw new AppError('seed_refused', 'Seeding requires confirm=seed-mainnet and a healthy official Mainnet relayer with configured credentials.', 412)
    }
    const items = DEMO_MEMORIES.map(text => ({ text, namespace: memoryNamespace(agentId, 'facts') }))
    const result = await backend.getClient().rememberBulkAndWait(items, { idempotencyKey: hash(JSON.stringify(items)), timeoutMs: 180_000 })
    const noted = noteResults(result, items, 'facts')
    const proof = await inventory(agentId)
    const confirmed = new Set(proof.memories.map(record => record.blobId))
    const verified = noted.blobs.filter(record => confirmed.has(record.blobId))
    return { success: verified.length === 12 && proof.meetsHackathonMinimum, written: noted.blobs.length,
      verified: verified.length, failed: noted.failed, blobs: noted.blobs, inventory: proof, status,
      agentPublicKey: await backend.getClient().getPublicKeyHex(), chainAnchor: await chain.checkpoint() }
  }

  async function restore(agentId) {
    assertActive()
    const sdk = backend.getClient()
    const results = await Promise.all(TIERS.map(tier => sdk.restore(memoryNamespace(agentId, tier), 20)))
    return { success: true, results, inventory: await inventory(agentId),
      warning: 'Restore is bounded by the relayer; it does not guarantee a complete transcript or full recovery.' }
  }
  return { ingest: (input, options) => writeOperation(() => ingestWork(input, options)), recall, inventory,
    remember: (input, options) => writeOperation(() => rememberWork(input, options)),
    seed: input => writeOperation(() => seedWork(input)), restore, status: backend.status, chain,
    destroy() { destroyed = true; backend.destroy?.(); analyses.clear(); recent.clear() } }
}
