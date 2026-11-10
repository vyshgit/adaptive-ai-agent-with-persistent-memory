import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { AppError, requireText, within } from '../safety.mjs'
import { tatumSuiGraphql } from '../tatum-client.mjs'
import { createChainReader } from '../memory/chain-anchor.mjs'
import { createMemoryBackend, OFFICIAL_RELAYER } from '../memory/memwal-client.mjs'
import { createMemoryService } from '../memory/service.mjs'
import { suiAddress, walletAgentId } from './wallet-auth.mjs'
import { readLimitedText } from './sse.mjs'

export function apiCredential(value, label) {
  const key = requireText(value, label, 4096)
  if (key.length < 8 || /[^\x21-\x7e]/.test(key)) throw new AppError('invalid_request', `${label} must contain at least 8 printable ASCII characters without spaces.`)
  return key
}

async function officialDeployment() {
  const response = await fetch(`${OFFICIAL_RELAYER}/config`, { signal: AbortSignal.timeout(5000), redirect: 'error' })
  if (!response.ok) throw new Error('Deployment metadata unavailable')
  const text = await readLimitedText(response, 50_000)
  const data = JSON.parse(text)
  if (data.network !== 'mainnet') throw new AppError('memory_not_configured', 'The official Walrus Memory deployment did not report Mainnet.', 503)
  return { packageId: suiAddress(data.packageId), network: data.network }
}

// Only operator policy is inherited. No owner/provider/delegate credential or mock fallback.
export function createSessionServices({ env = process.env, graphql = tatumSuiGraphql, deployment = officialDeployment,
  backendFactory = createMemoryBackend, memoryFactory = createMemoryService } = {}) {
  function chainFor(key) {
    const credentials = { apiKey: key }
    const reader = createChainReader({ graphql: (query, variables) => graphql(query, variables, credentials) })
    const destroy = reader.destroy
    reader.destroy = () => { credentials.apiKey = ''; destroy() }
    return reader
  }
  function initialise(session) {
    const principal = requireText(session.agentId, 'memory principal', 128)
    if ((session.kind === 'wallet' && principal !== walletAgentId(session.address))
      || (session.kind === 'demo' && !/^demo-[A-Za-z0-9_-]+$/.test(principal))
      || !['wallet', 'demo'].includes(session.kind)) {
      throw new AppError('scope_forbidden', 'A memory workspace must belong to its authenticated wallet or isolated demo session.', 403)
    }
    session.env = { RECALLLOOP_MEMORY_MODE: session.kind === 'demo' ? 'mock' : '', WALRUS_NETWORK: 'mainnet',
      MEMWAL_SERVER_URL: OFFICIAL_RELAYER, RECALLLOOP_CAPTURE_MODE: 'facts' }
    session.chain = chainFor('')
    session.tatumKey = ''
    session.tatum = { configured: false, verified: false, checkpoint: null }
    const chain = { checkpoint: () => session.chain.checkpoint(), object: address => session.chain.object(address), account: address => session.chain.account(address) }
    session.memory = memoryFactory({ env: session.env, chain, principal })
  }
  function secrets(session) {
    return [...new Set([session.config?.apiKey, ...[...(session.modelConnections?.values() || [])].map(config => config.apiKey),
      session.tatumKey, session.env?.MEMWAL_PRIVATE_KEY].filter(Boolean))]
  }
  async function connectTatum(session, input, signal) {
    if (session.kind !== 'wallet') throw new AppError('wallet_required', 'Sign in with a wallet to connect live APIs. The demo never accepts credentials.', 403)
    const key = apiCredential(input?.apiKey, 'Tatum API key')
    const candidate = chainFor(key)
    let checkpoint
    try {
      checkpoint = await within(candidate.checkpoint(), 10_000, null, signal)
      if (!checkpoint) throw new AppError('chain_unavailable', 'Tatum did not return a Sui Mainnet checkpoint. Check the API key, Mainnet scope, and quota.', 502, true)
      signal?.throwIfAborted()
    } catch (error) { candidate.destroy(); throw error }
    // The route checks the session is still alive before committing this result.
    return { cleanup() { if (session.chain !== candidate) candidate.destroy() }, commit() {
      session.chain.destroy?.()
      session.tatumKey = key
      session.env.TATUM_API_KEY = key
      session.chain = candidate
      session.tatum = { configured: true, verified: true, checkpoint, verifiedAt: new Date().toISOString() }
      return session.tatum
    } }
  }
  async function connectMemory(session, input, signal) {
    if (session.kind !== 'wallet') throw new AppError('wallet_required', 'Sign in with a wallet to connect Walrus Mainnet. The demo never accepts credentials.', 403)
    if (!session.tatumKey) throw new AppError('tatum_required', 'Connect your Tatum Mainnet API key first so the account owner can be verified on Sui.', 412)
    const key = requireText(input?.delegateKey, 'Walrus delegate key', 256)
    if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(key) && !/^suiprivkey1[a-z0-9]{40,100}$/.test(key)) {
      throw new AppError('invalid_request', 'Use a Walrus Memory delegate private key (32-byte hex or suiprivkey1). Never enter a wallet seed phrase or wallet private key.')
    }
    const accountId = suiAddress(input?.accountId)
    const candidateEnv = { ...session.env, RECALLLOOP_MEMORY_MODE: 'relayer', MEMWAL_PRIVATE_KEY: key, MEMWAL_ACCOUNT_ID: accountId }
    const backend = backendFactory({ env: candidateEnv })
    let committed = false
    const cleanup = () => { if (!committed) { backend.destroy?.(); candidateEnv.MEMWAL_PRIVATE_KEY = '' } }
    try {
      const [metadata, account, status] = await within(Promise.all([deployment(), session.chain.account(accountId), backend.status()]), 15_000, null, signal)
        || (() => { throw new AppError('memory_unavailable', 'The account verification timed out. Try again.', 502, true) })()
      const contents = account?.asMoveObject?.contents
      const owner = typeof contents?.json?.owner === 'string' ? suiAddress(contents.json.owner) : null
      if (metadata.network !== 'mainnet' || !account || suiAddress(account.address) !== accountId || account.owner?.__typename !== 'Shared'
        || contents?.type?.repr !== `${suiAddress(metadata.packageId)}::account::MemWalAccount` || owner !== session.address) {
        throw new AppError('account_mismatch', 'This must be an official Mainnet Walrus Memory account owned by the signed-in wallet. Account IDs are not wallet addresses.', 403)
      }
      if (status.mode !== 'relayer' || status.network !== 'mainnet' || !status.healthy || !status.writeReady) {
        throw new AppError('memory_unavailable', 'The official Mainnet relayer is not healthy and write-ready. No live memory connection was installed.', 503, true)
      }
      const sdk = backend.getClient()
      const publicKey = await sdk.getPublicKeyHex()
      if (!/^[0-9a-fA-F]{64}$/.test(publicKey) || new Ed25519PublicKey(Buffer.from(publicKey, 'hex')).toSuiAddress() === session.address) {
        throw new AppError('invalid_request', 'Use a dedicated Walrus Memory delegate key, not the signed-in wallet’s private key.')
      }
      // Public health is NOT authorization. This invokes the SDK's signed owner resolution
      // and owner-scoped metadata route; no write, private SDK method, or key upload needed.
      const namespaces = await within(sdk.listNamespaces({ limit: 1 }), 20_000, null, signal)
      if (!Array.isArray(namespaces?.namespaces)) throw new AppError('memory_unauthorized', 'The delegate key was not authorized for this account. Check it in the Walrus Memory dashboard.', 403)
      signal?.throwIfAborted()
      const memory = memoryFactory({ env: candidateEnv, backend, principal: session.agentId,
        chain: { checkpoint: () => session.chain.checkpoint(), object: address => session.chain.object(address) } })
      return { cleanup, commit() {
        committed = true
        session.memory.destroy?.()
        session.memory = memory
        session.env.MEMWAL_PRIVATE_KEY = ''
        session.env = candidateEnv
        session.memoryConnection = { accountId, owner, publicKey, verified: true, verifiedAt: new Date().toISOString(),
          observation: { version: account.version, digest: account.digest, via: 'tatum', network: 'sui-mainnet' } }
        return session.memoryConnection
      } }
    } catch (error) {
      cleanup()
      if (error instanceof AppError) throw error
      throw new AppError('memory_unauthorized', 'Walrus Memory could not authorize this delegate key and account. Check your key, account, and relayer availability.', 502, true)
    }
  }
  function disconnectMemory(session) {
    session.memory.destroy?.()
    session.env.MEMWAL_PRIVATE_KEY = ''
    delete session.env.MEMWAL_ACCOUNT_ID
    session.env.RECALLLOOP_MEMORY_MODE = session.kind === 'demo' ? 'mock' : ''
    session.memoryConnection = null
    session.memory = memoryFactory({ env: session.env, principal: session.agentId,
      chain: { checkpoint: () => session.chain.checkpoint(), object: address => session.chain.object(address) } })
  }
  function disconnectTatum(session) {
    // A live memory connection requires a verified Tatum identity check.
    disconnectMemory(session)
    session.tatumKey = ''
    session.env.TATUM_API_KEY = ''
    session.chain.destroy?.()
    session.chain = chainFor('')
    session.tatum = { configured: false, verified: false, checkpoint: null }
  }
  return { initialise, secrets, connectTatum, connectMemory, disconnectTatum, disconnectMemory }
}
