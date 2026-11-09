import { useEffect, useId, useRef, useState } from 'react'
import { KeyRound, ShieldCheck, Server, Database, ExternalLink, RefreshCw, AlertCircle, LoaderCircle } from 'lucide-react'
import type { Connection, WalletSession, WorkspaceStatus } from './types.ts'
import { agentJson, setWorkspaceToken } from './api.ts'
import { redactBrowserText, registerBrowserSecret } from './clientSafety.ts'
import { PROVIDERS, providerForUrl, modelStatus, capabilityLabel } from './providers.ts'
import { Button, Checkbox, Modal, Badge, CopyButton, Tabs, fieldClass } from './ui.tsx'

export type SettingsSection = 'model' | 'tatum' | 'walrus' | 'advanced'
type Section = SettingsSection
type Feedback = { section: Section; message: string; error?: boolean; code?: string }
const linkClass = 'inline-flex items-center gap-xs rounded-md text-sm text-secondary underline decoration-border-primary underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
function HelpLink({ href, children }: { href: string; children: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>{children}<ExternalLink size={13} className="shrink-0 text-fg-tertiary" aria-hidden="true" /></a>
}

export default function SettingsModal({ connection, status, identity, onClose, onRefresh, busy, initialSection = 'model' }: { connection?: Connection; status?: WorkspaceStatus; identity: WalletSession; onClose: () => void; onRefresh: () => Promise<boolean>; busy: boolean; initialSection?: Section }) {
  const [section, setSection] = useState<Section>(initialSection)
  const tabsId = useId()
  const [preset, setPreset] = useState(connection?.mode === 'live' ? providerForUrl(connection.baseUrl).id : 'agentrouter')
  const [baseUrl, setBaseUrl] = useState(connection?.mode === 'live' ? connection.baseUrl : 'https://agentrouter.org/v1')
  const [apiStyle, setApiStyle] = useState<'responses' | 'chat'>(connection?.mode === 'live' ? connection.apiStyle : 'responses')
  const [model, setModel] = useState(connection?.mode === 'live' ? connection.model : '')
  const [apiKey, setApiKey] = useState('')
  const [tools, setTools] = useState(connection?.toolsEnabled !== false)
  const [checkCapabilities, setCheckCapabilities] = useState(false)
  const [token, setToken] = useState('')
  const [pending, setPending] = useState<{ section: Section; message: string } | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [tatumKey, setTatumKey] = useState('')
  const [delegateKey, setDelegateKey] = useState('')
  const [accountId, setAccountId] = useState(status?.memoryConnection?.accountId || '')
  const [editing, setEditing] = useState({ model: connection?.mode !== 'live', tatum: !status?.tatum.configured, walrus: !status?.memoryConnection })
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  const locked = Boolean(pending) || busy
  const disabled = locked || identity.demo
  const local = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(baseUrl)
  const selected = PROVIDERS.find(item => item.id === preset)!
  const currentModelStatus = modelStatus(connection, connection?.model || '')
  function close() { controller.current?.abort(); onClose() }
  async function request(target: Section, path: string, body: object, message: string) {
    if (controller.current || locked) return
    const abort = new AbortController()
    const deadline = AbortSignal.any([abort.signal, AbortSignal.timeout(90_000)])
    controller.current = abort
    setPending({ section: target, message: path.includes('disconnect') ? 'Disconnecting…' : 'Verifying the session connection…' })
    setFeedback(null)
    try {
      const result = await agentJson<{ connection?: Connection }>(path, { method: 'POST', body: JSON.stringify(body), signal: deadline })
      if (!mounted.current) return
      abort.signal.throwIfAborted()
      if (target === 'model' && result.connection?.mode === 'live') {
        setBaseUrl(result.connection.baseUrl); setPreset(providerForUrl(result.connection.baseUrl).id); setApiStyle(result.connection.apiStyle)
        setModel(result.connection.model); setTools(result.connection.toolsEnabled)
      }
      if (path === '/connect') setEditing(old => ({ ...old, model: result.connection?.mode !== 'live' }))
      if (path === '/connections/tatum') setEditing(old => ({ ...old, tatum: false }))
      if (path === '/connections/memwal') setEditing(old => ({ ...old, walrus: false }))
      if (path === '/disconnect') setEditing(old => ({ ...old, model: true }))
      if (path === '/connections/tatum/disconnect') setEditing(old => ({ ...old, tatum: true, walrus: true }))
      if (path === '/connections/memwal/disconnect') setEditing(old => ({ ...old, walrus: true }))
      setFeedback({ section: target, message })
    } catch (error) {
      if (!mounted.current) return
      const detail = abort.signal.aborted ? 'Check cancelled. Refreshing status in case verification finished just before cancellation.'
        : deadline.aborted ? 'The connection check timed out. Check provider status before trying again.'
        : error instanceof Error ? error.message : 'Connection verification failed.'
      setFeedback({ section: target, message: redactBrowserText(detail), error: !abort.signal.aborted, code: error instanceof Error ? (error as { code?: string }).code : undefined })
    } finally {
      if (mounted.current) {
        setApiKey(''); setTatumKey(''); setDelegateKey('')
      }
      // Closing/cancelling can race a committed response. Refresh the parent even
      // after this modal closes; a disposed wallet workspace ignores the callback.
      try {
        if (!await onRefresh() && mounted.current) setFeedback({ section: target, message: 'Could not refresh connection status. Retry status before sending a turn.', error: true })
      } catch { if (mounted.current) setFeedback({ section: target, message: 'Could not refresh connection status. Retry status before sending a turn.', error: true }) }
      if (controller.current === abort) controller.current = null
      if (mounted.current) setPending(null)
    }
  }
  async function updateToken(value: string, message: string) {
    if (locked) return
    setWorkspaceToken(value); setToken(''); setPending({ section: 'advanced', message: 'Refreshing workspace access…' })
    try { const refreshed = await onRefresh(); if (mounted.current) setFeedback({ section: 'advanced', message: refreshed ? message : 'Could not refresh workspace access. Retry the session check.', error: !refreshed }) }
    catch { if (mounted.current) setFeedback({ section: 'advanced', message: 'Could not refresh workspace access. Retry the session check.', error: true }) }
    finally { if (mounted.current) setPending(null) }
  }
  return <Modal title="Workspace settings" wide onClose={close} bodyClassName="workspace-scroll" footer={<>
    <span className="mr-auto self-center text-xs text-tertiary">{identity.demo ? 'Demo · no live credentials' : `Session ends ${new Date(identity.expiresAt!).toLocaleTimeString()}`}</span>
    <Button onClick={close}>{pending ? 'Close & cancel check' : 'Done'}</Button>
  </>}>
    <p className="mb-xl text-sm text-tertiary">Your model, chain access, and portable memory are separate connections. Start with a model; add memory when you need it.</p>
    {identity.demo && <p className="mb-xl rounded-md border border-secondary bg-secondary p-lg text-sm text-secondary">Live connections are disabled in the offline demo. Leave the demo and connect your wallet to use your own APIs.</p>}
    <Tabs id={tabsId} value={section} onChange={setSection} label="Settings sections" tabs={[{ id: 'model', label: 'Model' }, { id: 'tatum', label: 'Tatum' }, { id: 'walrus', label: 'Walrus Memory' }, { id: 'advanced', label: 'Advanced' }]} />
    <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${section}`} className="min-w-0 pt-2xl">
      {section === 'model' && <section className="space-y-xl" aria-label="Model provider connection">
        <div className="flex flex-wrap items-center justify-between gap-md"><h3 className="flex items-center gap-md text-lg font-semibold"><KeyRound size={19} className="shrink-0 text-fg-secondary" />Model provider</h3><Badge tone={currentModelStatus.tone}>{currentModelStatus.label}</Badge></div>
        <p className="text-xs text-tertiary">Connect or Verify sends one small coding request (up to 256 output tokens). Provider charges and quotas apply. Optional capability checks add up to two requests. No chat, files, or memory enter the check prompt.</p>
        {connection?.mode === 'live' && <>
          <div className="min-w-0 space-y-sm text-sm text-secondary"><p className="break-all font-mono">{connection.model}</p><p className="break-all text-xs text-tertiary">{connection.baseUrl} · {connection.apiStyle === 'responses' ? 'Responses' : 'Chat Completions'}</p></div>
          <dl className="grid grid-cols-2 gap-lg border-y border-secondary py-lg text-xs sm:grid-cols-3">
            <div><dt className="text-tertiary">Discovery</dt><dd className="mt-xs text-secondary">{connection.verification?.discovery === 'available' ? 'Available · not a generation test' : 'Unavailable · entered ID'}</dd></div>
            <div><dt className="text-tertiary">Streaming</dt><dd className="mt-xs text-secondary">{capabilityLabel(connection.verification?.streaming)}</dd></div>
            <div><dt className="text-tertiary">Function tools</dt><dd className="mt-xs text-secondary">{capabilityLabel(connection.verification?.tools)}{!connection.toolsEnabled ? ' · disabled' : ''}</dd></div>
          </dl>
          {connection.verification?.checkedAt && <p className="text-xs text-tertiary">Checked {new Date(connection.verification.checkedAt).toLocaleString()}. Only this model and protocol were checked.</p>}
          {connection.lastVerificationFailure && <p className="text-sm text-error-primary">Last verification: {connection.lastVerificationFailure.message}</p>}
          {[connection.verification?.streamingError, connection.verification?.toolsError].filter(Boolean).map((error, index) => <p key={index} className="text-xs text-warning-primary">{error!.message}</p>)}
          <div className="flex flex-wrap gap-sm">
            <Button disabled={disabled} onClick={() => { void request('model', '/verify', { checkCapabilities, toolsEnabled: tools }, 'Generation verified with your saved session key. Capability results are shown separately; no memory was written.') }}><RefreshCw size={14} className="shrink-0" />Verify model</Button>
            <Button disabled={disabled} onClick={() => setEditing(old => ({ ...old, model: !old.model }))}>{editing.model ? 'Hide reconnect form' : 'Reconnect model'}</Button>
            <Button quiet disabled={locked} onClick={() => { void request('model', '/disconnect', {}, 'Model disconnected. Tatum and Walrus are unchanged; no operator credentials will be used.') }}>Disconnect model</Button>
          </div>
        </>}
        {editing.model && <form className="space-y-lg" onSubmit={event => {
          event.preventDefault(); registerBrowserSecret(apiKey)
          void request('model', '/connect', { mode: 'live', baseUrl, apiKey, model, apiStyle, toolsEnabled: tools, checkCapabilities }, 'Generation verified. The model key was cleared from this form; streaming and tools have their own results.')
        }}>
          <fieldset disabled={disabled} className="space-y-lg">
            <div><label htmlFor="provider-preset" className="mb-sm block text-sm font-medium text-secondary">Provider</label><select id="provider-preset" className={fieldClass} value={preset} onChange={event => {
              const next = PROVIDERS.find(item => item.id === event.target.value)!
              setPreset(next.id); setBaseUrl(next.baseUrl); setApiStyle(next.apiStyle); setModel(''); setApiKey('')
            }}>{PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
            <p className="text-sm text-tertiary">{selected.help}</p>
            <div className="flex flex-wrap gap-xl">{selected.keyUrl && <HelpLink href={selected.keyUrl}>Get an API key</HelpLink>}{selected.modelsUrl && <HelpLink href={selected.modelsUrl}>Available models</HelpLink>}{selected.docsUrl && <HelpLink href={selected.docsUrl}>API documentation</HelpLink>}</div>
            <div><label htmlFor="model-api-key" className="mb-sm block text-sm font-medium text-secondary">Model API key{local ? ' (optional for local server)' : ''}</label><input id="model-api-key" type="password" autoComplete="off" data-lpignore="true" maxLength={4096} required={!local} className={fieldClass} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Only your selected provider’s key" aria-describedby="model-key-hint" /><p id="model-key-hint" className="mt-sm text-xs text-tertiary">Temporary server session only. This is not a Tatum, wallet, or embedding credential.</p></div>
            <div><label htmlFor="model-id" className="mb-sm block text-sm font-medium text-secondary">Model ID</label><input id="model-id" required className={fieldClass} maxLength={128} value={model} onChange={event => setModel(event.target.value)} placeholder="Exact model ID from your account" aria-describedby="model-id-hint" list="provider-model-ids" /><datalist id="provider-model-ids">{connection?.baseUrl === baseUrl && connection.models.map(item => <option key={item.id} value={item.id} />)}</datalist><p id="model-id-hint" className="mt-sm text-xs text-tertiary">Model spelling and endpoint support are account-specific. Discovery alone does not verify generation.</p></div>
            <details key={preset} open={preset === 'custom' ? true : undefined} className="border-t border-secondary pt-lg">
              <summary className="cursor-pointer rounded-md text-sm text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring">Advanced connection options</summary>
              <div className="mt-lg space-y-lg">
                <div><label htmlFor="model-base-url" className="mb-sm block text-sm font-medium text-secondary">API base URL</label><input id="model-base-url" type="url" required className={fieldClass} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" aria-describedby="model-url-hint" /><p id="model-url-hint" className="mt-sm text-xs text-tertiary">Already populated for this provider. Do not append /responses or /chat/completions. Custom hosts require a server allowlist.</p></div>
                <div><label htmlFor="model-api-style" className="mb-sm block text-sm font-medium text-secondary">API protocol</label><select id="model-api-style" className={fieldClass} value={apiStyle} onChange={event => setApiStyle(event.target.value as 'chat' | 'responses')}><option value="responses">Responses</option><option value="chat">Chat Completions</option></select><p className="mt-sm text-xs text-tertiary">Change only if the selected model’s official docs require it. RecallLoop does not silently switch protocols.</p></div>
              </div>
            </details>
            <Button primary type="submit" disabled={disabled || !baseUrl || !model || (!local && !apiKey)}>Connect &amp; verify model</Button>
          </fieldset>
        </form>}
        {preset === 'agentrouter' && <div className="flex items-start gap-md border-t border-secondary pt-lg text-sm text-secondary"><AlertCircle size={17} className="mt-xxs shrink-0 text-fg-warning-primary" /><div>AgentRouter controls client approval and per-model access. RecallLoop approval is not established; if denied, ask the provider to allow this app or choose another provider. We never spoof another client.<p className="mt-sm"><HelpLink href="https://ps.air-outer.com/pricing">Exact IDs &amp; endpoints</HelpLink><span className="mx-lg text-tertiary">·</span><HelpLink href="https://agentrouter.org/docs/terms.html">Usage terms</HelpLink></p></div></div>}
        <details className="border-t border-secondary pt-lg"><summary className="cursor-pointer rounded-md text-sm text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring">Verification &amp; tool options</summary><div className="mt-lg space-y-lg">
          <Checkbox checked={tools} onChange={setTools} disabled={disabled}>Enable bounded coding &amp; memory tools</Checkbox>
          <Checkbox checked={checkCapabilities} onChange={setCheckCapabilities} disabled={disabled}>Also check streaming &amp; enabled tools</Checkbox>
          <p className="text-xs text-tertiary">Capability checks add up to two small requests. The function check never executes a real tool. Use Verify model to apply tool settings to a saved connection, or Connect to install a new one.</p>
        </div></details>
      </section>}
      {section === 'tatum' && <section className="space-y-xl" aria-label="Tatum connection">
        <div className="flex flex-wrap items-center justify-between gap-md"><h3 className="flex items-center gap-md text-lg font-semibold"><Server size={19} className="shrink-0 text-fg-secondary" />Tatum chain access</h3><Badge tone={status?.tatum.verified ? 'success' : 'neutral'}>{status?.tatum.verified ? 'Checkpoint verified' : 'Not connected'}</Badge></div>
        <p className="text-sm text-secondary">Read Sui Mainnet checkpoints and verify Walrus account ownership. RecallLoop never submits transactions through this connection.</p>
        <div className="flex flex-wrap gap-xl"><HelpLink href="https://dashboard.tatum.io">Tatum dashboard</HelpLink><HelpLink href="https://docs.tatum.io">Tatum documentation</HelpLink></div>
        {status?.tatum.configured && <><p className="text-xs text-tertiary">Sui Mainnet · {status.tatum.verifiedAt ? `verified ${new Date(status.tatum.verifiedAt).toLocaleString()}` : 'verified with your session key'}</p><div className="flex flex-wrap gap-sm">
          <Button disabled={disabled} onClick={() => { void request('tatum', '/connections/tatum/verify', {}, 'A fresh Sui Mainnet checkpoint was verified through Tatum. Walrus and model connections are unchanged.') }}>Verify Tatum</Button>
          <Button disabled={disabled} onClick={() => setEditing(old => ({ ...old, tatum: !old.tatum }))}>{editing.tatum ? 'Hide reconnect form' : 'Reconnect Tatum'}</Button>
          <Button quiet disabled={locked} onClick={() => { void request('tatum', '/connections/tatum/disconnect', {}, 'Tatum and dependent Walrus authorization disconnected. Stored memories and the model connection are untouched.') }}>Disconnect Tatum &amp; Walrus</Button>
        </div><p className="text-xs text-tertiary">Disconnecting Tatum also disconnects the Walrus authorization that depends on it. It does not delete remote memories.</p></>}
        {editing.tatum && <form className="space-y-lg" onSubmit={event => { event.preventDefault(); registerBrowserSecret(tatumKey); void request('tatum', '/connections/tatum', { apiKey: tatumKey }, 'Tatum Mainnet checkpoint verified. The key was cleared from this form.') }}>
          <div><label htmlFor="tatum-session-key" className="mb-sm block text-sm font-medium text-secondary">Tatum API key</label><input id="tatum-session-key" type="password" autoComplete="off" data-lpignore="true" maxLength={4096} className={fieldClass} value={tatumKey} onChange={event => setTatumKey(event.target.value)} disabled={disabled} required placeholder="Mainnet-scoped API key" aria-describedby="tatum-key-hint" /><p id="tatum-key-hint" className="mt-sm text-xs text-tertiary">Create a Mainnet key in your Tatum dashboard. Verification is a read-only checkpoint request; API quotas apply.</p></div>
          <Button primary type="submit" disabled={disabled || !tatumKey}>Verify &amp; connect Tatum</Button>
        </form>}
      </section>}
      {section === 'walrus' && <section className="space-y-xl" aria-label="Walrus Memory connection">
        <div className="flex flex-wrap items-center justify-between gap-md"><h3 className="flex items-center gap-md text-lg font-semibold"><Database size={19} className="shrink-0 text-fg-secondary" />Walrus Memory</h3><Badge tone={status?.memoryConnection?.verified ? 'success' : 'neutral'}>{status?.memoryConnection?.verified ? 'Owner & delegate verified' : 'Not connected'}</Badge></div>
        <p className="text-sm text-secondary">Portable memory for later sessions, owned by your wallet. Connect Tatum first, then use an official Mainnet account and a dedicated delegate key.</p>
        <div className="flex flex-wrap gap-xl"><HelpLink href="https://memory.walrus.xyz/dashboard">Walrus dashboard</HelpLink><HelpLink href="https://docs.wal.app/walrus-memory/">Walrus documentation</HelpLink></div>
        {!status?.tatum.configured && <p className="flex flex-wrap items-center gap-md text-sm text-warning-primary">Tatum is needed to verify the account owner.<Button size="sm" disabled={locked} onClick={() => setSection('tatum')}>Connect Tatum first</Button></p>}
        {status?.memoryConnection && <>
          <p className="break-all font-mono text-xs text-secondary">Account: {status.memoryConnection.accountId}</p>
          <div className="flex flex-wrap gap-sm"><Button disabled={disabled} onClick={() => { void request('walrus', '/connections/memwal/verify', {}, 'Walrus account owner and signed delegate access verified again. No memory was written.') }}>Verify Walrus</Button><Button disabled={disabled} onClick={() => setEditing(old => ({ ...old, walrus: !old.walrus }))}>{editing.walrus ? 'Hide reconnect form' : 'Reconnect Walrus'}</Button><Button quiet disabled={locked} onClick={() => { void request('walrus', '/connections/memwal/disconnect', {}, 'Walrus disconnected. Stored memories, Tatum, and the model remain unchanged. Reconnect this account to recall again.') }}>Disconnect Walrus</Button></div>
          <details className="border-t border-secondary pt-lg"><summary className="cursor-pointer rounded-md text-sm text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring">Account &amp; delegate details</summary><div className="mt-lg space-y-sm text-xs text-secondary"><p className="break-all">Owner: {status.memoryConnection.owner}</p><p>Delegate public key · submission agent ID:</p><div className="flex items-start gap-sm"><code className="min-w-0 break-all">{status.memoryConnection.publicKey}</code><CopyButton text={status.memoryConnection.publicKey} label="Copy delegate public key" /></div></div></details>
        </>}
        {editing.walrus && <form className="space-y-lg" onSubmit={event => { event.preventDefault(); registerBrowserSecret(delegateKey); void request('walrus', '/connections/memwal', { accountId, delegateKey }, 'Mainnet account owner and delegate authorization verified. Confirm individual memory writes in Memory; connection verification is not storage evidence.') }}>
          <div><label htmlFor="memwal-account" className="mb-sm block text-sm font-medium text-secondary">Walrus Memory account object ID</label><input id="memwal-account" className={fieldClass} value={accountId} maxLength={66} onChange={event => setAccountId(event.target.value)} disabled={disabled} required placeholder="0x… account object ID" aria-describedby="walrus-account-hint" /><p id="walrus-account-hint" className="mt-sm text-xs text-tertiary">Not your wallet address. The account must be owned by your signed-in wallet on Sui Mainnet.</p></div>
          <div><label htmlFor="memwal-delegate" className="mb-sm block text-sm font-medium text-secondary">Delegate private key</label><input id="memwal-delegate" type="password" autoComplete="off" data-lpignore="true" maxLength={256} className={fieldClass} value={delegateKey} onChange={event => setDelegateKey(event.target.value)} disabled={disabled} required placeholder="32-byte hex or suiprivkey1…" aria-describedby="walrus-delegate-hint" /><p id="walrus-delegate-hint" className="mt-sm text-xs text-warning-primary">Only a dedicated, revocable Walrus delegate key. Never paste a seed phrase or your wallet’s private key.</p></div>
          <Button primary type="submit" disabled={disabled || !status?.tatum.configured || !accountId || !delegateKey}>Verify &amp; connect Walrus</Button>
        </form>}
        <p className="border-t border-secondary pt-lg text-xs text-tertiary">Verification checks owner and signed delegate access, not stored blobs. Signed reads may consume delegate budget. Account creation/grants in the external dashboard can involve transactions. Capture sends plaintext to the relayer for embedding, encryption, and storage; Walrus costs and relayer quotas apply.</p>
      </section>}
      {section === 'advanced' && <section className="space-y-2xl" aria-label="Advanced workspace settings">
        <div><h3 className="mb-md text-lg font-semibold">Workspace access token</h3><p className="mb-lg text-sm text-tertiary">Only needed when the server operator configures an extra access gate. It does not replace signed wallet login.</p>
          <form onSubmit={event => { event.preventDefault(); void updateToken(token, 'Workspace access token held in memory for this tab only.') }}>
            <label htmlFor="workspace-token" className="mb-sm block text-sm font-medium text-secondary">Workspace bearer token</label><input id="workspace-token" type="password" autoComplete="off" maxLength={4096} className={fieldClass} value={token} onChange={event => setToken(event.target.value)} disabled={locked} placeholder="Only when an operator gate is configured" />
            <div className="mt-lg flex flex-wrap gap-sm"><Button type="submit" disabled={locked || !token}>Unlock this tab</Button><Button disabled={locked} onClick={() => { void updateToken('', 'Workspace access token cleared from this tab.') }}>Clear token</Button></div>
          </form>
        </div>
        <div className="border-t border-secondary pt-xl"><h3 className="mb-md text-sm font-semibold">Embedding configuration is separate</h3><p className="text-sm text-tertiary">Walrus Memory uses the relayer’s embeddings, not your workspace model key. The optional CLI vector experiment uses a separate operator <code>OPENAI_API_KEY</code>. It is billable and is not part of this wallet workspace; no embedding credential belongs in these forms.</p></div>
        <div className="border-t border-secondary pt-xl"><h3 className="mb-md text-sm font-semibold">Scripted model for testing</h3><p className="mb-lg text-sm text-tertiary">A deterministic mock, not a live LLM. This changes only the model: an existing live Walrus connection can still capture memory and incur costs.</p><Button disabled={locked} onClick={() => { void request('advanced', '/connect', { mode: 'mock' }, 'Scripted mock model selected. Memory mode is unchanged; this is not live-generation evidence.') }}>Use scripted mock model</Button></div>
      </section>}
      {pending && <p role="status" className="mt-xl flex flex-wrap items-center gap-md text-sm text-secondary"><LoaderCircle size={16} className="shrink-0 animate-spin" aria-hidden="true" />{pending.message}{controller.current && <Button size="sm" quiet onClick={() => controller.current?.abort()}>Cancel check</Button>}</p>}
      {feedback?.section === section && <div role={feedback.error ? 'alert' : 'status'} className={`mt-xl rounded-md border p-lg text-sm ${feedback.error ? 'border-error-subtle text-error-primary' : 'border-secondary text-secondary'}`}><p>{feedback.message}</p>{feedback.code && <code className="mt-sm block text-xs">{feedback.code}</code>}</div>}
    </div>
    <p className="mt-2xl flex items-start gap-md border-t border-secondary pt-xl text-xs text-tertiary"><ShieldCheck size={16} className="shrink-0 text-fg-tertiary" />Keys stay in this trusted server process for at most one hour. Password fields and redaction buffers use temporary tab memory, never caches, prompts, downloads, or Walrus. Logout or restart drops connections. Redaction is best-effort; do not paste unrelated secrets into chat or files.</p>
  </Modal>
}
