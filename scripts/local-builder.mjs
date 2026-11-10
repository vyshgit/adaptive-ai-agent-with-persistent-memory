import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { builderRoot } from '../server/builder/policy.mjs'

export const BUILDER_HELP = 'node /path/to/recallloop/scripts/local-builder.mjs [--workspace <project>] [--port 3000] [--demo] [--production]\nOr: npm --prefix /path/to/recallloop run builder -- [options]\nDefaults to the folder you invoke it from (including npm INIT_CWD). Relative --workspace overrides resolve from that folder. Runs one app on 127.0.0.1. Login and project consent are required. Standard permissions automate routine scoped edits and hardened inspection; risky commands, deletes and execution configuration need exact permission. Strict review is optional. --demo scripts the model; local commands and file edits are still REAL. Static previews use a separate loopback origin in the same process.'

// npm changes cwd to the installed app before running its lifecycle. INIT_CWD
// records the caller's project, but is not authoritative for direct Node calls.
export function parseBuilderArgs(args, { cwd = process.cwd(), env = process.env } = {}) {
  const invocation = path.resolve(env.npm_lifecycle_event === 'builder' && env.INIT_CWD ? env.INIT_CWD : cwd)
  const options = new Set(['--workspace', '--port', '--demo', '--production', '--help'])
  let directory = invocation, port = env.PORT || '3000', demo = false, production = false, help = false
  const seen = new Set()
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!options.has(arg) || seen.has(arg)) throw new Error('Use optional --workspace <project-directory>, --port <port>, --demo or --production once each. No remote host or shared OpenCode server is supported.')
    seen.add(arg)
    if (['--workspace', '--port'].includes(arg)) {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value.`)
      if (arg === '--workspace') directory = path.resolve(invocation, value)
      else port = value
    }
    if (arg === '--demo') demo = true
    if (arg === '--production') production = true
    if (arg === '--help') help = true
  }
  if (!help && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) throw new Error('Choose a valid local port (1–65535).')
  return { directory, port, demo, production, help }
}

async function launch() {
  const { directory, port, demo, production, help } = parseBuilderArgs(process.argv.slice(2))
  if (help) { console.log(BUILDER_HELP); return }
  const root = await builderRoot(directory)
  const appRoot = fileURLToPath(new URL('..', import.meta.url))
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', '--env-file-if-exists=.env.local', 'server/index.mjs',
    '--local', '--workspace', root, ...(demo ? ['--demo'] : []), ...(production ? ['--production'] : [])], {
    cwd: appRoot, env: { ...process.env, HOST: '127.0.0.1', PORT: port }, stdio: 'inherit',
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
  child.once('error', () => { console.error('The local RecallLoop app could not start. Check your Node runtime and installation.'); process.exitCode = 1 })
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void launch().catch(error => { console.error(error.message); process.exitCode = 1 })
}
