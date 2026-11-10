import { useEffect, useId, useRef, useState } from 'react'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import type { MemoryHandoff } from './types.ts'
import { agentJson } from './api.ts'
import { downloadText } from './clientSafety.ts'
import { Button, CopyButton, fieldClass } from './ui.tsx'

export default function MemoryHandoffPanel({ accountId, busy }: { accountId: string | null; busy: boolean }) {
  const [handoff, setHandoff] = useState<MemoryHandoff>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const notesId = useId()
  useEffect(() => () => { controller.current?.abort() }, [])
  async function prepare() {
    if (!accountId || busy || controller.current) return
    const abort = new AbortController()
    controller.current = abort
    setPending(true); setError(''); setHandoff(undefined)
    try {
      const result = await agentJson<MemoryHandoff>('/memory/handoff', { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25_000)]) })
      abort.signal.throwIfAborted()
      if (result.accountId !== accountId) throw new Error('The memory connection changed. Refresh your connection before preparing setup.')
      setHandoff(result)
    } catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Cross-tool setup could not be prepared.') }
    finally { if (!abort.signal.aborted) setPending(false); if (controller.current === abort) controller.current = null }
  }
  return <section className="border-b border-secondary p-xl" aria-label="Cross-tool memory setup">
    <h3 className="text-sm font-medium">Use memory in your other tools</h3>
    <p className="mt-md text-xs leading-relaxed text-tertiary">Carry your preferences and lessons into Claude Code or Codex. Each trusted tool authorizes its own delegate on your same account. Different users need separate accounts; namespaces are not permissions.</p>
    <Button size="sm" className="mt-lg" disabled={!accountId || busy || pending} onClick={() => { void prepare() }}>Prepare cross-tool setup</Button>
    {!accountId && <p className="mt-md text-xs text-tertiary">Verify your own Mainnet Walrus connection first. Offline demo memory cannot be handed off.</p>}
    {pending && <p role="status" className="mt-md flex items-center gap-sm text-xs text-secondary"><LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden="true" />Preparing key-free setup notes…</p>}
    {error && <p role="alert" className="mt-md text-xs text-error-primary">{error} Use Prepare to retry.</p>}
    {handoff && <>
      <p className="mt-lg text-xs text-secondary">Setup only: no keys, chat history, or memory text. These details do not grant access.</p>
      <dl className="mt-lg space-y-lg text-xs">{[
        ['Account object ID', handoff.accountId], ['Profile namespace', handoff.namespaces.profile], ['Facts namespace', handoff.namespaces.facts],
      ].map(([label, value]) => <div key={label}><dt className="mb-xs text-tertiary">{label}</dt><dd className="flex items-start gap-sm"><code className="min-w-0 flex-1 break-all text-secondary">{value}</code><CopyButton text={value} label={`Copy ${label.toLowerCase()}`} /></dd></div>)}</dl>
      <div className="mt-lg flex flex-wrap gap-lg">{[['Claude Code guide', handoff.guides.claudeCode], ['Codex guide', handoff.guides.codex], ['MCP reference', handoff.guides.reference]].map(([label, url]) => <a key={label} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-xs rounded-md text-xs text-secondary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-focus-ring">{label}<ExternalLink size={12} className="shrink-0" aria-hidden="true" /></a>)}</div>
      <details className="mt-xl text-xs text-tertiary"><summary className="cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-focus-ring">Key-free setup notes</summary>
        <label htmlFor={notesId} className="mt-lg mb-sm block text-xs text-secondary">Cross-tool setup notes</label>
        <textarea id={notesId} readOnly rows={10} value={handoff.instructions} className={`${fieldClass} workspace-scroll font-mono text-xs`} />
        <div className="mt-md flex flex-wrap items-center gap-sm"><CopyButton text={handoff.instructions} label="Copy cross-tool setup notes" /><Button size="sm" onClick={() => downloadText('recallloop-memory-setup.md', handoff.instructions, 'text/markdown')}>Download setup notes</Button></div>
      </details>
      <p className="mt-lg text-xs leading-relaxed text-tertiary">Check the exact account, relayer, and both namespaces in the other tool. A pending job ID is not a saved blob. This is setup guidance, not live cross-tool validation.</p>
    </>}
  </section>
}
