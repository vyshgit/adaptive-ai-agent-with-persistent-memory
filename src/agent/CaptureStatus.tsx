import { AlertCircle, CheckCircle2, Database, LoaderCircle } from 'lucide-react'
import type { StoredCapture } from './types.ts'

// Compact capture status: a small icon-and-label chip. The full status sentence stays in the DOM
// (sr-only) for assistive tech and tests, doubles as the hover tooltip, and tapping the chip
// expands the saved blob records (verification evidence) instead of permanently taking space.
export default function CaptureStatus({ stored }: { stored?: StoredCapture }) {
  const records = stored?.blobs || []
  let label = 'Memory…', full = 'Remembering relevant context…', warn = false, spin = true, neutral = false
  if (stored) {
    spin = false
    if (stored.skipped) { label = 'Memory off'; full = stored.message || 'Auto-memory is off for this turn.'; neutral = true }
    else if (stored.pending) { label = 'Memory pending'; full = stored.message || 'Memory capture pending. Refresh inventory before retrying.'; warn = true }
    else if (stored.code === 'capture_unavailable') { label = 'Memory off'; full = stored.message || 'Auto-memory is unavailable. Connect Walrus in Memory settings.'; warn = true }
    else if (stored.failed) { label = 'Memory partial'; full = `${stored.verbatim + stored.facts} confirmed; ${stored.failed} unconfirmed. ${stored.message || ''}`.trim(); warn = true }
    else if (stored.deduplicated) { label = 'Already remembered'; full = stored.message || 'Context already remembered.' }
    else { label = 'Memory saved'; full = `${stored.verbatim} transcript records · ${stored.facts} facts confirmed` }
  }
  return <details className="group min-w-0 text-xs text-tertiary">
    <summary title={full} className="inline-flex w-fit cursor-pointer list-none items-center gap-xs rounded-md text-xs text-tertiary hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [&::-webkit-details-marker]:hidden">
      <span role="status" aria-label="Memory capture status" className="contents">
        {spin ? <LoaderCircle size={13} className="shrink-0 animate-spin" aria-hidden="true" />
          : warn ? <AlertCircle size={13} className="shrink-0 text-warning-primary" aria-hidden="true" />
          : neutral ? <Database size={13} className="shrink-0 text-fg-tertiary" aria-hidden="true" />
          : <CheckCircle2 size={13} className="shrink-0" aria-hidden="true" />}
        <span aria-hidden="true">{label}</span>
        <span className="sr-only">{full}</span>
      </span>
    </summary>
    <div className="mt-sm max-w-md space-y-sm">
      <p>{full}</p>
      {records.length > 0 && <ul className="space-y-sm">{records.map(record => <li key={record.blobId} className="space-y-xs"><p>{record.tier || 'facts'}</p><code className="block break-all text-secondary">{record.blobId}</code><code className="block break-all">{record.namespace}</code></li>)}</ul>}
    </div>
  </details>
}
