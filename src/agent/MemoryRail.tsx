import { useEffect, useState } from 'react'
import { Database, RefreshCw, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import type { MemoryStatus, MemoryOverview, MemoryRecord } from './types.ts'
import { agentJson } from './api.ts'
import { Badge, Button, IconButton, Modal, CopyButton, fieldClass } from './ui.tsx'

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
        : status?.mode === 'legacy' ? <Badge>Legacy</Badge> : <Badge tone="error">Memory not configured</Badge>
}

export default function MemoryRail({ overview, loading, busy, chain, onRefresh, onChain, onNotice }: { overview?: MemoryOverview; loading: boolean; busy: boolean; chain?: ChainStatus;
  onRefresh: () => Promise<void>; onChain: () => Promise<void>; onNotice: (message: string) => void }) {
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
  async function seed() {
    setSeedConfirm(false); setOperation('Writing and verifying 12 synthetic memories…'); setError('')
    try {
      const result = await agentJson<{ success: boolean; written: number; verified: number; failed: number; blobs: MemoryRecord[] }>('/memory/seed', { method: 'POST', body: JSON.stringify({ confirm: 'seed-mainnet' }) }, 220_000)
      onNotice(`${result.written} seed writes confirmed; ${result.verified}/12 independently found in relayer inventory.${result.success ? ' Mainnet minimum met for this workspace scope.' : ' Evidence incomplete; inspect inventory before retrying.'}`)
      await onRefresh()
    } catch (error) { setError(error instanceof Error ? error.message : 'Mainnet seeding was not confirmed.') }
    finally { setOperation('') }
  }
  return <div className="h-full min-h-0 overflow-y-auto">
    <header className="border-b border-secondary p-lg">
      <div className="flex items-center justify-between gap-sm"><h2 className="flex items-center gap-sm text-sm font-semibold"><Database size={16} className="shrink-0 text-fg-tertiary" />Portable memory</h2><IconButton label="Refresh memory inventory" disabled={loading || Boolean(operation)} onClick={() => { void onRefresh() }}><RefreshCw size={15} /></IconButton></div>
      <div className="mt-md"><MemoryModeBadge status={status} /></div>
      <p className="mt-md text-xs text-tertiary">Recall happens before each answer. Only confirmed writes count. Browser history is not Walrus storage.</p>
      {status?.mode === 'mock' && <p className="mt-md text-xs text-warning-primary">Mock uses lexical matching and in-process memory. Restarting the server clears it. These blobs never count as Mainnet evidence.</p>}
      {['unconfigured', 'legacy'].includes(status?.mode || '') && <p className="mt-md text-xs text-error-primary">Open Settings and connect your Tatum Mainnet key, then your own Walrus Memory account and delegate key. Server-owner credentials are never used here.</p>}
    </header>
    <section className="border-b border-secondary p-lg" aria-label="Memory inventory">
      {loading && !overview ? <div aria-label="Loading memory inventory" className="space-y-md"><div className="h-8 w-20 animate-pulse rounded-xs bg-tertiary" /><div className="h-4 w-full animate-pulse rounded-xs bg-tertiary" /><div className="h-4 w-3/4 animate-pulse rounded-xs bg-tertiary" /></div> : <>
        <div className="flex items-center justify-between gap-sm"><p className="text-heading-xs font-semibold">{inventory?.total || 0}<span className="ml-sm text-xs font-medium text-tertiary">listed memories</span></p>
          {inventory?.meetsHackathonMinimum && <Badge tone="success">10+ Mainnet</Badge>}</div>
        {inventory?.error && <p role="alert" className="mt-md text-xs text-error-primary">{inventory.error}</p>}
        {status?.error && <p className="mt-md text-xs text-error-primary">{status.error}</p>}
        <dl className="mt-lg space-y-sm text-xs">{inventory?.namespaces?.map(namespace => <div className="flex items-center justify-between gap-sm" key={namespace.name}><dt className="min-w-0 truncate font-mono text-tertiary" title={namespace.name}>{namespace.name}</dt><dd>{namespace.count}</dd></div>)}</dl>
        <p className="mt-md text-xs text-tertiary">Profile: explicit preferences · Facts: user statements and outcomes · Raw: transcript records (not recalled by default).</p>
        {status?.mode === 'relayer' && <p className="mt-sm text-xs text-tertiary">Public relayer health: {status.healthy ? 'healthy' : 'unavailable'} · write-ready: {status.writeReady ? 'yes' : 'no'}. Health alone does not verify your account or storage.</p>}
        {inventory?.truncated && <p className="mt-sm text-xs text-warning-primary">Inventory scan reached its bounded limit. The count is not exhaustive.</p>}
      </>}
      <div className="mt-lg flex flex-col gap-sm"><Button disabled={!seedAllowed || busy || Boolean(operation)} onClick={() => setSeedConfirm(true)}>Seed 12 Mainnet memories</Button>
        <Button disabled={!['relayer', 'mock'].includes(status?.mode || '') || busy || Boolean(operation)} onClick={async () => {
          setOperation('Requesting bounded memory restore…'); setError('')
          try { const result = await agentJson<{ warning: string }>('/memory/restore', { method: 'POST', body: '{}' }, 150_000); onNotice(result.warning); await onRefresh() }
          catch (error) { setError(error instanceof Error ? error.message : 'Restore failed.') } finally { setOperation('') }
        }}>Restore memory index</Button></div>
      <p className="mt-sm text-xs text-tertiary">Seeding is disabled without the official, write-ready Mainnet relayer. Restore is bounded; neither action replays a full chat transcript.</p>
    </section>
    <section className="border-b border-secondary p-lg">
      <h3 className="mb-md text-sm font-semibold">Teach a preference or lesson</h3>
      <form onSubmit={async event => {
        event.preventDefault(); setOperation('Waiting for memory write confirmation…'); setError('')
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
        <Button type="submit" className="mt-md w-full" disabled={!text.trim() || !['relayer', 'mock'].includes(status?.mode || '') || Boolean(operation) || busy}>Remember explicitly</Button>
        <p className="mt-sm text-xs text-tertiary">Writes even when automatic capture is off. Corrections do not erase older memories. Never include credentials.</p>
      </form>
    </section>
    {(operation || error) && <div className="border-b border-secondary p-lg">{operation && <p role="status" className="text-xs text-secondary">{operation}</p>}{error && <p role="alert" className="text-xs text-error-primary">{error}</p>}</div>}
    <section className="border-b border-secondary p-lg">
      <div className="flex items-center justify-between gap-sm"><h3 className="flex items-center gap-sm text-sm font-semibold"><ShieldCheck size={15} className="shrink-0 text-fg-tertiary" />Tatum chain observation</h3><IconButton label="Refresh Tatum chain observation" onClick={() => { void onChain() }}><RefreshCw size={14} /></IconButton></div>
      <p className="mt-md text-xs text-secondary">{chain?.checkpoint ? `Sui Mainnet checkpoint ${chain.checkpoint.checkpoint}` : chain?.configured ? 'Checkpoint unavailable; check your Mainnet key.' : 'Connect your Tatum API key in Settings for read-only Sui Mainnet GraphQL.'}</p>
      {chain?.account && <p className="mt-sm text-xs text-secondary">Configured account object: {chain.account.exists ? 'found on Sui' : 'not found'}</p>}
      <p className="mt-sm text-xs text-tertiary">A checkpoint or account observation is not proof of a Walrus write. No transactions are submitted by the agent.</p>
    </section>
    <section className="p-lg">
      <h3 className="text-sm font-semibold">Confirmed blob inventory</h3>
      {!memories.length ? <p className="mt-md text-xs text-tertiary">No confirmed records in this workspace scope yet. Capture a turn or remember a preference.</p> : <>
        <ul className="mt-sm divide-y divide-secondary">{memories.slice(page * 20, page * 20 + 20).map(record => <li key={record.blobId} className="py-sm"><div className="flex items-center justify-between gap-sm"><code className="min-w-0 truncate text-xs text-brand-primary" title={record.blobId}>{record.blobId}</code><CopyButton text={record.blobId} /></div><p className="text-xs text-tertiary">{record.namespace.split(':').at(-1)}{record.createdAt ? ` · ${record.createdAt.slice(0, 10)}` : ''}{record.endEpoch !== undefined ? ` · end epoch ${record.endEpoch}` : ''}</p></li>)}</ul>
        <div className="mt-md flex items-center justify-between gap-sm border-t border-secondary pt-md"><span className="text-xs text-tertiary">Page {page + 1} of {pages}</span><div className="flex gap-sm"><IconButton label="Previous inventory page" disabled={!page} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></IconButton><IconButton label="Next inventory page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></IconButton></div></div>
      </>}
    </section>
    {seedConfirm && <Modal title="Write 12 synthetic memories to Mainnet?" onClose={() => setSeedConfirm(false)} footer={<><Button onClick={() => setSeedConfirm(false)}>Cancel</Button><Button primary onClick={() => { void seed() }}>Write &amp; verify 12 memories</Button></>}>
      <p className="text-sm text-secondary">This uses your configured Walrus Memory account and may consume its quota. The seed contains public demo preferences, not real user facts. It waits for confirmed blobs and re-reads inventory. Re-running uses the same idempotency key.</p>
    </Modal>}
  </div>
}
