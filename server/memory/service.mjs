import { AppError, clampNumber, requireText, redactSecrets, within } from '../safety.mjs'
import { TIERS, memoryNamespace, logicalAgentId, createMemoryBackend } from './memwal-client.mjs'
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
  chain = createChainReader(), clock = () => new Date(), recallTimeoutMs = 15_000, principal = null } = {}) {
  const boundPrincipal = principal === null ? null : requireText(principal, 'memory principal', 128)
  const analyses = new Map()
  const captures = new Map()
  const recent = new Map()
  let destroyed = false
  let writes = 0
  function assertActive() {
    if (destroyed) throw new AppError('wallet_required', 'This memory session has ended. Reconnect your wallet and APIs.', 401)
  }
  function assertScope(value) {
    assertActive()
    const agentId = requireText(value, 'agentId', 128)
    if (boundPrincipal !== null && agentId !== boundPrincipal) {
      throw new AppError('scope_forbidden', 'This memory connection is not authorized for the requested identity.', 403)
    }
    return boundPrincipal === null ? logicalAgentId(agentId) : agentId
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

  function sharedOperation(cache, key, task) {
    const existing = cache.get(key)
    if (existing) return { operation: existing.operation, deduplicated: true }
    const entry = { pending: true }
    cache.set(key, entry)
    entry.operation = (async () => task())().then(result => {
      entry.pending = false
      // An unsuccessful analysis must not permanently suppress a later retry.
      if ((result.failed || result.stored?.failed) && cache.get(key) === entry) cache.delete(key)
      return result
    }, error => {
      entry.pending = false
      if (cache.get(key) === entry) cache.delete(key)
      throw error
    })
    // Never evict an accepted job while it is pending. Write slots bound those
    // entries; only completed results may leave the ephemeral dedupe window.
    for (const [oldKey, old] of cache) {
      if (cache.size <= 500) break
      if (!old.pending) cache.delete(oldKey)
    }
    return { operation: entry.operation, deduplicated: false }
  }

  function noteResults(result, items, tier, occurredAt) {
    assertActive()
    const blobs = []
    let failed = 0
    const results = Array.isArray(result?.results) ? result.results : []
    for (const [i, entry] of results.entries()) {
      if (entry?.status !== 'done' || typeof entry.blob_id !== 'string' || !entry.blob_id.trim()) { failed++; continue }
      const namespace = items[i]?.namespace
      if (!namespace || (entry.namespace !== undefined && entry.namespace !== namespace)) { failed++; continue }
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

  async function ingestWork(normal, automatic = false) {
    const sdk = backend.getClient()
    const raw = normal.mode === 'facts' ? [] : normal.raw
    backend.assertCapacity?.(raw.length + (normal.mode === 'verbatim' || !normal.transcript ? 0 : 1),
      Buffer.byteLength(raw.map(item => item.text).join('') + (normal.mode === 'verbatim' ? '' : normal.transcript)))
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
      const analyze = async () => {
        try {
          const namespace = memoryNamespace(normal.agentId, 'facts')
          const result = await sdk.analyzeAndWait(normal.transcript, { namespace, ...(normal.occurredAt ? { occurredAt: normal.occurredAt } : {}) }, { timeoutMs: 180_000 })
          if (!Array.isArray(result?.facts) || !Array.isArray(result?.results)) throw new Error('Invalid analysis result')
          const facts = result.facts.map(fact => ({ text: fact.text, namespace }))
          return noteResults(result, facts, 'facts', normal.occurredAt)
        } catch { return { blobs: [], failed: 1 } }
      }
      // Automatic requests share the entire ingest below, before capacity and
      // write-slot admission. Explicit captures keep their own timestamped key.
      const key = hash(JSON.stringify([normal.agentId, normal.sessionId, normal.occurredAt || null, normal.transcript]))
      const analyzed = await (automatic ? analyze() : sharedOperation(analyses, key, analyze).operation)
      assertActive()
      stored.facts += analyzed.blobs.length
      stored.failed += analyzed.failed
      blobs.push(...analyzed.blobs)
    }
    const chainAnchor = await within(anchorPromise, 1000, null)
    assertActive()
    if (!stored.verbatim && !stored.facts && stored.failed) {
      throw new AppError('capture_failed', 'No memory writes were confirmed. Inspect Walrus inventory before retrying; accepted jobs may still finish.', 502, true)
    }
    return { success: true, stored, blobs, chainAnchor }
  }

  async function ingest(input, options = {}) {
    assertScope(input?.agentId)
    const normal = consolidate(input, { ...options, env })
    if (options.automatic !== true || normal.mode !== 'facts') return writeOperation(() => ingestWork(normal))
    // A UTC-day boundary matters for relative dates such as "tomorrow". Within
    // that day, identical context across page conversations shares one job.
    const day = (normal.occurredAt || clock().toISOString()).slice(0, 10)
    const key = hash(JSON.stringify([normal.agentId, day, normal.transcript]))
    const shared = sharedOperation(captures, key, () => writeOperation(() => ingestWork(normal, true)))
    const result = await shared.operation
    assertActive()
    return shared.deduplicated ? { ...result, deduplicated: true } : result
  }

  async function recall(input, { signal } = {}) {
    const agentId = assertScope(input?.agentId)
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
      assertActive()
      if (!result) return unavailable()
      const partial = result.some(item => item.status === 'rejected')
      if (result.every(item => item.status === 'rejected')) return unavailable()
      const hits = result.flatMap(item => item.status === 'fulfilled' ? item.value : [])
      const formatted = formatContext(hits, { maxTokens, limit })
      return { success: true, strategy: backend.mode() === 'mock' ? 'mock-lexical' : 'semantic', ...formatted,
        meta: { ...formatted.meta, namespaces, ...(partial ? { error: 'memory_unavailable' } : {}) }, chainAnchor: null }
    } catch (error) {
      assertActive()
      if (signal?.aborted) throw error
      return unavailable()
    }
  }

  async function inventory(agentId) {
    agentId = assertScope(agentId)
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
        assertActive()
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
    assertActive()
    const memories = [...records.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    return { success: true, agentId, total: memories.length, truncated,
      meetsHackathonMinimum: status.network === 'mainnet' && memories.length >= 10 && memories.every(record => !record.blobId.startsWith('mock-')),
      namespaces: namespaces.map(name => ({ name, count: memories.filter(record => record.namespace === name).length })),
      memories, recentWrites: [...recent.values()].filter(record => namespaces.includes(record.namespace)).reverse() }
  }

  async function rememberWork({ agentId, text, tier = 'facts' }, { secrets = [] } = {}) {
    agentId = assertScope(agentId)
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

  async function seedWork({ agentId = boundPrincipal || env.RECALLLOOP_AGENT_ID || 'recallloop-workspace', confirm }) {
    agentId = assertScope(agentId)
    const status = await backend.status()
    assertActive()
    if (confirm !== 'seed-mainnet' || status.mode !== 'relayer' || status.network !== 'mainnet' || !status.writeReady) {
      throw new AppError('seed_refused', 'Seeding requires confirm=seed-mainnet and a healthy official Mainnet relayer with configured credentials.', 412)
    }
    const items = DEMO_MEMORIES.map(text => ({ text, namespace: memoryNamespace(agentId, 'facts') }))
    const result = await backend.getClient().rememberBulkAndWait(items, { idempotencyKey: hash(JSON.stringify(items)), timeoutMs: 180_000 })
    const noted = noteResults(result, items, 'facts')
    const proof = await inventory(agentId)
    const confirmed = new Set(proof.memories.map(record => record.blobId))
    const verified = noted.blobs.filter(record => confirmed.has(record.blobId))
    const agentPublicKey = await backend.getClient().getPublicKeyHex()
    const chainAnchor = await chain.checkpoint()
    assertActive()
    return { success: verified.length === 12 && proof.meetsHackathonMinimum, written: noted.blobs.length,
      verified: verified.length, failed: noted.failed, blobs: noted.blobs, inventory: proof, status,
      agentPublicKey, chainAnchor }
  }

  async function restore(agentId) {
    agentId = assertScope(agentId)
    const sdk = backend.getClient()
    const results = await Promise.all(TIERS.map(tier => sdk.restore(memoryNamespace(agentId, tier), 20)))
    assertActive()
    return { success: true, results, inventory: await inventory(agentId),
      warning: 'Restore is bounded by the relayer; it does not guarantee a complete transcript or full recovery.' }
  }
  async function status() {
    assertActive()
    const result = await backend.status()
    assertActive()
    return result
  }
  return { ingest, recall, inventory,
    remember: (input, options) => writeOperation(() => rememberWork(input, options)),
    seed: input => writeOperation(() => seedWork(input)), restore, status, chain,
    destroy() { destroyed = true; backend.destroy?.(); analyses.clear(); captures.clear(); recent.clear() } }
}
