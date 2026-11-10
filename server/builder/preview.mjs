import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { AppError } from '../safety.mjs'
import { BUILDER_LIMITS, localPeer, relativePath } from './policy.mjs'

const types = new Map(Object.entries({ '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' }))

// A second HTTP origin in the SAME process, not a dev server or reverse proxy.
// It can return only pre-read, bounded static snapshots through expiring random
// capabilities. There are no wallet/API routes, credentials, cookies or live fs reads.
export async function createStaticPreview({ clock = Date.now } = {}) {
  const snapshots = new Map()
  let origin, creating = 0, closed = false
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Access-Control-Allow-Origin', 'null') // sandboxed ES-module loads; never credentials
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    const fail = code => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; sandbox" }); res.end('Static preview unavailable or expired.') }
    if (!localPeer(req) || req.headers.host !== new URL(origin).host || !['GET', 'HEAD'].includes(req.method)) return fail(403)
    let token, name
    try {
      const url = new URL(req.url, origin)
      if (url.search || url.hash) return fail(404)
      const parts = url.pathname.split('/').slice(1)
      token = parts.shift()
      name = relativePath(parts.map(decodeURIComponent).join('/'))
    } catch { return fail(404) }
    const snapshot = snapshots.get(token)
    if (!snapshot || snapshot.expiresAt <= clock()) { if (snapshot) snapshots.delete(token); return fail(404) }
    const asset = snapshot.assets.get(name)
    if (!asset) return fail(404)
    // No external fetches, workers, forms, nested frames, popups, top navigation
    // or same-origin privilege. The sandbox also applies if opened as a new tab.
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src ${origin} 'unsafe-inline'; style-src ${origin} 'unsafe-inline'; img-src ${origin} data: blob:; font-src ${origin} data:; connect-src 'none'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${snapshot.parent}; sandbox allow-scripts`)
    res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': Buffer.byteLength(asset.content) })
    res.end(req.method === 'HEAD' ? undefined : asset.content)
  })
  server.on('clientError', (_error, socket) => socket.destroy())
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${server.address().port}`
  const timer = setInterval(() => { for (const [token, value] of snapshots) if (value.expiresAt <= clock()) snapshots.delete(token) }, 30_000)
  timer.unref()
  return { origin,
    async create({ files, directory = 'dist', entry = 'index.html', origin: parent, signal }) {
      signal?.throwIfAborted()
      if (closed) throw new AppError('preview_unavailable', 'The static preview listener is closed.', 503)
      if (snapshots.size + creating >= BUILDER_LIMITS.workspaces) throw new AppError('busy', 'Close an existing static preview before opening another.', 429, true)
      if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(parent || '')) throw new AppError('local_only', 'Preview embedding requires the trusted local app origin.', 403)
      relativePath(directory, { directory: true }); relativePath(entry)
      if (!/\.html?$/i.test(entry)) throw new AppError('invalid_request', 'Choose an HTML entry inside the static output folder.')
      creating++
      try {
        const assets = new Map(), queue = [directory]
        let bytes = 0, scanned = 0
        while (queue.length) {
          signal?.throwIfAborted()
          const page = await files.list(queue.shift(), { signal })
          scanned += page.scanned
          if (page.truncated || scanned > BUILDER_LIMITS.scannedEntries) throw new AppError('preview_limit', 'The static output folder is too large to snapshot. Choose a smaller public build folder.', 413)
          for (const item of page.entries) {
            if (item.type === 'directory') { queue.push(item.path); continue }
            const type = types.get(path.extname(item.path).toLowerCase())
            if (!type) continue
            if (assets.size >= BUILDER_LIMITS.previewFiles || item.bytes > BUILDER_LIMITS.previewFileBytes || bytes + item.bytes > BUILDER_LIMITS.previewBytes) {
              throw new AppError('preview_limit', 'The static snapshot exceeded its file or byte budget.', 413)
            }
            const file = await files.read(item.path, { maxBytes: BUILDER_LIMITS.previewFileBytes, signal })
            if (file.redacted) throw new AppError('sensitive_file', 'This static output contains a recognized credential. It cannot be exposed in a preview.', 403)
            if (bytes + file.bytes > BUILDER_LIMITS.previewBytes) throw new AppError('preview_limit', 'The static files grew beyond the snapshot byte budget.', 413)
            bytes += file.bytes
            assets.set(directory === '.' ? item.path : item.path.slice(directory.length + 1), { content: file.content, type })
          }
        }
        signal?.throwIfAborted()
        if (closed) throw new AppError('preview_unavailable', 'The static preview listener closed while reading files.', 503)
        if (!assets.has(entry)) throw new AppError('file_missing', 'The HTML entry was not found in this static output folder. Approve a build command first if needed.', 404)
        const token = randomBytes(32).toString('hex'), expiresAt = clock() + BUILDER_LIMITS.previewMs
        snapshots.set(token, { assets, parent, expiresAt })
        return { id: token, url: `${origin}/${token}/${entry.split('/').map(encodeURIComponent).join('/')}`, expiresAt,
          files: assets.size, bytes, warning: 'Static, sandboxed snapshot. Fetches, external assets and backend APIs are blocked; only text/web assets are supported. This is not an OS or general network sandbox. Build with relative asset URLs. Closing the folder, preview or login revokes this link.' }
      } finally { creating-- }
    },
    revoke(token) { snapshots.delete(token) },
    async close() {
      if (closed) return
      closed = true; clearInterval(timer); snapshots.clear()
      const done = new Promise(resolve => server.close(resolve))
      server.closeAllConnections(); await done
    } }
}
