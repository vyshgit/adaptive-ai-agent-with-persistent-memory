import { createHash, randomBytes } from 'node:crypto'
import { AppError } from '../safety.mjs'
import { BUILDER_LIMITS } from './policy.mjs'

export const reviewDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

// There is deliberately no "always allow", saved permission, caller-defined
// scope, or model-callable approval endpoint. Actions classified as risky (or
// explicitly reviewed) use tickets. Every ticket is login/workspace-
// scoped, immutable, short-lived and consumed exactly once, including failures.
export function createApprovals({ workspaceId, clock = Date.now, onEvent = () => {} }) {
  const pending = new Map()
  let closed = false
  function remove(id, reason) {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    clearTimeout(entry.timer)
    entry.signal?.removeEventListener('abort', entry.onAbort)
    if (reason) entry.reject?.(new AppError('approval_cancelled', reason, 409))
    return entry
  }
  function sweep() { for (const [id, entry] of pending) if (entry.public.expiresAt <= clock()) remove(id, 'The approval expired. Request a new review.') }
  function create(kind, details, { source = 'manual', signal, binding } = {}) {
    sweep(); signal?.throwIfAborted()
    if (closed) throw new AppError('workspace_closed', 'The local workspace was closed.', 409)
    if (!['file', 'command', 'memory'].includes(kind) || (kind === 'memory' && source !== 'manual')
      || !['manual', 'agent'].includes(source) || !details || Array.isArray(details)
      || Object.keys(details).some(key => ['workspaceId', 'kind', 'source', 'id', 'digest', 'expiresAt'].includes(key))) {
      throw new AppError('invalid_request', 'Approval identity and action type must be assigned by the builder service.')
    }
    if (pending.size >= BUILDER_LIMITS.approvals) throw new AppError('busy', 'Review or reject pending actions before creating more.', 429)
    const id = randomBytes(24).toString('hex')
    // Own a deep copy before hashing. Neither a tool input, an event subscriber,
    // nor a later editor change may mutate the action waiting for approval.
    const review = freeze({ ...JSON.parse(JSON.stringify(details)), workspaceId, kind, source })
    const publicValue = freeze({ ...review, id, digest: reviewDigest(review), expiresAt: clock() + BUILDER_LIMITS.approvalMs })
    let resolve, reject
    const wait = source === 'agent' ? new Promise((yes, no) => { resolve = yes; reject = no }) : null
    // Rejections may race a cancelled SSE consumer. Always attach a handler.
    wait?.catch(() => {})
    // Optional server-only connection binding; never serialized or model-visible.
    const entry = { public: publicValue, review, resolve, reject, signal, binding }
    entry.onAbort = () => remove(id, 'The task stopped before approval.')
    entry.timer = setTimeout(() => remove(id, 'The approval expired. Request a new review.'), BUILDER_LIMITS.approvalMs)
    entry.timer.unref()
    signal?.addEventListener('abort', entry.onAbort, { once: true })
    pending.set(id, entry)
    onEvent({ type: 'approval', data: publicValue })
    return { approval: publicValue, wait }
  }
  function take(id, digest, { kind, source } = {}) {
    sweep()
    const entry = pending.get(id)
    if (!entry || entry.public.workspaceId !== workspaceId || entry.public.digest !== digest
      || reviewDigest(entry.review) !== digest
      || (kind && entry.public.kind !== kind) || (source && entry.public.source !== source)) {
      throw new AppError('approval_invalid', 'This approval is missing, changed, expired, or belongs to another workspace. Request a new review.', 409)
    }
    return remove(id)
  }
  return { create, take, list() { sweep(); return [...pending.values()].map(entry => entry.public) },
    cancelAgent() { for (const [id, entry] of pending) if (entry.public.source === 'agent') remove(id, 'The coding task stopped.') },
    cancelMemory() { for (const [id, entry] of pending) if (entry.public.kind === 'memory') remove(id, 'The memory connection changed. Review a new checkpoint.') },
    cancelActions() { for (const [id, entry] of pending) if (entry.public.kind !== 'memory') remove(id, 'The permission mode changed. Request a new review.') },
    close() { closed = true; for (const id of pending.keys()) remove(id, 'The local workspace was closed.') } }
}
