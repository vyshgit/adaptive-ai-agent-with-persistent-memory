import { test, expect } from './harness.mjs'
import { installWallet, signIn, openSettings, chooseProviderModel, cachedValues, failOnPageErrors } from './helpers.mjs'
import { installConnectionFixture, SYNTHETIC_ACCOUNT_ID } from './fixtures.mjs'

test.use({ signInBudget: 1 })

async function setup(page) {
  await installWallet(page)
  await signIn(page)
  const fixture = await installConnectionFixture(page)
  return { fixture, settings: await openSettings(page) }
}
const section = (settings, name) => settings.getByRole('tab', { name, exact: true }).click()
const modelSelect = settings => settings.getByRole('combobox', { name: 'Model', exact: true })
const connect = settings => settings.getByRole('button', { name: 'Connect & verify model', exact: true })
const load = settings => settings.getByRole('button', { name: /^(?:Load|Refresh) models$/ })

async function visibility(page, value) {
  // Headless Chromium does not consistently hide background pages. Exercise the
  // same visibility event explicitly while a separate credential tab is open.
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value })
    document.dispatchEvent(new Event('visibilitychange'))
  }, value)
}

test('unsubmitted API drafts and a selected provider model survive Settings sections and a credential tab, but closing Settings disposes credentials and catalogue eligibility', async ({ page, context }) => {
  const checkErrors = failOnPageErrors(page)
  const { fixture, settings } = await setup(page)
  const keys = { model: 'SYNTHETIC_UNSUBMITTED_MODEL_DRAFT', tatum: 'SYNTHETIC_UNSUBMITTED_TATUM_DRAFT', delegate: '6'.repeat(64) }
  await settings.getByLabel('Model API key', { exact: true }).fill(keys.model)
  await chooseProviderModel(settings, 'synthetic-model')
  await section(settings, 'Tatum')
  await settings.getByLabel('Tatum API key', { exact: true }).fill(keys.tatum)
  await section(settings, 'Walrus Memory')
  await settings.getByLabel('Walrus Memory account object ID', { exact: true }).fill(SYNTHETIC_ACCOUNT_ID)
  await settings.getByLabel('Delegate private key', { exact: true }).fill(keys.delegate)
  const credentialTab = await context.newPage()
  await credentialTab.goto('about:blank')
  try {
    await visibility(page, 'hidden')
    await page.bringToFront()
    await visibility(page, 'visible')
    await section(settings, 'Walrus Memory')
    await expect(settings.getByLabel('Walrus Memory account object ID', { exact: true })).toHaveValue(SYNTHETIC_ACCOUNT_ID)
    await expect(settings.getByLabel('Delegate private key', { exact: true })).toHaveValue(keys.delegate)
    await section(settings, 'Tatum')
    await expect(settings.getByLabel('Tatum API key', { exact: true })).toHaveValue(keys.tatum)
    await section(settings, 'Model')
    await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue(keys.model)
    await expect(modelSelect(settings)).toHaveValue('synthetic-model')
    await expect(connect(settings)).toBeEnabled()
    expect(fixture.mutations()).toEqual([])
    for (const key of Object.values(keys)) expect(JSON.stringify(await cachedValues(page))).not.toContain(key)
    await settings.getByRole('button', { name: 'Done', exact: true }).click()
    const fresh = await openSettings(page)
    await expect(fresh.getByLabel('Model API key', { exact: true })).toHaveValue('')
    await expect(modelSelect(fresh)).toHaveValue('')
    await section(fresh, 'Tatum')
    await expect(fresh.getByLabel('Tatum API key', { exact: true })).toHaveValue('')
    await section(fresh, 'Walrus Memory')
    await expect(fresh.getByLabel('Delegate private key', { exact: true })).toHaveValue('')
    checkErrors()
  } finally { await visibility(page, 'visible'); await credentialTab.close() }
})

test('successful connections clear only submitted fields; failed checks, saved verification and mock selection preserve unfinished forms', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  const { fixture, settings } = await setup(page)
  const keys = { model: 'SYNTHETIC_SEPARATE_MODEL_DRAFT', tatum: 'SYNTHETIC_SEPARATE_TATUM_DRAFT', delegate: '5'.repeat(64) }
  await settings.getByLabel('Model API key', { exact: true }).fill(keys.model)
  await chooseProviderModel(settings, 'synthetic-model')
  await section(settings, 'Walrus Memory')
  await settings.getByLabel('Walrus Memory account object ID', { exact: true }).fill(SYNTHETIC_ACCOUNT_ID)
  await settings.getByLabel('Delegate private key', { exact: true }).fill(keys.delegate)
  await section(settings, 'Tatum')
  await settings.getByLabel('Tatum API key', { exact: true }).fill(keys.tatum)
  await settings.getByRole('button', { name: 'Verify & connect Tatum', exact: true }).click()
  await expect(settings.getByRole('button', { name: 'Reconnect Tatum', exact: true })).toBeEnabled()
  await settings.getByRole('button', { name: 'Reconnect Tatum', exact: true }).click()
  await expect(settings.getByLabel('Tatum API key', { exact: true })).toHaveValue('')
  await settings.getByLabel('Tatum API key', { exact: true }).fill(keys.tatum)
  await section(settings, 'Model')
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue(keys.model)
  await expect(modelSelect(settings)).toHaveValue('synthetic-model')
  await connect(settings).click()
  await expect(settings.getByRole('button', { name: 'Reconnect model', exact: true })).toBeEnabled()
  await settings.getByRole('button', { name: 'Reconnect model', exact: true }).click()
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue('')
  await settings.getByLabel('Model API key', { exact: true }).fill(keys.model)
  await chooseProviderModel(settings, 'synthetic-discovered-only')
  await settings.getByRole('button', { name: 'Verify model', exact: true }).click()
  await expect(settings.getByRole('button', { name: 'Verify model', exact: true })).toBeEnabled()
  await expect(modelSelect(settings)).toHaveValue('synthetic-discovered-only')
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue(keys.model)
  await section(settings, 'Walrus Memory')
  await expect(settings.getByLabel('Delegate private key', { exact: true })).toHaveValue(keys.delegate)
  fixture.failNext('/connections/memwal', 'synthetic_delegate_failed', 'Synthetic delegate refused; no connection installed.')
  await settings.getByRole('button', { name: 'Verify & connect Walrus', exact: true }).click()
  await expect(settings.getByRole('alert')).toContainText('synthetic_delegate_failed')
  await expect(settings.getByLabel('Delegate private key', { exact: true })).toHaveValue(keys.delegate)
  await expect(settings.getByRole('button', { name: 'Verify & connect Walrus', exact: true })).toBeEnabled()
  await section(settings, 'Tatum')
  await expect(settings.getByLabel('Tatum API key', { exact: true })).toHaveValue(keys.tatum)
  await section(settings, 'Advanced')
  await settings.getByRole('button', { name: 'Use scripted mock model', exact: true }).click()
  await expect(settings.getByRole('button', { name: 'Use scripted mock model', exact: true })).toBeEnabled()
  await section(settings, 'Model')
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue(keys.model)
  await expect(modelSelect(settings)).toHaveValue('synthetic-discovered-only')
  expect(fixture.mutations().map(request => request.path)).toEqual(['/connections/tatum', '/connect', '/verify', '/connections/memwal', '/connect'])
  for (const key of Object.values(keys)) expect(JSON.stringify(await cachedValues(page))).not.toContain(key)
  checkErrors()
})

test('the provider catalogue is bound to its key and base URL; failed or cancelled refreshes cannot leave an old model eligible', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  const { fixture, settings } = await setup(page)
  const key = 'SYNTHETIC_CATALOGUE_KEY_DRAFT'
  await settings.getByLabel('Model API key', { exact: true }).fill(key)
  await chooseProviderModel(settings, 'synthetic-model')
  await settings.getByLabel('Model API key', { exact: true }).fill(`${key}_CHANGED`)
  await expect(modelSelect(settings)).toHaveValue('')
  await expect(connect(settings)).toBeDisabled()
  await chooseProviderModel(settings, 'synthetic-model')
  await settings.getByText('Advanced connection options', { exact: true }).click()
  await settings.getByLabel('API base URL', { exact: true }).fill('https://api.openai.com/v1')
  await expect(modelSelect(settings)).toHaveValue('')
  await expect(connect(settings)).toBeDisabled()
  await chooseProviderModel(settings, 'synthetic-model')
  fixture.failNext('/models/discover', 'provider_network', 'Synthetic catalogue refresh failed.')
  await load(settings).click()
  await expect(settings.getByRole('alert')).toContainText('provider_network')
  await expect(modelSelect(settings)).toHaveValue('')
  await expect(connect(settings)).toBeDisabled()
  await chooseProviderModel(settings, 'synthetic-model')
  const hold = fixture.holdNext('/models/discover')
  try {
    await load(settings).click()
    await hold.started.promise
    await settings.getByRole('button', { name: 'Cancel check', exact: true }).click()
    await expect(settings).toContainText('Model discovery cancelled')
    hold.release.resolve(); await hold.finished.promise
    await expect(modelSelect(settings)).toHaveValue('')
    await expect(connect(settings)).toBeDisabled()
    await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue(`${key}_CHANGED`)
  } finally { hold.release.resolve() }
  await settings.getByLabel('Provider', { exact: true }).selectOption('openrouter')
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue('')
  await expect(modelSelect(settings)).toBeDisabled()
  await expect(connect(settings)).toBeDisabled()
  expect(fixture.mutations()).toEqual([])
  checkErrors()
})

test('switching browser tabs keeps discovery running and preserves the selected model and API draft', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  const { fixture, settings } = await setup(page)
  const key = 'SYNTHETIC_HIDDEN_DISCOVERY_DRAFT'
  await settings.getByLabel('Model API key', { exact: true }).fill(key)
  await chooseProviderModel(settings, 'synthetic-model')
  const hold = fixture.holdNext('/models/discover')
  try {
    await load(settings).click()
    await hold.started.promise
    await visibility(page, 'hidden')
    await expect(settings).toContainText('Loading models from this provider')
    hold.release.resolve(); await hold.finished.promise
    await visibility(page, 'visible')
    await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue(key)
    await expect(modelSelect(settings)).toHaveValue('synthetic-model')
    await expect(connect(settings)).toBeEnabled()
    expect(fixture.mutations()).toEqual([])
    checkErrors()
  } finally { hold.release.resolve(); await visibility(page, 'visible') }
})

test('manual model entry is an advanced fallback only when discovery is unavailable, not when a provider returns an empty list', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  const { fixture, settings } = await setup(page)
  await settings.getByLabel('Model API key', { exact: true }).fill('SYNTHETIC_MANUAL_FALLBACK_KEY')
  fixture.catalog.models = []
  await load(settings).click()
  await expect(settings).toContainText('no supported model IDs')
  await settings.getByText('Advanced connection options', { exact: true }).click()
  const manual = settings.getByRole('checkbox', { name: 'Use an exact model ID when discovery is unavailable', exact: true })
  await expect(manual).toHaveCount(0)
  await expect(connect(settings)).toBeDisabled()
  fixture.catalog.discovered = false
  await load(settings).click()
  await expect(manual).toBeVisible()
  await manual.check()
  await settings.getByLabel('Exact model ID (fallback)', { exact: true }).fill('synthetic-exact-model')
  await expect(connect(settings)).toBeEnabled()
  await settings.getByLabel('Model API key', { exact: true }).fill('SYNTHETIC_CHANGED_FALLBACK_KEY')
  await expect(manual).toHaveCount(0)
  await expect(connect(settings)).toBeDisabled()
  expect(fixture.mutations()).toEqual([])
  checkErrors()
})
