import { fork } from 'node:child_process'
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { AppError, publicError } from '../safety.mjs'

export function engineEnvironment(directory, scratch, env = process.env) {
  // An allowlist, not a blacklist: SDK imports cannot see the app's keys, proxy
  // credentials, saved OpenCode auth, NODE_OPTIONS, shell profiles or other logins.
  const executablePaths = (env.PATH || '/usr/local/bin:/usr/bin:/bin').split(path.delimiter)
    .filter(item => path.isAbsolute(item) && item !== directory && !item.startsWith(`${directory}${path.sep}`))
  return { PATH: [...new Set([path.dirname(process.execPath), ...executablePaths])].join(path.delimiter),
    HOME: path.join(scratch, 'home'), OPENCODE_TEST_HOME: path.join(scratch, 'home'),
    XDG_CONFIG_HOME: path.join(scratch, 'config'), XDG_DATA_HOME: path.join(scratch, 'data'),
    XDG_CACHE_HOME: path.join(scratch, 'cache'), XDG_STATE_HOME: path.join(scratch, 'state'),
    TMPDIR: path.join(scratch, 'tmp'), SHELL: process.platform === 'darwin' ? '/bin/sh' : '/bin/bash',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TERM: 'dumb', TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_GLOBALCONFIG: '/dev/null', npm_config_cache: path.join(scratch, 'cache', 'npm'),
    PIP_CONFIG_FILE: '/dev/null' }
}

export async function createOpencodeEngine({ directory, env = process.env, startupMs = 45_000, onDiagnostic = () => {}, signal } = {}) {
  signal?.throwIfAborted()
  const temporaryBase = await access('/tmp/opencode').then(() => '/tmp/opencode', () => os.tmpdir())
  signal?.throwIfAborted()
  const scratch = await mkdtemp(path.join(temporaryBase, 'recallloop-engine-'))
  const calls = new Map(), shellGroups = new Map()
  let closing = false, closed = false, child, closePromise
  let readyResolve, readyReject, exitResolve
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  ready.catch(() => {})
  const exited = new Promise(resolve => { exitResolve = resolve })
  const startTimer = setTimeout(() => readyReject(new AppError('builder_unavailable', 'The private coding engine did not start in time.', 503, true)), startupMs)
  startTimer.unref()
  const stopStartup = () => readyReject(new AppError('engine_stopped', 'The private engine was stopped during startup.', 409))
  signal?.addEventListener('abort', stopStartup, { once: true })

  function killGroup(pid, signal = 'SIGKILL') {
    if (!Number.isInteger(pid) || pid <= 1) return
    try { process.kill(-pid, signal) } catch { /* already exited */ }
  }
  function failCalls() {
    for (const call of calls.values()) {
      call.signal?.removeEventListener('abort', call.abort)
      call.reject(new AppError('engine_stopped', 'The private engine stopped. The task was not declared complete; already-applied disk edits remain.', 409))
    }
    calls.clear()
  }
  function send(message) {
    if (!child?.connected || closed) throw new AppError('engine_stopped', 'The private engine is no longer connected.', 409)
    child.send(message, error => { if (error) failCalls() })
  }
  try {
    await Promise.all(['home', 'config', 'data', 'cache', 'state', 'tmp', 'workspace'].map(name => mkdir(path.join(scratch, name), { mode: 0o700 })))
    signal?.throwIfAborted()
    child = fork(fileURLToPath(new URL('./opencode-worker.mjs', import.meta.url)), [directory, scratch], {
      cwd: scratch, env: engineEnvironment(directory, scratch, env), execArgv: [], detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json',
    })
    child.once('error', () => { closed = true; exitResolve(); readyReject(new AppError('builder_unavailable', 'The private coding engine could not start.', 503, true)) })
    child.once('exit', () => {
      closed = true; clearTimeout(startTimer)
      readyReject(new AppError('builder_unavailable', 'The private coding engine exited during startup.', 503, true))
      failCalls()
      for (const pid of shellGroups.values()) killGroup(pid)
      shellGroups.clear(); exitResolve()
      // Only remove the private directory created by this instance, never a workspace.
      void rm(scratch, { recursive: true, force: true }).catch(() => {})
    })
    child.on('message', async message => {
      if (!message || typeof message !== 'object') return
      if (message.kind === 'diagnostic') { try { onDiagnostic(message.data) } catch { /* diagnostics must not affect tasks */ } return }
      if (message.kind === 'ready') { clearTimeout(startTimer); readyResolve(message); return }
      if (message.kind === 'startup-error') { clearTimeout(startTimer); readyReject(new AppError('builder_unavailable', 'OpenCode could not initialize the private runtime.', 503, true)); return }
      if (message.kind === 'shell-group') {
        if (message.state === 'started' && Number.isInteger(message.pid) && message.pid > 1) {
          shellGroups.set(message.id, message.pid)
          if (closing || closed) killGroup(message.pid)
        } else if (message.state === 'ended') {
          // A shell that exits can leave background descendants in its group.
          // No persistent/background process is admitted by this builder.
          killGroup(shellGroups.get(message.id)); shellGroups.delete(message.id)
        }
        return
      }
      const call = calls.get(message.callId)
      if (!call || closing || call.signal?.aborted) return
      if (message.kind === 'event') { try { call.onEvent?.(message.event) } catch { void close() } return }
      if (message.kind === 'tool') {
        try {
          if (!call.tool) throw new AppError('tool_denied', 'No file or command tool is authorized for this operation.', 403)
          const result = await call.tool(message.name, message.input)
          if (!closing && !call.signal?.aborted && calls.get(message.callId) === call) send({ kind: 'tool-result', id: message.id, result })
        } catch (error) {
          if (!closing && calls.get(message.callId) === call) send({ kind: 'tool-result', id: message.id, error: publicError(error) })
        }
        return
      }
      if (message.kind === 'result') {
        calls.delete(message.callId); call.signal?.removeEventListener('abort', call.abort)
        if (message.error) call.reject(new AppError(message.error.code || 'engine_failed', message.error.error || 'The coding task failed.', 502, Boolean(message.error.retryable)))
        else call.resolve(message.result)
      }
    })
    await ready
    signal?.throwIfAborted()
  } catch (error) {
    clearTimeout(startTimer)
    if (child) { closing = true; killGroup(child.pid); await exited }
    await rm(scratch, { recursive: true, force: true }).catch(() => {})
    throw error
  } finally { signal?.removeEventListener('abort', stopStartup) }

  async function close() {
    if (closePromise) return closePromise
    closePromise = (async () => {
      closing = true; failCalls()
      if (!closed && child.connected) child.send({ kind: 'close' }, () => {})
      // SDK shell processes have their own detached process groups. Track and
      // terminate those as well as the worker, even if a worker crashes mid-task.
      for (const pid of shellGroups.values()) killGroup(pid, 'SIGTERM')
      let timer
      await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 1500) })])
      clearTimeout(timer)
      for (const pid of shellGroups.values()) killGroup(pid)
      shellGroups.clear()
      if (!closed) { killGroup(child.pid); await exited }
      await rm(scratch, { recursive: true, force: true }).catch(() => {})
    })()
    return closePromise
  }
  function invoke(method, args, { signal, onEvent, tool } = {}) {
    signal?.throwIfAborted()
    if (closing || closed || calls.size >= 4) throw new AppError('engine_stopped', 'The engine is stopped or busy.', 409)
    const callId = randomBytes(16).toString('hex')
    return new Promise((resolve, reject) => {
      const call = { resolve, reject, signal, onEvent, tool, abort: () => { void close() } }
      signal?.addEventListener('abort', call.abort, { once: true })
      calls.set(callId, call)
      try { send({ kind: 'request', callId, method, args }) }
      catch (error) { calls.delete(callId); signal?.removeEventListener('abort', call.abort); reject(error) }
    })
  }
  return { prompt: (args, options) => invoke('prompt', args, options), command: (args, options) => invoke('command', args, options),
    close, get closed() { return closing || closed },
    // Diagnostic metadata stays server-side and is never sent by a builder route.
    runtimeDirectory: scratch, pid: child.pid }
}
