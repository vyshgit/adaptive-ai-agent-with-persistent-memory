import { deferred } from './helpers.mjs'
import { suiAddress } from '../server/agent/wallet-auth.mjs'
import { OFFICIAL_RELAYER } from '../server/memory/memwal-client.mjs'
import { createMemoryHandoff } from '../server/agent/memory-handoff.mjs'

export const SYNTHETIC_ACCOUNT_ID = suiAddress('0xa')

// Browser wiring fixtures only. All keys/IDs are synthetic, upstream requests are
// intercepted, and no fixture is evidence of API compatibility or Mainnet storage.
export function syntheticConnection(overrides = {}) {
  const model = overrides.model || 'synthetic-exact-model'
  const apiStyle = overrides.apiStyle || 'responses'
  return { id: 'synthetic-provider', name: 'AgentRouter', mode: 'live', model, models: [...new Set([model, 'synthetic-discovered-only'])].map(id => ({ id, label: id })),
    baseUrl: 'https://agentrouter.org/v1', apiStyle, toolsEnabled: true, source: 'browser-session', verified: true,
    verification: { model, apiStyle, checkedAt: '2026-11-08T16:00:00Z', discovery: 'available', generation: 'verified',
      streaming: 'not_checked', tools: 'not_checked' }, lastVerificationFailure: null, expiresAt: null, ...overrides }
}

export const emptyConnection = () => ({ mode: 'unconfigured', model: '', models: [], apiStyle: 'responses', baseUrl: 'https://api.openai.com/v1',
  toolsEnabled: true, source: 'environment', verified: false, verification: null, lastVerificationFailure: null, expiresAt: null })

export async function installConnectionFixture(page, { connection = emptyConnection(), connections = connection.mode === 'unconfigured' ? [] : [connection], localConnection = null, tatum = false, memory = false, accountId = SYNTHETIC_ACCOUNT_ID } = {}) {
  const auth = await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  const state = { connection: connections.find(item => item.id === connection.id) || connections.at(-1) || emptyConnection(),
    modelConnections: [...connections], localConnection, tatum, memory, accountId, memoryEpoch: 0 }
  function install(next, select = true) {
    const index = state.modelConnections.findIndex(item => item.id === next.id)
    if (index < 0) state.modelConnections.push(next)
    else state.modelConnections[index] = next
    if (select || state.connection.mode === 'unconfigured' || state.connection.id === next.id) state.connection = next
    return next
  }
  function remove(id) {
    state.modelConnections = state.modelConnections.filter(item => item.id !== id)
    if (state.connection.id === id) state.connection = state.modelConnections.at(-1) || emptyConnection()
  }
  function setConnections(next) { state.modelConnections = [...next]; state.connection = next.at(-1) || emptyConnection() }
  const requests = []
  const failures = new Map()
  const holds = new Map()
  const capabilities = { streaming: 'verified', tools: 'verified' }
  const catalog = { discovered: true, models: [...new Set(['synthetic-exact-model', 'synthetic-discovered-only', 'synthetic-model', 'synthetic-vault-exact-model',
    ...connections.flatMap(profile => profile.models.map(item => item.id))])] }
  const memoryConnection = () => state.memory ? { accountId: state.accountId, owner: auth.address, publicKey: '2'.repeat(64), verified: true,
    verifiedAt: new Date(Date.parse('2026-11-08T16:00:00Z') + state.memoryEpoch * 1000).toISOString() } : null
  const memoryStatus = () => ({ mode: state.memory ? 'relayer' : 'unconfigured', network: state.memory ? 'mainnet' : null,
    healthy: state.memory, writeReady: state.memory, accountConfigured: state.memory, accountId: state.memory ? state.accountId : null,
    relayerUrl: state.memory ? OFFICIAL_RELAYER : '' })
  await page.route('**/api/agent/**', async route => {
    const request = route.request()
    const url = new URL(request.url()), path = url.pathname.replace('/api/agent', '')
    if (path.startsWith('/auth/') || request.headers()['x-recallloop-session'] !== auth.sessionTag) return route.continue()
    const entry = { path, method: request.method(), body: request.postData() ? request.postDataJSON() : null, sessionTag: request.headers()['x-recallloop-session'] }
    requests.push(entry)
    async function reply(json, status = 200, response) {
      const hold = holds.get(path)
      if (hold) {
        holds.delete(path)
        hold.started.resolve(entry)
        await hold.release.promise
      }
      try { await route.fulfill({ ...(response ? { response } : {}), status, json }) }
      finally { hold?.finished.resolve() }
    }
    if (path === '/memory/handoff') {
      const failure = failures.get(path)
      if (failure) { failures.delete(path); return reply({ success: false, retryable: false, ...failure }, 502) }
      if (!state.memory) return reply({ code: 'memory_handoff_unavailable', error: 'Verify your own Walrus connection first.', retryable: false }, 412)
      return reply(createMemoryHandoff({ kind: 'wallet', address: auth.address, agentId: auth.agentId, memoryConnection: memoryConnection(),
        env: { RECALLLOOP_MEMORY_MODE: 'relayer', WALRUS_NETWORK: 'mainnet', MEMWAL_SERVER_URL: OFFICIAL_RELAYER, MEMWAL_ACCOUNT_ID: state.accountId } }))
    }
    if (path === '/status') {
      const response = await route.fetch()
      if (!response.ok()) return route.fulfill({ response })
      const data = await response.json()
      return reply({ ...data, llm: state.connection, modelConnections: state.modelConnections, memory: memoryStatus(), memoryConnection: memoryConnection(),
        tatum: { configured: state.tatum, verified: state.tatum, verifiedAt: state.tatum ? '2026-11-08T16:00:00Z' : undefined } }, response.status(), response)
    }
    if (path === '/memory') return route.fulfill({ json: { status: memoryStatus(), inventory: { success: state.memory, total: 0,
      meetsHackathonMinimum: false, namespaces: [], memories: [] } } })
    if (path === '/chain') return route.fulfill({ json: { configured: state.tatum, checkpoint: state.tatum ? { checkpoint: '123' } : null,
      account: null, notice: 'Synthetic browser fixture; not independent storage evidence.' } })
    if (path === '/models') {
      const selected = state.modelConnections.find(item => item.id === url.searchParams.get('connectionId')) || state.connection
      return reply(selected.models)
    }
    if (request.method() !== 'POST') return route.continue()
    let json = { success: true }, status = 200
    const target = entry.body?.connectionId ? state.modelConnections.find(item => item.id === entry.body.connectionId) : state.connection
    if (['/verify', '/disconnect'].includes(path)) {
      if (!entry.body?.connectionId && state.modelConnections.length > 1) return reply({ code: 'connection_required', error: 'Select a provider profile.', retryable: false }, 400)
      if (!target || target.mode === 'unconfigured') return reply({ code: 'connection_not_found', error: 'This profile is no longer connected.', retryable: false }, 409)
    }
    const failure = failures.get(path)
    if (failure) {
      failures.delete(path)
      status = 502; json = { success: false, retryable: false, ...failure }
      if (path === '/verify') install({ ...target, verified: false,
        lastVerificationFailure: { checkedAt: '2026-11-08T16:01:00Z', code: failure.code, message: failure.error } }, false)
    } else if (path === '/models/discover') {
      json = { success: true, baseUrl: entry.body.baseUrl, apiStyle: entry.body.apiStyle, verified: false, discovered: catalog.discovered,
        models: catalog.models.map(item => typeof item === 'string' ? { id: item, label: item } : { ...item }) }
    } else if (path === '/models/local') {
      if (state.localConnection) install(state.localConnection, false)
      else remove('local-ollama')
      json = { success: true, available: Boolean(state.localConnection), connection: state.localConnection }
    } else if (path === '/connect') {
      const next = entry.body.mode === 'mock' ? { ...emptyConnection(), id: 'scripted-mock', name: 'Scripted mock', mode: 'mock', model: 'recallloop-mock',
        models: [{ id: 'recallloop-mock', label: 'recallloop-mock' }], baseUrl: '', apiStyle: 'chat', source: 'browser-session' }
        : syntheticConnection({ id: entry.body.profileId, name: entry.body.profileName, model: entry.body.model, baseUrl: entry.body.baseUrl,
          apiStyle: entry.body.apiStyle, toolsEnabled: entry.body.toolsEnabled, models: catalog.models.map(item => typeof item === 'string' ? { id: item, label: item } : { ...item }) })
      if (!next.models.some(item => item.id === next.model)) next.models.unshift({ id: next.model, label: next.model })
      if (entry.body.checkCapabilities) Object.assign(next.verification, { ...capabilities,
        tools: entry.body.toolsEnabled === false ? 'not_checked' : capabilities.tools })
      json.connection = install(next)
    } else if (path === '/verify') {
      json.connection = install(syntheticConnection({ ...target, verified: true, lastVerificationFailure: null,
        toolsEnabled: entry.body.toolsEnabled ?? target.toolsEnabled, verification: { ...syntheticConnection().verification, model: target.model,
          apiStyle: target.apiStyle, ...(entry.body.checkCapabilities ? { ...capabilities,
            tools: entry.body.toolsEnabled === false ? 'not_checked' : capabilities.tools } : {}) } }))
    } else if (path === '/disconnect') remove(target.id)
    else if (path === '/connections/tatum') { state.tatum = true; json.connection = { configured: true, verified: true } }
    else if (path === '/connections/tatum/verify') json.connection = { configured: state.tatum, verified: state.tatum }
    else if (path === '/connections/memwal') { state.memory = true; state.accountId = suiAddress(entry.body.accountId); state.memoryEpoch++; json.connection = memoryConnection() }
    else if (path === '/connections/memwal/verify') { state.memoryEpoch++; json.connection = memoryConnection() }
    else if (path === '/connections/tatum/disconnect') { state.tatum = false; state.memory = false; state.memoryEpoch++ }
    else if (path === '/connections/memwal/disconnect') { state.memory = false; state.memoryEpoch++ }
    else if (['/memory/seed', '/remember', '/memory/restore', '/chat'].includes(path)) {
      throw new Error(`This connection fixture must never execute ${path}. Use the real isolated mock for chat/memory tests.`)
    } else return route.continue()
    await reply(json, status)
  })
  return { state, requests, capabilities, catalog, setConnections,
    failNext(path, code, error) { failures.set(path, { code, error }) },
    holdNext(path) { const hold = { started: deferred(), release: deferred(), finished: deferred() }; holds.set(path, hold); return hold },
    // Discovery is a read-only POST, not connection installation/generation.
    mutations() { return requests.filter(request => request.method === 'POST' && request.path !== '/models/discover') },
  }
}
