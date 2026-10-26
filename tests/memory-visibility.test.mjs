import test from 'node:test'
import assert from 'node:assert/strict'
import { isDashboardVisibleMemory } from '../server/memory-visibility.mjs'

test('dashboard state hides memory records owned by external agents', () => {
  assert.equal(isDashboardVisibleMemory({ agentId: 'agent-a', title: 'private agent memory' }), false)
  assert.equal(isDashboardVisibleMemory({ agentId: 'agent-b', title: 'another private memory' }), false)
})

test('dashboard state retains demo/bootstrap memories without an agent owner', () => {
  assert.equal(isDashboardVisibleMemory({ title: 'bootstrap demo' }), true)
  assert.equal(isDashboardVisibleMemory({ agentId: null, title: 'legacy demo' }), true)
})

test('dashboard state retains memories explicitly created in the dashboard', () => {
  assert.equal(isDashboardVisibleMemory({ agentId: 'recallloop-dashboard', title: 'dashboard memory' }), true)
})

test('dashboard state does not expose malformed/null records', () => {
  assert.equal(isDashboardVisibleMemory(null), false)
  assert.equal(isDashboardVisibleMemory(undefined), false)
  assert.equal(isDashboardVisibleMemory([]), false)
})
