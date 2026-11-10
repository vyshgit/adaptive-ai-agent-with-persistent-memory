import { Router } from 'express'
import { once } from 'node:events'
import { AppError, asyncRoute, publicError, redactValue } from '../safety.mjs'

// Mounted INSIDE the signed-session/request-controller middleware in agent.mjs.
// No model tool can call these HTTP endpoints or possess their session binding.
export function createBuilderRouter({ builder, wallets, services, connections }) {
  const router = Router()
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  const unavailable = () => new AppError('builder_disabled', 'Disk tools and execution are disabled here. Run the local RecallLoop builder on your machine.', 403)
  const context = req => ({ session: wallets.assertActive(req.workspaceSession), signal: req.workspaceController.signal })
  async function result(req, action) {
    if (!builder) throw unavailable()
    const { session, signal } = context(req)
    const value = await action(session, signal)
    wallets.assertActive(session); signal.throwIfAborted()
    return value
  }
  router.get('/status', asyncRoute(async (req, res) => res.json(builder ? await result(req, session => builder.status(session)) : { enabled: false, opened: false, workspaceId: null, root: null })))
  router.post('/folders', asyncRoute(async (req, res) => res.json(await result(req, (session, signal) => builder.folders(session, req.body, signal)))))
  router.post('/open', asyncRoute(async (req, res) => res.json(await result(req, (session, signal) => builder.open(session, req.body, signal)))))
  router.post('/close', asyncRoute(async (req, res) => res.json(await result(req, (session, signal) => builder.closeWorkspace(session, req.body, signal)))))
  router.post('/permissions', asyncRoute(async (req, res) => res.json(await result(req, (session, signal) => builder.setPermissions(session, req.body, signal)))))
  router.get('/files', asyncRoute(async (req, res) => res.json(await result(req, (session, signal) => builder.list(session, req.query, signal)))))
  router.get('/file', asyncRoute(async (req, res) => res.json(await result(req, (session, signal) => builder.read(session, req.query, signal)))))
  router.post('/search', asyncRoute(async (req, res) => res.json(await result(req, (session, signal) => builder.search(session, req.body, signal)))))
  router.post('/reviews/file', asyncRoute(async (req, res) => res.json({ approval: await result(req, (session, signal) => builder.review(session, 'file', req.body, signal)) })))
  router.post('/reviews/command', asyncRoute(async (req, res) => res.json({ approval: await result(req, (session, signal) => builder.review(session, 'command', req.body, signal)) })))
  router.post('/stop', asyncRoute(async (req, res) => res.json(await result(req, (session, signal) => builder.stop(session, req.body, signal)))))
  router.post('/recall', asyncRoute(async (req, res) => res.json(await result(req, (session, signal) => builder.recall(session, req.body, signal)))))
  router.post('/reviews/checkpoint', asyncRoute(async (req, res) => res.json({ approval: await result(req, (session, signal) => builder.checkpointReview(session, req.body, signal)) })))
  router.post('/preview', asyncRoute(async (req, res) => res.json(await result(req, (session, signal) => builder.createPreview(session, req.body, req.workspaceOrigin, signal)))))
  router.post('/preview/close', asyncRoute(async (req, res) => res.json(await result(req, (session, signal) => builder.revokePreview(session, req.body, signal)))))

  async function streamed(req, res, action) {
    if (!builder) throw unavailable()
    const { session, signal } = context(req)
    const secrets = services.secrets(session)
    let started = false, completed = false, heartbeat, queued = 0, chain = Promise.resolve(), streamFailure
    const start = () => {
      if (started) return
      started = true
      res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      res.flushHeaders()
      heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded && !queued) res.write(': heartbeat\n\n') }, 15_000)
      heartbeat.unref()
    }
    const onEvent = event => {
      if (signal.aborted || res.destroyed || res.writableEnded) return
      if (event.type === 'done') completed = true
      start()
      const frame = `event: ${event.type}\ndata: ${JSON.stringify(redactValue(event.data, [...secrets, ...services.secrets(session)]))}\n\n`
      queued += Buffer.byteLength(frame)
      if (queued > 512_000) {
        req.workspaceController.abort(new AppError('output_limit', 'The browser could not consume the bounded task stream in time.', 413))
        throw req.workspaceController.signal.reason
      }
      chain = chain.then(async () => {
        signal.throwIfAborted()
        if (!res.write(frame)) await once(res, 'drain', { signal })
        queued -= Buffer.byteLength(frame)
      }).catch(error => { streamFailure = error; req.workspaceController.abort(error) })
    }
    try {
      const payload = await action(session, { signal, onEvent })
      wallets.assertActive(session); signal.throwIfAborted()
      if (!started) return res.json(payload) // agent approval acknowledgement/rejection
      if (!completed) onEvent({ type: 'done', data: payload })
      await chain
      if (streamFailure) throw streamFailure
    } catch (error) {
      if (!res.headersSent) throw error
      if (!res.destroyed && !res.writableEnded) {
        await chain
        const safe = publicError(error)
        res.write(`event: error\ndata: ${JSON.stringify(redactValue({ code: safe.code, message: safe.error, retryable: safe.retryable }, secrets))}\n\n`)
      }
    } finally { clearInterval(heartbeat); if (started && !res.writableEnded) res.end() }
  }
  router.post('/prompt', asyncRoute((req, res) => streamed(req, res, (session, options) => builder.prompt(session, req.body, connections.select(req, req.body.connectionId), options))))
  router.post('/write', asyncRoute((req, res) => streamed(req, res, (session, options) => builder.act(session, 'file', req.body, options))))
  router.post('/command', asyncRoute((req, res) => streamed(req, res, (session, options) => builder.act(session, 'command', req.body, options))))
  router.post('/approvals', asyncRoute((req, res) => streamed(req, res, (session, options) => builder.decide(session, req.body, options))))
  return router
}
