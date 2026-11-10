import type { CacheStorage } from './clientSafety.ts'
import { redactBrowserText } from './clientSafety.ts'

export const DEVICE_VAULT_PREFIX = 'recallloop.device-vault.v1:'
export const VAULT_ITERATIONS = 600_000
export const MAX_VAULT_PROFILES = 12
const MAX_RECORD = 180_000
const MAX_PLAINTEXT = 120_000

export interface VaultConnectionMap {
  model: { baseUrl: string; apiKey: string; model: string; apiStyle: 'responses' | 'chat'; toolsEnabled: boolean; profileId?: string; profileName?: string }
  tatum: { apiKey: string }
  walrus: { accountId: string; delegateKey: string }
}
export type VaultConnectionName = keyof VaultConnectionMap
export type SavedModelProfile = VaultConnectionMap['model'] & { profileId: string; profileName: string }
export interface SavedConnections { models?: SavedModelProfile[]; tatum?: VaultConnectionMap['tatum']; walrus?: VaultConnectionMap['walrus'] }
export interface VaultSnapshot {
  available: boolean
  exists: boolean
  unlocked: boolean
  busy: boolean
  saved: readonly VaultConnectionName[]
  profiles: readonly { id: string; name: string }[]
  error: string
}
export const NO_VAULT: VaultSnapshot = Object.freeze({ available: false, exists: false, unlocked: false, busy: false, saved: [], profiles: [], error: '' })

const errors = {
  vault_unavailable: 'Encrypted device storage is unavailable. Use session-only connections on this browser.',
  vault_ended: 'This wallet workspace has ended. Sign in again to unlock saved connections.',
  vault_locked: 'Unlock this wallet’s device vault before saving or reconnecting.',
  vault_busy: 'A device-vault operation is already running.',
  vault_changed: 'The saved vault changed or was forgotten in another tab. Unlock its current copy before continuing.',
  vault_password: 'Use a unique passphrase of 12–256 characters. It cannot be recovered if forgotten.',
  vault_invalid: 'The passphrase is incorrect or the saved vault is damaged. No connections were loaded.',
  vault_write_failed: 'The connection was not saved on this device. Browser storage may be full or blocked.',
  vault_forget_failed: 'The vault is locked, but its saved copy could not be removed. Clear this site’s browser data before sharing this device.',
} as const
function failure(code: keyof typeof errors) { return Object.assign(new Error(errors[code]), { code }) }

export function deviceVaultKey(agentId: string) {
  if (!/^wallet-[a-f0-9]{40}$/.test(agentId)) throw failure('vault_ended')
  return `${DEVICE_VAULT_PREFIX}${agentId}`
}
function persistentStorage(): CacheStorage | null {
  try { return globalThis.localStorage || null } catch { return null }
}
function base64(bytes: Uint8Array) {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function bytes(value: unknown, length?: number) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > MAX_RECORD) throw failure('vault_invalid')
  const result = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
  if ((length !== undefined && result.length !== length) || base64(result) !== value) throw failure('vault_invalid')
  return result
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw failure('vault_invalid')
  return value as Record<string, unknown>
}
function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw failure('vault_invalid')
}
function text(value: unknown, max: number, min = 1) {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw failure('vault_invalid')
  return value
}
function secret(value: unknown, optional = false) {
  const key = text(value, 4096, optional ? 0 : 8)
  if (key && (key.length < 8 || /[^\x21-\x7e]/.test(key))) throw failure('vault_invalid')
  return key
}
function modelProfile(value: unknown): SavedModelProfile {
  const model = object(value)
  fields(model, ['baseUrl', 'apiKey', 'model', 'apiStyle', 'toolsEnabled', 'profileId', 'profileName'])
  if (!['responses', 'chat'].includes(model.apiStyle as string) || typeof model.toolsEnabled !== 'boolean') throw failure('vault_invalid')
  const profileId = text(model.profileId ?? 'legacy-model', 80)
  const profileName = text(model.profileName || 'Model', 80)
  const apiKey = secret(model.apiKey, true)
  if (!/^[A-Za-z0-9_-]+$/.test(profileId) || ['local-ollama', 'scripted-mock'].includes(profileId)
    || /[\x00-\x1f\x7f]/.test(profileName) || [profileId, profileName].some(value => redactBrowserText(value) !== value || (apiKey && value.includes(apiKey)))) throw failure('vault_invalid')
  return { baseUrl: text(model.baseUrl, 2048), apiKey, model: text(model.model, 128),
    apiStyle: model.apiStyle as 'responses' | 'chat', toolsEnabled: model.toolsEnabled, profileId, profileName }
}
function connections(value: unknown, legacy = false): SavedConnections {
  const input = object(value)
  fields(input, legacy ? ['model', 'tatum', 'walrus'] : ['models', 'tatum', 'walrus'])
  const clean: SavedConnections = {}
  const models = legacy && input.model !== undefined ? [input.model] : input.models
  if (models !== undefined) {
    if (!Array.isArray(models) || models.length > MAX_VAULT_PROFILES) throw failure('vault_invalid')
    const profiles = models.map(modelProfile)
    if (new Set(profiles.map(profile => profile.profileId)).size !== profiles.length) throw failure('vault_invalid')
    if (profiles.length) clean.models = profiles
  }
  if (input.tatum !== undefined) {
    const tatum = object(input.tatum)
    fields(tatum, ['apiKey'])
    clean.tatum = { apiKey: secret(tatum.apiKey) }
  }
  if (input.walrus !== undefined) {
    const walrus = object(input.walrus)
    fields(walrus, ['accountId', 'delegateKey'])
    const accountId = text(walrus.accountId, 66)
    if (!/^0x[\da-f]{1,64}$/i.test(accountId)) throw failure('vault_invalid')
    clean.walrus = { accountId: `0x${accountId.slice(2).toLowerCase().padStart(64, '0')}`, delegateKey: secret(walrus.delegateKey) }
  }
  return clean
}

export interface DeviceVault {
  storageKey: string
  readonly active: boolean
  getSnapshot: () => VaultSnapshot
  subscribe: (listener: () => void) => () => void
  create: (passphrase: string, signal?: AbortSignal) => Promise<void>
  unlock: (passphrase: string, signal?: AbortSignal) => Promise<void>
  save: <Name extends VaultConnectionName>(name: Name, value: VaultConnectionMap[Name], signal?: AbortSignal) => Promise<void>
  forgetModel: (profileId: string, signal?: AbortSignal) => Promise<void>
  readConnections: () => SavedConnections
  lock: () => void
  forget: () => void
  sync: () => void
  destroy: () => void
}

// Only ciphertext is persistent. Neither the passphrase nor a wrapping key is
// stored. The wallet identity is authenticated metadata, NOT an encryption key.
export function createDeviceVault(agentId: string, { storage = persistentStorage(), crypto = globalThis.crypto,
  isActive = () => true, origin = globalThis.location?.origin || 'http://localhost' }:
  { storage?: CacheStorage | null; crypto?: Crypto; isActive?: () => boolean; origin?: string } = {}): DeviceVault {
  const storageKey = deviceVaultKey(agentId)
  const aad = (version: number) => new TextEncoder().encode(`RecallLoop device vault|${version}|${origin}|${agentId}`)
  const listeners = new Set<() => void>()
  let available = Boolean(storage && crypto?.subtle)
  let raw: string | null = null
  try { raw = storage?.getItem(storageKey) ?? null } catch { available = false }
  let key: CryptoKey | null = null
  let salt: Uint8Array<ArrayBuffer> | null = null
  let saved: SavedConnections = {}
  let busy = false, destroyed = false, generation = 0, error = ''
  let snapshot: VaultSnapshot
  function emit() {
    snapshot = Object.freeze({ available, exists: raw !== null, unlocked: Boolean(key) && !destroyed && isActive(), busy,
      saved: Object.freeze((['model', 'tatum', 'walrus'] as const).filter(name => name === 'model' ? saved.models?.length : saved[name])),
      profiles: Object.freeze((saved.models || []).map(profile => Object.freeze({ id: profile.profileId, name: profile.profileName }))), error })
    listeners.forEach(listener => listener())
  }
  function assertActive() { if (destroyed || !isActive()) throw failure('vault_ended') }
  function check(id: number, signal?: AbortSignal) {
    assertActive(); signal?.throwIfAborted()
    if (id !== generation) throw failure('vault_locked')
  }
  function readRaw() {
    try { return storage!.getItem(storageKey) } catch { throw failure('vault_unavailable') }
  }
  function lock() { generation++; key = null; salt = null; saved = {}; busy = false; error = ''; emit() }
  function sync() {
    if (destroyed) return
    try {
      const current = readRaw()
      if (current !== raw) { lock(); raw = current; error = errors.vault_changed; emit() }
    } catch { lock(); available = false; error = errors.vault_unavailable; emit() }
  }
  function persist(next: string, id: number, signal?: AbortSignal) {
    check(id, signal)
    if (readRaw() !== raw) { sync(); throw failure('vault_changed') }
    try { storage!.setItem(storageKey, next) } catch { throw failure('vault_write_failed') }
    raw = next
  }
  async function operation(task: (id: number) => Promise<void>, signal?: AbortSignal) {
    assertActive(); signal?.throwIfAborted()
    if (!available) throw failure('vault_unavailable')
    if (busy) throw failure('vault_busy')
    const id = ++generation
    busy = true; error = ''; emit()
    try { await task(id); check(id, signal) }
    catch (cause) {
      const safe = signal?.aborted ? new DOMException('Device-vault operation cancelled. No new keys were saved.', 'AbortError')
        : Object.values(errors).includes((cause as Error)?.message as typeof errors[keyof typeof errors]) ? cause : failure('vault_invalid')
      if (id === generation && !destroyed && isActive()) { error = (safe as Error)?.message || errors.vault_invalid; emit() }
      throw safe
    } finally { if (id === generation) { busy = false; emit() } }
  }
  async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
    if (passphrase.length < 12 || passphrase.length > 256) throw failure('vault_password')
    const material = new TextEncoder().encode(passphrase)
    try {
      const imported = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey'])
      return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: VAULT_ITERATIONS }, imported,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    } finally { material.fill(0) }
  }
  async function seal(next: SavedConnections, key: CryptoKey, salt: Uint8Array<ArrayBuffer>) {
    const plain = new TextEncoder().encode(JSON.stringify({ version: 2, wallet: agentId, connections: next }))
    if (plain.length > MAX_PLAINTEXT) throw failure('vault_invalid')
    const iv = crypto.getRandomValues(new Uint8Array(12))
    try {
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(2), tagLength: 128 }, key, plain)
      return JSON.stringify({ version: 2, wallet: agentId, kdf: 'PBKDF2-SHA256', iterations: VAULT_ITERATIONS,
        salt: base64(salt), iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) })
    } finally { plain.fill(0) }
  }
  emit()
  return {
    storageKey, get active() { return !destroyed && isActive() }, getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    create(passphrase, signal) {
      return operation(async id => {
        if (readRaw() !== null) { sync(); throw failure('vault_changed') }
        const nextSalt = crypto.getRandomValues(new Uint8Array(32))
        const nextKey = await derive(passphrase, nextSalt)
        check(id, signal)
        const ciphertext = await seal({}, nextKey, nextSalt)
        persist(ciphertext, id, signal)
        key = nextKey; salt = nextSalt; saved = {}; emit()
      }, signal)
    },
    unlock(passphrase, signal) {
      return operation(async id => {
        key = null; salt = null; saved = {}; emit()
        const encrypted = readRaw()
        if (encrypted !== raw) { sync(); throw failure('vault_changed') }
        if (!encrypted || encrypted.length > MAX_RECORD) throw failure('vault_invalid')
        const record = object(JSON.parse(encrypted))
        fields(record, ['version', 'wallet', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext'])
        if (![1, 2].includes(record.version as number) || record.wallet !== agentId || record.kdf !== 'PBKDF2-SHA256' || record.iterations !== VAULT_ITERATIONS) throw failure('vault_invalid')
        const nextSalt = bytes(record.salt, 32), iv = bytes(record.iv, 12), ciphertext = bytes(record.ciphertext)
        if (ciphertext.length < 16 || ciphertext.length > MAX_PLAINTEXT + 16) throw failure('vault_invalid')
        const nextKey = await derive(passphrase, nextSalt)
        check(id, signal)
        const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(record.version as number), tagLength: 128 }, nextKey, ciphertext))
        try {
          check(id, signal)
          if (readRaw() !== encrypted) { sync(); throw failure('vault_changed') }
          const payload = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)))
          fields(payload, ['version', 'wallet', 'connections'])
          if (payload.version !== record.version || payload.wallet !== agentId) throw failure('vault_invalid')
          const clean = connections(payload.connections, record.version === 1)
          key = nextKey; salt = nextSalt; saved = clean; emit()
        } finally { plain.fill(0) }
      }, signal)
    },
    save(name, value, signal) {
      return operation(async id => {
        if (!key || !salt) throw failure('vault_locked')
        const profile = name === 'model' ? modelProfile(value) : null
        const next = connections(profile ? { ...saved, models: [...(saved.models || []).filter(item => item.profileId !== profile.profileId), profile] } : { ...saved, [name]: value })
        const ciphertext = await seal(next, key, salt)
        persist(ciphertext, id, signal)
        saved = next; emit()
      }, signal)
    },
    forgetModel(profileId, signal) {
      return operation(async id => {
        if (!key || !salt) throw failure('vault_locked')
        const next = connections({ ...saved, models: (saved.models || []).filter(profile => profile.profileId !== profileId) })
        const ciphertext = await seal(next, key, salt)
        persist(ciphertext, id, signal)
        saved = next; emit()
      }, signal)
    },
    readConnections() {
      assertActive()
      if (!key || busy) throw failure(busy ? 'vault_busy' : 'vault_locked')
      if (readRaw() !== raw) { sync(); throw failure('vault_changed') }
      return connections(saved)
    },
    lock,
    forget() {
      assertActive(); lock()
      try { storage!.removeItem(storageKey); raw = null; emit() }
      catch { error = errors.vault_forget_failed; emit(); throw failure('vault_forget_failed') }
    },
    sync,
    destroy() { destroyed = true; lock(); listeners.clear() },
  }
}
