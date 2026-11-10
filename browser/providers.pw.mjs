import { test, expect } from './harness.mjs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { installWallet, signIn, openSettings, chooseProviderModel, leaveSession, cachedValues, failOnPageErrors } from './helpers.mjs'
import { installConnectionFixture, syntheticConnection } from './fixtures.mjs'
import { providerFailure } from '../server/agent/provider-errors.mjs'

async function connectedFixture(page, options = {}) {
  await installWallet(page)
  await signIn(page)
  const fixture = await installConnectionFixture(page, { connection: syntheticConnection(), ...options })
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue(`${fixture.state.connection.id}|${fixture.state.connection.model}`)
  return fixture
}

test('provider presets populate official bases and protocols without guessing model IDs or sharing credentials', async ({ page }, testInfo) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page)
  await signIn(page)
  const settings = await openSettings(page)
  await expect(settings.getByLabel('Provider', { exact: true })).toHaveValue('agentrouter')
  await expect(settings.getByLabel('API base URL', { exact: true })).toBeHidden()
  await expect(settings.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('')
  await expect(settings.getByRole('combobox', { name: 'Model', exact: true })).toBeDisabled()
  await expect(settings.getByRole('button', { name: 'Connect & verify model', exact: true })).toBeDisabled()
  await expect(settings).toContainText('RecallLoop approval is not established')
  await expect(settings.getByRole('link', { name: 'Get an API key' })).toHaveAttribute('href', 'https://ps.air-outer.com/console/token')
  await page.screenshot({ path: testInfo.outputPath('agentrouter-settings-dark.png') })
  const presets = [
    ['openai', 'https://api.openai.com/v1', 'responses', 'https://developers.openai.com/api/docs/models'],
    ['anthropic', 'https://api.anthropic.com/v1', 'chat', 'https://platform.claude.com/docs/en/models/overview'],
    ['openrouter', 'https://openrouter.ai/api/v1', 'chat', 'https://openrouter.ai/models'],
    ['huggingface', 'https://router.huggingface.co/v1', 'chat', 'https://huggingface.co/models?inference_provider=all'],
    ['groq', 'https://api.groq.com/openai/v1', 'chat', 'https://console.groq.com/docs/models'],
    ['deepseek', 'https://api.deepseek.com', 'chat', 'https://api-docs.deepseek.com/quick_start/pricing'],
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'chat', 'https://aistudio.google.com/docs/models'],
    ['ollama', 'http://127.0.0.1:11434/v1', 'chat', null],
  ]
  await settings.getByLabel('Model API key', { exact: true }).fill('synthetic-unsubmitted-provider-key')
  for (const [id, base, protocol, modelsUrl] of presets) {
    await settings.getByLabel('Provider', { exact: true }).selectOption(id)
    await expect(settings.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('')
    await expect(settings.getByRole('combobox', { name: 'Model', exact: true })).toBeDisabled()
    await expect(settings.getByLabel(/^Model API key/)).toHaveValue('')
    await settings.getByText('Advanced connection options', { exact: true }).click()
    await expect(settings.getByLabel('API base URL', { exact: true })).toHaveValue(base)
    await expect(settings.getByLabel('API protocol', { exact: true })).toHaveValue(protocol)
    if (modelsUrl) await expect(settings.getByRole('link', { name: 'Available models' })).toHaveAttribute('href', modelsUrl)
    if (id === 'huggingface') {
      await expect(settings.getByRole('link', { name: 'Get an API key' })).toHaveAttribute('href', 'https://huggingface.co/settings/tokens')
      await expect(settings).toContainText('Make calls to Inference Providers')
    }
  }
  await settings.getByLabel('Provider', { exact: true }).selectOption('custom')
  await expect(settings.getByLabel('API base URL', { exact: true })).toBeVisible()
  await expect(settings.getByLabel('API base URL', { exact: true })).toHaveValue('')
  await expect(settings).toContainText('Native Messages and generateContent payloads need their own adapters')
  await settings.getByRole('tab', { name: 'Walrus Memory', exact: true }).click()
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveCount(0)
  await expect(settings.getByRole('button', { name: 'Verify & connect Walrus', exact: true })).toBeDisabled()
  await settings.getByRole('button', { name: 'Connect Tatum first', exact: true }).click()
  await expect(settings.getByRole('tab', { name: 'Tatum', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(settings.getByLabel('Delegate private key', { exact: true })).toHaveCount(0)
  await settings.getByRole('tab', { name: 'Advanced', exact: true }).click()
  await expect(settings).toContainText('Embedding configuration is separate')
  await expect(settings).toContainText('separate operator OPENAI_API_KEY')
  expect(JSON.stringify(await cachedValues(page))).not.toContain('synthetic-unsubmitted-provider-key')
  checkErrors()
})

test('discovery never verifies generation and capability results apply only to the checked model', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  const fixture = await connectedFixture(page, { connection: syntheticConnection({ verified: true, verification: null }) })
  const conversation = page.getByRole('region', { name: 'Agent conversation', exact: true })
  await expect(conversation.getByText('Generation not verified', { exact: true })).toBeVisible()
  const settings = await openSettings(page)
  await settings.getByRole('button', { name: 'Verify model', exact: true }).click()
  await expect(settings.getByText('Generation verified', { exact: true })).toBeVisible()
  await expect(settings.getByText('Not checked', { exact: true })).toHaveCount(2)
  await settings.getByText('Verification & tool options', { exact: true }).click()
  await settings.getByRole('checkbox', { name: 'Also check streaming & enabled tools', exact: true }).check()
  Object.assign(fixture.capabilities, { streaming: 'unsupported', tools: 'failed',
    streamingError: { code: 'provider_streaming_unsupported', message: 'Synthetic endpoint does not support streaming.' },
    toolsError: { code: 'provider_invalid_response', message: 'Synthetic model did not return the requested function call.' } })
  await settings.getByRole('button', { name: 'Verify model', exact: true }).click()
  await expect(settings.getByText('Unsupported', { exact: true })).toBeVisible()
  await expect(settings.getByText('Check failed', { exact: true })).toBeVisible()
  await expect(settings.getByText('Generation verified', { exact: true })).toBeVisible()
  expect(fixture.mutations().map(request => request.body)).toEqual([
    { connectionId: 'synthetic-provider', checkCapabilities: false, toolsEnabled: true }, { connectionId: 'synthetic-provider', checkCapabilities: true, toolsEnabled: true },
  ])
  await settings.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('combobox', { name: 'Model for this turn' }).selectOption('synthetic-provider|synthetic-discovered-only')
  await expect(conversation.getByText('Generation not verified', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Model for this turn' }).selectOption('synthetic-provider|synthetic-exact-model')
  await expect(conversation.getByText('Generation verified', { exact: true })).toBeVisible()
  checkErrors()
})

test('a failed model replacement preserves the saved connection but a failed recheck clears its verified indicator', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  const fixture = await connectedFixture(page)
  const settings = await openSettings(page)
  await settings.getByRole('button', { name: 'Reconnect model', exact: true }).click()
  const replacementKey = 'synthetic-replacement-model-key'
  await settings.getByLabel('Model API key', { exact: true }).fill(replacementKey)
  fixture.catalog.models.push('synthetic-unavailable-model')
  await chooseProviderModel(settings, 'synthetic-unavailable-model')
  fixture.failNext('/connect', 'provider_model_unavailable', `Synthetic replacement rejected: ${replacementKey}. Copy the exact account model ID.`)
  await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
  await expect(settings.getByRole('alert')).toContainText('provider_model_unavailable')
  await expect(settings.getByRole('alert')).toContainText('[REDACTED]')
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue(replacementKey)
  await expect(settings.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('synthetic-unavailable-model')
  await expect(settings.getByText('Generation verified', { exact: true })).toBeVisible()
  expect(fixture.state.connection.model).toBe('synthetic-exact-model')
  fixture.failNext('/verify', 'provider_invalid_key', 'The saved session model key was rejected. Reconnect with a valid provider key.')
  await settings.getByRole('button', { name: 'Verify model', exact: true }).click()
  await expect(settings.getByRole('alert')).toContainText('provider_invalid_key')
  await expect(settings.getByText('Last check failed', { exact: true })).toBeVisible()
  await expect(settings.getByText('Generation verified', { exact: true })).toHaveCount(0)
  expect(fixture.mutations().at(-1)).toMatchObject({ path: '/verify', body: { checkCapabilities: false, toolsEnabled: true } })
  await settings.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue('synthetic-provider|synthetic-exact-model')
  expect(JSON.stringify(await cachedValues(page))).not.toContain(replacementKey)
  checkErrors()
})

test('settings expose separate safe key, approval, model, protocol, billing and network failures', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page)
  await signIn(page)
  const fixture = await installConnectionFixture(page)
  const settings = await openSettings(page)
  const cases = [
    ['provider_invalid_key', 'The API key was rejected. Check the selected provider.'],
    ['provider_client_unapproved', 'This client is not approved. Ask the provider to allow RecallLoop; never impersonate another client.'],
    ['provider_model_unavailable', 'The model ID is unavailable for this account or endpoint.'],
    ['provider_protocol_unsupported', 'The API base URL or protocol is not supported.'],
    ['provider_quota', 'Quota, credits, or billing are unavailable. Check the dashboard.'],
    ['provider_network', 'The model request could not reach the provider. Check DNS or proxy.'],
  ]
  for (const [code, error] of cases) {
    await settings.getByLabel('Model API key', { exact: true }).fill('synthetic-failing-provider-key')
    await chooseProviderModel(settings, 'synthetic-model')
    fixture.failNext('/connect', code, error)
    await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
    await expect(settings.getByRole('alert')).toContainText(code)
    await expect(settings.getByRole('alert')).toContainText(error)
    await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue('synthetic-failing-provider-key')
    await expect(settings.getByRole('button', { name: 'Connect & verify model', exact: true })).toBeEnabled()
    await expect(settings.getByText('Generation verified', { exact: true })).toHaveCount(0)
  }
  checkErrors()
})

for (const action of ['cancel', 'close']) {
  test(`${action} during a committed model response refreshes saved status rather than assuming rollback`, async ({ page }) => {
    const checkErrors = failOnPageErrors(page)
    await installWallet(page)
    await signIn(page)
    const fixture = await installConnectionFixture(page)
    const settings = await openSettings(page)
    const hold = fixture.holdNext('/connect')
    try {
      await settings.getByLabel('Model API key', { exact: true }).fill('synthetic-cancellation-race-key')
      fixture.catalog.models.push(`synthetic-${action}-race-model`)
      await chooseProviderModel(settings, `synthetic-${action}-race-model`)
      await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
      await hold.started.promise
      await expect(settings.getByRole('button', { name: 'Connect & verify model', exact: true })).toBeDisabled()
      await settings.getByRole('button', { name: action === 'cancel' ? 'Cancel check' : 'Close & cancel check', exact: true }).click()
      if (action === 'cancel') {
        await expect(settings.getByText('Generation verified', { exact: true })).toBeVisible()
        await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue('synthetic-cancellation-race-key')
        await expect(settings.getByRole('button', { name: 'Cancel check', exact: true })).toHaveCount(0)
        await settings.getByRole('button', { name: 'Done', exact: true }).click()
      }
      await expect(settings).toBeHidden()
      await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue(`${fixture.state.connection.id}|synthetic-${action}-race-model`)
      await expect(page.getByRole('region', { name: 'Agent conversation' }).getByText('Generation verified', { exact: true })).toBeVisible()
      expect(fixture.requests.some(request => request.path === '/status')).toBe(true)
      expect(fixture.mutations()).toHaveLength(1)
      expect(JSON.stringify(await cachedValues(page))).not.toContain('synthetic-cancellation-race-key')
      checkErrors()
    } finally { hold.release.resolve() }
  })
}

test('late settings completions and retired wallet callbacks cannot change a newer wallet workspace', async ({ page, context }) => {
  const checkErrors = failOnPageErrors(page)
  const [a] = await installWallet(page)
  await signIn(page)
  const fixture = await installConnectionFixture(page)
  const settings = await openSettings(page)
  const hold = fixture.holdNext('/connect')
  const oldTag = (await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())).sessionTag
  const statusRequests = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/agent/status') statusRequests.push(request.headers()['x-recallloop-session']) })
  try {
    await settings.getByLabel('Model API key', { exact: true }).fill('synthetic-retired-wallet-model-key')
    fixture.catalog.models.push('synthetic-retired-wallet-model')
    await chooseProviderModel(settings, 'synthetic-retired-wallet-model')
    await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
    await hold.started.promise
    const b = Ed25519Keypair.generate()
    const other = await context.newPage()
    await installWallet(other, [b])
    await other.goto('/#/agent')
    await leaveSession(other)
    await signIn(other)
    statusRequests.length = 0
    await page.evaluate(() => window.dispatchEvent(new Event('recallloop-auth-changed')))
    await expect(settings).toBeHidden()
    await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue('')
    await page.evaluate(() => { window.recallloopFireRetiredWalletChange(); window.recallloopDisconnectWallet() })
    const current = await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
    expect(current.address).toBe(b.toSuiAddress())
    expect(current.address).not.toBe(a.toSuiAddress())
    expect(statusRequests).not.toContain(oldTag)
    expect(JSON.stringify(await cachedValues(page))).not.toContain('synthetic-retired-wallet-model-key')
    checkErrors()
  } finally { hold.release.resolve() }
})

test('model, Tatum and Walrus verify or disconnect independently, with explicit dependent authorization removal', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  const fixture = await connectedFixture(page, { tatum: true, memory: true })
  const settings = await openSettings(page)
  await settings.getByRole('button', { name: 'Disconnect model', exact: true }).click()
  await expect(settings.getByText('No model connected', { exact: true })).toBeVisible()
  expect(fixture.state).toMatchObject({ connection: { mode: 'unconfigured' }, tatum: true, memory: true })
  await settings.getByRole('tab', { name: 'Tatum', exact: true }).click()
  await settings.getByRole('button', { name: 'Verify Tatum', exact: true }).click()
  // Progress and completion can coexist while the parent refreshes status.
  // Target the intended result rather than assuming only one live region.
  await expect(settings.getByRole('status').filter({ hasText: 'fresh Sui Mainnet checkpoint' })).toBeVisible()
  await settings.getByRole('tab', { name: 'Walrus Memory', exact: true }).click()
  await settings.getByRole('button', { name: 'Verify Walrus', exact: true }).click()
  await expect(settings.getByRole('status').filter({ hasText: 'No memory was written' })).toBeVisible()
  await settings.getByRole('button', { name: 'Disconnect Walrus', exact: true }).click()
  await expect(settings.getByLabel('Delegate private key', { exact: true })).toBeVisible()
  expect(fixture.state).toMatchObject({ connection: { mode: 'unconfigured' }, tatum: true, memory: false })
  await settings.getByLabel('Delegate private key', { exact: true }).fill('1'.repeat(64))
  await settings.getByRole('button', { name: 'Verify & connect Walrus', exact: true }).click()
  await expect(settings.getByText('Owner & delegate verified', { exact: true })).toBeVisible()
  await settings.getByRole('tab', { name: 'Advanced', exact: true }).click()
  await expect(settings).toContainText('Auto-memory can still use a live Walrus connection and incur costs')
  await settings.getByRole('button', { name: 'Use scripted mock model', exact: true }).click()
  await expect(settings.getByRole('status').filter({ hasText: 'Memory mode is unchanged' })).toBeVisible()
  expect(fixture.state).toMatchObject({ connection: { mode: 'mock' }, tatum: true, memory: true })
  await settings.getByRole('tab', { name: 'Tatum', exact: true }).click()
  await settings.getByRole('button', { name: 'Disconnect Tatum & Walrus', exact: true }).click()
  await expect(settings.getByLabel('Tatum API key', { exact: true })).toBeVisible()
  expect(fixture.state).toMatchObject({ connection: { mode: 'mock' }, tatum: false, memory: false })
  await settings.getByRole('tab', { name: 'Walrus Memory', exact: true }).click()
  await expect(settings.getByRole('button', { name: 'Verify & connect Walrus', exact: true })).toBeDisabled()
  await expect(settings.getByRole('button', { name: 'Connect Tatum first', exact: true })).toBeVisible()
  expect(fixture.mutations().filter(request => ['/connections/tatum/verify', '/connections/memwal/verify'].includes(request.path)).map(request => request.body)).toEqual([{}, {}])
  expect(fixture.mutations().some(request => request.path.startsWith('/memory/') || request.path === '/remember')).toBe(false)
  checkErrors()
})

test('multiple account profiles with the same model stay distinct across tab switches, verification and targeted disconnection', async ({ page, context }) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page); await signIn(page)
  const fixture = await installConnectionFixture(page), settings = await openSettings(page), profiles = []
  for (const name of ['Work', 'Personal']) {
    if (profiles.length) await settings.getByRole('button', { name: 'Add provider', exact: true }).click()
    await settings.getByLabel('Model API key', { exact: true }).fill(`SYNTHETIC_${name.toUpperCase()}_PROFILE_KEY`)
    await chooseProviderModel(settings, 'synthetic-model')
    await settings.getByText('Advanced connection options', { exact: true }).click()
    await settings.getByLabel('Profile name (optional)', { exact: true }).fill(name)
    const refresh = profiles.length ? fixture.holdNext('/status') : null
    try {
      await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
      if (refresh) {
        await refresh.started.promise
        await expect(settings.getByRole('status').filter({ hasText: 'Generation verified.' })).toBeVisible()
        // The new choice is saved before its profile reaches the picker. A
        // delayed catalogue must eventually select that exact account.
        await expect(page.locator('#agent-model')).toHaveValue(`${profiles[0]}|synthetic-model`)
      }
    } finally { refresh?.release.resolve() }
    await expect(settings.getByRole('button', { name: 'Reconnect model', exact: true })).toBeEnabled()
    profiles.push(fixture.state.connection.id)
  }
  expect(new Set(profiles).size).toBe(2)
  expect(fixture.state.modelConnections.map(profile => profile.name)).toEqual(['Work', 'Personal'])
  await settings.getByRole('button', { name: 'Done', exact: true }).click()
  const picker = page.getByRole('combobox', { name: 'Model for this turn', exact: true })
  await expect(picker).toHaveValue(`${profiles[1]}|synthetic-model`)
  await expect(picker.locator('optgroup')).toHaveCount(2)
  await picker.selectOption(`${profiles[0]}|synthetic-model`)
  const auth = await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  const calls = await page.evaluate(() => window.recallloopWalletCalls)
  const other = await context.newPage()
  try {
    await other.goto('about:blank')
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.bringToFront()
    await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) })
    await expect(picker).toHaveValue(`${profiles[0]}|synthetic-model`)
    expect(await page.evaluate(() => window.recallloopWalletCalls)).toEqual(calls)
    expect((await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())).sessionTag).toBe(auth.sessionTag)
    await openSettings(page)
    await settings.getByLabel('Connected provider profile', { exact: true }).selectOption(profiles[0])
    await settings.getByRole('button', { name: 'Verify model', exact: true }).click()
    await expect(settings.getByRole('button', { name: 'Verify model', exact: true })).toBeEnabled()
    expect(fixture.mutations().at(-1).body.connectionId).toBe(profiles[0])
    await settings.getByRole('button', { name: 'Disconnect model', exact: true }).click()
    await expect(settings.getByLabel('Connected provider profile', { exact: true })).toHaveValue(profiles[1])
    expect(fixture.mutations().at(-1).body).toEqual({ connectionId: profiles[0] })
    expect(fixture.state.modelConnections.map(profile => profile.id)).toEqual([profiles[1]])
    await settings.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(picker).toHaveValue(`${profiles[1]}|synthetic-model`)
    await page.reload()
    await expect(picker).toHaveValue(`${profiles[1]}|synthetic-model`)
    expect(JSON.stringify(await cachedValues(page))).not.toMatch(/SYNTHETIC_(?:WORK|PERSONAL)_PROFILE_KEY/)
    checkErrors()
  } finally { await other.close() }
})

test('OpenRouter catalogue pricing labels render only supplied free metadata, and a failed connection retains its selected free model', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page); await signIn(page)
  const fixture = await installConnectionFixture(page), settings = await openSettings(page)
  fixture.catalog.models = [{ id: 'zero-priced', label: 'zero-priced', cost: 'provider-free', tools: false }, { id: 'named:free', label: 'named:free' }]
  await settings.getByLabel('Provider', { exact: true }).selectOption('openrouter')
  const key = 'SYNTHETIC_FREE_CATALOGUE_KEY'
  await settings.getByLabel('Model API key', { exact: true }).fill(key)
  await chooseProviderModel(settings, 'zero-priced')
  const options = settings.getByRole('combobox', { name: 'Model', exact: true }).locator('option')
  await expect(options.nth(1)).toHaveText('zero-priced · Free (provider limits) · No tools advertised')
  await expect(options.nth(2)).toHaveText('named:free')
  fixture.failNext('/connect', 'provider_quota', 'Synthetic credit or spending limit; check the account budget.')
  await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
  await expect(settings.getByRole('alert')).toContainText('provider_quota')
  await expect(settings.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('zero-priced')
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue(key)
  expect(fixture.state.modelConnections).toEqual([])
  expect(JSON.stringify(await cachedValues(page))).not.toContain(key)
  checkErrors()
})

for (const provider of [
  { id: 'huggingface', baseUrl: 'https://router.huggingface.co/v1', status: 402, upstream: 'Payment required', code: 'provider_quota', hint: 'Free accounts have no included inference credits', theme: 'dark', width: 1440 },
  { id: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', status: 400, upstream: 'Invalid JSON payload. Unknown name "parameter".', code: 'provider_parameters_unsupported', hint: 'Gemini rejected a request parameter', theme: 'light', width: 390 },
  { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', status: 402, upstream: 'Payment required', code: 'provider_quota', hint: 'OpenRouter credits or a spending limit', theme: 'dark', width: 320 },
]) test(`${provider.id} discovery can succeed before generation fails; actionable help, credentials and model selection survive for retry`, async ({ page }, testInfo) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page); await signIn(page)
  await page.setViewportSize({ width: provider.width, height: 844 })
  if (await page.locator('html').getAttribute('data-theme') !== provider.theme) await page.getByRole('button', { name: `Switch to ${provider.theme} theme`, exact: true }).click()
  const fixture = await installConnectionFixture(page), settings = await openSettings(page)
  const key = `SYNTHETIC_${provider.id.toUpperCase()}_ERROR_KEY`
  await settings.getByLabel('Provider', { exact: true }).selectOption(provider.id)
  await settings.getByLabel('Model API key', { exact: true }).fill(key)
  await chooseProviderModel(settings, 'synthetic-model')
  expect(fixture.state.modelConnections).toEqual([])
  const failure = providerFailure(provider.status, `${provider.upstream} ${key} PRIVATE_UPSTREAM_PROMPT`, provider.baseUrl)
  fixture.failNext('/connect', failure.code, failure.message)
  await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
  await expect(settings.getByRole('alert')).toContainText(provider.code)
  await expect(settings.getByRole('alert')).toContainText(provider.hint)
  await expect(settings.getByRole('alert')).not.toContainText('PRIVATE_UPSTREAM_PROMPT')
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue(key)
  await expect(settings.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('synthetic-model')
  await expect(settings.getByRole('button', { name: 'Connect & verify model', exact: true })).toBeEnabled()
  await expect(settings.getByText('Generation verified', { exact: true })).toHaveCount(0)
  if (provider.id === 'huggingface') {
    await expect(settings.getByRole('link', { name: 'Billing & credits', exact: true })).toHaveAttribute('href', 'https://huggingface.co/settings/billing')
    await expect(settings.getByRole('link', { name: 'Inference pricing', exact: true })).toHaveAttribute('href', 'https://huggingface.co/docs/inference-providers/pricing')
  } else if (provider.id === 'gemini') {
    await expect(settings.getByRole('link', { name: 'Gemini troubleshooting', exact: true })).toBeVisible()
    await expect(settings.getByText(/This compatibility layer accepts system messages/)).toBeVisible()
    await expect(settings.getByText(/native generateContent API uses systemInstruction/)).toBeVisible()
    await settings.getByText('Advanced connection options', { exact: true }).click()
    await expect(settings.getByLabel('API base URL', { exact: true })).toHaveValue(provider.baseUrl)
    await expect(settings.getByLabel('API protocol', { exact: true })).toHaveValue('chat')
  }
  await settings.getByRole('alert').scrollIntoViewIfNeeded()
  expect(await settings.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath(`${provider.id}-generation-help-${provider.width}-${provider.theme}.png`), animations: 'disabled' })
  expect(fixture.mutations()).toHaveLength(1)
  expect(fixture.state.modelConnections).toEqual([])
  expect(JSON.stringify(await cachedValues(page))).not.toContain(key)
  await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
  await expect(settings.getByText('Generation verified', { exact: true })).toBeVisible()
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveCount(0)
  expect(fixture.mutations()).toHaveLength(2)
  expect(fixture.state.connection.model).toBe('synthetic-model')
  checkErrors()
})
