import { test, expect } from '@playwright/test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { installWallet, signIn, demo, send, newSession, downloadedText, cachedValues, failOnPageErrors } from './helpers.mjs'

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
  const captured = []
  const keys = { tatum: 'synthetic-browser-tatum-key', delegate: '1'.repeat(64), model: 'synthetic-browser-model-key' }
  let tatum = false, memory = false, model = false
  await page.route('**/api/agent/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (['/api/agent/connections/tatum', '/api/agent/connections/memwal', '/api/agent/connect'].includes(path)) {
      captured.push({ path, body: route.request().postDataJSON() })
      if (path.endsWith('/tatum')) tatum = true
      if (path.endsWith('/memwal')) memory = true
      if (path.endsWith('/connect')) model = true
      return route.fulfill({ json: { success: true, connection: { mode: 'live', verified: true } } })
    }
    if (path === '/api/agent/status') {
      const response = await route.fetch()
      const data = await response.json()
      if (tatum) data.tatum = { configured: true, verified: true, checkpoint: { checkpoint: '123' } }
      if (memory) data.memoryConnection = { accountId: '0xa', publicKey: '2'.repeat(64), owner: pair.toSuiAddress(), verified: true }
      if (model) data.llm = { mode: 'live', baseUrl: 'https://agentrouter.org/v1', apiStyle: 'responses', model: 'synthetic-model',
        models: [{ id: 'synthetic-model', label: 'synthetic-model' }], verified: true, toolsEnabled: true }
      return route.fulfill({ response, json: data })
    }
    return route.continue()
  })
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Workspace settings', exact: true })
  await settings.getByLabel('Tatum API key', { exact: true }).fill(keys.tatum)
  await settings.getByRole('button', { name: 'Verify & connect Tatum', exact: true }).click()
  await expect(settings.getByLabel('Tatum API key', { exact: true })).toHaveValue('')
  await settings.getByRole('textbox', { name: 'Walrus Memory account object ID' }).fill('0xa')
  await settings.getByLabel('Delegate private key', { exact: true }).fill(keys.delegate)
  await settings.getByRole('button', { name: 'Verify & connect Walrus', exact: true }).click()
  await expect(settings.getByLabel('Delegate private key', { exact: true })).toHaveValue('')
  await settings.getByLabel('Model API key', { exact: true }).fill(keys.model)
  await settings.getByRole('textbox', { name: 'Model ID', exact: true }).fill('synthetic-model')
  await settings.getByRole('button', { name: 'Connect model API', exact: true }).click()
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue('')
  expect(captured.map(item => item.body)).toEqual([
    { apiKey: keys.tatum }, { accountId: '0xa', delegateKey: keys.delegate },
    { mode: 'live', baseUrl: 'https://agentrouter.org/v1', apiKey: keys.model, model: 'synthetic-model', apiStyle: 'responses', toolsEnabled: true },
  ])
  await settings.getByRole('button', { name: 'Done', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true })
  await editor.fill(`// Accidentally pasted keys: ${Object.values(keys).join(' ')}\n`)
  await expect(editor).toHaveValue('// Accidentally pasted keys: [REDACTED] [REDACTED] [REDACTED]\n')
  const exported = await downloadedText(page, () => page.getByRole('button', { name: 'Export browser project as JSON' }).click())
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
  const taught = await send(page, 'I prefer TypeScript and npm with small reviewable changes.')
  await expect(taught).toContainText('facts confirmed')
  await newSession(page)
  await page.getByRole('button', { name: 'Build', exact: true }).click()
  const before = await page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true }).inputValue()
  const answer = await send(page, 'Use my TypeScript and npm preferences to fix greet for missing and empty names.')
  await expect(answer).toContainText(/Recalled \d+ mock memor/)
  await expect(page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true })).toHaveValue(before)
  await answer.getByRole('button', { name: 'Review 1 change', exact: true }).click()
  const patch = await downloadedText(page, () => page.getByRole('button', { name: 'Download patch', exact: true }).click())
  expect(patch.name).toBe('recallloop-change.patch')
  expect(patch.text).toContain('name?: string')
  await page.getByRole('button', { name: 'Apply in browser', exact: true }).click()
  await expect(page.getByText('Applied in browser', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Files', exact: true }).click()
  const after = await page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true }).inputValue()
  expect(after).toContain("const displayName = name?.trim() || 'friend'")
  const file = await downloadedText(page, () => page.getByRole('button', { name: 'Download current file', exact: true }).click())
  expect(file.text).toBe(after)
  const backup = await downloadedText(page, () => page.getByRole('button', { name: 'Export browser project as JSON' }).click())
  expect(JSON.parse(backup.text).files.find(file => file.path === 'src/greet.ts').content).toBe(after)
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
  await page.getByRole('tab', { name: 'Memory', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Seed 12 Mainnet memories', exact: true })).toBeDisabled()
  await expect(page.getByText('10+ Mainnet', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('offline-workspace.png') })
  checkErrors()
})

test('browser-only import/export, safe paths, cache reload, and editor keyboard navigation work', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await demo(page)
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
  const exported = await downloadedText(page, () => page.getByRole('button', { name: 'Export browser project as JSON' }).click())
  const load = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Load a RecallLoop JSON project' }).click()
  await (await load).setFiles({ name: 'recallloop-project.json', mimeType: 'application/json', buffer: Buffer.from(exported.text) })
  await page.getByRole('dialog').getByRole('button', { name: 'Import 2 files', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Edit src/second.ts', exact: true })).toHaveValue('const answer = 42\n')
  expect(JSON.stringify(await cachedValues(page))).not.toContain('NEVER_IMPORT')
  checkErrors()
})

test('cross-tab wallet changes reject stale requests and reload the correct isolated project', async ({ page, context }) => {
  const checkErrors = failOnPageErrors(page)
  const a = Ed25519Keypair.generate(), b = Ed25519Keypair.generate()
  await installWallet(page, [a])
  await signIn(page)
  await page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true }).fill('// ONLY_WALLET_A\n')
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Use scripted mock model', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click()
  const oldAuth = await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  await expect.poll(async () => JSON.stringify(await cachedValues(page))).toContain('ONLY_WALLET_A')
  await page.getByRole('textbox', { name: 'Message the coding agent' }).fill('ONLY_WALLET_A stale draft must not become B history')
  // Model a background tab that has not received its next focus event yet.
  await page.evaluate(() => window.addEventListener('focus', event => event.stopImmediatePropagation(), true))
  const other = await context.newPage()
  await installWallet(other, [b])
  await other.goto('/#/agent')
  await other.getByRole('button', { name: 'Log out and clear API connections' }).click()
  await other.getByRole('button', { name: 'Connect & sign in', exact: true }).click()
  await expect(other.getByText('Wallet workspace · Talk / Plan / Build', { exact: true })).toBeVisible()
  const stale = await page.evaluate(async tag => {
    const response = await fetch('/api/agent/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RecallLoop-Session': tag }, body: '{}' })
    return { status: response.status, data: await response.json() }
  }, oldAuth.sessionTag)
  expect(stale.status).toBe(409)
  expect(stale.data.code).toBe('session_changed')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true })).not.toHaveValue('// ONLY_WALLET_A\n')
  await expect(page.getByRole('textbox', { name: 'Message the coding agent' })).toHaveValue('')
  await expect(page.locator('article')).toHaveCount(0)
  const bAuth = await other.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  expect(bAuth.address).toBe(b.toSuiAddress())
  // A's old Wallet Standard connection must not bind to B's new session.
  await page.evaluate(() => window.recallloopDisconnectWallet())
  const afterDisconnect = await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  expect(afterDisconnect.sessionTag).toBe(bAuth.sessionTag)
  expect(afterDisconnect.address).toBe(b.toSuiAddress())
  await expect(page.getByText('Wallet workspace · Talk / Plan / Build', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Log out and clear API connections' }).click()
  await page.getByRole('button', { name: 'Connect & sign in', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true })).toHaveValue('// ONLY_WALLET_A\n')
  await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: 'Message the coding agent' })).toHaveValue('')
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
    const composer = await page.getByRole('textbox', { name: 'Message the coding agent' }).boundingBox()
    expect(composer.y + composer.height).toBeLessThanOrEqual(844)
    await page.getByRole('combobox', { name: 'Workspace view' }).selectOption('project')
    await expect(page.getByRole('textbox', { name: 'Edit src/greet.ts', exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Workspace view' }).selectOption('memory')
    await expect(page.getByRole('heading', { name: 'Portable memory', exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Workspace view' }).selectOption('chat')
  }
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

test('stopping a streamed turn preserves a partial answer without capture and retry avoids duplicate user messages', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await demo(page)
  await page.getByRole('button', { name: 'Talk', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message the coding agent' }).fill('Tell me my preferences')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('article').last()).toContainText('Mock model — deterministic')
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByText('Stopped · partial answer', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Memory', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Memory inventory' })).toContainText(/0\s*listed memories/)
  await page.getByRole('button', { name: 'Retry this turn', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden()
  await expect(page.locator('article').last().getByRole('button', { name: 'Record outcome', exact: true })).toBeVisible()
  expect(await page.locator('article').count()).toBe(3)
  await expect(page.locator('article').last()).toContainText('transcript records')
  checkErrors()
})
