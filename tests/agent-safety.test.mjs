import test from 'node:test'
import assert from 'node:assert/strict'
import { redactSecrets, redactValue, createStreamRedactor, within, publicError, AppError } from '../server/safety.mjs'
import { parseSse, readLimitedText } from '../server/agent/sse.mjs'

function body(chunks) {
  const encoder = new TextEncoder()
  return new ReadableStream({ start(controller) { for (const text of chunks) controller.enqueue(encoder.encode(text)); controller.close() } })
}

test('redacts environment, session and pasted credentials without changing public IDs', () => {
  const env = { MEMWAL_PRIVATE_KEY: 'a'.repeat(64), RECALLLOOP_API_KEYS: JSON.stringify({ agent: 'agent-secret-value' }) }
  const text = `blob-public ${env.MEMWAL_PRIVATE_KEY} agent-secret-value session-secret-value sk-proj-01234567890123456789`
  assert.equal(redactSecrets(text, ['session-secret-value'], env), 'blob-public [REDACTED] [REDACTED] [REDACTED] [REDACTED]')
  assert.deepEqual(redactValue({ nested: ['quote"secret\\value'] }, ['quote"secret\\value'], {}), { nested: ['[REDACTED]'] })
})

test('stream redaction holds secret prefixes across every possible chunk boundary', () => {
  for (const secret of ['temporary-api-secret', 'sk-proj-01234567890123456789', 'suiprivkey1' + 'a'.repeat(50)]) {
    for (let split = 1; split < secret.length; split++) {
      const redactor = createStreamRedactor([secret], {})
      const output = redactor.push(`Before ${secret.slice(0, split)}`) + redactor.push(`${secret.slice(split)} after`) + redactor.finish()
      assert.equal(output, 'Before [REDACTED] after')
    }
    const redactor = createStreamRedactor([], {})
    if (secret.startsWith('sk-') || secret.startsWith('suiprivkey1')) {
      const output = [...`Before ${secret} after`].map(char => redactor.push(char)).join('') + redactor.finish()
      assert.equal(output, 'Before [REDACTED] after')
    }
  }
})

test('SSE parser handles CRLF, multiline data, heartbeats and chunk splits', async () => {
  const source = ': ping\r\n\r\nevent: delta\r\ndata: {"text":\r\ndata: "€ hello"}\r\n\r\ndata: [DONE]\n\n'
  const events = []
  for await (const frame of parseSse(body([...source]))) events.push(frame)
  assert.deepEqual(events, [{ event: 'delta', data: '{"text":\n"€ hello"}' }, { event: 'message', data: '[DONE]' }])
})

test('SSE and JSON readers reject oversized payloads and release the body', async () => {
  await assert.rejects(async () => { for await (const _ of parseSse(body(['data: ' + 'x'.repeat(270_000)]))) {} }, /size limit/)
  await assert.rejects(readLimitedText(new Response(body(['12345'])), 4), /size limit/)
})

test('deadline and cancellation return promptly without an unhandled late rejection', async () => {
  let reject
  const operation = new Promise((_, no) => { reject = no })
  assert.equal(await within(operation, 1, 'pending'), 'pending')
  reject(new Error('late failure'))
  const controller = new AbortController()
  controller.abort(new DOMException('Stopped', 'AbortError'))
  await assert.rejects(within(new Promise(() => {}), 1000, null, controller.signal), { name: 'AbortError' })
  assert.equal(publicError(new Error('sensitive upstream details')).error.includes('sensitive'), false)
  assert.equal(publicError(new AppError('invalid_request', 'Safe validation message')).code, 'invalid_request')
})
