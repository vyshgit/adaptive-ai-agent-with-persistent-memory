import { test, expect } from './harness.mjs'
import { demo, send, setCapture, newSession, cachedValues, failOnPageErrors } from './helpers.mjs'
import { scopedCacheKey } from '../src/agent/clientSafety.ts'
import { workspaceCacheScope } from '../src/agent/workspaceCache.ts'
import { createSession, SESSION_KEY } from '../src/agent/sessionStore.ts'

const draft = page => page.getByRole('textbox', { name: 'Message RecallLoop', exact: true })
const latestQuestion = page => page.locator('article').last().getByRole('region', { name: 'Clarification', exact: true })

test('trip planning recalls departure before asking for dates, preserves the paused workflow on reload, and stages replies without sending', async ({ page }, testInfo) => {
  const checkErrors = failOnPageErrors(page)
  const requests = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/agent/chat') requests.push(request.postDataJSON()) })
  await demo(page)
  await expect(page.getByRole('button', { name: 'Talk', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByText('Turn options', { exact: false }).click()
  await page.getByRole('checkbox', { name: 'Stream', exact: true }).uncheck()
  await page.getByText('Turn options', { exact: false }).click()
  await setCapture(page)
  await send(page, 'My departure city is London. I prefer short trips and EUR prices.')
  await newSession(page)
  const beforeSuggestion = requests.length
  await page.getByRole('button', { name: 'Plan a short trip', exact: false }).click()
  await expect(draft(page)).toHaveValue(/Plan a quick trip to Alaska/)
  expect(requests.length).toBe(beforeSuggestion)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden()
  const article = page.locator('article').last()
  await expect(article.getByRole('region', { name: 'Working plan', exact: true })).toContainText('Proposed steps, not completed actions')
  await expect(latestQuestion(page)).toContainText('What dates and length should this trip cover?')
  await expect(latestQuestion(page)).toContainText('London from saved context')
  await expect(article).toContainText('Needs your reply')
  await expect(article.getByRole('button', { name: /^Review \d+ change/ })).toHaveCount(0)
  const scroll = page.getByRole('region', { name: 'Agent conversation', exact: true }).locator('div.workspace-scroll').first()
  await scroll.evaluate(node => { node.scrollTop = 0 })
  await page.screenshot({ path: testInfo.outputPath('trip-working-plan-desktop-dark.png') })
  await latestQuestion(page).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('trip-clarification-desktop-dark.png') })
  await page.reload()
  await expect(latestQuestion(page)).toContainText('London from saved context')
  await expect(page.locator('article').last().getByRole('region', { name: 'Working plan', exact: true })).toBeVisible()
  const cached = JSON.stringify(await cachedValues(page))
  expect(cached).toContain('What dates and length should this trip cover?')
  const before = requests.length
  await latestQuestion(page).getByRole('button', { name: 'Next weekend, for 3 days.', exact: true }).click()
  await expect(draft(page)).toHaveValue('Next weekend, for 3 days.')
  await expect(draft(page)).toBeFocused()
  expect(requests.length).toBe(before)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden()
  const result = page.locator('article').last()
  await expect(result).toContainText('Departure: London')
  await expect(result).toContainText('No live travel facts were checked, no booking was made')
  await expect(result).toContainText('Reply ready')
  expect(requests.at(-1).history.some(message => message.role === 'assistant' && message.content.includes('What dates and length should this trip cover?'))).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('trip-draft-result-desktop-dark.png') })
  checkErrors()
})

test('missing departure prompts a keyboard-accessible reply, preserves existing drafts, and stays reachable on short mobile screens', async ({ page }, testInfo) => {
  const checkErrors = failOnPageErrors(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await demo(page)
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await setCapture(page, { facts: false })
  await send(page, 'Plan a quick trip to Alaska.')
  const first = latestQuestion(page)
  await expect(first).toContainText('Which city will you depart from for this trip?')
  await expect(first.getByRole('button')).toHaveCount(1)
  await first.getByRole('button', { name: 'Write a reply', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(draft(page)).toBeFocused()
  await expect(draft(page)).toHaveValue('')
  await draft(page).fill('I depart from Paris.')
  await draft(page).press('Enter')
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden()
  await expect(latestQuestion(page)).toContainText('What dates and length should this trip cover?')
  await expect(page.locator('article').nth(1)).toContainText('Earlier clarification')
  await page.screenshot({ path: testInfo.outputPath('trip-clarification-mobile-dark.png') })
  await page.setViewportSize({ width: 320, height: 480 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  const choice = latestQuestion(page).getByRole('button', { name: 'Next weekend, for 3 days.', exact: true })
  await choice.scrollIntoViewIfNeeded()
  const box = await choice.boundingBox()
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(481)
  await page.screenshot({ path: testInfo.outputPath('trip-clarification-short-mobile-dark.png') })
  await draft(page).fill('Keep it short.')
  await choice.click()
  await expect(draft(page)).toHaveValue('Keep it short.\nNext weekend, for 3 days.')
  await expect(draft(page)).toBeFocused()
  await draft(page).press('Enter')
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden()
  await expect(page.locator('article').last()).toContainText('Departure: Paris')
  await expect(page.locator('article').last()).toContainText('Auto-memory is off for this turn')
  expect((await page.evaluate(async () => (await (await fetch('/api/agent/memory', { headers: { 'X-RecallLoop-Session': (await (await fetch('/api/agent/auth/session')).json()).sessionTag } })).json()))).inventory.total).toBe(0)
  checkErrors()
})

test('a long cached clarification preserves its task and question when a real reply continues through the server', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  const requests = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/agent/chat') requests.push(request.postDataJSON()) })
  await demo(page)
  const auth = await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  const task = 'Plan a quick trip to Alaska.'
  const question = 'Which city will you depart from for this trip?'
  // A cached long reply is a history-budget fixture, not generated model output
  // or memory evidence. The continuation uses the real isolated mock route.
  const session = { ...createSession('recallloop-mock'), title: 'Long clarification fixture', messages: [
    { id: 'long-task', role: 'user', content: task, createdAt: '2026-11-09T03:00:00Z', status: 'complete' },
    { id: 'long-reply', role: 'assistant', content: `${'A long planning explanation. '.repeat(1200)}\n${question}`,
      createdAt: '2026-11-09T03:00:01Z', status: 'complete',
      plan: { id: 'long-plan', summary: 'Confirm the trip context', steps: ['Confirm departure and dates before drafting the trip.'] },
      question: { id: 'long-question', question, why: 'The departure city is missing.', options: [] },
      stored: { skipped: true, verbatim: 0, facts: 0, failed: 0, blobs: [] } },
  ] }
  await page.addInitScript(({ key, session }) => { sessionStorage.setItem(key, JSON.stringify({ version: 2, sessions: [session] })) },
    { key: scopedCacheKey(SESSION_KEY, workspaceCacheScope(auth.agentId, auth.sessionTag)), session })
  await page.reload()
  await expect(latestQuestion(page)).toContainText(question)
  await setCapture(page, { facts: false })
  await send(page, 'I depart from London.')
  await expect(latestQuestion(page)).toContainText('What dates and length should this trip cover?')
  await expect(latestQuestion(page)).toContainText('London from your reply')
  expect(requests).toHaveLength(1)
  expect(requests[0].history[0]).toEqual({ role: 'user', content: task })
  expect(requests[0].history[1].content.length).toBeLessThanOrEqual(4000)
  expect(requests[0].history[1].content).toContain(question)
  expect(requests[0].history[1].content).toContain('Working plan (proposed steps, not completed actions)')
  await expect(page.locator('article').last()).toContainText('Auto-memory is off for this turn')
  checkErrors()
})

test('workflow rendering fixtures keep plans proposed, render hostile metadata literally, and never execute or auto-submit a reply', async ({ page }) => {
  const checkErrors = failOnPageErrors(page)
  const remote = [], chats = []
  await page.route('https://workflow-tracker.invalid/**', route => { remote.push(route.request().url()); return route.abort() })
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/agent/chat') chats.push(request.url()) })
  await demo(page)
  const auth = await page.evaluate(async () => (await fetch('/api/agent/auth/session')).json())
  // Cache fixtures prove rendering only, not generated plans or Walrus evidence.
  const option = '<script>window.recallloopWorkflowExecuted = 1</script>'
  const session = { ...createSession('recallloop-mock'), title: 'Workflow rendering fixture', messages: [{
    id: 'literal-workflow', role: 'assistant', content: 'Rendering fixture only.', createdAt: '2026-11-08T16:00:00Z', status: 'complete',
    plan: { id: 'literal-plan', summary: '**Proposed**, not executed', steps: ['Book tickets only after current verification and separate approval.'] },
    question: { id: 'literal-question', question: '<img src="https://workflow-tracker.invalid/pixel"> Which date?', options: [option], selected: option },
    tools: [{ id: 'blocked', name: 'remember', status: 'blocked', preview: 'Not run: waiting for your reply.' }],
    stored: { skipped: true, verbatim: 0, facts: 0, failed: 0, blobs: [] },
  }] }
  await page.addInitScript(({ key, session }) => { sessionStorage.setItem(key, JSON.stringify({ version: 2, sessions: [session] })) },
    { key: scopedCacheKey(SESSION_KEY, workspaceCacheScope(auth.agentId, auth.sessionTag)), session })
  await page.reload()
  const article = page.locator('article').last()
  await expect(article.getByRole('region', { name: 'Working plan', exact: true })).toContainText('**Proposed**, not executed')
  await expect(article.getByRole('region', { name: 'Working plan', exact: true }).locator('strong')).toHaveCount(0)
  await expect(latestQuestion(page)).toContainText('<img src=')
  await expect(latestQuestion(page).locator('script, img, iframe, a')).toHaveCount(0)
  await latestQuestion(page).getByRole('button', { name: option, exact: true }).click()
  await expect(draft(page)).toHaveValue(option)
  expect(chats).toEqual([])
  expect(remote).toEqual([])
  expect(await page.evaluate(() => window.recallloopWorkflowExecuted)).toBeUndefined()
  await article.getByText('Activity · 1 bounded call', { exact: true }).click()
  await expect(article.getByText('Not run', { exact: true })).toBeVisible()
  await expect(article.getByRole('button', { name: /^Review \d+ change/ })).toHaveCount(0)
  checkErrors()
})
