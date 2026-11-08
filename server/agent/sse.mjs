import { AppError } from '../safety.mjs'

export async function readLimitedText(response, max = 1_000_000) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      bytes += value.byteLength
      if (bytes > max) throw new AppError('llm_failed', 'The provider response exceeded the size limit.', 502)
      text += decoder.decode(value, { stream: true })
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export async function* parseSse(body) {
  if (!body) throw new AppError('llm_failed', 'The provider returned no response body.', 502, true)
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let frames = 0
  let bytes = 0
  function frame(value) {
    const lines = value.split(/\r?\n/)
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message'
    return data ? { event, data } : null
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      bytes += value?.byteLength || 0
      if (bytes > 2_000_000) throw new AppError('llm_failed', 'The provider stream exceeded the total size limit.', 502)
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let match
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        if (match.index > 262_144) throw new AppError('llm_failed', 'The provider stream frame exceeded the size limit.', 502)
        const item = frame(buffer.slice(0, match.index))
        buffer = buffer.slice(match.index + match[0].length)
        if (++frames > 10_000) throw new AppError('llm_failed', 'Too many provider stream frames.', 502)
        if (item) yield item
      }
      if (buffer.length > 262_144) throw new AppError('llm_failed', 'The provider stream frame exceeded the size limit.', 502)
      if (done) { const item = frame(buffer); if (item) yield item; return }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
