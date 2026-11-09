import { test, expect } from './harness.mjs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { installWallet, signIn, openSettings, leaveSession, cachedValues, failOnPageErrors } from './helpers.mjs'
import { installConnectionFixture, syntheticConnection } from './fixtures.mjs'

async function connectedFixture(page, options = {}) {
  await installWallet(page)
  await signIn(page)
  const fixture = await installConnectionFixture(page, { connection: syntheticConnection(), ...options })
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue(fixture.state.connection.model)
  return fixture
}

test('provider presets populate official bases and protocols without guessing model IDs or sharing credentials', async ({ page }, testInfo) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page)
  await signIn(page)
  const settings = await openSettings(page)
  await expect(settings.getByLabel('Provider', { exact: true })).toHaveValue('agentrouter')
  await expect(settings.getByLabel('API base URL', { exact: true })).toBeHidden()
  await expect(settings.getByLabel('Model ID', { exact: true })).toHaveValue('')
  await expect(settings).toContainText('RecallLoop approval is not established')
  await expect(settings.getByRole('link', { name: 'Get an API key' })).toHaveAttribute('href', 'https://ps.air-outer.com/console/token')
  await page.screenshot({ path: testInfo.outputPath('agentrouter-settings-dark.png') })
  const presets = [
    ['openai', 'https://api.openai.com/v1', 'responses', 'https://developers.openai.com/api/docs/models'],
    ['openrouter', 'https://openrouter.ai/api/v1', 'chat', 'https://openrouter.ai/models'],
    ['groq', 'https://api.groq.com/openai/v1', 'chat', 'https://console.groq.com/docs/models'],
    ['deepseek', 'https://api.deepseek.com', 'chat', 'https://api-docs.deepseek.com/quick_start/pricing'],
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'chat', 'https://aistudio.google.com/docs/models'],
    ['ollama', 'http://127.0.0.1:11434/v1', 'chat', null],
  ]
  await settings.getByLabel('Model API key', { exact: true }).fill('synthetic-unsubmitted-provider-key')
  for (const [id, base, protocol, modelsUrl] of presets) {
    await settings.getByLabel('Provider', { exact: true }).selectOption(id)
    await expect(settings.getByLabel('Model ID', { exact: true })).toHaveValue('')
    await expect(settings.getByLabel(/^Model API key/)).toHaveValue('')
    await settings.getByText('Advanced connection options', { exact: true }).click()
    await expect(settings.getByLabel('API base URL', { exact: true })).toHaveValue(base)
    await expect(settings.getByLabel('API protocol', { exact: true })).toHaveValue(protocol)
    if (modelsUrl) await expect(settings.getByRole('link', { name: 'Available models' })).toHaveAttribute('href', modelsUrl)
  }
  await settings.getByLabel('Provider', { exact: true }).selectOption('custom')
  await expect(settings.getByLabel('API base URL', { exact: true })).toBeVisible()
  await expect(settings.getByLabel('API base URL', { exact: true })).toHaveValue('')
  await expect(settings).toContainText('Anthropic-native APIs are not supported')
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
    { checkCapabilities: false, toolsEnabled: true }, { checkCapabilities: true, toolsEnabled: true },
  ])
  await settings.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('combobox', { name: 'Model for this turn' }).selectOption('synthetic-discovered-only')
  await expect(conversation.getByText('Generation not verified', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Model for this turn' }).selectOption('synthetic-exact-model')
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
  await settings.getByLabel('Model ID', { exact: true }).fill('synthetic-unavailable-model')
  fixture.failNext('/connect', 'provider_model_unavailable', `Synthetic replacement rejected: ${replacementKey}. Copy the exact account model ID.`)
  await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
  await expect(settings.getByRole('alert')).toContainText('provider_model_unavailable')
  await expect(settings.getByRole('alert')).toContainText('[REDACTED]')
  await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue('')
  await expect(settings.getByText('Generation verified', { exact: true })).toBeVisible()
  expect(fixture.state.connection.model).toBe('synthetic-exact-model')
  fixture.failNext('/verify', 'provider_invalid_key', 'The saved session model key was rejected. Reconnect with a valid provider key.')
  await settings.getByRole('button', { name: 'Verify model', exact: true }).click()
  await expect(settings.getByRole('alert')).toContainText('provider_invalid_key')
  await expect(settings.getByText('Last check failed', { exact: true })).toBeVisible()
  await expect(settings.getByText('Generation verified', { exact: true })).toHaveCount(0)
  expect(fixture.mutations().at(-1)).toMatchObject({ path: '/verify', body: { checkCapabilities: false, toolsEnabled: true } })
  await settings.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue('synthetic-exact-model')
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
    await settings.getByLabel('Model ID', { exact: true }).fill('synthetic-model')
    fixture.failNext('/connect', code, error)
    await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
    await expect(settings.getByRole('alert')).toContainText(code)
    await expect(settings.getByRole('alert')).toContainText(error)
    await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue('')
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
      await settings.getByLabel('Model ID', { exact: true }).fill(`synthetic-${action}-race-model`)
      await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
      await hold.started.promise
      await expect(settings.getByRole('button', { name: 'Connect & verify model', exact: true })).toBeDisabled()
      await settings.getByRole('button', { name: action === 'cancel' ? 'Cancel check' : 'Close & cancel check', exact: true }).click()
      if (action === 'cancel') {
        await expect(settings.getByText('Generation verified', { exact: true })).toBeVisible()
        await expect(settings.getByLabel('Model API key', { exact: true })).toHaveValue('')
        await expect(settings.getByRole('button', { name: 'Cancel check', exact: true })).toHaveCount(0)
        await settings.getByRole('button', { name: 'Done', exact: true }).click()
      }
      await expect(settings).toBeHidden()
      await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue(`synthetic-${action}-race-model`)
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
    await settings.getByLabel('Model ID', { exact: true }).fill('synthetic-retired-wallet-model')
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
  await expect(settings).toContainText('existing live Walrus connection can still capture memory and incur costs')
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

test('a failed workspace token refresh is reported rather than claiming the tab was unlocked', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page)
  await signIn(page)
  const settings = await openSettings(page, 'Advanced')
  const key = 'synthetic-invalid-workspace-access-token'
  await page.route('**/api/agent/status', route => route.fulfill({ status: 403, json: { code: 'workspace_forbidden', error: 'Synthetic access token rejected.', retryable: false } }))
  await settings.getByLabel('Workspace bearer token', { exact: true }).fill(key)
  await settings.getByRole('button', { name: 'Unlock this tab', exact: true }).click()
  await expect(settings.getByRole('alert')).toContainText('Could not refresh workspace access')
  await expect(settings.getByLabel('Workspace bearer token', { exact: true })).toHaveValue('')
  await expect(settings.getByText('Workspace access token held in memory for this tab only.', { exact: true })).toHaveCount(0)
  expect(JSON.stringify(await cachedValues(page))).not.toContain(key)
  checkErrors()
})
