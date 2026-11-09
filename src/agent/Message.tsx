import { CornerDownRight, User, GitPullRequest, MessageSquarePlus, CheckCircle2 } from 'lucide-react'
import type { ChatMessage } from './types.ts'
import { Badge, Button } from './ui.tsx'
import MemoryChips from './MemoryChips.tsx'
import MarkdownMessage from './MarkdownMessage.tsx'
import { PlanBlock, QuestionBlock, ToolLog } from './TurnWorkflow.tsx'
import { turnLabel } from './workflow.ts'

export default function Message({ message, busy, latest = false, onReview, onFeedback, onRetry, onDraftReply }: { message: ChatMessage; busy: boolean; latest?: boolean; onReview: () => void; onFeedback: () => void; onRetry?: () => void; onDraftReply?: (reply: string) => void }) {
  const assistant = message.role === 'assistant'
  const running = ['pending', 'streaming'].includes(message.status)
  return <article className="workspace-enter px-xl py-2xl sm:px-3xl">
    <div className={`mx-auto w-full max-w-3xl ${assistant ? '' : 'rounded-xl border border-secondary bg-secondary p-xl'}`}>
    <header className="mb-md flex flex-wrap items-center justify-between gap-sm">
      <span className="flex min-w-0 items-center gap-md text-sm font-medium">{assistant ? <CornerDownRight size={17} className="shrink-0 text-fg-secondary" aria-hidden="true" /> : <User size={15} className="shrink-0 text-fg-tertiary" aria-hidden="true" />}{assistant ? 'RecallLoop' : 'You'}{assistant && message.model && <span className="max-w-48 truncate text-xs font-regular text-tertiary" title={message.model}>{message.model}</span>}</span>
      {message.status === 'stopped' && <Badge tone="warning">Stopped · partial answer</Badge>}
      {assistant && message.status !== 'stopped' && <span className="text-xs text-tertiary">{turnLabel(message, latest)}</span>}
    </header>
    {assistant && <MemoryChips memory={message.memory} />}
    {message.plan && <PlanBlock plan={message.plan} />}
    {message.tools && <ToolLog tools={message.tools} running={running} />}
    {message.content ? <div aria-live={running ? 'polite' : 'off'} aria-atomic="false">{assistant ? <MarkdownMessage content={message.content} /> : <p className="whitespace-pre-wrap break-words text-md leading-relaxed">{message.content}</p>}</div> : running && !message.question && <p role="status" className="text-sm text-tertiary">{message.memory ? 'Preparing a reply…' : 'Recalling memory…'}</p>}
    {message.question && <QuestionBlock question={message.question} latest={latest} busy={busy} onDraftReply={message.status === 'complete' ? onDraftReply : undefined} />}
    {message.proposals && message.proposals.length > 0 && <div className="mt-lg flex flex-wrap items-center gap-sm">
      <Button size="sm" onClick={onReview}><GitPullRequest size={14} className="shrink-0" aria-hidden="true" />Review {message.proposals.length} {message.proposals.length === 1 ? 'change' : 'changes'}</Button>
      <span className="text-xs text-tertiary">{message.proposals.filter(proposal => proposal.status === 'pending').length} awaiting approval · no commands run</span>
    </div>}
    {message.error && <p role="alert" className="mt-lg text-sm text-error-primary">{message.error}</p>}
    {onRetry && !busy && (message.retryable || message.status === 'stopped') && <Button className="mt-md" onClick={onRetry}>Retry this turn</Button>}
    {assistant && message.status === 'complete' && <footer className="mt-xl flex flex-wrap items-center justify-between gap-md border-t border-secondary pt-lg">
      <div className="text-xs text-tertiary">
        {!message.stored ? <span>Waiting for capture confirmation…</span> : message.stored.skipped ? <span>Memory capture off for this turn.</span>
          : message.stored.pending ? <span className="text-warning-primary" title={message.stored.message}>Capture pending. Refresh inventory before retrying.</span>
            : message.stored.failed ? <span className="text-warning-primary">{message.stored.verbatim + message.stored.facts} confirmed; {message.stored.failed} unconfirmed. {message.stored.message}</span>
              : <span className="inline-flex items-center gap-xs"><CheckCircle2 size={13} className="shrink-0" />{message.stored.verbatim} transcript records · {message.stored.facts} facts confirmed</span>}
      </div>
      <Button quiet size="sm" disabled={busy} onClick={onFeedback}><MessageSquarePlus size={14} className="shrink-0" aria-hidden="true" />Record outcome</Button>
    </footer>}
    </div>
  </article>
}
