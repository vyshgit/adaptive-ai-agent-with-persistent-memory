import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryService } from '../server/memory/service.mjs'
import { deferred } from './helpers/workspace-http.mjs'

function pendingService(gate) {
  let started = 0
  const service = createMemoryService({ env: { RECALLLOOP_MEMORY_MODE: 'mock' }, chain: { checkpoint: async () => null }, backend: {
    mode: () => 'mock', getClient: () => ({ rememberBulkAndWait: async items => {
      started++
      await gate.promise
      return { results: items.map((_item, i) => ({ status: 'done', blob_id: `mock-pending-${started}-${i}` })) }
    } }), note() {}, destroy() {},
  } })
  return { service, get started() { return started } }
}
const remember = (service, id = 'pending-agent') => service.remember({ agentId: id, text: 'An explicit synthetic preference.' })

test('pending SDK writes remain bounded per memory service until they settle, including after disposal', async () => {
  const gate = deferred(), f = pendingService(gate)
  const first = remember(f.service), second = remember(f.service)
  assert.equal(f.started, 2)
  await assert.rejects(remember(f.service), error => error.code === 'memory_busy' && error.status === 429)
  f.service.destroy()
  await assert.rejects(remember(f.service), error => error.code === 'wallet_required')
  gate.resolve()
  const settled = await Promise.allSettled([first, second])
  assert.ok(settled.every(result => result.status === 'rejected'))
  const next = pendingService(gate)
  assert.equal((await remember(next.service)).success, true)
  next.service.destroy()
})

test('global write slots cover all memory services and recover when pending jobs complete', async () => {
  const gate = deferred()
  const fixtures = Array.from({ length: 9 }, () => pendingService(gate))
  const pending = fixtures.slice(0, 8).map(({ service }, i) => remember(service, `agent-${i}`))
  await assert.rejects(remember(fixtures[8].service), error => error.code === 'memory_busy')
  assert.equal(fixtures[8].started, 0)
  gate.resolve()
  assert.ok((await Promise.all(pending)).every(result => result.success))
  assert.equal((await remember(fixtures[8].service)).success, true)
  fixtures.forEach(({ service }) => service.destroy())
})
