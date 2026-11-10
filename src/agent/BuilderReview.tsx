import { useEffect, useId, useState } from 'react'
import { Check, Terminal, ShieldAlert, FileCode2, Database } from 'lucide-react'
import { fileDiff } from './diff.ts'
import { Badge, Button, Checkbox, Modal, Tabs } from './ui.tsx'
import type { BuilderApproval } from './builderTypes.ts'

export default function BuilderReview({ approval, root, commandNotice, busy, onClose, onDecide }: {
  approval: BuilderApproval; root: string | null; commandNotice: string; busy: boolean; onClose: () => void; onDecide: (decision: 'approve' | 'reject') => void
}) {
  const [view, setView] = useState<'diff' | 'before' | 'after'>('diff')
  const [consent, setConsent] = useState(false)
  const [now, setNow] = useState(Date.now())
  const tabsId = useId()
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const expired = approval.expiresAt <= now
  const diff = approval.kind === 'file' ? fileDiff(approval.path, approval.before, approval.after ?? '') : null
  const title = approval.kind === 'command' ? 'Review native command' : approval.kind === 'file' ? 'Review disk change' : 'Review Walrus checkpoint'
  const action = approval.kind === 'command' ? 'Run exact command' : approval.kind === 'file' ? 'Apply reviewed disk edit' : 'Save reviewed checkpoint'
  return <Modal title={title} wide onClose={onClose} footer={<><Button disabled={busy} onClick={() => onDecide('reject')}>Reject action</Button><Button primary disabled={busy || expired || (approval.kind !== 'file' && !consent)} onClick={() => onDecide('approve')}><Check size={15} className="shrink-0" aria-hidden="true" />{action}</Button></>}>
    <div className="mb-xl flex flex-wrap items-center gap-md"><Badge tone="warning">{approval.source === 'agent' ? 'Agent request · waiting for you' : 'Manual request'}</Badge><span className="text-xs text-tertiary">{expired ? 'Expired — request a new review' : `Expires ${new Date(approval.expiresAt).toLocaleTimeString()}`}</span></div>
    {approval.permissionReason && <p className="mb-xl text-sm text-secondary"><span className="font-medium">Why permission is needed:</span> {approval.permissionReason}</p>}
    {approval.kind === 'file' ? <>
      <h3 className="mb-sm flex items-center gap-sm text-sm font-semibold"><FileCode2 size={16} className="shrink-0 text-fg-secondary" aria-hidden="true" />{approval.operation}: <code className="break-all">{approval.path}</code></h3>
      <p className="mb-lg text-sm text-secondary">{approval.reason}</p>
      <Tabs value={view} onChange={setView} id={tabsId} label="Disk change views" tabs={[{ id: 'diff', label: 'Diff' }, { id: 'before', label: 'Before' }, { id: 'after', label: 'After' }]} />
      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${view}`} tabIndex={0} className="max-h-80 overflow-auto border-b border-secondary py-lg focus-visible:ring-2 focus-visible:ring-focus-ring">
        {view === 'diff' ? <pre className="font-mono text-xs leading-relaxed">{diff!.lines.slice(0, 400).map((line, index) => <div key={index} className={`px-md ${line.kind === 'added' ? 'bg-utility-success-50 text-utility-success-700' : line.kind === 'removed' ? 'bg-utility-error-50 text-utility-error-700' : 'text-tertiary'}`}>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '} {line.text || ' '}</div>)}</pre>
          : <pre className="px-md font-mono text-xs text-secondary"><code>{view === 'before' ? approval.before ?? '(new file)' : approval.after ?? '(file deleted)'}</code></pre>}
      </div>
      {view === 'diff' && diff!.lines.length > 400 && <p className="mt-md text-xs text-tertiary">Diff is capped at 400 lines. Before and After show the entire reviewed file.</p>}
      <p className="mt-xl break-words text-xs text-tertiary">Writes only this exact reviewed change under <code>{root}</code>. The file’s version is rechecked when you approve. Approval is consumed once, including failures. Editing the draft later does not change this review. No test result is implied.</p>
    </> : approval.kind === 'command' ? <>
      <h3 className="mb-lg flex items-center gap-sm text-sm font-semibold"><Terminal size={16} className="shrink-0 text-fg-secondary" aria-hidden="true" />One native shell command</h3>
      <pre className="max-h-48 overflow-auto rounded-md border border-secondary bg-secondary p-lg font-mono text-sm"><code>{approval.command}</code></pre>
      <dl className="my-xl grid grid-cols-1 gap-lg text-xs sm:grid-cols-2"><div><dt className="text-tertiary">Working directory</dt><dd className="mt-sm break-all font-mono">{root}{approval.cwd !== '.' ? `/${approval.cwd}` : ''}</dd></div><div><dt className="text-tertiary">Timeout</dt><dd className="mt-sm">{approval.timeoutMs / 1000} seconds · output is bounded</dd></div></dl>
      <p className="mb-lg text-sm text-secondary">{approval.reason}</p>
      <p className="mb-xl flex items-start gap-md rounded-xl bg-utility-warning-50 p-xl text-sm text-utility-warning-700"><ShieldAlert size={19} className="mt-xxs shrink-0" aria-hidden="true" />{commandNotice}</p>
      <Checkbox checked={consent} onChange={setConsent} disabled={busy}>I understand this is native execution with OS and network access, not a sandbox.</Checkbox>
    </> : <>
      <h3 className="mb-lg flex items-center gap-sm text-sm font-semibold"><Database size={16} className="shrink-0 text-fg-secondary" aria-hidden="true" />Reviewed facts · {approval.project}</h3>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-secondary bg-secondary p-lg font-mono text-xs leading-relaxed"><code>{approval.text}</code></pre>
      <p className="my-xl text-sm text-secondary">Only this text is sent to your current verified wallet memory connection. Walrus encrypts blobs at rest, but the relayer processes plaintext. No source files, terminal logs, credentials or automatic transcript are included. In the demo this is ephemeral mock memory, not a Mainnet write.</p>
      <Checkbox checked={consent} onChange={setConsent} disabled={busy}>I reviewed this checkpoint and consent to saving this exact text.</Checkbox>
    </>}
  </Modal>
}
