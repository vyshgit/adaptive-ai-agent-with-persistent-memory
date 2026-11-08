// Best-effort protection for accidentally pasted common keys. Not a DLP guarantee.
// Connection form values are never written to any browser storage.
const knownSecrets = new Set<string>()
export function registerBrowserSecret(value: string) { if (value.trim().length >= 8 && value.length <= 4096) knownSecrets.add(value.trim()) }
export function clearBrowserSecrets() { knownSecrets.clear() }
export function redactBrowserText(text: string) {
  let clean = text
  for (const key of [...knownSecrets].sort((a, b) => b.length - a.length)) clean = clean.split(key).join('[REDACTED]')
  return clean.replace(/\b(?:sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{16,}|suiprivkey1[a-z0-9]{30,})\b/g, '[REDACTED]')
}

export function redactBrowserValue<T>(value: T): T {
  if (typeof value === 'string') return redactBrowserText(value) as T
  if (Array.isArray(value)) return value.map(item => redactBrowserValue(item)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactBrowserValue(item)])) as T
  return value
}

export function scopedCacheKey(base: string, scope: string) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(scope)) throw new Error('Invalid browser cache identity.')
  return `${base}:${scope}`
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() || `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export interface CacheStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function browserStorage(): CacheStorage | null {
  try { return globalThis.localStorage || null } catch { return null }
}

export function flushCacheOnExit(flush: () => void, page: EventTarget = window,
  visibility: EventTarget & { readonly visibilityState: string } = document) {
  // Browser navigation does not run React cleanup. Flush before pending autosave
  // is lost, and remove old wallet listeners before its redaction set is cleared.
  const hidden = () => { if (visibility.visibilityState === 'hidden') flush() }
  page.addEventListener('pagehide', flush)
  visibility.addEventListener('visibilitychange', hidden)
  return () => {
    page.removeEventListener('pagehide', flush)
    visibility.removeEventListener('visibilitychange', hidden)
    flush()
  }
}

export function downloadText(name: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
