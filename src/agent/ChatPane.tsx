import { useEffect, useRef, useState } from 'react'
import { Layers2, ArrowUpRight } from 'lucide-react'
import type { Session, Connection, Phase, ChatMessage, WorkspaceMode, MemoryStatus } from './types.ts'
import Message from './Message.tsx'
import Composer from './Composer.tsx'
import { Button, Badge } from './ui.tsx'
import { modelStatus } from './providers.ts'

interface Props {
  session: Session
  connection?: Connection
  connections: Connection[]
  modelChoice: string
  busy: boolean
  phase: Phase
  canSend: boolean
  model: string
  onModel: (value: string) => void
  capture: boolean
  onCapture: (value: boolean) => void
  captureRaw: boolean
  onCaptureRaw: (value: boolean) => void
  stream: boolean
  onStream: (value: boolean) => void
  selectedFiles: number
  memoryStatus?: MemoryStatus
  onFiles: () => void
  onSend: (value: string) => void
  onStop: () => void
  onRetry: (message: ChatMessage) => void
  onReview: () => void
  onFeedback: (message: ChatMessage) => void
  onSettings: () => void
  mode: WorkspaceMode
  onMode: (mode: WorkspaceMode) => void
}

export default function ChatPane(props: Props) {
  const [draft, setDraft] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const following = useRef(true)
  const last = props.session.messages.at(-1)
  useEffect(() => { setDraft(''); following.current = true; scroll.current?.scrollTo({ top: 0 }) }, [props.session.id])
  useEffect(() => { if (following.current && scroll.current) scroll.current.scrollTop = props.session.messages.length ? scroll.current.scrollHeight : 0 }, [props.session.messages])
  const suggestions = [
    { title: 'Remember a preference', hint: 'Useful context is remembered automatically', mode: 'talk' as const, prompt: 'I prefer short, practical plans and EUR for prices.' },
    { title: 'Plan a short trip', hint: 'Start with what you’ve already shared', mode: 'plan' as const, prompt: 'Plan a quick trip to Alaska. Recall my departure city and travel preferences first, and ask if anything important is missing.' },
    { title: 'Review a code change', hint: 'Inspect the sandbox and approve every edit', mode: 'build' as const, prompt: 'Use my TypeScript preferences to fix greet for empty and missing names. Keep the change small.' },
  ]
  const connectionStatus = modelStatus(props.connection, props.model)
  return <section aria-label="Agent conversation" className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-primary">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-md border-b border-secondary px-xl py-lg sm:px-3xl">
      <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-medium" title={props.session.title}>{props.session.title}</h2></div>
      <Badge tone={connectionStatus.tone}>{connectionStatus.label}</Badge>
    </header>
    <div ref={scroll} className="workspace-scroll min-h-24 flex-1 overflow-y-auto overscroll-contain" onScroll={() => {
      const node = scroll.current
      if (node) following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120
    }}>
      {!props.session.messages.length ? <div className="workspace-enter mx-auto flex w-full max-w-2xl flex-col gap-xl px-xl py-3xl sm:p-3xl lg:py-4xl">
        <div className="flex flex-col items-start gap-md"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-secondary bg-secondary"><Layers2 size={21} className="shrink-0 text-fg-secondary" aria-hidden="true" /></span>
          <div><h3 className="text-heading-xs font-semibold">Where should we start?</h3><p className="mt-md text-sm text-secondary">Pick up an idea, plan something, or review a code change. Relevant memories come first; missing details get a question, not a guess.</p></div>
        </div>
        {!props.canSend && <div><Button primary onClick={props.onSettings}>Connect a model</Button><p className="mt-md text-xs text-tertiary">A model is enough to start; Tatum and Walrus Memory are optional.</p></div>}
        <div className="divide-y divide-secondary border-y border-secondary">{suggestions.map(item => <div key={item.title}><button type="button" onClick={() => { setDraft(item.prompt); props.onMode(item.mode) }}
          className="workspace-control flex w-full items-center justify-between gap-lg rounded-md border border-transparent px-lg py-xl text-left hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
          <div className="min-w-0"><span className="text-sm font-medium">{item.title}</span><p className="mt-xs text-xs text-tertiary">{item.hint}</p></div><ArrowUpRight size={15} className="shrink-0 text-fg-tertiary" aria-hidden="true" />
        </button></div>)}</div>
        <p className="text-xs text-tertiary">History uses this login’s tab cache. Auto-memory saves relevant user context to connected Walrus memory; raw chat needs a separate choice. Turn auto-memory off below whenever you need.</p>
      </div> : props.session.messages.map(message => <Message key={message.id} message={message} busy={props.busy} latest={message === last} onReview={props.onReview} onFeedback={() => props.onFeedback(message)}
        onDraftReply={message === last && props.canSend ? reply => {
          if (reply) setDraft(old => [old, reply].filter(Boolean).join('\n'))
          composer.current?.focus({ preventScroll: true }); composer.current?.scrollIntoView({ block: 'nearest' })
        } : undefined}
        onRetry={message === last && props.canSend ? () => { following.current = true; props.onRetry(message) } : undefined} />)}
    </div>
    <Composer inputRef={composer} value={draft} onChange={setDraft} onSend={() => { if (props.canSend && draft.trim()) { following.current = true; props.onSend(draft); setDraft('') } }} onStop={props.onStop}
      model={props.modelChoice} onModel={props.onModel} connections={props.connections} busy={props.busy} disabled={!props.canSend} phase={props.phase}
      capture={props.capture} onCapture={props.onCapture} captureRaw={props.captureRaw} onCaptureRaw={props.onCaptureRaw} stream={props.stream} onStream={props.onStream} memoryStatus={props.memoryStatus} files={props.selectedFiles} onFiles={props.onFiles} mode={props.mode} onMode={props.onMode} />
  </section>
}
