import { Router } from 'express'
import { tatumApiBase, tatumFetch, MissingApiKeyError } from '../tatum-client.mjs'

const router = Router()

// Health check — a present key says nothing about egress, so make a real request.
router.get('/status', async (_req, res) => {
  if (!process.env.TATUM_API_KEY) return res.json({ status: 'no-api-key' })
  try {
    // Any HTTP response proves the request left the pod; the status code doesn't matter.
    await fetch(tatumApiBase(), { signal: AbortSignal.timeout(8000) })
    res.json({ status: 'connected' })
  } catch (error) {
    res.json({ status: 'egress-failed', error: error.message })
  }
})

// Read-only Tatum API request route keeping API key strictly server-side
router.get('/version', async (_req, res) => {
  try {
    const response = await tatumFetch('/v3/tatum/version')
    const data = await response.json()
    res.json({ success: true, data })
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      res.status(503).json({ success: false, status: 'no-api-key', error: error.message })
    } else {
      res.status(500).json({ success: false, error: error.message })
    }
  }
})

export default router
