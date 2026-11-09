import { AppError, requireText, redactSecrets, publicError, within, redactValue, createStreamRedactor } from '../safety.mjs'
import { validateProject } from './project.mjs'
import { buildSystemPrompt } from './prompt.mjs'
import { createTools } from './tools.mjs'
import { recallForTurn } from './recall.mjs'
import { formatContext } from '../memory/context.mjs'

export function validateChat(input, config, secrets = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('invalid_request', 'Provide a chat request.')
  const sessionId = requireText(input.sessionId, 'sessionId', 128, { pattern: /^[A-Za-z0-9._:-]+$/ })
  const message = redactSecrets(requireText(input.message, 'message', 4000), secrets)
  const model = input.model || config.model
  if (config.mode === 'unconfigured') throw new AppError('llm_not_configured', 'Connect your model API in Settings or run npm run dev:demo.', 503)
  if (!config.models.includes(model)) throw new AppError('invalid_request', 'Choose a model from the configured model list.')
  if (input.history !== undefined && (!Array.isArray(input.history) || input.history.length > 200)) throw new AppError('invalid_request', 'history must be an array with at most 200 messages.')
  const history = (input.history || []).map(item => {
    if (!item || !['user', 'assistant'].includes(item.role)) throw new AppError('invalid_request', 'history may contain only user and assistant messages.')
    return { role: item.role, content: redactSecrets(requireText(item.content, 'history content', 20_000), secrets) }
  })
  while (history.length > 20 || history.reduce((sum, item) => sum + item.content.length, message.length) > 12_000) history.shift()
  const project = validateProject(input.project, secrets)
  for (const name of ['stream', 'capture']) if (input[name] !== undefined && typeof input[name] !== 'boolean') throw new AppError('invalid_request', `${name} must be a boolean.`)
  if (input.occurredAt !== undefined && (typeof input.occurredAt !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(input.occurredAt) || !Number.isFinite(Date.parse(input.occurredAt)))) {
    throw new AppError('invalid_request', 'occurredAt must be a valid UTC timestamp ending in Z.')
  }
  const mode = input.mode || 'talk'
  if (!['talk', 'plan', 'build'].includes(mode)) throw new AppError('invalid_request', 'mode must be talk, plan, or build.')
  return { sessionId, message, history, project, model, mode, capture: input.capture !== false, stream: input.stream !== false,
    occurredAt: input.occurredAt || new Date().toISOString() }
}

export async function* runChat({ input, memory, llm, agentId, config, signal, secrets = [], captureTimeoutMs = 10_000, toolTimeoutMs = 15_000 }) {
  const redactor = createStreamRedactor(secrets)
  let recalled = await recallForTurn({ input, memory, agentId, signal, secrets })
  signal?.throwIfAborted()
  yield { type: 'memory', data: { context: recalled.context, memories: recalled.memories, strategy: recalled.strategy,
    tokenEstimate: recalled.meta.tokenEstimate, lookups: recalled.meta.lookups, memoryUnavailable: Boolean(recalled.meta.error) } }
  const tools = createTools({ memory, agentId, project: input.project, secrets, capture: input.capture, mode: input.mode })
  const messages = [{ role: 'system', content: buildSystemPrompt({ contextBlock: recalled.context,
    project: input.project, toolsEnabled: config.toolsEnabled, capture: input.capture, mode: input.mode,
    memoryUnavailable: Boolean(recalled.meta.error) }) }, ...input.history, { role: 'user', content: input.message }]
  const toolCapture = []
  let answer = ''
  let outputLength = 0
  let finishReason = 'stop'
  let question
  const callIds = new Set()
  for (let round = 0; round <= 3; round++) {
    signal?.throwIfAborted()
    const calls = []
    let roundText = ''
    for await (const event of llm.streamCompletion({ messages, memories: recalled.memories, project: input.project,
      tools: config.toolsEnabled && round < 3 ? tools.schemas : [], model: input.model, config, signal, stream: input.stream !== false })) {
      signal?.throwIfAborted()
      if (event.type === 'delta') {
        outputLength += event.text.length
        if (outputLength > 40_000) throw new AppError('llm_failed', 'The answer exceeded the 40,000-character limit.', 502)
        roundText += event.text
        const clean = redactor.push(event.text)
        answer += clean
        if (clean) yield { type: 'delta', data: { text: clean } }
      }
      if (event.type === 'tool_call') {
        if (calls.length >= 4 || round >= 3 || !config.toolsEnabled) throw new AppError('llm_failed', 'The model exceeded the bounded tool loop.', 502)
        if (typeof event.id !== 'string' || !event.id || event.id.length > 128 || typeof event.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(event.name)) {
          throw new AppError('llm_failed', 'The model returned an invalid tool call.', 502)
        }
        if (callIds.has(event.id)) throw new AppError('llm_failed', 'Duplicate tool call IDs are not allowed.', 502)
        callIds.add(event.id)
        calls.push(redactValue(event, secrets))
      }
      if (event.type === 'finish') finishReason = event.reason
    }
    if (!calls.length) break
    messages.push({ role: 'assistant', content: redactSecrets(roundText, secrets), toolCalls: calls })
    const asksForReply = calls.some(call => call.name === 'ask_user')
    for (const call of calls) {
      signal?.throwIfAborted()
      // A clarification is a hard pause, not a parallel approval. Do not let a
      // model queue a write or proposal alongside an unanswered question.
      if (question || (asksForReply && call.name !== 'ask_user')) {
        const blocked = { success: false, code: 'awaiting_user', error: 'Not run: this round asks for your reply first.' }
        yield { type: 'tool', data: { id: call.id, name: call.name, status: 'blocked', preview: blocked.error } }
        messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(blocked) })
        continue
      }
      yield { type: 'tool', data: { id: call.id, name: call.name, args: call.args, status: 'running' } }
      const outcome = await within(tools.execute(call), toolTimeoutMs, { error: true,
        result: { success: false, code: 'tool_pending', error: 'The tool is still running; no result was confirmed. Memory jobs may complete later. Check inventory before retrying.' },
        preview: 'Tool deadline reached; result not confirmed.' }, signal)
      signal?.throwIfAborted()
      yield { type: 'tool', data: { id: call.id, name: call.name, status: outcome.error ? 'error' : 'done', preview: outcome.preview } }
      if (outcome.proposal) yield { type: 'proposal', data: outcome.proposal }
      if (outcome.plan) yield { type: 'plan', data: outcome.plan }
      if (outcome.question) { question = outcome.question; yield { type: 'question', data: question } }
      if (call.name === 'recall_memory' && !outcome.error) {
        const formatted = formatContext([...recalled.memories, ...outcome.result.memories], { maxTokens: 800, limit: 20 })
        recalled = { ...recalled, ...formatted, meta: { ...recalled.meta, ...formatted.meta,
          ...(recalled.meta.error || outcome.result.meta.error ? { error: 'memory_unavailable' } : {}) } }
        yield { type: 'memory', data: { context: recalled.context, memories: recalled.memories, strategy: recalled.strategy,
          tokenEstimate: recalled.meta.tokenEstimate, lookups: recalled.meta.lookups, memoryUnavailable: Boolean(recalled.meta.error) } }
      }
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.result) })
      if (/^[A-Za-z0-9_-]{1,64}$/.test(call.name)) toolCapture.push({ role: 'tool', name: call.name, content: outcome.preview.slice(0, 1000) })
    }
    if (question) { finishReason = 'question'; break }
  }
  const tail = redactor.finish()
  answer += tail
  if (tail) yield { type: 'delta', data: { text: tail } }
  signal?.throwIfAborted()
  if (!answer.trim() && !question) throw new AppError('llm_failed', 'The model returned no answer. Any proposals already shown still require review.', 502, true)
  // Start capture without awaiting it. A disconnect after done must not lose an accepted write.
  const capture = input.capture ? memory.ingest({ agentId, sessionId: input.sessionId, occurredAt: input.occurredAt,
    messages: [{ role: 'user', content: input.message }, { role: 'assistant', content: [answer, question?.question].filter(Boolean).join('\n\n').slice(0, 20_000) }, ...toolCapture] }, { secrets })
    .then(result => ({ ...result.stored, blobs: result.blobs, chainAnchor: result.chainAnchor }))
    .catch(error => ({ verbatim: 0, facts: 0, failed: 1, blobs: [], code: 'capture_failed', message: publicError(error).error }))
    : Promise.resolve({ verbatim: 0, facts: 0, failed: 0, blobs: [], skipped: true })
  yield { type: 'done', data: { model: input.model, finishReason } }
  const stored = await within(capture, captureTimeoutMs, { verbatim: 0, facts: 0, failed: 0, blobs: [], pending: true,
    message: 'Capture is still running. Refresh inventory to check confirmed writes; do not assume storage succeeded.' }, signal)
  yield { type: 'stored', data: stored }
}
