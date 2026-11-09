import test from 'node:test'
import assert from 'node:assert/strict'
import { normalisePlan, normaliseQuestion, historyForMessages, turnLabel, toolLabel } from '../src/agent/workflow.ts'
import { createSession, saveSessions, loadSessions, SESSION_KEY } from '../src/agent/sessionStore.ts'
import { registerBrowserSecret, clearBrowserSecrets, scopedCacheKey } from '../src/agent/clientSafety.ts'
import { validateChat } from '../server/agent/chat.mjs'
import { validateConnection } from '../server/agent/connections.mjs'

const plan = overrides => ({ id: 'plan-one', summary: 'A short trip', steps: ['Confirm departure.', 'Confirm timing.'], ...overrides })
const question = overrides => ({ id: 'question-one', question: 'Which city will you depart from?', why: 'The departure city is missing.', options: [], ...overrides })
const message = overrides => ({ id: 'message-one', role: 'assistant', createdAt: '2026-11-08T10:00:00Z', status: 'complete', content: '', ...overrides })
function storage() {
  const data = new Map()
  return { data, getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
}

test('workflow metadata is bounded, credential-redacted, literal data and never preserves a selected default or arbitrary context', t => {
  t.after(clearBrowserSecrets)
  const key = 'synthetic-workflow-browser-key'
  registerBrowserSecret(key)
  const cleanPlan = normalisePlan(plan({ summary: key, steps: [key], context: 'private recalled context' }))
  const cleanQuestion = normaliseQuestion(question({ question: key, why: key, options: [key], selected: key, context: 'private recalled context' }))
  assert.equal(JSON.stringify([cleanPlan, cleanQuestion]).includes(key), false)
  assert.equal(JSON.stringify([cleanPlan, cleanQuestion]).includes('private recalled context'), false)
  assert.equal(Object.hasOwn(cleanQuestion, 'selected'), false)
  assert.equal(cleanPlan.steps[0], '[REDACTED]')
})

test('malformed and oversized workflow plans/questions are ignored safely rather than granting new actions', () => {
  for (const raw of [null, [], plan({ id: 5 }), plan({ summary: '' }), plan({ steps: [] }), plan({ steps: Array(7).fill('step') }),
    plan({ steps: [null] }), plan({ steps: ['x'.repeat(241)] }), plan({ steps: ['\0bad'] })]) assert.equal(normalisePlan(raw), undefined)
  for (const raw of [null, [], question({ question: '' }), question({ question: 'x'.repeat(401) }), question({ why: 5 }),
    question({ options: {} }), question({ options: Array(5).fill('reply') }), question({ options: [true] }), question({ options: [' '] })]) assert.equal(normaliseQuestion(raw), undefined)
  assert.deepEqual(normaliseQuestion(question({ options: ['Known reply', 'Known reply'] })).options, ['Known reply'])
})

test('wallet-scoped cache flushing preserves a paused question and plan, excludes recalled text, and keeps blocked calls honest', t => {
  t.after(clearBrowserSecrets)
  const cache = storage(), session = createSession(), key = 'synthetic-paused-question-key'
  registerBrowserSecret(key)
  session.messages = [message({ content: key, mode: 'plan', plan: plan({ summary: key }), question: question({ why: key }),
    memory: { memories: [{ blobId: 'citation', text: 'private recalled departure', distance: 0.1 }], tokenEstimate: 16, lookups: 2 },
    tools: [{ id: 'blocked', name: 'remember', status: 'blocked', preview: key }] })]
  assert.equal(saveSessions([session], cache, 'wallet-one'), true)
  const raw = cache.getItem(scopedCacheKey(SESSION_KEY, 'wallet-one'))
  assert.equal(raw.includes(key), false)
  assert.equal(raw.includes('private recalled departure'), false)
  const restored = loadSessions(cache, 'wallet-one').sessions[0].messages[0]
  assert.equal(restored.question.question, question().question)
  assert.equal(restored.plan.summary, '[REDACTED]')
  assert.equal(restored.mode, 'plan')
  assert.equal(restored.tools[0].status, 'blocked')
  assert.equal(restored.memory.lookups, 2)
  assert.equal(turnLabel(restored), 'Needs your reply')
  assert.equal(loadSessions(cache, 'wallet-two').sessions.length, 0)
})

test('question-only completed turns remain in model history and suggested replies never become user statements before Send', () => {
  const history = historyForMessages([
    message({ role: 'user', content: 'Plan a trip.' }),
    message({ plan: plan(), question: question({ options: ['I depart from Paris.'] }) }),
    message({ role: 'user', content: 'I depart from London.' }),
    message({ status: 'stopped', content: 'An interrupted guess must not become context.' }),
  ])
  assert.equal(history.length, 3)
  assert.match(history[1].content, /Working plan \(proposed steps, not completed actions\)/)
  assert.match(history[1].content, /Which city will you depart from/)
  assert.equal(history[2].content, 'I depart from London.')
  assert.equal(JSON.stringify(history).includes('I depart from Paris.'), false)
  assert.equal(JSON.stringify(history).includes('interrupted guess'), false)
})

test('workflow history stays within existing message limits and redacts credentials before truncation', t => {
  t.after(clearBrowserSecrets)
  const key = 'synthetic-workflow-history-key'
  registerBrowserSecret(key)
  const history = historyForMessages(Array.from({ length: 25 }, (_, i) => message({ id: `message-${i}`, content: 'x'.repeat(19_995) + key, plan: plan(), question: question() })))
  assert.equal(history.length, 20)
  assert.ok(history.every(item => item.content.length <= 20_000 && !item.content.includes(key)))
})

test('long clarification turns retain the question, working plan and preceding user task inside the server history budget', () => {
  const task = 'Plan a quick trip to Alaska. '.padEnd(4000, 'x')
  const reply = 'I depart from London. '.padEnd(4000, 'y')
  for (const content of ['Long reply. '.repeat(3000), `${'Long reply. '.repeat(3000)}\n${question().question}`]) {
    const history = historyForMessages([
      message({ role: 'user', content: 'Older context that can be pruned.' }),
      message({ role: 'user', content: task }),
      message({ content, plan: plan(), question: question({ options: ['I depart from Paris.'] }) }),
    ])
    const input = validateChat({ sessionId: 'long-clarification', message: reply, history, capture: false,
      project: { name: 'Planning', files: [], activeFile: null } }, validateConnection({ mode: 'mock' }))
    assert.deepEqual(input.history.map(item => item.role), ['user', 'assistant'])
    assert.equal(input.history[0].content, task)
    assert.ok(input.history[1].content.length <= 4000)
    assert.match(input.history[1].content, /Which city will you depart from/)
    assert.match(input.history[1].content, /The departure city is missing/)
    assert.match(input.history[1].content, /Working plan \(proposed steps, not completed actions\)/)
    assert.equal(JSON.stringify(input.history).includes('I depart from Paris.'), false)
  }
})

test('workflow labels describe actual reply/review/tool state and never mark proposed plan steps as executed', () => {
  assert.equal(turnLabel(message({ status: 'pending' })), 'Recalling context…')
  assert.equal(turnLabel(message({ status: 'streaming', memory: { memories: [] }, plan: plan() })), 'Working through the plan…')
  assert.equal(turnLabel(message({ status: 'streaming', memory: { memories: [] }, tools: [{ id: 'read', name: 'read_file', status: 'running' }] })), 'Using bounded tools…')
  assert.equal(turnLabel(message({ question: question() }), false), 'Earlier clarification')
  assert.equal(turnLabel(message({ proposals: [{ status: 'pending' }] })), 'Review required')
  assert.equal(turnLabel(message({ plan: plan() })), 'Reply ready')
  assert.equal(turnLabel(message({ status: 'error', plan: plan() })), 'Turn interrupted')
  assert.equal(toolLabel({ name: 'propose_file' }), 'Prepare review proposal')
  assert.equal(toolLabel({ name: 'unknown_bounded_tool' }), 'unknown_bounded_tool')
})
