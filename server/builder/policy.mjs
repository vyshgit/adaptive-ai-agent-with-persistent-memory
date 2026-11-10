import path from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { AppError, requireText, redactSecrets } from '../safety.mjs'

export const BUILDER_LIMITS = Object.freeze({ fileBytes: 100_000, entries: 500, scannedEntries: 3000,
  searchFiles: 500, searchBytes: 2_000_000, toolCalls: 32, modelCalls: 6, outputTokens: 4096,
  turnMs: 5 * 60_000, commandMs: 120_000, terminalBytes: 256_000, approvals: 8, approvalMs: 5 * 60_000,
  tasks: 2, commands: 2, workspaces: 4, eventBytes: 2_000_000, historyMessages: 12, historyCharacters: 24_000,
  previewFileBytes: 1_000_000, previewBytes: 5_000_000, previewFiles: 200, previewMs: 10 * 60_000 })

const hiddenRoots = new Set(['.git', '.hg', '.svn', 'node_modules', '.ssh', '.aws', '.gnupg', '.opencode', '.claude', '.codex', '.cache'])
const sensitive = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.gitconfig|\.git-credentials|credentials?(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519|id_ecdsa)$/i

export function hiddenPathPart(part) {
  return hiddenRoots.has(part.toLowerCase()) || sensitive.test(part)
    || /\.(?:pem|key|p12|pfx|keystore)$/i.test(part) || part.startsWith('.recallloop-edit-')
}

export function localPeer(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)
}

// Tokens, reverse-proxy headers and wallet login never turn a hosted app into a
// bridge to a machine's filesystem. Apply this to the ENTIRE local app, including Vite.
export function localBuilderGuard(req, res, next) {
  const host = req.get('host') || ''
  const local = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)
  const source = req.get('origin') || req.get('referer')
  let validSource = !source
  try { const url = new URL(source); validSource = url.origin === `http://${host}` } catch { /* invalid origin */ }
  const site = req.get('sec-fetch-site')
  if (!local || !localPeer(req) || req.protocol !== 'http' || !validSource || (site && !['same-origin', 'none'].includes(site))) {
    return res.status(403).json({ success: false, code: 'local_only', error: 'The local builder accepts loopback, same-origin requests only.', retryable: false })
  }
  next()
}

export async function builderRoot(directory, host = '127.0.0.1') {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new AppError('local_only', 'The local builder must bind to a loopback address.', 403)
  if (process.platform === 'win32') throw new AppError('builder_unavailable', 'The first local builder supports Linux and macOS. Use WSL on Windows.', 503)
  const root = await localDirectory(directory)
  const issue = projectFolderIssue(root)
  if (issue) throw new AppError('local_only', issue, 403)
  return root
}

export function projectFolderIssue(root) {
  return root === path.parse(root).root || ['/home', '/Users', '/etc', '/usr', '/var', '/tmp', '/tmp/opencode'].includes(root)
    ? 'Choose a specific local project, not a filesystem or system root.' : null
}

// Folder navigation is available only to the local, authenticated browser. It
// reveals directory names, never file contents or model tool authority.
export async function localDirectory(directory) {
  const input = requireText(directory, 'local workspace root', 4096)
  if (!path.isAbsolute(input) || /[\x00-\x1f\x7f]/.test(input)) throw new AppError('invalid_request', 'Use an absolute local directory path without control characters.')
  function allowed(value) {
    if (value === '/data' || value.startsWith('/data/') || value.split(path.sep).some(hiddenPathPart)) {
      throw new AppError('local_only', 'Credential folders, dependency/engine directories and the hosted /data preview cannot be selected or browsed.', 403)
    }
  }
  allowed(input)
  const root = await realpath(input).catch(() => { throw new AppError('invalid_request', 'This local folder does not exist or cannot be accessed. Check the path and OS permissions.') })
  allowed(root)
  const info = await stat(root).catch(() => { throw new AppError('invalid_request', 'This local folder cannot be accessed. Check the path and OS permissions.') })
  if (!info.isDirectory()) throw new AppError('invalid_request', 'Choose a local project directory, not a file.')
  return root
}

export function bodyFields(input, names) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !names.includes(key))) {
    throw new AppError('invalid_request', 'Unexpected builder request fields. Identity, credentials, and scope come from the active login, not the request body.')
  }
  return input
}

export function relativePath(value, { directory = false } = {}) {
  if (directory && value === '.') return '.'
  if (typeof value !== 'string' || !value || value.length > 240 || !/^[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/.test(value)) {
    throw new AppError('unsafe_path', 'Use a safe relative project path with no absolute paths, backslashes, or encoded segments.')
  }
  const parts = value.split('/')
  if (parts.length > 16 || parts.some(part => part !== part.trim() || ['.', '..'].includes(part) || hiddenPathPart(part))) {
    throw new AppError('unsafe_path', 'Traversal, dependency folders, engine configuration, and credential files are not exposed by the file tools.')
  }
  return value
}

export function cleanText(value, name, max, secrets = [], { empty = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    throw new AppError('invalid_request', `${name} must be bounded plain text${empty ? '' : ' and non-empty'}.`)
  }
  return redactSecrets(value, secrets)
}

export function commandInput(input, secrets = []) {
  bodyFields(input, ['command', 'cwd', 'timeoutMs', 'reason'])
  const command = cleanText(input.command, 'command', 4000, secrets).trim()
  if (command !== input.command.trim()) throw new AppError('unsafe_command', 'Do not put credentials in commands. The builder never supplies API keys to the shell.', 403)
  const cwd = relativePath(input.cwd ?? '.', { directory: true })
  const timeoutMs = input.timeoutMs ?? 60_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > BUILDER_LIMITS.commandMs) {
    throw new AppError('invalid_request', `Command timeouts must be 1–${BUILDER_LIMITS.commandMs / 1000} seconds. Background/interactive terminals are not exposed.`)
  }
  return { command, cwd, timeoutMs, reason: cleanText(input.reason || 'Run this exact local command.', 'reason', 1000, secrets) }
}

export function taskHistory(value = [], secrets = []) {
  if (!Array.isArray(value) || value.length > BUILDER_LIMITS.historyMessages) throw new AppError('invalid_request', 'Keep at most twelve bounded page-conversation messages.')
  let size = 0
  return value.map(message => {
    bodyFields(message, ['role', 'content'])
    if (!['user', 'assistant'].includes(message.role)) throw new AppError('invalid_request', 'Working history accepts only user and assistant text, never tool logs or provider references.')
    const content = cleanText(message.content, 'history message', 8000, secrets)
    size += message.content.length
    if (size > BUILDER_LIMITS.historyCharacters) throw new AppError('invalid_request', 'The working conversation exceeds its 24,000-character context budget. Start a new session or shorten it.')
    return { role: message.role, content }
  })
}

export const NATIVE_COMMAND_NOTICE = 'This is native execution, not a sandbox. The entire command, project scripts, dependencies and Git hooks run with your OS permissions and can read or change files outside this folder, access the network, or spend resources. RecallLoop API credentials are not supplied. Approve only a command and project you trust.'
