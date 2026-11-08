import { AppError, requireText, redactSecrets, publicError, within, redactValue, createStreamRedactor } from '../safety.mjs'
import { validateProject } from './project.mjs'
import { buildSystemPrompt } from './prompt.mjs'
import { createTools } from './tools.mjs'

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
  const mode = input.mode || 'build'
  if (!['talk', 'plan', 'build'].includes(mode)) throw new AppError('invalid_request', 'mode must be talk, plan, or build.')
  return { sessionId, message, history, project, model, mode, capture: input.capture !== false,
    occurredAt: input.occurredAt || new Date().toISOString() }
}

export async function* runChat({ input, memory, llm, agentId, config, signal, secrets = [], captureTimeoutMs = 10_000, toolTimeoutMs = 15_000 }) {
  const redactor = createStreamRedactor(secrets)
  let recalled
  try { recalled = await memory.recall({ agentId, query: input.message.slice(0, 2000) }, { signal }) }
  catch (error) {
    if (signal?.aborted) throw error
    recalled = { context: 'No relevant memories yet.', memories: [], strategy: 'unavailable', meta: { tokenEstimate: 0, error: 'memory_unavailable' } }
  }
  recalled = redactValue(recalled, secrets)
  signal?.throwIfAborted()
  yield { type: 'memory', data: { context: recalled.context, memories: recalled.memories, strategy: recalled.strategy,
    tokenEstimate: recalled.meta.tokenEstimate, memoryUnavailable: Boolean(recalled.meta.error) } }
  const tools = createTools({ memory, agentId, project: input.project, secrets, capture: input.capture, mode: input.mode })
  const messages = [{ role: 'system', content: buildSystemPrompt({ contextBlock: recalled.context,
    project: input.project, toolsEnabled: config.toolsEnabled, capture: input.capture, mode: input.mode }) }, ...input.history, { role: 'user', content: input.message }]
  const toolCapture = []
  let answer = ''
  let outputLength = 0
  let finishReason = 'stop'
  const callIds = new Set()
  for (let round = 0; round <= 3; round++) {
    signal?.throwIfAborted()
    const calls = []
    let roundText = ''
    for await (const event of llm.streamCompletion({ messages, memories: recalled.memories, project: input.project,
      tools: config.toolsEnabled && round < 3 ? tools.schemas : [], model: input.model, config, signal })) {
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
    for (const call of calls) {
      signal?.throwIfAborted()
      yield { type: 'tool', data: { id: call.id, name: call.name, args: call.args, status: 'running' } }
      const outcome = await within(tools.execute(call), toolTimeoutMs, { error: true,
        result: { success: false, code: 'tool_pending', error: 'The tool is still running; no result was confirmed. Memory jobs may complete later. Check inventory before retrying.' },
        preview: 'Tool deadline reached; result not confirmed.' }, signal)
      signal?.throwIfAborted()
      yield { type: 'tool', data: { id: call.id, name: call.name, status: outcome.error ? 'error' : 'done', preview: outcome.preview } }
      if (outcome.proposal) yield { type: 'proposal', data: outcome.proposal }
      if (call.name === 'recall_memory' && !outcome.error) {
        const unique = new Map([...recalled.memories, ...outcome.result.memories].map(item => [item.blobId, item]))
        recalled.memories = [...unique.values()].slice(0, 20)
        yield { type: 'memory', data: { context: recalled.context, memories: recalled.memories, strategy: recalled.strategy,
          tokenEstimate: recalled.meta.tokenEstimate, memoryUnavailable: Boolean(outcome.result.meta.error) } }
      }
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.result) })
      if (/^[A-Za-z0-9_-]{1,64}$/.test(call.name)) toolCapture.push({ role: 'tool', name: call.name, content: outcome.preview.slice(0, 1000) })
    }
  }
  const tail = redactor.finish()
  answer += tail
  if (tail) yield { type: 'delta', data: { text: tail } }
  signal?.throwIfAborted()
  if (!answer.trim()) throw new AppError('llm_failed', 'The model returned no answer. Any proposals already shown still require review.', 502, true)
  // Start capture without awaiting it. A disconnect after done must not lose an accepted write.
  const capture = input.capture ? memory.ingest({ agentId, sessionId: input.sessionId, occurredAt: input.occurredAt,
    messages: [{ role: 'user', content: input.message }, ...(answer ? [{ role: 'assistant', content: answer.slice(0, 20_000) }] : []), ...toolCapture] }, { secrets })
    .then(result => ({ ...result.stored, blobs: result.blobs, chainAnchor: result.chainAnchor }))
    .catch(error => ({ verbatim: 0, facts: 0, failed: 1, blobs: [], code: 'capture_failed', message: publicError(error).error }))
    : Promise.resolve({ verbatim: 0, facts: 0, failed: 0, blobs: [], skipped: true })
  yield { type: 'done', data: { model: input.model, finishReason } }
  const stored = await within(capture, captureTimeoutMs, { verbatim: 0, facts: 0, failed: 0, blobs: [], pending: true,
    message: 'Capture is still running. Refresh inventory to check confirmed writes; do not assume storage succeeded.' }, signal)
  yield { type: 'stored', data: stored }
}
