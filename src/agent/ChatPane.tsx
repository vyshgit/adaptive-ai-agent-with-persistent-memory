import { useEffect, useRef, useState } from 'react'
import { Brain, ArrowRight } from 'lucide-react'
import type { Session, Connection, Phase, ChatMessage, WorkspaceMode } from './types.ts'
import Message from './Message.tsx'
import Composer from './Composer.tsx'
import { Button, Badge } from './ui.tsx'

interface Props {
  session: Session
  connection?: Connection
  busy: boolean
  phase: Phase
  canSend: boolean
  model: string
  onModel: (value: string) => void
  capture: boolean
  onCapture: (value: boolean) => void
  stream: boolean
  onStream: (value: boolean) => void
  selectedFiles: number
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
  const following = useRef(true)
  const last = props.session.messages.at(-1)
  useEffect(() => { setDraft(''); following.current = true; scroll.current?.scrollTo({ top: 0 }) }, [props.session.id])
  useEffect(() => { if (following.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }, [props.session.messages])
  const suggestions = [
    { title: 'Teach a preference', prompt: 'I prefer TypeScript, small reviewable changes, and EUR for prices.' },
    { title: 'Fix the sandbox', prompt: 'Use my TypeScript preferences to fix greet for empty and missing names. Keep the change small.' },
    { title: 'Recall a lesson', prompt: 'What TypeScript preferences or lessons do you remember from our past work?' },
  ]
  return <section aria-label="Agent conversation" className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-primary">
    <header className="flex items-center justify-between gap-md border-b border-secondary px-xl py-lg">
      <div className="min-w-0"><h2 className="truncate text-sm font-semibold" title={props.session.title}>{props.session.title}</h2><p className="mt-xxs text-xs text-tertiary">Coding context + portable memory</p></div>
      <Badge tone={props.connection?.mode === 'mock' ? 'warning' : 'neutral'}>{props.connection?.mode === 'mock' ? 'Mock model' : props.connection?.mode === 'live' ? 'Connected API' : 'Connect a model'}</Badge>
    </header>
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" onScroll={() => {
      const node = scroll.current
      if (node) following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120
    }}>
      {!props.session.messages.length ? <div className="mx-auto flex max-w-2xl flex-col gap-xl p-xl lg:p-3xl">
        <div className="flex items-start gap-lg"><div className="rounded-md border border-utility-brand-200 bg-utility-brand-50 p-sm"><Brain size={22} className="shrink-0 text-fg-brand-primary" /></div>
          <div><h3 className="text-xl font-semibold">A coding workspace that remembers.</h3><p className="mt-sm text-sm text-secondary">Give the agent selected files, review its changes, and teach it what works. Recalled preferences can shape the next session—even after you clear local chat.</p></div>
        </div>
        <div className="flex flex-col gap-sm">{suggestions.map(item => <button key={item.title} onClick={() => setDraft(item.prompt)}
          className="flex items-center justify-between gap-md rounded-md border border-secondary bg-primary p-lg text-left hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
          <div><span className="text-sm font-medium">{item.title}</span><p className="mt-xs text-xs text-tertiary">{item.prompt}</p></div><ArrowRight size={16} className="shrink-0 text-fg-tertiary" />
        </button>)}</div>
        {!props.canSend && <Button onClick={props.onSettings}>Open model settings</Button>}
        <p className="border-t border-secondary pt-lg text-xs text-tertiary">History and the project are cached in this browser, not saved to your disk. With capture enabled, chat records and extracted user facts go to the configured memory backend. Mock memory disappears when the server restarts. Do not include secrets or sensitive code.</p>
      </div> : props.session.messages.map(message => <Message key={message.id} message={message} busy={props.busy} onReview={props.onReview} onFeedback={() => props.onFeedback(message)}
        onRetry={message === last && props.canSend ? () => props.onRetry(message) : undefined} />)}
    </div>
    <Composer value={draft} onChange={setDraft} onSend={() => { if (props.canSend && draft.trim()) { props.onSend(draft); setDraft('') } }} onStop={props.onStop}
      model={props.model} onModel={props.onModel} connection={props.connection} busy={props.busy} disabled={!props.canSend} phase={props.phase}
      capture={props.capture} onCapture={props.onCapture} stream={props.stream} onStream={props.onStream} files={props.selectedFiles} mode={props.mode} onMode={props.onMode} />
  </section>
}
