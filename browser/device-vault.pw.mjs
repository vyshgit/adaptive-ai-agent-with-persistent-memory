import { test, expect } from './harness.mjs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { installWallet, signIn, demo, openSettings, chooseProviderModel, leaveSession, cachedValues, failOnPageErrors } from './helpers.mjs'
import { installConnectionFixture, SYNTHETIC_ACCOUNT_ID } from './fixtures.mjs'
import { DEVICE_VAULT_PREFIX, deviceVaultKey } from '../src/agent/deviceVault.ts'

// Real browser cryptography and signed wallet login; connection verification is
// intercepted with synthetic fixtures. No live provider, chain or relayer calls.
const passphrase = 'Synthetic browser vault passphrase 2026 only!'
const modelKey = 'SYNTHETIC_VAULT_MODEL_KEY_ONLY_2026'
const tatumKey = 'SYNTHETIC_VAULT_TATUM_KEY_ONLY_2026'
const delegateKey = '7'.repeat(64)
const exactModel = 'synthetic-vault-exact-model'
const connectionFields = {
  model: { section: 'Model', reconnect: 'Reconnect model', submit: 'Connect & verify model', success: 'Generation verified.' },
  tatum: { section: 'Tatum', reconnect: 'Reconnect Tatum', submit: 'Verify & connect Tatum', success: 'Tatum Mainnet checkpoint verified.' },
  walrus: { section: 'Walrus Memory', reconnect: 'Reconnect Walrus', submit: 'Verify & connect Walrus', success: 'Mainnet account owner and delegate authorization verified.' },
}
const panelFor = settings => settings.getByRole('region', { name: 'Encrypted device vault', exact: true })
const records = page => page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => [key, localStorage.getItem(key)]), DEVICE_VAULT_PREFIX)
const authSession = page => page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())

async function createVault(page) {
  const settings = await openSettings(page, 'Advanced'), panel = panelFor(settings)
  await panel.getByLabel('Device vault passphrase', { exact: true }).fill(passphrase)
  await panel.getByLabel('Confirm vault passphrase', { exact: true }).fill(passphrase)
  await panel.getByRole('checkbox', { name: 'I want encrypted credentials saved on this device', exact: true }).check()
  await panel.getByRole('button', { name: 'Create encrypted vault', exact: true }).click()
  await expect(panel).toContainText('Vault created.')
  await expect(panel).toContainText('Unlocked · this wallet session')
  return { settings, panel }
}

async function unlockVault(page) {
  const settings = await openSettings(page, 'Advanced'), panel = panelFor(settings)
  await panel.getByLabel('Device vault passphrase', { exact: true }).fill(passphrase)
  await panel.getByRole('button', { name: 'Unlock device vault', exact: true }).click()
  await expect(panel).toContainText('Vault unlocked locally.')
  await expect(panel).toContainText('Unlocked · this wallet session')
  return { settings, panel }
}

async function enterConnection(page, name, { save, key } = {}) {
  const fields = connectionFields[name], settings = await openSettings(page, fields.section)
  const reconnect = settings.getByRole('button', { name: fields.reconnect, exact: true })
  if (await reconnect.isVisible()) await reconnect.click()
  if (name === 'model') {
    await settings.getByLabel('Model API key', { exact: true }).fill(key || modelKey)
    await chooseProviderModel(settings, exactModel)
  } else if (name === 'tatum') await settings.getByLabel('Tatum API key', { exact: true }).fill(key || tatumKey)
  else {
    await settings.getByRole('textbox', { name: 'Walrus Memory account object ID', exact: true }).fill(SYNTHETIC_ACCOUNT_ID)
    await settings.getByLabel('Delegate private key', { exact: true }).fill(key || delegateKey)
  }
  const remember = settings.getByRole('checkbox', { name: 'Save this connection in device vault', exact: true })
  if (save !== undefined) await remember.setChecked(save)
  else if (await remember.isEnabled()) await expect(remember).toBeChecked()
  else await expect(remember).not.toBeChecked()
  return settings
}

async function verifyConnection(page, name, options) {
  const settings = await enterConnection(page, name, options)
  const saving = await settings.getByRole('checkbox', { name: 'Save this connection in device vault', exact: true }).isChecked()
  await settings.getByRole('button', { name: connectionFields[name].submit, exact: true }).click()
  await expect(settings).toContainText(saving ? 'An encrypted copy was saved in this wallet’s device vault.' : connectionFields[name].success)
  await expect(settings.getByRole('button', { name: 'Cancel check', exact: true })).toHaveCount(0)
  return settings
}

async function savedConnections(page, names = ['model', 'tatum', 'walrus']) {
  await createVault(page)
  for (const name of names) await verifyConnection(page, name)
  const settings = await openSettings(page, 'Advanced')
  await expect(panelFor(settings)).toContainText(`Saved connections: ${names.map(name => ({ model: 'Model', tatum: 'Tatum', walrus: 'Walrus' })[name]).join(', ')}`)
  return { settings, panel: panelFor(settings) }
}

async function noPlaintext(page, values = [passphrase, modelKey, tatumKey, delegateKey]) {
  const stored = JSON.stringify(await cachedValues(page))
  for (const value of values) expect(stored).not.toContain(value)
}

async function holdCrypto(page, method) {
  // Pause only the completion of one genuine WebCrypto operation, not its
  // algorithm. This exercises teardown after encryption/derivation has finished.
  await page.evaluate(method => {
    const original = SubtleCrypto.prototype[method]
    window.recallloopVaultCryptoPaused = false
    SubtleCrypto.prototype[method] = async function (...args) {
      SubtleCrypto.prototype[method] = original
      const result = await original.apply(this, args)
      const release = new Promise(resolve => { window.recallloopReleaseVaultCrypto = resolve })
      window.recallloopVaultCryptoPaused = true
      await release
      return result
    }
  }, method)
  return {
    started: () => expect.poll(() => page.evaluate(() => window.recallloopVaultCryptoPaused)).toBe(true),
    release: () => page.evaluate(() => window.recallloopReleaseVaultCrypto?.()),
  }
}

test('vault creation needs consent, then verified connections save encrypted by default with a per-connection opt-out', async ({ page }) => {
  const checkErrors = failOnPageErrors(page), bodies = []
  page.on('request', request => { if (request.postData()) bodies.push(request.postData()) })
  await installWallet(page)
  await signIn(page)
  const fixture = await installConnectionFixture(page)
  const model = await openSettings(page)
  await expect(model.getByRole('checkbox', { name: 'Save this connection in device vault', exact: true })).toBeDisabled()
  await verifyConnection(page, 'model')
  expect(await records(page)).toEqual([])
  const settings = await openSettings(page, 'Advanced'), panel = panelFor(settings)
  const consent = panel.getByRole('checkbox', { name: 'I want encrypted credentials saved on this device', exact: true })
  const create = panel.getByRole('button', { name: 'Create encrypted vault', exact: true })
  await expect(consent).not.toBeChecked()
  await panel.getByLabel('Device vault passphrase', { exact: true }).fill(passphrase)
  await panel.getByLabel('Confirm vault passphrase', { exact: true }).fill(passphrase)
  await expect(create).toBeDisabled()
  await consent.check()
  await panel.getByLabel('Confirm vault passphrase', { exact: true }).fill('A different synthetic passphrase only!')
  await expect(create).toBeDisabled()
  expect(await records(page)).toEqual([])
  await panel.getByLabel('Confirm vault passphrase', { exact: true }).fill(passphrase)
  const before = fixture.mutations().length
  await create.click()
  await expect(panel).toContainText('Vault created.')
  await expect(panel).toContainText('Saved connections: None yet.')
  expect(fixture.mutations()).toHaveLength(before)
  const encrypted = await records(page)
  expect(encrypted).toHaveLength(1)
  for (const name of ['model', 'tatum', 'walrus']) await verifyConnection(page, name)
  expect(await records(page)).not.toEqual(encrypted)
  await openSettings(page, 'Advanced')
  await expect(panel).toContainText('Saved connections: Model, Tatum, Walrus')
  const saved = await records(page)
  await verifyConnection(page, 'tatum', { save: false, key: 'SYNTHETIC_SESSION_ONLY_REPLACEMENT' })
  expect(await records(page)).toEqual(saved)
  expect(bodies.join('')).not.toContain(passphrase)
  await noPlaintext(page)
  checkErrors()
})

test('saved keys survive reload and a returning wallet login, but unlock is local and reconnection is explicitly verified in order', async ({ page }, testInfo) => {
  const checkErrors = failOnPageErrors(page), bodies = []
  page.on('request', request => { if (request.postData()) bodies.push(request.postData()) })
  await installWallet(page)
  await signIn(page)
  const auth = await authSession(page), fixture = await installConnectionFixture(page)
  const saved = await savedConnections(page), encrypted = await records(page)
  expect(encrypted[0][0]).toBe(deviceVaultKey(auth.agentId))
  await noPlaintext(page)
  await page.screenshot({ path: testInfo.outputPath('encrypted-device-vault.png') })
  await saved.settings.getByRole('button', { name: 'Done', exact: true }).click()
  fixture.setConnections([])
  Object.assign(fixture.state, { tatum: false, memory: false })
  await page.reload()
  await expect(page.getByRole('region', { name: 'Saved connection vault', exact: true })).toBeVisible()
  expect(fixture.mutations()).toHaveLength(3)
  await page.getByRole('button', { name: 'Unlock saved connections', exact: true }).click()
  const unlocked = await unlockVault(page)
  expect(fixture.mutations()).toHaveLength(3)
  const hold = fixture.holdNext('/connections/tatum')
  try {
    await unlocked.panel.getByRole('button', { name: 'Reconnect saved connections', exact: true }).click()
    await hold.started.promise
    expect(fixture.mutations().slice(3).map(request => request.path)).toEqual(['/connect', '/connections/tatum'])
    await expect(unlocked.panel.getByRole('button', { name: 'Reconnect saved connections', exact: true })).toBeDisabled()
    hold.release.resolve()
    await expect(unlocked.settings).toContainText('Walrus: verified in this wallet session.')
  } finally { hold.release.resolve() }
  const requests = fixture.mutations().slice(3)
  expect(requests.map(request => request.path)).toEqual(['/connect', '/connections/tatum', '/connections/memwal'])
  expect(requests[0].body).toMatchObject({ apiKey: modelKey, model: exactModel, checkCapabilities: false })
  expect(requests[1].body).toEqual({ apiKey: tatumKey })
  expect(requests[2].body).toEqual({ accountId: SYNTHETIC_ACCOUNT_ID, delegateKey })
  expect(requests.every(request => request.sessionTag === auth.sessionTag)).toBe(true)
  expect(await records(page)).toEqual(encrypted)
  await unlocked.settings.getByRole('button', { name: 'Done', exact: true }).click()
  await leaveSession(page)
  expect(await records(page)).toEqual(encrypted)
  await signIn(page)
  const returning = await installConnectionFixture(page)
  const next = await authSession(page)
  expect(next.sessionTag).not.toBe(auth.sessionTag)
  await expect(page.getByRole('button', { name: 'Unlock saved connections', exact: true })).toBeVisible()
  const ready = await unlockVault(page)
  expect(returning.mutations()).toEqual([])
  await ready.panel.getByRole('button', { name: 'Reconnect saved connections', exact: true }).click()
  await expect(ready.settings).toContainText('Walrus: verified in this wallet session.')
  expect(returning.mutations().map(request => request.path)).toEqual(['/connect', '/connections/tatum', '/connections/memwal'])
  expect(returning.mutations().every(request => request.sessionTag === next.sessionTag)).toBe(true)
  expect(bodies.join('')).not.toContain(passphrase)
  await noPlaintext(page)
  checkErrors()
})

test('encrypted profiles with duplicate model IDs reconnect using their own keys, and forgetting one preserves the other', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page); await signIn(page)
  const fixture = await installConnectionFixture(page), profiles = []
  await createVault(page)
  const settings = await openSettings(page)
  for (const name of ['Work', 'Personal']) {
    if (profiles.length) await settings.getByRole('button', { name: 'Add provider', exact: true }).click()
    const key = `SYNTHETIC_${name.toUpperCase()}_VAULT_PROFILE_KEY`
    await settings.getByLabel('Model API key', { exact: true }).fill(key)
    await chooseProviderModel(settings, exactModel)
    await settings.getByText('Advanced connection options', { exact: true }).click()
    await settings.getByLabel('Profile name (optional)', { exact: true }).fill(name)
    await expect(settings.getByRole('checkbox', { name: 'Save this connection in device vault', exact: true })).toBeChecked()
    await settings.getByRole('button', { name: 'Connect & verify model', exact: true }).click()
    await expect(settings).toContainText('An encrypted copy was saved in this wallet’s device vault.')
    await expect(settings.getByRole('button', { name: 'Reconnect model', exact: true })).toBeEnabled()
    profiles.push({ id: fixture.state.connection.id, name, key })
  }
  expect(new Set(profiles.map(profile => profile.id)).size).toBe(2)
  const encrypted = await records(page)
  await noPlaintext(page, [passphrase, ...profiles.map(profile => profile.key)])
  await settings.getByRole('button', { name: 'Done', exact: true }).click()
  fixture.setConnections([])
  await page.reload()
  const unlocked = await unlockVault(page)
  const savedProfiles = unlocked.panel.getByRole('list', { name: 'Saved provider profiles', exact: true })
  await expect(savedProfiles.getByRole('listitem')).toHaveCount(2)
  expect(fixture.mutations()).toHaveLength(2)
  for (const profile of [...profiles].reverse()) {
    const before = fixture.mutations().length
    await savedProfiles.getByRole('button', { name: `Reconnect saved ${profile.name}`, exact: true }).click()
    await expect(unlocked.settings.getByRole('status').filter({ hasText: `${profile.name}: verified in this wallet session.` })).toBeVisible()
    await expect(savedProfiles.getByRole('button', { name: `Reconnect saved ${profile.name}`, exact: true })).toBeEnabled()
    expect(fixture.mutations().slice(before)).toMatchObject([{ path: '/connect', body: {
      profileId: profile.id, profileName: profile.name, apiKey: profile.key, model: exactModel, checkCapabilities: false,
    } }])
  }
  expect(fixture.state.modelConnections.map(profile => profile.id).sort()).toEqual(profiles.map(profile => profile.id).sort())
  expect(await records(page)).toEqual(encrypted)
  const beforeForget = fixture.mutations().length
  await savedProfiles.getByRole('button', { name: 'Forget saved Work', exact: true }).click()
  await expect(unlocked.panel).toContainText('Saved provider profile removed.')
  await expect(savedProfiles.getByRole('listitem')).toHaveCount(1)
  await expect(savedProfiles).toContainText('Personal')
  expect(fixture.mutations()).toHaveLength(beforeForget)
  expect(fixture.state.modelConnections).toHaveLength(2)
  const remainingCopy = await records(page)
  expect(remainingCopy).not.toEqual(encrypted)
  await unlocked.settings.getByRole('button', { name: 'Done', exact: true }).click()
  fixture.setConnections([])
  await page.reload()
  const returning = await unlockVault(page)
  await expect(returning.panel.getByRole('button', { name: 'Reconnect saved Work', exact: true })).toHaveCount(0)
  await returning.panel.getByRole('button', { name: 'Reconnect saved connections', exact: true }).click()
  await expect(returning.settings.getByRole('status').filter({ hasText: 'Personal: verified in this wallet session.' })).toBeVisible()
  expect(fixture.mutations().slice(beforeForget)).toMatchObject([{ path: '/connect', body: { profileId: profiles[1].id, apiKey: profiles[1].key } }])
  expect(fixture.state.modelConnections.map(profile => profile.id)).toEqual([profiles[1].id])
  expect(await records(page)).toEqual(remainingCopy)
  await noPlaintext(page, [passphrase, ...profiles.map(profile => profile.key)])
  checkErrors()
})

test('failed verification or blocked encrypted writes never persist replacement keys and do not undo an already verified server connection', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page)
  await signIn(page)
  const fixture = await installConnectionFixture(page)
  await createVault(page)
  const empty = await records(page)
  fixture.failNext('/connect', 'synthetic_verification_failed', `SYNTHETIC_VERIFY_REJECTED ${modelKey}`)
  const failed = await enterConnection(page, 'model', { save: true })
  await failed.getByRole('button', { name: connectionFields.model.submit, exact: true }).click()
  await expect(failed.getByRole('alert')).toContainText('SYNTHETIC_VERIFY_REJECTED [REDACTED]')
  await expect(failed.getByLabel('Model API key', { exact: true })).toHaveValue(modelKey)
  await expect(failed.getByRole('checkbox', { name: 'Save this connection in device vault', exact: true })).toBeChecked()
  await expect(failed.getByRole('button', { name: connectionFields.model.submit, exact: true })).toBeEnabled()
  expect(await records(page)).toEqual(empty)
  await verifyConnection(page, 'model', { save: true })
  const saved = await records(page), replacement = 'SYNTHETIC_UNVERIFIED_REPLACEMENT_KEY_ONLY'
  fixture.failNext('/connect', 'synthetic_verification_failed', `REPLACEMENT_REJECTED ${replacement}`)
  const replacing = await enterConnection(page, 'model', { save: true, key: replacement })
  await replacing.getByRole('button', { name: connectionFields.model.submit, exact: true }).click()
  await expect(replacing.getByRole('alert')).toContainText('REPLACEMENT_REJECTED [REDACTED]')
  await expect(replacing.getByLabel('Model API key', { exact: true })).toHaveValue(replacement)
  expect(await records(page)).toEqual(saved)
  await page.evaluate(prefix => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key.startsWith(prefix)) throw new DOMException('Synthetic vault writes blocked', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  }, DEVICE_VAULT_PREFIX)
  const blocked = await enterConnection(page, 'tatum', { save: true })
  await blocked.getByRole('button', { name: connectionFields.tatum.submit, exact: true }).click()
  await expect(blocked.getByRole('alert')).toContainText('The connection verified, but its device copy was not saved.')
  await expect(blocked.getByLabel('Tatum API key', { exact: true })).toHaveValue(tatumKey)
  await expect(blocked).toContainText('Checkpoint verified')
  expect(fixture.state.tatum).toBe(true)
  expect(await records(page)).toEqual(saved)
  const advanced = await openSettings(page, 'Advanced')
  await expect(panelFor(advanced)).toContainText('Saved connections: Model')
  await noPlaintext(page, [passphrase, modelKey, tatumKey, replacement])
  checkErrors()
})

test('wrong passphrases and damaged ciphertext fail closed without connection requests, and damaged copies can still be explicitly forgotten', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page)
  await signIn(page)
  const fixture = await installConnectionFixture(page)
  const saved = await savedConnections(page, ['model'])
  await saved.settings.getByRole('button', { name: 'Done', exact: true }).click()
  await page.reload()
  const settings = await openSettings(page, 'Advanced'), panel = panelFor(settings)
  await expect(panel.getByLabel('Device vault passphrase', { exact: true })).toHaveValue('')
  await panel.getByLabel('Device vault passphrase', { exact: true }).fill('Incorrect synthetic browser passphrase!')
  await panel.getByRole('button', { name: 'Unlock device vault', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('passphrase is incorrect or the saved vault is damaged')
  await expect(panel.getByLabel('Device vault passphrase', { exact: true })).toHaveValue('')
  await expect(panel.getByRole('button', { name: 'Reconnect saved connections', exact: true })).toHaveCount(0)
  expect(fixture.mutations()).toHaveLength(1)
  await unlockVault(page)
  await panel.getByRole('button', { name: 'Lock device vault', exact: true }).click()
  const [[storageKey, raw]] = await records(page)
  await page.evaluate(({ storageKey, raw }) => {
    const record = JSON.parse(raw)
    record.ciphertext = (record.ciphertext[0] === 'A' ? 'B' : 'A') + record.ciphertext.slice(1)
    localStorage.setItem(storageKey, JSON.stringify(record))
  }, { storageKey, raw })
  await page.reload()
  const damaged = panelFor(await openSettings(page, 'Advanced'))
  await damaged.getByLabel('Device vault passphrase', { exact: true }).fill(passphrase)
  await damaged.getByRole('button', { name: 'Unlock device vault', exact: true }).click()
  await expect(damaged.getByRole('alert')).toContainText('No connections were loaded.')
  expect(fixture.mutations()).toHaveLength(1)
  await damaged.getByRole('button', { name: 'Forget saved connections', exact: true }).click()
  await damaged.getByRole('button', { name: 'Confirm forget saved connections', exact: true }).click()
  expect(await records(page)).toEqual([])
  await noPlaintext(page)
  checkErrors()
})

test('different wallets see only their own vault even with the same passphrase, and confirmed forgetting preserves other wallets and current connections', async ({ page }) => {
  const checkErrors = failOnPageErrors(page), pairs = [Ed25519Keypair.generate(), Ed25519Keypair.generate()]
  await installWallet(page, pairs)
  await signIn(page, pairs[0].toSuiAddress())
  const firstAuth = await authSession(page)
  await installConnectionFixture(page)
  const first = await savedConnections(page, ['model'])
  const firstCopy = await records(page)
  await first.settings.getByRole('button', { name: 'Done', exact: true }).click()
  await leaveSession(page)
  await signIn(page, pairs[1].toSuiAddress())
  const secondAuth = await authSession(page)
  await installConnectionFixture(page)
  await expect(page.getByRole('button', { name: 'Unlock saved connections', exact: true })).toHaveCount(0)
  const second = panelFor(await openSettings(page, 'Advanced'))
  await expect(second).toContainText('Off by default')
  await expect(second.getByRole('button', { name: 'Unlock device vault', exact: true })).toHaveCount(0)
  await createVault(page)
  await verifyConnection(page, 'tatum', { save: true })
  const secondCopy = (await records(page)).find(([key]) => key === deviceVaultKey(secondAuth.agentId))
  expect((await records(page)).find(([key]) => key === deviceVaultKey(firstAuth.agentId))).toEqual(firstCopy[0])
  await (await openSettings(page, 'Advanced')).getByRole('button', { name: 'Done', exact: true }).click()
  await leaveSession(page)
  await signIn(page, pairs[0].toSuiAddress())
  const returning = await installConnectionFixture(page), unlocked = await unlockVault(page)
  await expect(unlocked.panel).toContainText('Saved connections: Model')
  await expect(unlocked.panel).not.toContainText('Saved connections: Model, Tatum')
  await unlocked.panel.getByRole('button', { name: 'Reconnect saved connections', exact: true }).click()
  await expect(unlocked.settings).toContainText('AgentRouter: verified in this wallet session.')
  expect(returning.mutations().map(request => request.path)).toEqual(['/connect'])
  expect(returning.mutations()[0].body.apiKey).toBe(modelKey)
  await unlocked.panel.getByRole('button', { name: 'Forget saved connections', exact: true }).click()
  await expect(unlocked.panel).toContainText('no onchain delegate is revoked')
  await unlocked.panel.getByRole('button', { name: 'Cancel forget', exact: true }).click()
  expect(await records(page)).toHaveLength(2)
  await expect(unlocked.panel).toContainText('Encrypted · locked')
  await unlocked.panel.getByRole('button', { name: 'Forget saved connections', exact: true }).click()
  await unlocked.panel.getByRole('button', { name: 'Confirm forget saved connections', exact: true }).click()
  expect(await records(page)).toEqual([secondCopy])
  expect(returning.state.connection.verified).toBe(true)
  expect(returning.mutations().map(request => request.path)).toEqual(['/connect'])
  await noPlaintext(page)
  checkErrors()
})

test('closing or logout cancels unfinished cryptography, while tab switches and Settings closure preserve completed unlocks', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page)
  await signIn(page)
  await installConnectionFixture(page)
  const createHold = await holdCrypto(page, 'deriveKey')
  const settings = await openSettings(page, 'Advanced'), panel = panelFor(settings)
  await panel.getByLabel('Device vault passphrase', { exact: true }).fill(passphrase)
  await panel.getByLabel('Confirm vault passphrase', { exact: true }).fill(passphrase)
  await panel.getByRole('checkbox', { name: 'I want encrypted credentials saved on this device', exact: true }).check()
  try {
    await panel.getByRole('button', { name: 'Create encrypted vault', exact: true }).click()
    await createHold.started()
    await settings.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(settings).not.toBeVisible()
  } finally { await createHold.release() }
  expect(await records(page)).toEqual([])
  const saved = await savedConnections(page, ['model']), encrypted = await records(page)
  await saved.settings.getByRole('button', { name: 'Done', exact: true }).click()
  const reopened = await openSettings(page, 'Advanced')
  await expect(panelFor(reopened)).toContainText('Unlocked · this wallet session')
  await panelFor(reopened).getByRole('button', { name: 'Lock device vault', exact: true }).click()
  await reopened.getByRole('button', { name: 'Done', exact: true }).click()
  const decryptHold = await holdCrypto(page, 'decrypt')
  const unlocking = panelFor(await openSettings(page, 'Advanced'))
  await unlocking.getByLabel('Device vault passphrase', { exact: true }).fill(passphrase)
  try {
    await unlocking.getByRole('button', { name: 'Unlock device vault', exact: true }).click()
    await decryptHold.started()
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(unlocking).toContainText('Encrypting or unlocking on this device')
    await decryptHold.release()
    await expect(unlocking).toContainText('Vault unlocked locally.')
  } finally {
    await decryptHold.release()
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }
  await expect(unlocking.getByRole('button', { name: 'Reconnect saved connections', exact: true })).toBeEnabled()
  const encryptHold = await holdCrypto(page, 'encrypt'), connecting = await enterConnection(page, 'tatum', { save: true })
  try {
    await connecting.getByRole('button', { name: connectionFields.tatum.submit, exact: true }).click()
    await encryptHold.started()
    await connecting.getByRole('button', { name: 'Close & cancel check', exact: true }).click()
    await expect(connecting).not.toBeVisible()
    await leaveSession(page)
  } finally { await encryptHold.release() }
  expect(await records(page)).toEqual(encrypted)
  await expect(page.getByRole('region', { name: 'Wallet sign-in', exact: true })).toBeVisible()
  await noPlaintext(page)
  checkErrors()
})

test('saved reconnection redacts independent failures, skips Walrus after failed Tatum, and cancellation or logout stops later credential requests', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page)
  await signIn(page)
  const fixture = await installConnectionFixture(page), saved = await savedConnections(page)
  const encrypted = await records(page)
  fixture.failNext('/connect', 'synthetic_model_failed', `MODEL_REJECTED ${modelKey}`)
  fixture.failNext('/connections/tatum', 'synthetic_tatum_failed', `TATUM_REJECTED ${tatumKey}`)
  const start = fixture.mutations().length
  await saved.panel.getByRole('button', { name: 'Reconnect saved connections', exact: true }).click()
  await expect(saved.settings.getByRole('alert')).toContainText('MODEL_REJECTED [REDACTED]')
  await expect(saved.settings.getByRole('alert')).toContainText('TATUM_REJECTED [REDACTED]')
  await expect(saved.settings.getByRole('alert')).toContainText('Walrus: skipped.')
  expect(fixture.mutations().slice(start).map(request => request.path)).toEqual(['/connect', '/connections/tatum'])
  for (const logout of [false, true]) {
    const hold = fixture.holdNext('/connect'), before = fixture.mutations().length
    try {
      await saved.panel.getByRole('button', { name: 'Reconnect saved connections', exact: true }).click()
      await hold.started.promise
      if (logout) {
        await saved.settings.getByRole('button', { name: 'Close & cancel check', exact: true }).click()
        await expect(saved.settings).not.toBeVisible()
        await leaveSession(page)
      } else await saved.settings.getByRole('button', { name: 'Cancel check', exact: true }).click()
      hold.release.resolve()
      if (!logout) await expect(saved.settings).toContainText('Saved reconnection cancelled.')
      expect(fixture.mutations().slice(before).map(request => request.path)).toEqual(['/connect'])
      expect(await records(page)).toEqual(encrypted)
    } finally { hold.release.resolve() }
  }
  await noPlaintext(page)
  checkErrors()
})

test('confirmed forgetting in another tab locks the first vault and wins over its delayed encrypted write without disconnecting current APIs', async ({ page, context }) => {
  const checkErrors = failOnPageErrors(page)
  await installWallet(page)
  await signIn(page)
  const fixture = await installConnectionFixture(page), saved = await savedConnections(page, ['model'])
  await saved.settings.getByRole('button', { name: 'Done', exact: true }).click()
  const other = await context.newPage(), checkOtherErrors = failOnPageErrors(other)
  await other.goto('/#/agent')
  await expect(other.getByRole('button', { name: 'Wallet session details', exact: true })).toBeVisible()
  const otherFixture = await installConnectionFixture(other), otherPanel = panelFor(await openSettings(other, 'Advanced'))
  await page.bringToFront()
  await expect(panelFor(await openSettings(page, 'Advanced'))).toContainText('Unlocked · this wallet session')
  const encryptHold = await holdCrypto(page, 'encrypt'), connecting = await enterConnection(page, 'tatum', { save: true })
  try {
    await connecting.getByRole('button', { name: connectionFields.tatum.submit, exact: true }).click()
    await encryptHold.started()
    // DOM activation avoids focusing/hiding the first page: its lock must come
    // from the genuine cross-tab storage event, not a visibility simulation.
    await otherPanel.getByRole('button', { name: 'Forget saved connections', exact: true }).evaluate(button => button.click())
    await otherPanel.getByRole('button', { name: 'Confirm forget saved connections', exact: true }).evaluate(button => button.click())
    await expect.poll(() => records(page)).toEqual([])
    await encryptHold.release()
    await expect(connecting.getByRole('alert')).toContainText('The connection verified, but its device copy was not saved.')
    await expect(connecting).toContainText('Checkpoint verified')
    expect(fixture.state.tatum).toBe(true)
    expect(fixture.state.connection.verified).toBe(true)
    expect(await records(page)).toEqual([])
    expect(await records(other)).toEqual([])
    expect(otherFixture.mutations()).toEqual([])
    await noPlaintext(page)
    await noPlaintext(other)
    checkErrors(); checkOtherErrors()
  } finally { await encryptHold.release() }
})

test('unavailable browser storage disables the vault without breaking session-only model connections or creating plaintext fallback caches', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  await page.addInitScript(prefix => {
    const original = Storage.prototype.getItem
    Storage.prototype.getItem = function (key) {
      if (this === localStorage && key.startsWith(prefix)) throw new DOMException('Synthetic vault storage blocked', 'SecurityError')
      return original.call(this, key)
    }
  }, DEVICE_VAULT_PREFIX)
  await installWallet(page)
  await signIn(page)
  const fixture = await installConnectionFixture(page)
  const panel = panelFor(await openSettings(page, 'Advanced'))
  await expect(panel.getByRole('alert')).toContainText('Encrypted device storage is unavailable.')
  await expect(panel.getByLabel('Device vault passphrase', { exact: true })).toHaveCount(0)
  await verifyConnection(page, 'model')
  expect(fixture.state.connection.verified).toBe(true)
  expect(await records(page)).toEqual([])
  await noPlaintext(page)
  checkErrors()
})

test('the demo cannot save credentials, and vault controls remain labelled and usable in a narrow mobile workspace', async ({ page }, testInfo) => {
  const checkErrors = failOnPageErrors(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await installWallet(page)
  await demo(page)
  const demoSettings = await openSettings(page, 'Advanced'), demoPanel = panelFor(demoSettings)
  await expect(demoPanel).toContainText('It is unavailable in the offline demo.')
  await expect(demoPanel.getByRole('button', { name: 'Create encrypted vault', exact: true })).toHaveCount(0)
  expect(await records(page)).toEqual([])
  await demoSettings.getByRole('button', { name: 'Done', exact: true }).click()
  await leaveSession(page)
  await signIn(page)
  await installConnectionFixture(page)
  const saved = await savedConnections(page, ['model'])
  await expect(saved.panel.getByRole('button', { name: 'Reconnect saved connections', exact: true })).toBeEnabled()
  const bounds = await saved.settings.boundingBox()
  expect(bounds.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await saved.panel.getByRole('button', { name: 'Lock device vault', exact: true }).click()
  const input = saved.panel.getByLabel('Device vault passphrase', { exact: true })
  await input.focus()
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('type', 'password')
  await page.screenshot({ path: testInfo.outputPath('device-vault-mobile-locked.png') })
  await unlockVault(page)
  await noPlaintext(page)
  checkErrors()
})
