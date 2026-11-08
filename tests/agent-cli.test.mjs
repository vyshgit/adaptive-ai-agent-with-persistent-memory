import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runMemoryDemo } from '../scripts/memory-agent-demo.mjs'
import { runMainnetSeed, mainnetEvidence } from '../scripts/seed-mainnet-memories.mjs'
import { cliIdentity, cliOptions, writeEvidence } from '../scripts/cli.mjs'
import { walletAgentId, suiAddress } from '../server/agent/wallet-auth.mjs'

const exec = promisify(execFile)

test('CLI demo defaults to network-free mock even when environment credentials are present', async () => {
  const result = await runMemoryDemo({ env: { RECALLLOOP_MEMORY_MODE: 'relayer', MEMWAL_PRIVATE_KEY: 'never-use-this-key', MEMWAL_ACCOUNT_ID: '0xa',
    AGENT_LLM_API_KEY: 'never-use-this-model-key', TATUM_API_KEY: 'never-use-this-tatum-key' } })
  assert.equal(result.mode, 'mock')
  assert.equal(result.recalledPreviousTurn, true)
  assert.equal(result.usesTypeScriptAndNpm, true)
  assert.equal(result.inventory.meetsHackathonMinimum, false)
  assert.equal(result.turns[1].proposals.length, 1)
  for (const turn of result.turns) assert.deepEqual(turn.eventOrder.slice(-2), ['done', 'stored'])
  assert.equal(JSON.stringify(result).includes('never-use-this'), false)
  assert.equal(result.turns[0].answer, undefined, 'CLI logs no full answers or recalled text')
})

test('live demo and Mainnet seed require explicit spending confirmation before accessing services', async () => {
  const memory = new Proxy({}, { get() { assert.fail('No service calls are allowed before consent') } })
  await assert.rejects(runMemoryDemo({ live: true, memory }), /confirm-live-writes/)
  await assert.rejects(runMainnetSeed({ memory }), /confirm-mainnet/)
  await assert.rejects(runMainnetSeed({ confirmMainnet: true, env: {}, memory }), /TATUM_API_KEY/)
})

test('seed refuses mock/unready deployments and missing Tatum observations before writes', async () => {
  let writes = 0, destroyed = 0
  const memory = { status: async () => ({ mode: 'mock', network: null }), chain: { checkpoint: async () => null },
    seed: async () => { writes++ }, destroy() { destroyed++ } }
  const options = { env: { TATUM_API_KEY: 'synthetic-tatum-key' }, confirmMainnet: true, memory }
  await assert.rejects(runMainnetSeed(options), /Mock and legacy/)
  memory.status = async () => ({ mode: 'relayer', network: 'mainnet', healthy: true, writeReady: true })
  await assert.rejects(runMainnetSeed(options), /No seed writes/)
  assert.equal(writes, 0)
  assert.equal(destroyed, 2)
})

// Entirely synthetic evidence fixture. These IDs are used only to validate the
// export contract and are never published as live Mainnet evidence.
function seedFixture() {
  const blobs = Array.from({ length: 12 }, (_, i) => ({ blobId: `synthetic-fixture-${i}`, namespace: 'rl:fixture-agent:facts', createdAt: '2026-11-08T10:00:00Z' }))
  return { success: true, verified: 12, failed: 0, blobs, agentPublicKey: '2'.repeat(64),
    chainAnchor: { checkpoint: '123', observedAt: '2026-11-08T10:00:00Z' },
    status: { mode: 'relayer', network: 'mainnet', healthy: true, writeReady: true, accountId: '0xa', relayerUrl: 'https://relayer.memory.walrus.xyz' },
    inventory: { total: 12, meetsHackathonMinimum: true, memories: blobs } }
}

test('Mainnet evidence refuses unverified, duplicate, missing, mock and checkpoint-free records', () => {
  const valid = seedFixture()
  assert.match(mainnetEvidence(valid, { agentId: 'fixture-agent' }), /independently listed seed blobs: 12/)
  for (const invalid of [{ ...valid, success: false }, { ...valid, verified: 10 }, { ...valid, failed: 1 }, { ...valid, chainAnchor: null },
    { ...valid, inventory: { ...valid.inventory, memories: [] } }, { ...valid, blobs: [valid.blobs[0], ...valid.blobs.slice(0, 11)] },
    { ...valid, blobs: [{ ...valid.blobs[0], blobId: 'mock-fake' }, ...valid.blobs.slice(1)] }, { ...valid, status: { ...valid.status, network: null } }]) {
    assert.throws(() => mainnetEvidence(invalid, { agentId: 'fixture-agent' }), /No success evidence/)
  }
})

test('CLI wallet namespace is stable, ownership is checked before seeding, and exports never overwrite files', async t => {
  const address = suiAddress('0x1')
  assert.equal(cliIdentity({ walletAddress: address }).agentId, walletAgentId(address))
  assert.throws(() => cliIdentity({ walletAddress: address, agentId: 'other' }), /not both/)
  assert.throws(() => cliOptions(['--unknown'], {}), /--help/)
  let writes = 0
  const fixture = seedFixture()
  const memory = { status: async () => fixture.status, chain: { checkpoint: async () => fixture.chainAnchor,
    account: async () => ({ asMoveObject: { contents: { json: { owner: suiAddress('0x2') } } } }) },
    seed: async () => { writes++; return fixture }, destroy() {} }
  await assert.rejects(runMainnetSeed({ env: { TATUM_API_KEY: 'synthetic-key' }, confirmMainnet: true, walletAddress: address, memory }), /must own/)
  assert.equal(writes, 0)
  const temporary = join(tmpdir(), 'opencode')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, 'recallloop-evidence-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'synthetic-export.md')
  await writeEvidence(path, 'No synthetic-private-key in export.', { MEMWAL_PRIVATE_KEY: 'synthetic-private-key' })
  assert.equal(await readFile(path, 'utf8'), 'No [REDACTED] in export.')
  await assert.rejects(writeEvidence(path, 'overwritten'), /never overwritten/)
  assert.equal(await readFile(path, 'utf8'), 'No [REDACTED] in export.')
})

test('npm CLI entry points support help and a complete offline loop without a running web server', async () => {
  const { stdout } = await exec(process.execPath, ['scripts/memory-agent-demo.mjs'], { cwd: new URL('..', import.meta.url), timeout: 20_000 })
  assert.equal(JSON.parse(stdout).recalledPreviousTurn, true)
  const { stdout: help } = await exec(process.execPath, ['scripts/seed-mainnet-memories.mjs', '--help'], { cwd: new URL('..', import.meta.url), timeout: 20_000 })
  assert.match(help, /--confirm-mainnet/)
  await assert.rejects(exec(process.execPath, ['scripts/seed-mainnet-memories.mjs'], { cwd: new URL('..', import.meta.url), timeout: 20_000 }), error => /seed_refused/.test(error.stderr))
})
