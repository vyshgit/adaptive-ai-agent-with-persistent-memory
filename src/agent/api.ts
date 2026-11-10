import { clearBrowserSecrets, redactBrowserText, registerBrowserSecret } from './clientSafety.ts'

// Session auth stays in memory. Plaintext credentials never belong in
// chat/project caches; the optional encrypted device vault is a separate surface.
let sessionTag = ''
export function setSessionTag(tag: string | null) { sessionTag = tag || '' }
export function resetSessionSecrets() { clearBrowserSecrets() }

export function agentFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (sessionTag) headers.set('X-RecallLoop-Session', sessionTag)
  return fetch(`/api/agent${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' })
}

export async function responseError(response: Response) {
  let message = `The server returned HTTP ${response.status}.`
  let retryable = response.status >= 500 || [408, 429].includes(response.status)
  let code = ''
  try {
    const data = await response.json()
    if (data.code === 'wallet_required' || data.code === 'session_changed') window.dispatchEvent(new Event('recallloop-auth-changed'))
    if (typeof data.error === 'string') message = data.error
    if (typeof data.retryable === 'boolean') retryable = data.retryable
    if (typeof data.code === 'string' && /^[a-z0-9_]{1,64}$/.test(data.code)) code = data.code
  } catch { /* Do not render upstream HTML or debug output. */ }
  return Object.assign(new Error(redactBrowserText(message)), { retryable, code })
}

export async function agentJson<T>(path: string, init: RequestInit = {}, timeoutMs = 25_000): Promise<T> {
  const response = await agentFetch(path, { ...init, signal: init.signal || AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw await responseError(response)
  return response.json() as Promise<T>
}

export async function readAgentSse(response: Response, onEvent: (type: string, data: unknown) => void, signal?: AbortSignal) {
  if (!response.body) throw new Error('The server returned an empty stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let frames = 0
  function parse(frame: string) {
    const lines = frame.split(/\r?\n/)
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message'
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (data) onEvent(event, JSON.parse(data))
  }
  try {
    for (;;) {
      signal?.throwIfAborted()
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let boundary
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        if (boundary.index > 300_000 || ++frames > 15_000) throw new Error('The stream exceeded the client frame limit.')
        parse(buffer.slice(0, boundary.index))
        buffer = buffer.slice(boundary.index + boundary[0].length)
      }
      if (buffer.length > 300_000) throw new Error('A stream frame exceeded the client size limit.')
      if (done) { if (buffer.trim()) parse(buffer); break }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
