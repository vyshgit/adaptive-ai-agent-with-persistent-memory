import { createHash } from 'node:crypto'
import { AppError, requireText, redactSecrets } from '../safety.mjs'
import { memoryNamespace } from './memwal-client.mjs'

export const hash = text => createHash('sha256').update(text).digest('hex')
export const itemKey = (agentId, sessionId, role, content) => hash([agentId, sessionId, role, content].join('\n'))
export const batchKey = keys => hash([...keys].sort().join('|'))

export function chunkItems(items, size = 20) {
  if (!Number.isInteger(size) || size < 1 || size > 20) throw new AppError('invalid_request', 'Batch size must be 1–20.')
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))
}

export function consolidate(input, { secrets = [], env = process.env } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('invalid_request', 'Provide a memory ingestion object.')
  const agentId = requireText(input.agentId, 'agentId', 128)
  const sessionId = requireText(input.sessionId, 'sessionId', 128, { pattern: /^[A-Za-z0-9._:-]+$/ })
  const mode = input.mode ?? env.RECALLLOOP_CAPTURE_MODE ?? 'both'
  if (!['both', 'verbatim', 'facts'].includes(mode)) throw new AppError('invalid_request', 'mode must be both, verbatim, or facts.')
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 50) {
    throw new AppError('invalid_request', 'messages must contain 1–50 entries.')
  }
  let occurredAt
  if (input.occurredAt !== undefined) {
    if (typeof input.occurredAt !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(input.occurredAt) || !Number.isFinite(Date.parse(input.occurredAt))) {
      throw new AppError('invalid_request', 'occurredAt must be an ISO-8601 UTC timestamp ending in Z.')
    }
    occurredAt = new Date(input.occurredAt).toISOString()
  }
  const messages = input.messages.map(message => {
    if (!message || !['user', 'assistant', 'tool', 'system'].includes(message.role)) throw new AppError('invalid_request', 'A message has an invalid role.')
    requireText(message.content, 'message.content', 20_000)
    const name = message.role === 'tool' ? requireText(message.name, 'tool.name', 64, { pattern: /^[A-Za-z0-9_-]+$/ }) : undefined
    return { role: message.role, content: redactSecrets(message.content, secrets, env), ...(name ? { name } : {}) }
  })
  if (messages.reduce((sum, message) => sum + message.content.length, 0) > 200_000) throw new AppError('invalid_request', 'Message capture exceeds 200,000 characters.')
  const raw = messages.map(message => ({
    text: `[${occurredAt || 'time not supplied'}] session=${sessionId} role=${message.role}${message.name ? ` name=${message.name}` : ''}\n${message.content}`,
    namespace: memoryNamespace(agentId, 'raw'),
    key: itemKey(agentId, sessionId, `${message.role}:${message.name || ''}`, message.content),
  }))
  // Assistant claims and unapproved code must not become established user facts.
  const transcript = messages.filter(message => message.role === 'user').map(message => message.content).join('\n\n')
  return { agentId, sessionId, mode, occurredAt, messages, raw, transcript, key: batchKey(raw.map(item => item.key)) }
}
