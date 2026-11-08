import { Database } from 'lucide-react'
import type { MemoryContext } from './types.ts'
import { Badge, CopyButton } from './ui.tsx'

export default function MemoryChips({ memory }: { memory?: MemoryContext }) {
  if (!memory) return null
  if (memory.memoryUnavailable && !memory.memories.length) return <p className="mb-lg text-xs text-warning-primary">Memory unavailable. This answer uses selected files and recent local chat only.</p>
  if (!memory.memories.length) return <p className="mb-lg flex items-center gap-sm text-xs text-tertiary"><Database size={13} className="shrink-0" />No relevant memories recalled.</p>
  const mock = memory.strategy === 'mock-lexical'
  return <details className="mb-lg text-xs">
    <summary className="cursor-pointer rounded-md text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
      <span className="ml-xs inline-flex items-center gap-sm"><Database size={14} className="shrink-0" />Recalled {memory.memories.length} {mock ? 'mock' : 'Walrus'} {memory.memories.length === 1 ? 'memory' : 'memories'}<Badge tone={mock ? 'warning' : 'brand'}>{memory.tokenEstimate} estimated tokens</Badge></span>
    </summary>
    <ul className="mt-md divide-y divide-secondary border-t border-secondary">
      {memory.memories.map(hit => <li key={hit.blobId} className="py-md">
        <div className="flex items-center justify-between gap-sm"><code className="min-w-0 truncate text-brand-primary" title={hit.blobId}>{hit.blobId}</code><CopyButton text={hit.blobId} /></div>
        <p className="mt-xs whitespace-pre-wrap break-words text-secondary">{hit.text ? hit.text.slice(0, 300) : 'Cached citation only. Memory text will be recalled again on your next turn.'}</p>
        <p className="mt-xs text-tertiary">{hit.tier || 'facts'} · distance {hit.distance.toFixed(2)}{hit.createdAt ? ` · ${hit.createdAt.slice(0, 10)}` : ''}</p>
      </li>)}
    </ul>
    {memory.memoryUnavailable && <p className="mt-sm text-warning-primary">One memory tier could not be recalled.</p>}
  </details>
}
