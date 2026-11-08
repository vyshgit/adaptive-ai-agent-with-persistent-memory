import { AppError, requireText } from '../safety.mjs'

export const PROVIDER_HOSTS = ['api.openai.com', 'openrouter.ai', 'api.groq.com', 'api.together.xyz',
  'api.deepseek.com', 'generativelanguage.googleapis.com', 'agentrouter.org', 'api.mistral.ai', 'api.fireworks.ai']

export function validateProviderUrl(value, env = process.env) {
  let url
  try { url = new URL(value) } catch { throw new AppError('invalid_request', 'Provide a valid model API base URL.') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const allowed = new Set([...PROVIDER_HOSTS, ...(env.AGENT_LLM_ALLOWED_HOSTS || '').split(',').map(host => host.trim()).filter(Boolean)])
  if (url.username || url.password || url.search || url.hash || /[%\\]/.test(url.pathname)) {
    throw new AppError('invalid_request', 'Model URLs cannot contain credentials, query strings, fragments, or encoded paths.')
  }
  if (local) {
    if (env.NODE_ENV === 'production' && env.AGENT_LLM_ALLOW_LOCAL !== 'true') throw new AppError('invalid_request', 'Local model endpoints are disabled in production.')
    if (!['http:', 'https:'].includes(url.protocol) || String(url.port || (url.protocol === 'https:' ? 443 : 80)) === String(env.PORT || 3000)) {
      throw new AppError('invalid_request', 'Use a local model server port, not the RecallLoop app port.')
    }
  } else if (url.protocol !== 'https:' || !allowed.has(url.hostname) || (url.port && url.port !== '443')) {
    throw new AppError('invalid_request', 'Use a supported HTTPS provider or add its hostname to AGENT_LLM_ALLOWED_HOSTS on the server.')
  }
  return url.toString().replace(/\/+$/, '')
}

export function serverLlmConfig(env = process.env) {
  const requested = env.RECALLLOOP_LLM_MODE || (env.AGENT_LLM_API_KEY ? 'live' : 'unconfigured')
  const mode = ['live', 'mock', 'unconfigured'].includes(requested) ? requested : 'unconfigured'
  if (mode === 'mock') return { mode, baseUrl: '', apiKey: '', model: 'recallloop-mock', models: ['recallloop-mock'],
    apiStyle: 'chat', toolsEnabled: env.AGENT_LLM_TOOLS !== 'off', source: 'environment' }
  return { mode, baseUrl: env.AGENT_LLM_BASE_URL || 'https://api.openai.com/v1', apiKey: env.AGENT_LLM_API_KEY || '',
    model: env.AGENT_LLM_MODEL || (mode === 'mock' ? 'recallloop-mock' : ''),
    models: (env.AGENT_MODELS || env.AGENT_LLM_MODEL || (mode === 'mock' ? 'recallloop-mock' : '')).split(',').map(id => id.trim()).filter(Boolean),
    apiStyle: env.AGENT_LLM_API_STYLE || 'responses', toolsEnabled: env.AGENT_LLM_TOOLS !== 'off', source: 'environment' }
}

export function validateConnection(input, env = process.env) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('invalid_request', 'Provide a model connection object.')
  if (input.mode === 'mock') return { mode: 'mock', model: 'recallloop-mock', models: ['recallloop-mock'], apiKey: '', baseUrl: '', apiStyle: 'chat', toolsEnabled: true, source: 'browser-session' }
  const baseUrl = validateProviderUrl(requireText(input.baseUrl, 'baseUrl', 500), env)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname)
  const apiKey = local && !input.apiKey ? '' : requireText(input.apiKey, 'apiKey', 4096)
  if (apiKey && apiKey.length < 8) throw new AppError('invalid_request', 'Model API keys must contain at least 8 characters.')
  if (/[\r\n]/.test(apiKey)) throw new AppError('invalid_request', 'API keys cannot contain newlines.')
  if (/[^\x21-\x7e]/.test(apiKey)) throw new AppError('invalid_request', 'API keys must use printable ASCII without spaces.')
  const model = requireText(input.model, 'model', 128, { pattern: /^[A-Za-z0-9._:/@+-]+$/ })
  if (!['chat', 'responses'].includes(input.apiStyle)) throw new AppError('invalid_request', 'apiStyle must be chat or responses.')
  if (input.toolsEnabled !== undefined && typeof input.toolsEnabled !== 'boolean') throw new AppError('invalid_request', 'toolsEnabled must be a boolean.')
  return { mode: 'live', baseUrl, apiKey, model, models: [model], apiStyle: input.apiStyle,
    toolsEnabled: input.toolsEnabled !== false, source: 'browser-session' }
}

export function publicConnection(config) {
  return { mode: config.mode, model: config.model, models: config.models.map(id => ({ id, label: id })),
    apiStyle: config.apiStyle, baseUrl: config.baseUrl, toolsEnabled: config.toolsEnabled,
    source: config.source, verified: config.verified || false, expiresAt: config.expiresAt || null }
}

export function createConnectionStore({ clock = () => Date.now() } = {}) {
  function middleware(req, _res, next) {
    const session = req.workspaceSession
    if (!session || session.disposed || session.expiresAt <= clock() || session.kind === 'challenge') return next(new AppError('wallet_required', 'Sign in with your wallet first.', 401))
    req.llmConfig = session.config || serverLlmConfig(session.kind === 'demo' ? { RECALLLOOP_LLM_MODE: 'mock' } : {})
    next()
  }
  function connect(req, config) {
    const expiresAt = new Date(req.workspaceSession.expiresAt).toISOString()
    if (req.workspaceSession.config) req.workspaceSession.config.apiKey = ''
    req.workspaceSession.config = { ...config, expiresAt }
    return publicConnection(req.workspaceSession.config)
  }
  function disconnect(req) { if (req.workspaceSession.config) req.workspaceSession.config.apiKey = ''; req.workspaceSession.config = null }
  return { middleware, connect, disconnect }
}
