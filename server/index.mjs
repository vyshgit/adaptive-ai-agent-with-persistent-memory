// Must stay first — ESM runs every import before the body, so a setGlobalDispatcher()
// call further down lands after ./routes/* have made their module-scope calls.
import './proxy-bootstrap.mjs'
// Second, before any ./routes/* read the key at module load: this applies
// /creds/creds.json onto process.env, so `process.env.TATUM_API_KEY` is set on
// the controller path (which delivers the key as a file, not an env var) and
// stays live across the rotation push. A no-op where the key is already in env.
import './credentials-store.mjs'
import express from 'express'
import { createServer as createHttpServer } from 'http'
import { createServer as createViteServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'
import tatumRoutes from './routes/tatum.mjs'
import walrusRoutes from './routes/walrus.mjs'
import { credentialGuard } from './credential-guard.mjs'
import { existsSync } from 'node:fs'
import { createMemoryService } from './memory/service.mjs'
import { createLlm } from './agent/llm.mjs'
import { createConnectionStore } from './agent/connections.mjs'
import { createWorkspaceAuth } from './agent/workspace-auth.mjs'
import { createWalletAuth } from './agent/wallet-auth.mjs'
import { createSessionServices } from './agent/session-services.mjs'
import { createAgentRouter } from './routes/agent.mjs'
import { createMemoryRouter } from './routes/memory.mjs'
import { authenticateAgent } from './agent-auth.mjs'
import { authenticateAdmin } from './admin-auth.mjs'
import { publicError, AppError } from './safety.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

// Run from the project root. The preview-sidecar starts this server with CWD=/,
// but tooling that resolves paths from the CWD — notably Tailwind's `content`
// globs — must see the project files, or it silently generates no utilities
// (unstyled preview). `vite build` already runs from here; this makes dev match.
process.chdir(root)

const app = express()
// Redact known credentials before route parsers or handlers can send an error.
app.use(credentialGuard)

const demo = process.argv.includes('--demo')
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production'
if (production) process.env.NODE_ENV = 'production'
const env = demo ? { ...process.env, RECALLLOOP_MEMORY_MODE: 'mock', RECALLLOOP_LLM_MODE: 'mock', AGENT_LLM_MODEL: 'recallloop-mock', AGENT_MODELS: 'recallloop-mock' } : process.env
const agentId = env.RECALLLOOP_AGENT_ID || 'recallloop-workspace'
const memory = createMemoryService({ env })
const llm = createLlm({ env })
const connections = createConnectionStore({ env })
const services = createSessionServices({ env })
const wallets = createWalletAuth({ env, initialise: services.initialise })
app.get('/api/health', (_req, res) => res.json({ ok: true, product: 'RecallLoop', version: '0.2.0' }))
// Larger parsers precede the legacy 32 KB parser. No project files are written on the server.
app.use('/api/agent', createWorkspaceAuth(env), express.json({ limit: '1mb', inflate: false }), wallets.middleware,
  createAgentRouter({ llm, connections, wallets, services, env }))
app.use('/api/memory', express.json({ limit: '1mb' }), createMemoryRouter({ memory, authenticateAgent, authenticateAdmin, agentId }))
app.use(express.json({ limit: '32kb' }))

app.use('/api/tatum', tatumRoutes)
app.use('/api/walrus', walrusRoutes)
app.use('/api', (_req, res) => res.status(404).json({ success: false, code: 'not_found', error: 'Unknown API endpoint.' }))
app.use((error, _req, res, _next) => {
  if (res.headersSent) return res.end()
  const safe = error.type === 'entity.too.large' ? new AppError('invalid_request', 'Request body exceeds the route size limit.', 413)
    : error.type === 'entity.parse.failed' ? new AppError('invalid_request', 'Request body must be valid JSON.', 400)
    : error.type === 'encoding.unsupported' ? new AppError('invalid_request', 'Compressed workspace request bodies are not supported.', 415) : error
  res.status(safe instanceof AppError ? safe.status : 502).json(publicError(safe))
})

const server = createHttpServer(app)

// All Vite config is inline — no vite.config.js needed, no temp files written.
// cacheDir points to /tmp so dep pre-bundling works on read-only node_modules mounts.
let vite
if (production) {
  if (!existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Build the frontend first: npm run build')
  app.use(express.static(path.join(root, 'dist')))
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))
} else {
vite = await createViteServer({
  root,
  configFile: false,
  cacheDir: '/tmp/vite',
  plugins: [react()],
  server: {
    middlewareMode: true,
    hmr: { server },
    // Allow any Host — the preview is served on a per-project subdomain this file
    // cannot know. Must be the boolean `true` or an array; the string 'all' is
    // iterated per-character and silently blocks everything (no warning, no error).
    // NB: Vite's 403 body says to add the host to vite.config.js — that does not apply
    // here, `configFile: false` means any vite.config.js is silently ignored.
    allowedHosts: true,
  },
  appType: 'spa',
})
app.use(vite.middlewares)
}

const port = process.env.PORT ?? 3000
const host = process.env.HOST || '127.0.0.1'
server.listen(port, host, () => {
  console.log(`RecallLoop listening at http://${host}:${port}/#/agent${demo ? ' (explicit mock demo; memory is ephemeral)' : ''}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  wallets.close()
  memory.destroy()
  server.close(() => process.exit(0))
  server.closeAllConnections()
  void vite?.close()
})
