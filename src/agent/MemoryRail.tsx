import { useEffect, useState } from 'react'
import { Database, RefreshCw, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import type { MemoryStatus, MemoryOverview, MemoryRecord } from './types.ts'
import { agentJson } from './api.ts'
import { Badge, Button, IconButton, Modal, CopyButton, fieldClass } from './ui.tsx'
import MemoryHandoffPanel from './MemoryHandoff.tsx'

export interface ChainStatus {
  configured: boolean
  checkpoint: { checkpoint: string; observedAt?: string } | null
  account: { exists: boolean; object?: { address: string; version: string } } | null
  notice?: string
}

export function MemoryModeBadge({ status }: { status?: MemoryStatus }) {
  return status?.mode === 'mock' ? <Badge tone="warning">Mock · ephemeral</Badge>
    : status?.network === 'mainnet' && status.healthy ? <Badge tone="success">Mainnet relayer</Badge>
      : status?.mode === 'relayer' ? <Badge tone={status.healthy ? 'neutral' : 'error'}>{status.healthy ? 'Relayer · network unverified' : 'Relayer unavailable'}</Badge>
        : status?.mode === 'legacy' ? <Badge>Legacy</Badge> : <Badge>Memory not configured</Badge>
}

export default function MemoryRail({ overview, loading, busy, chain, handoffAccountId, onRefresh, onChain, onNotice, onSettings }: { overview?: MemoryOverview; loading: boolean; busy: boolean; chain?: ChainStatus; handoffAccountId: string | null;
  onRefresh: () => Promise<void>; onChain: () => Promise<void>; onNotice: (message: string) => void; onSettings: () => void }) {
  const [seedConfirm, setSeedConfirm] = useState(false)
  const [operation, setOperation] = useState('')
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [tier, setTier] = useState<'profile' | 'facts'>('profile')
  const [page, setPage] = useState(0)
  const status = overview?.status
  const inventory = overview?.inventory
  const memories = inventory?.memories || []
  const pages = Math.max(1, Math.ceil(memories.length / 20))
  useEffect(() => { setPage(old => Math.min(old, pages - 1)) }, [pages])
  const seedAllowed = status?.mode === 'relayer' && status.network === 'mainnet' && status.writeReady
  const locked = busy || Boolean(operation)
  async function seed() {
    if (locked || !seedAllowed) return
    setSeedConfirm(false); setOperation('Writing and verifying 12 synthetic memories…'); setError('')
    try {
      const result = await agentJson<{ success: boolean; written: number; verified: number; failed: number; blobs: MemoryRecord[] }>('/memory/seed', { method: 'POST', body: JSON.stringify({ confirm: 'seed-mainnet' }) }, 220_000)
      onNotice(`${result.written} seed writes confirmed; ${result.verified}/12 independently found in relayer inventory.${result.success ? ' Mainnet minimum met for this workspace scope.' : ' Evidence incomplete; inspect inventory before retrying.'}`)
      await onRefresh()
    } catch (error) { setError(error instanceof Error ? error.message : 'Mainnet seeding was not confirmed.') }
    finally { setOperation('') }
  }
  return <div className="workspace-scroll h-full min-h-0 overflow-y-auto bg-primary">
    <header className="border-b border-secondary p-xl">
      <div className="flex items-center justify-between gap-md"><h2 className="flex items-center gap-md text-sm font-medium"><Database size={16} className="shrink-0 text-fg-tertiary" aria-hidden="true" />Portable memory</h2><IconButton label="Refresh memory inventory" disabled={loading || locked} onClick={() => { void onRefresh() }}><RefreshCw size={15} className="shrink-0" aria-hidden="true" /></IconButton></div>
      <div className="mt-md"><MemoryModeBadge status={status} /></div>
      <p className="mt-lg text-xs leading-relaxed text-tertiary">Preferences and lessons for later sessions. Recall happens before each answer; only confirmed writes count. Browser history is separate.</p>
      {status?.mode === 'mock' && <p className="mt-md text-xs text-warning-primary">Mock uses lexical matching and in-process memory. Restarting the server clears it. These blobs never count as Mainnet evidence.</p>}
      {['unconfigured', 'legacy'].includes(status?.mode || '') && <p className="mt-lg text-xs text-secondary">Connect Tatum first, then your own Walrus Memory account and delegate. Server-owner credentials are never inherited.</p>}
      <Button quiet size="sm" className="mt-lg" onClick={onSettings}>{status?.mode === 'relayer' ? 'Memory connection settings' : 'Connect memory'}</Button>
    </header>
    <section className="border-b border-secondary p-xl" aria-label="Memory inventory">
      {loading && !overview ? <div aria-label="Loading memory inventory" className="space-y-md"><div className="h-8 w-20 animate-pulse rounded-xs bg-tertiary" /><div className="h-4 w-full animate-pulse rounded-xs bg-tertiary" /><div className="h-4 w-3/4 animate-pulse rounded-xs bg-tertiary" /></div> : <>
        <div className="flex flex-wrap items-center justify-between gap-md"><p className="text-heading-xs font-semibold">{inventory?.success ? inventory.total : '—'}<span className="ml-md text-xs font-medium text-tertiary">listed memories</span></p>
          {inventory?.meetsHackathonMinimum && <Badge tone="success">10+ Mainnet</Badge>}</div>
        {inventory?.error && <p role="alert" className="mt-md text-xs text-error-primary">{inventory.error}</p>}
        {status?.error && <p className="mt-md text-xs text-error-primary">{status.error}</p>}
        <details className="mt-xl text-xs text-tertiary"><summary className="cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">Memory tiers &amp; namespaces</summary><dl className="mt-lg space-y-md">{inventory?.namespaces?.map(namespace => <div className="flex items-center justify-between gap-md" key={namespace.name}><dt className="min-w-0 truncate font-mono" title={namespace.name}>{namespace.name}</dt><dd className="text-secondary">{namespace.count}</dd></div>)}</dl><p className="mt-lg leading-relaxed">Profile: explicit preferences · Facts: user statements and outcomes · Raw: transcripts (not recalled by default).</p></details>
        {status?.mode === 'relayer' && <p className="mt-sm text-xs text-tertiary">Public relayer health: {status.healthy ? 'healthy' : 'unavailable'} · write-ready: {status.writeReady ? 'yes' : 'no'}. Health alone does not verify your account or storage.</p>}
        {inventory?.truncated && <p className="mt-sm text-xs text-warning-primary">Inventory scan reached its bounded limit. The count is not exhaustive.</p>}
      </>}
      <details className="mt-xl border-t border-secondary pt-xl text-xs text-tertiary"><summary className="cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">Index &amp; Mainnet evidence tools</summary>
      <div className="mt-lg flex flex-col gap-md"><Button disabled={!seedAllowed || locked || loading} onClick={() => setSeedConfirm(true)}>Seed 12 Mainnet memories</Button>
        <Button disabled={!['relayer', 'mock'].includes(status?.mode || '') || locked} onClick={async () => {
          if (locked) return
          setOperation('Requesting bounded memory restore…'); setError('')
          try { const result = await agentJson<{ warning: string }>('/memory/restore', { method: 'POST', body: '{}' }, 150_000); onNotice(result.warning); await onRefresh() }
          catch (error) { setError(error instanceof Error ? error.message : 'Restore failed.') } finally { setOperation('') }
        }}>Restore memory index</Button></div>
      <p className="mt-lg leading-relaxed">Seeding needs the official, write-ready Mainnet relayer and a separate confirmation. Restore is bounded; neither action replays a full chat transcript. These controls do not establish evidence until live writes are independently confirmed.</p></details>
    </section>
    <MemoryHandoffPanel key={handoffAccountId || 'unconfigured'} accountId={handoffAccountId} busy={locked} />
    <section className="border-b border-secondary p-xl">
      <h3 className="mb-lg text-sm font-medium">Teach a preference or lesson</h3>
      <form onSubmit={async event => {
        event.preventDefault(); if (locked || !text.trim()) return
        setOperation('Waiting for memory write confirmation…'); setError('')
        try {
          const result = await agentJson<{ blobId: string }>('/remember', { method: 'POST', body: JSON.stringify({ text, tier }) }, 150_000)
          setText(''); onNotice(`Memory confirmed: ${result.blobId}. It can be recalled in a new session.`); await onRefresh()
        } catch (error) { setError(error instanceof Error ? error.message : 'The memory write was not confirmed.') }
        finally { setOperation('') }
      }}>
        <label htmlFor="remember-text" className="sr-only">Preference or lesson to remember</label><textarea id="remember-text" rows={3} maxLength={2000} className={fieldClass} value={text} onChange={event => setText(event.target.value)} placeholder="I prefer TypeScript and small, reviewable changes." disabled={Boolean(operation) || busy} />
        <fieldset className="mt-md" disabled={Boolean(operation) || busy}><legend className="sr-only">Memory tier</legend><div className="flex flex-wrap gap-lg">
          {(['profile', 'facts'] as const).map(value => <label className="inline-flex cursor-pointer items-center gap-sm text-xs text-secondary" key={value}><input type="radio" name="memory-tier" value={value} checked={tier === value} onChange={() => setTier(value)} className="peer sr-only" /><span aria-hidden="true" className={`flex size-4 items-center justify-center rounded-full border bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-focus-ring ${tier === value ? 'border-brand' : 'border-primary'}`}>{tier === value && <span className="size-2 rounded-full bg-brand-solid" />}</span>{value === 'profile' ? 'Preference' : 'Lesson / correction'}</label>)}
        </div></fieldset>
        <Button primary type="submit" className="mt-lg w-full" disabled={!text.trim() || !['relayer', 'mock'].includes(status?.mode || '') || locked}>Remember explicitly</Button>
        <p className="mt-lg text-xs leading-relaxed text-tertiary">Writes even with automatic capture off. Corrections do not erase older memories. The relayer sees plaintext; Walrus costs and quotas apply. Never include credentials.</p>
      </form>
    </section>
    {(operation || error) && <div className="border-b border-secondary p-xl">{operation && <p role="status" className="flex items-center gap-md text-xs text-secondary"><LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden="true" />{operation}</p>}{error && <p role="alert" className="text-xs text-error-primary">{error}</p>}</div>}
    <details className="border-b border-secondary p-xl text-xs text-tertiary"><summary className="cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">Tatum chain observation</summary>
      <div className="mt-lg flex items-center justify-between gap-md"><span className="text-xs text-secondary">Read-only Sui Mainnet</span><IconButton label="Refresh Tatum chain observation" disabled={locked} onClick={() => { void onChain() }}><RefreshCw size={14} className="shrink-0" aria-hidden="true" /></IconButton></div>
      <p className="mt-md text-xs text-secondary">{chain?.checkpoint ? `Sui Mainnet checkpoint ${chain.checkpoint.checkpoint}` : chain?.configured ? 'Checkpoint unavailable; check your Mainnet key.' : 'Connect your Tatum API key in Settings for read-only Sui Mainnet GraphQL.'}</p>
      {chain?.account && <p className="mt-sm text-xs text-secondary">Configured account object: {chain.account.exists ? 'found on Sui' : 'not found'}</p>}
      <p className="mt-sm text-xs text-tertiary">A checkpoint or account observation is not proof of a Walrus write. No transactions are submitted by the agent.</p>
    </details>
    <section className="p-xl">
      <h3 className="text-sm font-medium">Confirmed blob inventory</h3>
      {!memories.length ? <p className="mt-md text-xs text-tertiary">No confirmed records in this workspace scope yet. Capture a turn or remember a preference.</p> : <>
        <ul className="mt-lg divide-y divide-secondary">{memories.slice(page * 20, page * 20 + 20).map(record => <li key={record.blobId} className="py-lg"><div className="flex items-center justify-between gap-md"><code className="min-w-0 truncate text-xs text-secondary" title={record.blobId}>{record.blobId}</code><CopyButton text={record.blobId} /></div><p className="text-xs text-tertiary">{record.namespace.split(':').at(-1)}{record.createdAt ? ` · ${record.createdAt.slice(0, 10)}` : ''}{record.endEpoch !== undefined ? ` · end epoch ${record.endEpoch}` : ''}</p></li>)}</ul>
        <div className="mt-lg flex items-center justify-between gap-md border-t border-secondary pt-lg"><span className="text-xs text-tertiary">Page {page + 1} of {pages}</span><div className="flex gap-sm"><IconButton label="Previous inventory page" disabled={!page} onClick={() => setPage(page - 1)}><ChevronLeft size={16} className="shrink-0" aria-hidden="true" /></IconButton><IconButton label="Next inventory page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight size={16} className="shrink-0" aria-hidden="true" /></IconButton></div></div>
      </>}
    </section>
    {seedConfirm && <Modal title="Write 12 synthetic memories to Mainnet?" onClose={() => setSeedConfirm(false)} footer={<><Button onClick={() => setSeedConfirm(false)}>Cancel</Button><Button primary disabled={locked || !seedAllowed} onClick={() => { void seed() }}>Write &amp; verify 12 memories</Button></>}>
      <p className="text-sm text-secondary">This uses your configured Walrus Memory account and may consume its quota. The seed contains public demo preferences, not real user facts. It waits for confirmed blobs and re-reads inventory. Re-running uses the same idempotency key.</p>
    </Modal>}
  </div>
}
