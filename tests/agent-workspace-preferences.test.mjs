import test from 'node:test'
import assert from 'node:assert/strict'
import { clearBrowserSecrets, registerBrowserSecret, scopedCacheKey } from '../src/agent/clientSafety.ts'
import { createWorkspaceCache, clearInactiveWorkspaceCaches } from '../src/agent/workspaceCache.ts'
import { PREFERENCES_KEY, normalisePreferences, providerSetup, preferredModel, preferredConnection, connectionPreference, loadPreferences, savePreferences, clearPreferences } from '../src/agent/workspacePreferences.ts'
import { walletAgentId } from '../server/agent/wallet-auth.mjs'

function storage() {
  const data = new Map()
  return { data, get length() { return data.size }, key: index => [...data.keys()][index] || null,
    getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
}
const identity = walletAgentId('0xa'), tag = 'a'.repeat(32)
const setup = { baseUrl: 'https://api.openai.com/v1', apiStyle: 'responses', model: 'synthetic-model' }
const preferences = { provider: 'openai', providers: { openai: setup }, accountId: '0xa',
  conversation: { sidebar: false, mode: 'plan', stream: false, model: setup } }

test('the preference cache admits only named non-sensitive setup fields, not generic variables or authority', () => {
  const privateFields = { apiKey: 'PRIVATE_API_KEY', delegateKey: 'PRIVATE_DELEGATE', token: 'PRIVATE_TOKEN', passphrase: 'PRIVATE_PASSPHRASE',
    catalog: [{ id: 'PRIVATE_CATALOG' }], verified: true, checkCapabilities: true, toolsEnabled: true, confirm: 'open-local-folder',
    permissions: 'standard', folderConsent: true, useMemory: true, capture: true, captureRaw: true, memoryIds: ['PRIVATE_MEMORY'],
    command: 'PRIVATE_COMMAND', task: 'PRIVATE_TASK', draft: 'PRIVATE_SOURCE', output: 'PRIVATE_OUTPUT', approvals: [{ id: 'PRIVATE_APPROVAL' }] }
  const raw = { ...preferences, ...privateFields, providers: { openai: { ...setup, ...privateFields }, unknown: setup },
    conversation: { ...preferences.conversation, ...privateFields } }
  assert.deepEqual(normalisePreferences(raw), preferences)
  const tab = storage(), cache = createWorkspaceCache(identity, tag, tab)
  assert.equal(savePreferences(raw, cache), true)
  assert.doesNotMatch([...tab.data.values()].join(''), /PRIVATE_|verified|capture|Consent|permissions|approvals/)
})

test('cache validation rejects credential URLs, malformed values, unsafe paths and out-of-range options', () => {
  for (const baseUrl of ['https://key:password@api.example.com/v1', 'https://api.example.com/v1?key=secret', 'https://api.example.com/v1#token',
    'https://api.example.com/%73%6b-secret', 'javascript:alert(1)', 'file:///etc/passwd', 'not-a-url', `https://example.com/${'a'.repeat(600)}`]) {
    assert.deepEqual(normalisePreferences({ providers: { custom: { ...setup, baseUrl } } }), {})
  }
  for (const seconds of [-1, 0, 121, 30.5, '60', Infinity, NaN]) {
    assert.deepEqual(normalisePreferences({ conversation: { sidebar: seconds, stream: seconds, mode: String(seconds) } }), {})
  }
  assert.deepEqual(normalisePreferences({ provider: '__proto__', accountId: 'wallet address',
    conversation: { sidebar: 1, stream: 'false', mode: 'execute' } }), {})
  assert.deepEqual(normalisePreferences({ providers: { openai: { ...setup, baseUrl: `${setup.baseUrl}/`, model: 'a'.repeat(64) } } }),
    { providers: { openai: { baseUrl: setup.baseUrl, apiStyle: setup.apiStyle } } })
})

test('recognized or registered secrets are omitted rather than stored as redacted form defaults', t => {
  t.after(clearBrowserSecrets)
  const key = 'SYNTHETIC_REGISTERED_PREF_SECRET'
  registerBrowserSecret(key)
  for (const model of [key, `sk-${'q'.repeat(24)}`, `suiprivkey1${'a'.repeat(40)}`]) {
    assert.deepEqual(normalisePreferences({ providers: { openai: { ...setup, model } }, conversation: { model: { ...setup, model } } }),
      { providers: { openai: { baseUrl: setup.baseUrl, apiStyle: setup.apiStyle } } })
  }
  assert.deepEqual(normalisePreferences({ providers: { custom: { ...setup, baseUrl: `https://example.com/${key}` } }, accountId: key }), {})
})

test('remembered fields reload only within the same wallet/login lease and cannot cross scopes', () => {
  const tab = storage(), cache = createWorkspaceCache(identity, tag, tab)
  assert.equal(savePreferences(preferences, cache), true)
  assert.deepEqual(loadPreferences(createWorkspaceCache(identity, tag, tab)), preferences)
  for (const next of [createWorkspaceCache(identity, 'b'.repeat(32), tab), createWorkspaceCache(walletAgentId('0xb'), tag, tab)]) {
    assert.deepEqual(loadPreferences(next), {})
    assert.equal(next.storage.getItem(scopedCacheKey(PREFERENCES_KEY, cache.scope)), null)
    assert.throws(() => next.storage.setItem(scopedCacheKey(PREFERENCES_KEY, cache.scope), 'FORGED_PREFERENCES'))
  }
})

test('logout revokes preferences before late saves, and inactive-login cleanup also prunes remembered fields', () => {
  const tab = storage(), cache = createWorkspaceCache(identity, tag, tab), next = createWorkspaceCache(identity, 'b'.repeat(32), tab)
  savePreferences(preferences, cache); savePreferences({ provider: 'groq' }, next)
  tab.setItem('recallloop.theme', 'dark')
  tab.setItem('unrelated.app', 'kept')
  assert.equal(cache.revoke(), true)
  assert.equal(savePreferences(preferences, cache), false)
  assert.deepEqual(loadPreferences(cache), {})
  assert.equal(tab.getItem(scopedCacheKey(PREFERENCES_KEY, cache.scope)), null)
  assert.deepEqual(clearInactiveWorkspaceCaches(null, tab), { removed: 1, failed: false })
  assert.equal(tab.getItem('recallloop.theme'), 'dark')
  assert.equal(tab.getItem('unrelated.app'), 'kept')
})

test('forgetting remembered fields removes only their own key and does not revoke the active workspace', () => {
  const tab = storage(), cache = createWorkspaceCache(identity, tag, tab)
  savePreferences(preferences, cache)
  tab.setItem('recallloop.theme', 'light')
  tab.setItem(`unrelated:${cache.scope}`, 'private project')
  assert.equal(clearPreferences(cache), true)
  assert.deepEqual(loadPreferences(cache), {})
  assert.equal(cache.active, true)
  assert.deepEqual([...tab.data.values()], ['light', 'private project'])
})

test('corrupt, oversized and unknown-version preferences are removed without crashing or reading another cache', () => {
  for (const value of ['{broken', JSON.stringify({ version: 9, preferences }), 'a'.repeat(16_001)]) {
    const tab = storage(), cache = createWorkspaceCache(identity, tag, tab), key = scopedCacheKey(PREFERENCES_KEY, cache.scope)
    tab.setItem(key, value); tab.setItem('unrelated', 'keep')
    assert.deepEqual(loadPreferences(cache), {})
    assert.equal(tab.getItem(key), null)
    assert.equal(tab.getItem('unrelated'), 'keep')
  }
  const tab = storage(), cache = createWorkspaceCache(identity, tag, tab), key = scopedCacheKey(PREFERENCES_KEY, cache.scope)
  tab.setItem(key, JSON.stringify({ version: 1, preferences: { ...preferences, apiKey: 'PRIVATE_INJECTED_FIELD' } }))
  assert.deepEqual(loadPreferences(cache), preferences)
  assert.doesNotMatch(tab.getItem(key), /PRIVATE_INJECTED_FIELD/)
})

test('blocked or absent browser storage falls back to page state and reports unsuccessful save/clear', () => {
  const blocked = createWorkspaceCache(identity, tag, { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } })
  for (const cache of [blocked, createWorkspaceCache(identity, tag, null)]) {
    assert.deepEqual(loadPreferences(cache), {})
    assert.equal(savePreferences(preferences, cache), false)
    assert.equal(clearPreferences(cache), false)
  }
})

test('provider form defaults remember each provider without copying credentials or confusing another live endpoint', () => {
  const connection = { mode: 'live', ...setup }
  assert.deepEqual(providerSetup(undefined, {}), { preset: 'agentrouter', baseUrl: 'https://agentrouter.org/v1', apiStyle: 'responses', model: '' })
  assert.deepEqual(providerSetup(connection, {}), { preset: 'openai', ...setup })
  const custom = { ...connection, baseUrl: 'https://custom.example/v1' }
  assert.deepEqual(providerSetup(custom, {}), { preset: 'custom', baseUrl: custom.baseUrl, apiStyle: custom.apiStyle, model: custom.model })
  assert.deepEqual(providerSetup(connection, { provider: 'groq' }), { preset: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiStyle: 'chat', model: '' })
  const saved = { provider: 'custom', providers: { custom: { baseUrl: 'https://api.deepseek.com/v1', apiStyle: 'chat', model: 'synthetic-preference' } } }
  assert.deepEqual(providerSetup(connection, saved), { preset: 'custom', ...saved.providers.custom })
})

test('a preferred task model is only a hint and must still belong to the current endpoint, protocol and catalogue', () => {
  const connection = { mode: 'live', ...setup, model: 'current-model', models: [{ id: 'current-model' }, { id: setup.model }] }
  assert.equal(preferredModel(connection, setup), setup.model)
  for (const preference of [{ ...setup, baseUrl: 'https://other.example/v1' }, { ...setup, apiStyle: 'chat' }, { ...setup, model: 'not-advertised' }]) {
    assert.equal(preferredModel(connection, preference), connection.model)
  }
  assert.equal(preferredModel(undefined, setup), '')
  assert.equal(preferredModel({ ...connection, models: [], model: '' }, setup), '')
})

test('profile identity pins duplicate model IDs even when another account at the same endpoint is added', () => {
  const first = { ...setup, id: 'first-account', mode: 'live', models: [{ id: setup.model }] }
  const second = { ...first, id: 'second-account' }
  const preference = connectionPreference(first, setup.model)
  assert.equal(preferredConnection([first, second], second, preference), first)
  assert.equal(preferredConnection([second, first], second, preference), first)
  assert.equal(preferredModel(first, preference), setup.model)
  const malformed = { ...preference, connectionId: 'second-account|other-model' }
  assert.deepEqual(normalisePreferences({ conversation: { model: malformed } }), {})
  assert.deepEqual(normalisePreferences({ conversation: { model: preference } }), { conversation: { model: preference } })
})

test('the auto-memory preference is boolean, login-scoped and never restores raw-capture consent', () => {
  const tab = storage(), cache = createWorkspaceCache(identity, tag, tab)
  savePreferences({ autoMemory: false, captureMode: 'both', conversation: { captureRaw: true } }, cache)
  assert.deepEqual(loadPreferences(cache), { autoMemory: false })
  assert.deepEqual(loadPreferences(createWorkspaceCache(identity, 'b'.repeat(32), tab)), {})
  for (const autoMemory of ['false', 0, null, {}]) assert.deepEqual(normalisePreferences({ autoMemory }), {})
  cache.revoke()
  assert.equal(savePreferences({ autoMemory: true }, cache), false)
})
