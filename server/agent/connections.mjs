import { randomUUID } from 'node:crypto'
import { AppError, requireText, redactSecrets } from '../safety.mjs'

export const MAX_MODEL_CONNECTIONS = 12
export const LOCAL_OLLAMA_ID = 'local-ollama'
export const LOCAL_OLLAMA_BASE = 'http://127.0.0.1:11434/v1'
export const PROVIDER_HOSTS = ['api.openai.com', 'api.anthropic.com', 'openrouter.ai', 'api.groq.com', 'api.together.xyz',
  'api.deepseek.com', 'generativelanguage.googleapis.com', 'agentrouter.org', 'api.mistral.ai', 'api.fireworks.ai', 'router.huggingface.co']

export function validateProviderUrl(value, env = process.env) {
  let url
  try { url = new URL(value) } catch { throw new AppError('invalid_request', 'Provide a valid model API base URL.') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const allowed = new Set([...PROVIDER_HOSTS, ...(env.AGENT_LLM_ALLOWED_HOSTS || '').split(',').map(host => host.trim()).filter(Boolean)])
  if (url.username || url.password || url.search || url.hash || /[%\\]/.test(url.pathname)) {
    throw new AppError('invalid_request', 'Model URLs cannot contain credentials, query strings, fragments, or encoded paths.')
  }
  if (/\/(?:responses|chat\/completions|models|messages)\/?$/.test(url.pathname)) {
    throw new AppError('invalid_request', 'Use the model API base URL, not a full /responses, /chat/completions, /models, or /messages endpoint.')
  }
  if (local) {
    if (env.NODE_ENV === 'production' && env.AGENT_LLM_ALLOW_LOCAL !== 'true') throw new AppError('invalid_request', 'Local model endpoints are disabled in production.')
    if (!['http:', 'https:'].includes(url.protocol) || String(url.port || (url.protocol === 'https:' ? 443 : 80)) === String(env.PORT || 3000)) {
      throw new AppError('invalid_request', 'Use a local model server port, not the RecallLoop app port.')
    }
  } else if (url.protocol !== 'https:' || !allowed.has(url.hostname) || (url.port && url.port !== '443')) {
    throw new AppError('invalid_request', 'Use a supported HTTPS provider or add its hostname to AGENT_LLM_ALLOWED_HOSTS on the server.')
  }
  if (url.hostname === 'generativelanguage.googleapis.com' && url.pathname.replace(/\/+$/, '') !== '/v1beta/openai') {
    throw new AppError('provider_protocol_unsupported', 'Use the Gemini API base https://generativelanguage.googleapis.com/v1beta/openai with Chat Completions. Native generateContent URLs require a different payload and are not supported by this connector.')
  }
  if (url.hostname === 'api.anthropic.com' && url.pathname.replace(/\/+$/, '') !== '/v1') {
    throw new AppError('provider_protocol_unsupported', 'Use the Anthropic API base https://api.anthropic.com/v1 with Chat Completions compatibility. Native /messages payloads are not supported by this connector.')
  }
  if (url.hostname === 'openrouter.ai' && url.pathname.replace(/\/+$/, '') !== '/api/v1') {
    throw new AppError('provider_protocol_unsupported', 'Use the OpenRouter API base https://openrouter.ai/api/v1, including /api/v1 rather than the website root.')
  }
  return url.toString().replace(/\/+$/, '')
}

export function validateProviderProtocol(baseUrl, apiStyle) {
  if (!['chat', 'responses'].includes(apiStyle)) throw new AppError('invalid_request', 'apiStyle must be chat or responses.')
  if (new URL(baseUrl).hostname === 'generativelanguage.googleapis.com' && apiStyle !== 'chat') {
    throw new AppError('provider_protocol_unsupported', 'Select Chat Completions for Gemini’s OpenAI-compatible endpoint. It accepts system messages; native systemInstruction payloads use a different API.')
  }
  if (new URL(baseUrl).hostname === 'api.anthropic.com' && apiStyle !== 'chat') {
    throw new AppError('provider_protocol_unsupported', 'Select Chat Completions for Anthropic’s compatibility endpoint. Responses and native Messages use different APIs.')
  }
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

function providerCredentials(input, env) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('invalid_request', 'Provide a model connection object.')
  const baseUrl = validateProviderUrl(requireText(input.baseUrl, 'baseUrl', 500), env)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname)
  const apiKey = local && !input.apiKey ? '' : requireText(input.apiKey, 'apiKey', 4096)
  if (apiKey && apiKey.length < 8) throw new AppError('invalid_request', 'Model API keys must contain at least 8 characters.')
  if (/[\r\n]/.test(apiKey)) throw new AppError('invalid_request', 'API keys cannot contain newlines.')
  if (/[^\x21-\x7e]/.test(apiKey)) throw new AppError('invalid_request', 'API keys must use printable ASCII without spaces.')
  return { baseUrl, apiKey }
}

// Discovery is an authenticated read, not a connection or a generation grant.
// No placeholder model is needed, and these credentials are never installed.
export function validateModelDiscovery(input, env = process.env) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(name => !['baseUrl', 'apiKey', 'apiStyle'].includes(name))) {
    throw new AppError('invalid_request', 'Provide only the provider base URL, temporary API key and optional protocol for model discovery.')
  }
  const credentials = providerCredentials(input, env)
  const apiStyle = input.apiStyle ?? 'chat'
  validateProviderProtocol(credentials.baseUrl, apiStyle)
  return { ...credentials, mode: 'live', model: '', models: [], apiStyle, toolsEnabled: false, source: 'browser-session' }
}

export function validateConnection(input, env = process.env) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('invalid_request', 'Provide a model connection object.')
  if (Object.keys(input).some(name => !['mode', 'baseUrl', 'apiKey', 'model', 'apiStyle', 'toolsEnabled', 'checkCapabilities', 'profileId', 'profileName'].includes(name))) throw new AppError('invalid_request', 'Unknown model connection field.')
  if (input.mode === 'mock') return { id: 'scripted-mock', name: 'Scripted mock', mode: 'mock', model: 'recallloop-mock', models: ['recallloop-mock'], apiKey: '', baseUrl: '', apiStyle: 'chat', toolsEnabled: true, source: 'browser-session' }
  const { baseUrl, apiKey } = providerCredentials(input, env)
  const id = input.profileId === undefined ? undefined : modelConnectionId(input.profileId)
  const name = input.profileName === undefined || input.profileName === '' ? '' : requireText(input.profileName, 'profileName', 80)
  if (/[\x00-\x1f\x7f]/.test(name) || (apiKey && (name.includes(apiKey) || id?.includes(apiKey)))) throw new AppError('invalid_request', 'Provider profile names and IDs must not contain credentials or control characters.')
  if ([LOCAL_OLLAMA_ID, 'scripted-mock'].includes(id)) throw new AppError('invalid_request', 'This profile ID is reserved. Add your own provider profile instead.')
  const model = requireText(input.model, 'model', 128, { pattern: /^[A-Za-z0-9._:/@+-]+$/ })
  if ([name, id || '', model, baseUrl].some(value => redactSecrets(value, [apiKey], env) !== value)) throw new AppError('invalid_request', 'Provider metadata must not contain credentials.')
  validateProviderProtocol(baseUrl, input.apiStyle)
  if (input.toolsEnabled !== undefined && typeof input.toolsEnabled !== 'boolean') throw new AppError('invalid_request', 'toolsEnabled must be a boolean.')
  if (input.checkCapabilities !== undefined && typeof input.checkCapabilities !== 'boolean') throw new AppError('invalid_request', 'checkCapabilities must be a boolean.')
  return { ...(id ? { id } : {}), name, mode: 'live', baseUrl, apiKey, model, models: [model], apiStyle: input.apiStyle,
    toolsEnabled: input.toolsEnabled !== false, source: 'browser-session' }
}

export function modelConnectionId(value) {
  return requireText(value, 'connectionId', 80, { pattern: /^[A-Za-z0-9_-]+$/ })
}

// Only server-discovered cost metadata is exposed; provider labels are never
// trusted, and IDs containing a submitted credential are not advertised.
export function publicModels(config) {
  const metadata = new Map((config.catalogue || []).map(item => [item.id, item]))
  const openrouter = config.baseUrl === 'https://openrouter.ai/api/v1'
  const detectedLocal = config.source === 'local-discovery' && config.baseUrl === LOCAL_OLLAMA_BASE
  return [...new Set(config.models || [])].filter(id => typeof id === 'string' && /^[A-Za-z0-9._:/@+-]{1,128}$/.test(id)
    && (!config.apiKey || !id.includes(config.apiKey))).slice(0, 100).map(id => {
    const item = metadata.get(id), cost = item?.cost
    return { id, label: id, ...(cost === 'provider-free' && openrouter ? { cost } : cost === 'local' && detectedLocal ? { cost } : {}),
      ...(openrouter && typeof item?.tools === 'boolean' ? { tools: item.tools } : {}) }
  })
}

export function publicConnection(config) {
  const verified = config.verification?.generation === 'verified' && config.verification.model === config.model
    && config.verification.apiStyle === config.apiStyle && !config.lastVerificationFailure
  return { ...(config.id ? { id: config.id } : {}), ...(config.name ? { name: config.name } : {}), mode: config.mode, model: config.model, models: publicModels(config),
    apiStyle: config.apiStyle, baseUrl: config.baseUrl, toolsEnabled: config.toolsEnabled,
    source: config.source, verified: Boolean(verified), verification: config.verification || null,
    lastVerificationFailure: config.lastVerificationFailure || null, expiresAt: config.expiresAt || null }
}

export function createConnectionStore({ clock = () => Date.now() } = {}) {
  function active(req) {
    const session = req.workspaceSession
    if (!session || session.disposed || session.expiresAt <= clock() || session.kind === 'challenge') throw new AppError('wallet_required', 'Sign in with your wallet first.', 401)
    return session
  }
  function profiles(session) {
    session.modelConnections ||= new Map()
    // Legacy in-process callers may still initialise the single config slot.
    if (session.config && ![...session.modelConnections.values()].includes(session.config)) {
      session.config.id ||= 'legacy-session'
      session.modelConnections.set(session.config.id, session.config)
    }
    return session.modelConnections
  }
  const fallback = session => serverLlmConfig(session.kind === 'demo' ? { RECALLLOOP_LLM_MODE: 'mock' } : {})
  function middleware(req, _res, next) {
    try {
      const session = active(req)
      profiles(session)
      req.llmConfig = session.config || fallback(session)
      next()
    } catch (error) { next(error) }
  }
  function admit(req, config) {
    const saved = profiles(active(req))
    config.id ||= randomUUID()
    modelConnectionId(config.id)
    if (!saved.has(config.id) && saved.size >= MAX_MODEL_CONNECTIONS) throw new AppError('connection_limit', `Keep at most ${MAX_MODEL_CONNECTIONS} provider profiles connected. Disconnect one before adding another.`, 409)
    return config
  }
  function connect(req, config, { select = true } = {}) {
    const session = active(req), saved = profiles(session)
    admit(req, config)
    const previous = saved.get(config.id)
    const installed = { ...config, expiresAt: new Date(session.expiresAt).toISOString() }
    saved.set(config.id, installed)
    if (select || !session.config || session.config === previous) session.config = installed
    if (previous) previous.apiKey = ''
    return publicConnection(installed)
  }
  function select(req, id) {
    const session = active(req), saved = profiles(session)
    if (id !== undefined) {
      const config = saved.get(modelConnectionId(id))
      if (!config) throw new AppError('connection_not_found', 'This provider profile is no longer connected in this wallet session. Select a current profile.', 409)
      return config
    }
    // Never resolve a duplicate model ID against whichever key was connected last.
    if (saved.size > 1) throw new AppError('connection_required', 'Select a provider profile as well as a model for this request.', 400)
    return session.config || fallback(session)
  }
  function list(req) {
    const session = active(req), saved = profiles(session)
    return saved.size ? [...saved.values()].map(publicConnection) : session.kind === 'demo' ? [publicConnection(fallback(session))] : []
  }
  function disconnect(req, id) {
    const session = active(req), saved = profiles(session), config = select(req, id)
    if (config.id) saved.delete(config.id)
    config.apiKey = ''
    if (session.config === config) session.config = [...saved.values()].at(-1) || null
  }
  return { middleware, admit, connect, select, list, disconnect }
}
