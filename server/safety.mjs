export class AppError extends Error {
  constructor(code, message, status = 400, retryable = false) {
    super(message)
    Object.assign(this, { code, status, retryable })
  }
}

export function requireText(value, name, max, { pattern } = {}) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || (pattern && !pattern.test(value))) {
    throw new AppError('invalid_request', `${name} must be non-empty and at most ${max} characters${pattern ? ' with a valid format' : ''}.`)
  }
  return value.trim()
}

export function clampNumber(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

export function secretValues(extra = [], env = process.env) {
  const names = ['TATUM_API_KEY', 'MEMWAL_PRIVATE_KEY', 'MEMWAL_DELEGATE_KEY', 'AGENT_LLM_API_KEY',
    'RECALLLOOP_ADMIN_API_KEY', 'RECALLLOOP_WORKSPACE_TOKEN', 'OPENAI_API_KEY']
  const secrets = [...extra, ...names.map(name => env[name])]
  try { secrets.push(...Object.values(JSON.parse(env.RECALLLOOP_API_KEYS || '{}'))) } catch { /* handled by auth */ }
  return [...new Set(secrets.filter(value => typeof value === 'string' && value.length >= 8))].sort((a, b) => b.length - a.length)
}

function redactExact(text, secrets) {
  let result = String(text)
  for (const secret of secrets) result = result.split(secret).join('[REDACTED]')
  return result
}

export function redactSecrets(text, extra = [], env = process.env) {
  const result = redactExact(text, secretValues(extra, env))
  // Defence in depth for pasted credentials, not a DLP guarantee.
  return result.replace(/\b(?:sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{16,}|suiprivkey1[a-z0-9]{30,})\b/g, '[REDACTED]')
}

// Scrub values before JSON encoding, including secrets containing quotes or backslashes.
export function redactValue(value, extra = [], env = process.env) {
  if (typeof value === 'string') return redactSecrets(value, extra, env)
  if (Array.isArray(value)) return value.map(item => redactValue(item, extra, env))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, extra, env)]))
  return value
}

// Never release a suffix that could be the beginning of a credential in the next delta.
// Typical text is emitted immediately; only incomplete secret/token prefixes are held.
export function createStreamRedactor(extra = [], env = process.env) {
  const secrets = secretValues(extra, env)
  let pending = ''
  function push(text, final = false) {
    pending = redactExact(pending + text, secrets)
    let cut = pending.length
    if (!final) {
      for (const prefix of [...secrets, 'sk-', 'suiprivkey1']) {
        for (let length = Math.min(prefix.length - 1, pending.length); length > 0; length--) {
          if (pending.endsWith(prefix.slice(0, length))) { cut = Math.min(cut, pending.length - length); break }
        }
      }
      const token = /\b(?:sk-[A-Za-z0-9_-]*|suiprivkey1[a-z0-9]*)$/.exec(pending)
      if (token) cut = Math.min(cut, token.index)
    }
    const ready = redactSecrets(pending.slice(0, cut), extra, env)
    pending = pending.slice(cut)
    return ready
  }
  return { push, finish: () => push('', true) }
}

export function publicError(error) {
  return { success: false, code: error instanceof AppError ? error.code : 'service_unavailable',
    error: error instanceof AppError ? redactSecrets(error.message) : 'The service could not complete this request. Check configuration and try again.',
    retryable: error instanceof AppError ? error.retryable : true }
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

export async function within(promise, timeoutMs, fallback, signal) {
  let timer
  let onAbort
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), timeoutMs) })
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason || new DOMException('Stopped', 'AbortError'))
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
  try { return await Promise.race([promise, timeout, aborted]) }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
}
