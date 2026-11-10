import { CheckCircle2 } from 'lucide-react'
import type { StoredCapture } from './types.ts'

export default function CaptureStatus({ stored }: { stored?: StoredCapture }) {
  const records = stored?.blobs || []
  return <div className="min-w-0 text-xs text-tertiary"><span role="status" aria-label="Memory capture status">
    {!stored ? 'Remembering relevant context…' : stored.skipped ? stored.message || 'Auto-memory is off for this turn.'
      : stored.pending ? <span className="text-warning-primary">{stored.message || 'Memory capture pending. Refresh inventory before retrying.'}</span>
        : stored.code === 'capture_unavailable' ? <span className="text-warning-primary">{stored.message || 'Auto-memory is unavailable. Connect Walrus in Memory settings.'}</span>
        : stored.failed ? <span className="text-warning-primary">{stored.verbatim + stored.facts} confirmed; {stored.failed} unconfirmed. {stored.message}</span>
          : stored.deduplicated ? stored.message || 'Context already remembered.'
            : <span className="inline-flex items-center gap-xs"><CheckCircle2 size={13} className="shrink-0" aria-hidden="true" />{stored.verbatim} transcript records · {stored.facts} facts confirmed</span>}
  </span>{records.length > 0 && <details className="mt-sm"><summary className="cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:ring-focus-ring">Confirmed memory records</summary><ul className="mt-sm space-y-sm">{records.map(record => <li key={record.blobId} className="space-y-xs"><p>{record.tier || 'facts'}{record.createdAt ? ` · ${record.createdAt}` : ''}</p><code className="block break-all text-secondary">{record.blobId}</code><code className="block break-all">{record.namespace}</code></li>)}</ul></details>}</div>
}
