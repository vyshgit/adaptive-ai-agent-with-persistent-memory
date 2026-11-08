import { AppError } from '../safety.mjs'

// Upstream bodies are untrusted and may contain keys, prompts, or debug dumps.
// Use them only to select a fixed diagnostic; never return or log their contents.
export function providerFailure(status, body = '') {
  const text = (typeof body === 'string' ? body : '').slice(0, 100_000).toLowerCase()
  const error = (code, hint, retryable = false) => new AppError(code, `Model provider HTTP ${status}. ${hint}`, 502, retryable)
  if (/\b(?:client|application|user[ -]?agent)\b.{0,80}(?:not (?:allowed|approved|supported)|unapproved|unsupported|allowlist|whitelist)|(?:unapproved|unsupported|not (?:allowed|approved))\s+(?:client|application)|only.{0,60}(?:approved|supported)\s+clients/.test(text)) {
    return error('provider_client_unapproved', 'This client is not approved. Ask the provider to allow RecallLoop or choose another provider. RecallLoop does not impersonate other clients.')
  }
  if (status === 401) return error('provider_invalid_key', 'The API key was rejected. Check that it belongs to this provider and has not expired or been revoked.')
  if (status === 402 || /insufficient[_ -](?:quota|credits|funds)|budget pool quota|(?:quota|credit balance|billing|budget).{0,60}(?:exhausted|exceeded|insufficient|required)|payment required/.test(text)) {
    return error('provider_quota', 'Quota, credits, or billing are unavailable. Check the provider dashboard before retrying.')
  }
  if (status === 403) return error('provider_forbidden', 'Access was denied. Check account/project permissions and the provider client allowlist. RecallLoop does not impersonate other clients.')
  if (/no available channel|model[_ -]not[_ -]found|(?:invalid|unknown|unsupported|unavailable)\s+model|model.{0,70}(?:does not exist|not found|not (?:available|supported)|offline)/.test(text)) {
    return error('provider_model_unavailable', 'The model ID is unavailable for this account or endpoint. Copy its exact ID and supported protocol from the provider dashboard.', status === 503)
  }
  if ([400, 422, 501].includes(status) && /\bstream(?:ing)?\b.{0,50}(?:unsupported|not supported)|(?:unsupported|not supported).{0,50}\bstream(?:ing)?\b/.test(text)) {
    return error('provider_streaming_unsupported', 'This model or endpoint does not support streaming. Use a non-streamed request.')
  }
  if ([400, 422, 501].includes(status) && /(?:tools?|tool_choice|function.?call(?:ing)?).{0,60}(?:unsupported|not supported|not allowed)|(?:unsupported|not supported).{0,60}(?:tools?|tool_choice|function.?call)/.test(text)) {
    return error('provider_tools_unsupported', 'This model or endpoint does not support these function tools. Disable tools or choose a tool-capable model.')
  }
  if ([404, 405, 501].includes(status) || /(?:responses|chat.?completions|api (?:style|protocol)|endpoint).{0,60}(?:unsupported|not supported|not found)|(?:unsupported|not supported).{0,60}(?:responses|chat.?completions|endpoint)/.test(text)) {
    return error('provider_protocol_unsupported', 'The API base URL or protocol is not supported. Use the API base (not a dashboard or a full generation URL), and select Responses or Chat Completions as documented for this model.')
  }
  if (status === 429) return error('provider_rate_limited', 'The provider is rate-limiting requests. Wait before retrying.', true)
  if ([408, 504].includes(status)) return error('provider_timeout', 'The provider timed out. Retry later or check its service status.', true)
  return error('provider_request_failed', status >= 500 ? 'The provider is unavailable. Check its service status or try later.' : 'The provider rejected the request. Check the model, protocol, and supported parameters.', status >= 500)
}

export function providerNetworkFailure(deadline, subject = 'model request') {
  return deadline?.aborted
    ? new AppError('provider_timeout', `The ${subject} timed out. Check the provider status or try later.`, 502, true)
    : new AppError('provider_network', `The ${subject} could not reach the provider. Check the API base URL, DNS, proxy, or local model server.`, 502, true)
}
