import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile, symlink } from 'node:fs/promises'
import { workspaceHttp } from './helpers/workspace-http.mjs'
import { temporaryProject } from './helpers/builder-fixture.mjs'
import { parseSse } from '../server/agent/sse.mjs'

async function setup(t, options = {}) {
  const directory = await temporaryProject(t), commands = [], prompts = []
  const f = await workspaceHttp(t, { ...options, builder: { directory, engineFactory: async () => ({
    async prompt(args, context) { prompts.push(args); return options.prompt ? options.prompt(args, context) : { answer: 'Actual fixture result', requests: 1, finishReason: 'stop' } },
    async command(input, { onEvent }) { commands.push(input); onEvent({ type: 'terminal_started', data: input }); onEvent({ type: 'terminal_output', data: { text: 'fixture output\n' } }); onEvent({ type: 'terminal_done', data: { status: 'exited', exitCode: 1 } }); return { output: 'fixture output\n', status: 'exited', exitCode: 1, command: input.command } },
    async close() {},
  }) } })
  const browser = f.client()
  await browser.demo()
  const workspaceId = (await browser.json('/builder/open', { body: { confirm: 'open-local-folder', permissionMode: options.permissionMode || 'standard' } })).data.workspaceId
  const scoped = body => ({ ...body, workspaceId })
  return { ...f, directory, browser, workspaceId, scoped, commands, prompts }
}
async function events(response) {
  assert.equal(response.status, 200)
  const result = []
  for await (const frame of parseSse(response.body)) result.push({ type: frame.event, data: JSON.parse(frame.data) })
  return result
}

test('standard editor writes apply immediately with exact preimages; deletion and execution configuration return immutable reviews', async t => {
  const f = await setup(t)
  await writeFile(path.join(f.directory, 'a.ts'), 'before\n')
  const original = (await f.browser.json(`/builder/file?${new URLSearchParams(f.scoped({ path: 'a.ts' }))}`)).data
  const frames = await events(await f.browser.request('/builder/write', { body: f.scoped({ path: 'a.ts', version: original.version, content: 'after\n' }) }))
  assert.deepEqual(frames.map(event => event.type), ['task_started', 'file_applied', 'done'])
  assert.equal(frames.at(-1).data.automatic, true)
  assert.equal(await readFile(path.join(f.directory, 'a.ts'), 'utf8'), 'after\n')
  assert.equal((await f.browser.json('/builder/write', { body: f.scoped({ path: 'a.ts', version: original.version, content: 'stale\n' }) })).data.code, 'file_changed')
  const config = await f.browser.json('/builder/write', { body: f.scoped({ path: 'package.json', version: null, content: '{"scripts":{"postinstall":"run"}}\n' }) })
  assert.equal(config.data.requiresApproval, true)
  assert.equal(config.data.approval.kind, 'file')
  assert.match(config.data.approval.permissionReason, /execution|dependencies/)
  const current = (await f.browser.json(`/builder/file?${new URLSearchParams(f.scoped({ path: 'a.ts' }))}`)).data
  assert.equal((await f.browser.json('/builder/write', { body: f.scoped({ path: 'a.ts', version: current.version, content: null }) })).data.requiresApproval, true)
  assert.equal(await readFile(path.join(f.directory, 'a.ts'), 'utf8'), 'after\n')
  assert.equal((await f.browser.json('/memory')).data.inventory.total, 0)
})

test('standard commands execute hardened inspection only; installs, scripts and compound syntax ask without starting execution', async t => {
  const f = await setup(t)
  const frames = await events(await f.browser.request('/builder/command', { body: f.scoped({ command: 'git status --short' }) }))
  assert.match(f.commands[0].command, /^\/usr\/bin\/git --no-optional-locks --no-pager/)
  assert.equal(f.commands[0].absoluteCwd, f.directory)
  assert.equal(frames.at(-1).data.result.exitCode, 1)
  for (const command of ['npm install', 'npm test', 'pwd && touch bypass']) {
    const result = await f.browser.json('/builder/command', { body: f.scoped({ command }) })
    assert.equal(result.data.requiresApproval, true)
    assert.equal(result.data.approval.command, command)
  }
  assert.equal(f.commands.length, 1)
  await symlink('/etc/passwd', path.join(f.directory, 'linked.txt'))
  const refused = await events(await f.browser.request('/builder/command', { body: f.scoped({ command: 'git diff -- linked.txt' }) }))
  assert.equal(refused.at(-1).data.code, 'unsafe_path')
  assert.equal(f.commands.length, 1)
})

test('Build runs read-edit-command loops automatically for routine actions and streams actual tool outcomes', async t => {
  const f = await setup(t, { prompt: async (_args, { tool }) => {
    const original = await tool('read_file', { path: 'a.ts' })
    const saved = await tool('propose_file', { path: 'a.ts', version: original.version, content: 'after\n', reason: 'Routine fixture change' })
    assert.equal(saved.deleted, false)
    const result = await tool('run_command', { command: 'node --version', cwd: '.', timeoutMs: 1000, reason: 'Inspect runtime' })
    assert.equal(result.exitCode, 1)
    return { answer: 'Saved a.ts. Inspection exited 1, not a passed test.', requests: 3, finishReason: 'stop' }
  } })
  await writeFile(path.join(f.directory, 'a.ts'), 'before\n')
  const frames = await events(await f.browser.request('/builder/prompt', { body: f.scoped({ text: 'Fix this fixture', mode: 'build' }) }))
  assert.equal(frames.some(event => event.type === 'approval'), false)
  assert.equal(frames.filter(event => event.type === 'tool_result').length, 3)
  assert.match(frames.find(event => event.type === 'tool_result' && event.data.name === 'run_command').data.summary, /code 1/)
  assert.equal(await readFile(path.join(f.directory, 'a.ts'), 'utf8'), 'after\n')
  assert.deepEqual(frames.slice(-2).map(event => event.type), ['done', 'stored'])
  assert.equal(frames.at(-1).data.verbatim, 0)
  assert.equal(frames.at(-1).data.facts, 1)
})

test('Plan is parent-enforced read-only and cannot obtain mutation permission through a model tool', async t => {
  const f = await setup(t, { prompt: async (args, { tool }) => {
    assert.equal(args.mode, 'plan')
    await tool('read_file', { path: 'a.ts' })
    await assert.rejects(tool('propose_file', { path: 'a.ts', version: null, content: 'must not write' }), { code: 'plan_read_only' })
    await assert.rejects(tool('run_command', { command: 'npm test', cwd: '.', timeoutMs: 1000, reason: 'must not execute scripts' }), { code: 'plan_read_only' })
    await tool('run_command', { command: 'pwd', cwd: '.', timeoutMs: 1000, reason: 'Inspect cwd' })
    return { answer: 'Read-only plan', requests: 1, finishReason: 'stop' }
  } })
  await writeFile(path.join(f.directory, 'a.ts'), 'before\n')
  const frames = await events(await f.browser.request('/builder/prompt', { body: f.scoped({ text: 'Plan a fix', mode: 'plan' }) }))
  assert.equal(frames.filter(event => event.type === 'tool_result' && event.data.status === 'blocked').length, 2)
  assert.equal(frames.some(event => event.type === 'approval'), false)
  assert.equal(await readFile(path.join(f.directory, 'a.ts'), 'utf8'), 'before\n')
  assert.equal(f.commands.length, 1)
})

test('text-only tasks have no parent tool authority even if a worker requests a registered action', async t => {
  const f = await setup(t, { initialise(session) {
    session.config = { mode: 'mock', model: 'recallloop-mock', models: ['recallloop-mock'], toolsEnabled: false, apiStyle: 'chat', apiKey: '', baseUrl: '' }
  }, prompt: async (args, { tool }) => {
    assert.equal(args.config.toolsEnabled, false)
    for (const [name, input] of [
      ['list_files', {}], ['read_file', { path: 'a.ts' }], ['search_files', { query: 'private' }],
      ['propose_file', { path: 'new.ts', version: null, content: 'must not write' }], ['run_command', { command: 'pwd' }],
    ]) await assert.rejects(tool(name, input), { code: 'tool_denied' })
    return { answer: 'A suggestion from supplied prose only.', requests: 1, finishReason: 'stop' }
  } })
  const frames = await events(await f.browser.request('/builder/prompt', { body: f.scoped({ text: 'Suggest an approach', capture: false }) }))
  assert.equal(frames.some(event => ['tool', 'approval', 'file_applied', 'terminal_started'].includes(event.type)), false)
  assert.equal(frames.at(-2).data.answer, 'A suggestion from supplied prose only.')
  assert.equal(f.commands.length, 0)
  assert.deepEqual((await f.browser.json('/builder/status')).data.approvals, [])
})

test('follow-ups receive bounded page prose and an advertised selected model, but never stored provider or tool state', async t => {
  const f = await setup(t)
  const input = f.scoped({ text: 'Continue the fix', history: [{ role: 'user', content: 'Use a friendly fallback.' }, { role: 'assistant', content: 'The first change is complete.' }], model: 'recallloop-mock', useMemory: false })
  await events(await f.browser.request('/builder/prompt', { body: input }))
  assert.match(f.prompts[0].text, /Prior page conversation/)
  assert.match(f.prompts[0].text, /Use a friendly fallback/)
  assert.match(f.prompts[0].text, /re-read current files/)
  assert.equal(f.prompts[0].config.model, 'recallloop-mock')
  assert.equal((await f.browser.json('/builder/prompt', { body: { ...input, model: 'other-provider/model' } })).status, 400)
  assert.equal((await f.browser.json('/builder/prompt', { body: { ...input, history: [{ role: 'tool', content: 'old secret source' }] } })).status, 400)
  await events(await f.browser.request('/builder/prompt', { body: f.scoped({ text: 'Fresh session', history: [] }) }))
  assert.equal(f.prompts[1].text.includes('Use a friendly fallback'), false)
})

test('task-integrated Walrus recall is opt-in, profile/facts only and independent from the auto-memory setting', async t => {
  let lookups = 0, options
  const f = await setup(t, { initialise(session) {
    session.memory.recall = async input => { lookups++; options = input; return { memories: [{ blobId: 'facts-1', tier: 'facts', text: 'Prefer npm and TypeScript.', distance: 0.2 }, { blobId: 'raw-1', tier: 'raw', text: 'RAW_MUST_NOT_ATTACH', distance: 0.1 }] } }
  } })
  await events(await f.browser.request('/builder/prompt', { body: f.scoped({ text: 'No recall', useMemory: false, capture: false }) }))
  assert.equal(lookups, 0)
  const frames = await events(await f.browser.request('/builder/prompt', { body: f.scoped({ text: 'Use my preferences', useMemory: true, capture: false }) }))
  assert.equal(lookups, 1)
  assert.equal(options.agentId, f.sessions[0].agentId)
  assert.equal(options.includeRaw, false)
  assert.match(f.prompts[1].text, /Prefer npm and TypeScript/)
  assert.equal(f.prompts[1].text.includes('RAW_MUST_NOT_ATTACH'), false)
  assert.equal(frames.find(event => event.type === 'memory').data.memories.length, 1)
  assert.equal(frames.at(-1).data.reason, 'disabled')
  assert.equal((await f.browser.json('/memory')).data.inventory.total, 0)
})

test('strict review remains available and changing permission modes invalidates older action tickets', async t => {
  const f = await setup(t, { permissionMode: 'strict' })
  const result = await f.browser.json('/builder/write', { body: f.scoped({ path: 'new.ts', version: null, content: 'strict\n' }) })
  assert.equal(result.data.requiresApproval, true)
  const ticket = result.data.approval
  const changed = await f.browser.json('/builder/permissions', { body: f.scoped({ permissionMode: 'standard' }) })
  assert.equal(changed.data.permissionMode, 'standard')
  assert.deepEqual(changed.data.approvals, [])
  assert.equal((await f.browser.json('/builder/approvals', { body: f.scoped({ id: ticket.id, digest: ticket.digest, decision: 'approve' }) })).status, 409)
})
