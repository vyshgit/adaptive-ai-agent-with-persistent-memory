import { test as base, expect } from '@playwright/test'
import { setTimeout as delay } from 'node:timers/promises'

// All browser contexts share the same loopback peer, and the suite uses one
// worker. Reserve a conservative per-test login budget before opening the UI,
// not while an API request is in flight: that would exceed the app's unchanged
// 25-second deadline. Requests, signatures, cookies and the server's real
// 12-sign-ins/minute policy are not intercepted or relaxed.
const RATE_WINDOW_MS = 60_500
const SIGN_IN_LIMIT = 12

export const test = base.extend({
  signInBudget: [3, { option: true }],
  signInAttempts: [async ({}, use, workerInfo) => {
    // Playwright restarts its worker after a failed test. The server survives,
    // so a replacement worker must let the previous rate window expire first.
    if (workerInfo.workerIndex > 0) await delay(RATE_WINDOW_MS)
    await use([])
  }, { scope: 'worker', timeout: 65_000 }],
  authRateWindow: [async ({ context, signInAttempts, signInBudget }, use, testInfo) => {
    if (!Number.isInteger(signInBudget) || signInBudget < 0 || signInBudget > SIGN_IN_LIMIT) throw new Error('Invalid browser sign-in budget.')
    const prune = () => {
      const expiredBefore = Date.now() - RATE_WINDOW_MS
      while (signInAttempts.length && signInAttempts[0] <= expiredBefore) signInAttempts.shift()
    }
    prune()
    while (signInAttempts.length + signInBudget > SIGN_IN_LIMIT) {
      const waitMs = Math.max(1, signInAttempts[0] + RATE_WINDOW_MS - Date.now())
      testInfo.setTimeout(testInfo.timeout + waitMs + 5_000)
      testInfo.annotations.push({ type: 'auth-rate-window', description: 'Harness paced this test before login; production limits and request deadlines are unchanged.' })
      await delay(waitMs)
      prune()
    }
    const pattern = /\/api\/agent\/auth\/(?:challenge|demo)$/
    let attempts = 0
    const record = request => {
      if (request.method() === 'POST' && pattern.test(new URL(request.url()).pathname)) {
        signInAttempts.push(Date.now())
        attempts++
      }
    }
    context.on('request', record)
    try { await use() }
    finally {
      context.off('request', record)
      if (attempts > signInBudget) throw new Error(`This test used ${attempts} sign-in attempts; increase its signInBudget from ${signInBudget}.`)
    }
  }, { auto: true }],
})

export { expect }
