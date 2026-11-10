import { defineConfig } from '@playwright/test'
import base from './playwright.config.mjs'

const port = process.env.PLAYWRIGHT_BUILDER_PORT || '3118'
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  ...base,
  testDir: './browser/local-builder',
  testIgnore: [],
  outputDir: '.playwright/builder-test-results',
  reporter: [['list'], ['html', { outputFolder: '.playwright/builder-report', open: 'never' }]],
  use: { ...base.use, baseURL },
  webServer: {
    ...base.webServer,
    command: 'node browser/local-builder/server.mjs',
    url: `${baseURL}/api/health`,
    env: { ...base.webServer.env, PORT: port },
  },
})
