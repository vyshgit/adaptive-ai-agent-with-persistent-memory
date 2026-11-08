import { setTimeout as delay } from 'node:timers/promises'
import { AppError, clampNumber } from '../safety.mjs'
import { validateProviderUrl } from './connections.mjs'
import { parseSse, readLimitedText } from './sse.mjs'
import { providerFailure, providerNetworkFailure } from './provider-errors.mjs'

function checkCalls(calls, complete = false) {
  if (calls.size > 4 || [...calls.values()].some(call => typeof call.id !== 'string' || call.id.length > 128
    || typeof call.name !== 'string' || call.name.length > 64 || typeof call.arguments !== 'string' || call.arguments.length > 32_000
    || (complete && (!call.id || !/^[A-Za-z0-9_-]{1,64}$/.test(call.name))))) {
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
  function requestHeaders(config) {
    const headers = new Headers({ 'Content-Type': 'application/json', 'User-Agent': 'RecallLoop/0.2.0' })
    if (config.apiKey) headers.set('Authorization', `Bearer ${config.apiKey}`)
    if (env.AGENT_LLM_EXTRA_HEADERS) {
      let extra
      try { extra = JSON.parse(env.AGENT_LLM_EXTRA_HEADERS) } catch { throw new AppError('llm_not_configured', 'AGENT_LLM_EXTRA_HEADERS must be valid JSON.', 503) }
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new AppError('llm_not_configured', 'AGENT_LLM_EXTRA_HEADERS must be a JSON object.', 503)
      const allowed = ['http-referer', 'x-title', 'openai-organization', 'openai-project']
      for (const [key, value] of Object.entries(extra)) {
        if (!allowed.includes(key.toLowerCase()) || typeof value !== 'string') throw new AppError('llm_not_configured', 'Only legitimate attribution and OpenAI organisation/project headers are supported.', 503)
        headers.set(key, value)
      }
    }
    return headers
  }

  async function models(config, signal) {
    signal?.throwIfAborted()
    if (config.mode === 'mock') return { models: ['recallloop-mock'], discovered: false, verified: false }
    validateProviderUrl(config.baseUrl, env)
    const headers = requestHeaders(config)
    const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)])
    let response
    try {
      response = await fetchImpl(`${config.baseUrl}/models`, { headers, redirect: 'error', signal: deadline })
      if ([404, 405, 501].includes(response.status)) { await response.body?.cancel(); return { models: [config.model], discovered: false, verified: false } }
      if (!response.ok) throw providerFailure(response.status, await readLimitedText(response, 100_000))
      let data
      try { data = JSON.parse(await readLimitedText(response)) } catch (error) {
        if (error instanceof AppError) throw error
        signal?.throwIfAborted()
        if (deadline.aborted) throw providerNetworkFailure(deadline, 'models discovery request')
        throw new AppError('provider_invalid_response', 'The models endpoint did not return valid JSON. Check that this is an API base URL, not a dashboard URL.', 502)
      }
      if (!data || !Array.isArray(data.data)) throw new AppError('provider_invalid_response', 'The models endpoint must return an OpenAI-compatible data array.', 502)
      const available = data.data.filter(item => item && typeof item.id === 'string' && /^[A-Za-z0-9._:/@+-]{1,128}$/.test(item.id)).map(item => item.id)
      // An advertised model is not proof that this account can generate with it.
      return { models: [...new Set([config.model, ...available])].slice(0, 100), discovered: true, verified: false }
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof AppError) throw error
      throw providerNetworkFailure(deadline, 'models discovery request')
    }
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

  async function* streamCompletion({ messages, memories, project, tools = [], model, config, signal, stream = true, maxOutputTokens, toolChoice, allowStreamFallback = true, requestTimeoutMs = 60_000 }) {
    signal?.throwIfAborted()
    if (config.mode === 'mock') { yield* mockCompletion({ messages, memories, project, tools, signal }); return }
    if (config.mode !== 'live' || !config.baseUrl || !model || (!config.apiKey && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.baseUrl).hostname))) {
      throw new AppError('llm_not_configured', 'Connect a model API in Settings, configure AGENT_LLM_*, or run the explicit mock demo.', 503)
    }
    validateProviderUrl(config.baseUrl, env)
    if (!['responses', 'chat'].includes(config.apiStyle)) throw new AppError('llm_not_configured', 'Select the responses or chat API style.', 503)
    const responses = config.apiStyle === 'responses'
    const outputTokens = maxOutputTokens === undefined ? Math.floor(clampNumber(Number(env.AGENT_LLM_MAX_OUTPUT_TOKENS), 4000, 400, 8000))
      : Math.floor(clampNumber(maxOutputTokens, 256, 16, 8000))
    const modernOpenAiChat = new URL(config.baseUrl).hostname === 'api.openai.com' && /^(?:gpt-(?:[5-9]|[1-9]\d)|o[134])/.test(model)
    const body = responses ? { model, instructions: messages.find(message => message.role === 'system')?.content || '',
      input: toResponsesInput(messages), store: false, max_output_tokens: outputTokens,
      ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', ...tool.function })), ...(toolChoice ? { tool_choice: { type: 'function', name: toolChoice } } : {}) } : {}) }
      : { model, messages: toChatInput(messages), [modernOpenAiChat ? 'max_completion_tokens' : 'max_tokens']: outputTokens, store: false,
        ...(tools.length ? { tools, ...(toolChoice ? { tool_choice: { type: 'function', function: { name: toolChoice } } } : {}) } : {}) }
    const headers = requestHeaders(config)
    const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(requestTimeoutMs)])
    const request = streaming => fetchImpl(`${config.baseUrl}/${responses ? 'responses' : 'chat/completions'}`, {
      method: 'POST', headers, body: JSON.stringify({ ...body, stream: streaming }), signal: deadline, redirect: 'error',
    })
    let response
    try {
      response = await request(stream)
      if (!response.ok) {
        const text = await readLimitedText(response, 100_000)
        const failure = providerFailure(response.status, text)
        if (stream && allowStreamFallback && failure.code === 'provider_streaming_unsupported') response = await request(false)
        else throw failure
      }
      if (!response.ok) throw providerFailure(response.status, await readLimitedText(response, 100_000))
      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        let data
        try { data = JSON.parse(await readLimitedText(response)) } catch (error) {
          if (error instanceof AppError) throw error
          signal?.throwIfAborted()
          if (deadline.aborted) throw providerNetworkFailure(deadline)
          throw new AppError('provider_invalid_response', 'The model endpoint did not return valid JSON or SSE. Check the API base URL and protocol.', 502)
        }
        if (data?.error) throw providerFailure(Number(data.error.status) || 400, JSON.stringify(data.error))
        if (!data || typeof data !== 'object' || Array.isArray(data) || (responses && data.status && !['completed', 'incomplete'].includes(data.status))
          || (responses ? !Array.isArray(data.output) : !Array.isArray(data.choices))) {
          throw new AppError('provider_invalid_response', 'The provider failed to complete a response in the selected protocol.', 502, true)
        }
        const parts = responses ? data.output.filter(item => item?.type === 'message').flatMap(item => Array.isArray(item.content) ? item.content : [])
          .filter(part => part?.type === 'output_text' || part?.type === 'refusal').map(part => part.text ?? part.refusal) : []
        const toolCalls = responses ? [] : data.choices[0]?.message?.tool_calls
        const chatText = responses ? null : data.choices[0]?.message?.content
        if (parts.some(part => typeof part !== 'string') || (toolCalls !== undefined && !Array.isArray(toolCalls))
          || (chatText !== undefined && chatText !== null && typeof chatText !== 'string')) {
          throw new AppError('provider_invalid_response', 'The model returned malformed text or function-call output.', 502)
        }
        const text = responses ? parts.join('') : chatText || ''
        const calls = responses ? data.output.filter(item => item?.type === 'function_call').map(item => ({ id: item.call_id, name: item.name, arguments: item.arguments }))
          : (toolCalls || []).map(item => ({ id: item?.id, name: item?.function?.name, arguments: item?.function?.arguments }))
        if (typeof text !== 'string' || text.length > 40_000) {
          throw new AppError('llm_failed', 'The model output exceeded the turn limits or had an invalid format.', 502)
        }
        checkCalls(new Map(calls.map((call, index) => [index, call])), true)
        if (text) yield { type: 'delta', text }
        for (const call of calls) yield { type: 'tool_call', id: call.id, name: call.name, args: parseArguments(call.arguments) }
        yield { type: 'finish', reason: calls.length ? 'tool_calls' : data.status === 'incomplete' ? 'length' : data.choices?.[0]?.finish_reason || 'stop', usage: data.usage, transport: 'json' }
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
        if (data.error || data.response?.error) throw providerFailure(Number(data.error?.status || data.response?.error?.status) || 500, JSON.stringify(data.error || data.response.error))
        if (['response.failed', 'response.cancelled', 'error'].includes(type)) throw new AppError('provider_request_failed', 'The provider reported a generation failure.', 502, true)
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
            for (const item of Array.isArray(data.response?.output) ? data.response.output : []) if (item?.type === 'function_call') calls.set(item.id || item.call_id, {
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
      checkCalls(calls, true)
      for (const call of calls.values()) yield { type: 'tool_call', id: call.id, name: call.name, args: parseArguments(call.arguments) }
      yield { type: 'finish', reason: calls.size ? 'tool_calls' : finishReason, transport: 'sse' }
    } catch (error) {
      if (signal?.aborted) throw error
      if (error instanceof AppError) throw error
      throw providerNetworkFailure(deadline)
    }
  }

  async function verify(config, { signal, checkCapabilities = false } = {}) {
    signal?.throwIfAborted()
    if (config.mode === 'mock') return { verified: false, verification: null }
    // No project, conversation, memory, real tool execution, or capture is involved.
    const messages = [{ role: 'system', content: 'You are checking a RecallLoop coding-agent connection. Follow the short coding check exactly.' },
      { role: 'user', content: 'For this coding API connection check, reply with exactly OK. Do not call any tools.' }]
    const probe = async options => {
      let text = '', finish, calls = []
      for await (const event of streamCompletion({ messages, model: config.model, config, signal, stream: false, maxOutputTokens: 256, requestTimeoutMs: 20_000, ...options })) {
        if (event.type === 'delta') text += event.text
        if (event.type === 'tool_call') calls.push(event)
        if (event.type === 'finish') finish = event
      }
      signal?.throwIfAborted()
      if (!finish || finish.reason === 'length') throw new AppError('provider_incomplete', 'The connection check did not complete within its small output budget. Generation was not verified; choose a suitable model or check provider settings.', 502)
      return { text, finish, calls }
    }
    const generated = await probe({})
    if (!generated.text.trim() || generated.calls.length) throw new AppError('provider_invalid_response', 'The provider returned no plain-text answer to the coding connection check. Generation was not verified.', 502)
    const verification = { model: config.model, apiStyle: config.apiStyle, checkedAt: new Date().toISOString(),
      generation: 'verified', streaming: 'not_checked', tools: 'not_checked' }
    if (checkCapabilities) {
      try {
        const streamed = await probe({ stream: true, allowStreamFallback: false })
        if (!streamed.text.trim() || streamed.calls.length) throw new AppError('provider_invalid_response', 'The streaming check returned no plain-text answer.', 502)
        verification.streaming = streamed.finish.transport === 'sse' ? 'verified' : 'unsupported'
      } catch (error) {
        signal?.throwIfAborted()
        if (!(error instanceof AppError)) throw error
        verification.streaming = error.code === 'provider_streaming_unsupported' ? 'unsupported' : 'failed'
        verification.streamingError = { code: error.code, message: error.message }
      }
      if (config.toolsEnabled) {
        const name = 'recallloop_connection_check'
        const tools = [{ type: 'function', function: { name, description: 'A non-executing coding API compatibility check. It cannot read files, run commands, or write memories.',
          parameters: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } }]
        try {
          const result = await probe({ tools, toolChoice: name, messages: [messages[0], { role: 'user', content: 'Call recallloop_connection_check once with ok: true. This checks coding function-call transport only; nothing is executed.' }] })
          if (result.calls.length !== 1 || result.calls[0].name !== name || !result.calls[0].id || result.calls[0].args?.ok !== true
            || Object.keys(result.calls[0].args).length !== 1) throw new AppError('provider_invalid_response', 'The provider did not return the requested valid function call. Tool support was not verified.', 502)
          verification.tools = 'verified'
        } catch (error) {
          signal?.throwIfAborted()
          if (!(error instanceof AppError)) throw error
          verification.tools = error.code === 'provider_tools_unsupported' ? 'unsupported' : 'failed'
          verification.toolsError = { code: error.code, message: error.message }
        }
      }
    }
    return { verified: true, verification }
  }
  return { streamCompletion, models, verify }
}

function parseArguments(value) {
  try { return JSON.parse(value || '{}') } catch { return { invalidArguments: true } }
}
