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
test('allows local development without keys', () => assert.equal(invoke({ env: { NODE_ENV: 'development' } }).nextCalled, true))
test('fails closed in production without keys', () => { const r = invoke({ env: { NODE_ENV: 'production' } }); assert.equal(r.statusCode, 503); assert.equal(r.nextCalled, false) })
test('rejects missing bearer key', () => assert.equal(invoke({ env: configured, body: { agentId: 'agent-a' } }).statusCode, 401))
test('authenticates and binds key to its agent ID', () => { const r = invoke({ env: configured, headers: { authorization: `Bearer ${keyA}` }, body: { agentId: 'agent-a' } }); assert.equal(r.nextCalled, true); assert.equal(r.owner, 'agent-a') })
test('blocks cross-agent access', () => { const r = invoke({ env: configured, headers: { authorization: `Bearer ${keyA}` }, body: { agentId: 'agent-b' } }); assert.equal(r.statusCode, 403); assert.equal(r.nextCalled, false) })
test('rejects malformed key config', () => { const r = invoke({ env: { RECALLLOOP_API_KEYS: '{bad json' } }); assert.equal(r.statusCode, 500); assert.equal(r.nextCalled, false) })
