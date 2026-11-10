// Origin gate for the wallet workspace API, not an authorization layer:
// wallet signatures provide identity. Same-origin (or an explicitly trusted
// origin, e.g. behind a reverse proxy) is what a browser naturally sends.

export function createWorkspaceAuth(env = process.env) {
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    res.set('X-Content-Type-Options', 'nosniff')
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
    return res.status(401).json({ success: false, code: 'unauthorized', error: 'Use this workspace from its own origin (localhost or a trusted HTTPS origin).' })
  }
}
