import test from 'node:test'
import assert from 'node:assert/strict'
import { PROVIDERS, providerForUrl, generationVerified, modelStatus, capabilityLabel } from '../src/agent/providers.ts'

const connection = overrides => ({ mode: 'live', model: 'synthetic-exact-model', models: [{ id: 'synthetic-exact-model', label: 'synthetic-exact-model' }],
  baseUrl: 'https://agentrouter.org/v1', apiStyle: 'responses', toolsEnabled: true, source: 'session', verified: true,
  verification: { model: 'synthetic-exact-model', apiStyle: 'responses', checkedAt: '2026-11-08T00:00:00Z', discovery: 'available',
    generation: 'verified', streaming: 'not_checked', tools: 'not_checked' }, ...overrides })

test('provider presets use official API bases and recognize saved aliases without guessing model IDs', () => {
  assert.equal(new Set(PROVIDERS.map(provider => provider.id)).size, PROVIDERS.length)
  for (const provider of PROVIDERS) {
    assert.ok(['chat', 'responses'].includes(provider.apiStyle))
    assert.equal('model' in provider, false)
    for (const link of [provider.keyUrl, provider.docsUrl, provider.modelsUrl].filter(Boolean)) {
      const url = new URL(link)
      assert.equal(url.protocol, 'https:')
      assert.equal(url.username + url.password + url.hash, '')
    }
    if (provider.id !== 'custom') assert.equal(providerForUrl(`${provider.baseUrl}/`).id, provider.id)
  }
  assert.equal(providerForUrl('https://api.deepseek.com/v1/').id, 'deepseek')
  assert.equal(PROVIDERS.find(provider => provider.id === 'deepseek').baseUrl, 'https://api.deepseek.com')
  for (const value of ['', 'https://agentrouter.org/v1/responses', 'https://agentrouter.org.evil.example/v1', 'https://api.example.com/v1']) {
    assert.equal(providerForUrl(value).id, 'custom')
  }
})

test('generation indicators require a successful check for exactly the current live model and protocol', () => {
  const saved = connection()
  assert.equal(generationVerified(saved, saved.model), true)
  assert.equal(modelStatus(saved, saved.model).label, 'Generation verified')
  const invalid = [undefined, connection({ verified: false }), connection({ verification: null }), connection({ mode: 'mock' }),
    connection({ apiStyle: 'chat' }), connection({ lastVerificationFailure: { code: 'provider_key_rejected', message: 'Synthetic failure' } })]
  for (const value of invalid) assert.equal(generationVerified(value, saved.model), false)
  assert.equal(generationVerified(saved, 'synthetic-discovered-only'), false)
  assert.equal(modelStatus(saved, 'synthetic-discovered-only').label, 'Generation not verified')
  assert.equal(modelStatus(connection({ lastVerificationFailure: { code: 'provider_quota_exhausted', message: 'Synthetic quota failure' } }), saved.model).label, 'Last check failed')
  assert.equal(modelStatus(connection({ verification: null }), saved.model).label, 'Generation not verified')
  assert.equal(modelStatus(undefined, '').label, 'No model connected')
  assert.equal(modelStatus(connection({ mode: 'mock' }), saved.model).label, 'Scripted mock')
})

test('capability labels do not infer streaming or tools from generation or model discovery', () => {
  for (const [state, label] of [[undefined, 'Not checked'], ['not_checked', 'Not checked'], ['verified', 'Verified'], ['unsupported', 'Unsupported'], ['failed', 'Check failed']]) {
    assert.equal(capabilityLabel(state), label)
  }
})
