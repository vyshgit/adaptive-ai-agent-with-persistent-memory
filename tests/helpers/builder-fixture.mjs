import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'

export async function temporaryProject(t) {
  const directory = await mkdtemp('/tmp/opencode/recallloop-builder-test-')
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

export async function offlineModel(t, handler) {
  const requests = []
  const server = createServer(async (req, res) => {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const value = { path: req.url, headers: req.headers, body: JSON.parse(body) }
      requests.push(value)
      await handler(value, res, requests.length)
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: String(error.message) } }))
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(async () => { const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed })
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests }
}

export function chatFrames({ text = '', call, calls = call ? [call] : [], finish = calls.length ? 'tool_calls' : 'stop' } = {}) {
  const deltas = [{ role: 'assistant' }, calls.length ? { tool_calls: calls.map((item, index) => ({ index, id: item.id || 'fixture-call', type: 'function',
    function: { name: item.name, arguments: JSON.stringify(item.input) }, extra_content: item.extraContent })) } : { content: text }, {}]
  return deltas.map((delta, index) => `data: ${JSON.stringify({ id: 'fixture-chat', object: 'chat.completion.chunk', model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: index === 2 ? finish : null }] })}\n\n`).join('') + 'data: [DONE]\n\n'
}

export function responsesFrames({ text = '', call, id = 'provider-only-response' } = {}) {
  const item = call ? { type: 'function_call', id: 'provider-only-function', call_id: call.id || 'fixture-call', name: call.name,
    arguments: JSON.stringify(call.input), status: 'completed' }
    : { type: 'message', id: 'provider-only-message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }
  const frames = [{ type: 'response.created', response: { id, model: 'test-model', created_at: 1, status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, ...(call ? { arguments: '', status: 'in_progress' } : { content: [] }) } }]
  if (call) frames.push({ type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: item.arguments })
  else frames.push({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text })
  frames.push({ type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id, model: 'test-model', status: 'completed', output: [item],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } } })
  return frames.map(frame => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('')
}
