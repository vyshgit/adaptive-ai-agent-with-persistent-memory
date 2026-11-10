import { test, expect } from './harness.mjs'
import { demo, failOnPageErrors } from './helpers.mjs'
import { scopedCacheKey } from '../src/agent/clientSafety.ts'
import { workspaceCacheScope } from '../src/agent/workspaceCache.ts'
import { createSession, SESSION_KEY } from '../src/agent/sessionStore.ts'

// These are bounded cached-message fixtures, not generated model responses or
// Walrus storage evidence. Reload still exercises the normal scoped cache loader.
async function loadMessages(page, messages) {
  await demo(page)
  const auth = await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  const session = { ...createSession('recallloop-mock'), title: 'Markdown rendering fixture', messages }
  await page.addInitScript(({ key, session }) => {
    sessionStorage.setItem(key, JSON.stringify({ version: 2, sessions: [session] }))
  }, { key: scopedCacheKey(SESSION_KEY, workspaceCacheScope(auth.agentId, auth.sessionTag)), session })
  await page.reload()
  await expect(page.locator('article')).toHaveCount(messages.length)
}

const message = (id, content, overrides = {}) => ({ id, role: 'assistant', content, model: 'recallloop-mock',
  createdAt: '2026-11-08T16:00:00Z', status: 'complete', stored: { skipped: true, verbatim: 0, facts: 0, failed: 0, blobs: [] }, ...overrides })

test('agent Markdown renders headings, lists, emphasis, tables, links and exact fenced code without hiding citations or review controls', async ({ page }, testInfo) => {
  const checkErrors = failOnPageErrors(page)
  const code = 'export function greet(name: string) {\n  return name.trim() || "Hello"\n}\n'
  const content = ['# Proposed fix', '', 'Use **TypeScript**, *small changes*, and `greet(name)`.', '',
    '## Steps', '', '1. Validate the input.', '2. Return a fallback.', '', '- Keep the change small.', '- Review before applying.', '',
    '| Case | Result |', '| --- | --- |', '| Empty name | Hello |', '| Trimmed name | Greeting |', '',
    '```ts', code.trimEnd(), '```', '', '> No commands run automatically.', '',
    '~~Old behavior~~ is replaced after review. [Walrus docs](https://docs.wal.app/walrus-memory/).'].join('\n')
  await loadMessages(page, [message('synthetic-formatted-message', content, {
    memory: { strategy: 'mock-lexical', tokenEstimate: 4, memories: [{ blobId: 'mock-markdown-citation', text: '', distance: 0.1, tier: 'facts' }] },
    proposals: [{ id: 'synthetic-markdown-proposal', path: 'src/greet.ts', before: null, after: code, baseHash: '', status: 'pending', reason: 'Rendering fixture only; not an instruction to apply.' }],
  })])
  const article = page.locator('article').first()
  await article.getByRole('heading', { name: 'Proposed fix', level: 3 }).scrollIntoViewIfNeeded()
  await expect(article.getByRole('heading', { name: 'Proposed fix', level: 3 })).toBeVisible()
  await expect(article.getByRole('heading', { name: 'Steps', level: 4 })).toBeVisible()
  await expect(article.locator('strong')).toHaveText('TypeScript')
  await expect(article.locator('em')).toHaveText('small changes')
  await expect(article.locator('ol > li')).toHaveCount(2)
  await expect(article.locator('.workspace-markdown > ul > li')).toHaveCount(2)
  await expect(article.getByRole('columnheader')).toHaveText(['Case', 'Result'])
  await expect(article.getByRole('cell', { name: 'Hello', exact: true })).toBeVisible()
  await expect(article.locator('pre code')).toHaveText(code)
  await expect(article.locator('blockquote')).toHaveText('No commands run automatically.')
  await expect(article.locator('del')).toHaveText('Old behavior')
  await expect(article.getByRole('link', { name: 'Walrus docs', exact: true })).toHaveAttribute('href', 'https://docs.wal.app/walrus-memory/')
  await expect(article.getByRole('link', { name: 'Walrus docs', exact: true })).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(article.getByRole('button', { name: 'Review 1 change', exact: true })).toBeVisible()
  await article.getByText('Recalled 1 mock memory', { exact: false }).click()
  await expect(article.getByRole('button', { name: 'Copy blob ID', exact: true })).toBeVisible()
  await expect(article).toContainText('Cached citation only')
  await page.screenshot({ path: testInfo.outputPath('formatted-agent-response-dark.png') })
  await article.getByRole('button', { name: 'Review 1 change', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('formatted-agent-code-and-controls-dark.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await article.locator('pre').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('formatted-agent-response-mobile-dark.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await article.getByRole('heading', { name: 'Proposed fix', level: 3 }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('formatted-agent-response-light.png') })
  checkErrors()
})

test('untrusted Markdown cannot execute HTML, fetch images or open unsafe links, and partial code fences remain readable', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  const remoteRequests = []
  await page.route('https://markdown-tracker.invalid/**', route => { remoteRequests.push(route.request().url()); return route.abort() })
  const hostile = ['# Safe text', '', '[Unsafe link](javascript:window.recallloopMarkdownExecuted=1)', '',
    '[Encoded scheme](jav&#x61;script:alert(1))', '', '[Embedded HTML](data:text/html,unsafe)', '',
    '[Credential URL](https://synthetic-user:synthetic-password@example.com)', '', '[Local API path](/api/agent/auth/logout)', '',
    '![Tracking pixel](https://markdown-tracker.invalid/pixel.gif)', '',
    '<script>window.recallloopMarkdownExecuted = 1</script>', '',
    '<img src="https://markdown-tracker.invalid/html.png" onerror="window.recallloopMarkdownExecuted = 1">', '',
    '<svg onload="window.recallloopMarkdownExecuted = 1"></svg>', '',
    '```html', '<script>literal code, never executed</script>', '```'].join('\n')
  await loadMessages(page, [message('synthetic-user-raw', '## Keep my prompt literal\n**not formatting**', { role: 'user', stored: undefined }),
    message('synthetic-hostile-markdown', hostile),
    message('synthetic-partial-markdown', '## Partial answer\n\n```ts\nexport const greeting = "still readable"\n', { status: 'stopped', stored: undefined })])
  const articles = page.locator('article')
  await expect(articles.nth(0)).toContainText('## Keep my prompt literal\n**not formatting**')
  await expect(articles.nth(0).getByRole('heading')).toHaveCount(0)
  await expect(articles.nth(1).getByRole('heading', { name: 'Safe text', exact: true })).toBeVisible()
  await expect(articles.nth(1).locator('a')).toHaveCount(0)
  await expect(articles.nth(1).locator('.workspace-markdown').locator('script, style, img, svg, iframe, object, embed, form')).toHaveCount(0)
  await expect(articles.nth(1).locator('pre code')).toHaveText('<script>literal code, never executed</script>\n')
  await expect(articles.nth(1)).toContainText('Tracking pixel] · not loaded')
  expect(await page.evaluate(() => window.recallloopMarkdownExecuted)).toBeUndefined()
  expect(remoteRequests).toEqual([])
  await expect(articles.nth(2).getByRole('heading', { name: 'Partial answer', exact: true })).toBeVisible()
  await expect(articles.nth(2).locator('pre code')).toHaveText('export const greeting = "still readable"\n')
  await expect(articles.nth(2).getByText('Stopped · partial answer', { exact: true })).toBeVisible()
  await expect(articles.nth(2).getByRole('button', { name: 'Retry this turn', exact: true })).toBeVisible()
  checkErrors()
})
