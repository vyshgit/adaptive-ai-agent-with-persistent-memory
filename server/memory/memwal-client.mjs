import { createHash } from 'node:crypto'
import { MemWal, MemWalMock } from '@mysten-incubation/memwal'
import { AppError, requireText } from '../safety.mjs'

export const OFFICIAL_RELAYER = 'https://relayer.memory.walrus.xyz'
export const TIERS = ['profile', 'facts', 'raw']

export function memoryCredentials(env = process.env) {
  const key = env.MEMWAL_PRIVATE_KEY || env.MEMWAL_DELEGATE_KEY
  return key && env.MEMWAL_ACCOUNT_ID ? { key, accountId: env.MEMWAL_ACCOUNT_ID } : null
}

export function resolveMemoryMode(env = process.env) {
  const mode = env.RECALLLOOP_MEMORY_MODE
  if (mode && !['relayer', 'mock', 'legacy'].includes(mode)) {
    throw new AppError('memory_not_configured', 'RECALLLOOP_MEMORY_MODE must be relayer, mock, or legacy.', 503)
  }
  return mode || (memoryCredentials(env) ? 'relayer' : 'unconfigured')
}

export function namespaceAgentId(agentId) {
  const original = requireText(agentId, 'agentId', 128)
  let safe = original.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!safe) throw new AppError('invalid_request', 'agentId must contain a letter or number.')
  // Sanitisation must never merge two authenticated identities.
  if (safe !== original || safe.length > 64) {
    safe = `${safe.slice(0, 51)}-${createHash('sha256').update(original).digest('hex').slice(0, 12)}`
  }
  return safe
}

export function memoryNamespace(agentId, tier) {
  if (!TIERS.includes(tier)) throw new AppError('invalid_request', 'Unknown memory tier.')
  return `rl:${namespaceAgentId(agentId)}:${tier}`
}

// Wallet/demo identities are issued by wallet-auth, never by external API clients.
export function logicalAgentId(value) {
  const id = requireText(value, 'agentId', 128)
  const namespaceId = namespaceAgentId(id)
  if (/^(?:wallet|demo)-/i.test(namespaceId) || namespaceId === 'recallloop-dashboard') {
    throw new AppError('scope_forbidden', 'Wallet, demo, and dashboard identities are not external logical-agent scopes.', 403)
  }
  return id
}

export function createMemoryBackend({ env = process.env, clientFactory, lister, clock = () => new Date() } = {}) {
  let client
  let signature
  let healthCache
  let healthChecked = 0
  let destroyed = false
  const mockInventory = new Map()

  function mode() { return resolveMemoryMode(env) }
  function getClient() {
    if (destroyed) throw new AppError('wallet_required', 'This memory connection has ended. Reconnect your wallet and APIs.', 401)
    const current = mode()
    const credentials = memoryCredentials(env)
    if (current === 'unconfigured' || (current === 'relayer' && !credentials)) {
      throw new AppError('memory_not_configured', 'Configure MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID, or explicitly select mock mode.', 503)
    }
    if (current === 'legacy') {
      throw new AppError('memory_not_configured', 'Legacy Testnet storage is available only through /api/walrus. Select relayer or mock for the workspace.', 503)
    }
    const nextSignature = JSON.stringify([current, credentials, env.MEMWAL_SERVER_URL])
    if (!client || signature !== nextSignature) {
      client?.destroy?.()
      healthCache = undefined
      healthChecked = 0
      mockInventory.clear()
      try {
        client = clientFactory ? clientFactory(current) : current === 'mock'
          ? MemWalMock.create({ namespace: 'default' })
          : MemWal.create({ ...credentials, serverUrl: env.MEMWAL_SERVER_URL || OFFICIAL_RELAYER,
            namespace: 'default', requestTimeoutMs: 20_000, recallTimeoutMs: 10_000, preflightTimeoutMs: 5_000 })
      } catch {
        throw new AppError('memory_not_configured', 'The Walrus delegate key or account configuration is invalid.', 503)
      }
      signature = nextSignature
    }
    return client
  }

  function note(records) {
    if (destroyed || mode() !== 'mock') return
    for (const record of records) {
      if (!mockInventory.has(record.blobId)) mockInventory.set(record.blobId, {
        memory_id: record.blobId, blob_id: record.blobId, namespace_id: record.namespace,
        created_at: record.createdAt || clock().toISOString(), size: record.size || 0, status: 'active',
      })
    }
  }

  function assertCapacity(items = 1, bytes = 0) {
    if (mode() !== 'mock') return
    const used = [...mockInventory.values()].reduce((sum, record) => sum + record.size, 0)
    if (mockInventory.size + items > 2000 || used + bytes > 2_000_000) {
      throw new AppError('memory_limit', 'Ephemeral mock memory reached its 2,000-record or 2 MB limit. Leave the demo and open a new one to reset it.', 429)
    }
  }

  async function list(options) {
    const sdk = getClient()
    if (lister) return lister(options, sdk)
    if (mode() === 'mock') {
      // MemWalMock has no listMemories(). Inventory only confirmed mock writes.
      const records = [...mockInventory.values()].filter(record => record.namespace_id === options.namespace)
      const offset = Number(options.cursor || 0)
      const end = offset + options.limit
      return { memories: records.slice(offset, end), has_more: end < records.length,
        next_cursor: end < records.length ? String(end) : null, must_resync: false, deleted: [] }
    }
    return sdk.listMemories(options)
  }

  async function status() {
    const checkedAt = clock().toISOString()
    let current
    try { current = mode() } catch { current = 'unconfigured' }
    const relayerUrl = (env.MEMWAL_SERVER_URL || OFFICIAL_RELAYER).replace(/\/+$/, '')
    const base = { mode: current, network: null, healthy: false, writeReady: false,
      accountConfigured: Boolean(memoryCredentials(env)), accountId: env.MEMWAL_ACCOUNT_ID || null,
      relayerUrl, relayerVersion: null, checkedAt, namespaces: 'rl:<agentId>:{profile,facts,raw}' }
    if (!['relayer', 'mock'].includes(current)) return base
    try {
      const sdk = getClient()
      if (!healthCache || Date.now() - healthChecked > 15_000) {
        const health = await sdk.health()
        if (destroyed) return { ...base, healthy: false, writeReady: false, error: 'This memory connection has ended.' }
        healthCache = health
        healthChecked = Date.now()
      }
      const healthy = healthCache.status === 'ok' || healthCache.status === 'healthy'
      const mainnet = current === 'relayer' && healthy && healthCache.mode === 'production'
        && relayerUrl === OFFICIAL_RELAYER && env.WALRUS_NETWORK === 'mainnet'
      return { ...base, healthy, network: mainnet ? 'mainnet' : null,
        writeReady: current === 'mock' || (healthy && healthCache.write_ready === true),
        relayerVersion: healthCache.relayerVersion || healthCache.version || null }
    } catch { return { ...base, error: 'Walrus Memory is not configured or the relayer health check failed.' } }
  }
  function destroy() {
    destroyed = true
    client?.destroy?.()
    client = undefined
    signature = undefined
    healthCache = undefined
    mockInventory.clear()
  }
  return { mode, getClient, list, note, status, destroy, assertCapacity }
}
