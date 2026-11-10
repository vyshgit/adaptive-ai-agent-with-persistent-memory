import test from 'node:test'
import assert from 'node:assert/strict'
import { createLlm } from '../server/agent/llm.mjs'
import { validateModelDiscovery } from '../server/agent/connections.mjs'
import { workspaceHttp, deferred } from './helpers/workspace-http.mjs'
import { within } from '../server/safety.mjs'

const provider = { baseUrl: 'https://api.openai.com/v1', apiKey: 'synthetic-discovery-key', apiStyle: 'responses' }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

test('preconnection discovery validates provider credentials without requiring or inventing a model', async () => {
  const config = validateModelDiscovery(provider)
  assert.equal(config.model, '')
  const llm = createLlm({ fetchImpl: async (url, input) => {
    assert.equal(url, `${provider.baseUrl}/models`)
    assert.equal(input.method, undefined)
    assert.equal(input.headers.get('Authorization'), `Bearer ${provider.apiKey}`)
    return json({ data: [{ id: 'first-model' }, { id: 'first-model' }, { id: 'bad model' }, ...Array.from({ length: 130 }, (_, n) => ({ id: `model-${n}` }))] })
  } })
  const result = await llm.models(config)
  assert.equal(result.models.length, 100)
  assert.equal(result.models.includes(''), false)
  assert.equal(result.verified, false)
  assert.equal(result.discovered, true)
  const missing = createLlm({ fetchImpl: async () => json({}, 404) })
  assert.deepEqual(await missing.models(config), { models: [], discovered: false, verified: false })
  assert.throws(() => validateModelDiscovery({ ...provider, model: 'placeholder' }), { code: 'invalid_request' })
  assert.throws(() => validateModelDiscovery({ ...provider, baseUrl: 'https://evil.example/v1' }), { code: 'invalid_request' })
  assert.throws(() => validateModelDiscovery({ ...provider, apiKey: 'bad\nkey' }), { code: 'invalid_request' })
})

test('HTTP discovery is signed-session scoped and never installs a key, verifies generation or uses operator credentials', async t => {
  let staged, verifies = 0
  const f = await workspaceHttp(t, { llm: {
    async models(config) { staged = config; return { models: ['first-model', config.apiKey], discovered: true } },
    async verify() { verifies++; assert.fail('Discovery cannot generate') },
  } })
  const browser = f.client()
  assert.equal((await browser.json('/models/discover', { body: provider })).status, 401)
  await browser.demo()
  assert.equal((await browser.json('/models/discover', { body: provider })).status, 403)
  await browser.login()
  const result = await browser.json('/models/discover', { body: provider })
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.deepEqual(result.data.models, [{ id: 'first-model', label: 'first-model' }])
  assert.equal(result.data.verified, false)
  assert.equal(JSON.stringify(result.data).includes(provider.apiKey), false)
  assert.equal(staged.apiKey, '')
  assert.equal(verifies, 0)
  assert.equal((await browser.json('/status')).data.llm.mode, 'unconfigured')
  assert.equal((await browser.json('/models/discover', { body: { ...provider, agentId: 'other-wallet' } })).status, 400)
  const untagged = f.client({ cookie: browser.cookie })
  assert.equal((await untagged.json('/models/discover', { body: provider })).status, 409)
})

test('logout during preconnection discovery cancels the read, clears staged credentials and refuses late results', async t => {
  const started = deferred(), gate = deferred()
  let staged
  const f = await workspaceHttp(t, { llm: { async models(config, signal) {
    staged = config; started.resolve()
    await within(gate.promise, 10_000, null, signal)
    return { models: ['late-model'], discovered: true }
  } } })
  const browser = f.client()
  await browser.login()
  const pending = browser.json('/models/discover', { body: provider })
  await started.promise
  assert.equal((await browser.json('/connect', { body: { mode: 'mock' } })).status, 429)
  await browser.json('/auth/logout', { body: {} })
  const result = await pending
  assert.equal(result.status, 401)
  assert.equal(staged.apiKey, '')
  assert.equal(f.sessions[0].config, null)
  gate.resolve()
})
