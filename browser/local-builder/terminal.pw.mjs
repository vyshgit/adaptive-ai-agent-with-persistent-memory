import { test, expect } from './harness.mjs'
import { localDemo, localWallet, loopbackModel, reviewCommand, alive, coding, view, api } from './helpers.mjs'
import { failOnPageErrors, installWallet, openSettings, chooseProviderModel } from '../helpers.mjs'
import { chatFrames } from '../../tests/helpers/builder-fixture.mjs'

test.use({ signInBudget: 1 })

test('an approved real offline command reports its output and nonzero exit code without inherited app credentials or a fabricated pass', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await localDemo(page)
  const review = await reviewCommand(page, 'node -e "console.log(6 * 7); console.log(process.env.TATUM_API_KEY || \'no app key\'); process.exit(7)"')
  await expect(review).toContainText('OS permissions')
  await review.getByRole('button', { name: 'Run exact command', exact: true }).click()
  await expect(review).toBeHidden({ timeout: 30_000 })
  const output = page.getByLabel('Native terminal output', { exact: true })
  await expect(output).toContainText('42')
  await expect(output).toContainText('no app key')
  await expect(page.getByRole('region', { name: 'Local native terminal', exact: true })).toContainText('Exited with code 7.')
  await expect(output).not.toContainText('SYNTHETIC_PARENT_KEY_NOT_FOR_SHELL')
  await expect(page.getByRole('button', { name: 'Run command', exact: true })).toBeEnabled()
  checkErrors()
})

test('stopping a real approved command terminates its ordinary descendants and leaves an honest stopped terminal state', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await localDemo(page)
  const script = 'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); console.log(process.pid+","+child.pid); setInterval(()=>{},1000)'
  const review = await reviewCommand(page, `node -e '${script}'`)
  await review.getByRole('button', { name: 'Run exact command', exact: true }).click()
  await review.getByRole('button', { name: 'Close dialog', exact: true }).click()
  const output = page.getByLabel('Native terminal output', { exact: true })
  await expect(output).toContainText(/\d+,\d+/, { timeout: 30_000 })
  const pids = (await output.innerText()).trim().match(/(\d+),(\d+)/).slice(1).map(Number)
  await page.getByRole('button', { name: 'Stop active task', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop active task', exact: true })).toBeHidden({ timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Local native terminal', exact: true })).toContainText('Stopped by user. Not a passed test.')
  for (const pid of pids) await expect.poll(() => alive(pid)).toBe(false)
  checkErrors()
})

test('stopping an actual SDK coding-task command kills its ordinary descendants, reports stopped rather than complete, and grants no later approval', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  const script = 'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); console.log(process.pid+","+child.pid); setInterval(()=>{},1000)'
  const command = `node -e '${script}'`
  const model = await loopbackModel(body => chatFrames(body.messages.some(message => message.role === 'tool')
    ? { text: 'The reviewed action was rejected. No command ran.' }
    : { call: { name: 'run_command', input: { command, cwd: '.', timeoutMs: 60_000, reason: 'Offline fixture: exercise user cancellation of this exact native command.' } } }))
  try {
    await installWallet(page)
    await localWallet(page)
    const settings = await openSettings(page)
    await settings.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
    await settings.getByRole('textbox', { name: 'API base URL', exact: true }).fill(model.baseUrl)
    await settings.getByRole('combobox', { name: 'API protocol', exact: true }).selectOption('chat')
    await chooseProviderModel(settings, 'test-model')
    await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
    await expect(settings).toContainText('Generation verified. This provider is ready in your model picker.')
    await settings.getByRole('button', { name: 'Done', exact: true }).click()
    await coding(page, 'Run the loopback fixture command and let me stop it.')
    const review = page.getByRole('dialog', { name: 'Review native command', exact: true })
    await expect(review).toBeVisible({ timeout: 30_000 })
    await expect(review).toContainText('Agent request · waiting for you')
    await expect(review.getByRole('button', { name: 'Run exact command', exact: true })).toBeDisabled()
    await viewAfterReview(page, review)
    const output = page.getByLabel('Native terminal output', { exact: true })
    await expect(output).toContainText(/\d+,\d+/, { timeout: 30_000 })
    const pids = (await output.innerText()).match(/(\d+),(\d+)/).slice(1).map(Number)
    expect((await api(page, '/builder/status')).data.task.kind).toBe('coding')
    await page.getByRole('button', { name: 'Stop active task', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop active task', exact: true })).toBeHidden({ timeout: 30_000 })
    await expect(page.getByRole('region', { name: 'Local native terminal', exact: true })).toContainText('Stopped by user. Not a passed test.')
    for (const pid of pids) await expect.poll(() => alive(pid)).toBe(false)
    expect(model.requests.filter(request => request.body.stream)).toHaveLength(1)
    expect((await api(page, '/builder/status')).data.approvals).toEqual([])
    await view(page, 'Coding')
    await expect(page.getByRole('region', { name: 'Local coding tasks', exact: true })).toContainText('Task stopped')
    await expect(page.getByRole('region', { name: 'Local coding tasks', exact: true })).not.toContainText('Task completed')
    await coding(page, 'A later task must ask for a new command review.')
    await expect(review).toBeVisible({ timeout: 30_000 })
    await expect(review.getByRole('button', { name: 'Run exact command', exact: true })).toBeDisabled()
    await review.getByRole('button', { name: 'Reject action', exact: true }).click()
    await expect(review).toBeHidden()
    await expect(page.getByRole('button', { name: 'Stop active task', exact: true })).toBeHidden({ timeout: 30_000 })
    expect((await api(page, '/memory')).data.inventory.total).toBe(0)
    checkErrors()
  } finally { await model.close() }
})

async function viewAfterReview(page, review) {
  await review.getByRole('checkbox', { name: 'I understand this is native execution with OS and network access, not a sandbox.', exact: true }).check()
  await review.getByRole('button', { name: 'Run exact command', exact: true }).click()
  await expect(review).toBeHidden()
  await view(page, 'Terminal')
}
