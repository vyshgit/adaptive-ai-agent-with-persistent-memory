import test from 'node:test'
import assert from 'node:assert/strict'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { workspaceHttp, testEnv, deferred } from './helpers/workspace-http.mjs'
import { connectAccount, memoryAccountsFixture } from './helpers/memory-accounts.mjs'
import { memoryNamespace } from '../server/memory/memwal-client.mjs'

const turn = flags => ({ sessionId: 'same-chat-id', message: 'I prefer TypeScript for coding.', stream: false, ...flags })

test('HTTP chat remembers facts automatically, while disabling capture and saving transcripts are explicit', async t => {
  const f = await workspaceHttp(t, { env: { RECALLLOOP_CAPTURE_MODE: 'both' } })
  const browser = f.client()
  await browser.demo()
  for (const flags of [{ capture: false }, { capture: false, captureMode: 'both' }]) {
    const result = await browser.json('/chat', { body: turn(flags) })
    assert.equal(result.status, 200)
    assert.equal(result.data.stored.skipped, true)
  }
  assert.equal((await browser.json('/memory')).data.inventory.total, 0)
  const facts = await browser.json('/chat', { body: turn({}) })
  assert.equal(facts.data.stored.verbatim, 0)
  assert.ok(facts.data.stored.facts > 0)
  assert.equal((await browser.json('/memory')).data.inventory.namespaces.find(entry => entry.name.endsWith(':raw')).count, 0)
  const duplicate = await browser.json('/chat', { body: turn({ sessionId: 'a-new-page-conversation' }) })
  assert.equal(duplicate.data.stored.deduplicated, true)
  assert.equal((await browser.json('/memory')).data.inventory.total, facts.data.stored.facts)
  assert.equal((await browser.json('/chat', { body: turn({ captureMode: 'both' }) })).status, 400)
  const raw = await browser.json('/chat', { body: turn({ capture: true, captureMode: 'both' }) })
  assert.ok(raw.data.stored.verbatim >= 2)
  assert.equal((await browser.json('/chat', { body: turn({ capture: 'true' }) })).status, 400)
  assert.equal((await browser.json('/chat', { body: turn({ capture: true, captureMode: 'default' }) })).status, 400)
})

test('two signed wallets use separately owned accounts and cannot borrow scopes, delegates, chats, or inventories', async t => {
  const pairs = [Ed25519Keypair.generate(), Ed25519Keypair.generate()]
  const fixture = memoryAccountsFixture(pairs)
  const f = await workspaceHttp(t, { services: fixture.dependencies })
  const browsers = [f.client(), f.client()]
  const auth = []
  for (let i = 0; i < 2; i++) {
    auth.push((await browsers[i].login(pairs[i])).data)
    await connectAccount(browsers[i], fixture.accounts[i])
    assert.equal((await browsers[i].json('/connect', { body: { mode: 'mock' } })).status, 200)
  }
  const [a, b] = browsers, [accountA, accountB] = fixture.accounts
  const borrowed = await b.json('/connections/memwal', { body: { accountId: accountA.accountId, delegateKey: accountA.delegateKey } })
  assert.equal(borrowed.status, 403)
  assert.equal(borrowed.data.code, 'account_mismatch')
  assert.equal((await b.json('/status')).data.memoryConnection.accountId, accountB.accountId)
  const wrongDelegate = await b.json('/connections/memwal', { body: { accountId: accountB.accountId, delegateKey: accountA.delegateKey } })
  assert.equal(wrongDelegate.status, 403)
  assert.equal((await b.json('/status')).data.memoryConnection.accountId, accountB.accountId)
  const savedA = await a.json('/remember', { body: { text: 'USER_A_ONLY prefers TypeScript.', tier: 'profile',
    agentId: auth[1].agentId, accountId: accountB.accountId, namespace: memoryNamespace(auth[1].agentId, 'profile') } })
  assert.equal(savedA.status, 200)
  assert.equal(savedA.data.namespace, memoryNamespace(auth[0].agentId, 'profile'))
  await b.json('/remember', { body: { text: 'USER_B_ONLY prefers Python.', tier: 'profile' } })
  await a.json('/chat', { body: turn({ capture: true, captureMode: 'both', agentId: auth[1].agentId,
    message: 'USER_A_PRIVATE_CHAT: I prefer npm for coding.' }) })
  const recallA = await a.json('/chat', { body: turn({ agentId: auth[1].agentId, message: 'Which TypeScript npm preferences do you recall?' }) })
  const recallB = await b.json('/chat', { body: turn({ agentId: auth[0].agentId, message: 'Which TypeScript npm preferences do you recall?' }) })
  assert.match(JSON.stringify(recallA.data.memory), /USER_A_ONLY/)
  assert.equal(JSON.stringify(recallA.data).includes('USER_B_ONLY'), false)
  assert.match(JSON.stringify(recallB.data.memory), /USER_B_ONLY/)
  assert.equal(JSON.stringify(recallB.data).includes('USER_A_ONLY'), false)
  assert.equal(JSON.stringify(recallB.data).includes('USER_A_PRIVATE_CHAT'), false)
  for (let i = 0; i < 2; i++) {
    const inventory = (await browsers[i].json(`/memory?agentId=${auth[1 - i].agentId}&accountId=${fixture.accounts[1 - i].accountId}`)).data.inventory
    assert.ok(inventory.memories.length)
    assert.ok(inventory.memories.every(record => record.namespace.startsWith(`rl:${auth[i].agentId}:`)))
    assert.ok([...fixture.accounts[i].records.values()].every(record => record.namespace.startsWith(`rl:${auth[i].agentId}:`)))
  }
  await a.json('/auth/logout', { body: {} })
  assert.equal((await a.json('/memory')).status, 401)
  assert.equal((await b.json('/memory')).status, 200)
  await a.login(pairs[0])
  assert.equal((await a.json('/memory')).data.inventory.total, 0, 'new login never inherits a prior delegate connection')
  await connectAccount(a, accountA)
  assert.ok((await a.json('/memory')).data.inventory.total >= 3, 'same owner/account recovers its existing memories with stable namespaces')
})

test('HTTP handoff requires an active owner-verified wallet and cannot export a caller-selected account or namespace', async t => {
  const pairs = [Ed25519Keypair.generate(), Ed25519Keypair.generate()]
  const fixture = memoryAccountsFixture(pairs)
  const f = await workspaceHttp(t, { services: fixture.dependencies })
  assert.equal((await f.client().json('/memory/handoff')).status, 401)
  const demo = f.client()
  await demo.demo()
  assert.equal((await demo.json('/memory/handoff')).status, 403)
  const wallet = f.client(), signed = await wallet.login(pairs[0])
  assert.equal((await wallet.json('/memory/handoff')).status, 412)
  await connectAccount(wallet, fixture.accounts[0])
  const setup = await wallet.json('/memory/handoff')
  assert.equal(setup.status, 200)
  assert.equal(setup.headers.get('cache-control'), 'no-store')
  assert.equal(setup.data.accountId, fixture.accounts[0].accountId)
  assert.equal(setup.data.owner, pairs[0].toSuiAddress())
  assert.deepEqual(setup.data.namespaces, { profile: memoryNamespace(signed.data.agentId, 'profile'), facts: memoryNamespace(signed.data.agentId, 'facts') })
  assert.equal(JSON.stringify(setup.data).includes(fixture.accounts[0].delegateKey), false)
  assert.equal(JSON.stringify(setup.data).includes(fixture.accounts[0].tatumKey), false)
  for (const query of ['agentId=other', `accountId=${fixture.accounts[1].accountId}`, 'namespace=default', 'includeRaw=true']) {
    assert.equal((await wallet.json(`/memory/handoff?${query}`)).status, 400)
  }
  const stale = f.client({ cookie: wallet.cookie, tag: 'old-tab' })
  assert.equal((await stale.json('/memory/handoff')).status, 409)
  await wallet.json('/connections/memwal/disconnect', { body: {} })
  assert.equal((await wallet.json('/memory/handoff')).status, 412)
})

test('logout wins over delayed HTTP inventory errors and chain observations without returning old account metadata', async t => {
  for (const path of ['/memory', '/chain']) {
    const started = deferred(), gate = deferred()
    t.after(() => gate.resolve())
    const f = await workspaceHttp(t, { initialise(session) {
      session.env.MEMWAL_ACCOUNT_ID = '0xa'
      if (path === '/memory') {
        session.memory.status = async () => ({ mode: 'relayer', accountId: 'OLD_PRIVATE_ACCOUNT_METADATA', healthy: true })
        const inventory = session.memory.inventory
        session.memory.inventory = async agentId => { started.resolve(); await gate.promise; return inventory(agentId) }
      } else {
        session.memory.chain.checkpoint = async () => ({ checkpoint: 'OLD_PRIVATE_CHAIN_CHECKPOINT' })
        session.memory.chain.object = async () => { started.resolve(); await gate.promise; return { exists: true, object: { address: 'OLD_PRIVATE_ACCOUNT_METADATA' } } }
      }
    } })
    const browser = f.client()
    await browser.login()
    const pending = browser.json(path)
    await started.promise
    assert.equal((await browser.json('/auth/logout', { body: {} })).status, 200)
    gate.resolve()
    const result = await pending
    assert.equal(result.status, 401)
    assert.equal(result.data.code, 'wallet_required')
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.equal(JSON.stringify(result.data).includes('OLD_PRIVATE'), false)
    assert.equal(result.headers.get('set-cookie'), null)
    assert.equal(f.sessions[0].controllers.size, 0)
  }
})

test('external/admin HTTP memory endpoints fail closed without keys even in development', async t => {
  testEnv(t, { NODE_ENV: 'development', RECALLLOOP_API_KEYS: undefined, RECALLLOOP_ADMIN_API_KEY: undefined })
  const f = await workspaceHttp(t)
  for (const [path, body] of [['/ingest', { agentId: 'a', sessionId: 's', messages: [{ role: 'user', content: 'Private.' }] }],
    ['/recall', { agentId: 'a', query: 'Private' }], ['/inventory?agentId=a', undefined], ['/restore', { agentId: 'a' }],
    ['/status', undefined], ['/seed', { confirm: 'seed-mainnet' }]]) {
    const result = await f.client().json(`/api/memory${path}`, { body })
    assert.equal(result.status, 503)
    assert.equal(result.headers.get('cache-control'), 'no-store')
  }
  assert.equal((await f.memory.inventory('a')).total, 0)
})

test('external bearer keys isolate logical agents and never authorize wallet namespaces', async t => {
  const keyA = 'synthetic-agent-a-key-at-least-32-characters', keyB = 'synthetic-agent-b-key-at-least-32-characters'
  testEnv(t, { RECALLLOOP_API_KEYS: JSON.stringify({ 'agent-a': keyA, 'agent-b': keyB }) })
  const f = await workspaceHttp(t)
  const a = f.client({ headers: { Authorization: `Bearer ${keyA}` } }), b = f.client({ headers: { Authorization: `Bearer ${keyB}` } })
  const saved = await a.json('/api/memory/ingest', { body: { agentId: 'agent-a', sessionId: 'same', mode: 'facts',
    namespace: 'rl:agent-b:facts', messages: [{ role: 'user', content: 'AGENT_A_PRIVATE prefers TypeScript.' }] } })
  assert.equal(saved.status, 200)
  assert.ok(saved.data.blobs.every(record => record.namespace === 'rl:agent-a:facts'))
  assert.equal((await b.json('/api/memory/recall', { body: { agentId: 'agent-b', query: 'AGENT_A_PRIVATE TypeScript', includeRaw: true } })).data.memories.length, 0)
  const wallet = (await f.client().login()).data
  for (const id of ['agent-b', wallet.agentId]) {
    assert.equal((await a.json('/api/memory/recall', { body: { agentId: id, query: 'private' } })).status, 403)
    assert.equal((await a.json(`/api/memory/inventory?agentId=${id}`)).status, 403)
    assert.equal((await a.json('/api/memory/restore', { body: { agentId: id } })).status, 403)
  }
})
