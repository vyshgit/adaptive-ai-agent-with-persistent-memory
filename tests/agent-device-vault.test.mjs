import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { createDeviceVault, deviceVaultKey, DEVICE_VAULT_PREFIX, VAULT_ITERATIONS, MAX_VAULT_PROFILES } from '../src/agent/deviceVault.ts'
import { reconnectVault } from '../src/agent/reconnectVault.ts'
import { clearBrowserSecrets } from '../src/agent/clientSafety.ts'
import { clearLegacyWorkspaceCaches } from '../src/agent/workspaceCache.ts'
import { walletAgentId } from '../server/agent/wallet-auth.mjs'
import { deferred } from './helpers/workspace-http.mjs'

const a = walletAgentId('0xa'), b = walletAgentId('0xb')
const passphrase = 'Synthetic vault passphrase only 2026!'
const model = { baseUrl: 'https://agentrouter.org/v1', apiKey: 'SYNTHETIC_PRIVATE_MODEL_KEY_ONLY', model: 'synthetic-model', apiStyle: 'responses', toolsEnabled: true }
const tatum = { apiKey: 'SYNTHETIC_PRIVATE_TATUM_KEY_ONLY' }
const walrus = { accountId: '0xa', delegateKey: 'SYNTHETIC_PRIVATE_DELEGATE_KEY_ONLY' }
function storage() {
  const data = new Map()
  return { data, get length() { return data.size }, key: index => [...data.keys()][index] || null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) }, removeItem: key => { data.delete(key) } }
}
function vault(store, identity = a, options = {}) { return createDeviceVault(identity, { storage: store, crypto: webcrypto, origin: 'http://localhost', ...options }) }
async function savedVault(store, identity = a, options = {}) {
  const result = vault(store, identity, options)
  await result.create(passphrase)
  await result.save('model', model)
  await result.save('tatum', tatum)
  await result.save('walrus', walrus)
  return result
}
function controlledCrypto() {
  let hold = null
  const crypto = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: new Proxy(webcrypto.subtle, {
    get(target, property) {
      const original = Reflect.get(target, property, target)
      if (typeof original !== 'function') return original
      return async (...args) => {
        const pending = hold?.method === property ? hold : null
        if (pending) hold = null
        const result = await original.apply(target, args)
        if (pending) { pending.started.resolve(); await pending.release.promise }
        return result
      }
    },
  }) }
  return { crypto, holdNext(method) { hold = { method, started: deferred(), release: deferred() }; return hold } }
}

test('device credentials are session-only by default; vault creation requires a separate passphrase and wallet identity', async () => {
  const store = storage(), device = vault(store)
  assert.equal(store.data.size, 0)
  assert.deepEqual(device.getSnapshot(), { available: true, exists: false, unlocked: false, busy: false, saved: [], profiles: [], error: '' })
  assert.throws(() => device.readConnections(), { code: 'vault_locked' })
  for (const identity of ['demo-private', 'recallloop-workspace', '', 'wallet-unsafe']) assert.throws(() => deviceVaultKey(identity))
  for (const value of ['', 'short', 'x'.repeat(257)]) await assert.rejects(device.create(value), { code: 'vault_password' })
  assert.equal(store.data.size, 0)
  assert.equal(device.getSnapshot().unlocked, false)
})

test('real WebCrypto encrypts every saved key with random salt/IV and reload requires the passphrase, never plaintext persistence', async () => {
  const store = storage(), crypto = controlledCrypto(), device = await savedVault(store, a, { crypto: crypto.crypto })
  const raw = store.getItem(device.storageKey), envelope = JSON.parse(raw)
  assert.equal(envelope.iterations, VAULT_ITERATIONS)
  assert.equal(envelope.kdf, 'PBKDF2-SHA256')
  assert.equal(Buffer.from(envelope.salt, 'base64url').length, 32)
  assert.equal(Buffer.from(envelope.iv, 'base64url').length, 12)
  for (const value of [passphrase, model.apiKey, tatum.apiKey, walrus.delegateKey, model.baseUrl, model.model]) {
    assert.equal(raw.includes(value), false)
    assert.equal(JSON.stringify(device.getSnapshot()).includes(value), false)
  }
  assert.deepEqual(device.getSnapshot().saved, ['model', 'tatum', 'walrus'])
  const firstIV = envelope.iv
  await device.save('model', model)
  assert.notEqual(JSON.parse(store.getItem(device.storageKey)).iv, firstIV)
  device.destroy()
  const returning = vault(store)
  assert.equal(returning.getSnapshot().exists, true)
  assert.equal(returning.getSnapshot().unlocked, false)
  await returning.unlock(passphrase)
  const loaded = returning.readConnections()
  assert.deepEqual(loaded.models, [{ ...model, profileId: 'legacy-model', profileName: 'Model' }])
  assert.deepEqual(loaded.tatum, tatum)
  assert.equal(loaded.walrus.delegateKey, walrus.delegateKey)
  assert.equal(loaded.walrus.accountId, `0x${'a'.padStart(64, '0')}`)
  returning.lock()
  assert.throws(() => returning.readConnections(), { code: 'vault_locked' })
})

test('wrong passphrases, transplanted wallets/origins, ciphertext tampering, and forged KDF metadata never unlock a vault', async () => {
  const store = storage(), device = await savedVault(store), original = store.getItem(device.storageKey)
  device.lock()
  await assert.rejects(device.unlock('Incorrect synthetic passphrase!'), { code: 'vault_invalid' })
  assert.equal(device.getSnapshot().unlocked, false)
  assert.throws(() => device.readConnections())
  const other = vault(store, b)
  assert.equal(other.getSnapshot().exists, false)
  const record = JSON.parse(original)
  store.setItem(other.storageKey, JSON.stringify({ ...record, wallet: b }))
  other.sync()
  await assert.rejects(other.unlock(passphrase), { code: 'vault_invalid' })
  await assert.rejects(vault(store, a, { origin: 'https://another-origin.example' }).unlock(passphrase), { code: 'vault_invalid' })
  for (const changed of [
    { ...record, ciphertext: (record.ciphertext[0] === 'A' ? 'B' : 'A') + record.ciphertext.slice(1) },
    { ...record, iterations: 1 }, { ...record, iterations: 2 ** 40 }, { ...record, kdf: 'no-encryption' },
    { ...record, version: 1 }, { ...record, version: 3 }, { ...record, wallet: b }, { ...record, salt: 'AA' }, { ...record, iv: 'AA' },
    { ...record, unexpectedCredential: 'DO_NOT_READ_THIS' },
  ]) {
    store.setItem(device.storageKey, JSON.stringify(changed))
    device.sync()
    await assert.rejects(device.unlock(passphrase), { code: 'vault_invalid' })
    assert.equal(device.getSnapshot().unlocked, false)
    assert.deepEqual(device.getSnapshot().saved, [])
  }
  assert.equal(JSON.stringify(device.getSnapshot()).includes(passphrase), false)
  assert.equal(JSON.stringify(device.getSnapshot()).includes('DO_NOT_READ_THIS'), false)
})

test('vault schema rejects unrelated credentials, unsafe accounts, and malformed records without writing them', async () => {
  const store = storage(), device = await savedVault(store), original = store.getItem(device.storageKey)
  for (const [name, value] of [
    ['model', { ...model, workspaceToken: 'NEVER_SAVE_OPERATOR_TOKEN' }],
    ['model', { ...model, apiStyle: 'anthropic' }], ['model', { ...model, apiKey: 'short' }],
    ['tatum', { apiKey: 'unsafe\r\nAuthorization: credential' }],
    ['walrus', { ...walrus, accountId: '../another-wallet' }], ['wallet', { privateKey: 'NEVER_SAVE_WALLET_KEYS' }],
  ]) await assert.rejects(device.save(name, value), { code: 'vault_invalid' })
  assert.equal(store.getItem(device.storageKey), original)
  store.setItem(device.storageKey, 'x'.repeat(50_001)); device.sync()
  await assert.rejects(device.unlock(passphrase), { code: 'vault_invalid' })
})

test('logout, lock, forgetting, and expired-login revocation beat delayed encryption and cannot resurrect saved credentials', async () => {
  for (const action of ['lock', 'forget', 'destroy', 'expiry']) {
    const store = storage(), controlled = controlledCrypto()
    let active = true
    const device = await savedVault(store, a, { crypto: controlled.crypto, isActive: () => active })
    const original = store.getItem(device.storageKey), hold = controlled.holdNext('encrypt')
    const pending = device.save('tatum', { apiKey: 'LATE_NEW_TATUM_CREDENTIAL_ONLY' })
    await hold.started.promise
    if (action === 'expiry') active = false
    else device[action]()
    hold.release.resolve()
    await assert.rejects(pending, error => ['vault_locked', 'vault_ended'].includes(error.code))
    assert.equal(store.getItem(device.storageKey), action === 'forget' ? null : original)
    assert.throws(() => device.readConnections())
  }
})

test('late vault creation and unlock completions cannot survive teardown, cancellation, or a newly selected login', async () => {
  const empty = storage(), controlled = controlledCrypto(), device = vault(empty, a, { crypto: controlled.crypto })
  const createHold = controlled.holdNext('deriveKey'), creating = device.create(passphrase)
  await createHold.started.promise
  device.destroy(); createHold.release.resolve()
  await assert.rejects(creating, { code: 'vault_ended' })
  assert.equal(empty.data.size, 0)
  const store = storage(), existing = await savedVault(store)
  existing.destroy()
  const decrypt = controlledCrypto(), returning = vault(store, a, { crypto: decrypt.crypto })
  const hold = decrypt.holdNext('decrypt'), abort = new AbortController(), pending = returning.unlock(passphrase, abort.signal)
  await hold.started.promise
  abort.abort(new Error('SENSITIVE_ABORT_REASON_MUST_NOT_BE_DISPLAYED')); returning.lock(); hold.release.resolve()
  await assert.rejects(pending, error => error.name === 'AbortError' && !error.message.includes('SENSITIVE'))
  assert.equal(returning.getSnapshot().unlocked, false)
  assert.deepEqual(returning.getSnapshot().saved, [])
})

test('forgotten or replaced vault copies in other tabs win over stale encrypted writes', async () => {
  for (const remove of [true, false]) {
    const store = storage(), controlled = controlledCrypto(), first = await savedVault(store, a, { crypto: controlled.crypto })
    const second = vault(store)
    await second.unlock(passphrase)
    const hold = controlled.holdNext('encrypt'), pending = first.save('model', { ...model, apiKey: 'STALE_REPLACEMENT_MODEL_KEY' })
    await hold.started.promise
    if (remove) second.forget()
    else await second.save('tatum', { apiKey: 'NEWER_TATUM_CREDENTIAL_KEY' })
    const current = store.getItem(second.storageKey)
    hold.release.resolve()
    await assert.rejects(pending, { code: 'vault_changed' })
    assert.equal(store.getItem(first.storageKey), current)
    assert.equal(first.getSnapshot().unlocked, false)
    assert.deepEqual(first.getSnapshot().saved, [])
  }
})

test('forgetting affects only the signed wallet vault, while legacy cleanup preserves encrypted vaults and unrelated settings', async () => {
  const store = storage(), first = await savedVault(store), second = await savedVault(store, b)
  const other = store.getItem(second.storageKey)
  store.setItem('recallloop.theme', 'dark')
  store.setItem('recallloop.sessions.v1:wallet-old', 'PRIVATE_LEGACY_CHAT')
  assert.deepEqual(clearLegacyWorkspaceCaches(store), { removed: 1, failed: false })
  assert.equal([...store.data.keys()].filter(key => key.startsWith(DEVICE_VAULT_PREFIX)).length, 2)
  first.forget()
  assert.equal(store.getItem(first.storageKey), null)
  assert.equal(store.getItem(second.storageKey), other)
  assert.equal(store.getItem('recallloop.theme'), 'dark')
  assert.equal(first.getSnapshot().unlocked, false)
})

test('blocked storage or missing WebCrypto fails closed without plaintext fallback, and failed removal still locks the vault', async () => {
  const store = storage(), unsupported = vault(store, a, { crypto: { subtle: null } })
  assert.equal(unsupported.getSnapshot().available, false)
  await assert.rejects(unsupported.create(passphrase), { code: 'vault_unavailable' })
  assert.equal(store.data.size, 0)
  const device = await savedVault(store), original = store.getItem(device.storageKey)
  store.setItem = () => { throw new Error(`blocked ${passphrase} ${model.apiKey}`) }
  await assert.rejects(device.save('tatum', { apiKey: 'UNSAVED_TATUM_CREDENTIAL_KEY' }), { code: 'vault_write_failed' })
  assert.equal(store.getItem(device.storageKey), original)
  assert.deepEqual(device.readConnections().tatum, tatum)
  store.removeItem = () => { throw new Error(`blocked ${passphrase}`) }
  assert.throws(() => device.forget(), { code: 'vault_forget_failed' })
  assert.equal(device.getSnapshot().unlocked, false)
  assert.equal(device.getSnapshot().exists, true)
  assert.equal(JSON.stringify(device.getSnapshot()).includes(passphrase), false)
})

test('saved reconnection is explicit, sequential, quota-aware and uses normal verification with no chat/memory writes', async t => {
  t.after(clearBrowserSecrets)
  const device = await savedVault(storage()), requests = []
  const results = await reconnectVault({ vault: device, signal: new AbortController().signal,
    send: async (path, body) => { requests.push({ path, body: structuredClone(body), reference: body }) } })
  assert.deepEqual(requests.map(request => request.path), ['/connect', '/connections/tatum', '/connections/memwal'])
  assert.equal(requests[0].body.apiKey, model.apiKey)
  assert.equal(requests[0].body.checkCapabilities, false)
  assert.deepEqual(requests[1].body, tatum)
  assert.equal(requests[2].body.delegateKey, walrus.delegateKey)
  assert.deepEqual(results.map(result => result.status), ['verified', 'verified', 'verified'])
  for (const key of [model.apiKey, tatum.apiKey, walrus.delegateKey]) assert.equal(JSON.stringify(results).includes(key), false)
  for (const request of requests) assert.equal(request.reference.apiKey || request.reference.delegateKey || '', '')
  assert.deepEqual(device.getSnapshot().saved, ['model', 'tatum', 'walrus'], 'no destructive implicit migration')
})

test('a real version-one encrypted vault loads without rewriting and upgrades atomically on its next save', async () => {
  const store = storage(), salt = webcrypto.getRandomValues(new Uint8Array(32)), iv = webcrypto.getRandomValues(new Uint8Array(12))
  const material = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: VAULT_ITERATIONS }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const payload = new TextEncoder().encode(JSON.stringify({ version: 1, wallet: a, connections: { model, tatum, walrus } }))
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`RecallLoop device vault|1|http://localhost|${a}`), tagLength: 128 }, key, payload)
  const original = JSON.stringify({ version: 1, wallet: a, kdf: 'PBKDF2-SHA256', iterations: VAULT_ITERATIONS,
    salt: Buffer.from(salt).toString('base64url'), iv: Buffer.from(iv).toString('base64url'), ciphertext: Buffer.from(ciphertext).toString('base64url') })
  store.setItem(deviceVaultKey(a), original)
  const device = vault(store)
  await device.unlock(passphrase)
  assert.equal(store.getItem(device.storageKey), original)
  assert.deepEqual(device.readConnections().models, [{ ...model, profileId: 'legacy-model', profileName: 'Model' }])
  await device.save('model', { ...model, profileId: 'second-profile', profileName: 'Second account', apiKey: 'SYNTHETIC_SECOND_PROVIDER_KEY' })
  assert.equal(JSON.parse(store.getItem(device.storageKey)).version, 2)
  device.lock()
  await device.unlock(passphrase)
  assert.equal(device.readConnections().models.length, 2)
  assert.equal(device.readConnections().models[0].apiKey, model.apiKey)
  assert.deepEqual(device.readConnections().tatum, tatum)
  device.destroy()
})

test('encrypted profiles with duplicate model IDs reconnect by identity and can be replaced or forgotten independently', async t => {
  t.after(clearBrowserSecrets)
  const store = storage(), device = await savedVault(store), second = { ...model, profileId: 'second-provider', profileName: 'Other account', apiKey: 'SYNTHETIC_SECOND_PROVIDER_KEY' }
  await device.save('model', second)
  const requests = []
  const results = await reconnectVault({ vault: device, signal: new AbortController().signal, profileId: second.profileId,
    send: async (path, body) => requests.push({ path, body: structuredClone(body) }) })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, '/connect')
  assert.equal(requests[0].body.profileId, second.profileId)
  assert.equal(requests[0].body.apiKey, second.apiKey)
  assert.equal(results[0].profileId, second.profileId)
  await device.save('model', { ...second, apiKey: 'SYNTHETIC_REPLACEMENT_PROVIDER_KEY' })
  assert.equal(device.readConnections().models.length, 2)
  assert.equal(device.readConnections().models[0].apiKey, model.apiKey)
  await device.forgetModel('second-provider')
  assert.equal(device.readConnections().models.length, 1)
  assert.deepEqual(device.readConnections().tatum, tatum)
  assert.equal(store.data.size, 1)
  device.destroy()
})

test('encrypted profile count is bounded and malformed identities cannot replace an existing profile', async () => {
  const store = storage(), device = await savedVault(store)
  for (let i = 1; i < MAX_VAULT_PROFILES; i++) await device.save('model', { ...model, profileId: `profile-${i}` })
  const original = store.getItem(device.storageKey)
  await assert.rejects(device.save('model', { ...model, profileId: 'one-too-many' }), { code: 'vault_invalid' })
  for (const profileId of ['scripted-mock', 'bad|model', '', model.apiKey]) {
    await assert.rejects(device.save('model', { ...model, profileId }), { code: 'vault_invalid' })
  }
  assert.equal(store.getItem(device.storageKey), original)
  assert.equal(device.readConnections().models.length, MAX_VAULT_PROFILES)
  device.destroy()
})

test('cancelling saved reconnection scrubs its temporary request without changing encrypted credentials', async t => {
  t.after(clearBrowserSecrets)
  const store = storage(), device = await savedVault(store), original = store.getItem(device.storageKey), controller = new AbortController(), requests = []
  await assert.rejects(reconnectVault({ vault: device, signal: controller.signal, send: async (_path, body) => { requests.push(body); controller.abort() } }), { name: 'AbortError' })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].apiKey, '')
  assert.equal(store.getItem(device.storageKey), original)
  assert.equal(device.readConnections().models[0].apiKey, model.apiKey)
  device.destroy()
})

test('reconnection preserves independent failures, skips Walrus after failed Tatum, redacts keys and never retries', async t => {
  t.after(clearBrowserSecrets)
  const device = await savedVault(storage()), requests = []
  const results = await reconnectVault({ vault: device, signal: new AbortController().signal, tatumConnected: true,
    send: async path => { requests.push(path); throw new Error(`Invalid ${model.apiKey} ${tatum.apiKey} ${walrus.delegateKey}`) } })
  assert.deepEqual(requests, ['/connect', '/connections/tatum'])
  assert.deepEqual(results.map(result => result.status), ['failed', 'failed', 'skipped'])
  assert.match(results[0].message, /\[REDACTED\]/)
  for (const key of [model.apiKey, tatum.apiKey, walrus.delegateKey]) assert.equal(JSON.stringify(results).includes(key), false)
})

test('locking or ending a login during saved verification blocks every later credential request, including queued progress callbacks', async t => {
  t.after(clearBrowserSecrets)
  const device = await savedVault(storage()), started = deferred(), release = deferred(), requests = []
  const pending = reconnectVault({ vault: device, signal: new AbortController().signal,
    send: async path => { requests.push(path); started.resolve(); await release.promise } })
  await started.promise
  device.destroy(); release.resolve()
  await assert.rejects(pending, /stopped/)
  assert.deepEqual(requests, ['/connect'])
  const next = await savedVault(storage())
  await assert.rejects(reconnectVault({ vault: next, signal: new AbortController().signal,
    onStep: () => next.lock(), send: async () => assert.fail('A queued callback must not send old keys') }), /stopped/)
})

test('unlocking again after a lock cannot revive a previously started saved reconnection', async t => {
  t.after(clearBrowserSecrets)
  const device = await savedVault(storage()), started = deferred(), release = deferred(), requests = []
  const pending = reconnectVault({ vault: device, signal: new AbortController().signal,
    send: async path => { requests.push(path); started.resolve(); await release.promise } })
  await started.promise
  device.lock()
  await device.unlock(passphrase)
  release.resolve()
  await assert.rejects(pending, /stopped/)
  assert.deepEqual(requests, ['/connect'])
  assert.equal(device.getSnapshot().unlocked, true, 'the new unlock is separate from the stale reconnect operation')
})
