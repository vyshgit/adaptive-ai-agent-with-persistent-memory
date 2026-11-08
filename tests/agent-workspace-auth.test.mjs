import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceAuth } from '../server/agent/workspace-auth.mjs'
import { validateConnection, validateProviderUrl, createConnectionStore, publicConnection } from '../server/agent/connections.mjs'

function auth(headers = {}, env = {}, peer = '127.0.0.1') {
  let status = 200, passed = false
  const req = { method: 'POST', protocol: 'http', socket: { remoteAddress: peer }, get: name => ({ host: 'localhost:3000', ...headers })[name] }
  const res = { set() {}, status(code) { status = code; return this }, json() { return this } }
  createWorkspaceAuth(env)(req, res, () => { passed = true })
  return { status, passed }
}

test('local workspace allows local CLI/browser but rejects cross-origin and DNS rebinding', () => {
  assert.equal(auth().passed, true)
  assert.equal(auth({ origin: 'http://localhost:3000' }).passed, true)
  assert.equal(auth({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }).status, 403)
  assert.equal(auth({ host: 'evil.example:3000', origin: 'http://evil.example:3000' }).passed, false)
  assert.equal(auth({}, {}, '192.168.1.99').passed, false)
  assert.equal(auth({ origin: 'https://localhost:3000', 'x-forwarded-proto': 'https' }).status, 403)
})

test('configured workspace token is mandatory even with same-origin headers', () => {
  const key = 'workspace-secret-'.repeat(3)
  const env = { RECALLLOOP_WORKSPACE_TOKEN: key, NODE_ENV: 'production' }
  assert.equal(auth({ origin: 'http://localhost:3000' }, env).status, 401)
  assert.equal(auth({ authorization: `Bearer ${key}` }, env).passed, true)
  assert.equal(auth({ authorization: `Bearer ${key} bad` }, env).status, 401)
  assert.equal(auth({}, { RECALLLOOP_REQUIRE_WORKSPACE_AUTH: 'true' }).status, 401)
  assert.equal(auth({}, { RECALLLOOP_WORKSPACE_TOKEN: 'short' }).status, 503)
})

test('remote origin access is explicit and does not act as multi-user authentication', () => {
  const headers = { host: 'workspace.example', origin: 'https://workspace.example' }
  assert.equal(auth(headers, { NODE_ENV: 'production' }).status, 403)
  assert.equal(auth(headers, { NODE_ENV: 'production', RECALLLOOP_ALLOWED_ORIGINS: 'https://workspace.example' }).passed, true)
})

test('provider URL allowlist rejects private networks, redirects, URL secrets and app loopback', () => {
  assert.equal(validateProviderUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1')
  assert.equal(validateProviderUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1')
  for (const url of ['http://api.openai.com/v1', 'https://api.openai.com.evil.example/v1', 'https://169.254.169.254/v1',
    'http://127.0.0.1:3000/api', 'https://user:password@api.openai.com/v1', 'https://api.openai.com/v1?key=secret',
    'https://api.openai.com/%2fadmin', 'https://api.openai.com:8443/v1']) assert.throws(() => validateProviderUrl(url), /Model|model|Use/)
  assert.throws(() => validateProviderUrl('http://localhost:11434/v1', { NODE_ENV: 'production' }), /disabled/)
  assert.equal(validateProviderUrl('https://trusted.example/v1', { AGENT_LLM_ALLOWED_HOSTS: 'trusted.example' }), 'https://trusted.example/v1')
})

test('connection validation keeps public state key-free and labels the mock honestly', () => {
  const config = validateConnection({ baseUrl: 'https://api.openai.com/v1', apiKey: 'private-api-secret', model: 'example-model', apiStyle: 'responses' })
  assert.equal(JSON.stringify(publicConnection(config)).includes('private-api-secret'), false)
  assert.equal(validateConnection({ mode: 'mock' }).mode, 'mock')
  assert.throws(() => validateConnection({ ...config, apiKey: 'bad\nheader' }), /newlines/)
  assert.throws(() => validateConnection({ ...config, toolsEnabled: 'false' }), /boolean/)
})

test('wallet-bound model connections are isolated, expire, and never use owner defaults', () => {
  let now = 1000
  const store = createConnectionStore({ env: { AGENT_LLM_API_KEY: 'owner-secret-key', AGENT_LLM_MODEL: 'owner-model' }, clock: () => now })
  function request(session) {
    const req = { workspaceSession: session }
    let error
    store.middleware(req, { cookie() { assert.fail('The connection store must not create a login cookie') } }, failure => { error = failure })
    return { req, error }
  }
  const session = kind => ({ kind, expiresAt: now + 3_600_000, config: null })
  const first = session('wallet'), second = session('wallet'), demo = session('demo')
  const a = request(first), b = request(second)
  assert.equal(a.req.llmConfig.mode, 'unconfigured')
  assert.equal(request().error.code, 'wallet_required')
  store.connect(a.req, validateConnection({ baseUrl: 'https://api.openai.com/v1', apiKey: 'private-api-secret', model: 'model-a', apiStyle: 'chat' }))
  assert.equal(request(first).req.llmConfig.model, 'model-a')
  assert.equal(b.req.llmConfig.mode, 'unconfigured')
  assert.equal(request(demo).req.llmConfig.model, 'recallloop-mock')
  assert.equal(JSON.stringify(publicConnection(first.config)).includes('private-api-secret'), false)
  const old = first.config
  store.disconnect(a.req)
  assert.equal(old.apiKey, '')
  assert.equal(request(first).req.llmConfig.mode, 'unconfigured')
  now += 3_600_001
  assert.equal(request(first).error.code, 'wallet_required')
  assert.equal(request({ ...second, kind: 'challenge' }).error.code, 'wallet_required')
})
