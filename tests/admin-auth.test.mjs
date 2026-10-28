import test from 'node:test'
import assert from 'node:assert/strict'
import { authenticateAdmin } from '../server/admin-auth.mjs'

function invoke({ env = {}, headers = {} } = {}) {
  const old = { NODE_ENV: process.env.NODE_ENV, RECALLLOOP_ADMIN_API_KEY: process.env.RECALLLOOP_ADMIN_API_KEY }
  delete process.env.NODE_ENV
  delete process.env.RECALLLOOP_ADMIN_API_KEY
  Object.assign(process.env, env)
  let statusCode = 200, nextCalled = false, role
  const req = { get(name) { return headers[name.toLowerCase()] || headers[name] } }
  const res = { status(code) { statusCode = code; return this }, set() { return this }, json() { return this } }
  try {
    authenticateAdmin(req, res, () => { nextCalled = true; role = req.authenticatedRole })
    return { statusCode, nextCalled, role }
  } finally {
    for (const key of Object.keys(old)) old[key] === undefined ? delete process.env[key] : process.env[key] = old[key]
  }
}
const secret = 'admin-secret-'.padEnd(40, 'x')
test('allows local development without an admin key', () => assert.equal(invoke({ env: { NODE_ENV: 'development' } }).nextCalled, true))
test('fails closed in production without an admin key', () => { const r = invoke({ env: { NODE_ENV: 'production' } }); assert.equal(r.statusCode, 503); assert.equal(r.nextCalled, false) })
test('rejects missing or incorrect admin bearer keys', () => {
  assert.equal(invoke({ env: { RECALLLOOP_ADMIN_API_KEY: secret } }).statusCode, 401)
  assert.equal(invoke({ env: { RECALLLOOP_ADMIN_API_KEY: secret }, headers: { authorization: 'Bearer wrong' } }).statusCode, 401)
})
test('rejects malformed bearer headers containing whitespace in the token', () => {
  const r = invoke({ env: { RECALLLOOP_ADMIN_API_KEY: secret }, headers: { authorization: 'Bearer bad token' } })
  assert.equal(r.statusCode, 401)
  assert.equal(r.nextCalled, false)
})
test('accepts the configured admin key', () => {
  const r = invoke({ env: { RECALLLOOP_ADMIN_API_KEY: secret }, headers: { authorization: `Bearer ${secret}` } })
  assert.equal(r.nextCalled, true)
  assert.equal(r.role, 'admin')
})
test('rejects short configured admin keys', () => {
  const r = invoke({ env: { RECALLLOOP_ADMIN_API_KEY: 'short' }, headers: { authorization: 'Bearer short' } })
  assert.equal(r.statusCode, 500)
  assert.equal(r.nextCalled, false)
})
