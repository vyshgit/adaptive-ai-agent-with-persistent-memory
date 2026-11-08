import { setTimeout as delay } from 'node:timers/promises'
import { AppError, clampNumber } from '../safety.mjs'
import { validateProviderUrl } from './connections.mjs'
import { parseSse, readLimitedText } from './sse.mjs'

function providerFailure(status) {
  const hint = status === 401 || status === 403 ? 'Check the API key and any provider client allowlist; RecallLoop does not impersonate other clients.'
    : status === 402 ? 'Provider quota or payment is required.' : status === 429 ? 'The provider is rate-limiting requests.' : 'Try again or check your provider endpoint.'
  return new AppError('llm_failed', `Model provider HTTP ${status}. ${hint}`, 502, [402, 408, 429].includes(status) || status >= 500)
}

function checkCalls(calls) {
  if (calls.size > 4 || [...calls.values()].some(call => typeof call.id !== 'string' || call.id.length > 128
    || typeof call.name !== 'string' || call.name.length > 64 || typeof call.arguments !== 'string' || call.arguments.length > 32_000)) {
    throw new AppError('llm_failed', 'The provider tool calls exceeded the size limit or had an invalid format.', 502)
  }
}

export function toResponsesInput(messages) {
  return messages.filter(message => message.role !== 'system').flatMap(message => {
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.toolCallId, output: message.content }]
    const result = message.content ? [{ role: message.role, content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }] }] : []
    for (const call of message.toolCalls || []) result.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.args) })
    return result
  })
}

function toChatInput(messages) {
  return messages.map(message => message.role === 'tool'
    ? { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
    : { role: message.role, content: message.content || null,
      ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(call => ({ id: call.id, type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : {}) })
}

export function createLlm({ fetchImpl = fetch, env = process.env, mockDelayMs = 15 } = {}) {
  async function models(config, signal) {
    if (config.mode === 'mock') return { models: ['recallloop-mock'], verified: false }
    validateProviderUrl(config.baseUrl, env)
    let response
    try {
      response = await fetchImpl(`${config.baseUrl}/models`, { headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
        redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) })
    } catch { throw new AppError('llm_failed', 'The provider models endpoint could not be reached. Check the base URL or local model server.', 502, true) }
    if ([404, 405, 501].includes(response.status)) return { models: [config.model], verified: false }
    if (!response.ok) throw providerFailure(response.status)
    let data
    try { data = JSON.parse(await readLimitedText(response)) } catch { throw new AppError('llm_failed', 'The models endpoint did not return valid JSON.', 502) }
    if (!data || !Array.isArray(data.data)) throw new AppError('llm_failed', 'The models endpoint must return an OpenAI-compatible data array.', 502)
    const available = data.data.filter(item => item && typeof item.id === 'string' && /^[A-Za-z0-9._:/@+-]{1,128}$/.test(item.id)).map(item => item.id)
    return { models: [...new Set([config.model, ...available])].slice(0, 100), verified: true }
  }

  async function* mockCompletion({ messages, memories = [], project, tools = [], signal }) {
    signal?.throwIfAborted()
    const task = messages.filter(message => message.role === 'user').at(-1)?.content || ''
    const toolMessages = messages.filter(message => message.role === 'tool')
    const coding = /\b(fix|code|refactor|implement|improve|add|greet|test)\b/i.test(task)
    const source = project?.files.find(file => /\.[cm]?[jt]sx?$/.test(file.path))
    if (coding && source && tools.length && toolMessages.length === 0) {
      yield { type: 'tool_call', id: 'mock-read', name: 'read_file', args: { path: source.path } }
      yield { type: 'finish', reason: 'tool_calls' }
      return
    }
    if (coding && source && tools.some(tool => tool.function.name === 'propose_file') && toolMessages.length === 1) {
      const original = source.content
      const starter = 'export function greet(name: string) {\n  return `Hello, ${name.trim()}!`\n}\n'
      const content = original === starter
        ? 'export function greet(name?: string) {\n  const displayName = name?.trim() || \'friend\'\n  return `Hello, ${displayName}!`\n}\n'
        : `// RecallLoop scripted mock proposal: review before applying.\n${original}`
      yield { type: 'tool_call', id: 'mock-propose', name: 'propose_file', args: { path: source.path, content,
        reason: original === starter ? 'Scripted demo: handle empty and missing names without throwing.' : 'Scripted demo only: add an explanatory comment; no real model generated or tested this change.' } }
      yield { type: 'finish', reason: 'tool_calls' }
      return
    }
    const recalled = memories.length ? `Recalled context:\n${memories.slice(0, 4).map(memory => `• ${memory.text} [${memory.blobId}]`).join('\n')}\n\nI will use these preferences in this session.`
      : 'No relevant memories yet. Tell me a preference or a lesson, then start a new session to see recall.'
    const proposed = toolMessages.some(message => message.toolCallId === 'mock-propose')
    const text = `Mock model — deterministic offline demo, not a live LLM.\n\n${recalled}${proposed ? '\n\nA scripted code change is ready in Review. Nothing has been applied or executed. Review it before accepting.' : toolMessages.length ? '\n\nI inspected the selected file. In Talk or Plan mode, no code-change proposals are created. Switch to Build to review a scripted sandbox fix.' : ''}`
    for (const word of text.match(/\S+\s*/g) || []) {
      signal?.throwIfAborted()
      if (mockDelayMs) await delay(mockDelayMs, undefined, { signal })
      yield { type: 'delta', text: word }
    }
    yield { type: 'finish', reason: 'stop' }
  }

  async function* streamCompletion({ messages, memories, project, tools = [], model, config, signal }) {
    if (config.mode === 'mock') { yield* mockCompletion({ messages, memories, project, tools, signal }); return }
    if (config.mode !== 'live' || !config.baseUrl || !model || (!config.apiKey && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.baseUrl).hostname))) {
      throw new AppError('llm_not_configured', 'Connect a model API in Settings, configure AGENT_LLM_*, or run the explicit mock demo.', 503)
    }
    validateProviderUrl(config.baseUrl, env)
    if (!['responses', 'chat'].includes(config.apiStyle)) throw new AppError('llm_not_configured', 'Select the responses or chat API style.', 503)
    const responses = config.apiStyle === 'responses'
    const outputTokens = Math.floor(clampNumber(Number(env.AGENT_LLM_MAX_OUTPUT_TOKENS), 4000, 400, 8000))
    const body = responses ? { model, instructions: messages.find(message => message.role === 'system')?.content || '',
      input: toResponsesInput(messages), store: false, max_output_tokens: outputTokens,
      ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', ...tool.function })) } : {}) }
      : { model, messages: toChatInput(messages), max_tokens: outputTokens, store: false, ...(tools.length ? { tools } : {}) }
    const headers = new Headers({ 'Content-Type': 'application/json', 'User-Agent': 'RecallLoop/0.2.0' })
    if (config.apiKey) headers.set('Authorization', `Bearer ${config.apiKey}`)
    if (env.AGENT_LLM_EXTRA_HEADERS) {
      let extra
      try { extra = JSON.parse(env.AGENT_LLM_EXTRA_HEADERS) } catch { throw new AppError('llm_not_configured', 'AGENT_LLM_EXTRA_HEADERS must be valid JSON.', 503) }
      const allowed = ['http-referer', 'x-title', 'openai-organization', 'openai-project']
      for (const [key, value] of Object.entries(extra)) {
        if (!allowed.includes(key.toLowerCase()) || typeof value !== 'string') throw new AppError('llm_not_configured', 'Only legitimate attribution and OpenAI organisation/project headers are supported.', 503)
        headers.set(key, value)
      }
    }
    const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(60_000)])
    const request = streaming => fetchImpl(`${config.baseUrl}/${responses ? 'responses' : 'chat/completions'}`, {
      method: 'POST', headers, body: JSON.stringify({ ...body, stream: streaming }), signal: deadline, redirect: 'error',
    })
    let response
    try {
      response = await request(true)
      if (!response.ok) {
        const text = await readLimitedText(response, 100_000)
        if ([400, 422, 501].includes(response.status) && /stream(?:ing)?.{0,40}(?:unsupported|not supported)|(?:unsupported|not supported).{0,40}stream/i.test(text)) response = await request(false)
        else throw providerFailure(response.status)
      }
      if (!response.ok) throw providerFailure(response.status)
      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        let data
        try { data = JSON.parse(await readLimitedText(response)) } catch { throw new AppError('llm_failed', 'The model endpoint did not return valid JSON or SSE.', 502) }
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.error || (responses && data.status && !['completed', 'incomplete'].includes(data.status))) {
          throw new AppError('llm_failed', 'The provider failed to complete the response.', 502, true)
        }
        const text = responses ? (data.output || []).filter(item => item.type === 'message').flatMap(item => item.content || []).filter(part => part.type === 'output_text').map(part => part.text).join('')
          : data.choices?.[0]?.message?.content || ''
        const calls = responses ? (data.output || []).filter(item => item.type === 'function_call').map(item => ({ id: item.call_id, name: item.name, arguments: item.arguments }))
          : (data.choices?.[0]?.message?.tool_calls || []).map(item => ({ id: item.id, name: item.function?.name, arguments: item.function?.arguments }))
        if (typeof text !== 'string' || text.length > 40_000 || calls.length > 4 || calls.some(call => typeof call.arguments !== 'string' || call.arguments.length > 32_000)) {
          throw new AppError('llm_failed', 'The model output exceeded the turn limits or had an invalid format.', 502)
        }
        if (text) yield { type: 'delta', text }
        for (const call of calls) yield { type: 'tool_call', id: call.id, name: call.name, args: parseArguments(call.arguments) }
        yield { type: 'finish', reason: calls.length ? 'tool_calls' : data.status === 'incomplete' ? 'length' : data.choices?.[0]?.finish_reason || 'stop', usage: data.usage }
        return
      }
      const calls = new Map()
      let completed = false
      let finishReason = 'stop'
      let outputLength = 0
      for await (const frame of parseSse(response.body)) {
        if (frame.data === '[DONE]') break
        let data
        try { data = JSON.parse(frame.data) } catch { throw new AppError('llm_failed', 'The provider sent malformed stream data. The partial answer has been preserved.', 502, true) }
        if (!data || typeof data !== 'object' || Array.isArray(data)) continue
        const type = data.type || frame.event
        if (data.error || ['response.failed', 'response.cancelled', 'error'].includes(type)) throw new AppError('llm_failed', 'The provider reported a generation failure.', 502, true)
        if (responses) {
          if (['response.output_text.delta', 'response.refusal.delta'].includes(type) && typeof data.delta === 'string') {
            outputLength += data.delta.length
            if (outputLength > 40_000) throw new AppError('llm_failed', 'The model output exceeded the turn limits.', 502)
            yield { type: 'delta', text: data.delta }
          }
          if (type === 'response.output_item.added' && data.item?.type === 'function_call') {
            calls.set(data.item.id, { id: data.item.call_id || data.item.id, name: data.item.name, arguments: data.item.arguments || '' })
          }
          if (type === 'response.function_call_arguments.delta') {
            const call = calls.get(data.item_id)
            if (call) call.arguments += data.delta || ''
          }
          if (type === 'response.output_item.done' && data.item?.type === 'function_call') calls.set(data.item.id, {
            id: data.item.call_id || data.item.id, name: data.item.name, arguments: data.item.arguments || '',
          })
          if (['response.completed', 'response.incomplete'].includes(type)) {
            completed = true
            finishReason = type === 'response.incomplete' || data.response?.status === 'incomplete' ? 'length' : 'stop'
            for (const item of data.response?.output || []) if (item.type === 'function_call') calls.set(item.id || item.call_id, {
              id: item.call_id || item.id, name: item.name, arguments: item.arguments || '',
            })
          }
        } else {
          const choice = data.choices?.[0]
          const delta = choice?.delta
          if (typeof delta?.content === 'string') {
            outputLength += delta.content.length
            if (outputLength > 40_000) throw new AppError('llm_failed', 'The model output exceeded the turn limits.', 502)
            yield { type: 'delta', text: delta.content }
          }
          for (const item of delta?.tool_calls || []) {
            const call = calls.get(item.index) || { id: '', name: '', arguments: '' }
            call.id += item.id || ''
            call.name += item.function?.name || ''
            call.arguments += item.function?.arguments || ''
            calls.set(item.index, call)
          }
          if (choice?.finish_reason) { completed = true; finishReason = choice.finish_reason }
        }
        checkCalls(calls)
      }
      if (!completed) throw new AppError('llm_failed', 'The provider stream ended before completion. The partial answer has been preserved.', 502, true)
      for (const call of calls.values()) yield { type: 'tool_call', id: call.id, name: call.name, args: parseArguments(call.arguments) }
      yield { type: 'finish', reason: calls.size ? 'tool_calls' : finishReason }
    } catch (error) {
      if (signal?.aborted) throw error
      if (error instanceof AppError) throw error
      throw new AppError('llm_failed', 'The model request timed out or could not reach the configured provider.', 502, true)
    }
  }
  return { streamCompletion, models }
}

function parseArguments(value) {
  try { return JSON.parse(value || '{}') } catch { return { invalidArguments: true } }
}
