import { test as base, expect } from '../harness.mjs'
import { api } from './helpers.mjs'

// A closed browser context is not an authenticated logout. End the actual
// test login after every scenario so workspaces, previews and workers cannot
// leak into the next test or force us to weaken the four-workspace limit.
export const test = base.extend({
  localSessionCleanup: [async ({ page }, use) => {
    try { await use() }
    finally {
      if (!page.isClosed()) {
        const ended = await api(page, '/auth/logout', {})
        expect([200, 401]).toContain(ended.status)
      }
    }
  }, { auto: true, timeout: 45_000 }],
})

export { expect }
