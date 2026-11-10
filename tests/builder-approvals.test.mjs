import test from 'node:test'
import assert from 'node:assert/strict'
import { createApprovals } from '../server/builder/approvals.mjs'
import { BUILDER_LIMITS } from '../server/builder/policy.mjs'

test('approval reviews own immutable nested copies and cannot override their workspace or action', () => {
  const approvals = createApprovals({ workspaceId: 'workspace-a' })
  const input = { command: 'node -v', nested: { original: ['first'] } }
  const { approval } = approvals.create('command', input)
  input.command = 'not the reviewed command'; input.nested.original.push('changed')
  assert.equal(approval.command, 'node -v')
  assert.deepEqual(approval.nested.original, ['first'])
  assert.throws(() => { approval.command = 'mutated' }, TypeError)
  assert.throws(() => { approvals.list()[0].nested.original.push('mutated') }, TypeError)
  assert.throws(() => approvals.create('command', { workspaceId: 'forged' }), { code: 'invalid_request' })
  assert.throws(() => approvals.create('command', {}, { source: 'always' }), { code: 'invalid_request' })
  approvals.close()
})

test('tickets are workspace/action/digest bound and consumed once even when execution later fails', () => {
  const a = createApprovals({ workspaceId: 'a' }), b = createApprovals({ workspaceId: 'b' })
  const { approval } = a.create('file', { path: 'a.ts', after: 'reviewed' })
  assert.throws(() => b.take(approval.id, approval.digest), { code: 'approval_invalid' })
  assert.throws(() => a.take(approval.id, 'changed'), { code: 'approval_invalid' })
  assert.throws(() => a.take(approval.id, approval.digest, { kind: 'command' }), { code: 'approval_invalid' })
  assert.equal(a.take(approval.id, approval.digest).public.after, 'reviewed')
  assert.throws(() => a.take(approval.id, approval.digest), { code: 'approval_invalid' })
  a.close(); b.close()
})

test('agent approval waits reject on expiry, stop and workspace disposal; manual tickets also expire', async () => {
  let now = 1000
  const approvals = createApprovals({ workspaceId: 'a', clock: () => now })
  const expiring = approvals.create('command', { command: 'node -v' }, { source: 'agent' })
  now += BUILDER_LIMITS.approvalMs
  assert.deepEqual(approvals.list(), [])
  await assert.rejects(expiring.wait, { code: 'approval_cancelled' })
  const controller = new AbortController()
  const stopped = approvals.create('file', { path: 'a.ts' }, { source: 'agent', signal: controller.signal })
  controller.abort()
  await assert.rejects(stopped.wait, { code: 'approval_cancelled' })
  const closed = approvals.create('command', {}, { source: 'agent' })
  approvals.close()
  await assert.rejects(closed.wait, { code: 'approval_cancelled' })
  assert.throws(() => approvals.create('command', {}), { code: 'workspace_closed' })
})

test('pending approval counts are bounded; resolving one agent ticket cannot authorize a later action', async () => {
  const approvals = createApprovals({ workspaceId: 'a' })
  const items = Array.from({ length: BUILDER_LIMITS.approvals }, () => approvals.create('command', {}, { source: 'agent' }))
  assert.throws(() => approvals.create('command', {}), { code: 'busy' })
  const entry = approvals.take(items[0].approval.id, items[0].approval.digest)
  entry.resolve({ approved: true })
  assert.deepEqual(await items[0].wait, { approved: true })
  approvals.cancelAgent()
  await Promise.all(items.slice(1).map(item => assert.rejects(item.wait, { code: 'approval_cancelled' })))
  assert.deepEqual(approvals.list(), [])
  approvals.close()
})
