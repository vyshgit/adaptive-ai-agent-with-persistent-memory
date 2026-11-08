import test from 'node:test'
import assert from 'node:assert/strict'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { apiCredential, createSessionServices } from '../server/agent/session-services.mjs'
import { suiAddress } from '../server/agent/wallet-auth.mjs'
import { OFFICIAL_RELAYER } from '../server/memory/memwal-client.mjs'

const pair = Ed25519Keypair.generate()
const delegate = Ed25519Keypair.generate()
const accountId = suiAddress('0xa')
const packageId = suiAddress('0xb')
const delegateKey = '1'.repeat(64) // synthetic fixture; not a funded key
const publicKey = Buffer.from(delegate.getPublicKey().toRawBytes()).toString('hex')

function fixture(options = {}) {
  const calls = [], backends = [], memories = []
  let account = { address: accountId, version: '7', digest: 'account-digest', owner: { __typename: 'Shared' },
    asMoveObject: { contents: { json: { owner: pair.toSuiAddress() }, type: { repr: `${packageId}::account::MemWalAccount` } } } }
  const sdk = { getPublicKeyHex: async () => publicKey, listNamespaces: async input => { calls.push({ kind: 'signed-namespaces', input }); return { namespaces: [] } } }
  const services = createSessionServices({
    env: { TATUM_API_KEY: 'owner-tatum-key', MEMWAL_PRIVATE_KEY: 'owner-delegate-key', MEMWAL_ACCOUNT_ID: 'owner-account',
      AGENT_LLM_API_KEY: 'owner-model-key', RECALLLOOP_MEMORY_MODE: 'mock', MEMWAL_SERVER_URL: 'https://untrusted.example',
      RECALLLOOP_CAPTURE_MODE: 'verbatim', ...options.env },
    graphql: async (query, variables, credentials) => {
      calls.push({ query, variables, key: credentials.apiKey, credentials })
      if (options.graphql) return options.graphql(query, variables, credentials)
      if (!credentials.apiKey) throw new Error('no owner fallback')
      return query.includes('RecallLoopCheckpoint') ? { checkpoint: { sequenceNumber: '123', digest: 'cp-digest' } } : { object: account }
    },
    deployment: async () => ({ packageId, network: 'mainnet' }),
    backendFactory: ({ env }) => {
      const backend = { env, destroyed: false, getClient: () => sdk,
        status: async () => ({ mode: 'relayer', network: 'mainnet', healthy: true, writeReady: true, ...options.status }),
        destroy() { this.destroyed = true } }
      backends.push(backend)
      return backend
    },
    memoryFactory: ({ env, backend, chain }) => {
      const memory = { env, backend, chain, destroyed: false, destroy() { this.destroyed = true; backend?.destroy() } }
      memories.push(memory)
      return memory
    },
    ...options.dependencies,
  })
  const session = { kind: options.kind || 'wallet', address: pair.toSuiAddress(), config: null }
  services.initialise(session)
  return { services, session, sdk, calls, backends, memories, get account() { return account }, set account(value) { account = value } }
}

async function connectTatum(f, key = 'user-tatum-key') {
  const candidate = await f.services.connectTatum(f.session, { apiKey: key })
  candidate.commit()
  candidate.cleanup()
}

test('user workspaces inherit policy only; neither wallet nor demo uses owner credentials', async () => {
  for (const kind of ['wallet', 'demo']) {
    const f = fixture({ kind })
    assert.equal(f.session.env.MEMWAL_SERVER_URL, OFFICIAL_RELAYER)
    assert.equal(f.session.env.RECALLLOOP_MEMORY_MODE, kind === 'demo' ? 'mock' : '')
    assert.equal(f.session.env.RECALLLOOP_CAPTURE_MODE, 'verbatim')
    assert.equal(f.session.env.MEMWAL_PRIVATE_KEY, undefined)
    assert.equal(f.session.env.AGENT_LLM_API_KEY, undefined)
    assert.equal(f.session.tatumKey, '')
    assert.equal(await f.session.chain.checkpoint(), null)
    assert.equal(f.calls[0].key, '')
    assert.deepEqual(f.services.secrets(f.session), [])
  }
})

test('API credential validation rejects header injection, short keys, spaces, and non-ASCII', () => {
  assert.equal(apiCredential('user-tatum-key', 'Tatum API key'), 'user-tatum-key')
  for (const key of ['', 'short', 'long\nheader', 'bad key with space', 'secret-🔑']) assert.throws(() => apiCredential(key, 'Tatum API key'), /Tatum API key/)
})

test('Tatum verification is staged, key-isolated, and replace/disconnect wipes old readers', async () => {
  const f = fixture()
  const candidate = await f.services.connectTatum(f.session, { apiKey: 'user-tatum-key' })
  assert.equal(f.session.tatum.configured, false)
  const empty = f.session.chain
  assert.equal(candidate.commit().verified, true)
  candidate.cleanup()
  assert.equal(await empty.checkpoint(), null)
  assert.equal(f.session.tatumKey, 'user-tatum-key')
  assert.equal(f.session.tatum.checkpoint.via, 'tatum')
  const old = f.session.chain
  const held = f.calls.at(-1).credentials
  await connectTatum(f, 'replacement-tatum-key')
  assert.equal(held.apiKey, '')
  assert.equal(await old.checkpoint(), null)
  f.services.disconnectTatum(f.session)
  assert.equal(f.session.tatumKey, '')
  assert.equal(f.session.env.TATUM_API_KEY, '')
  assert.equal(f.session.memoryConnection, null)
  assert.equal(f.session.tatum.configured, false)
  assert.equal(await f.session.chain.checkpoint(), null)
})

test('failed or cancelled Tatum candidates cannot overwrite an existing connection', async () => {
  const f = fixture({ graphql: async (_query, _variables, { apiKey }) => apiKey === 'working-tatum-key' ? { checkpoint: { sequenceNumber: '1' } } : { checkpoint: null } })
  await connectTatum(f, 'working-tatum-key')
  await assert.rejects(f.services.connectTatum(f.session, { apiKey: 'invalid-tatum-key' }), { code: 'chain_unavailable' })
  assert.equal(f.session.tatumKey, 'working-tatum-key')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(f.services.connectTatum(f.session, { apiKey: 'working-tatum-key' }, controller.signal), { name: 'AbortError' })
  assert.equal(f.session.tatumKey, 'working-tatum-key')
})

test('Walrus connection checks official Shared account JSON owner, then signed delegate authorization', async () => {
  const f = fixture()
  await connectTatum(f)
  const old = f.session.memory
  const candidate = await f.services.connectMemory(f.session, { delegateKey, accountId })
  assert.equal(f.session.memoryConnection, undefined, 'verification is staged until the active session commits it')
  assert.equal(f.calls.filter(call => call.kind === 'signed-namespaces').length, 1)
  assert.deepEqual(f.calls.find(call => call.kind === 'signed-namespaces').input, { limit: 1 })
  const connected = candidate.commit()
  candidate.cleanup()
  assert.equal(old.destroyed, true)
  assert.equal(connected.accountId, accountId)
  assert.equal(connected.owner, pair.toSuiAddress())
  assert.equal(connected.publicKey, publicKey)
  assert.equal(connected.observation.via, 'tatum')
  assert.equal(connected.verified, true)
  assert.equal(f.backends[0].destroyed, false)
  assert.equal(f.session.env.MEMWAL_PRIVATE_KEY, delegateKey)
  assert.equal(JSON.stringify(connected).includes(delegateKey), false)
  f.services.disconnectMemory(f.session)
  assert.equal(f.backends[0].destroyed, true)
  assert.equal(f.session.env.MEMWAL_PRIVATE_KEY, '')
  assert.equal(f.session.env.RECALLLOOP_MEMORY_MODE, '')
  assert.equal(f.session.tatumKey, 'user-tatum-key', 'disconnecting memory does not remove Tatum')
})

test('missing Tatum, demo mode, wallet keys, and malformed delegate credentials are refused', async () => {
  const f = fixture()
  await assert.rejects(f.services.connectMemory(f.session, { delegateKey, accountId }), { code: 'tatum_required' })
  await connectTatum(f)
  for (const key of ['wallet seed phrase must never be accepted', '0x1234', 'secret\nheader']) {
    await assert.rejects(f.services.connectMemory(f.session, { delegateKey: key, accountId }), { code: 'invalid_request' })
  }
  f.sdk.getPublicKeyHex = async () => Buffer.from(pair.getPublicKey().toRawBytes()).toString('hex')
  await assert.rejects(f.services.connectMemory(f.session, { delegateKey, accountId }), /not the signed-in wallet/)
  assert.equal(f.backends.at(-1).destroyed, true)
  const demo = fixture({ kind: 'demo' })
  await assert.rejects(demo.services.connectTatum(demo.session, { apiKey: 'user-tatum-key' }), { code: 'wallet_required' })
  await assert.rejects(demo.services.connectMemory(demo.session, { delegateKey, accountId }), { code: 'wallet_required' })
  assert.equal(demo.backends.length, 0)
})

test('wrong owner, package, account ID, owner kind, or account shape cannot install a delegate', async () => {
  const mutations = [
    account => { account.asMoveObject.contents.json.owner = suiAddress('0xc') },
    account => { account.asMoveObject.contents.type.repr = `${suiAddress('0xd')}::account::MemWalAccount` },
    account => { account.address = suiAddress('0xe') },
    account => { account.owner.__typename = 'AddressOwner' },
    account => { delete account.asMoveObject.contents.json.owner },
    account => { delete account.asMoveObject },
  ]
  for (const mutate of mutations) {
    const f = fixture()
    await connectTatum(f)
    mutate(f.account)
    await assert.rejects(f.services.connectMemory(f.session, { delegateKey, accountId }), { code: 'account_mismatch' })
    assert.equal(f.backends[0].destroyed, true)
    assert.equal(f.backends[0].env.MEMWAL_PRIVATE_KEY, '')
    assert.equal(f.session.env.MEMWAL_PRIVATE_KEY, undefined)
    assert.equal(f.calls.filter(call => call.kind === 'signed-namespaces').length, 0)
  }
})

test('unhealthy deployments and unauthorized delegates roll back instead of trusting public health', async () => {
  for (const kind of ['network', 'health', 'write-ready', 'relayer-network', 'authorization', 'shape']) {
    const f = fixture({ dependencies: kind === 'network' ? { deployment: async () => ({ network: 'testnet', packageId }) } : {},
      status: kind === 'health' ? { healthy: false } : kind === 'write-ready' ? { writeReady: false } : kind === 'relayer-network' ? { network: null } : {} })
    await connectTatum(f)
    if (kind === 'authorization') f.sdk.listNamespaces = async () => { throw new Error('delegate denied') }
    if (kind === 'shape') f.sdk.listNamespaces = async () => ({ notNamespaces: [] })
    await assert.rejects(f.services.connectMemory(f.session, { delegateKey, accountId }), error => ['account_mismatch', 'memory_unavailable', 'memory_unauthorized'].includes(error.code))
    assert.equal(f.backends[0].destroyed, true)
    assert.equal(f.session.memoryConnection, undefined)
  }
})

test('uncommitted Walrus candidates are destroyed, and credentials stay isolated across wallets', async () => {
  const first = fixture(), second = fixture()
  await connectTatum(first)
  const candidate = await first.services.connectMemory(first.session, { delegateKey, accountId })
  candidate.cleanup()
  assert.equal(first.backends[0].destroyed, true)
  assert.equal(first.backends[0].env.MEMWAL_PRIVATE_KEY, '')
  assert.equal(first.session.memoryConnection, undefined)
  assert.deepEqual(second.services.secrets(second.session), [])
  assert.equal(second.session.env.TATUM_API_KEY, undefined)
})
