import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { AppError, redactSecrets } from '../server/safety.mjs'
import { namespaceAgentId } from '../server/memory/memwal-client.mjs'
import { walletAgentId, suiAddress } from '../server/agent/wallet-auth.mjs'

export function isEntry(url) { return Boolean(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === url) }

export function cliOptions(args, options) {
  try { return parseArgs({ args, strict: true, allowPositionals: false, options: { help: { type: 'boolean', short: 'h' }, ...options } }).values }
  catch { throw new AppError('invalid_request', 'Unknown or malformed arguments. Use --help for supported options.') }
}

export function cliIdentity({ agentId, walletAddress, fallback = 'recallloop-workspace' }) {
  if (agentId && walletAddress) throw new AppError('invalid_request', 'Choose --agent-id or --wallet-address, not both.')
  if (walletAddress) return { agentId: walletAgentId(walletAddress), walletAddress: suiAddress(walletAddress) }
  const id = agentId || fallback
  namespaceAgentId(id)
  return { agentId: id, walletAddress: null }
}

// Explicit local operator export, never called by a server route. Do not overwrite
// existing evidence or user files, and do not write private configuration to disk.
export async function writeEvidence(path, markdown, env = process.env) {
  try { await writeFile(resolve(path), redactSecrets(markdown, [], env), { flag: 'wx', mode: 0o600 }) }
  catch { throw new AppError('evidence_export_failed', 'Evidence was not exported. Choose a new path in an existing directory; existing files are never overwritten.', 409) }
}
