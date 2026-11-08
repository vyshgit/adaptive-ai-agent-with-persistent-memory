import { expect } from '@playwright/test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { readFile } from 'node:fs/promises'

// Test-only Wallet Standard registration. Private keys stay in the test runner;
// the real API still verifies an actual signature over its issued challenge.
export async function installWallet(page, pairs = [Ed25519Keypair.generate()]) {
  await page.exposeBinding('recallloopTestSign', async (_source, { address, message }) => {
    const pair = pairs.find(pair => pair.toSuiAddress() === address)
    if (!pair) throw new Error('Unknown synthetic wallet account')
    return pair.signPersonalMessage(new Uint8Array(message))
  })
  await page.addInitScript(({ accounts }) => {
    const listeners = new Set()
    let connected = []
    const wallet = {
      version: '1.0.0',
      name: 'Synthetic Sui wallet (test only)',
      icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
      chains: ['sui:mainnet'],
      get accounts() { return connected },
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: connected = accounts }) },
        'standard:events': { version: '1.0.0', on: (_event, listener) => { listeners.add(listener); return () => listeners.delete(listener) } },
        'sui:signPersonalMessage': { version: '1.1.0', signPersonalMessage: async ({ account, message }) => {
          window.recallloopSignedMessages.push(new TextDecoder().decode(message))
          return window.recallloopTestSign({ address: account.address, message: Array.from(message) })
        } },
      },
    }
    window.recallloopSignedMessages = []
    window.recallloopDisconnectWallet = () => { connected = []; for (const listener of listeners) listener({ accounts: [] }) }
    const register = api => api.register(wallet)
    window.addEventListener('wallet-standard:app-ready', event => register(event.detail))
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }))
  }, { accounts: pairs.map((pair, index) => ({ address: pair.toSuiAddress(), publicKey: pair.getPublicKey().toRawBytes(),
    chains: ['sui:mainnet'], features: ['sui:signPersonalMessage'], label: `Synthetic account ${index + 1}` })) })
  return pairs
}

export async function signIn(page) {
  await page.goto('/#/agent')
  await page.getByRole('button', { name: 'Connect & sign in', exact: true }).click()
  await expect(page.getByText('Wallet workspace · Talk / Plan / Build', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toBeVisible()
}

export async function demo(page) {
  await page.goto('/#/agent')
  await page.getByRole('button', { name: 'Try offline demo', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Model for this turn' })).toHaveValue('recallloop-mock')
}

export async function send(page, text) {
  await page.getByRole('textbox', { name: 'Message the coding agent' }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden()
  const assistant = page.locator('article').last()
  await expect(assistant.getByRole('button', { name: 'Record outcome', exact: true })).toBeVisible()
  return assistant
}

export async function newSession(page) {
  await page.locator('header').first().getByRole('button', { name: /^New(?: session)?$/ }).click()
  await expect(page.locator('article')).toHaveCount(0)
}

export async function downloadedText(page, action) {
  const promise = page.waitForEvent('download')
  await action()
  const download = await promise
  expect(await download.failure()).toBeNull()
  return { name: download.suggestedFilename(), text: await readFile(await download.path(), 'utf8') }
}

export async function cachedValues(page) {
  return page.evaluate(() => [...Array(localStorage.length)].map((_, i) => [localStorage.key(i), localStorage.getItem(localStorage.key(i))]))
}

export async function holdCacheTimers(page) {
  // Keep autosave pending without pausing animation frames or API deadlines.
  // The regression must exercise navigation flushing, not wait out the debounce.
  await page.addInitScript(() => {
    const schedule = window.setTimeout.bind(window)
    window.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 350 ? 60_000 : delay, ...args)
  })
}

export function failOnPageErrors(page) {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  return () => expect(errors).toEqual([])
}
