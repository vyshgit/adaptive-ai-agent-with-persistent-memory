import { deferred } from './helpers.mjs'

// Browser wiring fixtures only. All keys/IDs are synthetic, upstream requests are
// intercepted, and no fixture is evidence of API compatibility or Mainnet storage.
export function syntheticConnection(overrides = {}) {
  const model = overrides.model || 'synthetic-exact-model'
  const apiStyle = overrides.apiStyle || 'responses'
  return { mode: 'live', model, models: [model, 'synthetic-discovered-only'].map(id => ({ id, label: id })),
    baseUrl: 'https://agentrouter.org/v1', apiStyle, toolsEnabled: true, source: 'browser-session', verified: true,
    verification: { model, apiStyle, checkedAt: '2026-11-08T16:00:00Z', discovery: 'available', generation: 'verified',
      streaming: 'not_checked', tools: 'not_checked' }, lastVerificationFailure: null, expiresAt: null, ...overrides }
}

export const emptyConnection = () => ({ mode: 'unconfigured', model: '', models: [], apiStyle: 'responses', baseUrl: 'https://api.openai.com/v1',
  toolsEnabled: true, source: 'environment', verified: false, verification: null, lastVerificationFailure: null, expiresAt: null })

export async function installConnectionFixture(page, { connection = emptyConnection(), tatum = false, memory = false } = {}) {
  const auth = await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  const state = { connection, tatum, memory }
  const requests = []
  const failures = new Map()
  const holds = new Map()
  const capabilities = { streaming: 'verified', tools: 'verified' }
  const memoryConnection = () => state.memory ? { accountId: '0xa', owner: auth.address, publicKey: '2'.repeat(64), verified: true, verifiedAt: '2026-11-08T16:00:00Z' } : null
  const memoryStatus = () => ({ mode: state.memory ? 'relayer' : 'unconfigured', network: state.memory ? 'mainnet' : null,
    healthy: state.memory, writeReady: state.memory, accountConfigured: state.memory, accountId: state.memory ? '0xa' : null,
    relayerUrl: state.memory ? 'https://memory.walrus.xyz' : '' })
  await page.route('**/api/agent/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/agent', '')
    if (path.startsWith('/auth/') || request.headers()['x-recallloop-session'] !== auth.sessionTag) return route.continue()
    const entry = { path, method: request.method(), body: request.postData() ? request.postDataJSON() : null, sessionTag: request.headers()['x-recallloop-session'] }
    requests.push(entry)
    if (path === '/status') {
      const response = await route.fetch()
      if (!response.ok()) return route.fulfill({ response })
      const data = await response.json()
      return route.fulfill({ response, json: { ...data, llm: state.connection, memory: memoryStatus(), memoryConnection: memoryConnection(),
        tatum: { configured: state.tatum, verified: state.tatum, verifiedAt: state.tatum ? '2026-11-08T16:00:00Z' : undefined } } })
    }
    if (path === '/memory') return route.fulfill({ json: { status: memoryStatus(), inventory: { success: state.memory, total: 0,
      meetsHackathonMinimum: false, namespaces: [], memories: [] } } })
    if (path === '/chain') return route.fulfill({ json: { configured: state.tatum, checkpoint: state.tatum ? { checkpoint: '123' } : null,
      account: null, notice: 'Synthetic browser fixture; not independent storage evidence.' } })
    if (request.method() !== 'POST') return route.continue()
    let json = { success: true }, status = 200
    const failure = failures.get(path)
    if (failure) {
      failures.delete(path)
      status = 502; json = { success: false, retryable: false, ...failure }
      if (path === '/verify') state.connection = { ...state.connection, verified: false,
        lastVerificationFailure: { checkedAt: '2026-11-08T16:01:00Z', code: failure.code, message: failure.error } }
    } else if (path === '/connect') {
      state.connection = entry.body.mode === 'mock' ? { ...emptyConnection(), mode: 'mock', model: 'recallloop-mock',
        models: [{ id: 'recallloop-mock', label: 'recallloop-mock' }], baseUrl: '', apiStyle: 'chat', source: 'browser-session' }
        : syntheticConnection({ model: entry.body.model, baseUrl: entry.body.baseUrl, apiStyle: entry.body.apiStyle, toolsEnabled: entry.body.toolsEnabled })
      if (entry.body.checkCapabilities) Object.assign(state.connection.verification, { ...capabilities,
        tools: entry.body.toolsEnabled === false ? 'not_checked' : capabilities.tools })
      json.connection = state.connection
    } else if (path === '/verify') {
      state.connection = syntheticConnection({ ...state.connection, verified: true, lastVerificationFailure: null,
        toolsEnabled: entry.body.toolsEnabled, verification: { ...syntheticConnection().verification, model: state.connection.model,
          apiStyle: state.connection.apiStyle, ...(entry.body.checkCapabilities ? { ...capabilities,
            tools: entry.body.toolsEnabled === false ? 'not_checked' : capabilities.tools } : {}) } })
      json.connection = state.connection
    } else if (path === '/disconnect') state.connection = emptyConnection()
    else if (path === '/connections/tatum') { state.tatum = true; json.connection = { configured: true, verified: true } }
    else if (path === '/connections/tatum/verify') json.connection = { configured: state.tatum, verified: state.tatum }
    else if (path === '/connections/memwal') { state.memory = true; json.connection = memoryConnection() }
    else if (path === '/connections/memwal/verify') json.connection = memoryConnection()
    else if (path === '/connections/tatum/disconnect') { state.tatum = false; state.memory = false }
    else if (path === '/connections/memwal/disconnect') state.memory = false
    else if (['/memory/seed', '/remember', '/memory/restore', '/chat'].includes(path)) {
      throw new Error(`This connection fixture must never execute ${path}. Use the real isolated mock for chat/memory tests.`)
    } else return route.continue()
    const hold = holds.get(path)
    if (hold) {
      holds.delete(path)
      hold.started.resolve(entry)
      await hold.release.promise
    }
    await route.fulfill({ status, json })
  })
  return { state, requests, capabilities,
    failNext(path, code, error) { failures.set(path, { code, error }) },
    holdNext(path) { const hold = { started: deferred(), release: deferred() }; holds.set(path, hold); return hold },
    mutations() { return requests.filter(request => request.method === 'POST') },
  }
}
