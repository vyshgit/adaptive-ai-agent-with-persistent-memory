import { Router } from 'express'
import { once } from 'node:events'
import { AppError, asyncRoute, publicError, redactValue } from '../safety.mjs'
import { validateConnection, publicConnection } from '../agent/connections.mjs'
import { validateChat, runChat } from '../agent/chat.mjs'

export function createAgentRouter({ llm, connections, wallets, services, env = process.env }) {
  const router = Router()
  let active = 0
  let operations = 0
  let requests = 0
  router.get('/auth/session', (req, res) => res.json(wallets.publicSession(req.workspaceSession)))
  router.post('/auth/challenge', asyncRoute(async (req, res) => res.json(wallets.challenge(req, res, req.body))))
  router.post('/auth/verify', asyncRoute(async (req, res) => res.json(await wallets.login(req, res, req.body))))
  router.post('/auth/demo', asyncRoute(async (req, res) => res.json(wallets.demo(req, res))))
  router.post('/auth/logout', asyncRoute(async (req, res) => res.json(wallets.logout(req, res))))
  router.use(wallets.requireSession, connections.middleware, (req, res, next) => {
    if (requests >= 48 || req.workspaceSession.controllers.size >= 8) return next(new AppError('busy', 'Too many workspace requests. Wait for the current requests to finish.', 429, true))
    // Keep request-time secrets until this response closes, even if logout wipes the session.
    const secrets = services.secrets(req.workspaceSession)
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
      return result?.commit ? result.commit() : result
    } catch (error) {
      if (session.disposed) wallets.assertActive(session)
      throw error
    } finally { result?.cleanup?.(); session.changing = false; operations-- }
  }
  router.get('/status', asyncRoute(async (req, res) => res.json({ agentId: req.workspaceSession.agentId,
    auth: wallets.publicSession(req.workspaceSession), llm: publicConnection(req.llmConfig),
    memory: await req.workspaceSession.memory.status(), memoryConnection: req.workspaceSession.memoryConnection || null,
    tatum: req.workspaceSession.tatum, coding: { maxToolRounds: 3, reviewRequired: true, terminal: false } })))
  router.get('/models', (req, res) => res.json(publicConnection(req.llmConfig).models))
  router.post('/connect', asyncRoute(async (req, res) => {
    const connection = await operation(req, async session => {
      if (session.kind === 'demo' && req.body.mode !== 'mock') throw new AppError('wallet_required', 'The offline demo does not accept live credentials. Sign in with your wallet first.', 403)
      const config = validateConnection(req.body, env)
      try {
        const discovered = await llm.models(config, req.workspaceController.signal)
        config.models = discovered.models
        config.verified = discovered.verified
        return { commit: () => connections.connect(req, config), cleanup() { config.apiKey = '' } }
      } catch (error) { config.apiKey = ''; throw error }
    })
    res.json({ success: true, connection })
  }))
  router.post('/disconnect', asyncRoute(async (req, res) => { await operation(req, async () => connections.disconnect(req)); res.json({ success: true }) }))
  router.post('/connections/tatum', asyncRoute(async (req, res) => res.json({ success: true,
    connection: await operation(req, (session, signal) => services.connectTatum(session, req.body, signal)) })))
  router.post('/connections/memwal', asyncRoute(async (req, res) => res.json({ success: true,
    connection: await operation(req, (session, signal) => services.connectMemory(session, req.body, signal)) })))
  router.post('/connections/tatum/disconnect', asyncRoute(async (req, res) => { await operation(req, async session => services.disconnectTatum(session)); res.json({ success: true }) }))
  router.post('/connections/memwal/disconnect', asyncRoute(async (req, res) => { await operation(req, async session => services.disconnectMemory(session)); res.json({ success: true }) }))
  router.get('/memory', asyncRoute(async (req, res) => {
    const { memory, agentId } = req.workspaceSession
    const [status, inventory] = await Promise.all([memory.status(), memory.inventory(agentId).catch(error => ({ ...publicError(error), memories: [], total: 0 }))])
    res.json({ status, inventory })
  }))
  router.post('/memory/seed', asyncRoute(async (req, res) => res.json(await operation(req, session => session.memory.seed({ agentId: session.agentId, confirm: req.body.confirm })))))
  router.post('/memory/restore', asyncRoute(async (req, res) => res.json(await operation(req, session => session.memory.restore(session.agentId)))))
  router.post('/remember', asyncRoute(async (req, res) => res.json(await operation(req, session => session.memory.remember({ agentId: session.agentId, text: req.body.text, tier: req.body.tier }, { secrets: services.secrets(session) })))))
  router.get('/chain', asyncRoute(async (req, res) => {
    const { memory, env: sessionEnv } = req.workspaceSession
    const checkpoint = await memory.chain.checkpoint()
    const account = sessionEnv.MEMWAL_ACCOUNT_ID ? await memory.chain.object(sessionEnv.MEMWAL_ACCOUNT_ID).catch(() => null) : null
    res.json({ configured: Boolean(req.workspaceSession.tatumKey), checkpoint, account,
      notice: 'This is a Tatum chain observation, not independent proof of Walrus storage.' })
  }))
  router.post('/chat', asyncRoute(async (req, res) => {
    if (active >= 4 || req.workspaceSession.active || req.workspaceSession.changing) throw new AppError('busy', 'A turn or connection operation is already running. Stop it or wait before starting another.', 429, true)
    const { memory, agentId } = req.workspaceSession
    const secrets = services.secrets(req.workspaceSession)
    const input = validateChat(req.body, req.llmConfig, secrets)
    const controller = req.workspaceController
    const disconnect = () => { if (!res.writableEnded) controller.abort(new DOMException('Client disconnected', 'AbortError')) }
    res.on('close', disconnect) // req.close also fires when the POST body is consumed; do not abort on it.
    active++
    req.workspaceSession.active++
    let heartbeat
    try {
      const events = runChat({ input, memory, llm, agentId, config: req.llmConfig, signal: controller.signal, secrets })
      if (req.body.stream === false) {
        const payload = { answer: '', memories: [], tools: [], proposals: [], stored: null, model: input.model }
        for await (const event of events) {
          if (event.type === 'delta') payload.answer += event.data.text
          if (event.type === 'memory') { payload.memories = event.data.memories; payload.memory = event.data }
          if (event.type === 'proposal') payload.proposals.push(event.data)
          if (event.type === 'tool') payload.tools.push(event.data)
          if (event.type === 'done') payload.finishReason = event.data.finishReason
          if (event.type === 'stored') payload.stored = event.data
        }
        return res.json(redactValue(payload, secrets))
      }
      res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
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
