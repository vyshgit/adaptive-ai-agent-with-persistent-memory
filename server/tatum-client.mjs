// Tatum access for server routes. Use these instead of a hardcoded host: a key works
// against api.tatum.io or api.tatum.dev, never both, and the wrong one returns a 401
// that reads as a bad key.
//
// Env is read per call, not at import: credentials-store.mjs rewrites process.env when
// the user changes their key.
import { readLimitedText } from './agent/sse.mjs'

export class MissingApiKeyError extends Error {
  constructor() {
    super('TATUM_API_KEY is not set for this workspace')
    this.name = 'MissingApiKeyError'
  }
}

export function tatumApiBase() {
  return (process.env.TATUM_API_BASE || 'https://api.tatum.io').replace(/\/+$/, '')
}

// api.tatum.io -> tatum.io, so the gateway follows the API base's environment.
function tatumDomain() {
  const host = new URL(tatumApiBase()).hostname
  return host.replace(/^api\./, '')
}

export function tatumGatewayUrl(chain, network = 'mainnet') {
  return `https://${chain}-${network}.gateway.${tatumDomain()}`
}

function apiKey() {
  const key = process.env.TATUM_API_KEY
  if (!key) throw new MissingApiKeyError()
  return key
}

const TIMEOUT_MS = 20000

// new Headers(), not a spread: spreading a Headers instance or an array of pairs
// yields {} and silently drops them. Setting the key last also stops a caller
// overriding it.
function withKey(headers) {
  const h = new Headers(headers)
  h.set('x-api-key', apiKey())
  return h
}

// REST / Data API. `path` is everything after the origin, e.g. '/v4/data/rate/symbol?...'.
export async function tatumFetch(path, init = {}) {
  return fetch(`${tatumApiBase()}${path.startsWith('/') ? path : `/${path}`}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...init,
    headers: withKey(init.headers),
  })
}

// JSON-RPC against a chain's gateway.
export async function tatumRpc(chain, body, network = 'mainnet') {
  return fetch(tatumGatewayUrl(chain, network), {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: withKey({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
}

// The live Sui Mainnet discovery currently advertises HTTP GraphQL.
export async function tatumSuiGraphql(query, variables = {}, options = {}) {
  // An explicitly supplied key (even empty) MUST NOT fall back to the owner environment.
  const key = Object.hasOwn(options, 'apiKey') ? options.apiKey : apiKey()
  if (!key) throw new MissingApiKeyError()
  const url = Object.hasOwn(options, 'apiKey') ? 'https://sui-mainnet.gateway.tatum.io/graphql' : `${tatumGatewayUrl('sui', 'mainnet')}/graphql`
  const response = await fetch(url, {
    method: 'POST',
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) throw new Error(`Tatum Sui GraphQL HTTP ${response.status}`)
  const text = await readLimitedText(response, 100_000)
  const payload = JSON.parse(text)
  if (!payload.data || payload.errors?.length) throw new Error('Tatum Sui GraphQL returned an error')
  return payload.data
}
