import { ListChecks, Wrench, CornerDownRight } from 'lucide-react'
import type { WorkingPlan, Clarification, ToolActivity } from './types.ts'
import { Badge, Button } from './ui.tsx'
import { toolLabel } from './workflow.ts'

export function PlanBlock({ plan }: { plan: WorkingPlan }) {
  return <section aria-label="Working plan" className="workspace-detail-enter mb-xl rounded-xl border border-secondary bg-secondary p-xl">
    <h3 className="flex items-center gap-sm text-sm font-medium"><ListChecks size={16} className="shrink-0 text-fg-tertiary" aria-hidden="true" />Working plan</h3>
    <p className="mt-md text-sm text-secondary">{plan.summary}</p>
    <ol className="mt-lg list-decimal space-y-md pl-xl text-sm leading-relaxed text-secondary">{plan.steps.map((step, i) => <li key={i} className="pl-xs break-words">{step}</li>)}</ol>
    <p className="mt-lg border-t border-secondary pt-md text-xs text-tertiary">Proposed steps, not completed actions. This does not approve changes.</p>
  </section>
}

export function ToolLog({ tools, running }: { tools: ToolActivity[]; running: boolean }) {
  if (!tools.length) return null
  const status = { running: 'Running', done: 'Finished', error: 'Failed', blocked: 'Not run' } as const
  return <details className="mb-xl text-xs text-secondary" open={running && tools.some(tool => tool.status === 'running') ? true : undefined}>
    <summary className="cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"><span className="ml-xs inline-flex items-center gap-sm"><Wrench size={13} className="shrink-0" aria-hidden="true" />Activity · {tools.length} bounded {tools.length === 1 ? 'call' : 'calls'}</span></summary>
    <ul className="mt-md divide-y divide-secondary border-y border-secondary">{tools.map(tool => <li key={tool.id} className="flex items-start justify-between gap-md py-lg">
      <div className="min-w-0"><span className="text-sm">{toolLabel(tool)}</span><code className="ml-sm text-xs text-tertiary">{tool.name}</code>{tool.preview && <p className="mt-xs break-words text-tertiary">{tool.preview}</p>}</div>
      <Badge tone={tool.status === 'error' ? 'error' : tool.status === 'blocked' ? 'warning' : tool.status === 'running' ? 'brand' : 'neutral'}>{status[tool.status]}</Badge>
    </li>)}</ul>
  </details>
}

export function QuestionBlock({ question, latest, busy, onDraftReply }: { question: Clarification; latest: boolean; busy: boolean; onDraftReply?: (reply: string) => void }) {
  return <section aria-label="Clarification" className="workspace-detail-enter mt-xl rounded-xl border border-secondary bg-secondary p-xl">
    <div className="flex items-start justify-between gap-lg"><h3 className="min-w-0 break-words text-sm font-medium">{question.question}</h3><CornerDownRight size={16} className="mt-xxs shrink-0 text-fg-tertiary" aria-hidden="true" /></div>
    {question.why && <p className="mt-md break-words text-sm leading-relaxed text-secondary">{question.why}</p>}
    {latest ? <><div className="mt-lg flex flex-wrap gap-sm">{question.options.map(option => <Button key={option} size="sm" className="max-w-full whitespace-normal break-words text-left" disabled={busy || !onDraftReply} onClick={() => onDraftReply?.(option)}>{option}</Button>)}
      <Button quiet size="sm" disabled={busy || !onDraftReply} onClick={() => onDraftReply?.('')}>Write a reply</Button></div>
      <p className="mt-md text-xs leading-relaxed text-tertiary">Reply in the composer. Suggested replies only fill the draft; nothing is sent until you press Send.</p>
    </> : <p className="mt-lg text-xs text-tertiary">Earlier clarification. See the following messages for the continuation.</p>}
  </section>
}
