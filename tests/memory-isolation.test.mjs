import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryService } from '../server/memory/service.mjs'
import { logicalAgentId, memoryNamespace } from '../server/memory/memwal-client.mjs'
import { walletAgentId } from '../server/agent/wallet-auth.mjs'
import { deferred } from './helpers/workspace-http.mjs'

const a = walletAgentId('0xa'), b = walletAgentId('0xb')
const chain = { checkpoint: async () => null }
const ingest = agentId => ({ agentId, sessionId: 'same-chat-id', messages: [{ role: 'user', content: 'My private preference.' }] })

test('every bound memory operation rejects a borrowed principal before accessing the backend', async () => {
  let calls = 0
  const backend = { getClient() { calls++; assert.fail('Cross-user SDK access') }, list() { calls++; assert.fail('Cross-user inventory') },
    status() { calls++; assert.fail('Cross-user seed') } }
  const memory = createMemoryService({ backend, chain, principal: a })
  for (const task of [() => memory.ingest(ingest(b)), () => memory.recall({ agentId: b, query: 'private' }),
    () => memory.inventory(b), () => memory.remember({ agentId: b, text: 'private' }),
    () => memory.restore(b), () => memory.seed({ agentId: b, confirm: 'seed-mainnet' })]) {
    await assert.rejects(task(), { code: 'scope_forbidden', status: 403 })
  }
  assert.equal(calls, 0)
})

test('separate wallet memory services retain only their own profile, facts, and transcript namespaces', async t => {
  const first = createMemoryService({ env: { RECALLLOOP_MEMORY_MODE: 'mock' }, chain, principal: a })
  const second = createMemoryService({ env: { RECALLLOOP_MEMORY_MODE: 'mock' }, chain, principal: b })
  t.after(() => { first.destroy(); second.destroy() })
  await first.remember({ agentId: a, tier: 'profile', text: 'USER_A_ONLY prefers TypeScript.' })
  await first.ingest({ ...ingest(a), mode: 'both' })
  await second.remember({ agentId: b, tier: 'profile', text: 'USER_B_ONLY prefers Python.' })
  await second.ingest({ ...ingest(b), mode: 'both' })
  const inventoryA = await first.inventory(a), inventoryB = await second.inventory(b)
  assert.ok(inventoryA.memories.every(record => record.namespace.startsWith(`rl:${a}:`)))
  assert.ok(inventoryB.memories.every(record => record.namespace.startsWith(`rl:${b}:`)))
  assert.ok(inventoryA.memories.some(record => record.namespace.endsWith(':raw')))
  const recallA = await first.recall({ agentId: a, query: 'private preference', includeRaw: true })
  assert.match(recallA.context, /USER_A_ONLY/)
  assert.equal(recallA.context.includes('USER_B_ONLY'), false)
  await assert.rejects(second.recall({ agentId: a, query: 'USER_A_ONLY', includeRaw: true }), { code: 'scope_forbidden' })
})

test('unbound logical-agent services cannot address any wallet, demo, or dashboard namespace', async () => {
  const memory = createMemoryService({ env: { RECALLLOOP_MEMORY_MODE: 'mock' }, chain })
  for (const identity of [a, b, 'demo-private', 'wallet/private', 'recallloop-dashboard']) {
    assert.throws(() => logicalAgentId(identity), { code: 'scope_forbidden' })
    await assert.rejects(memory.ingest(ingest(identity)), { code: 'scope_forbidden' })
    await assert.rejects(memory.recall({ agentId: identity, query: 'private' }), { code: 'scope_forbidden' })
    await assert.rejects(memory.inventory(identity), { code: 'scope_forbidden' })
    await assert.rejects(memory.remember({ agentId: identity, text: 'private' }), { code: 'scope_forbidden' })
    await assert.rejects(memory.restore(identity), { code: 'scope_forbidden' })
    await assert.rejects(memory.seed({ agentId: identity, confirm: 'seed-mainnet' }), { code: 'scope_forbidden' })
  }
  memory.destroy()
})

test('late recall, inventory, status, and explicit writes cannot return data after disposal', async () => {
  for (const method of ['recall', 'inventory', 'status', 'remember']) {
    const gate = deferred()
    let noted = 0
    const backend = { mode: () => 'relayer', note() { noted++ }, destroy() {}, status: () => gate.promise,
      list: () => gate.promise, getClient: () => ({ recall: () => gate.promise, rememberBulkAndWait: () => gate.promise }) }
    const memory = createMemoryService({ backend, chain, principal: a })
    const pending = method === 'recall' ? memory.recall({ agentId: a, query: 'private' })
      : method === 'inventory' ? memory.inventory(a) : method === 'remember' ? memory.remember({ agentId: a, text: 'private' }) : memory.status()
    memory.destroy()
    gate.resolve({ mode: 'relayer', network: 'mainnet', memories: [], has_more: false,
      results: [{ status: 'done', blob_id: 'late-private-blob', text: 'LATE_PRIVATE_MEMORY', distance: 0.1 }] })
    await assert.rejects(pending, { code: 'wallet_required' })
    assert.equal(noted, 0)
  }
})

test('write confirmation cannot replace the requested namespace or claim a pending job is stored', async () => {
  const namespace = memoryNamespace(a, 'profile')
  for (const result of [{ status: 'done', blob_id: 'foreign', namespace: memoryNamespace(b, 'profile') },
    { status: 'uploaded', blob_id: 'pending', namespace }, { status: 'done', job_id: 'pending-without-blob', namespace }]) {
    let records = []
    const memory = createMemoryService({ principal: a, chain, backend: { mode: () => 'relayer', note(value) { records = value },
      getClient: () => ({ rememberBulkAndWait: async () => ({ results: [result] }) }) } })
    await assert.rejects(memory.remember({ agentId: a, text: 'My preference.', tier: 'profile' }), { code: 'capture_failed' })
    assert.deepEqual(records, [])
  }
})
