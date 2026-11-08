import { timingSafeEqual } from 'node:crypto'

function equal(left, right) {
  const a = Buffer.from(left), b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createWorkspaceAuth(env = process.env) {
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    res.set('X-Content-Type-Options', 'nosniff')
    const token = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '')?.[1]
    const expected = env.RECALLLOOP_WORKSPACE_TOKEN
    if (expected && expected.length < 32) return res.status(503).json({ success: false, code: 'unauthorized', error: 'RECALLLOOP_WORKSPACE_TOKEN must contain at least 32 characters.' })
    const host = req.get('host') || ''
    const source = req.get('origin') || req.get('referer')
    const trustedOrigins = (env.RECALLLOOP_ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean)
    let sameOrigin = false
    let trustedOrigin = false
    try {
      const url = new URL(source)
      sameOrigin = url.host === host && ['http:', 'https:'].includes(url.protocol)
        && (url.protocol === `${req.protocol}:` || trustedOrigins.includes(url.origin))
      trustedOrigin = sameOrigin && trustedOrigins.includes(url.origin)
    } catch { /* no valid browser origin */ }
    const site = req.get('sec-fetch-site')
    if ((source && !sameOrigin) || (site && !['same-origin', 'none'].includes(site))) {
      return res.status(403).json({ success: false, code: 'unauthorized', error: 'Cross-origin workspace requests are not allowed.' })
    }
    if (sameOrigin) req.workspaceOrigin = new URL(source).origin
    if (expected && token && equal(token, expected)) return next()
    // An explicitly configured token cannot be bypassed by a forged Origin header.
    if (expected || env.RECALLLOOP_REQUIRE_WORKSPACE_AUTH === 'true') {
      return res.status(401).json({ success: false, code: 'unauthorized', error: 'Unlock this workspace with its configured bearer token in Settings.' })
    }
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    const peer = req.socket?.remoteAddress
    const loopback = !peer || ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)
    if (local && loopback && (sameOrigin || site === 'same-origin' || env.NODE_ENV !== 'production')) {
      req.workspaceOrigin ||= `${req.protocol}://${host}`
      return next()
    }
    // Remote origins are explicit; wallet signatures provide identity, not Origin headers.
    // This also prevents a DNS-rebinding Host from accessing a local workspace API.
    if (trustedOrigin) return next()
    return res.status(401).json({ success: false, code: 'unauthorized', error: 'Use the same-origin workspace or a configured workspace bearer token.' })
  }
}
