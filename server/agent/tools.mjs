import { randomUUID } from 'node:crypto'
import { AppError, requireText, clampNumber, publicError, redactValue, redactSecrets } from '../safety.mjs'
import { hash } from '../memory/consolidate.mjs'
import { safeProjectPath } from './project.mjs'

function tool(name, description, properties, required) {
  return { type: 'function', function: { name, description, strict: false, parameters: { type: 'object', properties, required, additionalProperties: false } } }
}
const text = (maxLength = 500) => ({ type: 'string', maxLength })
export const TOOL_SCHEMAS = [
  tool('plan_task', 'Share or replace a short user-visible working plan. These are proposed steps, not completed actions; this does not execute or approve anything.',
    { summary: text(240), steps: { type: 'array', items: text(240), minItems: 1, maxItems: 6 } }, ['summary', 'steps']),
  tool('ask_user', 'Ask one essential clarification and pause this turn for a real user reply. Call this alone; other calls in the same round will be blocked. Optional replies are suggestions, never selected defaults or established personal facts.',
    { question: text(400), why: text(600), options: { type: 'array', items: text(160), minItems: 0, maxItems: 4 } }, ['question']),
  tool('list_files', 'List only the user-selected browser project files. This is not the server filesystem.', {}, []),
  tool('read_file', 'Read lines of a selected project file before proposing a change. Output is bounded; paginate with startLine.',
    { path: text(240), startLine: { type: 'integer', minimum: 1 }, lineCount: { type: 'integer', minimum: 1, maximum: 200 } }, ['path']),
  tool('search_files', 'Literal text search over selected project files, capped at 20 matching lines.', { query: text(500) }, ['query']),
  tool('propose_file', 'Propose complete replacement contents of a text file. It is NOT applied until the user approves. Never claim it ran or passed tests.',
    { path: text(240), content: text(20_000), reason: text(1000) }, ['path', 'content', 'reason']),
  tool('recall_memory', 'Recall previous decisions, corrections and preferences from this agent memory scope.', { query: text(500), limit: { type: 'integer', minimum: 1, maximum: 20 } }, ['query']),
  tool('remember', 'Remember a user-stated fact or preference, never an unverified assistant claim. Ask before storing sensitive data.',
    { text: text(2000), tier: { type: 'string', enum: ['facts', 'profile'] } }, ['text']),
  tool('sui_read', 'Read a Sui Mainnet checkpoint or object through Tatum HTTP GraphQL. No transactions or arbitrary queries.',
    { kind: { type: 'string', enum: ['checkpoint', 'object'] }, address: text(66) }, ['kind']),
]

export function createTools({ memory, agentId, project, secrets = [], capture = true, mode = 'build' }) {
  const files = new Map(project.files.map(file => [file.path, redactSecrets(file.content, secrets)]))
  let outputBudget = 40_000
  const proposals = []
  const schemas = TOOL_SCHEMAS.filter(schema => (capture || schema.function.name !== 'remember') && (mode === 'build' || schema.function.name !== 'propose_file'))
  async function execute(call) {
    try {
      const args = call.args
      if (!args || typeof args !== 'object' || Array.isArray(args) || args.invalidArguments) throw new AppError('invalid_request', 'Tool arguments must be a valid JSON object.')
      const schema = schemas.find(schema => schema.function.name === call.name)?.function.parameters
      if (!schema || Object.keys(args).some(key => !Object.hasOwn(schema.properties, key))) throw new AppError('invalid_request', 'Unknown tool or unsupported arguments.')
      if (schema.required.some(key => !Object.hasOwn(args, key))) throw new AppError('invalid_request', 'Required tool arguments are missing.')
      for (const [key, value] of Object.entries(args)) {
        const rule = schema.properties[key]
        if ((rule.type === 'string' && (typeof value !== 'string' || value.length > rule.maxLength))
          || (rule.type === 'integer' && (!Number.isInteger(value) || value < rule.minimum || (rule.maximum && value > rule.maximum)))
          || (rule.type === 'array' && (!Array.isArray(value) || value.length < rule.minItems || value.length > rule.maxItems
            || value.some(item => typeof item !== 'string' || !item.trim() || item.length > rule.items.maxLength)))
          || (rule.enum && !rule.enum.includes(value))) throw new AppError('invalid_request', `Invalid ${key} tool argument.`)
      }
      let result
      let proposal
      let plan
      let question
      if (call.name === 'plan_task') {
        plan = redactValue({ id: randomUUID(), summary: requireText(args.summary, 'plan summary', 240), steps: args.steps.map(step => requireText(step, 'plan step', 240)) }, secrets)
        result = { shared: true, executed: false, approvalGranted: false, plan }
      } else if (call.name === 'ask_user') {
        const options = (args.options || []).map(option => requireText(option, 'reply option', 160))
        if (new Set(options.map(option => option.toLowerCase())).size !== options.length) throw new AppError('invalid_request', 'Reply options must be distinct.')
        question = redactValue({ id: randomUUID(), question: requireText(args.question, 'clarification question', 400),
          ...(args.why ? { why: requireText(args.why, 'clarification context', 600) } : {}), options }, secrets)
        result = { awaitingUser: true, answered: false, question }
      } else if (call.name === 'list_files') result = { files: project.files.map(file => ({ path: file.path, characters: file.content.length })) }
      else if (call.name === 'read_file') {
        const path = safeProjectPath(args.path, secrets)
        if (!files.has(path)) throw new AppError('invalid_request', 'This file is not in the user-selected project context.')
        const lines = files.get(path).split('\n')
        const start = Math.floor(clampNumber(args.startLine, 1, 1, Math.max(1, lines.length)))
        const count = Math.floor(clampNumber(args.lineCount, 200, 1, 200))
        const selected = lines.slice(start - 1, start - 1 + count).map((line, i) => `${start + i}: ${line}`).join('\n')
        result = { path, startLine: start, totalLines: lines.length, content: selected.slice(0, 12_000),
          truncated: selected.length > 12_000 || start - 1 + count < lines.length }
      } else if (call.name === 'search_files') {
        const query = requireText(args.query, 'search query', 500)
        const matches = []
        for (const [path, content] of files) for (const [i, line] of content.split('\n').entries()) {
          if (line.toLowerCase().includes(query.toLowerCase()) && matches.length < 20) matches.push({ path, line: i + 1, text: line.slice(0, 300) })
        }
        result = { matches, cappedAt: 20 }
      } else if (call.name === 'propose_file') {
        const path = safeProjectPath(args.path, secrets)
        if (typeof args.content !== 'string' || args.content.length > 20_000 || args.content.includes('\0')) throw new AppError('invalid_request', 'Proposed file contents must be text, at most 20,000 characters.')
        const reason = requireText(args.reason, 'reason', 1000)
        if (proposals.length >= 6 || proposals.reduce((sum, item) => sum + item.after.length, 0) + args.content.length > 64_000) throw new AppError('invalid_request', 'The proposal budget is exhausted.')
        proposal = { id: randomUUID(), path, before: files.get(path) ?? null, after: redactSecrets(args.content, secrets),
          baseHash: hash(files.get(path) ?? ''), reason: redactSecrets(reason, secrets), status: 'pending' }
        proposals.push(proposal)
        result = { approvalRequired: true, applied: false, proposalId: proposal.id, path, reason }
      } else if (call.name === 'recall_memory') result = await memory.recall({ agentId, query: requireText(args.query, 'query', 500), limit: args.limit })
      else if (call.name === 'remember') result = await memory.remember({ agentId, text: requireText(args.text, 'text', 2000), tier: args.tier || 'facts' }, { secrets })
      else if (call.name === 'sui_read') {
        if (args.kind === 'checkpoint') result = await memory.chain.checkpoint() || { unavailable: true }
        else if (args.kind === 'object') result = await memory.chain.object(args.address)
        else throw new AppError('invalid_request', 'sui_read kind must be checkpoint or object.')
      }
      result = redactValue(result, secrets)
      const json = JSON.stringify(result)
      if (json.length > outputBudget) throw new AppError('invalid_request', 'The tool output budget is exhausted. Use the context already retrieved.')
      outputBudget -= json.length
      return { result, ...(proposal ? { proposal } : {}), ...(plan ? { plan } : {}), ...(question ? { question } : {}),
        preview: `${call.name}: ${proposal ? `review ${proposal.path}` : plan ? plan.summary : question ? question.question : json.slice(0, 240)}` }
    } catch (error) { return { result: publicError(error), error: true, preview: publicError(error).error } }
  }
  return { schemas, execute }
}
