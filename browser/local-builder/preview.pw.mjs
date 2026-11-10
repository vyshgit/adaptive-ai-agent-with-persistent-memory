import { test, expect } from './harness.mjs'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { localDemo, view, api } from './helpers.mjs'
import { failOnPageErrors, leaveSession } from '../helpers.mjs'

test.use({ signInBudget: 1 })

test('Chromium executes snapshot modules but blocks parent/storage access, fetches, external assets, popups and top navigation; revocation and logout kill its capability', async ({ page }, testInfo) => {
  const checkErrors = failOnPageErrors(page), probes = []
  const probe = createServer((req, res) => { probes.push(req.url); res.end('not reachable from the preview') })
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  try {
    const { directory } = await localDemo(page)
    const attack = `http://127.0.0.1:${probe.address().port}/blocked`
    const app = new URL(page.url()).origin
    await writeFile(path.join(directory, 'dist', 'index.html'), '<h1>Isolated static fixture</h1><pre id="checks">waiting</pre><script type="module" src="./app.js"></script>')
    await writeFile(path.join(directory, 'dist', 'app.js'), `
      const checks = { module: true };
      try { parent.document.body.dataset.previewOwned = 'bad'; checks.parent = 'bad' } catch { checks.parent = 'blocked' }
      try { localStorage.setItem('preview-leak', 'bad'); checks.storage = 'bad' } catch { checks.storage = 'blocked' }
      try { await fetch(${JSON.stringify(attack)}); checks.fetch = 'bad' } catch { checks.fetch = 'blocked' }
      try { await fetch(${JSON.stringify(`${app}/api/agent/status`)}); checks.api = 'bad' } catch { checks.api = 'blocked' }
      checks.popup = window.open(${JSON.stringify(attack)}) === null ? 'blocked' : 'bad';
      try { top.location.href = ${JSON.stringify(attack)}; checks.top = 'bad' } catch { checks.top = 'blocked' }
      const image = new Image(); image.src = ${JSON.stringify(attack)}; document.body.append(image);
      const frame = document.createElement('iframe'); frame.src = ${JSON.stringify(attack)}; document.body.append(frame);
      const form = document.createElement('form'); form.action = ${JSON.stringify(attack)}; document.body.append(form); form.submit();
      document.getElementById('checks').textContent = JSON.stringify(checks);
    `)
    await view(page, 'Preview')
    const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/agent/builder/preview' && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Create static preview', exact: true }).click()
    const snapshot = await (await created).json()
    const iframe = page.getByTitle('Local static preview', { exact: true })
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    expect(new URL(snapshot.url).origin).not.toBe(app)
    const frame = page.frameLocator('iframe[title="Local static preview"]')
    await expect(frame.locator('#checks')).not.toHaveText('waiting')
    expect(JSON.parse(await frame.locator('#checks').innerText())).toEqual({ module: true, parent: 'blocked', storage: 'blocked', fetch: 'blocked', api: 'blocked', popup: 'blocked', top: 'blocked' })
    expect(probes).toEqual([])
    expect(page.url()).toContain('/#/agent')
    expect(await page.locator('body').getAttribute('data-preview-owned')).toBeNull()
    const response = await fetch(snapshot.url)
    expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'")
    expect(response.headers.has('set-cookie')).toBe(false)
    await writeFile(path.join(directory, 'dist', 'index.html'), '<h1>Later disk artifact</h1>')
    expect(await (await fetch(snapshot.url)).text()).toContain('Isolated static fixture')
    await page.screenshot({ path: testInfo.outputPath('isolated-local-preview.png') })
    await page.getByRole('button', { name: 'Revoke preview', exact: true }).click()
    await expect(iframe).toHaveCount(0)
    await expect.poll(async () => (await fetch(snapshot.url)).status).toBe(404)
    await expect(page.getByRole('button', { name: 'Create static preview', exact: true })).toBeEnabled()
    const again = page.waitForResponse(response => new URL(response.url()).pathname === '/api/agent/builder/preview' && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Create static preview', exact: true }).click()
    const next = await (await again).json()
    await expect(page.frameLocator('iframe[title="Local static preview"]').getByRole('heading', { name: 'Later disk artifact', exact: true })).toBeVisible()
    await leaveSession(page)
    expect((await fetch(next.url)).status).toBe(404)
    expect((await api(page, '/builder/status')).status).toBe(401)
    checkErrors()
  } finally { const closed = new Promise(resolve => probe.close(resolve)); probe.closeAllConnections(); await closed }
})
