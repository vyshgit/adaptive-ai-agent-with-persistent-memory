import { tatumSuiGraphql } from '../tatum-client.mjs'
import { AppError, requireText } from '../safety.mjs'

// Verified against Tatum discovery and the Sui schema. An observation is not storage proof.
export const CHECKPOINT_QUERY = 'query RecallLoopCheckpoint { checkpoint { sequenceNumber digest timestamp } }'
export const OBJECT_QUERY = 'query RecallLoopObject($address: SuiAddress!) { object(address: $address) { address version digest } }'
export const ACCOUNT_QUERY = 'query RecallLoopAccount($address: SuiAddress!) { object(address: $address) { address version digest owner { __typename } asMoveObject { contents { json type { repr } } } } }'

export function createChainReader({ graphql = tatumSuiGraphql, ttlMs = 30_000, clock = () => Date.now() } = {}) {
  let cached
  let checked = 0
  let pending
  let destroyed = false
  async function checkpoint() {
    if (destroyed) return null
    if (cached && clock() - checked < ttlMs) return cached
    if (pending) return pending
    pending = (async () => {
      try {
        const data = await graphql(CHECKPOINT_QUERY)
        const cp = data?.checkpoint
        if (destroyed) return null
        if (cp?.sequenceNumber == null || !/^\d+$/.test(String(cp.sequenceNumber))) return null
        cached = { network: 'sui-mainnet', checkpoint: String(cp.sequenceNumber), digest: cp.digest || null,
          timestamp: cp.timestamp || null, via: 'tatum', transport: 'graphql', observedAt: new Date(clock()).toISOString() }
        checked = clock()
        return cached
      } catch { return null }
    })()
    const request = pending
    void request.finally(() => { if (pending === request) pending = undefined })
    return pending
  }
  async function object(address) {
    if (destroyed) throw new AppError('wallet_required', 'This Tatum connection has ended.', 401)
    requireText(address, 'object address', 66, { pattern: /^0x[0-9a-fA-F]{1,64}$/ })
    try {
      const data = await graphql(OBJECT_QUERY, { address })
      return { network: 'sui-mainnet', via: 'tatum', transport: 'graphql', exists: Boolean(data.object), object: data.object || null }
    } catch { throw new AppError('chain_unavailable', 'Tatum Sui GraphQL could not verify this object. Check your Mainnet API key.', 502, true) }
  }
  async function account(address) {
    if (destroyed) throw new AppError('wallet_required', 'This Tatum connection has ended.', 401)
    requireText(address, 'account address', 66, { pattern: /^0x[0-9a-fA-F]{1,64}$/ })
    try { return (await graphql(ACCOUNT_QUERY, { address })).object || null }
    catch { throw new AppError('chain_unavailable', 'Tatum could not read the Walrus Memory account. Connect a valid Sui Mainnet API key.', 502, true) }
  }
  return { checkpoint, object, account, destroy() { destroyed = true; cached = undefined; pending = undefined } }
}
