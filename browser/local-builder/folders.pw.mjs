import { test as base, expect } from './harness.mjs'
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { api, localDemo, select, view, greeting, holdResponse } from './helpers.mjs'
import { cachedValues, deferred, failOnPageErrors } from '../helpers.mjs'

// Real disposable directories outside the launch project. Only transport timing
// is intercepted below; all browsing, consent, scope changes and disk IO are real.
const test = base.extend({
  folders: async ({ page }, use) => {
    const root = await mkdtemp('/tmp/opencode/recallloop-browser-project-picker-')
    const alpha = path.join(root, 'alpha'), beta = path.join(root, 'beta')
    try {
      await Promise.all([alpha, beta, path.join(root, '.ssh'), path.join(root, 'node_modules'), path.join(root, '.opencode')].map(directory => mkdir(directory)))
      for (const [directory, label] of [[alpha, 'Alpha'], [beta, 'Beta']]) {
        await mkdir(path.join(directory, 'dist'))
        await Promise.all([
          writeFile(path.join(directory, 'marker.ts'), `export const project = '${label}'\n`),
          writeFile(path.join(directory, 'greet.ts'), greeting),
          writeFile(path.join(directory, 'dist', 'index.html'), `<h1>${label} static project</h1>`),
        ])
      }
      await symlink(alpha, path.join(root, 'linked-project'))
      await use({ root, alpha, beta })
    } finally {
      // Close authority before removing the test-owned roots, including on failure.
      if (!page.isClosed()) await api(page, '/auth/logout', {}).catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  },
})
test.use({ signInBudget: 1 })

const trust = picker => picker.getByRole('checkbox', { name: 'I trust this project and consent to its selected permissions for this login.', exact: true })
const folderPath = picker => picker.getByRole('textbox', { name: 'Workspace folder path', exact: true })

async function browse(picker, directory) {
  await folderPath(picker).fill(directory)
  await folderPath(picker).press('Enter')
  await expect(picker.getByText(`Selected folder: ${directory}`, { exact: true })).toBeVisible()
  await expect(folderPath(picker)).toBeEnabled()
}

async function pickerFor(page, directory) {
  await page.getByRole('button', { name: /^(?:Choose|Change) folder$/ }).click()
  const picker = page.getByRole('dialog', { name: 'Choose workspace folder', exact: true })
  await expect(folderPath(picker)).toBeEnabled()
  if (directory) await browse(picker, directory)
  return picker
}

async function openSelected(page, picker, switching = false) {
  await trust(picker).check()
  await picker.getByRole('button', { name: switching ? 'Switch project' : 'Open project', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(page.getByRole('button', { name: 'New project session', exact: true })).toBeEnabled()
  return (await api(page, '/builder/status')).data
}

test('folder navigation, explicit consent and keyboard focus work outside the launch root at desktop and mobile sizes in both themes', async ({ page, folders }, testInfo) => {
  const checkErrors = failOnPageErrors(page), opens = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/agent/builder/open') opens.push(request.postDataJSON()) })
  const { directory: launch } = await localDemo(page, { open: false })
  let picker = await pickerFor(page, folders.root)
  const listing = picker.getByRole('region', { name: 'Workspace folders', exact: true })
  await expect(listing.getByRole('button')).toHaveText(['alpha', 'beta'])
  await expect(listing).not.toContainText('linked-project')
  await picker.getByRole('button', { name: 'Home', exact: true }).click()
  await expect(folderPath(picker)).toHaveValue(homedir())
  await expect(folderPath(picker)).toBeEnabled()
  await picker.getByRole('button', { name: 'Launch folder', exact: true }).click()
  await expect(folderPath(picker)).toHaveValue(launch)
  await expect(folderPath(picker)).toBeEnabled()
  await browse(picker, folders.alpha)
  await trust(picker).check()
  await picker.getByRole('button', { name: 'Parent', exact: true }).click()
  await expect(folderPath(picker)).toHaveValue(folders.root)
  await expect(trust(picker)).not.toBeChecked()
  await picker.getByRole('region', { name: 'Workspace folders', exact: true }).getByRole('button', { name: 'alpha', exact: true }).click()
  await expect(picker.getByText(`Selected folder: ${folders.alpha}`, { exact: true })).toBeVisible()
  for (const [theme, width, height] of [['dark', 1440, 1000], ['light', 1440, 1000], ['light', 390, 844], ['dark', 320, 568]]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) {
      await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Choose folder', exact: true })).toBeFocused()
      await page.getByRole('button', { name: `Switch to ${theme} theme`, exact: true }).click()
      picker = await pickerFor(page, folders.alpha)
    }
    await expect(picker.getByRole('button', { name: 'Open project', exact: true })).toBeDisabled()
    await folderPath(picker).scrollIntoViewIfNeeded()
    await expect(folderPath(picker)).toBeInViewport()
    await expect(picker.getByRole('button', { name: 'Open project', exact: true })).toBeInViewport()
    expect(await picker.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const inputBox = await folderPath(picker).boundingBox(), browseBox = await picker.getByRole('button', { name: 'Browse', exact: true }).boundingBox()
    expect(Math.abs(inputBox.height - browseBox.height)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath(`folder-picker-${width}-${theme}.png`), animations: 'disabled' })
  }
  expect(opens).toEqual([])
  await picker.getByRole('combobox', { name: 'Project permissions', exact: true }).selectOption('strict')
  await trust(picker).focus(); await page.keyboard.press('Space')
  await picker.getByRole('button', { name: 'Close dialog', exact: true }).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(picker.getByRole('button', { name: 'Open project', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(picker.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused()
  const opened = await openSelected(page, picker)
  expect(opened).toMatchObject({ root: folders.alpha, launchRoot: launch, permissionMode: 'strict', opened: true })
  expect(opens).toEqual([{ confirm: 'open-local-folder', directory: folders.alpha, workspaceId: null, permissionMode: 'strict' }])
  const heading = page.getByRole('heading', { name: 'alpha', exact: true })
  await expect(heading).toBeInViewport()
  expect(await heading.evaluate(node => node.clientWidth > 0 && node.scrollWidth <= node.clientWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Change folder', exact: true })).toBeInViewport()
  expect(JSON.stringify(await cachedValues(page))).not.toContain(folders.alpha)
  checkErrors()
})

test('switching projects routes real reads, writes, commands and previews to the selected root and clears project drafts only after accepted discard', async ({ page, folders }) => {
  test.setTimeout(90_000)
  const checkErrors = failOnPageErrors(page), prompts = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/agent/builder/prompt') prompts.push(request.postDataJSON()) })
  const { directory: launch } = await localDemo(page, { open: false })
  const alpha = await openSelected(page, await pickerFor(page, folders.alpha))
  const editor = await select(page, 'marker.ts')
  await expect(editor).toHaveValue("export const project = 'Alpha'\n")
  await editor.fill("export const project = 'Alpha saved'\n")
  await page.getByRole('button', { name: 'Save to disk', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save to disk', exact: true })).toBeDisabled()
  await expect.poll(() => readFile(path.join(folders.alpha, 'marker.ts'), 'utf8')).toContain('Alpha saved')
  await view(page, 'Coding')
  await page.getByRole('combobox', { name: 'Agent mode', exact: true }).selectOption('plan')
  await page.getByRole('checkbox', { name: 'Auto-memory', exact: true }).uncheck()
  const task = page.getByRole('textbox', { name: 'Coding task', exact: true })
  await task.fill('Inspect this selected project.')
  await task.press('End'); await task.press('Shift+Enter'); await task.pressSequentially('Explain its structure.')
  expect(prompts).toEqual([])
  await expect(task).toHaveValue('Inspect this selected project.\nExplain its structure.')
  await task.press('Enter')
  await expect(page.getByRole('button', { name: 'Change folder', exact: true })).toBeDisabled()
  await expect(page.getByText('Task completed · not a test verdict', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'New project session', exact: true })).toBeEnabled()
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toMatchObject({ workspaceId: alpha.workspaceId, selectedPath: 'marker.ts', history: [], capture: false, mode: 'plan' })
  await task.fill('PRIVATE_ALPHA_UNSENT_TASK')
  await view(page, 'Terminal')
  await page.getByRole('textbox', { name: 'Native command', exact: true }).fill('pwd')
  await page.getByRole('button', { name: 'Run command', exact: true }).click()
  await expect(page.getByLabel('Native terminal output', { exact: true })).toContainText(folders.alpha, { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Run command', exact: true })).toBeEnabled()
  await page.getByRole('textbox', { name: 'Native command', exact: true }).fill('echo PRIVATE_ALPHA_UNSENT_COMMAND')
  await view(page, 'Memory')
  await page.getByRole('textbox', { name: 'Memory query', exact: true }).fill('PRIVATE_ALPHA_QUERY')
  await page.getByRole('checkbox', { name: 'Also retrieve raw chat (separate consent)', exact: true }).check()
  await page.getByRole('button', { name: 'New checkpoint', exact: true }).click()
  await page.getByRole('textbox', { name: 'Reviewed preferences', exact: true }).fill('PRIVATE_ALPHA_CHECKPOINT')
  await page.getByRole('button', { name: 'Review checkpoint text', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Review Walrus checkpoint', exact: true })
  await expect(review).toBeVisible()
  await review.getByRole('button', { name: 'Close dialog', exact: true }).click()
  const ticket = (await api(page, '/builder/status')).data.approvals[0]
  await view(page, 'Preview')
  await page.getByRole('button', { name: 'Create static preview', exact: true }).click()
  await expect(page.frameLocator('iframe[title="Local static preview"]').getByRole('heading', { name: 'Alpha static project', exact: true })).toBeVisible()
  const previewUrl = await page.getByTitle('Local static preview', { exact: true }).getAttribute('src')
  await view(page, 'Files')
  await editor.fill('// PRIVATE_ALPHA_EDITOR_DRAFT\n')
  const picker = await pickerFor(page, folders.beta)
  await trust(picker).check()
  page.once('dialog', dialog => dialog.dismiss())
  await picker.getByRole('button', { name: 'Switch project', exact: true }).click()
  await expect(picker).toBeVisible()
  await expect(editor).toHaveValue('// PRIVATE_ALPHA_EDITOR_DRAFT\n')
  expect((await api(page, '/builder/status')).data.workspaceId).toBe(alpha.workspaceId)
  page.once('dialog', dialog => dialog.accept())
  const beta = await openSelected(page, picker, true)
  expect(beta).toMatchObject({ root: folders.beta, launchRoot: launch, approvals: [] })
  expect(beta.workspaceId).not.toBe(alpha.workspaceId)
  expect(await readFile(path.join(folders.alpha, 'marker.ts'), 'utf8')).toBe("export const project = 'Alpha saved'\n")
  await expect(page.getByRole('textbox', { name: 'Local file editor', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Pending local approvals', exact: true })).toHaveCount(0)
  await expect(task).toHaveValue('')
  await expect(page.getByRole('log', { name: 'Project conversation output', exact: true })).not.toContainText('Inspect this selected project')
  expect((await api(page, '/builder/approvals', { workspaceId: alpha.workspaceId, id: ticket.id, digest: ticket.digest, decision: 'approve' })).status).toBe(409)
  expect(await fetch(previewUrl, { signal: AbortSignal.timeout(2000) }).then(response => response.ok, () => false)).toBe(false)
  await view(page, 'Memory')
  await expect(page.getByRole('textbox', { name: 'Memory query', exact: true })).toHaveValue('')
  await expect(page.getByRole('checkbox', { name: 'Also retrieve raw chat (separate consent)', exact: true })).not.toBeChecked()
  await page.getByRole('button', { name: 'New checkpoint', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Reviewed preferences', exact: true })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: 'Portable project label', exact: true })).toHaveValue('beta')
  const betaEditor = await select(page, 'marker.ts')
  await expect(betaEditor).toHaveValue("export const project = 'Beta'\n")
  await betaEditor.fill("export const project = 'Beta saved'\n")
  await page.getByRole('button', { name: 'Save to disk', exact: true }).click()
  await expect.poll(() => readFile(path.join(folders.beta, 'marker.ts'), 'utf8')).toContain('Beta saved')
  await view(page, 'Terminal')
  await expect(page.getByRole('textbox', { name: 'Native command', exact: true })).toHaveValue('')
  await expect(page.getByLabel('Native terminal output', { exact: true })).not.toContainText(folders.alpha)
  await page.getByRole('textbox', { name: 'Native command', exact: true }).fill('pwd')
  await page.getByRole('button', { name: 'Run command', exact: true }).click()
  await expect(page.getByLabel('Native terminal output', { exact: true })).toContainText(folders.beta, { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Run command', exact: true })).toBeEnabled()
  await view(page, 'Preview')
  await expect(page.getByTitle('Local static preview', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Create static preview', exact: true }).click()
  await expect(page.frameLocator('iframe[title="Local static preview"]').getByRole('heading', { name: 'Beta static project', exact: true })).toBeVisible()
  expect((await api(page, '/memory')).data.inventory.total).toBe(0)
  expect(JSON.stringify(await cachedValues(page))).not.toMatch(/PRIVATE_ALPHA|recallloop-browser-project-picker-/)
  checkErrors()
})

test('missing, private and removed destinations preserve the open workspace, and a failed recheck invalidates prior folder consent', async ({ page, folders }) => {
  const checkErrors = failOnPageErrors(page)
  await localDemo(page, { open: false })
  const initial = await openSelected(page, await pickerFor(page, folders.alpha))
  const picker = await pickerFor(page)
  for (const invalid of [path.join(folders.root, 'missing'), path.join(folders.alpha, 'marker.ts'), path.join(folders.root, '.ssh'), '/data']) {
    await folderPath(picker).fill(invalid); await folderPath(picker).press('Enter')
    await expect(picker.getByRole('alert')).toBeVisible()
    await expect(folderPath(picker)).toHaveAttribute('aria-invalid', 'true')
    await expect(trust(picker)).toBeDisabled()
    await expect(picker.getByRole('button', { name: 'Switch project', exact: true })).toBeDisabled()
    expect((await api(page, '/builder/status')).data.workspaceId).toBe(initial.workspaceId)
  }
  await browse(picker, folders.beta)
  await trust(picker).check()
  await rename(folders.beta, `${folders.beta}-moved`)
  await picker.getByRole('button', { name: 'Switch project', exact: true }).click()
  await expect(picker.getByRole('alert')).toContainText('does not exist or cannot be accessed')
  await expect(picker.getByRole('button', { name: 'Browse', exact: true })).toBeEnabled()
  expect((await api(page, '/builder/status')).data).toMatchObject({ root: folders.alpha, workspaceId: initial.workspaceId })
  await picker.getByRole('button', { name: 'Browse', exact: true }).click()
  await expect(folderPath(picker)).toHaveAttribute('aria-invalid', 'true')
  await expect(trust(picker)).toBeDisabled()
  await expect(trust(picker)).not.toBeChecked()
  await expect(picker.getByRole('button', { name: 'Switch project', exact: true })).toBeDisabled()
  // Editing back to the formerly validated spelling must still require a check.
  await folderPath(picker).fill(`${folders.beta}/`); await folderPath(picker).fill(folders.beta)
  await expect(trust(picker)).toBeDisabled()
  await rename(`${folders.beta}-moved`, folders.beta)
  await browse(picker, folders.beta)
  const next = await openSelected(page, picker, true)
  expect(next.root).toBe(folders.beta)
  checkErrors()
})

test('cancelling a loading folder picker restores focus and ignores its late result when a newer picker is open', async ({ page, folders }) => {
  const checkErrors = failOnPageErrors(page)
  await localDemo(page, { open: false })
  const held = await holdResponse(page, '**/api/agent/builder/folders')
  try {
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click()
    await held.started.promise
    const picker = page.getByRole('dialog', { name: 'Choose workspace folder', exact: true })
    await expect(picker.getByText('Loading folders…', { exact: true })).toBeVisible()
    await expect(folderPath(picker)).toBeDisabled()
    await expect(picker.getByRole('button', { name: 'Open project', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(page.getByRole('button', { name: 'Choose folder', exact: true })).toBeFocused()
    await pickerFor(page, folders.beta)
    held.release.resolve(); await held.finished.promise
    await expect(folderPath(picker)).toHaveValue(folders.beta)
    await expect(picker.getByText(`Selected folder: ${folders.beta}`, { exact: true })).toBeVisible()
    await expect(trust(picker)).not.toBeChecked()
    expect((await api(page, '/builder/status')).data.opened).toBe(false)
    checkErrors()
  } finally { held.release.resolve() }
})

test('a stale tab cannot replace a newer workspace and reconciles its picker after the server rejects the old scope', async ({ page, folders }) => {
  const checkErrors = failOnPageErrors(page), requests = []
  await localDemo(page, { open: false })
  const alpha = await openSelected(page, await pickerFor(page, folders.alpha))
  const picker = await pickerFor(page, folders.beta)
  await trust(picker).check()
  // Same-login change models a second tab without sending this tab a status update.
  const newer = await api(page, '/builder/open', { confirm: 'open-local-folder', directory: folders.root, workspaceId: alpha.workspaceId, permissionMode: 'strict' })
  expect(newer.status).toBe(200)
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/agent/builder/open') requests.push(request.postDataJSON()) })
  await picker.getByRole('button', { name: 'Switch project', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(page.getByRole('heading', { name: path.basename(folders.root), exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('active project changed')
  expect(requests).toHaveLength(1)
  expect(requests[0].workspaceId).toBe(alpha.workspaceId)
  expect((await api(page, '/builder/status')).data.workspaceId).toBe(newer.data.workspaceId)
  checkErrors()
})

test('late status responses cannot restore a retired project after a newer status installs another root', async ({ page, folders }) => {
  const checkErrors = failOnPageErrors(page)
  await localDemo(page, { open: false })
  const alpha = await openSelected(page, await pickerFor(page, folders.alpha))
  const held = await holdResponse(page, '**/api/agent/builder/status')
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await held.started.promise
    const newer = await api(page, '/builder/open', { confirm: 'open-local-folder', directory: folders.beta, workspaceId: alpha.workspaceId, permissionMode: 'standard' })
    expect(newer.status).toBe(200)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('heading', { name: 'beta', exact: true })).toBeVisible()
    held.release.resolve(); await held.finished.promise
    await expect(page.getByRole('heading', { name: 'beta', exact: true })).toBeVisible()
    const editor = await select(page, 'marker.ts')
    await expect(editor).toHaveValue("export const project = 'Beta'\n")
    checkErrors()
  } finally { held.release.resolve() }
})

test('an interrupted switch acknowledgement refreshes the committed root even after closing the busy picker', async ({ page, folders }) => {
  const checkErrors = failOnPageErrors(page), started = deferred(), release = deferred()
  await localDemo(page, { open: false })
  const alpha = await openSelected(page, await pickerFor(page, folders.alpha))
  const picker = await pickerFor(page, folders.beta)
  await trust(picker).check()
  await page.route('**/api/agent/builder/open', async route => {
    const response = await route.fetch()
    started.resolve(await response.json())
    await release.promise
    await route.abort('connectionreset')
  }, { times: 1 })
  try {
    await picker.getByRole('button', { name: 'Switch project', exact: true }).click()
    const committed = await started.promise
    expect(committed.root).toBe(folders.beta)
    expect(committed.workspaceId).not.toBe(alpha.workspaceId)
    await expect(picker.getByRole('button', { name: 'Switch project', exact: true })).toBeDisabled()
    await expect(folderPath(picker)).toBeDisabled()
    await picker.getByRole('button', { name: 'Close dialog', exact: true }).click()
    release.resolve()
    await expect(picker).toBeHidden()
    await expect(page.getByRole('heading', { name: 'beta', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New project session', exact: true })).toBeEnabled()
    expect((await api(page, '/builder/status')).data.workspaceId).toBe(committed.workspaceId)
    const editor = await select(page, 'marker.ts')
    await expect(editor).toHaveValue("export const project = 'Beta'\n")
    checkErrors()
  } finally { release.resolve() }
})
