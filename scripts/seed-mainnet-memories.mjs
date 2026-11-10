import '../server/proxy-bootstrap.mjs'
import { createMemoryService } from '../server/memory/service.mjs'
import { AppError, publicError } from '../server/safety.mjs'
import { cliOptions, cliIdentity, isEntry, writeEvidence } from './cli.mjs'

export function mainnetEvidence(result, { agentId, checkedAt = new Date().toISOString() }) {
  const blobs = result.blobs || []
  const listed = new Set((result.inventory?.memories || []).map(record => record.blobId))
  if (!result.success || result.status?.mode !== 'relayer' || result.status.network !== 'mainnet' || result.verified !== 12
    || result.failed !== 0 || !result.inventory?.meetsHackathonMinimum || blobs.length !== 12 || new Set(blobs.map(blob => blob.blobId)).size !== 12
    || blobs.some(blob => typeof blob.blobId !== 'string' || !blob.blobId || blob.blobId.startsWith('mock-') || !listed.has(blob.blobId))
    || !/^\d+$/.test(result.chainAnchor?.checkpoint || '') || !/^[0-9a-fA-F]{64}$/.test(result.agentPublicKey || '')) {
    throw new AppError('evidence_incomplete', 'Twelve unique confirmed Mainnet blobs, independent inventory, delegate public key, and a Tatum checkpoint are required. No success evidence was generated.', 502)
  }
  const cell = value => String(value ?? 'not reported').replace(/[\r\n|`]/g, ' ')
  return `# RecallLoop Mainnet seed evidence\n\nVerified by the explicit local seed command at ${cell(checkedAt)}. This is storage/observation evidence, not proof of model improvement or a submitted entry.\n\n`
    + `- Account object: \`${cell(result.status.accountId)}\`\n- Namespace identity: \`${cell(agentId)}\`\n- Delegate public key (submission agent ID): \`${cell(result.agentPublicKey)}\`\n`
    + `- Relayer: ${cell(result.status.relayerUrl)}\n- Relayer version: ${cell(result.status.relayerVersion)}\n- Network: Mainnet\n`
    + `- Writes confirmed: ${blobs.length}; independently listed seed blobs: ${result.verified}\n- Listed workspace memories: ${result.inventory.total}${result.inventory.truncated ? ' (bounded, not exhaustive)' : ''}\n`
    + `- Sui Mainnet checkpoint through Tatum GraphQL: ${cell(result.chainAnchor.checkpoint)}\n- Checkpoint digest: ${cell(result.chainAnchor.digest)}\n- Observation time: ${cell(result.chainAnchor.observedAt)}\n\n`
    + '| Blob ID | Namespace | Confirmed timestamp |\n| --- | --- | --- |\n'
    + blobs.map(blob => `| ${cell(blob.blobId)} | ${cell(blob.namespace)} | ${cell(blob.createdAt)} |`).join('\n')
    + '\n\nThe checkpoint is a chain observation, not independent proof of a Walrus write. No private keys, prompts, or real-user memory text are included.\n'
}

export async function runMainnetSeed({ env = process.env, confirmMainnet = false, agentId, walletAddress, memory: injectedMemory } = {}) {
  if (!confirmMainnet) throw new AppError('seed_refused', 'Mainnet seeding spends account quota. Use npm run seed:memory -- --confirm-mainnet after reviewing your configuration.', 412)
  if (!env.TATUM_API_KEY) throw new AppError('seed_refused', 'TATUM_API_KEY is required for the evidence checkpoint. Configure a Mainnet key before writing.', 412)
  const identity = cliIdentity({ agentId, walletAddress, fallback: env.RECALLLOOP_AGENT_ID || 'recallloop-workspace' })
  const memory = injectedMemory || createMemoryService({ env, principal: identity.walletAddress ? identity.agentId : null })
  try {
    const status = await memory.status()
    if (status.mode !== 'relayer' || status.network !== 'mainnet' || !status.healthy || !status.writeReady) {
      throw new AppError('seed_refused', 'Seeding requires configured credentials and the official, healthy, write-ready Mainnet relayer. Mock and legacy writes never count.', 412)
    }
    const checkpoint = await memory.chain.checkpoint()
    if (!checkpoint) throw new AppError('chain_unavailable', 'Tatum did not verify a Sui Mainnet checkpoint. No seed writes were started.', 502, true)
    if (identity.walletAddress) {
      const account = await memory.chain.account(status.accountId)
      if (account?.asMoveObject?.contents?.json?.owner?.toLowerCase() !== identity.walletAddress) {
        throw new AppError('account_mismatch', 'The namespace wallet address must own the configured MemWal account. No seed writes were started.', 403)
      }
    }
    const result = await memory.seed({ agentId: identity.agentId, confirm: 'seed-mainnet' })
    const evidence = mainnetEvidence({ ...result, chainAnchor: result.chainAnchor || checkpoint }, identity)
    return { evidence, result, identity }
  } finally { memory.destroy?.() }
}

async function main() {
  const options = cliOptions(process.argv.slice(2), { 'confirm-mainnet': { type: 'boolean' }, 'agent-id': { type: 'string' },
    'wallet-address': { type: 'string' }, evidence: { type: 'string' } })
  if (options.help) return console.log('Usage: npm run seed:memory -- --confirm-mainnet [--agent-id NAME | --wallet-address 0xADDRESS] [--evidence NEW_FILE.md]\nRequires explicit relayer/Mainnet environment credentials and Tatum. Writes 12 public synthetic memories, then verifies inventory. Evidence export never overwrites an existing file.')
  const { evidence } = await runMainnetSeed({ confirmMainnet: options['confirm-mainnet'], agentId: options['agent-id'], walletAddress: options['wallet-address'] })
  if (options.evidence) await writeEvidence(options.evidence, evidence)
  console.log(evidence)
}
if (isEntry(import.meta.url)) main().catch(error => { console.error(JSON.stringify(publicError(error))); process.exitCode = 1 })
