import type { CapabilityState, Connection, ProviderModel } from './types.ts'

export interface ProviderPreset {
  id: string
  label: string
  baseUrl: string
  baseUrlAliases?: string[]
  apiStyle: 'chat' | 'responses'
  keyUrl?: string
  docsUrl?: string
  modelsUrl?: string
  help: string
}

// Official links checked on 2026-11-08; HF billing and Gemini compatibility rechecked 2026-11-10. Model IDs are deliberately not guessed.
export const PROVIDERS: ProviderPreset[] = [
  { id: 'agentrouter', label: 'AgentRouter', baseUrl: 'https://agentrouter.org/v1', apiStyle: 'responses',
    keyUrl: 'https://ps.air-outer.com/console/token', docsUrl: 'https://agentrouter.org/docs/codex.html', modelsUrl: 'https://ps.air-outer.com/console/personal',
    help: 'Load models using your account key, then choose one. The official guides link to ps.air-outer.com for tokens and models; the API stays on agentrouter.org.' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiStyle: 'responses',
    keyUrl: 'https://platform.openai.com/api-keys', docsUrl: 'https://developers.openai.com/api/reference/resources/responses', modelsUrl: 'https://developers.openai.com/api/docs/models',
    help: 'Use an API project key with model access and billing enabled. A ChatGPT subscription is not an API key.' },
  { id: 'anthropic', label: 'Anthropic · Chat compatibility', baseUrl: 'https://api.anthropic.com/v1', apiStyle: 'chat',
    keyUrl: 'https://platform.claude.com/settings/keys', docsUrl: 'https://platform.claude.com/docs/en/api/openai-sdk', modelsUrl: 'https://platform.claude.com/docs/en/models/overview',
    help: 'Use a workspace-scoped Claude API key. This connector uses Anthropic’s documented Chat Completions compatibility layer; native Messages features are not exposed. Some models reject forced tool checks while supporting automatic tool use. A Claude subscription is separate from API billing.' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiStyle: 'chat',
    keyUrl: 'https://openrouter.ai/settings/keys', docsUrl: 'https://openrouter.ai/docs/api_reference/overview', modelsUrl: 'https://openrouter.ai/models',
    help: 'An OpenRouter account key is required, including for free models. Free labels use the provider’s current zero-price catalogue; rate limits and availability still apply.' },
  { id: 'huggingface', label: 'Hugging Face · Inference Providers', baseUrl: 'https://router.huggingface.co/v1', apiStyle: 'chat',
    keyUrl: 'https://huggingface.co/settings/tokens', docsUrl: 'https://huggingface.co/docs/inference-providers/en/tasks/chat-completion', modelsUrl: 'https://huggingface.co/models?inference_provider=all',
    help: 'Create a Hugging Face token with “Make calls to Inference Providers” permission. Free accounts have no included inference credits; purchase credits or use remaining paid-plan compute credits. A listed or downloadable model does not imply free hosted generation. Custom provider keys configured in Hugging Face are billed by that provider.' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiStyle: 'chat',
    keyUrl: 'https://console.groq.com/keys', docsUrl: 'https://console.groq.com/docs/openai', modelsUrl: 'https://console.groq.com/docs/models',
    help: 'Use a Groq API key and an active model from its supported-model list. Limits depend on your account.' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', baseUrlAliases: ['https://api.deepseek.com/v1'], apiStyle: 'chat',
    keyUrl: 'https://platform.deepseek.com/api_keys', docsUrl: 'https://api-docs.deepseek.com', modelsUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    help: 'Use a DeepSeek platform key and a model ID from its API docs. The platform may require sign-in or a browser security check.' },
  { id: 'gemini', label: 'Gemini · OpenAI compatibility', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiStyle: 'chat',
    keyUrl: 'https://aistudio.google.com/apikey', docsUrl: 'https://aistudio.google.com/docs/openai', modelsUrl: 'https://aistudio.google.com/docs/models',
    help: 'Use a Gemini API key and Chat Completions. Google’s OpenAI compatibility layer accepts system messages. Native generateContent uses systemInstruction and a different URL/payload. Loading models does not verify generation, project eligibility or billing.' },
  { id: 'ollama', label: 'Ollama · local', baseUrl: 'http://127.0.0.1:11434/v1', apiStyle: 'chat', docsUrl: 'https://docs.ollama.com/api/openai-compatibility',
    help: 'Run Ollama on the RecallLoop server and pull a model first. The key is optional locally; localhost is not the browser’s computer. Ollama supports a subset of compatible fields, so forced tool checks may be unsupported.' },
  { id: 'custom', label: 'Other compatible API', baseUrl: '', apiStyle: 'chat', docsUrl: 'https://developers.openai.com/api/reference/resources/chat',
    help: 'Use an allowed OpenAI-compatible host. Custom HTTPS hosts need AGENT_LLM_ALLOWED_HOSTS on the server. Native Messages and generateContent payloads need their own adapters; use the compatible presets here.' },
]

export function providerForUrl(baseUrl = '') {
  const base = baseUrl.replace(/\/+$/, '')
  // Recognize previously saved presets without rewriting their actual API base.
  return PROVIDERS.find(provider => provider.id !== 'custom' && (provider.baseUrl === base || provider.baseUrlAliases?.includes(base))) || PROVIDERS.at(-1)!
}

export function connectionLabel(connection: Connection) {
  return connection.name || (connection.mode === 'mock' ? 'Scripted mock' : providerForUrl(connection.baseUrl).label)
}
export function modelLabel(model: ProviderModel) {
  return `${model.label}${model.cost === 'provider-free' ? ' · Free (provider limits)' : model.cost === 'local' ? ' · Local · no API key' : ''}${model.tools === false ? ' · No tools advertised' : ''}`
}
export function modelToolsEnabled(connection: Connection | undefined, model: string) {
  if (!connection || connection.toolsEnabled === false) return false
  const checked = connection.verification
  if (checked?.model === model && checked.apiStyle === connection.apiStyle && checked.generation === 'verified') {
    if (checked.tools === 'verified') return true
    if (checked.tools === 'unsupported') return false
  }
  return connection.models.find(item => item.id === model)?.tools !== false
}
export function modelChoice(connection: Connection, model: string) {
  return connection.id ? `${connection.id}|${model}` : model
}
export function availableConnections(fallback?: Connection, profiles?: Connection[]) {
  return (profiles?.length ? profiles : fallback ? [fallback] : []).filter(item => item.mode !== 'unconfigured')
}

export function generationVerified(connection: Connection | undefined, model: string) {
  return Boolean(connection?.mode === 'live' && connection.verified && !connection.lastVerificationFailure
    && connection.verification?.generation === 'verified' && connection.verification.model === model
    && connection.verification.apiStyle === connection.apiStyle)
}

export function modelStatus(connection: Connection | undefined, model: string) {
  if (connection?.mode === 'mock') return { label: 'Scripted mock', tone: 'warning' as const }
  if (!connection || connection.mode === 'unconfigured') return { label: 'No model connected', tone: 'neutral' as const }
  if (connection.lastVerificationFailure) return { label: 'Last check failed', tone: 'error' as const }
  return generationVerified(connection, model) ? { label: 'Generation verified', tone: 'success' as const }
    : { label: 'Generation not verified', tone: 'neutral' as const }
}

export function capabilityLabel(state: CapabilityState | undefined) {
  return state === 'verified' ? 'Verified' : state === 'unsupported' ? 'Unsupported' : state === 'failed' ? 'Check failed' : 'Not checked'
}
