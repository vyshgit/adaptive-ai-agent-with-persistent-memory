import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises'
import { listLocalFolders } from '../server/builder/folders.mjs'
import { builderRoot } from '../server/builder/policy.mjs'
import { createStaticPreview } from '../server/builder/preview.mjs'
import { parseSse } from '../server/agent/sse.mjs'
import { within } from '../server/safety.mjs'
import { temporaryProject } from './helpers/builder-fixture.mjs'
import { workspaceHttp, deferred } from './helpers/workspace-http.mjs'

const selection = (directory, workspaceId = null) => ({ confirm: 'open-local-folder', directory, workspaceId, permissionMode: 'standard' })
const readUrl = (workspaceId, file) => `/builder/file?${new URLSearchParams({ workspaceId, path: file })}`
async function events(response) {
  assert.equal(response.status, 200)
  const frames = []
  for await (const frame of parseSse(response.body)) frames.push({ type: frame.event, data: JSON.parse(frame.data) })
  return frames
}

test('folder browsing exposes bounded directory names, canonicalizes explicit paths and refuses private roots', async t => {
  const root = await temporaryProject(t)
  for (const name of ['Project with spaces', 'Projet été', 'empty', '.ssh', '.git', 'node_modules', '.opencode']) await mkdir(path.join(root, name))
  await writeFile(path.join(root, 'private-source.ts'), 'SOURCE_NOT_FOR_FOLDER_LISTING')
  await writeFile(path.join(root, '.env'), 'NOT_A_DIRECTORY')
  await symlink(path.join(root, 'Project with spaces'), path.join(root, 'project-link'))
  await symlink(path.join(root, '.ssh'), path.join(root, 'private-link'))
  const listed = await listLocalFolders(root)
  assert.deepEqual(listed.entries.map(entry => entry.name).sort(), ['Project with spaces', 'Projet été', 'empty'].sort())
  assert.ok(listed.entries.every(entry => entry.path === path.join(root, entry.name)))
  assert.equal(listed.selectable, true)
  assert.equal(JSON.stringify(listed).includes('SOURCE_NOT_FOR_FOLDER_LISTING'), false)
  assert.equal((await listLocalFolders(root, { limit: 1 })).truncated, true)
  assert.equal((await listLocalFolders(root, { limit: 1 })).entries.length, 1)
  assert.equal((await listLocalFolders(path.join(root, 'project-link'))).path, path.join(root, 'Project with spaces'))
  assert.equal(await builderRoot(path.join(root, 'project-link')), path.join(root, 'Project with spaces'))
  for (const name of ['.ssh', '.git', 'node_modules', '.opencode', 'private-link']) {
    await assert.rejects(listLocalFolders(path.join(root, name)), { code: 'local_only' })
    await assert.rejects(builderRoot(path.join(root, name)), { code: 'local_only' })
  }
  for (const value of [null, 1, '../project', '/data/project', `${root}\n/private`, path.join(root, 'private-source.ts'), path.join(root, 'missing')]) {
    await assert.rejects(listLocalFolders(value))
  }
  const parent = await listLocalFolders('/tmp/opencode', { limit: 1 })
  assert.equal(parent.selectable, false)
  assert.match(parent.issue, /specific local project/)
  await assert.rejects(listLocalFolders(root, { signal: AbortSignal.abort() }), { name: 'AbortError' })
})

test('folder routes require a local authenticated binding and scope changes require consent plus the observed workspace', async t => {
  const directory = await temporaryProject(t)
  const hosted = await workspaceHttp(t), remote = hosted.client()
  await remote.demo()
  assert.equal((await remote.json('/builder/folders', { body: { directory } })).status, 403)
  const f = await workspaceHttp(t, { builder: { directory } }), browser = f.client()
  assert.equal((await browser.json('/builder/folders', { body: { directory } })).status, 401)
  await browser.login()
  assert.equal((await f.client({ cookie: browser.cookie }).json('/builder/folders', { body: { directory } })).status, 409)
  assert.equal((await browser.json('/builder/folders', { body: { directory }, headers: { Origin: 'https://foreign.example' } })).status, 403)
  assert.equal((await browser.json('/builder/folders', { body: { directory, agentId: 'other' } })).status, 400)
  const browse = await browser.json('/builder/folders', { body: {} })
  assert.equal(browse.status, 200)
  assert.equal(browse.headers.get('cache-control'), 'no-store')
  assert.equal(browse.data.path, directory)
  assert.equal(browse.data.launch, directory)
  assert.equal((await browser.json('/builder/status')).data.opened, false)
  assert.equal((await browser.json('/builder/open', { body: { directory, workspaceId: null } })).status, 412)
  assert.equal((await browser.json('/builder/open', { body: { confirm: 'open-local-folder', directory } })).status, 409)
  const opened = await browser.json('/builder/open', { body: selection(directory) })
  assert.equal(opened.status, 200)
  assert.equal(opened.data.launchRoot, directory)
  assert.equal((await browser.json('/status')).data.llm.mode, 'unconfigured')
  assert.equal((await browser.json('/builder/open', { body: selection(directory) })).status, 409)
  assert.equal((await browser.json('/builder/open', { body: selection(directory, 'other-workspace') })).status, 409)
  const cancelled = AbortSignal.abort()
  await assert.rejects(f.builder.open(f.sessions[0], selection(directory, opened.data.workspaceId), cancelled), { name: 'AbortError' })
  assert.equal((await browser.json('/builder/status')).data.workspaceId, opened.data.workspaceId)
})

test('switching roots is atomic and login-scoped, revokes old capabilities and routes tools, commands and capture to the new project', async t => {
  const directory = await temporaryProject(t), otherRoot = await temporaryProject(t)
  await writeFile(path.join(directory, 'shared.ts'), 'FIRST_PROJECT_SOURCE')
  await writeFile(path.join(otherRoot, 'shared.ts'), 'SECOND_PROJECT_SOURCE')
  await mkdir(path.join(directory, 'dist'))
  await writeFile(path.join(directory, 'dist', 'index.html'), '<h1>Old project snapshot</h1>')
  const preview = await createStaticPreview()
  t.after(() => preview.close())
  const engines = [], commands = [], captured = []
  let oldTool
  const f = await workspaceHttp(t, { initialise(session) {
    const ingest = session.memory.ingest
    session.memory.ingest = (input, options) => { captured.push(input); return ingest(input, options) }
  }, builder: { directory, preview, engineFactory: async ({ directory: root }) => {
    engines.push(root)
    return {
      async prompt(_input, { tool }) {
        oldTool = tool
        assert.equal((await tool('read_file', { path: 'shared.ts' })).content, 'SECOND_PROJECT_SOURCE')
        await assert.rejects(tool('list_files', { path: '.', directory }), { code: 'invalid_request' })
        await assert.rejects(tool('select_workspace', { directory }), { code: 'tool_denied' })
        await tool('propose_file', { path: 'created.ts', content: 'Only in the selected project', version: null })
        await tool('run_command', { command: 'pwd' })
        return { answer: 'Second project task complete.', finishReason: 'stop', requests: 1 }
      },
      async command(input) { commands.push(input); return { status: 'exited', exitCode: 0, output: `${input.absoluteCwd}\n` } },
      async close() {},
    }
  } } })
  const browser = f.client(), other = f.client()
  await browser.demo(); await other.demo()
  const config = f.sessions[0].config, memory = f.sessions[0].memory
  const first = (await browser.json('/builder/open', { body: selection(directory) })).data
  const theirId = (await other.json('/builder/open', { body: { confirm: 'open-local-folder' } })).data.workspaceId
  const review = (await browser.json('/builder/reviews/file', { body: { workspaceId: first.workspaceId, path: 'must-not-write.ts', content: 'old review', version: null } })).data.approval
  const snapshot = (await browser.json('/builder/preview', { body: { workspaceId: first.workspaceId, path: 'dist' } })).data
  const oldWorkspace = f.sessions[0].builder
  for (const invalid of ['/', '/data', 'relative', path.join(otherRoot, 'missing'), path.join(otherRoot, 'shared.ts')]) {
    const failed = await browser.json('/builder/open', { body: selection(invalid, first.workspaceId) })
    assert.ok([400, 403].includes(failed.status))
    assert.equal((await browser.json('/builder/status')).data.workspaceId, first.workspaceId)
    assert.equal((await browser.json('/builder/status')).data.approvals[0].id, review.id)
    assert.equal((await fetch(snapshot.url)).status, 200)
  }
  const second = (await browser.json('/builder/open', { body: selection(otherRoot, first.workspaceId) })).data
  assert.equal(second.root, otherRoot)
  assert.equal(second.launchRoot, directory)
  assert.notEqual(second.workspaceId, first.workspaceId)
  assert.equal(second.permissionMode, 'standard')
  assert.deepEqual(second.approvals, [])
  assert.equal(oldWorkspace.closed, true)
  assert.equal(oldWorkspace.controller.signal.aborted, true)
  assert.equal((await fetch(snapshot.url)).status, 404)
  assert.equal(f.sessions[0].config, config)
  assert.equal(f.sessions[0].memory, memory)
  assert.equal(engines.length, 0)
  assert.equal((await browser.json('/builder/open', { body: selection(directory, first.workspaceId) })).status, 409)
  assert.equal((await browser.json(readUrl(first.workspaceId, 'shared.ts'))).status, 409)
  assert.equal((await browser.json('/builder/approvals', { body: { workspaceId: first.workspaceId, id: review.id, digest: review.digest, decision: 'approve' } })).status, 409)
  assert.equal((await other.json('/builder/status')).data.root, directory)
  assert.equal((await other.json(readUrl(theirId, 'shared.ts'))).data.content, 'FIRST_PROJECT_SOURCE')
  assert.equal((await browser.json(readUrl(second.workspaceId, 'shared.ts'))).data.content, 'SECOND_PROJECT_SOURCE')
  const frames = await events(await browser.request('/builder/prompt', { body: { workspaceId: second.workspaceId, text: 'I prefer small reviewed changes.' } }))
  assert.deepEqual(frames.slice(-2).map(event => event.type), ['done', 'stored'])
  assert.deepEqual(engines, [otherRoot])
  assert.equal(commands[0].absoluteCwd, otherRoot)
  assert.equal(await readFile(path.join(otherRoot, 'created.ts'), 'utf8'), 'Only in the selected project')
  await assert.rejects(readFile(path.join(directory, 'created.ts')), { code: 'ENOENT' })
  assert.equal(captured.length, 1)
  assert.deepEqual(captured[0].messages, [{ role: 'user', content: `Project: ${path.basename(otherRoot)}\nI prefer small reviewed changes.` }])
  assert.equal(JSON.stringify(captured).includes(otherRoot), false)
  const back = (await browser.json('/builder/open', { body: selection(directory, second.workspaceId) })).data
  await assert.rejects(oldTool('read_file', { path: 'shared.ts' }), { code: 'workspace_changed' })
  assert.equal(back.root, directory)
})

test('a running task prevents a folder switch and the selected folder survives close/reopen only within that login', async t => {
  const directory = await temporaryProject(t), next = await temporaryProject(t), started = deferred()
  const f = await workspaceHttp(t, { builder: { directory, engineFactory: async () => ({
    async prompt(_input, { signal }) { started.resolve(); await within(new Promise(() => {}), 30_000, null, signal) },
    async close() {},
  }) } }), browser = f.client()
  await browser.demo()
  const opened = (await browser.json('/builder/open', { body: selection(directory) })).data
  const task = events(await browser.request('/builder/prompt', { body: { workspaceId: opened.workspaceId, text: 'Keep this task active.' } }))
  await started.promise
  assert.equal((await browser.json('/builder/open', { body: selection(next, opened.workspaceId) })).status, 429)
  assert.equal((await browser.json('/builder/folders', { body: { directory: next } })).status, 429)
  const status = (await browser.json('/builder/status')).data
  assert.equal(status.root, directory)
  await browser.json('/builder/stop', { body: { workspaceId: opened.workspaceId, taskId: status.task.id } })
  assert.equal((await task).some(event => event.type === 'done'), false)
  const changed = (await browser.json('/builder/open', { body: selection(next, opened.workspaceId) })).data
  assert.equal(changed.root, next)
  const closed = (await browser.json('/builder/close', { body: { workspaceId: changed.workspaceId } })).data
  assert.equal(closed.root, next)
  assert.equal(closed.opened, false)
  const reopened = (await browser.json('/builder/open', { body: { confirm: 'open-local-folder' } })).data
  assert.equal(reopened.root, next)
  assert.notEqual(reopened.workspaceId, changed.workspaceId)
  await browser.json('/auth/logout', { body: {} }); await browser.demo()
  assert.equal((await browser.json('/builder/status')).data.root, directory)
  assert.equal((await browser.json('/builder/status')).data.opened, false)
})

test('switching at the workspace limit replaces one scope without admitting an extra login', async t => {
  const directory = await temporaryProject(t), next = await temporaryProject(t)
  const f = await workspaceHttp(t, { builder: { directory } }), clients = []
  for (let i = 0; i < 5; i++) { const browser = f.client(); await browser.demo(); clients.push(browser) }
  for (const browser of clients.slice(0, 4)) assert.equal((await browser.json('/builder/open', { body: selection(directory) })).status, 200)
  assert.equal((await clients[4].json('/builder/open', { body: selection(next) })).status, 429)
  const current = (await clients[0].json('/builder/status')).data.workspaceId
  assert.equal((await clients[0].json('/builder/open', { body: selection(next, current) })).status, 200)
  assert.equal((await clients[4].json('/builder/open', { body: selection(next) })).status, 429)
})
