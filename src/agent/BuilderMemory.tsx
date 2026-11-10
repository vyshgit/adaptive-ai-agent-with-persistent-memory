import { useState } from 'react'
import { Search, ClipboardCheck, Plus } from 'lucide-react'
import { Badge, Button, Checkbox, fieldClass } from './ui.tsx'
import type { BuilderRecall, CheckpointDraft } from './builderTypes.ts'
import type { MemoryStatus } from './types.ts'
import MemoryHandoffPanel from './MemoryHandoff.tsx'

export default function BuilderMemory({ name, status, busy, autoRecall, autoMemory, recall, recallExpired, memoryIds, handoffAccountId, onMemoryIds, onRecall, onClearRecall, onCheckpoint, onSettings }: {
  name: string; status?: MemoryStatus; busy: boolean; recall: BuilderRecall | null; recallExpired: boolean; memoryIds: string[]; onMemoryIds: (ids: string[]) => void
  autoRecall: boolean; autoMemory: boolean
  onRecall: (query: string, raw: boolean) => void; onClearRecall: () => void; onCheckpoint: (draft: CheckpointDraft) => void; onSettings: () => void; handoffAccountId: string | null
}) {
  const [query, setQuery] = useState('')
  const [raw, setRaw] = useState(false)
  const [checkpoint, setCheckpoint] = useState(false)
  const [draft, setDraft] = useState<CheckpointDraft>({ project: name, revision: '', preferences: '', decisions: '', nextSteps: '' })
  const configured = Boolean(status?.accountConfigured)
  const ready = status?.mode === 'mock' || Boolean(status?.healthy && status.accountConfigured)
  const writeReady = status?.mode === 'mock' || Boolean(ready && status?.writeReady)
  const update = (key: keyof CheckpointDraft, value: string) => setDraft(old => ({ ...old, [key]: value }))
  return <div className="space-y-xl p-xl">
    <div className="flex flex-wrap items-center justify-between gap-sm"><Badge tone={status?.mode === 'mock' ? 'warning' : ready ? 'success' : configured ? 'warning' : 'neutral'}>{status?.mode === 'mock' ? 'Mock · ephemeral' : ready ? status?.network === 'mainnet' ? 'Mainnet · connected' : 'Memory connected' : configured ? 'Memory unavailable' : 'Not connected'}</Badge><Button quiet size="sm" disabled={busy} onClick={onSettings}>Memory settings</Button></div>
    <section className="space-y-md" aria-label="Automatic project memory">
      <h3 className="text-sm font-semibold">Automatic memory</h3>
      <p className="text-xs leading-relaxed text-secondary">{!autoRecall ? 'Auto-recall is off. Enable it in the composer to use relevant saved facts automatically.' : ready ? 'Before each task, relevant saved profile/facts are fetched and included automatically. No search or attachment step is needed.' : configured ? 'Auto-recall is on. Walrus is temporarily unavailable; tasks continue with any available context.' : 'Auto-recall is on. Connect Walrus to include relevant saved facts before each task automatically.'}</p>
      <p className="text-xs leading-relaxed text-secondary">{!autoMemory ? 'Automatic saving is off. Enable Auto-memory in the composer to remember new facts.' : status?.mode === 'mock' ? 'After completed tasks, useful new user facts are saved automatically to ephemeral mock memory.' : writeReady && status?.network === 'mainnet' ? 'After completed tasks, useful new user facts are saved automatically to your Mainnet Walrus account. No per-memory approval is needed.' : configured ? 'Auto-memory is on, but Walrus is not currently write-ready. Check Memory settings to restore automatic saving.' : 'Auto-memory is on. Connect a write-ready Mainnet Walrus account to save useful new facts automatically after completed tasks.'}</p>
      <p className="text-xs leading-relaxed text-tertiary">Each task shows the context used and its save status. A confirmed blob ID means the write completed. Memory settings apply to this login.</p>
    </section>
    {!ready && <p className="border-y border-secondary py-lg text-xs text-tertiary">{configured ? 'Check the connection in Memory settings, then retry your memory lookup.' : 'Connect your Tatum Mainnet key and wallet-owned Walrus account in Memory settings.'}</p>}
    <section className="space-y-lg border-t border-secondary pt-xl" aria-label="Reviewed memory recall">
      <h3 className="text-sm font-semibold">Search memories (optional)</h3>
      <p className="text-xs text-tertiary">Inspect saved facts or pin specific context for your next task.</p>
      <label className="block text-sm text-secondary" htmlFor="builder-recall-query">Memory query</label><input id="builder-recall-query" className={fieldClass} maxLength={2000} value={query} disabled={busy} onChange={event => setQuery(event.target.value)} placeholder="Preferences, architecture decisions, next steps…" />
      <Checkbox checked={raw} onChange={setRaw} disabled={busy}>Also retrieve raw chat (separate consent)</Checkbox>
      <div><Button disabled={busy || !ready || !query.trim()} onClick={() => onRecall(query, raw)}><Search size={15} className="shrink-0" aria-hidden="true" />Recall and review</Button></div>
      {recall && <><p role="status" className="text-xs text-tertiary">{recallExpired ? 'Recall expired. Search again or clear any pinned attachments before sending a task.' : recall.unavailable ? 'Memory lookup was incomplete. Any available results are shown below.' : !recall.memories.length ? 'No relevant memories found for this search.' : `${recall.memories.length} memories found. Select any you want to pin to your next task.`}</p><ul className="divide-y divide-secondary">{recall.memories.map((memory, index) => <li key={memory.blobId} className="py-lg"><Checkbox checked={memoryIds.includes(memory.blobId)} disabled={busy || recallExpired || recall.expiresAt <= Date.now()} onChange={checked => onMemoryIds(checked ? [...memoryIds, memory.blobId] : memoryIds.filter(id => id !== memory.blobId))}>Attach reviewed memory {index + 1} · {memory.tier || 'facts'}</Checkbox><p className="mt-md whitespace-pre-wrap break-words text-sm text-secondary">{memory.text}</p><code className="mt-sm block break-all text-xs text-tertiary">{memory.blobId}</code></li>)}</ul><p className="text-xs text-tertiary">Pinned selections expire after five minutes or a memory-connection change. Auto-recall fetches fresh relevant facts for each task. The selected model receives included plaintext.</p><Button quiet size="sm" disabled={busy} onClick={onClearRecall}>Clear recalled context</Button></>}
    </section>
    <section className="space-y-lg border-t border-secondary pt-xl" aria-label="Reviewed project checkpoint">
      <div className="flex flex-wrap items-center justify-between gap-sm"><h3 className="text-sm font-semibold">Project checkpoint</h3><Button size="sm" aria-expanded={checkpoint} onClick={() => setCheckpoint(old => !old)}><Plus size={14} className="shrink-0" aria-hidden="true" />{checkpoint ? 'Hide checkpoint form' : 'New checkpoint'}</Button></div>
      <p className="text-xs text-tertiary">Optional: add a detailed outcome or next step beyond automatic fact capture. This custom checkpoint has its own text review.</p>
      <div className={checkpoint ? 'space-y-lg' : 'hidden'}>
      <p className="text-xs text-tertiary">Fill these fields yourself. No file contents, task transcript or terminal output is collected automatically. Saving requires a separate review and confirmed blob result.</p>
      <div className="space-y-lg"><div><label className="mb-sm block text-sm text-secondary" htmlFor="checkpoint-project">Portable project label</label><input id="checkpoint-project" className={fieldClass} maxLength={120} value={draft.project} disabled={busy} onChange={event => update('project', event.target.value)} /></div><div><label className="mb-sm block text-sm text-secondary" htmlFor="checkpoint-revision">Revision/reference (optional)</label><input id="checkpoint-revision" className={fieldClass} maxLength={200} value={draft.revision} disabled={busy} onChange={event => update('revision', event.target.value)} placeholder="Commit or project reference" /></div></div>
      {([{ key: 'preferences', label: 'Reviewed preferences', max: 3000 }, { key: 'decisions', label: 'Reviewed decisions / outcome', max: 5000 }, { key: 'nextSteps', label: 'Next steps', max: 3000 }] as const).map(item => <div key={item.key}><label className="mb-sm block text-sm text-secondary" htmlFor={`checkpoint-${item.key}`}>{item.label}</label><textarea id={`checkpoint-${item.key}`} rows={3} className={fieldClass} maxLength={item.max} value={draft[item.key]} disabled={busy} onChange={event => update(item.key, event.target.value)} /></div>)}
      <Button disabled={busy || !writeReady || !draft.project.trim() || ![draft.preferences, draft.decisions, draft.nextSteps].some(value => value.trim())} onClick={() => onCheckpoint(draft)}><ClipboardCheck size={15} className="shrink-0" aria-hidden="true" />Review checkpoint text</Button>
      </div>
    </section>
    <details className="border-t border-secondary pt-xl"><summary className="cursor-pointer rounded-md text-sm text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring">Use Walrus with another tool</summary><MemoryHandoffPanel key={handoffAccountId || 'unconnected'} accountId={handoffAccountId} busy={busy} /></details>
  </div>
}
