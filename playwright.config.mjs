import { defineConfig } from '@playwright/test'

const port = process.env.PLAYWRIGHT_PORT || '3117'
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './browser',
  testMatch: '**/*.pw.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: '.playwright/test-results',
  reporter: [['list'], ['html', { outputFolder: '.playwright/report', open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/index.mjs --demo',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { HOST: '127.0.0.1', PORT: port, NODE_ENV: 'development', RECALLLOOP_WORKSPACE_TOKEN: '',
      RECALLLOOP_REQUIRE_WORKSPACE_AUTH: '', RECALLLOOP_ALLOWED_ORIGINS: '', RECALLLOOP_CAPTURE_MODE: 'both', AGENT_LLM_EXTRA_HEADERS: '' },
  },
})
