import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { workspaceHttp } from './helpers/workspace-http.mjs'
import { temporaryProject, offlineModel, chatFrames } from './helpers/builder-fixture.mjs'
import { createOpencodeEngine } from '../server/builder/opencode-engine.mjs'
import { parseSse } from '../server/agent/sse.mjs'

// A synthetic loopback model, but the SDK, parent policy, filesystem and shell
// are real. These tests do not claim compatibility with any live provider.
async function setup(t, handler) {
  const directory = await temporaryProject(t), engines = []
  const model = await offlineModel(t, handler)
  const f = await workspaceHttp(t, {
    initialise(session) {
      session.config = { mode: 'live', baseUrl: model.baseUrl, apiKey: 'synthetic-sdk-workflow-key', apiStyle: 'chat',
        model: 'test-model', models: ['test-model'], toolsEnabled: true, source: 'test-only-session' }
    },
    builder: { directory, engineFactory: async args => {
      const engine = await createOpencodeEngine(args)
      engines.push(engine)
      return engine
    } },
  })
  const browser = f.client()
  assert.equal((await browser.login()).status, 200)
  const workspaceId = (await browser.json('/builder/open', { body: { confirm: 'open-local-folder', permissionMode: 'standard' } })).data.workspaceId
  return { ...f, browser, directory, engines, model, scoped: body => ({ ...body, workspaceId }) }
}
async function events(response) {
  assert.equal(response.status, 200)
  const result = []
  for await (const frame of parseSse(response.body)) result.push({ type: frame.event, data: JSON.parse(frame.data) })
  return result
}
const stream = (response, data) => { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(chatFrames(data)) }

test('actual SDK standard Build edits the launch folder, inspects the real runtime, and replays only page prose on follow-up tasks', { timeout: 120_000 }, async t => {
  let phase = 'build'
  const f = await setup(t, (request, response) => {
    assert.equal(request.path, '/v1/chat/completions')
    assert.equal(request.headers.authorization, 'Bearer synthetic-sdk-workflow-key')
    assert.equal(request.body.store, false)
    const toolMessages = request.body.messages.filter(message => message.role === 'tool')
    const step = toolMessages.length
    const serialized = JSON.stringify(request.body)
    if (phase === 'build') {
      if (step === 0) return stream(response, { call: { name: 'read_file', input: { path: 'a.ts' } } })
      if (step === 1) {
        const file = JSON.parse(toolMessages[0].content)
        assert.match(file.content, /PRIVATE_OLD_FILE_SNAPSHOT/)
        return stream(response, { call: { name: 'propose_file', input: { path: 'a.ts', version: file.version, content: 'export const value = 2\n', reason: 'Focused routine source edit.' } } })
      }
      if (step === 2) return stream(response, { call: { name: 'run_command', input: { command: 'node --version', cwd: '.', timeoutMs: 10_000, reason: 'Inspect the installed runtime.' } } })
      const result = JSON.parse(toolMessages.at(-1).content)
      assert.equal(result.exitCode, 0)
      assert.match(result.output, /^v\d+\.\d+\.\d+/)
      return stream(response, { text: 'FIRST_VISIBLE_SUMMARY: saved a.ts and inspected Node. No project tests ran.' })
    }
    if (phase === 'follow-up') {
      if (!step) {
        assert.match(serialized, /FIRST_USER_TASK/)
        assert.match(serialized, /FIRST_VISIBLE_SUMMARY/)
        assert.match(serialized, /re-read current files/)
        assert.equal(serialized.includes('PRIVATE_OLD_FILE_SNAPSHOT'), false)
        return stream(response, { call: { name: 'read_file', input: { path: 'a.ts' } } })
      }
      assert.match(serialized, /CURRENT_USER_DISK_EDIT/)
      return stream(response, { text: 'The current disk edit is value 3; I did not reuse the earlier file snapshot.' })
    }
    assert.equal(step, 0)
    assert.equal(serialized.includes('FIRST_USER_TASK'), false)
    assert.equal(serialized.includes('FIRST_VISIBLE_SUMMARY'), false)
    assert.equal(serialized.includes('CURRENT_USER_DISK_EDIT'), false)
    return stream(response, { text: 'Fresh task, no previous conversation or file result.' })
  })
  await writeFile(path.join(f.directory, 'a.ts'), 'export const value = 1 // PRIVATE_OLD_FILE_SNAPSHOT\n')
  const first = await events(await f.browser.request('/builder/prompt', { body: f.scoped({ text: 'FIRST_USER_TASK: make the focused edit and inspect Node.', mode: 'build' }) }))
  assert.equal(first.some(event => event.type === 'approval'), false)
  assert.equal(first.filter(event => event.type === 'file_applied').length, 1)
  assert.equal(await readFile(path.join(f.directory, 'a.ts'), 'utf8'), 'export const value = 2\n')
  assert.equal(first.filter(event => event.type === 'tool_result').length, 3)
  assert.match(first.find(event => event.type === 'tool_result' && event.data.name === 'run_command').data.output, /^v\d+/)
  assert.deepEqual(first.slice(-2).map(event => event.type), ['done', 'stored'])
  assert.equal(first.at(-2).data.requests, 4)
  assert.equal(first.at(-1).data.code, 'capture_unavailable')

  phase = 'follow-up'
  await writeFile(path.join(f.directory, 'a.ts'), 'export const value = 3 // CURRENT_USER_DISK_EDIT\n')
  const second = await events(await f.browser.request('/builder/prompt', { body: f.scoped({ text: 'What is on disk now?', mode: 'build', history: [
    { role: 'user', content: 'FIRST_USER_TASK: make the focused edit and inspect Node.' }, { role: 'assistant', content: first.at(-2).data.answer },
  ] }) }))
  assert.equal(second.at(-2).data.requests, 2)
  assert.match(second.at(-2).data.answer, /current disk edit/)
  phase = 'fresh'
  const fresh = await events(await f.browser.request('/builder/prompt', { body: f.scoped({ text: 'Fresh independent task.', history: [] }) }))
  assert.equal(fresh.at(-2).data.requests, 1)
  assert.equal(f.model.requests.length, 7)
  assert.equal((await f.browser.json('/memory')).data.inventory.total, 0)
  assert.equal(f.engines.length, 3)
  for (const engine of f.engines) {
    assert.equal(engine.closed, true)
    await assert.rejects(stat(engine.runtimeDirectory), { code: 'ENOENT' })
  }
})

test('actual SDK Plan omits file mutations and the parent refuses project-script execution without offering approval', { timeout: 60_000 }, async t => {
  const f = await setup(t, (request, response) => {
    assert.ok(request.body.tools.every(tool => tool.function.name !== 'propose_file'))
    assert.match(JSON.stringify(request.body.messages), /read-only PLAN mode/)
    const step = request.body.messages.filter(message => message.role === 'tool').length
    if (step === 0) return stream(response, { call: { name: 'read_file', input: { path: 'a.ts' } } })
    if (step === 1) return stream(response, { call: { name: 'run_command', input: { command: 'npm test', cwd: '.', timeoutMs: 10_000, reason: 'A deliberately inadmissible Plan command.' } } })
    if (step === 2) {
      assert.match(JSON.stringify(request.body.messages), /Plan mode allows only bounded inspection commands/)
      return stream(response, { call: { name: 'run_command', input: { command: 'pwd', cwd: '.', timeoutMs: 10_000, reason: 'Inspect the launch folder.' } } })
    }
    assert.match(JSON.stringify(request.body.messages), /recallloop-builder-test-/)
    return stream(response, { text: 'Read-only plan. npm test was blocked; pwd inspected the launch folder. No edits or project tests ran.' })
  })
  await writeFile(path.join(f.directory, 'a.ts'), 'export const untouched = true\n')
  const frames = await events(await f.browser.request('/builder/prompt', { body: f.scoped({ text: 'Inspect and plan, without making changes.', mode: 'plan' }) }))
  assert.equal(frames.some(event => event.type === 'approval' || event.type === 'file_applied'), false)
  assert.equal(frames.filter(event => event.type === 'terminal_started').length, 1)
  assert.equal(frames.find(event => event.type === 'terminal_started').data.command, 'pwd')
  assert.equal(frames.find(event => event.type === 'tool_result' && event.data.status === 'blocked').data.code, 'plan_read_only')
  assert.equal(await readFile(path.join(f.directory, 'a.ts'), 'utf8'), 'export const untouched = true\n')
  assert.equal(frames.at(-2).data.requests, 4)
  assert.match(frames.at(-2).data.answer, /No edits or project tests ran/)
})
