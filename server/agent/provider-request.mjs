import { AppError } from '../safety.mjs'

const credentialHeaders = ['authorization', 'x-api-key', 'x-goog-api-key']
const headerHosts = {
  'http-referer': 'openrouter.ai', 'x-title': 'openrouter.ai',
  'openai-organization': 'api.openai.com', 'openai-project': 'api.openai.com',
  'anthropic-workspace-id': 'api.anthropic.com',
}
const headerError = () => new AppError('llm_not_configured', 'Provider header settings must contain only valid, non-secret attribution or provider organization/workspace headers. Client impersonation and credential overrides are not supported.', 503)

function checkedOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw headerError()
  const result = {}
  for (const [name, content] of Object.entries(value)) {
    const key = name.toLowerCase()
    if (!Object.hasOwn(headerHosts, key) || typeof content !== 'string' || !content.trim()
      || content.length > 1000 || /[^\x20-\x7e]/.test(content) || Object.hasOwn(result, key)) throw headerError()
    if (key === 'http-referer') {
      let url
      try { url = new URL(content) } catch { throw headerError() }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw headerError()
    }
    result[key] = content.trim()
  }
  return result
}

// Non-secret settings may cross the private worker IPC. Never forward the app's
// environment, incoming browser headers or any provider's credentials with them.
export function providerHeaderOverrides(env = {}) {
  if (!env.AGENT_LLM_EXTRA_HEADERS) return {}
  let value
  try { value = JSON.parse(env.AGENT_LLM_EXTRA_HEADERS) } catch { throw headerError() }
  return checkedOverrides(value)
}

export function providerHeaders(config, { env = {}, stream = false } = {}) {
  const host = new URL(config.baseUrl).hostname
  const headers = new Headers({ 'Content-Type': 'application/json', 'User-Agent': 'RecallLoop/0.2.0',
    Accept: stream ? 'text/event-stream' : 'application/json' })
  if (host === 'openrouter.ai') {
    headers.set('HTTP-Referer', 'http://localhost:3000')
    headers.set('X-Title', 'RecallLoop')
  }
  if (host === 'api.anthropic.com') headers.set('anthropic-version', '2023-06-01')
  const extra = config.extraHeaders === undefined ? providerHeaderOverrides(env) : checkedOverrides(config.extraHeaders)
  for (const [name, value] of Object.entries(extra)) {
    if (config.apiKey && value.includes(config.apiKey)) throw headerError()
    if (headerHosts[name] === host) headers.set(name, value)
  }
  return headers
}

// A catalogue is not a generation test. Only explicit capability metadata or a
// check for this exact model/protocol can disable tools; do not guess from names.
export function modelToolsEnabled(config, model = config?.model) {
  if (config?.toolsEnabled === false) return false
  const checked = config?.verification
  if (checked?.model === model && checked.apiStyle === config.apiStyle && checked.generation === 'verified') {
    if (checked.tools === 'verified') return true
    if (checked.tools === 'unsupported') return false
  }
  return config?.catalogue?.find(item => item.id === model)?.tools !== false
}

export function normalizeProviderPayload(input, config) {
  const payload = { ...input }
  const enabled = modelToolsEnabled(config, payload.model)
  if (!enabled) {
    delete payload.tools; delete payload.functions
    // A text-only request must not contain orphaned tool roles/results from an
    // adapter. Keep visible prose, never turn tool output into user instructions.
    if (Array.isArray(payload.messages)) payload.messages = payload.messages.filter(message => !['tool', 'function'].includes(message.role)).flatMap(message => {
      const { tool_calls: _calls, function_call: _call, ...plain } = message
      return plain.role === 'assistant' && !plain.content?.length ? [] : [plain]
    })
    if (Array.isArray(payload.input)) payload.input = payload.input.filter(item => !['function_call', 'function_call_output', 'reasoning'].includes(item.type))
  }
  if (!enabled || (!payload.tools?.length && !payload.functions?.length)) {
    delete payload.tool_choice; delete payload.function_call; delete payload.parallel_tool_calls
    if (!payload.tools?.length) delete payload.tools
    if (!payload.functions?.length) delete payload.functions
  }
  if (config.apiStyle === 'chat') {
    const host = new URL(config.baseUrl).hostname
    const modernOpenAi = host === 'api.openai.com' && /^(?:gpt-(?:[5-9]|[1-9]\d)|o[134])/.test(payload.model)
    if (modernOpenAi && payload.max_tokens !== undefined) {
      payload.max_completion_tokens = payload.max_completion_tokens ?? payload.max_tokens
      delete payload.max_tokens
    }
    if (host === 'generativelanguage.googleapis.com') {
      if (payload.max_completion_tokens !== undefined) {
        payload.max_tokens = payload.max_tokens ?? payload.max_completion_tokens
        delete payload.max_completion_tokens
      }
      delete payload.parallel_tool_calls
      // This is Google's documented OpenAI-compatible route: system messages
      // and Bearer auth belong together. Native systemInstruction is a different API.
    }
    // Claude's recent models reject non-default sampling settings. Let the
    // compatible endpoint use model defaults instead of SDK sampling heuristics.
    if (host === 'api.anthropic.com') { delete payload.temperature; delete payload.top_p }
  }
  return payload
}

// No client/key cache. Inject credentials only at dispatch, and release our
// mutable header references as soon as fetch settles (including abort/failure).
// Fetch/JS may make internal copies; this is not a claim of secure heap erasure.
export async function dispatchProviderRequest(url, options, config, fetchImpl = fetch) {
  const method = options.method || 'GET'
  if (!((method === 'GET' && url === `${config.baseUrl}/models`)
    || (method === 'POST' && url === `${config.baseUrl}/${config.apiStyle === 'responses' ? 'responses' : 'chat/completions'}`))) {
    throw new AppError('network_denied', 'Provider credentials are authorized only for the selected API endpoint and method.', 403)
  }
  const headers = new Headers(options.headers)
  for (const name of credentialHeaders) headers.delete(name)
  try {
    if (config.apiKey) {
      // Anthropic discovery uses the native Models API; generation uses its
      // documented Chat Completions compatibility endpoint.
      const target = new URL(url)
      const name = target.hostname === 'api.anthropic.com' && target.pathname === '/v1/models' ? 'x-api-key' : 'Authorization'
      headers.set(name, name === 'Authorization' ? `Bearer ${config.apiKey}` : config.apiKey)
    }
    return await fetchImpl(url, { ...options, headers, redirect: 'error' })
  } finally {
    for (const name of credentialHeaders) headers.delete(name)
  }
}
