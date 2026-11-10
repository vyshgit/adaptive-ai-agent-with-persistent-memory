import type { Connection, WorkspaceMode } from './types.ts'
import type { WorkspaceCache } from './workspaceCache.ts'
import { redactBrowserText, scopedCacheKey } from './clientSafety.ts'
import { PROVIDERS, providerForUrl } from './providers.ts'

export const PREFERENCES_KEY = 'recallloop.preferences.v1'
const MAX_CACHE_CHARS = 16_000

export interface ProviderPreference {
  baseUrl: string
  apiStyle: 'chat' | 'responses'
  model?: string
}
export interface ModelPreference extends ProviderPreference { model: string; connectionId?: string }
export interface WorkspacePreferences {
  autoMemory?: boolean
  provider?: string
  providers?: Record<string, ProviderPreference>
  accountId?: string
  conversation?: { sidebar?: boolean; mode?: WorkspaceMode; stream?: boolean; model?: ModelPreference }
}
export type UpdatePreferences = (change: (current: WorkspacePreferences) => WorkspacePreferences) => void

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function safeText(value: unknown, max: number) {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) && redactBrowserText(value) === value ? value.trim() : null
}
function safeUrl(value: unknown) {
  const text = safeText(value, 512)
  if (!text || /[\s%\\]/.test(text)) return null
  try {
    const url = new URL(text)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null
    return text.replace(/\/+$/, '')
  } catch { return null }
}
function safeModel(value: unknown) {
  const text = safeText(value, 128)
  return text && /^[A-Za-z0-9._:/@+-]+$/.test(text) && !/^(?:0x)?[a-f\d]{64}$/i.test(text) ? text : undefined
}
function safePath(value: unknown) {
  const text = safeText(value, 240)
  return text && /^[A-Za-z0-9._/ -]+$/.test(text) && !text.startsWith('/') && !text.split('/').some(part => !part || part === '..') ? text : undefined
}
function providerPreference(value: unknown): ProviderPreference | undefined {
  const raw = record(value), baseUrl = safeUrl(raw.baseUrl)
  if (!baseUrl || (raw.apiStyle !== 'chat' && raw.apiStyle !== 'responses')) return undefined
  const model = safeModel(raw.model)
  return { baseUrl, apiStyle: raw.apiStyle, ...(model ? { model } : {}) }
}
function modelPreference(value: unknown): ModelPreference | undefined {
  const clean = providerPreference(value)
  const id = safeText(record(value).connectionId, 80)
  // A malformed supplied identity must not downgrade to a provider-only match.
  if (record(value).connectionId !== undefined && (!id || !/^[A-Za-z0-9_-]+$/.test(id))) return undefined
  return clean?.model ? { ...clean, model: clean.model, ...(id ? { connectionId: id } : {}) } : undefined
}

// A closed allowlist, not a generic variable dump. Never cache passwords,
// catalogues/verification, command text, source, task drafts, recalled data or
// execution/raw-memory consent. Automatic recall/capture are non-secret settings.
// Everything read back is an untrusted UI preference, never execution authority.
export function normalisePreferences(value: unknown): WorkspacePreferences {
  const raw = record(value), clean: WorkspacePreferences = {}
  if (typeof raw.autoMemory === 'boolean') clean.autoMemory = raw.autoMemory
  if (PROVIDERS.some(provider => provider.id === raw.provider)) clean.provider = raw.provider as string
  const providers: Record<string, ProviderPreference> = {}
  for (const provider of PROVIDERS) {
    const config = providerPreference(record(raw.providers)[provider.id])
    if (config) providers[provider.id] = config
  }
  if (Object.keys(providers).length) clean.providers = providers
  const accountId = safeText(raw.accountId, 66)
  if (accountId && /^0x[a-f\d]{1,64}$/i.test(accountId)) clean.accountId = accountId
  const conversation = record(raw.conversation), hosted: NonNullable<WorkspacePreferences['conversation']> = {}
  if (typeof conversation.sidebar === 'boolean') hosted.sidebar = conversation.sidebar
  if (typeof conversation.stream === 'boolean') hosted.stream = conversation.stream
  if (conversation.mode === 'talk' || conversation.mode === 'plan' || conversation.mode === 'build') hosted.mode = conversation.mode
  const hostedModel = modelPreference(conversation.model)
  if (hostedModel) hosted.model = hostedModel
  if (Object.keys(hosted).length) clean.conversation = hosted
  return clean
}

export function preferredModel(connection: Connection | undefined, preference: ModelPreference | undefined) {
  return connection && preference && safeUrl(connection.baseUrl) === preference.baseUrl && connection.apiStyle === preference.apiStyle
    && (!connection.id ? !preference.connectionId : connection.id === preference.connectionId)
    && connection.models.some(item => item.id === preference.model) ? preference.model : connection?.model || connection?.models[0]?.id || ''
}

export function connectionPreference(connection: Connection, model: string): ModelPreference {
  return { baseUrl: connection.baseUrl, apiStyle: connection.apiStyle, model, ...(connection.id ? { connectionId: connection.id } : {}) }
}

export function preferredConnection(connections: Connection[], fallback: Connection | undefined, preference: ModelPreference | undefined) {
  return connections.find(connection => preference && (connection.id ? connection.id === preference.connectionId : !preference.connectionId && connections.length === 1)
    && safeUrl(connection.baseUrl) === preference.baseUrl && connection.apiStyle === preference.apiStyle)
    || connections.find(connection => connection.id === fallback?.id && connection.baseUrl === fallback?.baseUrl && connection.apiStyle === fallback?.apiStyle)
    || connections[0]
}

export function providerSetup(connection: Connection | undefined, preferences: WorkspacePreferences) {
  const live = connection?.mode === 'live' ? connection : undefined
  const preset = PROVIDERS.find(provider => provider.id === preferences.provider)
    || (live ? providerForUrl(live.baseUrl) : PROVIDERS[0])
  const saved = preferences.providers?.[preset.id]
  const matches = live && preset.id === providerForUrl(live.baseUrl).id && (!saved || (saved.baseUrl === safeUrl(live.baseUrl) && saved.apiStyle === live.apiStyle))
  return { preset: preset.id, baseUrl: saved?.baseUrl ?? (matches ? live.baseUrl : preset.baseUrl),
    apiStyle: saved?.apiStyle ?? (matches ? live.apiStyle : preset.apiStyle), model: saved?.model ?? (matches ? live.model : '') }
}

export function loadPreferences(cache: WorkspaceCache): WorkspacePreferences {
  if (!cache.active || !cache.storage) return {}
  const key = scopedCacheKey(PREFERENCES_KEY, cache.scope)
  try {
    const value = cache.storage.getItem(key)
    if (!value) return {}
    if (value.length > MAX_CACHE_CHARS) throw new Error('oversized preferences')
    const parsed = JSON.parse(value)
    if (parsed?.version !== 1) throw new Error('unknown preferences version')
    const clean = normalisePreferences(parsed.preferences)
    // Remove unsupported fields rather than leaving an opaque blob in storage.
    const serialised = JSON.stringify({ version: 1, preferences: clean })
    if (serialised !== value) {
      try { cache.storage.setItem(key, serialised) } catch { try { cache.storage.removeItem(key) } catch { /* blocked cleanup */ } }
    }
    return clean
  } catch {
    try { cache.storage.removeItem(key) } catch { /* unavailable storage remains page-only */ }
    return {}
  }
}
export function savePreferences(preferences: WorkspacePreferences, cache: WorkspaceCache) {
  if (!cache.active || !cache.storage) return false
  try {
    cache.storage.setItem(scopedCacheKey(PREFERENCES_KEY, cache.scope), JSON.stringify({ version: 1, preferences: normalisePreferences(preferences) }))
    return true
  } catch { return false }
}
export function clearPreferences(cache: WorkspaceCache) {
  if (!cache.active || !cache.storage) return false
  try { cache.storage.removeItem(scopedCacheKey(PREFERENCES_KEY, cache.scope)); return true } catch { return false }
}
