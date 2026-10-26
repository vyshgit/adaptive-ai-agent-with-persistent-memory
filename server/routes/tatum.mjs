import { Router } from 'express'
import { tatumApiBase, tatumFetch, tatumRpc, MissingApiKeyError } from '../tatum-client.mjs'

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

// Read-only Sui Mainnet JSON-RPC request route keeping credentials strictly server-side
router.get('/sui-checkpoint', async (_req, res) => {
  try {
    const rpcPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'sui_getLatestCheckpointSequenceNumber',
      params: []
    }
    const response = await tatumRpc('sui', rpcPayload, 'mainnet')
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const data = await response.json()
      res.json({ success: response.ok, status: response.status, data })
    } else {
      const text = await response.text()
      res.json({ success: response.ok, status: response.status, raw: text })
    }
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      res.status(503).json({ success: false, status: 'no-api-key', error: error.message })
    } else {
      res.status(500).json({ success: false, error: error.message })
    }
  }
})

export default router
