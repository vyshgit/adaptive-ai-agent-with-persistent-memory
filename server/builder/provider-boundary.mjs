import { AppError, redactValue } from '../safety.mjs'
import { readLimitedText } from '../agent/sse.mjs'
import { providerFailure, providerErrorStatus, providerNetworkFailure } from '../agent/provider-errors.mjs'
import { readThoughtSignature } from '../agent/tool-signatures.mjs'
import { providerHeaders, normalizeProviderPayload } from '../agent/provider-request.mjs'
import { validateProviderProtocol } from '../agent/connections.mjs'
import { BUILDER_LIMITS } from './policy.mjs'

const toolNames = new Set(['list_files', 'read_file', 'search_files', 'propose_file', 'run_command'])
const denied = message => new AppError('network_denied', message, 403)

export function redactModelMessages(messages, secrets) {
  const clean = redactValue(messages, secrets, {})
  // The V2 context hook receives LLM.Message, not persisted SessionMessage:
  // assistant content[].type="tool-call". The installed compatible provider's
  // configure() namespaces metadata as "openai-compatible" (Route.with changes
  // the base route's "openai" key). Real SDK replay is covered by an offline test.
  const key = 'openai-compatible'
  for (const [i, message] of messages.entries()) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const [j, part] of message.content.entries()) {
      if (part.type !== 'tool-call' || part.providerMetadata?.[key]?.extraContent === undefined) continue
      const signature = readThoughtSignature(part.providerMetadata[key].extraContent)
      const metadata = clean[i].content[j].providerMetadata[key]
      delete metadata.extraContent
      // Restore only this bounded opaque field; input, text, results and every
      // other metadata value remain redacted. It never crosses the worker IPC.
      if (signature !== undefined) metadata.extraContent = { google: { thought_signature: signature } }
    }
  }
  return clean
}

export function sdkProviderFailure(failure, baseUrl) {
  if (!failure || !failure.type?.startsWith('provider.')) return null
  const body = typeof failure.response?.body === 'string' ? failure.response.body.slice(0, 100_000) : ''
  let envelope
  try { const value = JSON.parse(body); envelope = value?.error || value?.response?.error } catch { /* fixed diagnostics below */ }
  const status = providerErrorStatus(envelope, providerErrorStatus(failure, envelope || failure.type === 'provider.invalid-request' ? 400 : null))
  if (status) return providerFailure(status, body || failure.message, baseUrl)
  if (failure.type === 'provider.timeout') return providerNetworkFailure({ aborted: true })
  if (failure.type === 'provider.transport') return providerNetworkFailure()
  if (failure.type === 'provider.invalid-output') return new AppError('provider_invalid_response', 'The provider returned malformed or incomplete model output. Check the selected protocol and model capabilities in Settings.', 502)
  return null
}

// This is an application-level fetch boundary, not an OS/network sandbox for
// approved native commands. No discovery, redirects, websocket, OAuth or shared
// OpenCode-service request is admitted through it.
export async function modelRequest(request, connection) {
  const responses = connection?.apiStyle === 'responses'
  const endpoint = connection ? `${connection.baseUrl}/${responses ? 'responses' : 'chat/completions'}` : ''
  if (!connection || request.method !== 'POST' || request.url !== endpoint) throw denied('No outbound engine request is authorized for this endpoint.')
  validateProviderProtocol(connection.baseUrl, connection.apiStyle)
  let payload
  try { payload = JSON.parse(await readLimitedText(request, 512_000)) }
  catch { throw denied('The selected model request was not bounded valid JSON.') }
  if (!payload || Array.isArray(payload) || payload.model !== connection.model || payload.stream !== true) {
    throw denied('Only a streamed request to the explicitly selected model is authorized.')
  }
  if (payload.previous_response_id !== undefined || payload.conversation !== undefined
    || payload.background === true || payload.context_management !== undefined) {
    throw denied('Provider-stored conversation references and automatic paid compaction are disabled. Start a fresh local task.')
  }
  payload.store = false
  payload.parallel_tool_calls = false
  if ((payload.tools !== undefined && !Array.isArray(payload.tools)) || payload.functions !== undefined) {
    throw denied('Only the registered function-tool array is authorized.')
  }
  for (const tool of payload.tools || []) {
    if (tool.type !== 'function' || !toolNames.has(responses ? tool.name : tool.function?.name)) {
      throw denied('Only the bounded RecallLoop tools are authorized; provider-hosted tools are disabled.')
    }
  }
  if (responses) {
    if (!Array.isArray(payload.input) || payload.input.some(item => !item || !['message', 'function_call', 'function_call_output', 'reasoning'].includes(item.type))) {
      throw denied('Stored item references and provider-hosted tool history are disabled.')
    }
    // Replay full local text and function results, not response/message IDs or
    // opaque reasoning state. Some adapters otherwise retain those with store:false.
    payload.input = payload.input.filter(item => item.type !== 'reasoning').map(item => {
      const { id: _id, status: _status, encrypted_content: _encrypted, ...local } = item
      return local
    })
    payload.include = []
  }
  const tokenFields = responses ? ['max_output_tokens'] : ['max_tokens', 'max_completion_tokens']
  for (const name of tokenFields) {
    if (payload[name] !== undefined) {
      if (!Number.isFinite(payload[name]) || payload[name] < 1) throw denied('The model output budget is invalid.')
      payload[name] = Math.min(BUILDER_LIMITS.outputTokens, Math.floor(payload[name]))
    }
  }
  if (!tokenFields.some(name => payload[name] !== undefined)) payload[tokenFields[0]] = BUILDER_LIMITS.outputTokens
  return { url: endpoint, body: JSON.stringify(normalizeProviderPayload(payload, connection)),
    headers: providerHeaders(connection, { stream: true }), method: 'POST', redirect: 'error' }
}

export function boundedModelResponse(response, { maxBytes = 2_000_000 } = {}) {
  if (!response.body) return response
  const reader = response.body.getReader()
  let bytes = 0
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const item = await reader.read()
        if (item.done) { reader.releaseLock(); controller.close(); return }
        bytes += item.value.byteLength
        if (bytes > maxBytes) {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
          throw new AppError('output_limit', 'The model response exceeded its byte limit and was stopped.', 413)
        }
        controller.enqueue(item.value)
      } catch (error) { controller.error(error) }
    },
    async cancel(reason) { await reader.cancel(reason).catch(() => {}); try { reader.releaseLock() } catch { /* read may be in flight */ } },
  })
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}
