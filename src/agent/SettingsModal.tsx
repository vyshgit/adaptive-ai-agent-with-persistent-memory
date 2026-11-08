import { useState } from 'react'
import { KeyRound, ShieldCheck, Server, Database } from 'lucide-react'
import type { Connection, WalletSession, WorkspaceStatus } from './types.ts'
import { agentJson, setWorkspaceToken } from './api.ts'
import { registerBrowserSecret } from './clientSafety.ts'
import { Button, Checkbox, Modal, Badge, CopyButton, fieldClass } from './ui.tsx'

const presets = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiStyle: 'responses' as const },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiStyle: 'chat' as const },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiStyle: 'chat' as const },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiStyle: 'chat' as const },
  { id: 'gemini', label: 'Gemini (OpenAI compatibility)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiStyle: 'chat' as const },
  { id: 'agentrouter', label: 'AgentRouter (requires client approval)', baseUrl: 'https://agentrouter.org/v1', apiStyle: 'responses' as const },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', apiStyle: 'chat' as const },
  { id: 'custom', label: 'Other allowed OpenAI-compatible API', baseUrl: '', apiStyle: 'chat' as const },
]

export default function SettingsModal({ connection, status, identity, onClose, onRefresh, busy }: { connection?: Connection; status?: WorkspaceStatus; identity: WalletSession; onClose: () => void; onRefresh: () => Promise<void>; busy: boolean }) {
  const [preset, setPreset] = useState(presets.find(item => item.baseUrl === connection?.baseUrl)?.id || 'agentrouter')
  const [baseUrl, setBaseUrl] = useState(connection?.mode === 'live' ? connection.baseUrl : 'https://agentrouter.org/v1')
  const [apiStyle, setApiStyle] = useState<'responses' | 'chat'>(connection?.apiStyle || 'responses')
  const [model, setModel] = useState(connection?.mode === 'live' ? connection.model : '')
  const [apiKey, setApiKey] = useState('')
  const [tools, setTools] = useState(connection?.toolsEnabled !== false)
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tatumKey, setTatumKey] = useState('')
  const [delegateKey, setDelegateKey] = useState('')
  const [accountId, setAccountId] = useState(status?.memoryConnection?.accountId || '')
  const disabled = pending || busy || identity.demo
  const local = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(baseUrl)
  async function connect(mode: 'live' | 'mock') {
    setPending(true); setError(''); setNotice('')
    if (mode === 'live') registerBrowserSecret(apiKey)
    try {
      const response = await agentJson<{ connection: Connection }>('/connect', { method: 'POST', body: JSON.stringify(mode === 'mock' ? { mode } : { mode, baseUrl, apiKey, model, apiStyle, toolsEnabled: tools }) })
      setApiKey('')
      await onRefresh()
      setNotice(mode === 'mock' ? 'Scripted mock model selected. Memory mode is unchanged.' : `${response.connection.verified ? 'Models endpoint reachable.' : 'Models discovery unavailable; using your entered model ID.'} Generation still needs a compatible, authorised model. The key has been cleared from this form.`)
    } catch (error) { setError(error instanceof Error ? error.message : 'The model connection failed.') }
    finally { setPending(false) }
  }
  async function credential(path: string, body: object, success: string) {
    setPending(true); setError(''); setNotice('')
    try {
      await agentJson(path, { method: 'POST', body: JSON.stringify(body) }, 50_000)
      setTatumKey(''); setDelegateKey(''); await onRefresh(); setNotice(success)
    } catch (error) { setError(error instanceof Error ? error.message : 'Connection verification failed.') }
    finally { setPending(false) }
  }
  return <Modal title="Workspace settings" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
    <div className="flex flex-col gap-xl">
      <p className="text-xs text-tertiary">{identity.demo ? 'Offline demo: live API connections are disabled. Leave the demo and sign in with your wallet.' : `Signed in: ${identity.address}. This one-hour session expires ${new Date(identity.expiresAt!).toLocaleTimeString()}.`}</p>
      <section>
        <h3 className="mb-md flex items-center gap-sm text-sm font-semibold"><Server size={17} className="shrink-0 text-fg-tertiary" />1. Connect your Tatum Mainnet API</h3>
        <p className="mb-lg text-xs text-tertiary">{status?.tatum.configured ? 'Verified: Sui Mainnet checkpoint read through Tatum.' : 'Use a Mainnet-scoped key from dashboard.tatum.io. RecallLoop reads checkpoints and account ownership; it never submits transactions.'}</p>
        <form className="flex flex-col gap-lg" onSubmit={event => { event.preventDefault(); registerBrowserSecret(tatumKey); void credential('/connections/tatum', { apiKey: tatumKey }, 'Tatum Mainnet checkpoint verified. The API key has been cleared from this form.') }}>
          <div><label htmlFor="tatum-session-key" className="mb-sm block text-sm font-medium text-secondary">Tatum API key</label><input id="tatum-session-key" type="password" autoComplete="off" data-lpignore="true" maxLength={4096} className={fieldClass} value={tatumKey} onChange={event => setTatumKey(event.target.value)} disabled={disabled} required placeholder="Mainnet API key — temporary connection" /></div>
          <Button primary type="submit" disabled={disabled || !tatumKey}>{pending ? 'Checking…' : 'Verify & connect Tatum'}</Button>
        </form>
        {status?.tatum.configured && <Button className="mt-sm" disabled={pending || busy} onClick={() => { void credential('/connections/tatum/disconnect', {}, 'Tatum and its dependent Walrus connection were removed. Stored Walrus memories are untouched.') }}>Disconnect Tatum &amp; Walrus</Button>}
      </section>
      <section className="border-t border-secondary pt-xl">
        <h3 className="mb-md flex items-center gap-sm text-sm font-semibold"><Database size={17} className="shrink-0 text-fg-tertiary" />2. Connect your Walrus Memory account</h3>
        <p className="mb-lg text-xs text-tertiary">Create a Mainnet account and dedicated delegate key at <a href="https://memory.walrus.xyz/dashboard" target="_blank" rel="noreferrer" className="rounded-md text-brand-primary underline focus-visible:ring-2 focus-visible:ring-focus-ring">memory.walrus.xyz</a>. The account must be owned by your signed-in wallet. Connect Tatum first to verify it.</p>
        <form className="flex flex-col gap-lg" onSubmit={event => { event.preventDefault(); registerBrowserSecret(delegateKey); void credential('/connections/memwal', { accountId, delegateKey }, 'Walrus account owner and delegate authorization verified. Future capture uses the official Mainnet relayer; confirm individual writes in Memory.') }}>
          <div><label htmlFor="memwal-account" className="mb-sm block text-sm font-medium text-secondary">Walrus Memory account object ID</label><input id="memwal-account" className={fieldClass} value={accountId} maxLength={66} onChange={event => setAccountId(event.target.value)} disabled={disabled} required placeholder="0x… account object, not wallet address" /></div>
          <div><label htmlFor="memwal-delegate" className="mb-sm block text-sm font-medium text-secondary">Delegate private key</label><input id="memwal-delegate" type="password" autoComplete="off" data-lpignore="true" maxLength={256} className={fieldClass} value={delegateKey} onChange={event => setDelegateKey(event.target.value)} disabled={disabled} required placeholder="32-byte hex or suiprivkey1…" /><p className="mt-sm text-xs text-warning-primary">Never paste a seed phrase or your wallet’s private key. Only use a dedicated, revocable Walrus Memory delegate key.</p></div>
          <Button primary type="submit" disabled={disabled || !status?.tatum.configured || !accountId || !delegateKey}>{pending ? 'Checking…' : 'Verify & connect Walrus'}</Button>
        </form>
        {status?.memoryConnection && <div className="mt-lg text-xs text-secondary"><Badge tone="success">Owner &amp; delegate verified</Badge><p className="mt-sm">Delegate public key (submission agent ID):</p><div className="flex items-center gap-sm"><code className="min-w-0 break-all">{status.memoryConnection.publicKey}</code><CopyButton text={status.memoryConnection.publicKey} label="Copy delegate public key" /></div><Button className="mt-md" disabled={pending || busy} onClick={() => { void credential('/connections/memwal/disconnect', {}, 'Walrus connection removed. Existing memories are untouched; reconnect the same account to recall them.') }}>Disconnect Walrus</Button></div>}
      </section>
      <section>
        <h3 className="mb-md flex items-center gap-sm border-t border-secondary pt-xl text-sm font-semibold"><KeyRound size={17} className="shrink-0 text-fg-tertiary" />3. Connect AgentRouter or another model API</h3>
        {connection && <p className="mb-lg text-xs text-tertiary">Current: <Badge tone={connection.mode === 'mock' ? 'warning' : 'neutral'}>{connection.mode}</Badge> · Your isolated wallet session{connection.expiresAt ? ` · expires ${new Date(connection.expiresAt).toLocaleTimeString()}` : ''}</p>}
        <fieldset disabled={disabled}>
        <form id="model-connection" className="flex flex-col gap-lg" onSubmit={event => { event.preventDefault(); void connect('live') }}>
          <div><label htmlFor="provider-preset" className="mb-sm block text-sm font-medium text-secondary">Provider</label><select id="provider-preset" className={fieldClass} value={preset} disabled={pending || busy} onChange={event => {
            const selected = presets.find(item => item.id === event.target.value)!
            setPreset(selected.id); setBaseUrl(selected.baseUrl); setApiStyle(selected.apiStyle)
          }}>{presets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
          <div><label htmlFor="model-base-url" className="mb-sm block text-sm font-medium text-secondary">API base URL</label><input id="model-base-url" type="url" required className={fieldClass} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} disabled={pending || busy} placeholder="https://api.example.com/v1" />
            <p className="mt-sm text-xs text-tertiary">Use the API base, not /responses or /chat/completions. Custom hosts require AGENT_LLM_ALLOWED_HOSTS on the server.</p></div>
          <div><label htmlFor="model-api-key" className="mb-sm block text-sm font-medium text-secondary">Model API key {local ? '(optional for local server)' : ''}</label><input id="model-api-key" type="password" autoComplete="off" data-lpignore="true" maxLength={4096} required={!local} className={fieldClass} value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={pending || busy} placeholder="Never saved in browser storage" /></div>
          <div><label htmlFor="model-id" className="mb-sm block text-sm font-medium text-secondary">Model ID</label><input id="model-id" required className={fieldClass} maxLength={128} value={model} onChange={event => setModel(event.target.value)} disabled={pending || busy} placeholder={preset === 'agentrouter' ? 'gpt-6.1-sol' : 'Your provider’s model ID'} /></div>
          <fieldset disabled={pending || busy}><legend className="mb-sm text-sm font-medium text-secondary">Wire API</legend><div className="flex flex-wrap gap-lg">
            {(['responses', 'chat'] as const).map(style => <label key={style} className="inline-flex cursor-pointer items-center gap-sm text-sm text-secondary"><input className="peer sr-only" name="api-style" type="radio" value={style} checked={apiStyle === style} onChange={() => setApiStyle(style)} /><span aria-hidden="true" className={`flex size-4 items-center justify-center rounded-full border bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-focus-ring ${apiStyle === style ? 'border-brand' : 'border-primary'}`}>{apiStyle === style && <span className="size-2 rounded-full bg-brand-solid" />}</span>{style === 'responses' ? 'Responses' : 'Chat Completions'}</label>)}
          </div></fieldset>
          <Checkbox checked={tools} onChange={setTools} disabled={pending || busy}>Enable bounded coding &amp; memory tools</Checkbox>
          <Button primary type="submit" disabled={pending || busy || !baseUrl || !model || (!local && !apiKey)}>{pending ? 'Checking connection…' : 'Connect model API'}</Button>
        </form>
        </fieldset>
        <p className="mt-lg flex items-start gap-sm text-xs text-tertiary"><ShieldCheck size={16} className="shrink-0" />Credential configurations stay in this server process for at most one hour, identified by an httpOnly cookie. Input fields and known-key redaction buffers are temporary tab memory, never browser caches, project exports, prompts, or Walrus. Logout or a server restart drops connections. Use localhost or HTTPS and a trusted server. Redaction is best-effort: do not paste unrelated secrets into chat or files.</p>
        {preset === 'agentrouter' && <p className="mt-md text-xs text-warning-primary">AgentRouter may reject unapproved clients. RecallLoop does not spoof another client. Ask the provider to allow this app or use another provider.</p>}
        <div className="mt-lg flex flex-wrap gap-sm"><Button disabled={pending || busy} onClick={() => { void connect('mock') }}>Use scripted mock model</Button>
          <Button disabled={pending || busy} onClick={async () => {
            setPending(true); setError('')
           try { await agentJson('/disconnect', { method: 'POST', body: '{}' }); setApiKey(''); await onRefresh(); setNotice('Model connection removed. No server-owner credentials will be used.') }
            catch (error) { setError(error instanceof Error ? error.message : 'Disconnect failed.') } finally { setPending(false) }
          }}>Disconnect model</Button></div>
      </section>
      <section className="border-t border-secondary pt-xl">
        <h3 className="mb-md flex items-center gap-sm text-sm font-semibold"><Server size={16} className="shrink-0 text-fg-tertiary" />Workspace access token</h3>
        <form onSubmit={async event => { event.preventDefault(); setWorkspaceToken(token); setToken(''); await onRefresh(); setNotice('Workspace access token is held in memory for this tab only.') }}>
          <label htmlFor="workspace-token" className="sr-only">Workspace bearer token</label><input id="workspace-token" type="password" autoComplete="off" className={fieldClass} value={token} onChange={event => setToken(event.target.value)} placeholder="Only when RECALLLOOP_WORKSPACE_TOKEN is configured" />
          <div className="mt-sm flex flex-wrap gap-sm"><Button type="submit">Unlock this tab</Button><Button onClick={async () => { setWorkspaceToken(''); setToken(''); await onRefresh(); setNotice('Workspace access token cleared from this tab.') }}>Clear token</Button></div>
        </form>
        <p className="mt-sm text-xs text-tertiary">This optional operator gate does not replace signed wallet login. Server-owner .env credentials apply only to the separate external-agent and legacy APIs, never to a wallet workspace.</p>
      </section>
      {error && <p role="alert" className="text-sm text-error-primary">{error}</p>}
      {notice && <p role="status" className="text-sm text-secondary">{notice}</p>}
    </div>
  </Modal>
}
