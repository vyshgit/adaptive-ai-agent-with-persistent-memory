import type { ChatMessage, WorkingPlan, Clarification, ToolActivity } from './types.ts'
import { redactBrowserText } from './clientSafety.ts'

function safeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > limit) return undefined
  return redactBrowserText(value).trim().slice(0, limit)
}

export function normalisePlan(raw: unknown): WorkingPlan | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const item = raw as Partial<WorkingPlan>
  const id = safeText(item.id, 128), summary = safeText(item.summary, 240)
  if (!id || !summary || !Array.isArray(item.steps) || !item.steps.length || item.steps.length > 6) return undefined
  const steps = item.steps.map(step => safeText(step, 240))
  if (steps.some(step => !step)) return undefined
  return { id, summary, steps: steps as string[] }
}

export function normaliseQuestion(raw: unknown): Clarification | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const item = raw as Partial<Clarification>
  const id = safeText(item.id, 128), question = safeText(item.question, 400)
  if (!id || !question || (item.why !== undefined && !safeText(item.why, 600))) return undefined
  if (item.options !== undefined && (!Array.isArray(item.options) || item.options.length > 4)) return undefined
  const options = (item.options || []).map(option => safeText(option, 160))
  if (options.some(option => !option)) return undefined
  return { id, question, ...(item.why ? { why: safeText(item.why, 600) } : {}), options: [...new Set(options as string[])] }
}

export function historyForMessages(messages: ChatMessage[]) {
  return messages.filter(message => message.status === 'complete').map(message => {
    const workflow = []
    if (message.role === 'assistant') {
      if (message.plan) workflow.push(`Working plan (proposed steps, not completed actions): ${message.plan.summary}\n${message.plan.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`)
      if (message.question) workflow.push(`Clarification for the user: ${message.question.question}${message.question.why ? `\n${message.question.why}` : ''}`)
    }
    // Keep the clarification and plan even when the displayed reply is long.
    // A 4,000-character paused turn leaves room for the preceding user task and
    // a maximum-length next reply within the server's 12,000-character budget.
    const limit = message.role === 'assistant' && message.question ? 4000 : 20_000
    const context = redactBrowserText(workflow.join('\n\n'))
    const content = redactBrowserText(message.content).slice(0, Math.max(0, limit - context.length - (context ? 2 : 0)))
    return { role: message.role, content: [content, context].filter(Boolean).join('\n\n').slice(0, limit) }
  }).filter(message => message.content.trim()).slice(-20)
}

const toolLabels: Record<string, string> = {
  plan_task: 'Share working plan', ask_user: 'Ask for clarification', list_files: 'List selected files',
  read_file: 'Read selected file', search_files: 'Search selected files', propose_file: 'Prepare review proposal',
  recall_memory: 'Recall more context', remember: 'Store a user-stated detail', sui_read: 'Read Sui chain data',
}
export const toolLabel = (tool: ToolActivity) => toolLabels[tool.name] || tool.name

export function turnLabel(message: ChatMessage, latest = true) {
  if (message.status === 'error') return 'Turn interrupted'
  if (message.status === 'stopped') return 'Stopped'
  if (message.status === 'complete') return message.question ? latest ? 'Needs your reply' : 'Earlier clarification'
    : message.proposals?.some(proposal => proposal.status === 'pending') ? 'Review required' : 'Reply ready'
  if (!message.memory) return 'Recalling context…'
  if (message.tools?.some(tool => tool.status === 'running')) return 'Using bounded tools…'
  if (message.question) return 'Preparing clarification…'
  return message.plan ? 'Working through the plan…' : 'Preparing reply…'
}
