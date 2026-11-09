import type { CapabilityState, Connection } from './types.ts'

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

// Official links checked on 2026-11-08. Model IDs are deliberately not guessed.
export const PROVIDERS: ProviderPreset[] = [
  { id: 'agentrouter', label: 'AgentRouter', baseUrl: 'https://agentrouter.org/v1', apiStyle: 'responses',
    keyUrl: 'https://ps.air-outer.com/console/token', docsUrl: 'https://agentrouter.org/docs/codex.html', modelsUrl: 'https://ps.air-outer.com/console/personal',
    help: 'Copy an exact model ID from your account. The official guides link to ps.air-outer.com for tokens and models; the API stays on agentrouter.org.' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiStyle: 'responses',
    keyUrl: 'https://platform.openai.com/api-keys', docsUrl: 'https://developers.openai.com/api/reference/resources/responses', modelsUrl: 'https://developers.openai.com/api/docs/models',
    help: 'Use an API project key with model access and billing enabled. A ChatGPT subscription is not an API key.' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiStyle: 'chat',
    keyUrl: 'https://openrouter.ai/settings/keys', docsUrl: 'https://openrouter.ai/docs/api_reference/overview', modelsUrl: 'https://openrouter.ai/models',
    help: 'Use your OpenRouter key and the full provider/model identifier shown in its model catalogue.' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiStyle: 'chat',
    keyUrl: 'https://console.groq.com/keys', docsUrl: 'https://console.groq.com/docs/openai', modelsUrl: 'https://console.groq.com/docs/models',
    help: 'Use a Groq API key and an active model from its supported-model list. Limits depend on your account.' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', baseUrlAliases: ['https://api.deepseek.com/v1'], apiStyle: 'chat',
    keyUrl: 'https://platform.deepseek.com/api_keys', docsUrl: 'https://api-docs.deepseek.com', modelsUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    help: 'Use a DeepSeek platform key and a model ID from its API docs. The platform may require sign-in or a browser security check.' },
  { id: 'gemini', label: 'Gemini · OpenAI compatibility', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiStyle: 'chat',
    keyUrl: 'https://aistudio.google.com/apikey', docsUrl: 'https://aistudio.google.com/docs/openai', modelsUrl: 'https://aistudio.google.com/docs/models',
    help: 'Use a Gemini API key with Google’s OpenAI-compatible endpoint, not a native Gemini generateContent URL.' },
  { id: 'ollama', label: 'Ollama · local', baseUrl: 'http://127.0.0.1:11434/v1', apiStyle: 'chat', docsUrl: 'https://docs.ollama.com/api/openai-compatibility',
    help: 'Run Ollama on the RecallLoop server and pull a model first. The key is optional locally; localhost is not the browser’s computer. Ollama supports a subset of compatible fields, so forced tool checks may be unsupported.' },
  { id: 'custom', label: 'Other compatible API', baseUrl: '', apiStyle: 'chat', docsUrl: 'https://developers.openai.com/api/reference/resources/chat',
    help: 'Use an allowed OpenAI-compatible host. Custom HTTPS hosts need AGENT_LLM_ALLOWED_HOSTS on the server; Anthropic-native APIs are not supported.' },
]

export function providerForUrl(baseUrl = '') {
  const base = baseUrl.replace(/\/+$/, '')
  // Recognize previously saved presets without rewriting their actual API base.
  return PROVIDERS.find(provider => provider.id !== 'custom' && (provider.baseUrl === base || provider.baseUrlAliases?.includes(base))) || PROVIDERS.at(-1)!
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
