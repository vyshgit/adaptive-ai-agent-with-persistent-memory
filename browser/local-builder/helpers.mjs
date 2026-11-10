import { expect } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { deferred } from '../helpers.mjs'

export const greeting = 'export function greet(name: string) {\n  return `Hello, ${name.trim()}!`\n}\n'

export async function api(page, path, body) {
  return page.evaluate(async ({ path, body }) => {
    const auth = await (await fetch('/api/agent/auth/session')).json()
    const response = await fetch(`/api/agent${path}`, { headers: { 'X-RecallLoop-Session': auth.sessionTag,
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) })
    return { status: response.status, data: await response.json() }
  }, { path, body })
}

export async function localDemo(page, { open = true, permissionMode = 'standard' } = {}) {
  await page.goto('/#/agent')
  await page.getByRole('button', { name: 'Try offline demo', exact: true }).click()
  return localFolder(page, open, permissionMode)
}

// installWallet() supplies a test-only signer; the launcher verifies its real
// issued challenge. This is not extension/Mainnet evidence.
export async function localWallet(page, { open = true, permissionMode = 'standard' } = {}) {
  await page.goto('/#/agent')
  await page.getByRole('button', { name: 'Connect Wallet', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Wallet session details', exact: true })).toBeVisible()
  return localFolder(page, open, permissionMode)
}

async function localFolder(page, open, permissionMode) {
  const builder = page.getByRole('region', { name: 'Local builder workspace', exact: true })
  await expect(builder).toBeVisible()
  const status = (await api(page, '/builder/status')).data
  expect(status.root).toMatch(/^\/tmp\/opencode\/recallloop-browser-project-/)
  if (open) await openFolder(page, permissionMode)
  return { builder, directory: status.root }
}

export async function openFolder(page, permissionMode = 'standard') {
  const builder = page.getByRole('region', { name: 'Local builder workspace', exact: true })
  const open = builder.getByRole('button', { name: 'Open project', exact: true })
  await expect(open).toBeDisabled()
  await builder.getByRole('combobox', { name: 'Project permissions', exact: true }).selectOption(permissionMode)
  await builder.getByRole('checkbox', { name: 'I trust this project and consent to its selected permissions for this login.', exact: true }).check()
  await open.click()
  await expect(builder.getByRole('region', { name: 'Local coding tasks', exact: true })).toBeVisible()
  await expect(builder.getByRole('button', { name: 'New project session', exact: true })).toBeEnabled()
  expect((await api(page, '/builder/status')).data.permissionMode).toBe(permissionMode)
}

export async function view(page, name) {
  const tools = page.getByRole('group', { name: 'Project workspace tools', exact: true })
  if (['Terminal', 'Memory', 'Preview'].includes(name)) {
    const action = tools.getByRole('button', { name: name === 'Memory' ? 'Walrus' : name, exact: true })
    if (await action.getAttribute('aria-pressed') !== 'true') await action.click()
    return
  }
  for (const label of ['Close terminal', 'Close Walrus context', 'Close preview panel']) {
    const close = page.getByRole('button', { name: label, exact: true })
    if (await close.isVisible()) await close.click()
  }
  const closeEditor = page.getByRole('button', { name: 'Close editor', exact: true })
  if (name === 'Coding') {
    if (await closeEditor.isVisible()) await closeEditor.click()
    const hide = page.getByRole('button', { name: 'Hide project explorer', exact: true })
    if (await page.evaluate(() => innerWidth < 1024) && await hide.isVisible()) await hide.click()
    await expect(page.getByRole('textbox', { name: 'Coding task', exact: true })).toBeVisible()
  } else if (name === 'Files') {
    const show = page.getByRole('button', { name: 'Show project explorer', exact: true })
    if (await show.isVisible()) await show.click()
    const editor = tools.getByRole('button', { name: /^(?:Editor|Toggle editor)$/ })
    if (!await closeEditor.isVisible() && await editor.isEnabled()) await editor.click()
  } else throw new Error(`Unknown project panel: ${name}`)
}

export async function newFileDraft(page, relativePath) {
  await view(page, 'Files')
  await page.getByRole('button', { name: 'New file', exact: true }).click()
  await page.getByRole('textbox', { name: 'New relative file path', exact: true }).fill(relativePath)
  await page.getByRole('button', { name: 'New file draft', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Local file editor panel', exact: true })).toContainText(relativePath)
}

export async function projectPermissions(page) {
  const details = page.getByRole('region', { name: 'Local builder workspace', exact: true }).locator('footer details')
  if (await details.getAttribute('open') === null) await details.locator('summary').click()
  return details
}

export async function closeFolder(page) {
  const permissions = await projectPermissions(page)
  await permissions.getByRole('button', { name: 'Close project', exact: true }).click()
}

export async function select(page, name) {
  await view(page, 'Files')
  await page.getByRole('complementary', { name: 'Local project files', exact: true }).getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('region', { name: 'Local file editor panel', exact: true })).toContainText(name)
  return page.getByRole('textbox', { name: 'Local file editor', exact: true })
}

export async function coding(page, text) {
  await view(page, 'Coding')
  const task = page.getByRole('textbox', { name: 'Coding task', exact: true })
  await expect(task).toBeEnabled()
  await task.fill(text)
  await expect(page.getByRole('button', { name: 'Send coding task', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Send coding task', exact: true }).click()
}

export async function reviewCommand(page, command, seconds = 60) {
  await view(page, 'Terminal')
  await page.getByRole('textbox', { name: 'Native command', exact: true }).fill(command)
  const options = page.getByRole('region', { name: 'Local native terminal', exact: true }).locator('details')
  if (await options.getAttribute('open') === null) await options.locator('summary').click()
  await page.getByRole('spinbutton', { name: 'Timeout (seconds)', exact: true }).fill(String(seconds))
  await page.getByRole('button', { name: 'Run command', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Review native command', exact: true })
  await expect(review).toBeVisible()
  await expect(review.getByRole('button', { name: 'Run exact command', exact: true })).toBeDisabled()
  await review.getByRole('checkbox', { name: 'I understand this is native execution with OS and network access, not a sandbox.', exact: true }).check()
  await expect(review.getByRole('button', { name: 'Run exact command', exact: true })).toBeEnabled()
  return review
}

export async function alive(pid) {
  try {
    process.kill(pid, 0)
    return process.platform !== 'linux' || !/\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8'))
  } catch { return false }
}

// Hold a real HTTP result AFTER the server read/execution, without altering it.
// This models delayed transport acknowledgements, not authorization or a mock disk.
export async function holdResponse(page, pattern) {
  const started = deferred(), release = deferred(), finished = deferred()
  await page.route(pattern, async route => {
    const response = await route.fetch()
    started.resolve({ response, request: route.request() })
    await release.promise
    try { await route.fulfill({ response }) } catch { /* a deliberately cancelled page request */ }
    finished.resolve()
  }, { times: 1 })
  return { started, release, finished }
}

export function holdFileResponse(page, relativePath) {
  return holdResponse(page, url => url.pathname === '/api/agent/builder/file' && url.searchParams.get('path') === relativePath)
}

// A scripted loopback endpoint, connected through the real Settings/verification
// API. The SDK and approval/command paths are real; no paid provider is contacted.
export async function loopbackModel(frames) {
  const requests = []
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'test-model' }] })); return
      }
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return }
      let text = ''
      for await (const chunk of req) { text += chunk; if (text.length > 512_000) throw new Error('Oversized fixture request') }
      const body = JSON.parse(text)
      requests.push({ body, headers: req.headers })
      res.writeHead(200, { 'Content-Type': body.stream ? 'text/event-stream' : 'application/json' })
      res.end(body.stream ? frames(body) : JSON.stringify({ id: 'offline-verification', model: 'test-model',
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }))
    } catch { if (!res.headersSent) res.writeHead(500); res.end() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests,
    async close() { const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed } }
}

// UI-state fixture ONLY: simulated SSE approvals never authorize an OS operation,
// invoke a provider, or write memory. Real SDK/approval/disk cases use the launcher above.
export async function approvalStreamFixture(page, workspaceId) {
  let stream
  const ack = deferred(), started = deferred(), decisions = []
  const review = (id, path) => ({ id, workspaceId, digest: id.repeat(64).slice(0, 64), expiresAt: Date.now() + 300_000,
    source: 'agent', kind: 'file', path, before: 'before\n', after: 'reviewed\n', version: 'a'.repeat(64), operation: 'update', reason: 'Synthetic UI race fixture; no disk execution.' })
  const first = review('1', 'first.ts'), second = review('2', 'second.ts')
  const event = (type, data) => stream?.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
  const parent = new URL(page.url()).origin
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', parent)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-RecallLoop-Session')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    let text = ''
    for await (const chunk of req) text += chunk
    if (req.url === '/prompt') {
      stream = res
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
      event('task_started', { taskId: 'ui-only-task', workspaceId, kind: 'coding' })
      event('approval', first)
      started.resolve()
      return
    }
    if (req.url === '/approvals') {
      const body = JSON.parse(text)
      decisions.push(body)
      if (body.id === first.id) { event('approval', second); await ack.promise }
      else { event('done', { answer: 'Simulated UI completion. No files were changed.', requests: 0 }); stream.end() }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, accepted: true, pendingExecution: body.decision === 'approve' }))
      return
    }
    res.writeHead(404); res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  for (const name of ['prompt', 'approvals']) await page.route(`**/api/agent/builder/${name}`, route => route.continue({ url: `${origin}/${name}` }))
  return { first, second, ack, started, decisions,
    async close() { ack.resolve(); stream?.end(); const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed } }
}

// UI-only output timing fixture. It never reaches an SDK/provider, changes a
// file, runs a command or grants permission; real execution cases remain above.
export async function outputStreamFixture(page, workspaceId) {
  let stream
  const started = deferred(), parent = new URL(page.url()).origin
  const event = (type, data) => stream?.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', parent)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-RecallLoop-Session')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    for await (const _chunk of req) { /* consume this synthetic request */ }
    stream = res
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
    event('task_started', { taskId: 'ui-only-output-task', workspaceId, kind: 'coding' })
    started.resolve()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/prompt`
  await page.route('**/api/agent/builder/prompt', route => route.continue({ url }), { times: 1 })
  return { started, event,
    finish(answer) { event('done', { answer, requests: 0 }); stream.end() },
    end() { stream.end() },
    disconnect() { stream.destroy() },
    async close() { stream?.end(); const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed } }
}
