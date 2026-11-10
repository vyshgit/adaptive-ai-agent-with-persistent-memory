import { expect } from '@playwright/test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { readFile } from 'node:fs/promises'

// Test-only Wallet Standard registration. Private keys stay in the test runner;
// the real API still verifies an actual signature over its issued challenge.
export async function installWallet(page, pairs = [Ed25519Keypair.generate()], { onConnect, onSign, onDisconnect, withDisconnect = false } = {}) {
  await page.exposeBinding('recallloopTestConnect', async () => { await onConnect?.() })
  await page.exposeBinding('recallloopTestExtensionDisconnect', async () => { await onDisconnect?.() })
  await page.exposeBinding('recallloopTestSign', async (_source, { address, message }) => {
    await onSign?.({ address, message })
    const pair = pairs.find(pair => pair.toSuiAddress() === address)
    if (!pair) throw new Error('Unknown synthetic wallet account')
    return pair.signPersonalMessage(new Uint8Array(message))
  })
  await page.addInitScript(({ accounts, withDisconnect }) => {
    const listeners = new Set()
    const retired = []
    let connected = []
    window.recallloopWalletBehavior = { connectError: '', signError: '', disconnectError: '' }
    window.recallloopWalletCalls = { connect: 0, sign: 0, disconnect: 0 }
    const emitDisconnect = () => { connected = []; for (const listener of listeners) listener({ accounts: [] }) }
    const wallet = {
      version: '1.0.0',
      name: 'Synthetic Sui wallet (test only)',
      icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
      chains: ['sui:mainnet'],
      get accounts() { return connected },
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => {
          window.recallloopWalletCalls.connect++
          if (window.recallloopWalletBehavior.connectError) throw new Error(window.recallloopWalletBehavior.connectError)
          await window.recallloopTestConnect()
          return { accounts: connected = accounts }
        } },
        'standard:events': { version: '1.0.0', on: (_event, listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener); retired.push(listener) }
        } },
        'sui:signPersonalMessage': { version: '1.1.0', signPersonalMessage: async ({ account, message }) => {
          window.recallloopWalletCalls.sign++
          if (window.recallloopWalletBehavior.signError) throw new Error(window.recallloopWalletBehavior.signError)
          window.recallloopSignedMessages.push(new TextDecoder().decode(message))
          return window.recallloopTestSign({ address: account.address, message: Array.from(message) })
        } },
      },
    }
    if (withDisconnect) wallet.features['standard:disconnect'] = { version: '1.0.0', disconnect: async () => {
      window.recallloopWalletCalls.disconnect++
      await window.recallloopTestExtensionDisconnect()
      if (window.recallloopWalletBehavior.disconnectError) throw new Error(window.recallloopWalletBehavior.disconnectError)
      emitDisconnect()
    } }
    window.recallloopSignedMessages = []
    window.recallloopDisconnectWallet = emitDisconnect
    // Deliberately call listeners after unsubscription to model an already queued
    // extension callback; retired wallet workspaces must ignore it.
    window.recallloopFireRetiredWalletChange = () => { for (const listener of retired) listener({ accounts: [] }) }
    const register = api => api.register(wallet)
    window.addEventListener('wallet-standard:app-ready', event => register(event.detail))
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }))
  }, { withDisconnect, accounts: pairs.map((pair, index) => ({ address: pair.toSuiAddress(), publicKey: pair.getPublicKey().toRawBytes(),
    chains: ['sui:mainnet'], features: ['sui:signPersonalMessage'], label: `Synthetic account ${index + 1}` })) })
  return pairs
}

export async function signIn(page, accountAddress) {
  await page.goto('/#/agent')
  await page.getByRole('button', { name: 'Connect Wallet', exact: true }).click()
  if (accountAddress) {
    await page.getByRole('combobox', { name: 'Sui account', exact: true }).selectOption(accountAddress)
    await page.getByRole('button', { name: 'Sign in with this account', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: 'Wallet session details', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toBeVisible()
}

export async function openSettings(page, section = 'Model') {
  const dialog = page.getByRole('dialog', { name: 'Workspace settings', exact: true })
  if (!await dialog.isVisible()) await page.getByRole('button', { name: 'Workspace settings', exact: true }).click()
  await dialog.getByRole('tab', { name: section, exact: true }).click()
  return dialog
}

export async function chooseProviderModel(settings, model) {
  await settings.getByRole('button', { name: /^(?:Load|Refresh) models$/ }).click()
  const select = settings.getByRole('combobox', { name: 'Model', exact: true })
  await expect(select).toBeEnabled()
  await select.selectOption(model)
  await expect(settings.getByRole('button', { name: 'Connect & verify model', exact: true })).toBeEnabled()
}

export async function openPanel(page, panel = 'project') {
  const mobile = page.getByRole('combobox', { name: 'Workspace view', exact: true })
  const labels = { project: 'Files', review: /^Review(?: \(\d+\))?$/, memory: 'Memory' }
  const tabs = page.getByRole('tablist', { name: 'Workspace panels', exact: true })
  if (await mobile.isVisible()) await mobile.selectOption(panel)
  else if (await tabs.isVisible()) await tabs.getByRole('tab', { name: labels[panel], exact: true }).click()
  else await page.getByRole('group', { name: 'Workspace tools', exact: true }).getByRole('button', { name: labels[panel], exact: true }).click()
  const region = page.getByRole('complementary', { name: 'Project and memory panels', exact: true })
  await expect(region).toBeVisible()
  return region
}

export async function leaveSession(page) {
  await page.getByRole('button', { name: /^(?:Wallet|Demo) session details$/ }).click()
  await page.getByRole('dialog', { name: /^(?:Wallet session|Offline demo session)$/ }).getByRole('button', { name: /^(?:Disconnect wallet|Leave offline demo)$/ }).click()
  await expect(page.getByRole('region', { name: 'Wallet sign-in', exact: true })).toBeVisible()
}

export async function demo(page) {
  await page.goto('/#/agent')
  await page.getByRole('button', { name: 'Try offline demo', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue('recallloop-mock')
}

export async function send(page, text) {
  await page.getByRole('textbox', { name: 'Message RecallLoop' }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden()
  const assistant = page.locator('article').last()
  await expect(assistant.getByRole('button', { name: 'Record outcome', exact: true })).toBeVisible()
  return assistant
}

export async function setCapture(page, { facts = true, raw = false } = {}) {
  const options = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Turn options' }) })
  const wasOpen = await options.getAttribute('open') !== null
  if (!wasOpen) await options.locator('summary').click()
  await page.getByRole('checkbox', { name: 'Auto-memory', exact: true }).setChecked(facts)
  if (facts) await options.getByRole('checkbox', { name: 'Also save raw chat', exact: true }).setChecked(raw)
  if (!wasOpen) await options.locator('summary').click()
}

export async function newSession(page) {
  await page.locator('header').first().getByRole('button', { name: 'New session', exact: true }).click()
  await expect(page.locator('article')).toHaveCount(0)
}

export function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

export async function downloadedText(page, action) {
  const promise = page.waitForEvent('download')
  await action()
  const download = await promise
  expect(await download.failure()).toBeNull()
  return { name: download.suggestedFilename(), text: await readFile(await download.path(), 'utf8') }
}

export async function cachedValues(page, area = null) {
  return page.evaluate(area => (area ? [area] : ['sessionStorage', 'localStorage']).flatMap(name => {
    const storage = window[name]
    return [...Array(storage.length)].map((_, i) => [`${name}:${storage.key(i)}`, storage.getItem(storage.key(i))])
  }), area)
}

export async function holdCacheTimers(page) {
  // Keep autosave pending without pausing animation frames or API deadlines.
  // The regression must exercise navigation flushing, not wait out the debounce.
  await page.addInitScript(() => {
    const schedule = window.setTimeout.bind(window)
    const queued = []
    window.setTimeout = (callback, delay, ...args) => {
      const timer = schedule(callback, delay === 350 ? 60_000 : delay, ...args)
      if (delay === 350) queued.push({ callback, args, timer })
      return timer
    }
    // Replay even cancelled callbacks to model an autosave already queued before
    // logout teardown. Revoked cache leases, not timer cancellation, must win.
    window.recallloopFireDeferredCacheCallbacks = () => {
      for (const { callback, args, timer } of queued.splice(0)) {
        clearTimeout(timer)
        if (typeof callback === 'function') callback(...args)
      }
    }
  })
}

export function failOnPageErrors(page) {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  return () => expect(errors).toEqual([])
}
