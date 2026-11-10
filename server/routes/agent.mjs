import { Router } from 'express'
import { once } from 'node:events'
import { AppError, asyncRoute, publicError, redactValue } from '../safety.mjs'
import { validateConnection, validateModelDiscovery, publicConnection, publicModels } from '../agent/connections.mjs'
import { validateChat, runChat } from '../agent/chat.mjs'
import { createMemoryHandoff } from '../agent/memory-handoff.mjs'

export function createAgentRouter({ llm, connections, wallets, services, env = process.env }) {
  const router = Router()
  let active = 0
  let operations = 0
  let requests = 0
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.get('/auth/session', (req, res) => res.json(wallets.publicSession(req.workspaceSession)))
  router.post('/auth/challenge', asyncRoute(async (req, res) => res.json(wallets.challenge(req, res, req.body))))
  router.post('/auth/verify', asyncRoute(async (req, res) => res.json(await wallets.login(req, res, req.body))))
  router.post('/auth/demo', asyncRoute(async (req, res) => res.json(wallets.demo(req, res))))
  router.post('/auth/logout', asyncRoute(async (req, res) => {
    const session = req.workspaceSession
    const result = wallets.logout(req, res)
    res.json(result)
  }))
  router.use(wallets.requireSession, connections.middleware, (req, res, next) => {
    if (requests >= 48 || req.workspaceSession.controllers.size >= 8) return next(new AppError('busy', 'Too many workspace requests. Wait for the current requests to finish.', 429, true))
    // Keep request-time secrets until this response closes, even if logout wipes the session.
    const secrets = [...services.secrets(req.workspaceSession), req.body?.apiKey, req.body?.delegateKey].filter(Boolean)
    const json = res.json.bind(res)
    res.json = value => json(redactValue(value, [...secrets, ...services.secrets(req.workspaceSession)]))
    const controller = new AbortController()
    req.workspaceController = controller
    req.workspaceSession.controllers.add(controller)
    requests++
    const cleanup = () => { requests--; req.workspaceSession.controllers.delete(controller); if (!res.writableEnded) controller.abort(new DOMException('Client disconnected', 'AbortError')) }
    res.once('close', cleanup)
    next()
  })
  async function operation(req, task) {
    const session = wallets.assertActive(req.workspaceSession)
    if (session.active || session.changing || operations >= 8) throw new AppError('busy', 'Finish or stop the current operation before changing connections or writing memories.', 429, true)
    session.changing = true
    operations++
    let result
    try {
      result = await task(session, req.workspaceController.signal)
      wallets.assertActive(session)
      req.workspaceController.signal.throwIfAborted()
      const value = result?.commit ? result.commit() : result
      return value
    } catch (error) {
      if (session.disposed) wallets.assertActive(session)
      throw error
    } finally { result?.cleanup?.(); session.changing = false; operations-- }
  }
  router.get('/status', asyncRoute(async (req, res) => {
    const session = req.workspaceSession
    const memory = await session.memory.status()
    wallets.assertActive(session)
    req.workspaceController.signal.throwIfAborted()
    res.json({ agentId: session.agentId, auth: wallets.publicSession(session), llm: publicConnection(req.llmConfig), modelConnections: connections.list(req),
      memory, memoryConnection: session.memoryConnection || null,
      tatum: session.tatum, coding: { maxToolRounds: 3, reviewRequired: true,
        permissionPolicy: 'browser-proposals-only' } })
  }))
  router.get('/models', asyncRoute(async (req, res) => res.json(publicConnection(connections.select(req, req.query.connectionId)).models)))
  router.post('/models/discover', asyncRoute(async (req, res) => {
    const discovered = await operation(req, async (session, signal) => {
      if (session.kind === 'demo') throw new AppError('wallet_required', 'The offline demo never contacts live model catalogues. Sign in with your wallet first.', 403)
      const config = validateModelDiscovery(req.body, env)
      try {
        const result = await llm.models(config, signal)
        // Do not echo a credential advertised as a model by an upstream server.
        return { success: true, baseUrl: config.baseUrl, apiStyle: config.apiStyle, models: publicModels({ ...config, models: result.models, catalogue: result.catalogue }),
          discovered: result.discovered === true, verified: false }
      } finally { config.apiKey = '' }
    })
    res.json(discovered)
  }))
  router.post('/connect', asyncRoute(async (req, res) => {
    const connection = await operation(req, async session => {
      if (session.kind === 'demo' && req.body.mode !== 'mock') throw new AppError('wallet_required', 'The offline demo does not accept live credentials. Sign in with your wallet first.', 403)
      const config = connections.admit(req, validateConnection(req.body, env))
      try {
        const discovered = await llm.models(config, req.workspaceController.signal)
        config.models = discovered.models
        config.catalogue = discovered.catalogue
        req.workspaceController.signal.throwIfAborted()
        const checked = await llm.verify(config, { signal: req.workspaceController.signal, checkCapabilities: req.body.checkCapabilities === true })
        config.verification = checked.verification ? { ...checked.verification, discovery: discovered.discovered ? 'available' : 'unavailable' } : null
        return { commit: () => connections.connect(req, config), cleanup() { config.apiKey = '' } }
      } catch (error) { config.apiKey = ''; throw error }
    })
    res.json({ success: true, connection })
  }))
  router.post('/verify', asyncRoute(async (req, res) => {
    const connection = await operation(req, async (session, signal) => {
      const previous = connections.select(req, req.body.connectionId)
      if (!previous || previous.mode !== 'live') throw new AppError('llm_not_configured', 'Connect a live model API before verifying its saved session connection.', 412)
      for (const name of ['checkCapabilities', 'toolsEnabled']) if (req.body[name] !== undefined && typeof req.body[name] !== 'boolean') throw new AppError('invalid_request', `${name} must be a boolean.`)
      const config = { ...previous, ...(req.body.toolsEnabled !== undefined ? { toolsEnabled: req.body.toolsEnabled } : {}), lastVerificationFailure: null }
      try {
        const checked = await llm.verify(config, { signal, checkCapabilities: req.body.checkCapabilities === true })
        config.verification = { ...checked.verification, discovery: previous.verification?.discovery || 'unavailable' }
        return { commit: () => connections.connect(req, config), cleanup() { config.apiKey = '' } }
      } catch (error) {
        config.apiKey = ''
        if (!signal.aborted && !session.disposed && session.modelConnections?.get(previous.id) === previous) {
          const safe = publicError(error)
          previous.lastVerificationFailure = { checkedAt: new Date().toISOString(), code: safe.code, message: safe.error }
        }
        throw error
      }
    })
    res.json({ success: true, connection })
  }))
  router.post('/disconnect', asyncRoute(async (req, res) => { await operation(req, async () => connections.disconnect(req, req.body.connectionId)); res.json({ success: true }) }))
  router.post('/connections/tatum', asyncRoute(async (req, res) => res.json({ success: true,
    connection: await operation(req, (session, signal) => services.connectTatum(session, req.body, signal)) })))
  router.post('/connections/memwal', asyncRoute(async (req, res) => res.json({ success: true,
    connection: await operation(req, (session, signal) => services.connectMemory(session, req.body, signal)) })))
  router.post('/connections/tatum/verify', asyncRoute(async (req, res) => res.json({ success: true,
    connection: await operation(req, (session, signal) => services.connectTatum(session, { apiKey: session.tatumKey }, signal)) })))
  router.post('/connections/memwal/verify', asyncRoute(async (req, res) => res.json({ success: true,
    connection: await operation(req, (session, signal) => services.connectMemory(session, { accountId: session.memoryConnection?.accountId, delegateKey: session.env.MEMWAL_PRIVATE_KEY }, signal)) })))
  router.post('/connections/tatum/disconnect', asyncRoute(async (req, res) => { await operation(req, async session => services.disconnectTatum(session)); res.json({ success: true }) }))
  router.post('/connections/memwal/disconnect', asyncRoute(async (req, res) => { await operation(req, async session => services.disconnectMemory(session)); res.json({ success: true }) }))
  router.get('/memory', asyncRoute(async (req, res) => {
    const { memory, agentId } = req.workspaceSession
    const [status, inventory] = await Promise.all([memory.status(), memory.inventory(agentId).catch(error => ({ ...publicError(error), memories: [], total: 0 }))])
    wallets.assertActive(req.workspaceSession)
    req.workspaceController.signal.throwIfAborted()
    res.json({ status, inventory })
  }))
  router.get('/memory/handoff', asyncRoute(async (req, res) => {
    if (Object.keys(req.query).length) throw new AppError('invalid_request', 'Cross-tool setup always uses the current wallet connection; no account or namespace overrides are accepted.')
    res.json(createMemoryHandoff(wallets.assertActive(req.workspaceSession)))
  }))
  router.post('/memory/seed', asyncRoute(async (req, res) => res.json(await operation(req, session => session.memory.seed({ agentId: session.agentId, confirm: req.body.confirm })))))
  router.post('/memory/restore', asyncRoute(async (req, res) => res.json(await operation(req, session => session.memory.restore(session.agentId)))))
  router.post('/remember', asyncRoute(async (req, res) => res.json(await operation(req, session => session.memory.remember({ agentId: session.agentId, text: req.body.text, tier: req.body.tier }, { secrets: services.secrets(session) })))))
  router.get('/chain', asyncRoute(async (req, res) => {
    const { memory, env: sessionEnv } = req.workspaceSession
    const checkpoint = await memory.chain.checkpoint()
    const account = sessionEnv.MEMWAL_ACCOUNT_ID ? await memory.chain.object(sessionEnv.MEMWAL_ACCOUNT_ID).catch(() => null) : null
    wallets.assertActive(req.workspaceSession)
    req.workspaceController.signal.throwIfAborted()
    res.json({ configured: Boolean(req.workspaceSession.tatumKey), checkpoint, account,
      notice: 'This is a Tatum chain observation, not independent proof of Walrus storage.' })
  }))
  router.post('/chat', asyncRoute(async (req, res) => {
    if (active >= 4 || req.workspaceSession.active || req.workspaceSession.changing) throw new AppError('busy', 'A turn or connection operation is already running. Stop it or wait before starting another.', 429, true)
    const { memory, agentId } = req.workspaceSession
    const secrets = services.secrets(req.workspaceSession)
    const config = connections.select(req, req.body.connectionId)
    const input = validateChat(req.body, config, secrets)
    const controller = req.workspaceController
    const disconnect = () => { if (!res.writableEnded) controller.abort(new DOMException('Client disconnected', 'AbortError')) }
    res.on('close', disconnect) // req.close also fires when the POST body is consumed; do not abort on it.
    active++
    req.workspaceSession.active++
    let heartbeat
    try {
      const events = runChat({ input, memory, llm, agentId, config, signal: controller.signal, secrets })
      if (req.body.stream === false) {
        const payload = { answer: '', memories: [], tools: [], proposals: [], stored: null, model: input.model }
        for await (const event of events) {
          if (event.type === 'delta') payload.answer += event.data.text
          if (event.type === 'memory') { payload.memories = event.data.memories; payload.memory = event.data }
          if (event.type === 'proposal') payload.proposals.push(event.data)
          if (event.type === 'plan') payload.plan = event.data
          if (event.type === 'question') payload.question = event.data
          if (event.type === 'tool') payload.tools.push(event.data)
          if (event.type === 'done') payload.finishReason = event.data.finishReason
          if (event.type === 'stored') payload.stored = event.data
        }
        return res.json(redactValue(payload, secrets))
      }
      res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      res.flushHeaders()
      heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n') }, 15_000)
      for await (const event of events) {
        if (controller.signal.aborted || res.destroyed) break
        const frame = `event: ${event.type}\ndata: ${JSON.stringify(redactValue(event.data, secrets))}\n\n`
        if (!res.write(frame)) await once(res, 'drain', { signal: controller.signal })
      }
    } catch (error) {
      // Logout can abort a JSON turn while its HTTP client is still connected.
      // End that response too, otherwise it holds a request slot until the client times out.
      if (controller.signal.aborted && !res.destroyed && !res.headersSent) {
        return res.status(401).json(publicError(new AppError('wallet_required', 'This wallet session ended before the answer completed. Sign in again.', 401)))
      }
      if (!controller.signal.aborted && !res.destroyed) {
        if (!res.headersSent) throw error
        const failure = publicError(error)
        res.write(`event: error\ndata: ${JSON.stringify(redactValue({ code: failure.code, message: failure.error, retryable: failure.retryable }, secrets))}\n\n`)
      }
    } finally {
      clearInterval(heartbeat)
      active--
      req.workspaceSession.active--
      res.off('close', disconnect)
      if (res.headersSent && !res.writableEnded) res.end()
    }
  }))
  return router
}
