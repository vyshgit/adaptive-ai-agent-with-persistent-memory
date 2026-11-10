import { test, expect } from './harness.mjs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { installWallet, signIn, demo, send, setCapture, newSession, openPanel, openSettings, chooseProviderModel, leaveSession, downloadedText, cachedValues, holdCacheTimers, failOnPageErrors, addProjectFile } from './helpers.mjs'
import { installConnectionFixture, SYNTHETIC_ACCOUNT_ID } from './fixtures.mjs'
import { workspaceHttp, deferred } from '../tests/helpers/workspace-http.mjs'
import { createLlm } from '../server/agent/llm.mjs'
import { within } from '../server/safety.mjs'

test('signed wallet onboarding and credential forms keep secrets out of browser caches and exports', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  const [pair] = await installWallet(page)
  await signIn(page)
  const messages = await page.evaluate(() => window.recallloopSignedMessages)
  expect(messages).toHaveLength(1)
  expect(messages[0]).toContain(`Origin: ${new URL(page.url()).origin}\n`)
  expect(messages[0]).toContain(`Wallet address: ${pair.toSuiAddress()}\n`)
  expect(messages[0]).toContain('This is not a transaction.')

  // Only form-wiring responses are simulated here. HTTP tests exercise the real
  // staged upstream verification. This test does NOT claim live API compatibility.
  const keys = { tatum: 'synthetic-browser-tatum-key', delegate: '1'.repeat(64), model: 'synthetic-browser-model-key' }
  const fixture = await installConnectionFixture(page)
  const settings = await openSettings(page, 'Tatum')
  await settings.getByLabel('Tatum API key', { exact: true }).fill(keys.tatum)
  await settings.getByRole('button', { name: 'Verify & connect Tatum', exact: true }).click()
  await settings.getByRole('button', { name: 'Reconnect Tatum', exact: true }).click()
  await expect(settings.getByLabel('Tatum API key', { exact: true })).toHaveValue('')
  await settings.getByRole('tab', { name: 'Walrus Memory', exact: true }).click()
  await settings.getByRole('textbox', { name: 'Walrus Memory account object ID' }).fill(SYNTHETIC_ACCOUNT_ID)
  await settings.getByLabel('Delegate private key', { exact: true }).fill(keys.delegate)
  await settings.getByRole('button', { name: 'Verify & connect Walrus', exact: true }).click()
  await settings.getByRole('button', { name: 'Reconnect Walrus', exact: true }).click()
  await expect(settings.getByLabel('Delegate private key', { exact: true })).toHaveValue('')
  await settings.getByRole('tab', { name: 'Model', exact: true }).click()
  await settings.getByLabel('Model API key', { exact: true }).fill(keys.model)
  await chooseProviderModel(settings, 'synthetic-model')
  await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
  await settings.getByRole('button', { name: 'Reconnect model', exact: true }).click()
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue('')
  expect(fixture.mutations().map(item => item.body)).toEqual([
    { apiKey: keys.tatum }, { accountId: SYNTHETIC_ACCOUNT_ID, delegateKey: keys.delegate },
    { mode: 'live', profileId: fixture.state.connection.id, profileName: 'AgentRouter', baseUrl: 'https://agentrouter.org/v1', apiKey: keys.model, model: 'synthetic-model', apiStyle: 'responses', toolsEnabled: true, checkCapabilities: false },
  ])
  await settings.getByRole('button', { name: 'Done', exact: true }).click()
  await openPanel(page)
  const editor = await addProjectFile(page)
  await editor.fill(`// Accidentally pasted keys: ${Object.values(keys).join(' ')}\n`)
  await expect(editor).toHaveValue('// Accidentally pasted keys: [REDACTED] [REDACTED] [REDACTED]\n')
  const exported = await downloadedText(page, () => page.getByRole('button', { name: 'Download this project as a zip file' }).click())
  expect(exported.name).toBe('recallloop-project.zip')
  expect(exported.text.startsWith('PK\u0003\u0004')).toBe(true)
  for (const key of Object.values(keys)) {
    expect(exported.text).not.toContain(key)
    expect(JSON.stringify(await cachedValues(page))).not.toContain(key)
  }
  await page.evaluate(() => window.recallloopDisconnectWallet())
  await expect(page.getByRole('region', { name: 'Wallet sign-in' })).toBeVisible()
  const loggedOut = await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  expect(loggedOut.authenticated).toBe(false)
  checkErrors()
})

test('offline recall loop proposes reviewable code, downloads exact changes, and recalls outcomes after clearing chat', async ({ page }, testInfo) => {
  const checkErrors = failOnPageErrors(page)
  await demo(page)
  await page.getByRole('button', { name: 'Talk', exact: true }).click()
  await setCapture(page)
  const taught = await send(page, 'I prefer TypeScript and npm with small reviewable changes.')
  await expect(taught).toContainText('facts confirmed')
  await newSession(page)
  await page.getByRole('button', { name: 'Build', exact: true }).click()
  await openPanel(page)
  const before = await page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true }).inputValue()
  const answer = await send(page, 'Use my TypeScript and npm preferences to fix greet for missing and empty names.')
  await expect(answer).toContainText(/Recalled \d+ mock memor/)
  await expect(answer.getByRole('region', { name: 'Working plan', exact: true })).toContainText('Proposed steps, not completed actions')
  await expect(answer).toContainText('Review required')
  await expect(page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true })).toHaveValue(before)
  await answer.getByRole('button', { name: 'Review 1 change', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('review-proposal-desktop-dark.png') })
  const patch = await downloadedText(page, () => page.getByRole('button', { name: 'Download patch', exact: true }).click())
  expect(patch.name).toBe('recallloop-change.patch')
  expect(patch.text).toContain('name?: string')
  await page.getByRole('button', { name: 'Apply in browser', exact: true }).click()
  await expect(page.getByText('Applied in browser', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Files', exact: true }).click()
  const after = await page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true }).inputValue()
  expect(after).toContain("const displayName = name?.trim() || 'friend'")
  await page.screenshot({ path: testInfo.outputPath('applied-browser-files-desktop-dark.png') })
  const file = await downloadedText(page, () => page.getByRole('button', { name: 'Download current file', exact: true }).click())
  expect(file.text).toBe(after)
  const backup = await downloadedText(page, () => page.getByRole('button', { name: 'Download this project as a zip file' }).click())
  expect(backup.name).toBe('recallloop-sandbox.zip')
  expect(backup.text.startsWith('PK\u0003\u0004')).toBe(true)
  expect(backup.text).toContain(after) // STORE-method archive keeps file content verbatim
  // Applied proposals can leave the queue without reverting the applied edit.
  await page.getByRole('tab', { name: 'Review', exact: true }).click()
  await page.getByRole('button', { name: 'Remove from queue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'No changes to review', exact: true })).toBeVisible()
  await answer.getByRole('button', { name: 'Record outcome', exact: true }).click()
  const feedback = page.getByRole('dialog', { name: 'Teach the next session', exact: true })
  await feedback.getByRole('textbox', { name: 'Your outcome or correction' }).fill('TypeScript lesson: keep npm changes small and add a regression test for missing names.')
  await feedback.getByRole('button', { name: 'Remember this outcome', exact: true }).click()
  await expect(feedback).toBeHidden()
  await page.getByRole('button', { name: 'Clear local history', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Clear local history', exact: true }).click()
  await expect(page.locator('article')).toHaveCount(0)
  await page.getByRole('button', { name: 'Talk', exact: true }).click()
  const recalled = await send(page, 'Which TypeScript npm preferences and regression test lessons do you remember?')
  await expect(recalled).toContainText('keep npm changes small')
  await expect(recalled.getByRole('button', { name: /^Review \d+ change/ })).toHaveCount(0)
  const memory = await openPanel(page, 'memory')
  await memory.getByText('Index & Mainnet evidence tools', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Seed 12 Mainnet memories', exact: true })).toBeDisabled()
  await expect(page.getByText('10+ Mainnet', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('offline-workspace.png') })
  checkErrors()
})

test('browser-only import/export, safe paths, cache reload, and editor keyboard navigation work', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await holdCacheTimers(page)
  await demo(page)
  await openPanel(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import text files', exact: true }).click()
  await (await chooser).setFiles([
    { name: 'hello.ts', mimeType: 'text/plain', buffer: Buffer.from('export const hello = "hello"\n') },
    { name: '.env', mimeType: 'text/plain', buffer: Buffer.from('NEVER_IMPORT=synthetic-secret') },
    { name: 'binary.dat', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 255]) },
  ])
  const confirm = page.getByRole('dialog', { name: 'Replace the browser project?' })
  await expect(confirm).toContainText('Skipped 2')
  await confirm.getByRole('button', { name: 'Import 1 files', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Edit hello.ts', exact: true })).toHaveValue('export const hello = "hello"\n')
  await page.getByRole('button', { name: 'Add a browser file', exact: true }).click()
  await page.getByRole('textbox', { name: 'New relative file path' }).fill('../outside.ts')
  await page.getByRole('button', { name: 'Add file', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('safe relative file path')
  await page.getByRole('textbox', { name: 'New relative file path' }).fill('src/second.ts')
  await page.getByRole('button', { name: 'Add file', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Edit src/second.ts', exact: true })
  await editor.fill('const answer = 42\n')
  await editor.press('Control+s')
  await expect(page.getByText('Edits are cached in this browser.', { exact: false })).toBeVisible()
  await editor.press('Escape')
  await editor.press('Tab')
  await expect(editor).not.toBeFocused()
  const exported = await downloadedText(page, () => page.getByRole('button', { name: 'Download this project as a zip file' }).click())
  expect(exported.name.endsWith('.zip')).toBe(true)
  expect(exported.text.startsWith('PK\u0003\u0004')).toBe(true)
  await page.getByText('Project backups', { exact: true }).click()
  const load = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Load a RecallLoop JSON project' }).click()
  // Older JSON backups still import; the zip is for handoff to a real environment.
  await (await load).setFiles({ name: 'recallloop-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ name: 'RecallLoop sandbox', activeFile: 'src/second.ts', files: [{ path: 'hello.ts', content: 'export const hello = "hello"\n' }, { path: 'src/second.ts', content: 'const answer = 42\n' }] })) })
  await page.getByRole('dialog').getByRole('button', { name: 'Import 2 files', exact: true }).click()
  await page.reload()
  await openPanel(page)
  await expect(page.getByRole('textbox', { name: 'Edit src/second.ts', exact: true })).toHaveValue('const answer = 42\n')
  // Per-file removal drops a file without touching the rest.
  await page.getByRole('button', { name: 'Remove src/second.ts from this project' }).click()
  await expect(page.getByRole('textbox', { name: 'Edit src/second.ts', exact: true })).toHaveCount(0)
  expect(JSON.stringify(await cachedValues(page))).not.toContain('NEVER_IMPORT')
  checkErrors()
})

test('pending project and chat caches flush before reload and when the page becomes hidden', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await holdCacheTimers(page)
  await demo(page)
  await openPanel(page)
  const pendingFile = '// PENDING_RELOAD_EDITOR\n'
  const lesson = 'I prefer TypeScript and npm: PENDING_RELOAD_LESSON.'
  const editor = page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true })
  await editor.fill(pendingFile)
  await page.getByRole('button', { name: 'Talk', exact: true }).click()
  await send(page, lesson)
  const before = JSON.stringify(await cachedValues(page))
  expect(before).not.toContain(pendingFile.trim())
  expect(before).not.toContain(lesson)

  await page.reload()
  await openPanel(page)
  await expect(editor).toHaveValue(pendingFile)
  await expect(page.locator('article')).toHaveCount(2)
  await expect(page.locator('article').first()).toContainText(lesson)
  await expect(page.locator('article').last()).toContainText('Mock model — deterministic')

  const hiddenFile = '// PENDING_VISIBILITY_EDITOR\n'
  await editor.fill(hiddenFile)
  expect(JSON.stringify(await cachedValues(page))).not.toContain(hiddenFile.trim())
  await page.evaluate(() => {
    const previous = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    } finally {
      if (previous) Object.defineProperty(document, 'visibilityState', previous)
      else delete document.visibilityState
    }
  })
  expect(JSON.stringify(await cachedValues(page))).toContain(hiddenFile.trim())
  checkErrors()
})

test('cross-tab wallet notifications clear stale work, reject old requests, and never restore a logged-out project', async ({ page, context }) => {
  const checkErrors = failOnPageErrors(page)
  const a = Ed25519Keypair.generate(), b = Ed25519Keypair.generate()
  await installWallet(page, [a])
  await signIn(page)
  await openPanel(page)
  await addProjectFile(page) // wallet workspaces start blank; seed a file for scope checks
  const editor = page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true })
  await editor.fill('// ONLY_WALLET_A\n')
  await openSettings(page, 'Advanced')
  await page.getByRole('dialog').getByRole('button', { name: 'Use scripted mock model', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click()
  const oldAuth = await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  await expect.poll(async () => JSON.stringify(await cachedValues(page))).toContain('ONLY_WALLET_A')
  await page.getByRole('textbox', { name: 'Message RecallLoop' }).fill('ONLY_WALLET_A stale draft must not become B history')
  // BroadcastChannel, not the next focus or a rejected Send, must clear A's tab.
  await page.evaluate(() => window.addEventListener('focus', event => event.stopImmediatePropagation(), true))
  const other = await context.newPage()
  await installWallet(other, [b])
  await other.goto('/#/agent')
  await leaveSession(other)
  await signIn(other)
  const stale = await page.evaluate(async tag => {
    const response = await fetch('/api/agent/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RecallLoop-Session': tag }, body: '{}' })
    return { status: response.status, data: await response.json() }
  }, oldAuth.sessionTag)
  expect(stale.status).toBe(409)
  expect(stale.data.code).toBe('session_changed')
  await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue('')
  await openPanel(page)
  await expect(page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true })).toHaveCount(0)
  await expect(page.getByText('Import a folder or add a file to start coding.', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message RecallLoop' })).toHaveValue('')
  await expect(page.locator('article')).toHaveCount(0)
  expect(JSON.stringify(await cachedValues(page))).not.toContain('ONLY_WALLET_A')
  const bAuth = await other.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  expect(bAuth.address).toBe(b.toSuiAddress())
  // A's old Wallet Standard connection must not bind to B's new session.
  await page.evaluate(() => { window.recallloopDisconnectWallet(); window.recallloopFireRetiredWalletChange() })
  const afterDisconnect = await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  expect(afterDisconnect.sessionTag).toBe(bAuth.sessionTag)
  expect(afterDisconnect.address).toBe(b.toSuiAddress())
  await expect(page.getByRole('button', { name: 'Wallet session details', exact: true })).toBeVisible()
  await leaveSession(page)
  await signIn(page)
  await openPanel(page)
  // Re-signing the same wallet after a clean logout starts a blank workspace,
  // not the logged-out workspace's files.
  await expect(page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true })).toHaveCount(0)
  await expect(page.getByText('Import a folder or add a file to start coding.', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: 'Message RecallLoop' })).toHaveValue('')
  checkErrors()
})

test('mobile panels, themes and keyboard-accessible settings stay within the viewport', async ({ page }, testInfo) => {
  const checkErrors = failOnPageErrors(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await demo(page)
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    expect(overflow).toBe(false)
    const composer = await page.getByRole('textbox', { name: 'Message RecallLoop' }).boundingBox()
    expect(composer.y + composer.height).toBeLessThanOrEqual(844)
    await page.getByRole('combobox', { name: 'Workspace view' }).selectOption('project')
    await expect(page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Workspace view' }).selectOption('memory')
    await expect(page.getByRole('heading', { name: 'Portable memory', exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Workspace view' }).selectOption('chat')
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Workspace settings', exact: true })
  await expect(settings).toBeVisible()
  const footer = await settings.getByRole('button', { name: 'Done', exact: true }).boundingBox()
  expect(footer.y + footer.height).toBeLessThanOrEqual(844)
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(page.getByRole('button', { name: 'Workspace settings', exact: true })).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('mobile-dark-workspace.png') })
  checkErrors()
})

test('stopping a streamed turn preserves a partial answer without capture and retry avoids duplicate user messages', async ({ page, baseURL }) => {
  const checkErrors = failOnPageErrors(page)
  const cleanup = [], aborted = deferred(), held = deferred()
  const llm = createLlm({ mockDelayMs: 0 })
  let first = true, captures = 0
  // Use the real API/auth/memory stack with an injected mock-generator gate.
  // Completion cannot race ahead of the browser's Stop action. No API response
  // is fabricated, and retry runs the normal generator through actual capture.
  const fixture = await workspaceHttp({ after: callback => cleanup.push(callback) }, {
    llm: { ...llm, async *streamCompletion(input) {
      const pause = first
      first = false
      let text = ''
      for await (const event of llm.streamCompletion(input)) {
        yield event
        if (event.type === 'delta') text += event.text
        if (pause && text.includes('Mock model — deterministic')) {
          try { await within(held.promise, 60_000, null, input.signal) }
          finally { aborted.resolve(input.signal.aborted) }
        }
      }
    } },
    initialise(session) {
      const ingest = session.memory.ingest
      session.memory.ingest = (...args) => { captures++; return ingest(...args) }
    },
  })
  try {
    // Serve the current Vite entry against this test-only API origin; assets/HMR
    // remain on Vite. The browser and API retain same-origin session checks.
    const response = await fetch(baseURL)
    expect(response.ok).toBe(true)
    const html = (await response.text()).replaceAll('"/', `"${baseURL}/`)
    fixture.app.get('/', (_req, res) => res.type('html').send(html))
    await page.goto(`${fixture.origin}/#/agent`)
    await page.getByRole('button', { name: 'Try offline demo', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue('recallloop-mock')
    await page.getByRole('button', { name: 'Talk', exact: true }).click()
    await setCapture(page, { raw: true })
    await page.getByRole('textbox', { name: 'Message RecallLoop' }).fill('Tell me my preferences')
    await page.getByRole('textbox', { name: 'Message RecallLoop' }).press('Enter')
    await expect(page.locator('article').last()).toContainText('Mock model — deterministic')
    await page.getByRole('button', { name: 'Stop', exact: true }).press('Enter')
    await expect(page.getByText('Stopped · partial answer', { exact: true })).toBeVisible()
    expect(await aborted.promise).toBe(true)
    await expect.poll(() => fixture.sessions[0].active).toBe(0)
    expect(captures).toBe(0)
    await openPanel(page, 'memory')
    await expect(page.getByRole('region', { name: 'Memory inventory' })).toContainText(/0\s*listed memories/)
    await page.getByRole('button', { name: 'Retry this turn', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden()
    await expect(page.locator('article').last().getByRole('button', { name: 'Record outcome', exact: true })).toBeVisible()
    await expect(page.locator('article')).toHaveCount(3)
    await expect(page.locator('article').last()).toContainText('transcript records')
    expect(captures).toBeGreaterThan(0)
    checkErrors()
  } finally { for (const close of cleanup.reverse()) await close() }
})
