import { useRef } from 'react'
import type { RefObject } from 'react'
import { ArrowUp, Square, FileCode2, LoaderCircle } from 'lucide-react'
import type { Connection, Phase, WorkspaceMode, MemoryStatus } from './types.ts'
import { Button, Checkbox, fieldClass } from './ui.tsx'

interface Props {
  inputRef?: RefObject<HTMLTextAreaElement>
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
  memoryStatus?: MemoryStatus
  onFiles: () => void
  mode: WorkspaceMode
  onMode: (mode: WorkspaceMode) => void
}

export default function Composer({ inputRef, value, onChange, onSend, onStop, model, onModel, connection, busy, disabled, phase, capture, onCapture, stream, onStream, files, memoryStatus, onFiles, mode, onMode }: Props) {
  const ownInput = useRef<HTMLTextAreaElement>(null)
  const input = inputRef || ownInput
  const tooLong = value.length > 4000
  const modeHint = mode === 'build' ? 'Propose code changes when requested. You approve every edit.' : mode === 'plan' ? 'Make a plan using recalled context. No code proposals.' : 'Discuss, decide, and share context. No code proposals.'
  const captureHint = !capture ? 'Capture off' : memoryStatus?.mode === 'mock' ? 'Mock capture · ephemeral'
    : memoryStatus?.mode === 'relayer' && memoryStatus.writeReady ? 'Walrus capture · costs apply' : 'Capture on · storage unavailable'
  return <form className="workspace-scroll min-h-0 shrink overflow-y-auto bg-primary px-xl pb-xl pt-lg sm:px-3xl" onSubmit={event => { event.preventDefault(); if (!busy && !disabled && value.trim() && !tooLong) onSend() }}>
    <div className="mx-auto w-full max-w-3xl">
    <div className="mb-lg flex flex-wrap items-center justify-between gap-sm">
      <div className="inline-flex rounded-lg border border-secondary bg-secondary p-xxs" role="group" aria-label="Workspace mode" aria-describedby="mode-hint">{(['talk', 'plan', 'build'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => onMode(value)} className={`workspace-control min-h-8 rounded-md border border-transparent px-lg py-xs text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50 ${mode === value ? 'bg-primary text-primary shadow-xs' : 'text-tertiary hover:bg-secondary-hover hover:text-secondary'}`}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      <Button quiet size="sm" aria-label="Open project files" onClick={onFiles}><FileCode2 size={14} className="shrink-0" aria-hidden="true" />{files} {files === 1 ? 'file' : 'files'}</Button>
    </div>
    <p id="mode-hint" className="mb-lg text-xs text-tertiary">{modeHint} No commands run.</p>
    <div className="workspace-composer-surface rounded-xl border border-primary bg-secondary p-lg focus-within:border-brand">
    <label htmlFor="agent-message" className="sr-only">Message RecallLoop</label>
    <textarea id="agent-message" ref={input} rows={3} maxLength={4001} value={value} onChange={event => onChange(event.target.value)} disabled={busy}
      placeholder={disabled ? 'Connect a model to begin…' : mode === 'build' ? 'Describe a small change to build…' : mode === 'plan' ? 'What should we plan or investigate?' : 'Ask a question or share what you learned…'}
      className="workspace-scroll min-h-24 w-full resize-none rounded-md border border-transparent bg-secondary px-xs py-md text-md leading-relaxed text-primary placeholder:text-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50" aria-describedby="composer-hint" onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && !disabled && value.trim() && !tooLong) onSend() }
      }} />
    <div className="mt-md flex items-center justify-between gap-md">
      <div className="flex min-w-0 flex-1 flex-col gap-xs">
        <label htmlFor="agent-model" className="sr-only">Model for this turn</label>
         <select id="agent-model" value={model} onChange={event => onModel(event.target.value)} disabled={busy || !connection?.models.length} className={`${fieldClass} max-w-64 truncate`}>
          {!connection?.models.length && <option value="">No model connected</option>}
          {connection?.models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      {busy ? <Button onClick={onStop}><Square size={14} className="shrink-0" aria-hidden="true" />Stop</Button>
        : <Button primary type="submit" disabled={disabled || !value.trim() || tooLong}><ArrowUp size={16} className="shrink-0" aria-hidden="true" />Send</Button>}
    </div>
    </div>
    <div className="mt-lg flex flex-wrap items-start justify-between gap-md">
      <details className="min-w-0 flex-1 text-xs text-tertiary"><summary className="cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">Turn options <span className="ml-sm">· {captureHint}{!stream ? ' · non-streamed' : ''}</span></summary>
      <div className="mt-lg flex flex-wrap items-center gap-xl">
        <Checkbox checked={capture} onChange={onCapture} disabled={busy}>Capture chat &amp; user facts</Checkbox>
        <Checkbox checked={stream} onChange={onStream} disabled={busy}>Stream</Checkbox>
      </div><p className="mt-md text-xs leading-relaxed text-tertiary">Automatic capture sends chat and extracted user facts to the memory backend. The Walrus relayer sees plaintext. Mock memory disappears on restart. Streaming and function support depend on the selected model; check them in Settings.</p></details>
      <span className={`shrink-0 text-xs ${tooLong ? 'text-error-primary' : 'text-tertiary'}`} aria-live={tooLong ? 'polite' : 'off'}>{value.length}/4000</span>
    </div>
    <p id="composer-hint" className="mt-lg text-xs text-tertiary">Enter to send · Shift+Enter for a new line · Never share secrets.</p>
    {busy && <p role="status" className="mt-md flex items-center gap-sm text-xs text-secondary"><LoaderCircle size={13} className="shrink-0 animate-spin" aria-hidden="true" />{phase === 'recalling' ? 'Recalling memory…' : phase === 'tools' ? 'Using bounded tools…' : phase === 'planning' ? 'Working plan shared · preparing the next step…' : phase === 'storing' ? 'Reply ready · waiting for capture confirmation…' : 'Preparing reply…'}</p>}
    </div>
  </form>
}
