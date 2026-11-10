import { AppError } from '../safety.mjs'

// Google uses a numeric `code` alongside a string `status` such as
// INVALID_ARGUMENT. Accept only actual HTTP error codes from either field.
export function providerErrorStatus(error, fallback = 400) {
  for (const value of [error?.status, error?.code]) {
    if ((typeof value === 'number' || (typeof value === 'string' && /^[45]\d\d$/.test(value)))
      && Number.isInteger(Number(value)) && Number(value) >= 400 && Number(value) <= 599) return Number(value)
  }
  return fallback
}

// Upstream bodies are untrusted and may contain keys, prompts, or debug dumps.
// Use them only to select a fixed diagnostic; never return or log their contents.
export function providerFailure(status, body = '', baseUrl = '') {
  const text = (typeof body === 'string' ? body : '').slice(0, 100_000).toLowerCase()
  const error = (code, hint, retryable = false) => new AppError(code, `Model provider HTTP ${status}. ${hint}`, 502, retryable)
  const google = /^https:\/\/generativelanguage\.googleapis\.com(?:\/|$)/.test(baseUrl)
  const openrouter = /^https:\/\/openrouter\.ai(?:\/|$)/.test(baseUrl)
  if (/\b(?:client|application|user[ -]?agent)\b.{0,80}(?:not (?:allowed|approved|supported)|unapproved|unsupported|allowlist|whitelist)|(?:unapproved|unsupported|not (?:allowed|approved))\s+(?:client|application)|only.{0,60}(?:approved|supported)\s+clients/.test(text)) {
    return error('provider_client_unapproved', 'This client is not approved. Ask the provider to allow RecallLoop or choose another provider. RecallLoop does not impersonate other clients.')
  }
  if (status === 401) return error('provider_invalid_key', 'The API key was rejected. Check that it belongs to this provider and has not expired or been revoked.')
  if (google && [400, 403].includes(status) && /api[_ -]?key[_ -]?(?:invalid|expired)|api key.{0,80}(?:not valid|invalid|expired|leaked|blocked)|(?:invalid|expired) api key/.test(text)) {
    return error('provider_invalid_key', 'Google rejected this Gemini API key. Check or replace it in Google AI Studio, then update the key in Settings. Use a Gemini API key for this endpoint.')
  }
  if (google && [400, 403].includes(status) && /failed[_ -]precondition|free[_ -]tier.{0,80}(?:unavailable|not available|not eligible|not supported)|billing.{0,60}(?:disabled|enable|set up)|free_tier_verification_required/.test(text)) {
    return error('provider_precondition', 'Google reports an unmet project prerequisite. Check Google AI Studio for billing, free-tier eligibility, region availability or required account verification. Loading the model list does not verify generation access.')
  }
  if ([400, 422].includes(status) && /thought[_ -]?signature/.test(text)) {
    return error('provider_tool_signature', 'The provider rejected the tool-call thought signature. Start a fresh task with the same model. If this repeats, check that the endpoint preserves Gemini tool-call signatures; a proxy may be incompatible.')
  }
  if (status === 402 || /insufficient[_ -](?:quota|credits|funds)|budget pool quota|(?:quota|credit balance|billing|budget).{0,60}(?:exhausted|exceeded|insufficient|required)|payment required/.test(text)) {
    if (/^https:\/\/router\.huggingface\.co(?:\/|$)/.test(baseUrl)) {
      return error('provider_quota', 'Hugging Face inference credits or a billing limit blocked this request. Free accounts have no included inference credits. Check Hugging Face Settings → Billing and Inference Providers; add credits or check your custom provider’s balance before retrying.')
    }
    if (openrouter) return error('provider_quota', 'OpenRouter credits or a spending limit blocked this request. Check your balance, key credit cap and account budget in OpenRouter; top up or adjust the limit before retrying. You can also select another connected provider.')
    return error('provider_quota', 'Quota, credits, or billing are unavailable. Check the provider dashboard before retrying.')
  }
  if ([400, 403].includes(status) && /(?:region|country|location).{0,60}(?:unsupported|not supported|restricted|blocked|unavailable)|(?:unsupported|blocked|restricted).{0,40}(?:region|country|location)|geo.?block/.test(text)) {
    return error('provider_region_restricted', 'The provider reports a region restriction. Check its supported countries and the region eligibility of your account/project. Re-entering the same key will not resolve this restriction.')
  }
  if (status === 403) {
    if (/\b(?:proxy|vpn|firewall)\b|ip.{0,20}(?:blocked|denied|restricted)/.test(text)) return error('provider_network_restricted', 'The provider reports a network or proxy restriction. Check its network-access policy and your server’s approved proxy/IP configuration.')
    if (/unverified|verification|required.{0,30}verify|account.{0,40}(?:suspended|restricted|not enabled)/.test(text)) return error('provider_account_restricted', 'The provider reports an account restriction or required verification. Complete the account/project checks in its dashboard before retrying.')
    return error('provider_forbidden', 'Access was denied. Check account/project permissions, region eligibility, proxy restrictions and the provider client allowlist. RecallLoop does not impersonate other clients.')
  }
  if (/no available channel|model[_ -]not[_ -]found|(?:invalid|unknown|unsupported|unavailable)\s+model|model.{0,70}(?:does not exist|not found|not (?:available|supported)|offline)/.test(text)) {
    return error('provider_model_unavailable', 'The model ID is unavailable for this account or endpoint. Copy its exact ID and supported protocol from the provider dashboard.', status === 503)
  }
  if ([400, 422, 501].includes(status) && /\bstream(?:ing)?\b.{0,50}(?:unsupported|not supported)|(?:unsupported|not supported).{0,50}\bstream(?:ing)?\b/.test(text)) {
    return error('provider_streaming_unsupported', 'This model or endpoint does not support streaming. Use a non-streamed request.')
  }
  if ([400, 422, 501].includes(status) && /(?:forced tool|tool_choice|force.{0,20}function).{0,60}(?:unsupported|not supported|not allowed)|(?:unsupported|not supported).{0,60}(?:forced tool|tool_choice)/.test(text)) {
    return error('provider_tool_choice_unsupported', 'This model rejects forced function selection. Ordinary automatic tool use may still work; a failed forced-call check does not establish that all tools are unsupported.')
  }
  if ([400, 422, 501].includes(status) && /(?:tools?|tool_choice|function.?call(?:ing)?).{0,60}(?:unsupported|not supported|not allowed)|(?:unsupported|not supported).{0,60}(?:tools?|tool_choice|function.?call)/.test(text)) {
    return error('provider_tools_unsupported', 'This model or endpoint does not support these function tools. Disable tools or choose a tool-capable model.')
  }
  if ([404, 405, 501].includes(status) || /(?:responses|chat.?completions|api (?:style|protocol)|endpoint).{0,60}(?:unsupported|not supported|not found)|(?:unsupported|not supported).{0,60}(?:responses|chat.?completions|endpoint)/.test(text)) {
    return error('provider_protocol_unsupported', 'The API base URL or protocol is not supported. Use the API base (not a dashboard or a full generation URL), and select Responses or Chat Completions as documented for this model.')
  }
  if (status === 429) return error('provider_rate_limited', openrouter
    ? 'OpenRouter’s request limit was reached, which can include free-model daily or per-minute caps. Wait for the limit to reset, check your account limits or choose another connected model/provider.'
    : 'The provider is rate-limiting requests. Wait before retrying.', true)
  if ([408, 504].includes(status)) return error('provider_timeout', 'The provider timed out. Retry later or check its service status.', true)
  if (google && status === 400) {
    if (/unknown name|unknown (?:field|parameter)|unrecognized (?:field|parameter)|parameter_unknown|(?:unsupported|invalid) (?:field|parameter)|(?:field|parameter).{0,50}not supported/.test(text)) {
      return error('provider_parameters_unsupported', 'Gemini rejected a request parameter. Use the Google Gemini preset with Chat Completions and a model that supports the requested features. Check Gemini’s OpenAI compatibility documentation before retrying.')
    }
    return error('provider_request_failed', 'Gemini rejected the prompt, system schema, tool configuration or request parameters. In Settings, use https://generativelanguage.googleapis.com/v1beta/openai with Chat Completions, a Google AI Studio API key and an exact model ID from Load models. Check Google AI Studio project access and billing if these are already correct.')
  }
  if ([400, 422].includes(status)) return error('provider_request_failed', 'The prompt, system schema, tool configuration or request parameters are incompatible with this model/endpoint. Check the selected protocol and capabilities in Settings; choose a compatible model or disable unsupported tools.')
  return error('provider_request_failed', status >= 500 ? 'The provider is unavailable. Check its service status or try later.' : 'The provider rejected the request. Check the model, protocol, and supported parameters.', status >= 500)
}

export function providerNetworkFailure(deadline, subject = 'model request') {
  return deadline?.aborted
    ? new AppError('provider_timeout', `The ${subject} timed out. Check the provider status or try later.`, 502, true)
    : new AppError('provider_network', `The ${subject} could not reach the provider. Check the API base URL, DNS, proxy, or local model server.`, 502, true)
}
