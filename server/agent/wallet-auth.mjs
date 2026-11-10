import { randomBytes, createHash } from 'node:crypto'
import { parseSerializedSignature } from '@mysten/sui/cryptography'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { AppError, requireText } from '../safety.mjs'

export const WALLET_COOKIE = 'recallloop_wallet'
export const SESSION_TTL_MS = 60 * 60 * 1000
export const CHALLENGE_TTL_MS = 5 * 60 * 1000

export function suiAddress(value) {
  return `0x${requireText(value, 'Sui address', 66, { pattern: /^0x[0-9a-fA-F]{1,64}$/ }).slice(2).toLowerCase().padStart(64, '0')}`
}

export function walletAgentId(address) {
  return `wallet-${createHash('sha256').update(suiAddress(address)).digest('hex').slice(0, 40)}`
}

function cookieValue(req) {
  return (req.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${WALLET_COOKIE}=`))?.slice(WALLET_COOKIE.length + 1)
}

export async function verifyWalletSignature(message, signature, address) {
  const parsed = parseSerializedSignature(signature)
  // zkLogin can trigger remote verification. Do not silently send login proofs to an RPC.
  // MultiSig is deliberately excluded until all constituent schemes are handled explicitly.
  if (!['ED25519', 'Secp256k1', 'Secp256r1', 'Passkey', 'MLDSA65'].includes(parsed.signatureScheme)) {
    throw new AppError('unsupported_wallet', 'Use a Sui wallet with an Ed25519, Secp256k1, Secp256r1, passkey, or ML-DSA personal-message signature. zkLogin and multisig login are not supported yet.', 400)
  }
  await verifyPersonalMessageSignature(new TextEncoder().encode(message), signature, { address })
}

export function createWalletAuth({ env = process.env, clock = () => Date.now(), verify = verifyWalletSignature,
  initialise = () => {}, maxSessions = 100, sessionTtlMs = SESSION_TTL_MS, challengeTtlMs = CHALLENGE_TTL_MS } = {}) {
  const sessions = new Map()
  const attempts = new Map()
  const disposals = new Set()
  const id = () => randomBytes(32).toString('hex')

  function dispose(session) {
    if (!session || session.disposed) return
    session.disposed = true
    if (session.builder) {
      session.builderDisposal = Promise.resolve(session.builder.dispose()).catch(() => {})
      disposals.add(session.builderDisposal)
      void session.builderDisposal.finally(() => disposals.delete(session.builderDisposal))
    }
    for (const controller of session.controllers) controller.abort(new DOMException('Wallet session ended', 'AbortError'))
    session.controllers.clear()
    session.memory?.destroy?.()
    session.chain?.destroy?.()
    if (session.config) session.config.apiKey = ''
    for (const config of session.modelConnections?.values() || []) config.apiKey = ''
    session.modelConnections?.clear()
    session.config = null
    if (session.env) for (const name of ['TATUM_API_KEY', 'MEMWAL_PRIVATE_KEY', 'MEMWAL_DELEGATE_KEY']) session.env[name] = ''
    session.tatumKey = ''
    session.challenge = null
    sessions.delete(session.id)
  }
  function sweep() {
    for (const session of sessions.values()) if (session.expiresAt <= clock()) dispose(session)
    for (const [peer, attempt] of attempts) if (attempt.until <= clock()) attempts.delete(peer)
  }
  const timer = setInterval(sweep, 30_000)
  timer.unref()

  function issue(req, res, kind, address, ttl) {
    sweep()
    if (sessions.size >= maxSessions) throw new AppError('busy', 'Too many wallet sessions. Try again later.', 429, true)
    const session = { id: id(), tag: id().slice(0, 32), kind, address, agentId: address ? walletAgentId(address) : `demo-${id().slice(0, 24)}`,
      expiresAt: clock() + ttl, active: 0, changing: false, config: null, controllers: new Set(), disposed: false }
    if (kind !== 'challenge') initialise(session)
    sessions.set(session.id, session)
    req.workspaceSession = session
    res.cookie(WALLET_COOKIE, session.id, { httpOnly: true, sameSite: 'strict', secure: req.workspaceOrigin?.startsWith('https://') || req.secure === true,
      maxAge: ttl, path: '/api/agent' })
    return session
  }

  function middleware(req, _res, next) {
    sweep()
    req.workspaceSession = sessions.get(cookieValue(req))
    next()
  }
  function assertActive(session) {
    if (!session || session.disposed || session.expiresAt <= clock() || sessions.get(session.id) !== session || session.kind === 'challenge') {
      dispose(session)
      throw new AppError('wallet_required', 'Sign in with your Sui wallet. Sessions expire after one hour; reconnect your APIs after signing in again.', 401)
    }
    return session
  }
  function requireSession(req, _res, next) {
    try {
      const session = assertActive(req.workspaceSession)
      assertBinding(req, session)
      next()
    } catch (error) { next(error) }
  }
  function assertBinding(req, session = req.workspaceSession) {
    if (session && session.kind !== 'challenge' && !session.disposed && session.expiresAt > clock() && req.get('x-recallloop-session') !== session.tag) {
      throw new AppError('session_changed', 'This browser’s wallet session changed. Reload before sending any project or conversation data.', 409)
    }
  }
  function publicSession(session) {
    const valid = session && !session.disposed && session.expiresAt > clock() && session.kind !== 'challenge'
    return { authenticated: Boolean(valid && session.kind === 'wallet'), demo: Boolean(valid && session.kind === 'demo'),
      address: valid ? session.address : null, agentId: valid ? session.agentId : null,
      sessionTag: valid ? session.tag : null,
      expiresAt: valid ? new Date(session.expiresAt).toISOString() : null,
      demoAvailable: env.RECALLLOOP_ENABLE_DEMO === 'true' || (env.RECALLLOOP_MEMORY_MODE === 'mock' && env.RECALLLOOP_LLM_MODE === 'mock') }
  }
  function rateLimit(req) {
    sweep()
    const peer = req.socket?.remoteAddress || 'unknown'
    const attempt = attempts.get(peer) || { count: 0, until: clock() + 60_000 }
    if (attempt.count >= 12 || (!attempts.has(peer) && attempts.size >= 1000)) throw new AppError('busy', 'Too many sign-in attempts. Wait one minute and try again.', 429, true)
    attempt.count++
    attempts.set(peer, attempt)
  }
  function challenge(req, res, input) {
    const address = suiAddress(input?.address)
    if (!req.workspaceOrigin) throw new AppError('unauthorized', 'Wallet login requires a trusted app origin.', 403)
    rateLimit(req)
    assertBinding(req)
    if (req.workspaceSession?.active || req.workspaceSession?.changing) throw new AppError('busy', 'Stop the current operation before signing into another wallet.', 429)
    dispose(req.workspaceSession)
    const session = issue(req, res, 'challenge', address, challengeTtlMs)
    const nonce = id()
    const issuedAt = new Date(clock()).toISOString()
    const expiresAt = new Date(session.expiresAt).toISOString()
    const message = ['RecallLoop wallet sign-in', `Origin: ${req.workspaceOrigin}`, `URI: ${req.workspaceOrigin}/#/agent`,
      `Wallet address: ${address}`, 'Network: sui:mainnet', `Nonce: ${nonce}`, `Issued At: ${issuedAt}`, `Expiration Time: ${expiresAt}`,
      '', 'Sign this message to prove ownership of your wallet and open a one-hour RecallLoop session.',
      'This is not a transaction. It grants no permission to spend funds or access Walrus Memory.'].join('\n')
    session.challenge = { id: nonce, message, origin: req.workspaceOrigin }
    return { challengeId: nonce, message, address, expiresAt }
  }
  async function login(req, res, input) {
    const session = req.workspaceSession
    const proof = session?.challenge
    // Consume before verification (including failed attempts) to defeat concurrent replays.
    if (session) session.challenge = null
    if (!proof || session.kind !== 'challenge' || session.disposed || session.expiresAt <= clock()
      || proof.origin !== req.workspaceOrigin || proof.id !== input?.challengeId || session.address !== suiAddress(input?.address)) {
      throw new AppError('invalid_challenge', 'This sign-in challenge is invalid, expired, or already used. Connect again to request a new one.', 401)
    }
    const signature = requireText(input.signature, 'signature', 20_000, { pattern: /^[A-Za-z0-9+/]+={0,2}$/ })
    try {
      await verify(proof.message, signature, session.address)
      if (session.disposed || session.expiresAt <= clock()) throw new AppError('invalid_challenge', 'The challenge expired during verification. Connect again.', 401)
    } catch (error) {
      dispose(session)
      if (error instanceof AppError) throw error
      throw new AppError('invalid_signature', 'The wallet signature did not verify for this address. Connect again and sign the exact challenge.', 401)
    }
    dispose(session)
    return publicSession(issue(req, res, 'wallet', session.address, sessionTtlMs))
  }
  function demo(req, res) {
    if (!publicSession().demoAvailable) throw new AppError('demo_disabled', 'The offline demo is disabled. The server operator can enable RECALLLOOP_ENABLE_DEMO=true.', 403)
    rateLimit(req)
    assertBinding(req)
    if (req.workspaceSession?.active || req.workspaceSession?.changing) throw new AppError('busy', 'Stop the current operation before opening the demo.', 429)
    dispose(req.workspaceSession)
    return publicSession(issue(req, res, 'demo', null, sessionTtlMs))
  }
  function logout(req, res) {
    assertBinding(req)
    dispose(req.workspaceSession)
    res.clearCookie(WALLET_COOKIE, { httpOnly: true, sameSite: 'strict', secure: req.workspaceOrigin?.startsWith('https://'), path: '/api/agent' })
    req.workspaceSession = undefined
    return publicSession()
  }
  return { middleware, requireSession, assertActive, publicSession, challenge, login, demo, logout,
    close() { clearInterval(timer); for (const session of sessions.values()) dispose(session); attempts.clear(); return Promise.all([...disposals]) } }
}
