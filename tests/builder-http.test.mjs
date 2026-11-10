import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { workspaceHttp, deferred } from './helpers/workspace-http.mjs'
import { temporaryProject } from './helpers/builder-fixture.mjs'
import { parseSse } from '../server/agent/sse.mjs'
import { within } from '../server/safety.mjs'
import { createStaticPreview } from '../server/builder/preview.mjs'
import { BUILDER_LIMITS } from '../server/builder/policy.mjs'

async function fixture(t, options = {}) {
  const directory = await temporaryProject(t)
  const engines = []
  const engineFactory = async args => {
    const engine = { args, closed: false, prompt: options.prompt || (async () => ({ answer: 'Offline result', requests: 1, finishReason: 'stop' })),
      command: options.command || (async (input, { onEvent }) => { onEvent?.({ type: 'terminal_output', data: { text: '42\n' } }); return { output: '42\n', status: 'exited', exitCode: 0, command: input.command, cwd: input.cwd } }),
      async close() { this.closed = true } }
    engines.push(engine)
    return engine
  }
  const f = await workspaceHttp(t, { ...options, builder: { directory, engineFactory, ...options.builder } })
  const browser = f.client()
  await browser.demo()
  const opened = await browser.json('/builder/open', { body: { confirm: 'open-local-folder' } })
  assert.equal(opened.status, 200)
  return { ...f, browser, directory, engines, workspaceId: opened.data.workspaceId }
}
const fileUrl = (f, value) => `/builder/file?${new URLSearchParams({ workspaceId: f.workspaceId, path: value })}`
async function events(response) {
  assert.equal(response.status, 200)
  const result = []
  for await (const frame of parseSse(response.body)) result.push({ type: frame.event, data: JSON.parse(frame.data) })
  return result
}
const decision = (approval, value = 'approve') => ({ workspaceId: approval.workspaceId, id: approval.id, digest: approval.digest, decision: value })
const settleSoon = promise => within(promise, 5000, null, AbortSignal.timeout(2000))

test('hosted execution stays disabled, and wallet login/opening a folder never reconnects models or authorizes writes', async t => {
  const hosted = await workspaceHttp(t), remote = hosted.client()
  assert.equal((await remote.json('/builder/status')).status, 401)
  await remote.demo()
  assert.equal((await remote.json('/builder/status')).data.enabled, false)
  assert.equal((await remote.json('/builder/open', { body: { confirm: 'open-local-folder', root: '/etc' } })).status, 403)
  const f = await fixture(t), wallet = f.client()
  await wallet.login()
  assert.equal((await wallet.json('/builder/open', { body: {} })).status, 412)
  assert.equal((await wallet.json('/builder/open', { body: { confirm: 'open-local-folder', root: f.directory } })).status, 400)
  const opened = await wallet.json('/builder/open', { body: { confirm: 'open-local-folder' } })
  assert.equal(opened.data.opened, true)
  assert.equal((await wallet.json('/builder/prompt', { body: { workspaceId: opened.data.workspaceId, text: 'Inspect files' } })).status, 412)
  assert.equal(f.engines.length, 0)
  assert.equal((await wallet.json('/status')).data.llm.mode, 'unconfigured')
})

test('builder routes bind the actual login, folder and immutable action; edits run only after exact once-only approval', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.directory, 'a.ts'), 'before\n')
  const original = await f.browser.json(fileUrl(f, 'a.ts'))
  const review = await f.browser.json('/builder/reviews/file', { body: { workspaceId: f.workspaceId, path: 'a.ts', version: original.data.version, content: 'after\n', reason: 'Test reviewed edit' } })
  const approval = review.data.approval
  assert.equal(await readFile(path.join(f.directory, 'a.ts'), 'utf8'), 'before\n')
  const other = f.client()
  await other.demo()
  await other.json('/builder/open', { body: { confirm: 'open-local-folder' } })
  assert.equal((await other.json('/builder/approvals', { body: decision(approval) })).status, 409)
  assert.equal((await f.client({ cookie: f.browser.cookie }).json(fileUrl(f, 'a.ts'))).status, 409)
  assert.equal((await f.browser.json('/builder/approvals', { body: { ...decision(approval), content: 'forged\n' } })).status, 400)
  assert.equal((await f.browser.json('/builder/approvals', { body: { ...decision(approval), digest: 'wrong' } })).status, 409)
  const applied = await events(await f.browser.request('/builder/approvals', { body: decision(approval) }))
  assert.deepEqual(applied.map(event => event.type), ['task_started', 'file_applied', 'done'])
  assert.equal(await readFile(path.join(f.directory, 'a.ts'), 'utf8'), 'after\n')
  assert.equal((await f.browser.json('/builder/approvals', { body: decision(approval) })).status, 409)
  assert.equal(f.engines.length, 0)
})

test('a concurrent editor change consumes but refuses the stale approval; closing/reopening also invalidates old capabilities', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.directory, 'a.ts'), 'before\n')
  const file = (await f.browser.json(fileUrl(f, 'a.ts'))).data
  const review = (await f.browser.json('/builder/reviews/file', { body: { workspaceId: f.workspaceId, path: 'a.ts', version: file.version, content: 'after\n' } })).data.approval
  await writeFile(path.join(f.directory, 'a.ts'), 'user work\n')
  const refused = await events(await f.browser.request('/builder/approvals', { body: decision(review) }))
  assert.equal(refused.at(-1).data.code, 'file_changed')
  assert.equal(await readFile(path.join(f.directory, 'a.ts'), 'utf8'), 'user work\n')
  assert.equal((await f.browser.json('/builder/approvals', { body: decision(review) })).status, 409)
  const pending = (await f.browser.json('/builder/reviews/command', { body: { workspaceId: f.workspaceId, command: 'node -v' } })).data.approval
  await f.browser.json('/builder/close', { body: { workspaceId: f.workspaceId } })
  const opened = await f.browser.json('/builder/open', { body: { confirm: 'open-local-folder' } })
  assert.notEqual(opened.data.workspaceId, f.workspaceId)
  assert.equal((await f.browser.json('/builder/approvals', { body: decision(pending) })).status, 409)
  assert.equal((await f.browser.json(fileUrl(f, 'a.ts'))).status, 409)
  assert.equal(f.engines.length, 0)
})

test('manual native execution uses only the immutable command and revalidated cwd, never browser env or app credentials', async t => {
  let executed
  const f = await fixture(t, { command: async input => { executed = input; return { status: 'exited', exitCode: 0, output: '42\n' } }, initialise(session) { session.tatumKey = 'synthetic-tatum-key' } })
  await mkdir(path.join(f.directory, 'src'))
  const refused = await f.browser.json('/builder/reviews/command', { body: { workspaceId: f.workspaceId, command: 'echo synthetic-tatum-key' } })
  assert.equal(refused.status, 403)
  assert.equal(refused.data.code, 'unsafe_command')
  assert.equal(executed, undefined)
  assert.equal((await f.browser.json('/builder/reviews/command', { body: { workspaceId: f.workspaceId, command: 'node -v', env: { TOKEN: 'x' } } })).status, 400)
  const review = (await f.browser.json('/builder/reviews/command', { body: { workspaceId: f.workspaceId, command: 'node -p "6 * 7"', cwd: 'src', timeoutMs: 5000 } })).data.approval
  assert.equal(executed, undefined)
  const frames = await events(await f.browser.request('/builder/approvals', { body: decision(review) }))
  assert.equal(frames.at(-1).data.result.exitCode, 0)
  assert.equal(executed.command, review.command)
  assert.equal(executed.absoluteCwd, path.join(f.directory, 'src'))
  assert.equal(executed.timeoutMs, 5000)
  assert.equal(Object.hasOwn(executed, 'env'), false)
  assert.equal(f.engines[0].closed, true)
})

test('agent tools wait for human approval, cannot approve themselves, and execute only the reviewed file', async t => {
  const waiting = deferred()
  const f = await fixture(t, { prompt: async (_args, { tool, onEvent }) => {
    await assert.rejects(tool('approve', { id: 'invented' }), { code: 'tool_denied' })
    const file = await tool('read_file', { path: 'a.ts' })
    waiting.resolve()
    const result = await tool('propose_file', { path: 'a.ts', version: file.version, content: 'reviewed agent edit\n', reason: 'Fix fixture' })
    assert.equal(result.deleted, false)
    onEvent({ type: 'delta', data: { text: 'Confirmed reviewed edit.' } })
    return { answer: 'Confirmed reviewed edit.', requests: 2, finishReason: 'stop' }
  } })
  await writeFile(path.join(f.directory, 'a.ts'), 'before\n')
  const response = await f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'Fix fixture' } })
  const collected = []
  for await (const frame of parseSse(response.body)) {
    collected.push({ type: frame.event, data: JSON.parse(frame.data) })
    if (frame.event !== 'approval') continue
    const ticket = collected.at(-1).data
    assert.equal(await readFile(path.join(f.directory, 'a.ts'), 'utf8'), 'before\n')
    assert.equal(ticket.source, 'agent')
    assert.equal((await f.browser.json('/connect', { body: { mode: 'mock' } })).status, 429)
    assert.equal((await f.browser.json('/remember', { body: { text: 'Do not auto-save logs' } })).status, 429)
    const accepted = await f.browser.json('/builder/approvals', { body: decision(ticket) })
    assert.equal(accepted.data.pendingExecution, true)
  }
  assert.deepEqual(collected.slice(-2).map(event => event.type), ['done', 'stored'])
  assert.equal(collected.at(-1).data.facts, 1)
  assert.equal(await readFile(path.join(f.directory, 'a.ts'), 'utf8'), 'reviewed agent edit\n')
  assert.equal((await f.browser.json('/memory')).data.inventory.total, 1)
  assert.equal(f.engines[0].closed, true)
})

test('rejection returns no authority to an agent; an approved command reports its actual failure without a fabricated pass', async t => {
  const f = await fixture(t, { prompt: async (_args, { tool }) => {
    const refused = await tool('run_command', { command: 'node -v', cwd: '.', timeoutMs: 1000, reason: 'Fixture' })
    assert.equal(refused.rejected, true)
    return { answer: 'The human rejected the command.', requests: 1, finishReason: 'stop' }
  }, command: async () => ({ output: 'fixture failed\n', status: 'exited', exitCode: 1 }) })
  const response = await f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'Request a command' } })
  for await (const frame of parseSse(response.body)) if (frame.event === 'approval') await f.browser.json('/builder/approvals', { body: decision(JSON.parse(frame.data), 'reject') })
  assert.equal(f.engines.length, 1)
  const review = (await f.browser.json('/builder/reviews/command', { body: { workspaceId: f.workspaceId, command: 'node -e "process.exit(1)"' } })).data.approval
  const frames = await events(await f.browser.request('/builder/approvals', { body: decision(review) }))
  assert.equal(frames.at(-1).data.result.exitCode, 1)
  assert.equal(frames.at(-1).data.result.status, 'exited')
})

test('logout while an agent awaits approval cancels its ticket and worker, and stale callbacks cannot resurrect access', async t => {
  let staleTool, ticket
  const f = await fixture(t, { prompt: async (_args, { tool }) => {
    staleTool = tool
    await tool('propose_file', { path: 'new.ts', version: null, content: 'not authorized\n' })
    assert.fail('A logged-out tool must not continue')
  } })
  const response = await f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'Suggest fixture file' } })
  const frames = []
  for await (const frame of parseSse(response.body)) {
    frames.push(frame)
    if (frame.event !== 'approval') continue
    ticket = JSON.parse(frame.data)
    assert.equal((await f.browser.json('/auth/logout', { body: {} })).status, 200)
  }
  assert.equal(f.engines[0].closed, true)
  assert.equal(f.sessions[0].active, 0)
  assert.equal(f.sessions[0].builder, null)
  await assert.rejects(staleTool('read_file', { path: 'new.ts' }), { code: 'wallet_required' })
  await assert.rejects(stat(path.join(f.directory, 'new.ts')), { code: 'ENOENT' })
  await f.browser.demo()
  assert.equal((await f.browser.json('/builder/status')).data.opened, false)
  assert.equal((await f.browser.json('/builder/approvals', { body: decision(ticket) })).status, 409)
})

test('global task slots, per-login concurrency and task-scoped cancellation are bounded and recover after stop', async t => {
  const gate = deferred(), started = deferred()
  let count = 0
  const f = await fixture(t, { prompt: async (_args, { signal }) => {
    if (++count === 2) started.resolve()
    await within(gate.promise, 30_000, null, signal)
    return { answer: 'Done', requests: 1, finishReason: 'stop' }
  } })
  const second = f.client(), third = f.client()
  for (const browser of [second, third]) { await browser.demo(); await browser.json('/builder/open', { body: { confirm: 'open-local-folder' } }) }
  const id2 = (await second.json('/builder/status')).data.workspaceId, id3 = (await third.json('/builder/status')).data.workspaceId
  const responses = await Promise.all([f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'First bounded task' } }),
    second.request('/builder/prompt', { body: { workspaceId: id2, text: 'Second bounded task' } })])
  await started.promise
  assert.equal((await third.json('/builder/prompt', { body: { workspaceId: id3, text: 'Third task' } })).status, 429)
  assert.equal((await f.browser.json('/builder/reviews/file', { body: { workspaceId: f.workspaceId, path: 'no.ts', content: 'x', version: null } })).status, 429)
  assert.equal((await f.browser.json('/builder/stop', { body: { workspaceId: f.workspaceId, taskId: 'another-task' } })).status, 409)
  const taskId = (await f.browser.json('/builder/status')).data.task.id
  assert.equal((await f.browser.json('/builder/stop', { body: { workspaceId: f.workspaceId, taskId } })).data.stopped, true)
  gate.resolve()
  await Promise.all(responses.map(events))
  assert.ok(f.engines.every(engine => engine.closed))
  assert.equal((await f.browser.json('/builder/status')).data.task, null)
  const next = await events(await third.request('/builder/prompt', { body: { workspaceId: id3, text: 'Now available' } }))
  assert.deepEqual(next.slice(-2).map(event => event.type), ['done', 'stored'])
})

test('split model/terminal credentials are redacted before streaming, and tasks never capture source or transcripts', async t => {
  const secret = 'synthetic-model-key'
  const f = await fixture(t, { initialise(session) { session.tatumKey = secret }, prompt: async (_args, { onEvent }) => {
    onEvent({ type: 'delta', data: { text: 'Do not leak synthetic-' } })
    onEvent({ type: 'delta', data: { text: 'model-key.' } })
    return { answer: `Do not leak ${secret}.`, requests: 1, finishReason: 'stop' }
  } })
  const frames = await events(await f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'Test redaction' } }))
  assert.equal(frames.filter(event => event.type === 'delta').map(event => event.data.text).join(''), 'Do not leak [REDACTED].')
  assert.equal(JSON.stringify(frames).includes(secret), false)
  const inventory = (await f.browser.json('/memory')).data.inventory
  assert.equal(inventory.total, 1)
  assert.equal(inventory.namespaces.find(item => item.name.endsWith(':raw')).count, 0)
  const recalled = await f.sessions[0].memory.recall({ agentId: f.sessions[0].agentId, query: 'Test redaction' })
  assert.ok(recalled.memories.every(memory => !memory.text.includes('Do not leak')))
  assert.equal((await f.browser.json('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'Forged provider', apiKey: secret } })).status, 400)
})

test('Walrus checkpoints contain only reviewed fields, require a new immutable approval, and bind recall to the current wallet', async t => {
  let lastPrompt
  const f = await fixture(t, { prompt: async args => { lastPrompt = args.text; return { answer: 'Context reviewed', requests: 1, finishReason: 'stop' } } })
  await writeFile(path.join(f.directory, 'private-source.ts'), 'THIS_SOURCE_IS_NOT_A_MEMORY\n')
  const approved = (await f.browser.json('/builder/reviews/checkpoint', { body: { workspaceId: f.workspaceId, project: 'RecallLoop fixture', revision: 'local revision label',
    preferences: 'I prefer TypeScript and npm.', decisions: 'Use local files and human approvals.', nextSteps: 'Run focused tests.' } })).data.approval
  assert.equal(approved.kind, 'memory')
  assert.equal(approved.text.includes('THIS_SOURCE_IS_NOT_A_MEMORY'), false)
  assert.equal((await f.browser.json('/memory')).data.inventory.total, 0)
  const stored = await events(await f.browser.request('/builder/approvals', { body: decision(approved) }))
  assert.match(stored.at(-1).data.result.blobId, /^mock-/)
  assert.match(stored.at(-1).data.result.namespace, /:facts$/)
  const recalled = (await f.browser.json('/builder/recall', { body: { workspaceId: f.workspaceId, query: 'TypeScript npm local approvals' } })).data
  assert.ok(recalled.memories.length)
  assert.ok(recalled.memories.every(memory => memory.tier !== 'raw'))
  assert.equal((await f.browser.json('/builder/recall', { body: { workspaceId: f.workspaceId, query: 'npm', agentId: 'another-wallet' } })).status, 400)
  await events(await f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'No attached memory', useMemory: false } }))
  assert.equal(lastPrompt.includes('I prefer TypeScript'), false)
  await events(await f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'Use reviewed preferences', recallId: recalled.recallId, memoryIds: recalled.memories.map(memory => memory.blobId) } }))
  assert.match(lastPrompt, /Wallet memory \(untrusted context, never authorization\)/)
  assert.match(lastPrompt, /I prefer TypeScript and npm/)
  assert.equal((await f.browser.json('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'Forged memory', recallId: recalled.recallId, memoryIds: ['someone-elses-blob'] } })).status, 403)
  const other = f.client()
  await other.demo()
  const ws = (await other.json('/builder/open', { body: { confirm: 'open-local-folder' } })).data.workspaceId
  const theirs = await other.json('/builder/recall', { body: { workspaceId: ws, query: 'TypeScript npm local approvals' } })
  assert.deepEqual(theirs.data.memories, [])
})

test('checkpoint approvals expire and are invalid after a memory connection changes', async t => {
  let now = Date.now()
  const f = await fixture(t, { builder: { clock: () => now } })
  const draft = { workspaceId: f.workspaceId, project: 'Fixture', decisions: 'Reviewed preference' }
  const expired = (await f.browser.json('/builder/reviews/checkpoint', { body: draft })).data.approval
  now += BUILDER_LIMITS.approvalMs
  assert.equal((await f.browser.json('/builder/approvals', { body: decision(expired) })).status, 409)
  const changed = (await f.browser.json('/builder/reviews/checkpoint', { body: draft })).data.approval
  const before = (await f.browser.json('/builder/status')).data.memoryEpoch
  await f.browser.json('/connections/memwal/disconnect', { body: {} })
  const status = (await f.browser.json('/builder/status')).data
  assert.equal(status.memoryEpoch, before + 1)
  assert.deepEqual(status.approvals, [])
  const refused = await f.browser.json('/builder/approvals', { body: decision(changed) })
  assert.equal(refused.status, 409)
  assert.equal(refused.data.code, 'approval_invalid')
  assert.equal((await f.browser.json('/memory')).data.inventory.total, 0)
})

test('static previews use an isolated origin, bounded snapshot capabilities, no backend routes, and logout revocation', async t => {
  const preview = await createStaticPreview()
  t.after(() => preview.close())
  const f = await fixture(t, { builder: { preview } })
  await mkdir(path.join(f.directory, 'dist'))
  await writeFile(path.join(f.directory, 'dist', 'index.html'), '<h1>Static fixture</h1><script>fetch("/api/agent/status")</script>')
  await writeFile(path.join(f.directory, 'dist', 'app.js'), 'document.title = "Fixture"')
  await writeFile(path.join(f.directory, 'dist', '.env'), 'not exposed')
  const created = await f.browser.json('/builder/preview', { body: { workspaceId: f.workspaceId, path: 'dist', entry: 'index.html' } })
  assert.equal(created.status, 200)
  assert.notEqual(new URL(created.data.url).origin, f.origin)
  const response = await fetch(created.data.url)
  assert.match(await response.text(), /Static fixture/)
  assert.match(response.headers.get('content-security-policy'), /sandbox allow-scripts/)
  assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/)
  assert.equal(response.headers.has('set-cookie'), false)
  assert.equal(response.headers.get('access-control-allow-origin'), 'null')
  assert.equal((await fetch(`${preview.origin}/api/agent/status`)).status, 404)
  assert.equal((await fetch(created.data.url.replace('index.html', '.env'))).status, 404)
  assert.equal((await fetch(created.data.url, { method: 'POST' })).status, 403)
  await writeFile(path.join(f.directory, 'dist', 'index.html'), 'later disk change')
  assert.match(await (await fetch(created.data.url)).text(), /Static fixture/)
  await f.browser.json('/auth/logout', { body: {} })
  assert.equal((await fetch(created.data.url)).status, 404)
})

test('the actual embedded SDK completes an offline coding task only after the HTTP human gate approves its proposed disk change', { timeout: 60_000 }, async t => {
  const directory = await temporaryProject(t)
  await writeFile(path.join(directory, 'greet.ts'), 'export function greet(name: string) {\n  return `Hello, ${name.trim()}!`\n}\n')
  const f = await workspaceHttp(t, { builder: { directory } }), browser = f.client()
  await browser.demo()
  const workspaceId = (await browser.json('/builder/open', { body: { confirm: 'open-local-folder' } })).data.workspaceId
  const response = await browser.request('/builder/prompt', { body: { workspaceId, text: 'Handle an empty greeting name', selectedPath: 'greet.ts' } })
  const frames = []
  for await (const frame of parseSse(response.body)) {
    frames.push({ type: frame.event, data: JSON.parse(frame.data) })
    if (frame.event !== 'approval') continue
    assert.match(await readFile(path.join(directory, 'greet.ts'), 'utf8'), /name\.trim\(\)\}/)
    assert.equal((await browser.json('/builder/approvals', { body: decision(frames.at(-1).data) })).status, 200)
  }
  assert.deepEqual(frames.slice(-2).map(event => event.type), ['done', 'stored'])
  assert.equal(frames.at(-2).data.requests, 3)
  assert.match(await readFile(path.join(directory, 'greet.ts'), 'utf8'), /\|\| 'friend'/)
  assert.equal((await browser.json('/memory')).data.inventory.total, 1)
})

for (const ending of ['stop', 'close', 'logout']) test(`${ending} during engine startup closes a late factory result without starting a prompt or restoring authority`, async t => {
  const started = deferred(), released = deferred(), aborted = deferred()
  let promptCalls = 0, closed = false
  const f = await fixture(t, { builder: { engineFactory: async ({ signal }) => {
    signal.addEventListener('abort', () => aborted.resolve(), { once: true })
    started.resolve()
    await released.promise // Deliberately models a factory that ignores cancellation.
    return { async prompt() { promptCalls++; return { answer: 'must not run' } }, async close() { closed = true } }
  } } })
  const response = await f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'Cancel before the private engine starts.' } })
  const collected = events(response)
  try {
    await settleSoon(started.promise)
    const taskId = (await f.browser.json('/builder/status')).data.task.id
    const terminating = ending === 'logout' ? f.browser.json('/auth/logout', { body: {} })
      : f.browser.json(`/builder/${ending}`, { body: { workspaceId: f.workspaceId, ...(ending === 'stop' ? { taskId } : {}) } })
    await settleSoon(aborted.promise)
    assert.equal(promptCalls, 0)
    released.resolve()
    assert.equal((await terminating).status, 200)
    const frames = await collected
    assert.equal(frames.some(frame => frame.type === 'done'), false)
    assert.equal(closed, true)
    assert.equal(promptCalls, 0)
    assert.equal(f.sessions[0].active, 0)
    if (ending === 'stop') {
      const status = (await f.browser.json('/builder/status')).data
      assert.equal(status.task, null)
      assert.deepEqual(status.approvals, [])
    } else assert.equal(f.sessions[0].builder, null)
  } finally { released.resolve(); await collected }
})

test('tool and combined-event budgets fail without issuing an extra approval or declaring completion, and task slots recover', async t => {
  let scenario = 'tools', staleTool
  const f = await fixture(t, { prompt: async (_args, { tool, onEvent }) => {
    staleTool = tool
    if (scenario === 'tools') {
      for (let count = 0; count < BUILDER_LIMITS.toolCalls; count++) await tool('list_files', { path: '.' })
      await tool('run_command', { command: 'node -v', cwd: '.', timeoutMs: 1000, reason: 'Must be outside the tool budget.' })
    } else if (scenario === 'events') onEvent({ type: 'delta', data: { text: 'x'.repeat(BUILDER_LIMITS.eventBytes + 1000) } })
    return { answer: 'Small task completed.', requests: 1, finishReason: 'stop' }
  } })
  let frames = await events(await f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'Offline tool-budget fixture.' } }))
  assert.equal(frames.filter(frame => frame.type === 'tool').length, BUILDER_LIMITS.toolCalls)
  assert.equal(frames.at(-1).data.code, 'tool_denied')
  assert.equal(frames.some(frame => frame.type === 'approval' || frame.type === 'done'), false)
  await assert.rejects(staleTool('list_files', { path: '.' }), { code: 'tool_denied' })
  scenario = 'events'
  frames = await events(await f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'Offline event-budget fixture.' } }))
  assert.equal(frames.at(-1).data.code, 'output_limit')
  assert.equal(frames.some(frame => frame.type === 'delta' || frame.type === 'done'), false)
  assert.ok(f.engines.every(engine => engine.closed))
  assert.equal(f.sessions[0].active, 0)
  scenario = 'small'
  frames = await events(await f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'The next smaller task can run.' } }))
  assert.deepEqual(frames.slice(-2).map(event => event.type), ['done', 'stored'])
  assert.equal((await f.browser.json('/memory')).data.inventory.total, 1)
})

test('builder auto-memory analyzes current prose after completion, excludes source/history/output, and can be disabled', async t => {
  const captured = []
  const f = await fixture(t, { initialise(session) {
    const ingest = session.memory.ingest
    session.memory.ingest = (value, options) => { captured.push({ value, options }); return ingest(value, options) }
  }, prompt: async (_args, { tool, onEvent }) => {
    await tool('read_file', { path: 'private.ts' })
    onEvent({ type: 'delta', data: { text: 'ASSISTANT_PRIVATE_OUTPUT' } })
    return { answer: 'ASSISTANT_PRIVATE_OUTPUT', finishReason: 'stop', requests: 1 }
  } })
  await writeFile(path.join(f.directory, 'private.ts'), 'SOURCE_PRIVATE_CONTENT\n')
  const task = { workspaceId: f.workspaceId, text: 'I prefer TypeScript; use npm.\n```\nPASTED_CODE_ONLY\n```', selectedPath: 'private.ts',
    history: [{ role: 'user', content: 'HISTORY_PRIVATE_CONTENT' }] }
  const frames = await events(await f.browser.request('/builder/prompt', { body: task }))
  assert.deepEqual(frames.slice(-2).map(event => event.type), ['done', 'stored'])
  assert.equal(frames.filter(event => event.type === 'done').length, 1)
  assert.equal(captured.length, 1)
  assert.deepEqual(captured[0].value.messages, [{ role: 'user', content: `Project: ${path.basename(f.directory)}\nI prefer TypeScript; use npm.` }])
  assert.equal(captured[0].options.automatic, true)
  for (const privateText of ['SOURCE_PRIVATE_CONTENT', 'ASSISTANT_PRIVATE_OUTPUT', 'HISTORY_PRIVATE_CONTENT', 'PASTED_CODE_ONLY', f.directory]) {
    assert.equal(JSON.stringify(captured).includes(privateText), false)
  }
  const disabled = await events(await f.browser.request('/builder/prompt', { body: { ...task, capture: false } }))
  assert.equal(disabled.at(-1).data.reason, 'disabled')
  assert.equal(captured.length, 1)
  assert.equal((await f.browser.json('/builder/prompt', { body: { ...task, capture: 'false' } })).status, 400)
})

test('incomplete, empty and failed coding results never start automatic memory or declare completion', async t => {
  let result, captures = 0
  const f = await fixture(t, { initialise(session) { session.memory.ingest = () => { captures++; assert.fail('No capture for an incomplete task') } },
    prompt: async () => { if (result instanceof Error) throw result; return result } })
  for (const value of [undefined, { answer: 'Partial', finishReason: 'length' }, { answer: 'Partial', finishReason: 'tool-calls' },
    { answer: 'Partial', finishReason: 'error' }, { answer: 'Partial' }, { answer: '', finishReason: 'stop' }, new Error('Synthetic engine failure')]) {
    result = value
    const frames = await events(await f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'I prefer TypeScript.' } }))
    assert.equal(frames.some(event => ['done', 'stored'].includes(event.type)), false)
    assert.equal(frames.at(-1).type, 'error')
    assert.equal(f.sessions[0].active, 0)
  }
  assert.equal(captures, 0)
})

for (const ending of ['pending', 'disconnect']) test(`accepted builder capture can finish after ${ending}, with one completion event and no premature storage claim`, async t => {
  const gate = deferred(), started = deferred()
  t.after(() => gate.resolve())
  let accepted
  const f = await fixture(t, { builder: { captureTimeoutMs: ending === 'pending' ? 2 : 10_000 }, initialise(session) {
    const ingest = session.memory.ingest
    session.memory.ingest = (value, options) => {
      started.resolve()
      accepted = gate.promise.then(() => ingest(value, options))
      return accepted
    }
  } })
  const controller = new AbortController()
  const response = await f.browser.request('/builder/prompt', { body: { workspaceId: f.workspaceId, text: 'I prefer TypeScript.' }, signal: controller.signal })
  const frames = []
  for await (const frame of parseSse(response.body)) {
    frames.push({ type: frame.event, data: JSON.parse(frame.data) })
    if (ending === 'disconnect' && frame.event === 'done') { controller.abort(); break }
  }
  await started.promise
  assert.equal(frames.filter(frame => frame.type === 'done').length, 1)
  if (ending === 'pending') {
    assert.equal(frames.at(-1).type, 'stored')
    assert.equal(frames.at(-1).data.pending, true)
    assert.equal(frames.at(-1).data.facts, 0)
  }
  assert.equal((await f.browser.json('/memory')).data.inventory.total, 0)
  gate.resolve()
  await accepted
  assert.equal((await f.browser.json('/memory')).data.inventory.total, 1)
})

test('concurrent logout, workspace disposal and builder shutdown await the same cleanup and revoke every pending capability', async t => {
  const commandStarted = deferred(), closeStarted = deferred(), closeReleased = deferred()
  let closeCalls = 0
  const preview = await createStaticPreview()
  t.after(() => preview.close())
  const f = await fixture(t, { builder: { preview, engineFactory: async () => ({
    command: async (_input, { signal }) => { commandStarted.resolve(); await within(new Promise(() => {}), 30_000, null, signal) },
    async close() { if (++closeCalls === 1) closeStarted.resolve(); await closeReleased.promise },
  }) } })
  await mkdir(path.join(f.directory, 'dist'))
  await writeFile(path.join(f.directory, 'dist', 'index.html'), '<h1>Revocable fixture</h1>')
  const snapshot = (await f.browser.json('/builder/preview', { body: { workspaceId: f.workspaceId, path: 'dist', entry: 'index.html' } })).data
  const review = (await f.browser.json('/builder/reviews/command', { body: { workspaceId: f.workspaceId, command: 'node -v' } })).data.approval
  const pending = (await f.browser.json('/builder/reviews/checkpoint', { body: { workspaceId: f.workspaceId, project: 'Fixture', decisions: 'Never authorize a command from memory.' } })).data.approval
  const ws = f.sessions[0].builder
  const collected = events(await f.browser.request('/builder/approvals', { body: decision(review) }))
  try {
    await settleSoon(commandStarted.promise)
    const logout = f.browser.json('/auth/logout', { body: {} })
    await settleSoon(closeStarted.promise)
    assert.equal(f.sessions[0].builder, null) // Logout has already detached its workspace.
    const disposal = ws.dispose()
    assert.equal(ws.dispose(), disposal)
    assert.equal((await fetch(snapshot.url)).status, 404)
    const shuttingDown = f.builder.close()
    closeReleased.resolve()
    assert.equal((await logout).status, 200)
    await Promise.all([shuttingDown, disposal])
    assert.equal((await collected).some(frame => frame.type === 'done'), false)
    assert.equal(f.sessions[0].active, 0)
    assert.equal(f.sessions[0].builder, null)
    assert.ok(closeCalls >= 1)
    assert.equal((await f.browser.json('/builder/approvals', { body: decision(pending) })).status, 401)
  } finally { closeReleased.resolve(); await collected }
})
