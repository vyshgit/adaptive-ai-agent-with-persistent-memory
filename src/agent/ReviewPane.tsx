import { useId, useState } from 'react'
import { GitPullRequest, Download, Check, X, Trash2 } from 'lucide-react'
import type { Proposal, Project } from './types.ts'
import { fileDiff } from './diff.ts'
import { downloadText } from './clientSafety.ts'
import { Badge, Button, Modal, Tabs, fieldClass } from './ui.tsx'

export default function ReviewPane({ proposals, project, busy, onApply, onReject, onDismiss, onClear }: { proposals: Proposal[]; project: Project; busy: boolean; onApply: (proposal: Proposal) => void; onReject: (proposal: Proposal) => void; onDismiss: (proposal: Proposal) => void; onClear: () => void }) {
  const [selected, setSelected] = useState('')
  const [view, setView] = useState<'diff' | 'before' | 'after'>('diff')
  const [confirming, setConfirming] = useState(false)
  const id = useId()
  const proposal = proposals.find(proposal => proposal.id === selected) || proposals.find(proposal => proposal.status === 'pending') || proposals.at(-1)
  if (!proposal) return <div className="workspace-enter flex h-full flex-col items-start gap-xl overflow-y-auto p-2xl"><span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-secondary bg-primary"><GitPullRequest size={20} className="shrink-0 text-fg-tertiary" aria-hidden="true" /></span><h2 className="text-lg font-semibold">No changes to review</h2><p className="text-sm leading-relaxed text-secondary">Use Build to request a small change to your selected files. Proposals appear here; nothing applies itself.</p><p className="text-xs leading-relaxed text-tertiary">Talk and Plan do not propose edits. This workspace never runs code, installs packages, or opens a terminal.</p></div>
  const diff = fileDiff(proposal.path, proposal.before, proposal.after)
  const file = project.files.find(file => file.path === proposal.path)
  const stale = proposal.before === null ? Boolean(file) : !file || file.content !== proposal.before
  return <div className="flex h-full min-h-0 flex-col">
    <header className="shrink-0 border-b border-secondary bg-primary p-xl">
      <div className="flex flex-wrap items-center justify-between gap-md"><h2 className="text-sm font-medium">Review proposed code</h2><span className="flex items-center gap-sm"><Badge tone={proposal.status === 'applied' ? 'success' : proposal.status === 'pending' ? 'warning' : 'neutral'}>{proposal.status === 'applied' ? 'Applied in browser' : proposal.status}</Badge><Button size="sm" disabled={busy || !proposals.length} onClick={() => setConfirming(true)}><Trash2 size={14} className="shrink-0" aria-hidden="true" />Clear queue ({proposals.length})</Button></span></div>
      <label htmlFor="review-proposal" className="sr-only">Choose a proposed change</label>
      <select id="review-proposal" className={`${fieldClass} mt-md`} value={proposal.id} onChange={event => setSelected(event.target.value)}>
        {proposals.map(item => <option value={item.id} key={item.id}>{item.path} · {item.status}</option>)}
      </select>
      <p className="mt-md break-words text-sm text-secondary">{proposal.reason}</p>
      <p className="mt-sm text-xs text-tertiary">{diff.lines.filter(line => line.kind === 'added').length} added · {diff.lines.filter(line => line.kind === 'removed').length} removed. No commands or tests were run.</p>
    </header>
    <Tabs value={view} onChange={setView} id={id} label="Proposed file views" tabs={[{ id: 'diff', label: 'Diff' }, { id: 'before', label: 'Before' }, { id: 'after', label: 'After' }]} />
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${view}`} tabIndex={0} className="workspace-scroll min-h-0 flex-1 overflow-auto bg-primary py-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
      {view === 'diff' ? <pre className="font-mono text-xs leading-relaxed">{diff.lines.length ? diff.lines.slice(0, 400).map((line, index) => <div key={index} className={`px-lg ${line.kind === 'added' ? 'bg-utility-success-50 text-utility-success-700' : line.kind === 'removed' ? 'bg-utility-error-50 text-utility-error-700' : 'text-tertiary'}`}>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '} {line.text || ' '}</div>) : <span className="px-lg text-tertiary">No content difference.</span>}</pre>
        : <pre className="px-lg font-mono text-xs leading-relaxed text-secondary"><code>{view === 'before' ? proposal.before ?? '(new file)' : proposal.after}</code></pre>}
      {view === 'diff' && diff.lines.length > 400 && <p className="p-lg text-xs text-tertiary">Diff preview is capped at 400 lines. Before/After show the complete file; the patch download is complete.</p>}
    </div>
    <footer className="flex shrink-0 flex-col gap-lg border-t border-secondary p-xl">
      {stale && proposal.status === 'pending' && <p role="alert" className="text-xs text-warning-primary">The file no longer matches this proposal’s original version. Ask for a fresh proposal. Nothing will be overwritten.</p>}
      <div className="flex flex-wrap gap-sm"><Button primary disabled={busy || stale || proposal.status !== 'pending' || !diff.patch} onClick={() => onApply(proposal)}><Check size={14} className="shrink-0" aria-hidden="true" />Apply in browser</Button>
        <Button disabled={busy || proposal.status !== 'pending'} onClick={() => onReject(proposal)}><X size={14} className="shrink-0" aria-hidden="true" />Reject</Button>
        <Button disabled={busy} onClick={() => onDismiss(proposal)}><Trash2 size={14} className="shrink-0" aria-hidden="true" />Remove from queue</Button></div>
      <Button disabled={!diff.patch} onClick={() => downloadText('recallloop-change.patch', diff.patch)}><Download size={14} className="shrink-0" aria-hidden="true" />Download patch</Button>
      <p className="text-xs text-tertiary">Approval changes only this browser project. Download and inspect the patch before using it on local files. Record an outcome after you test it.</p>
    </footer>
    {confirming && <Modal title="Clear the proposal queue?" onClose={() => setConfirming(false)} footer={<div className="flex gap-sm"><Button primary onClick={() => { setConfirming(false); onClear() }}>Clear queue</Button><Button onClick={() => setConfirming(false)}>Keep proposals</Button></div>}>
      <p className="text-sm text-secondary">This removes all {proposals.length} queued and already reviewed proposals from this session, pending and applied alike. Applied edits already made to your browser project stay in place; nothing is reverted and nothing is written to disk.</p>
    </Modal>}
  </div>
}
