import test from 'node:test'
import assert from 'node:assert/strict'
import { authenticateAgent } from '../server/agent-auth.mjs'
function invoke({ env = {}, headers = {}, body = {} } = {}) {
  const old = { NODE_ENV: process.env.NODE_ENV, RECALLLOOP_API_KEYS: process.env.RECALLLOOP_API_KEYS }
  delete process.env.NODE_ENV; delete process.env.RECALLLOOP_API_KEYS; Object.assign(process.env, env)
  let statusCode = 200, nextCalled = false
  const req = { body, get(name) { return headers[name.toLowerCase()] || headers[name] } }
  const res = { status(code) { statusCode = code; return this }, set() { return this }, json() { return this } }
  try { authenticateAgent(req, res, () => { nextCalled = true }); return { statusCode, nextCalled, owner: req.authenticatedAgentId } }
  finally { for (const key of Object.keys(old)) old[key] === undefined ? delete process.env[key] : process.env[key] = old[key] }
}
const keyA = 'a'.repeat(40)
const configured = { RECALLLOOP_API_KEYS: JSON.stringify({ 'agent-a': keyA, 'agent-b': 'b'.repeat(40) }) }
test('fails closed in development without keys', () => { const r = invoke({ env: { NODE_ENV: 'development' } }); assert.equal(r.statusCode, 503); assert.equal(r.nextCalled, false) })
test('fails closed in production without keys', () => { const r = invoke({ env: { NODE_ENV: 'production' } }); assert.equal(r.statusCode, 503); assert.equal(r.nextCalled, false) })
test('rejects missing bearer key', () => assert.equal(invoke({ env: configured, body: { agentId: 'agent-a' } }).statusCode, 401))
test('authenticates and binds key to its agent ID', () => { const r = invoke({ env: configured, headers: { authorization: `Bearer ${keyA}` }, body: { agentId: 'agent-a' } }); assert.equal(r.nextCalled, true); assert.equal(r.owner, 'agent-a') })
test('blocks cross-agent access', () => { const r = invoke({ env: configured, headers: { authorization: `Bearer ${keyA}` }, body: { agentId: 'agent-b' } }); assert.equal(r.statusCode, 403); assert.equal(r.nextCalled, false) })
test('rejects malformed key config', () => { const r = invoke({ env: { RECALLLOOP_API_KEYS: '{bad json' } }); assert.equal(r.statusCode, 500); assert.equal(r.nextCalled, false) })
test('logical-agent configuration cannot grant wallet, demo, or dashboard identities', () => {
  for (const id of ['wallet-' + '1'.repeat(40), 'Wallet-user', 'wallet/user', 'demo-user', 'recallloop-dashboard']) {
    const r = invoke({ env: { RECALLLOOP_API_KEYS: JSON.stringify({ [id]: keyA }) }, headers: { authorization: `Bearer ${keyA}` }, body: { agentId: id } })
    assert.equal(r.statusCode, 500)
    assert.equal(r.nextCalled, false)
  }
})
test('agents require unique, bounded printable keys and canonical identities', () => {
  for (const entries of [{ 'agent-a': keyA, 'agent-b': keyA }, { ' agent-a ': keyA }, {},
    { 'agent-a': 'x'.repeat(4097) }, { 'agent-a': `${keyA} whitespace` }, { 'agent-a': `${keyA}🔑` }]) {
    const r = invoke({ env: { RECALLLOOP_API_KEYS: JSON.stringify(entries) } })
    assert.equal(r.statusCode, 500)
    assert.equal(r.nextCalled, false)
  }
})
test('forged identity shapes and malformed bearer headers never establish an agent principal', () => {
  for (const agentId of [undefined, null, {}, ['agent-a'], 'wallet-' + '1'.repeat(40)]) {
    const r = invoke({ env: configured, headers: { authorization: `Bearer ${keyA}` }, body: { agentId } })
    assert.equal(r.statusCode, 403)
    assert.equal(r.owner, undefined)
  }
  for (const authorization of [`Bearer ${keyA} extra`, keyA, `bearer ${keyA}`]) {
    assert.equal(invoke({ env: configured, headers: { authorization }, body: { agentId: 'agent-a' } }).statusCode, 401)
  }
})
