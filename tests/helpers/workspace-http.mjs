import express from 'express'
import { createServer } from 'node:http'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { createWorkspaceAuth } from '../../server/agent/workspace-auth.mjs'
import { createWalletAuth, WALLET_COOKIE } from '../../server/agent/wallet-auth.mjs'
import { createSessionServices } from '../../server/agent/session-services.mjs'
import { createConnectionStore } from '../../server/agent/connections.mjs'
import { createLlm } from '../../server/agent/llm.mjs'
import { createAgentRouter } from '../../server/routes/agent.mjs'
import { createMemoryRouter } from '../../server/routes/memory.mjs'
import { createMemoryService } from '../../server/memory/service.mjs'
import { authenticateAgent } from '../../server/agent-auth.mjs'
import { authenticateAdmin } from '../../server/admin-auth.mjs'
import { credentialGuard } from '../../server/credential-guard.mjs'
import { AppError, publicError } from '../../server/safety.mjs'
import { createBuilderService } from '../../server/builder/service.mjs'
import { localBuilderGuard } from '../../server/builder/policy.mjs'

export function deferred() {
  let resolve, reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

export function testEnv(t, values) {
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

// Same API mount order as server/index.mjs, without Vite, real keys, or remote services.
export async function workspaceHttp(t, options = {}) {
  const env = { RECALLLOOP_MEMORY_MODE: 'mock', RECALLLOOP_LLM_MODE: 'mock', ...options.env }
  const services = createSessionServices({ env, ...options.services })
  const sessions = []
  const wallets = createWalletAuth({ env, ...options.auth, initialise(session) {
    services.initialise(session)
    options.initialise?.(session)
    sessions.push(session)
  } })
  const connections = createConnectionStore(options.auth?.clock ? { clock: options.auth.clock } : {})
  const llm = options.llm || createLlm({ env, mockDelayMs: 0 })
  const memory = options.memory || createMemoryService({ env: { RECALLLOOP_MEMORY_MODE: 'mock' }, chain: { checkpoint: async () => null } })
  const builder = options.builder ? await createBuilderService({ enabled: true, assertSession: wallets.assertActive, secrets: services.secrets, env,
    ...options.builder }) : null
  const app = express()
  if (builder) app.use(localBuilderGuard)
  app.use(credentialGuard)
  app.use('/api/agent', createWorkspaceAuth(env), express.json({ limit: '1mb', inflate: false }), wallets.middleware,
    createAgentRouter({ llm, connections, wallets, services, builder, env }))
  app.use('/api/memory', express.json({ limit: '1mb' }), createMemoryRouter({ memory, authenticateAgent, authenticateAdmin }))
  app.use(express.json({ limit: '32kb' }))
  app.post('/api/legacy-limit', (_req, res) => res.json({ success: true }))
  app.use('/api', (_req, res) => res.status(404).json({ success: false, code: 'not_found' }))
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end()
    const safe = error.type === 'entity.too.large' ? new AppError('invalid_request', 'Request body exceeds the route size limit.', 413)
      : error.type === 'entity.parse.failed' ? new AppError('invalid_request', 'Request body must be valid JSON.', 400)
      : error.type === 'encoding.unsupported' ? new AppError('invalid_request', 'Compressed workspace request bodies are not supported.', 415) : error
    res.status(safe instanceof AppError ? safe.status : 502).json(publicError(safe))
  })
  const server = createServer(app)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const origin = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    await wallets.close()
    await builder?.close()
    memory.destroy?.()
    const closed = new Promise(resolve => server.close(resolve))
    server.closeAllConnections()
    await closed
  })

  function client(initial = {}) {
    let cookie = initial.cookie || '', tag = initial.tag || ''
    async function request(path, { body, method = body === undefined ? 'GET' : 'POST', headers: extra, ...init } = {}) {
      const headers = new Headers({ Origin: origin, ...initial.headers, ...extra })
      if (cookie) headers.set('Cookie', cookie)
      if (tag && !headers.has('X-RecallLoop-Session')) headers.set('X-RecallLoop-Session', tag)
      if (body !== undefined) headers.set('Content-Type', 'application/json')
      const response = await fetch(`${origin}${path.startsWith('/api/') ? path : `/api/agent${path}`}`, {
        method, ...init, headers, body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
      })
      const issued = response.headers.get('set-cookie')
      if (issued) cookie = issued.split(';')[0]
      return response
    }
    async function json(path, init) {
      const response = await request(path, init)
      const data = await response.json()
      if (Object.hasOwn(data, 'sessionTag')) tag = data.sessionTag || ''
      return { status: response.status, headers: response.headers, data }
    }
    async function login(pair = Ed25519Keypair.generate()) {
      const challenge = await json('/auth/challenge', { body: { address: pair.toSuiAddress() } })
      if (challenge.status !== 200) throw new Error(`Test challenge failed: HTTP ${challenge.status}`)
      const { signature } = await pair.signPersonalMessage(new TextEncoder().encode(challenge.data.message))
      const result = await json('/auth/verify', { body: { address: pair.toSuiAddress(), challengeId: challenge.data.challengeId, signature } })
      return { ...result, pair, challenge }
    }
    return { request, json, login, demo: () => json('/auth/demo', { body: {} }), get cookie() { return cookie }, get tag() { return tag } }
  }
  return { app, origin, wallets, services, connections, sessions, memory, builder, client, cookieName: WALLET_COOKIE }
}
