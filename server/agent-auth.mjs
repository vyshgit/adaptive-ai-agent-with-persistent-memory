import { timingSafeEqual } from 'node:crypto'
import { logicalAgentId } from './memory/memwal-client.mjs'
const MAX_API_KEYS_JSON_LENGTH = 16_384
function readAgentKeys() {
  const raw = process.env.RECALLLOOP_API_KEYS
  if (!raw) return null
  if (raw.length > MAX_API_KEYS_JSON_LENGTH) throw new Error('RECALLLOOP_API_KEYS exceeds the 16KB configuration limit.')
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new Error('RECALLLOOP_API_KEYS must be a JSON object mapping agent IDs to API keys.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('RECALLLOOP_API_KEYS must be a JSON object mapping agent IDs to API keys.')
  const entries = Object.entries(parsed)
  if (!entries.length || entries.some(([id, key]) => id !== id.trim() || !id || id.length > 128
    || typeof key !== 'string' || key.length < 32 || key.length > 4096 || /[^\x21-\x7e]/.test(key))) {
    throw new Error('Each key needs a canonical agent ID (max 128 chars) and a secret of 32–4096 printable ASCII characters without spaces.')
  }
  if (new Set(entries.map(([, key]) => key)).size !== entries.length) throw new Error('Each logical agent must have a different API key.')
  for (const [id] of entries) logicalAgentId(id)
  return new Map(entries)
}
function safeEqual(a, b) { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right) }
export function authenticateAgent(req, res, next) {
  let keys
  try { keys = readAgentKeys() } catch (error) { return res.status(500).json({ success: false, error: error.message }) }
  if (!keys) {
    return res.status(503).json({ success: false, error: 'Agent API authentication is not configured. Set RECALLLOOP_API_KEYS to enable external memory APIs.' })
  }
  const match = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '')
  if (!match) { res.set('WWW-Authenticate', 'Bearer'); return res.status(401).json({ success: false, error: 'A valid agent API key is required.' }) }
  let owner = null
  for (const [agentId, expected] of keys) if (safeEqual(match[1], expected)) owner = agentId
  if (!owner) return res.status(401).json({ success: false, error: 'A valid agent API key is required.' })
  if (typeof req.body?.agentId !== 'string' || req.body.agentId.trim() !== owner) return res.status(403).json({ success: false, error: 'The API key is not authorized for the requested agentId.' })
  req.authenticatedAgentId = owner
  return next()
}
