import test from 'node:test'
import assert from 'node:assert/strict'
import { editorAfterApply, dismissReview, workingHistory } from '../src/agent/builderState.ts'

const file = { path: 'a.ts', content: 'before\n', version: 'old-version', bytes: 7, redacted: false }
const next = { ...file, content: 'approved\n', version: 'new-version', bytes: 9 }
const approval = { id: 'first', kind: 'file', before: file.content, after: next.content }

test('confirmed disk results update an unchanged or exact-reviewed draft, not newer editor work', () => {
  for (const draft of [file.content, approval.after]) assert.deepEqual(editorAfterApply(file, draft, next, approval), { file: next, draft: next.content, keptDraft: false })
  assert.deepEqual(editorAfterApply(file, 'LATER_USER_WORK\n', next, approval), { file: next, draft: 'LATER_USER_WORK\n', keptDraft: true })
  assert.deepEqual(editorAfterApply(file, 'unsaved agent-side draft\n', next), { file: next, draft: 'unsaved agent-side draft\n', keptDraft: true })
})

test('automatic editor saves acknowledge the submitted text without replacing a later draft', () => {
  const submitted = { kind: 'file', after: next.content }
  assert.deepEqual(editorAfterApply(file, next.content, next, submitted), { file: next, draft: next.content, keptDraft: false })
  assert.deepEqual(editorAfterApply(file, 'TYPED_AFTER_AUTO_SAVE\n', next, submitted), { file: next, draft: 'TYPED_AFTER_AUTO_SAVE\n', keptDraft: true })
  assert.deepEqual(editorAfterApply(file, file.content, next), { file: next, draft: next.content, keptDraft: false })
})

test('a reviewed deletion does not destroy a later unsaved draft and never restores source automatically', () => {
  const removed = { ...file, content: null, version: null, bytes: 0 }
  assert.deepEqual(editorAfterApply(file, file.content, removed, { ...approval, after: null }), { file: null, draft: '', keptDraft: false })
  assert.deepEqual(editorAfterApply(file, 'draft to keep\n', removed, { ...approval, after: null }), { file: removed, draft: 'draft to keep\n', keptDraft: true })
})

test('a delayed acknowledgement can dismiss its own review but cannot close a newer approval dialog', () => {
  const later = { ...approval, id: 'second' }
  assert.equal(dismissReview(approval, 'first'), null)
  assert.equal(dismissReview(later, 'first'), later)
  assert.equal(dismissReview(null, 'first'), null)
})

const run = (id, overrides = {}) => ({ id, prompt: `User task ${id}`, answer: `Visible answer ${id}`, status: 'complete', mode: 'build', model: 'test-model',
  tools: [{ id: 'private-tool', name: 'read_file', output: 'PRIVATE_TOOL_OUTPUT', status: 'complete' }],
  memories: [{ blobId: 'private-blob', text: 'PRIVATE_RECALL_NOT_IN_PROSE', tier: 'facts' }],
  approvalId: 'PRIVATE_APPROVAL', providerResponseId: 'PRIVATE_PROVIDER_REFERENCE', ...overrides })

test('follow-up history includes only the six most recent runs of visible user/assistant prose, in chronological order', () => {
  const runs = Array.from({ length: 10 }, (_, id) => run(id))
  const history = workingHistory(runs)
  assert.equal(history.length, 12)
  assert.deepEqual(history[0], { role: 'user', content: 'User task 4' })
  assert.deepEqual(history.at(-1), { role: 'assistant', content: 'Visible answer 9' })
  assert.ok(history.every(message => ['user', 'assistant'].includes(message.role) && Object.keys(message).length === 2))
  assert.doesNotMatch(JSON.stringify(history), /PRIVATE_|read_file|test-model/)
  assert.deepEqual(workingHistory([]), [])
})

test('history is capped at 24,000 characters and 8,000 per message, retaining the newest complete run pairs', () => {
  const long = run('long', { prompt: 'p'.repeat(20_000), answer: 'a'.repeat(20_000) })
  assert.deepEqual(workingHistory([long]).map(message => message.content.length), [8000, 8000])
  const history = workingHistory([run('old'), long, run('latest', { prompt: 'n'.repeat(6000), answer: 'z'.repeat(6000) })])
  assert.equal(history.length, 2)
  assert.equal(history.reduce((total, message) => total + message.content.length, 0), 12_000)
  const exact = workingHistory([run('older', { prompt: 'x'.repeat(6000), answer: 'y'.repeat(6000) }), run('newer', { prompt: 'n'.repeat(6000), answer: 'z'.repeat(6000) })])
  assert.equal(exact.reduce((total, message) => total + message.content.length, 0), 24_000)
})

test('stopped and failed tasks stay visibly uncertain in follow-up history, including when no answer arrived', () => {
  for (const status of ['stopped', 'error']) {
    const history = workingHistory([run(status, { status, answer: 'Partial prose', error: 'PRIVATE_ERROR_DETAIL' })])
    assert.match(history[1].content, new RegExp(`Partial prose\\n\\[This earlier task ${status}; inspect current files before continuing\\.\\]`))
    assert.doesNotMatch(JSON.stringify(history), /PRIVATE_ERROR_DETAIL/)
    assert.match(workingHistory([run(status, { status, answer: '' })])[1].content, /inspect current files/)
    const capped = workingHistory([run(status, { status, answer: 'p'.repeat(20_000) })])[1].content
    assert.ok(capped.length <= 8000)
    assert.match(capped, /inspect current files before continuing\.\]$/)
  }
  assert.deepEqual(workingHistory([run('empty', { answer: '' })]), [{ role: 'user', content: 'User task empty' }])
})
