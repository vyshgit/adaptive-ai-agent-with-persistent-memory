import test from 'node:test'
import assert from 'node:assert/strict'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1'
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1'
import { createWalletAuth, verifyWalletSignature, walletAgentId, suiAddress, WALLET_COOKIE } from '../server/agent/wallet-auth.mjs'

const origin = 'http://localhost:3000'
const keypair = () => Ed25519Keypair.generate()
const deferred = () => {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}

function fixture(t, options = {}) {
  const auth = createWalletAuth(options)
  t.after(() => auth.close())
  function request(cookie, headers = {}) {
    const req = { workspaceOrigin: origin, socket: { remoteAddress: '127.0.0.1' }, get: name => ({ cookie, ...headers })[name] }
    const res = { cookies: [], cookie(name, value, settings) { this.cookies.push({ name, value, settings }) }, clearCookie(name, settings) { this.cleared = { name, settings } } }
    auth.middleware(req, res, () => {})
    return { req, res }
  }
  function challenge(pair = keypair()) {
    const { req, res } = request()
    const result = auth.challenge(req, res, { address: pair.toSuiAddress() })
    return { pair, result, req, res, cookie: `${WALLET_COOKIE}=${res.cookies[0].value}` }
  }
  async function login(proof = challenge()) {
    const { req, res } = request(proof.cookie)
    const { signature } = await proof.pair.signPersonalMessage(new TextEncoder().encode(proof.result.message))
    const publicSession = await auth.login(req, res, { address: proof.pair.toSuiAddress(), challengeId: proof.result.challengeId, signature })
    return { req, res, publicSession, cookie: `${WALLET_COOKIE}=${res.cookies[0].value}`, signature, proof }
  }
  return { auth, request, challenge, login }
}

test('Sui address namespaces are canonical, wallet-stable, and isolated', () => {
  assert.equal(suiAddress('0xAb'), `0x${'0'.repeat(62)}ab`)
  assert.equal(walletAgentId('0xAb'), walletAgentId('0x00ab'))
  assert.notEqual(walletAgentId('0x1'), walletAgentId('0x2'))
  for (const value of ['', '0x', 'not-a-wallet', `0x${'a'.repeat(65)}`]) assert.throws(() => suiAddress(value), /Sui address/)
})

for (const [name, Pair] of [['Ed25519', Ed25519Keypair], ['Secp256k1', Secp256k1Keypair], ['Secp256r1', Secp256r1Keypair]]) {
  test(`${name} personal-message signatures verify locally and bind the exact message and address`, async () => {
    const pair = Pair.generate()
    const message = 'RecallLoop synthetic sign-in proof (test only)'
    const { signature } = await pair.signPersonalMessage(new TextEncoder().encode(message))
    await verifyWalletSignature(message, signature, pair.toSuiAddress())
    await assert.rejects(verifyWalletSignature(`${message}!`, signature, pair.toSuiAddress()))
    await assert.rejects(verifyWalletSignature(message, signature, keypair().toSuiAddress()))
  })
}

test('wallet login requires a signed challenge and rotates a strict httpOnly cookie', async t => {
  const f = fixture(t)
  const proof = f.challenge()
  assert.match(proof.result.message, /Origin: http:\/\/localhost:3000\n/)
  assert.match(proof.result.message, /Network: sui:mainnet\nNonce: [a-f0-9]{64}/)
  assert.match(proof.result.message, /This is not a transaction/)
  assert.equal(f.auth.publicSession(proof.req.workspaceSession).authenticated, false)
  const signed = await f.login(proof)
  assert.notEqual(signed.cookie, proof.cookie)
  assert.equal(signed.publicSession.authenticated, true)
  assert.equal(signed.publicSession.demo, false)
  assert.equal(signed.publicSession.address, proof.pair.toSuiAddress())
  assert.equal(signed.publicSession.agentId, walletAgentId(proof.pair.toSuiAddress()))
  assert.ok(!JSON.stringify(signed.publicSession).includes(signed.req.workspaceSession.id))
  assert.deepEqual(signed.res.cookies[0].settings, { httpOnly: true, sameSite: 'strict', secure: false, maxAge: 3_600_000, path: '/api/agent' })
  assert.equal(f.request(proof.cookie).req.workspaceSession, undefined)
  const { req } = f.request(signed.cookie, { 'x-recallloop-session': signed.publicSession.sessionTag })
  let failure
  f.auth.requireSession(req, {}, error => { failure = error })
  assert.equal(failure, undefined)
})

test('challenge failures, wrong address/origin, and replays cannot authenticate', async t => {
  const f = fixture(t)
  for (const kind of ['signature', 'address', 'origin', 'nonce']) {
    const proof = f.challenge()
    const { req, res } = f.request(proof.cookie)
    const { signature } = await proof.pair.signPersonalMessage(new TextEncoder().encode(kind === 'signature' ? 'different message' : proof.result.message))
    const input = { address: kind === 'address' ? keypair().toSuiAddress() : proof.pair.toSuiAddress(), signature,
      challengeId: kind === 'nonce' ? 'wrong-nonce' : proof.result.challengeId }
    if (kind === 'origin') req.workspaceOrigin = 'https://evil.example'
    await assert.rejects(f.auth.login(req, res, input), { code: kind === 'signature' ? 'invalid_signature' : 'invalid_challenge' })
    req.workspaceOrigin = origin
    await assert.rejects(f.auth.login(req, res, { ...input, address: proof.pair.toSuiAddress(), challengeId: proof.result.challengeId }), { code: 'invalid_challenge' })
  }
  const signed = await f.login()
  const replay = f.request(signed.proof.cookie)
  await assert.rejects(f.auth.login(replay.req, replay.res, { address: signed.proof.pair.toSuiAddress(), signature: signed.signature, challengeId: signed.proof.result.challengeId }), { code: 'invalid_challenge' })
})

test('a challenge is consumed before concurrent signature verification', async t => {
  const verification = deferred()
  const f = fixture(t, { verify: () => verification.promise })
  const proof = f.challenge()
  const a = f.request(proof.cookie), b = f.request(proof.cookie)
  const input = { address: proof.pair.toSuiAddress(), challengeId: proof.result.challengeId, signature: 'dGVzdA==' }
  const pending = f.auth.login(a.req, a.res, input)
  await assert.rejects(f.auth.login(b.req, b.res, input), { code: 'invalid_challenge' })
  verification.resolve()
  assert.equal((await pending).authenticated, true)
})

test('challenge expiry and logout during verification prevent cookie resurrection', async t => {
  let now = Date.now()
  const verification = deferred()
  const f = fixture(t, { clock: () => now, challengeTtlMs: 100, verify: () => verification.promise })
  const proof = f.challenge()
  const a = f.request(proof.cookie)
  const pending = f.auth.login(a.req, a.res, { address: proof.pair.toSuiAddress(), challengeId: proof.result.challengeId, signature: 'dGVzdA==' })
  f.auth.logout(f.request(proof.cookie).req, f.request().res)
  verification.resolve()
  await assert.rejects(pending, { code: 'invalid_challenge' })
  assert.equal(a.res.cookies.length, 0)
  const expired = f.challenge()
  now += 101
  const b = f.request(expired.cookie)
  await assert.rejects(f.auth.login(b.req, b.res, { address: expired.pair.toSuiAddress(), challengeId: expired.result.challengeId, signature: 'dGVzdA==' }), { code: 'invalid_challenge' })
})

test('logout and session expiry abort operations, wipe connections, and destroy clients', async t => {
  let now = Date.now(), destroyed = 0
  const f = fixture(t, { clock: () => now, sessionTtlMs: 100, initialise(session) {
    session.env = { MEMWAL_PRIVATE_KEY: 'delegate-secret', TATUM_API_KEY: 'tatum-secret' }
    session.tatumKey = 'tatum-secret'
    session.config = { apiKey: 'provider-secret' }
    session.memory = { destroy() { destroyed++ } }
    session.chain = { destroy() { destroyed++ } }
  } })
  for (const action of ['logout', 'expiry']) {
    const signed = await f.login()
    const session = signed.req.workspaceSession
    const old = session.config
    const controller = new AbortController()
    session.controllers.add(controller)
    const bound = f.request(signed.cookie, { 'x-recallloop-session': signed.publicSession.sessionTag })
    if (action === 'logout') {
      f.auth.logout(bound.req, bound.res)
      assert.equal(bound.res.cleared.name, WALLET_COOKIE)
    } else {
      now += 101
      assert.throws(() => f.auth.assertActive(session), { code: 'wallet_required' })
    }
    assert.equal(controller.signal.aborted, true)
    assert.equal(old.apiKey, '')
    assert.equal(session.config, null)
    assert.equal(session.env.MEMWAL_PRIVATE_KEY, '')
    assert.equal(session.tatumKey, '')
    assert.equal(f.request(signed.cookie).req.workspaceSession, undefined)
  }
  assert.equal(destroyed, 4)
})

test('stale tabs cannot send data or replace/logout the new cookie session', async t => {
  const f = fixture(t, { env: { RECALLLOOP_ENABLE_DEMO: 'true' } })
  const signed = await f.login()
  const stale = f.request(signed.cookie, { 'x-recallloop-session': 'old-tab-session-tag' })
  let failure
  f.auth.requireSession(stale.req, stale.res, error => { failure = error })
  assert.equal(failure.code, 'session_changed')
  assert.throws(() => f.auth.logout(stale.req, stale.res), { code: 'session_changed' })
  assert.throws(() => f.auth.demo(stale.req, stale.res), { code: 'session_changed' })
  assert.throws(() => f.auth.challenge(stale.req, stale.res, { address: '0x1' }), { code: 'session_changed' })
  assert.equal(f.auth.assertActive(signed.req.workspaceSession).disposed, false)
})

test('offline demo is opt-in, isolated per login, and not wallet authentication', t => {
  const disabled = fixture(t)
  assert.throws(() => disabled.auth.demo(disabled.request().req, disabled.request().res), { code: 'demo_disabled' })
  const f = fixture(t, { env: { RECALLLOOP_ENABLE_DEMO: 'true' } })
  const first = f.request(), second = f.request()
  const a = f.auth.demo(first.req, first.res), b = f.auth.demo(second.req, second.res)
  assert.equal(a.authenticated, false)
  assert.equal(a.demo, true)
  assert.equal(a.address, null)
  assert.notEqual(a.agentId, b.agentId)
  assert.notEqual(a.sessionTag, b.sessionTag)
})

test('login challenge rates and the total session count are bounded', t => {
  const f = fixture(t, { maxSessions: 1 })
  const one = f.challenge()
  assert.throws(() => f.challenge(), { code: 'busy' })
  let current = one
  for (let i = 0; i < 10; i++) {
    const next = f.request(current.cookie)
    const result = f.auth.challenge(next.req, next.res, { address: one.pair.toSuiAddress() })
    current = { result, cookie: `${WALLET_COOKIE}=${next.res.cookies[0].value}` }
  }
  const last = f.request(current.cookie)
  assert.throws(() => f.auth.challenge(last.req, last.res, { address: one.pair.toSuiAddress() }), { code: 'busy' })
})
