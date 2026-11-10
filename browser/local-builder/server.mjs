import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Exercise the REAL launcher, not a test-only engine or a hosted/local bridge.
// Every file belongs to this freshly created fixture; cleanup never touches a checkout.
const root = fileURLToPath(new URL('../..', import.meta.url))
await mkdir('/tmp/opencode', { recursive: true, mode: 0o700 })
const directory = await mkdtemp('/tmp/opencode/recallloop-browser-project-')
await mkdir(path.join(directory, 'dist'))
await Promise.all([
  writeFile(path.join(directory, 'greet.ts'), 'export function greet(name: string) {\n  return `Hello, ${name.trim()}!`\n}\n'),
  writeFile(path.join(directory, 'first.ts'), 'export const first = 1\n'),
  writeFile(path.join(directory, 'second.ts'), 'export const second = 2\n'),
  writeFile(path.join(directory, '.env'), 'SYNTHETIC_PRIVATE_FIXTURE_ONLY=never-expose\n'),
  writeFile(path.join(directory, 'dist', 'index.html'), '<h1>Local static fixture</h1>'),
])
const env = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: process.env.PORT || '3118', NODE_ENV: 'development',
  NODE_OPTIONS: `--import=${path.join(root, 'browser/local-builder/offline-runtime.mjs')}`,
  RECALLLOOP_WORKSPACE_TOKEN: '', RECALLLOOP_REQUIRE_WORKSPACE_AUTH: '', RECALLLOOP_ALLOWED_ORIGINS: '',
  RECALLLOOP_MEMORY_MODE: 'mock', RECALLLOOP_LLM_MODE: 'mock', AGENT_LLM_EXTRA_HEADERS: '',
  TATUM_API_KEY: 'SYNTHETIC_PARENT_KEY_NOT_FOR_SHELL', MEMWAL_PRIVATE_KEY: '', MEMWAL_ACCOUNT_ID: '',
  AGENT_LLM_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' }
const child = spawn(process.execPath, ['scripts/local-builder.mjs', '--workspace', directory, '--port', env.PORT, '--demo'], {
  cwd: root, env, stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
child.once('error', async () => { await rm(directory, { recursive: true, force: true }); process.exitCode = 1 })
child.once('exit', async (code, signal) => {
  await rm(directory, { recursive: true, force: true })
  process.exitCode = code ?? (signal ? 1 : 0)
})
