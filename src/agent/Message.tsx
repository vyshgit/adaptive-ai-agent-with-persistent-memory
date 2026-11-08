import { Bot, User, Wrench, GitPullRequest, MessageSquarePlus, CheckCircle2 } from 'lucide-react'
import type { ChatMessage } from './types.ts'
import { Badge, Button } from './ui.tsx'
import MemoryChips from './MemoryChips.tsx'

function MessageText({ content }: { content: string }) {
  // Render text and fenced code only. Never inject model HTML or execute generated code.
  return <div className="min-w-0 space-y-md text-sm leading-relaxed">
    {content.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g).filter(Boolean).map((part, index) => part.startsWith('```')
      ? <pre key={index} className="overflow-x-auto rounded-md bg-secondary p-lg font-mono text-xs text-secondary"><code>{part.replace(/^```[^\n]*\n/, '').replace(/```$/, '')}</code></pre>
      : <p key={index} className="whitespace-pre-wrap break-words">{part}</p>)}
  </div>
}

export default function Message({ message, busy, onReview, onFeedback, onRetry }: { message: ChatMessage; busy: boolean; onReview: () => void; onFeedback: () => void; onRetry?: () => void }) {
  const assistant = message.role === 'assistant'
  const running = ['pending', 'streaming'].includes(message.status)
  return <article className={`border-b border-secondary p-xl ${assistant ? 'bg-primary' : 'bg-secondary'}`}>
    <header className="mb-md flex flex-wrap items-center justify-between gap-sm">
      <span className="flex items-center gap-sm text-sm font-semibold">{assistant ? <Bot size={17} className="shrink-0 text-fg-tertiary" /> : <User size={17} className="shrink-0 text-fg-tertiary" />}{assistant ? 'RecallLoop' : 'You'}{assistant && message.model && <span className="max-w-48 truncate text-xs font-regular text-tertiary" title={message.model}>{message.model}</span>}</span>
      {message.status === 'stopped' && <Badge tone="warning">Stopped · partial answer</Badge>}
    </header>
    {assistant && <MemoryChips memory={message.memory} />}
    {message.tools && message.tools.length > 0 && <details className="mb-lg text-xs text-secondary">
      <summary className="cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-focus-ring"><span className="ml-xs inline-flex items-center gap-sm"><Wrench size={13} />{message.tools.length} bounded {message.tools.length === 1 ? 'tool' : 'tools'}</span></summary>
      <ul className="mt-sm space-y-sm">{message.tools.map(tool => <li key={tool.id} className="flex items-start justify-between gap-sm rounded-md bg-secondary p-md">
        <div className="min-w-0"><code>{tool.name}</code>{tool.preview && <p className="mt-xs break-words text-tertiary">{tool.preview}</p>}</div>
        <Badge tone={tool.status === 'error' ? 'error' : tool.status === 'running' ? 'brand' : 'neutral'}>{tool.status}</Badge>
      </li>)}</ul>
    </details>}
    {message.content ? <div aria-live={running ? 'polite' : 'off'} aria-atomic="false"><MessageText content={message.content} /></div> : running && <p role="status" className="text-sm text-tertiary">{message.memory ? 'Inspecting context and generating…' : 'Recalling memory…'}</p>}
    {message.proposals && message.proposals.length > 0 && <div className="mt-lg flex flex-wrap items-center gap-sm">
      <Button onClick={onReview}><GitPullRequest size={14} className="shrink-0" />Review {message.proposals.length} {message.proposals.length === 1 ? 'change' : 'changes'}</Button>
      <span className="text-xs text-tertiary">{message.proposals.filter(proposal => proposal.status === 'pending').length} awaiting approval · no commands run</span>
    </div>}
    {message.error && <p role="alert" className="mt-lg text-sm text-error-primary">{message.error}</p>}
    {onRetry && !busy && (message.retryable || message.status === 'stopped') && <Button className="mt-md" onClick={onRetry}>Retry this turn</Button>}
    {assistant && message.status === 'complete' && <footer className="mt-lg flex flex-wrap items-center justify-between gap-md border-t border-secondary pt-md">
      <div className="text-xs text-tertiary">
        {!message.stored ? <span>Waiting for capture confirmation…</span> : message.stored.skipped ? <span>Memory capture off for this turn.</span>
          : message.stored.pending ? <span className="text-warning-primary" title={message.stored.message}>Capture pending. Refresh inventory before retrying.</span>
            : message.stored.failed ? <span className="text-warning-primary">{message.stored.verbatim + message.stored.facts} confirmed; {message.stored.failed} unconfirmed. {message.stored.message}</span>
              : <span className="inline-flex items-center gap-xs"><CheckCircle2 size={13} className="shrink-0" />{message.stored.verbatim} transcript records · {message.stored.facts} facts confirmed</span>}
      </div>
      <Button disabled={busy} onClick={onFeedback}><MessageSquarePlus size={14} className="shrink-0" />Record outcome</Button>
    </footer>}
  </article>
}
