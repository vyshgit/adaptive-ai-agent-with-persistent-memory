import { useRef } from 'react'
import { Send, Square, FileCode2 } from 'lucide-react'
import type { Connection, Phase, WorkspaceMode } from './types.ts'
import { Button, Checkbox, fieldClass, Badge } from './ui.tsx'

interface Props {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  model: string
  onModel: (value: string) => void
  connection?: Connection
  busy: boolean
  disabled: boolean
  phase: Phase
  capture: boolean
  onCapture: (value: boolean) => void
  stream: boolean
  onStream: (value: boolean) => void
  files: number
  mode: WorkspaceMode
  onMode: (mode: WorkspaceMode) => void
}

export default function Composer({ value, onChange, onSend, onStop, model, onModel, connection, busy, disabled, phase, capture, onCapture, stream, onStream, files, mode, onMode }: Props) {
  const input = useRef<HTMLTextAreaElement>(null)
  const tooLong = value.length > 4000
  return <form className="shrink-0 border-t border-secondary bg-primary p-lg" onSubmit={event => { event.preventDefault(); if (!busy && !disabled && value.trim() && !tooLong) onSend() }}>
    <div className="mb-md flex flex-wrap items-center justify-between gap-sm">
      <div className="inline-flex rounded-md border border-primary p-xxs" role="group" aria-label="Workspace mode">{(['talk', 'plan', 'build'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => onMode(value)} className={`rounded-xs px-md py-xs text-xs font-medium focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50 ${mode === value ? 'bg-secondary text-primary' : 'text-tertiary hover:bg-primary-hover'}`}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      <span className="inline-flex items-center gap-xs text-xs text-tertiary"><FileCode2 size={14} className="shrink-0" />{files} selected {files === 1 ? 'file' : 'files'}</span>
      {busy && <Badge tone="brand">{phase === 'recalling' ? 'Recalling' : phase === 'tools' ? 'Using tools' : phase === 'storing' ? 'Answer complete · capturing' : 'Generating'}</Badge>}
    </div>
    <label htmlFor="agent-message" className="sr-only">Message the coding agent</label>
    <textarea id="agent-message" ref={input} rows={3} maxLength={4001} value={value} onChange={event => onChange(event.target.value)} disabled={busy}
      placeholder={disabled ? 'Connect a model in Settings to begin…' : 'Ask for a change, share a preference, or explain what failed…'}
      className={`${fieldClass} resize-none`} aria-describedby="composer-hint" onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && !disabled && value.trim() && !tooLong) onSend() }
      }} />
    <div className="mt-md flex flex-wrap items-center justify-between gap-md">
      <div className="flex min-w-0 flex-1 flex-col gap-xs">
        <label htmlFor="agent-model" className="sr-only">Model for this turn</label>
        <select id="agent-model" value={model} onChange={event => onModel(event.target.value)} disabled={busy || !connection?.models.length} className={`${fieldClass} max-w-64`}>
          {!connection?.models.length && <option value="">No model connected</option>}
          {connection?.models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      {busy ? <Button onClick={onStop}><Square size={14} className="shrink-0" />Stop</Button>
        : <Button primary type="submit" disabled={disabled || !value.trim() || tooLong}><Send size={15} className="shrink-0" />Send</Button>}
    </div>
    <div className="mt-md flex flex-wrap items-center justify-between gap-sm">
      <div className="flex flex-wrap items-center gap-lg text-xs">
        <Checkbox checked={capture} onChange={onCapture} disabled={busy}>Capture chat &amp; user facts</Checkbox>
        <Checkbox checked={stream} onChange={onStream} disabled={busy}>Stream</Checkbox>
      </div>
      <span className={`text-xs ${tooLong ? 'text-error-primary' : 'text-tertiary'}`}>{value.length}/4000</span>
    </div>
    <p id="composer-hint" className="mt-md text-xs text-tertiary">Enter to send · Shift+Enter for a new line. {mode === 'build' ? 'Build proposes changes for review.' : mode === 'plan' ? 'Plan inspects files but cannot propose changes.' : 'Talk answers questions without code-change proposals.'} No commands are run.</p>
  </form>
}
