import '../server/proxy-bootstrap.mjs'
import { createMemoryService } from '../server/memory/service.mjs'
import { createLlm } from '../server/agent/llm.mjs'
import { serverLlmConfig } from '../server/agent/connections.mjs'
import { runChat, validateChat } from '../server/agent/chat.mjs'
import { AppError, publicError, redactValue } from '../server/safety.mjs'
import { cliOptions, cliIdentity, isEntry } from './cli.mjs'

const project = { files: [{ path: 'src/greet.ts', content: 'export function greet(name: string) {\n  return `Hello, ${name.trim()}!`\n}\n' }] }

export async function runMemoryDemo({ env = process.env, live = false, confirmLiveWrites = false, agentId,
  memory: injectedMemory, llm: injectedLlm } = {}) {
  if (live && !confirmLiveWrites) throw new AppError('demo_refused', 'Live demo may spend provider and Mainnet memory quota. Add --live --confirm-live-writes explicitly.', 412)
  const demoEnv = live ? env : { RECALLLOOP_MEMORY_MODE: 'mock', RECALLLOOP_LLM_MODE: 'mock' }
  const identity = cliIdentity({ agentId, fallback: live ? env.RECALLLOOP_AGENT_ID || 'recallloop-cli-demo' : 'recallloop-cli-demo' })
  const config = serverLlmConfig(demoEnv)
  if (live && (config.mode !== 'live' || !config.model || !config.apiKey || !env.TATUM_API_KEY)) {
    throw new AppError('demo_refused', 'Live demo requires AGENT_LLM_* live configuration and a TATUM_API_KEY. Wallet UI connections are separate and cannot be reused by this CLI.', 412)
  }
  const memory = injectedMemory || createMemoryService({ env: demoEnv, ...(!live ? { chain: { checkpoint: async () => null } } : {}) })
  const llm = injectedLlm || createLlm({ env: demoEnv, mockDelayMs: 0 })
  try {
    const status = await memory.status()
    if (live && (status.mode !== 'relayer' || status.network !== 'mainnet' || !status.healthy || !status.writeReady)) {
      throw new AppError('demo_refused', 'Live demo requires the official, healthy Mainnet relayer and authorized environment credentials. No mock fallback is allowed.', 412)
    }
    if (live && !await memory.chain.checkpoint()) throw new AppError('chain_unavailable', 'Verify your Tatum Mainnet key before running the live demo.', 502, true)
    const turns = []
    const tasks = [
      { sessionId: 'demo-teach', mode: 'talk', message: 'I prefer TypeScript and npm. I want small reviewable coding changes.' },
      { sessionId: 'demo-recall', mode: 'build', message: 'Use my TypeScript and npm preferences to fix greet for empty and missing names.' },
    ]
    for (const task of tasks) {
      const input = validateChat({ ...task, history: [], project, capture: true }, config)
      const turn = { sessionId: task.sessionId, eventOrder: [], recalledBlobIds: [], answer: '', proposals: [], stored: null }
      for await (const event of runChat({ input, memory, llm, agentId: identity.agentId, config, captureTimeoutMs: live ? 200_000 : 10_000 })) {
        turn.eventOrder.push(event.type)
        if (event.type === 'memory') turn.recalledBlobIds = event.data.memories.map(hit => hit.blobId)
        if (event.type === 'delta') turn.answer += event.data.text
        if (event.type === 'proposal') turn.proposals.push({ path: event.data.path, reason: event.data.reason })
        if (event.type === 'stored') turn.stored = event.data
      }
      if (!turn.stored || turn.stored.pending || turn.stored.failed || turn.stored.verbatim + turn.stored.facts === 0) {
        throw new AppError('capture_failed', 'Demo capture was not fully confirmed. Check inventory before retrying; accepted Mainnet jobs may complete later.', 502, true)
      }
      turns.push(turn)
    }
    const firstFacts = new Set(turns[0].stored.blobs.filter(blob => blob.tier === 'facts').map(blob => blob.blobId))
    const recalledPreviousTurn = turns[1].recalledBlobIds.some(id => firstFacts.has(id))
    if (!recalledPreviousTurn) throw new AppError('demo_recall_failed', 'The new session did not recall a confirmed fact from the first turn. This run does not prove the learning loop.', 502)
    const inventory = await memory.inventory(identity.agentId)
    return redactValue({ success: true, mode: live ? 'live' : 'mock', agentId: identity.agentId,
      notice: live ? 'This explicit CLI run uses environment credentials, not a browser wallet session. Inspect the actual answer before claiming improvement.'
        : 'Deterministic offline demonstration only. Memory is process-local; no provider or Mainnet calls were made.',
      recalledPreviousTurn, usesTypeScriptAndNpm: /TypeScript/i.test(turns[1].answer) && /npm/i.test(turns[1].answer),
      // Do not print potentially private recalled text or full model answers.
      turns: turns.map(({ answer, ...turn }) => ({ ...turn, answerCharacters: answer.length })),
      inventory: { total: inventory.total, namespaces: inventory.namespaces, meetsHackathonMinimum: inventory.meetsHackathonMinimum },
    }, [], env)
  } finally { memory.destroy?.() }
}

async function main() {
  const options = cliOptions(process.argv.slice(2), { live: { type: 'boolean' }, 'confirm-live-writes': { type: 'boolean' }, 'agent-id': { type: 'string' } })
  if (options.help) return console.log('Usage: npm run demo:agent -- [--agent-id NAME] [--live --confirm-live-writes]\nDefault: isolated, credential-free mock loop. --live uses explicit environment credentials and incurs usage costs.')
  console.log(JSON.stringify(await runMemoryDemo({ live: options.live, confirmLiveWrites: options['confirm-live-writes'], agentId: options['agent-id'] }), null, 2))
}
if (isEntry(import.meta.url)) main().catch(error => { console.error(JSON.stringify(publicError(error))); process.exitCode = 1 })
