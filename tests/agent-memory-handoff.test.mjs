import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryHandoff, MEMORY_GUIDES } from '../server/agent/memory-handoff.mjs'
import { OFFICIAL_RELAYER, memoryNamespace } from '../server/memory/memwal-client.mjs'
import { suiAddress, walletAgentId } from '../server/agent/wallet-auth.mjs'

const owner = suiAddress('0xaa'), accountId = suiAddress('0xbb'), agentId = walletAgentId(owner)
function session() {
  return { kind: 'wallet', address: owner, agentId, memoryConnection: { accountId, owner, publicKey: 'public-key', verified: true },
    env: { RECALLLOOP_MEMORY_MODE: 'relayer', WALRUS_NETWORK: 'mainnet', MEMWAL_ACCOUNT_ID: accountId, MEMWAL_SERVER_URL: OFFICIAL_RELAYER,
      MEMWAL_PRIVATE_KEY: 'SYNTHETIC_PRIVATE_DELEGATE', TATUM_API_KEY: 'SYNTHETIC_PRIVATE_TATUM' },
    config: { apiKey: 'SYNTHETIC_PRIVATE_MODEL' }, chats: ['PRIVATE_CHAT_TEXT'], memories: ['PRIVATE_MEMORY_TEXT'] }
}

test('handoff exports verified setup metadata for existing profile/facts only, never credentials or content', () => {
  const result = createMemoryHandoff(session())
  assert.equal(result.accountId, accountId)
  assert.equal(result.owner, owner)
  assert.equal(result.relayerUrl, OFFICIAL_RELAYER)
  assert.deepEqual(result.namespaces, { profile: memoryNamespace(agentId, 'profile'), facts: memoryNamespace(agentId, 'facts') })
  assert.deepEqual(result.guides, MEMORY_GUIDES)
  const exported = JSON.stringify(result)
  for (const excluded of ['SYNTHETIC_PRIVATE_DELEGATE', 'SYNTHETIC_PRIVATE_TATUM', 'SYNTHETIC_PRIVATE_MODEL',
    'PRIVATE_CHAT_TEXT', 'PRIVATE_MEMORY_TEXT', memoryNamespace(agentId, 'raw')]) assert.equal(exported.includes(excluded), false, excluded)
  assert.match(result.instructions, /EXACT account object ID/)
  assert.match(result.instructions, /per-call namespace > --namespace > MEMWAL_NAMESPACE > default/)
  assert.match(result.instructions, /NOT an authorization boundary/)
  assert.match(result.instructions, /Different users need separate owner-controlled accounts/)
  assert.match(result.instructions, /MEMWAL_CREDS_DIR/)
  assert.match(result.instructions, /completed blob_id/)
  assert.match(result.instructions, /locks its optional device vault/)
  assert.match(result.instructions, /encrypted copies remain until confirmed forgetting/)
  assert.match(result.instructions, /not live cross-tool validation/)
})

test('handoff rejects unsigned, demo, disposed, mismatched, and unverified account sessions', () => {
  assert.throws(() => createMemoryHandoff(null), { code: 'wallet_required' })
  for (const mutation of [s => { s.kind = 'demo' }, s => { s.disposed = true }, s => { s.agentId = walletAgentId('0xcc') },
    s => { s.memoryConnection = null }, s => { s.memoryConnection.verified = false },
    s => { s.memoryConnection.owner = suiAddress('0xcc') }, s => { s.env.MEMWAL_ACCOUNT_ID = suiAddress('0xcc') },
    s => { s.env.WALRUS_NETWORK = 'testnet' }, s => { s.env.RECALLLOOP_MEMORY_MODE = 'mock' },
    s => { s.env.MEMWAL_SERVER_URL = 'https://other.example' }]) {
    const value = session()
    mutation(value)
    assert.throws(() => createMemoryHandoff(value), error => ['wallet_required', 'scope_forbidden', 'account_mismatch', 'memory_handoff_unavailable'].includes(error.code))
  }
})
