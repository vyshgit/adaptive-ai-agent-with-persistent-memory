import { timingSafeEqual } from 'node:crypto'

function safeEqual(a, b) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

// Protect developer-console/control routes independently from agent-scoped memory APIs.
// In production, place the dashboard behind an authenticated reverse proxy or provide
// the bearer header from a trusted server-side client; never embed this secret in frontend code.
export function authenticateAdmin(req, res, next) {
  const expected = process.env.RECALLLOOP_ADMIN_API_KEY
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ success: false, error: 'Admin API authentication is not configured.' })
    }
    return next()
  }
  if (expected.length < 32) {
    return res.status(500).json({ success: false, error: 'RECALLLOOP_ADMIN_API_KEY must contain at least 32 characters.' })
  }
  const match = /^Bearer ([^\\s]+)$/.exec(req.get('authorization') || '')
  if (!match || !safeEqual(match[1], expected)) {
    res.set('WWW-Authenticate', 'Bearer')
    return res.status(401).json({ success: false, error: 'A valid admin API key is required.' })
  }
  req.authenticatedRole = 'admin'
  return next()
}
