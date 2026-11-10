import { test, expect } from './harness.mjs'
import { localWallet, loopbackModel, coding, view, select, api } from './helpers.mjs'
import { installWallet, openSettings, chooseProviderModel, cachedValues, failOnPageErrors } from '../helpers.mjs'
import { chatFrames } from '../../tests/helpers/builder-fixture.mjs'

test.use({ signInBudget: 1 })

// Both providers are scripted loopback endpoints. Settings, wallet verification,
// the gateway, SDK, project scope and browser lifecycle all use the real launcher.
test('a streamed quota failure preserves project context and drafts, and another connected text-only profile can finish the follow-up', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const checkErrors = failOnPageErrors(page)
  let failing = false
  const primary = await loopbackModel(() => failing
    ? 'data: {"choices":[{"delta":{"content":"Partial before quota."}}]}\n\ndata: {"error":{"code":402,"message":"Payment required SYNTHETIC_PRIMARY_GATEWAY_KEY PRIVATE_UPSTREAM_PROMPT"}}\n\ndata: [DONE]\n\n'
    : chatFrames({ text: 'FIRST_PROVIDER_SUMMARY: use a focused change and verify it.' }))
  const fallback = await loopbackModel(() => chatFrames({ text: 'Recovered from the supplied project conversation. No files changed or commands ran.' }))
  async function connect(settings, model, key, tools = true) {
    await settings.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
    await settings.getByRole('textbox', { name: 'API base URL', exact: true }).fill(model.baseUrl)
    await settings.getByRole('combobox', { name: 'API protocol', exact: true }).selectOption('chat')
    await settings.getByLabel(/^Model API key/).fill(key)
    await chooseProviderModel(settings, 'test-model')
    if (!tools) {
      await settings.getByText('Verification & tool options', { exact: true }).click()
      await settings.getByRole('checkbox', { name: 'Enable bounded coding & memory tools', exact: true }).uncheck()
    }
    await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
    await expect(settings.getByText('Generation verified', { exact: true })).toBeVisible()
    await settings.getByRole('button', { name: 'Done', exact: true }).click()
  }
  try {
    await installWallet(page)
    await localWallet(page)
    const scope = (await api(page, '/builder/status')).data.workspaceId
    await connect(await openSettings(page), primary, 'SYNTHETIC_PRIMARY_GATEWAY_KEY')
    const picker = page.getByRole('combobox', { name: 'Project model', exact: true })
    const firstSelection = await picker.inputValue()
    await page.getByRole('checkbox', { name: 'Auto-memory', exact: true }).uncheck()
    await coding(page, 'FIRST_PROVIDER_TASK: suggest an approach for this project.')
    const output = page.getByRole('log', { name: 'Project conversation output', exact: true })
    await expect(output).toContainText('FIRST_PROVIDER_SUMMARY', { timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'New project session', exact: true })).toBeEnabled()
    const editor = await select(page, 'first.ts')
    await editor.fill('// PRIVATE_UNSAVED_GATEWAY_DRAFT\n')
    failing = true
    await coding(page, 'SECOND_FAILED_TASK: continue that approach.')
    await expect(output).toContainText('Model provider HTTP 402', { timeout: 30_000 })
    await expect(output).toContainText('Partial before quota.')
    await expect(output).not.toContainText('PRIVATE_UPSTREAM_PROMPT')
    await expect(page.getByRole('button', { name: 'New project session', exact: true })).toBeEnabled()
    await expect(picker).toHaveValue(firstSelection)
    expect(primary.requests.filter(request => request.body.stream)).toHaveLength(2)
    const task = page.getByRole('textbox', { name: 'Coding task', exact: true })
    await task.fill('FOLLOWUP_AFTER_QUOTA: use the earlier context to suggest a next step.')
    const settings = await openSettings(page)
    await settings.getByRole('button', { name: 'Add provider', exact: true }).click()
    await connect(settings, fallback, 'SYNTHETIC_FALLBACK_GATEWAY_KEY', false)
    await expect(picker.locator('optgroup')).toHaveCount(2)
    await expect(picker).not.toHaveValue(firstSelection)
    await expect(page.getByText(/Text-only response · tools are disabled or unsupported/)).toBeVisible()
    await expect(task).toHaveValue('FOLLOWUP_AFTER_QUOTA: use the earlier context to suggest a next step.')
    await task.press('Enter')
    await expect(output).toContainText('Recovered from the supplied project conversation', { timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'New project session', exact: true })).toBeEnabled()
    const [recovered] = fallback.requests.filter(request => request.body.stream)
    expect(recovered.headers.authorization).toBe('Bearer SYNTHETIC_FALLBACK_GATEWAY_KEY')
    expect(recovered.body.tools).toBeUndefined()
    expect(recovered.body.tool_choice).toBeUndefined()
    const context = JSON.stringify(recovered.body)
    for (const text of ['FIRST_PROVIDER_TASK', 'FIRST_PROVIDER_SUMMARY', 'SECOND_FAILED_TASK', 'Partial before quota.', 'FOLLOWUP_AFTER_QUOTA']) expect(context).toContain(text)
    expect(context).not.toMatch(/SYNTHETIC_.*_GATEWAY_KEY|PRIVATE_UNSAVED_GATEWAY_DRAFT|PRIVATE_UPSTREAM_PROMPT/)
    await view(page, 'Files')
    await expect(editor).toHaveValue('// PRIVATE_UNSAVED_GATEWAY_DRAFT\n')
    expect((await api(page, '/builder/status')).data.workspaceId).toBe(scope)
    expect((await api(page, '/status')).data.modelConnections).toHaveLength(2)
    expect((await api(page, '/memory')).data.inventory.total).toBe(0)
    expect(JSON.stringify(await cachedValues(page))).not.toMatch(/SYNTHETIC_.*_GATEWAY_KEY|PRIVATE_UNSAVED_GATEWAY_DRAFT/)
    await page.screenshot({ path: testInfo.outputPath('provider-recovery-with-draft-dark.png'), animations: 'disabled' })
    checkErrors()
  } finally { await Promise.all([primary.close(), fallback.close()]) }
})
