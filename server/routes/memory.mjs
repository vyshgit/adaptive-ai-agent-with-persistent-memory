import { Router } from 'express'
import { asyncRoute } from '../safety.mjs'

export function createMemoryRouter({ memory, authenticateAgent, authenticateAdmin, agentId = 'recallloop-workspace' }) {
  const router = Router()
  const scoped = (req, res, next) => {
    if (req.method === 'GET') req.body = { agentId: req.query.agentId }
    authenticateAgent(req, res, next)
  }
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.post('/ingest', scoped, asyncRoute(async (req, res) => res.json(await memory.ingest({ ...req.body, agentId: req.authenticatedAgentId }))))
  router.post('/recall', scoped, asyncRoute(async (req, res) => res.json(await memory.recall({ ...req.body, agentId: req.authenticatedAgentId }))))
  router.get('/inventory', scoped, asyncRoute(async (req, res) => res.json(await memory.inventory(req.authenticatedAgentId))))
  router.get('/status', authenticateAdmin, asyncRoute(async (_req, res) => res.json(await memory.status())))
  router.post('/seed', authenticateAdmin, asyncRoute(async (req, res) => res.json(await memory.seed({ agentId, confirm: req.body.confirm }))))
  router.post('/restore', scoped, asyncRoute(async (req, res) => res.json(await memory.restore(req.authenticatedAgentId))))
  return router
}
