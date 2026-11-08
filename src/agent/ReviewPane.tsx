import { useId, useState } from 'react'
import { GitPullRequest, Download, Check, X } from 'lucide-react'
import type { Proposal, Project } from './types.ts'
import { fileDiff } from './diff.ts'
import { downloadText } from './clientSafety.ts'
import { Badge, Button, Tabs, fieldClass } from './ui.tsx'

export default function ReviewPane({ proposals, project, busy, onApply, onReject }: { proposals: Proposal[]; project: Project; busy: boolean; onApply: (proposal: Proposal) => void; onReject: (proposal: Proposal) => void }) {
  const [selected, setSelected] = useState('')
  const [view, setView] = useState<'diff' | 'before' | 'after'>('diff')
  const id = useId()
  const proposal = proposals.find(proposal => proposal.id === selected) || proposals.find(proposal => proposal.status === 'pending') || proposals.at(-1)
  if (!proposal) return <div className="flex h-full flex-col gap-lg p-xl"><GitPullRequest size={24} className="shrink-0 text-fg-tertiary" /><h2 className="text-lg font-semibold">No changes to review</h2><p className="text-sm text-secondary">Ask the agent to fix the sandbox or work on selected files. Proposed changes appear here and never apply themselves.</p><p className="text-xs text-tertiary">The workspace does not execute code, install packages, or open a terminal.</p></div>
  const diff = fileDiff(proposal.path, proposal.before, proposal.after)
  const file = project.files.find(file => file.path === proposal.path)
  const stale = proposal.before === null ? Boolean(file) : !file || file.content !== proposal.before
  return <div className="flex h-full min-h-0 flex-col">
    <header className="shrink-0 border-b border-secondary p-lg">
      <div className="flex items-center justify-between gap-sm"><h2 className="text-sm font-semibold">Review proposed code</h2><Badge tone={proposal.status === 'applied' ? 'success' : proposal.status === 'pending' ? 'warning' : 'neutral'}>{proposal.status === 'applied' ? 'Applied in browser' : proposal.status}</Badge></div>
      <label htmlFor="review-proposal" className="sr-only">Choose a proposed change</label>
      <select id="review-proposal" className={`${fieldClass} mt-md`} value={proposal.id} onChange={event => setSelected(event.target.value)}>
        {proposals.map(item => <option value={item.id} key={item.id}>{item.path} · {item.status}</option>)}
      </select>
      <p className="mt-md break-words text-sm text-secondary">{proposal.reason}</p>
      <p className="mt-sm text-xs text-tertiary">{diff.lines.filter(line => line.kind === 'added').length} added · {diff.lines.filter(line => line.kind === 'removed').length} removed. No commands or tests were run.</p>
    </header>
    <Tabs value={view} onChange={setView} id={id} tabs={[{ id: 'diff', label: 'Diff' }, { id: 'before', label: 'Before' }, { id: 'after', label: 'After' }]} />
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${view}`} className="min-h-0 flex-1 overflow-auto bg-secondary py-md">
      {view === 'diff' ? <pre className="font-mono text-xs leading-relaxed">{diff.lines.length ? diff.lines.slice(0, 400).map((line, index) => <div key={index} className={`px-lg ${line.kind === 'added' ? 'bg-utility-success-50 text-utility-success-700' : line.kind === 'removed' ? 'bg-utility-error-50 text-utility-error-700' : 'text-tertiary'}`}>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '} {line.text || ' '}</div>) : <span className="px-lg text-tertiary">No content difference.</span>}</pre>
        : <pre className="px-lg font-mono text-xs leading-relaxed text-secondary"><code>{view === 'before' ? proposal.before ?? '(new file)' : proposal.after}</code></pre>}
      {view === 'diff' && diff.lines.length > 400 && <p className="p-lg text-xs text-tertiary">Diff preview is capped at 400 lines. Before/After show the complete file; the patch download is complete.</p>}
    </div>
    <footer className="flex shrink-0 flex-col gap-md border-t border-secondary p-lg">
      {stale && proposal.status === 'pending' && <p role="alert" className="text-xs text-warning-primary">This file changed or was not selected when the proposal was created. Ask for a fresh proposal. Nothing will be overwritten.</p>}
      <div className="flex flex-wrap gap-sm"><Button primary disabled={busy || stale || proposal.status !== 'pending' || !diff.patch} onClick={() => onApply(proposal)}><Check size={14} className="shrink-0" />Apply in browser</Button>
        <Button disabled={busy || proposal.status !== 'pending'} onClick={() => onReject(proposal)}><X size={14} className="shrink-0" />Reject</Button></div>
      <Button disabled={!diff.patch} onClick={() => downloadText('recallloop-change.patch', diff.patch)}><Download size={14} className="shrink-0" />Download patch</Button>
      <p className="text-xs text-tertiary">Approval changes only this browser project. Download and inspect the patch before using it on local files. Record an outcome after you test it.</p>
    </footer>
  </div>
}
