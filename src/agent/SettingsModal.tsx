import { useEffect, useId, useRef, useState } from 'react'
import { KeyRound, ShieldCheck, Server, Database, ExternalLink, RefreshCw, AlertCircle, LoaderCircle } from 'lucide-react'
import type { Connection, ProviderModel, WalletSession, WorkspaceStatus } from './types.ts'
import { agentJson } from './api.ts'
import { newId, redactBrowserText, registerBrowserSecret } from './clientSafety.ts'
import { PROVIDERS, providerForUrl, modelStatus, capabilityLabel, availableConnections, connectionLabel, modelLabel } from './providers.ts'
import { Button, Checkbox, Modal, Badge, CopyButton, Tabs, fieldClass } from './ui.tsx'
import LegacyCacheCleanup from './LegacyCacheCleanup.tsx'
import DeviceVaultPanel from './DeviceVaultPanel.tsx'
import type { DeviceVault, VaultConnectionName } from './deviceVault.ts'
import { useDeviceVault } from './useDeviceVault.ts'
import { reconnectVault } from './reconnectVault.ts'
import type { ProviderPreference, UpdatePreferences, WorkspacePreferences } from './workspacePreferences.ts'
import { connectionPreference, providerSetup } from './workspacePreferences.ts'

export type SettingsSection = 'model' | 'tatum' | 'walrus' | 'advanced'
type Section = SettingsSection
type Feedback = { section: Section; message: string; error?: boolean; code?: string }
const linkClass = 'inline-flex items-center gap-xs rounded-md text-sm text-secondary underline decoration-border-primary underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
function HelpLink({ href, children }: { href: string; children: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>{children}<ExternalLink size={13} className="shrink-0 text-fg-tertiary" aria-hidden="true" /></a>
}

export default function SettingsModal({ connection: defaultConnection, status, identity, vault, preferences, onPreferences, onClearPreferences, preferenceWarning, onClose, onRefresh, busy, initialSection = 'model' }: { connection?: Connection; status?: WorkspaceStatus; identity: WalletSession; vault: DeviceVault | null; preferences: WorkspacePreferences; onPreferences: UpdatePreferences; onClearPreferences: () => boolean; preferenceWarning: string; onClose: () => void; onRefresh: () => Promise<boolean>; busy: boolean; initialSection?: Section }) {
  const vaultState = useDeviceVault(vault)
  const profiles = availableConnections(defaultConnection, status?.modelConnections)
  const [selectedProfile, setSelectedProfile] = useState(defaultConnection?.id || '')
  const connection = profiles.find(item => item.id === selectedProfile) || defaultConnection
  const initialSetup = useRef(providerSetup(connection, preferences)).current
  const [section, setSection] = useState<Section>(initialSection)
  const tabsId = useId()
  const [preset, setPreset] = useState(initialSetup.preset)
  const [baseUrl, setBaseUrl] = useState(initialSetup.baseUrl)
  const [apiStyle, setApiStyle] = useState<'responses' | 'chat'>(initialSetup.apiStyle)
  const [model, setModel] = useState(initialSetup.model)
  const [apiKey, setApiKey] = useState('')
  const [profileId, setProfileId] = useState(() => connection?.mode === 'live' ? connection.id || newId() : newId())
  const [profileName, setProfileName] = useState(connection?.name || '')
  const [catalog, setCatalog] = useState<{ baseUrl: string; models: ProviderModel[]; discovered: boolean } | null>(null)
  const [manualModel, setManualModel] = useState(false)
  const [tools, setTools] = useState(connection?.toolsEnabled !== false)
  const [checkCapabilities, setCheckCapabilities] = useState(false)
  const [pending, setPending] = useState<{ section: Section; message: string } | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [tatumKey, setTatumKey] = useState('')
  const [delegateKey, setDelegateKey] = useState('')
  const [accountId, setAccountId] = useState(preferences.accountId || status?.memoryConnection?.accountId || '')
  const [editing, setEditing] = useState({ model: connection?.mode !== 'live' || initialSetup.baseUrl !== connection.baseUrl || initialSetup.apiStyle !== connection.apiStyle || initialSetup.model !== connection.model, tatum: !status?.tatum.configured, walrus: !status?.memoryConnection })
  const [remember, setRemember] = useState({ model: true, tatum: true, walrus: true })
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const leave = () => { controller.current?.abort(); vault?.lock(); setApiKey(''); setTatumKey(''); setDelegateKey('') }
    // Switching browser tabs is not logout. Keep the form and in-flight checks;
    // page exit, explicit lock and wallet/session revocation still stop access.
    let unlocked = vault?.getSnapshot().unlocked
    const off = vault?.subscribe(() => {
      const next = vault.getSnapshot().unlocked
      if (unlocked && !next) controller.current?.abort()
      unlocked = next
    })
    window.addEventListener('pagehide', leave)
    return () => { mounted.current = false; controller.current?.abort(); off?.(); window.removeEventListener('pagehide', leave) }
  }, [vault])
  useEffect(() => { if (vaultState.unlocked) setRemember({ model: true, tatum: true, walrus: true }) }, [vaultState.unlocked])
  useEffect(() => {
    if (!editing.model && connection?.mode === 'live') {
      setBaseUrl(connection.baseUrl); setPreset(providerForUrl(connection.baseUrl).id); setApiStyle(connection.apiStyle)
      setModel(connection.model); setTools(connection.toolsEnabled)
      setProfileId(connection.id || newId()); setProfileName(connection.name || '')
    }
  }, [connection, editing.model])
  const locked = Boolean(pending) || busy || vaultState.busy
  const disabled = locked || identity.demo
  const local = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(baseUrl)
  const selected = PROVIDERS.find(item => item.id === preset)!
  const rememberedModel = preferences.providers?.[preset]?.baseUrl === baseUrl && preferences.providers[preset].apiStyle === apiStyle ? preferences.providers[preset].model : undefined
  const currentModelStatus = modelStatus(connection, connection?.model || '')
  const selectedModel = Boolean(model && catalog?.baseUrl === baseUrl && (catalog.models.some(item => item.id === model) || (!catalog.discovered && manualModel)))
  function close() { controller.current?.abort(); onClose() }
  function invalidateCatalog() { setCatalog(null); setModel(''); setManualModel(false) }
  function cacheProvider(patch: Partial<ProviderPreference> = {}) {
    onPreferences(current => ({ ...current, provider: preset, providers: { ...current.providers,
      [preset]: { baseUrl, apiStyle, model: model || current.providers?.[preset]?.model, ...patch } } }))
  }
  function secret(set: (value: string) => void, value: string) {
    registerBrowserSecret(value); set(value)
    // Scrub a known key accidentally entered into an otherwise cacheable field.
    onPreferences(current => current)
  }
  function addProvider() {
    setProfileId(newId()); setProfileName(''); setApiKey(''); invalidateCatalog(); setFeedback(null)
    setEditing(old => ({ ...old, model: true }))
  }
  function saveChoice(name: VaultConnectionName) {
    return <div className="flex flex-wrap items-center gap-sm"><Checkbox checked={remember[name] && vaultState.unlocked} onChange={value => setRemember(old => ({ ...old, [name]: value }))} disabled={disabled || !vaultState.unlocked}>Save this connection in device vault</Checkbox>{!vaultState.unlocked && <Button quiet size="sm" disabled={locked || identity.demo} onClick={() => setSection('advanced')}>Set up or unlock device vault</Button>}</div>
  }
  async function request(target: Section, path: string, body: object, message: string, save?: (signal: AbortSignal) => Promise<void>) {
    if (controller.current || locked) return
    const abort = new AbortController()
    const deadline = AbortSignal.any([abort.signal, AbortSignal.timeout(90_000)])
    controller.current = abort
    let completed = false
    setPending({ section: target, message: path.includes('disconnect') ? 'Disconnecting…' : 'Verifying the session connection…' })
    setFeedback(null)
    try {
      const result = await agentJson<{ connection?: Connection }>(path, { method: 'POST', body: JSON.stringify(body), signal: deadline })
      if (!mounted.current) return
      abort.signal.throwIfAborted()
      if (path === '/connect' && result.connection) {
        const chosen = connectionPreference(result.connection, result.connection.model)
        onPreferences(current => ({ ...current, conversation: { ...current.conversation, model: chosen } }))
      }
      if (target === 'model' && result.connection?.mode === 'live' && (path === '/connect' || !editing.model)) {
        setBaseUrl(result.connection.baseUrl); setPreset(providerForUrl(result.connection.baseUrl).id); setApiStyle(result.connection.apiStyle)
        setModel(result.connection.model); setTools(result.connection.toolsEnabled)
        setSelectedProfile(result.connection.id || ''); setProfileId(result.connection.id || profileId); setProfileName(result.connection.name || '')
        const config = result.connection, provider = providerForUrl(config.baseUrl).id
        onPreferences(current => ({ ...current, provider, providers: { ...current.providers, [provider]: { baseUrl: config.baseUrl, apiStyle: config.apiStyle, model: config.model } } }))
      }
      if (path === '/connect') setEditing(old => ({ ...old, model: result.connection?.mode !== 'live' }))
      if (path === '/connections/tatum') setEditing(old => ({ ...old, tatum: false }))
      if (path === '/connections/memwal') setEditing(old => ({ ...old, walrus: false }))
      if (path === '/disconnect') { setEditing(old => ({ ...old, model: true })); setProfileId(newId()); setProfileName('') }
      if (path === '/connections/tatum/disconnect') setEditing(old => ({ ...old, tatum: true, walrus: true }))
      if (path === '/connections/memwal/disconnect') setEditing(old => ({ ...old, walrus: true }))
      if (save) {
        try { await save(deadline) }
        catch (error) {
          if (mounted.current) {
            if (target !== 'advanced') setEditing(old => ({ ...old, [target]: true }))
            setFeedback({ section: target, error: true, message: `The connection verified, but its device copy was not saved. Your key is still in this form. ${redactBrowserText(error instanceof Error ? error.message : 'Unlock the vault and retry saving.')}` })
          }
          return
        }
        if (!mounted.current) return
        abort.signal.throwIfAborted()
      }
      completed = true
      setFeedback({ section: target, message: `${message}${save ? ' An encrypted copy was saved in this wallet’s device vault.' : ''}` })
    } catch (error) {
      if (!mounted.current) return
      const detail = abort.signal.aborted ? 'Check cancelled. Refreshing status in case verification finished just before cancellation.'
        : deadline.aborted ? 'The connection check timed out. Check provider status before trying again.'
        : error instanceof Error ? error.message : 'Connection verification failed.'
      setFeedback({ section: target, message: redactBrowserText(detail), error: !abort.signal.aborted, code: error instanceof Error ? (error as { code?: string }).code : undefined })
    } finally {
      if (mounted.current && completed) {
        // A failed/cancelled attempt leaves the key and catalogue available for
        // retry. Successful operations clear only their submitted fields.
        if (path === '/connect' && 'apiKey' in body) { setApiKey(''); setCatalog(null); setManualModel(false) }
        if (path === '/connections/tatum') setTatumKey('')
        if (path === '/connections/memwal') setDelegateKey('')
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
  async function discoverModels() {
    if (controller.current || disabled || !baseUrl || (!local && !apiKey)) return
    const abort = new AbortController(), deadline = AbortSignal.any([abort.signal, AbortSignal.timeout(25_000)])
    const requestedUrl = baseUrl, previousModel = model || rememberedModel || ''
    controller.current = abort
    registerBrowserSecret(apiKey)
    setPending({ section: 'model', message: 'Loading models from this provider…' }); setFeedback(null); setCatalog(null); setManualModel(false); setModel('')
    try {
      const result = await agentJson<{ baseUrl: string; models: ProviderModel[]; discovered: boolean }>('/models/discover', {
        method: 'POST', body: JSON.stringify({ baseUrl, apiKey, apiStyle }), signal: deadline,
      })
      if (!mounted.current) return
      abort.signal.throwIfAborted()
      const models = result.models.filter(item => /^[A-Za-z0-9._:/@+-]{1,128}$/.test(item.id)).slice(0, 100)
      setCatalog({ baseUrl: requestedUrl, models, discovered: result.discovered })
      setModel(models.some(item => item.id === previousModel) ? previousModel : '')
      setFeedback({ section: 'model', message: models.length ? `${models.length} provider models loaded. Select one below, then connect. Discovery does not verify generation or install your key.`
        : result.discovered ? 'This provider returned no supported model IDs. Refresh the list or check account access.'
          : 'This endpoint does not support model discovery. Check the provider’s catalogue; an exact ID can be entered under Advanced connection options as a fallback.' })
    } catch (error) {
      if (mounted.current) setFeedback({ section: 'model', error: !abort.signal.aborted,
        message: abort.signal.aborted ? 'Model discovery cancelled. Nothing was connected; your unsubmitted form is still here.'
          : redactBrowserText(error instanceof Error ? error.message : 'Provider models could not be loaded.'),
        code: error instanceof Error ? (error as { code?: string }).code : undefined })
    } finally {
      // The server discards discovery credentials. The unsubmitted browser form
      // stays page-only so selecting a model does not require pasting the key twice.
      if (controller.current === abort) controller.current = null
      if (mounted.current) setPending(null)
    }
  }
  async function reconnectSaved(profileId?: string) {
    if (!vault || locked || controller.current) return
    const abort = new AbortController()
    const deadline = AbortSignal.any([abort.signal, AbortSignal.timeout(300_000)])
    controller.current = abort; setFeedback(null); setPending({ section: 'advanced', message: 'Reconnecting saved connections…' })
    try {
      const results = await reconnectVault({ vault, signal: deadline, profileId, tatumConnected: Boolean(status?.tatum.configured),
        send: (path, body, signal) => agentJson(path, { method: 'POST', body: JSON.stringify(body), signal }),
        onStep: message => { if (mounted.current) setPending({ section: 'advanced', message }) } })
      if (!mounted.current) return
      abort.signal.throwIfAborted()
      setEditing(old => ({ ...old, ...Object.fromEntries(results.filter(result => result.status === 'verified').map(result => [result.connection, false])) }))
      setFeedback({ section: 'advanced', message: results.map(result => result.message).join(' '), error: results.some(result => result.status !== 'verified') })
    } catch (error) {
      if (mounted.current) setFeedback({ section: 'advanced', error: !abort.signal.aborted,
        message: abort.signal.aborted ? 'Saved reconnection cancelled. Refreshing status in case a verification already committed.' : redactBrowserText(error instanceof Error ? error.message : 'Saved reconnection failed.') })
    } finally {
      try { if (!await onRefresh() && mounted.current) setFeedback({ section: 'advanced', message: 'Could not refresh connection status. Retry status before sending a turn.', error: true }) }
      catch { if (mounted.current) setFeedback({ section: 'advanced', message: 'Could not refresh connection status. Retry status before sending a turn.', error: true }) }
      if (controller.current === abort) controller.current = null
      if (mounted.current) setPending(null)
    }
  }
  return <Modal title="Workspace settings" onClose={close} bodyClassName="workspace-scroll" footer={<>
    <span className="mr-auto self-center text-xs text-tertiary">{identity.demo ? 'Demo · no live credentials' : `Session ends ${new Date(identity.expiresAt!).toLocaleTimeString()}`}</span>
    <Button onClick={close}>{pending ? 'Close & cancel check' : 'Done'}</Button>
  </>}>
    <p className="mb-lg text-xs text-tertiary">Connect providers once, then switch models in the workspace. Wallet and API connections stay active across browser tabs for this session.</p>
    {identity.demo && <p className="mb-xl rounded-md border border-secondary bg-secondary p-lg text-sm text-secondary">Live connections are disabled in the offline demo. Leave the demo and connect your wallet to use your own APIs.</p>}
    <Tabs id={tabsId} value={section} onChange={setSection} label="Settings sections" tabs={[{ id: 'model', label: 'Model' }, { id: 'tatum', label: 'Tatum' }, { id: 'walrus', label: 'Walrus Memory' }, { id: 'advanced', label: 'Advanced' }]} />
    <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${section}`} className="min-w-0 pt-xl">
      {section === 'model' && <section className="space-y-lg" aria-label="Model provider connection">
        <div className="flex flex-wrap items-center justify-between gap-md"><h3 className="flex items-center gap-sm text-md font-semibold"><KeyRound size={17} className="shrink-0 text-fg-secondary" aria-hidden="true" />Model provider</h3><Badge tone={currentModelStatus.tone}>{currentModelStatus.label}</Badge></div>
        {profiles.length > 0 && <div className="flex flex-wrap items-end gap-md"><div className="min-w-0 flex-1"><label htmlFor="connected-provider" className="mb-sm block text-sm font-medium text-secondary">Connected provider profile</label><select id="connected-provider" className={fieldClass} value={connection?.id || ''} disabled={locked} onChange={event => { setSelectedProfile(event.target.value); setEditing(old => ({ ...old, model: false })); setApiKey(''); invalidateCatalog(); setFeedback(null) }}>{profiles.map((profile, index) => <option key={profile.id || index} value={profile.id || ''}>{connectionLabel(profile)}</option>)}</select></div><Button disabled={disabled || profiles.length >= 12} onClick={addProvider}>Add provider</Button></div>}
        <p className="text-xs text-tertiary">Load models does not connect or generate. Connect / Verify sends one small billable check (up to 256 output tokens).</p>
        {connection?.mode === 'live' && <>
          <div className="min-w-0 space-y-sm text-sm text-secondary"><p className="break-all font-mono">{connection.model}</p><p className="break-all text-xs text-tertiary">{connection.baseUrl} · {connection.apiStyle === 'responses' ? 'Responses' : 'Chat Completions'}</p></div>
          <details open={Boolean(connection.lastVerificationFailure || connection.verification?.streamingError || connection.verification?.toolsError) || undefined} className="border-t border-secondary pt-lg"><summary className="cursor-pointer rounded-md text-xs text-tertiary focus-visible:ring-2 focus-visible:ring-focus-ring">Verification details</summary><dl className="mt-lg grid grid-cols-2 gap-lg text-xs sm:grid-cols-3">
            <div><dt className="text-tertiary">Discovery</dt><dd className="mt-xs text-secondary">{connection.verification?.discovery === 'available' ? 'Available · not a generation test' : 'Unavailable · entered ID'}</dd></div>
            <div><dt className="text-tertiary">Streaming</dt><dd className="mt-xs text-secondary">{capabilityLabel(connection.verification?.streaming)}</dd></div>
            <div><dt className="text-tertiary">Function tools</dt><dd className="mt-xs text-secondary">{capabilityLabel(connection.verification?.tools)}{!connection.toolsEnabled ? ' · disabled' : ''}</dd></div>
          </dl>
          {connection.verification?.checkedAt && <p className="mt-lg text-xs text-tertiary">Checked {new Date(connection.verification.checkedAt).toLocaleString()}. Only this model and protocol were checked.</p>}</details>
          {connection.lastVerificationFailure && <p className="text-sm text-error-primary">Last verification: {connection.lastVerificationFailure.message}</p>}
          {[connection.verification?.streamingError, connection.verification?.toolsError].filter(Boolean).map((error, index) => <p key={index} className="text-xs text-warning-primary">{error!.message}</p>)}
          <div className="flex flex-wrap gap-sm">
            <Button disabled={disabled} onClick={() => { void request('model', '/verify', { connectionId: connection.id, checkCapabilities, toolsEnabled: tools }, 'Generation verified with your saved session key. Capability results are shown separately; no memory was written.') }}><RefreshCw size={14} className="shrink-0" />Verify model</Button>
            <Button disabled={disabled} onClick={() => setEditing(old => ({ ...old, model: !old.model }))}>{editing.model ? 'Hide reconnect form' : 'Reconnect model'}</Button>
            <Button quiet disabled={locked} onClick={() => { void request('model', '/disconnect', { connectionId: connection.id }, 'Provider disconnected from this session. Its encrypted saved profile is available for reconnection.') }}>Disconnect model</Button>
          </div>
        </>}
        {editing.model && <form className="space-y-lg" onSubmit={event => {
          event.preventDefault(); if (!selectedModel || disabled) return; registerBrowserSecret(apiKey)
          void request('model', '/connect', { mode: 'live', profileId, profileName: profileName.trim() || selected.label, baseUrl, apiKey, model, apiStyle, toolsEnabled: tools, checkCapabilities }, 'Generation verified. This provider is ready in your model picker.',
            remember.model && vaultState.unlocked && vault ? signal => vault.save('model', { profileId, profileName: profileName.trim() || selected.label, baseUrl, apiKey: apiKey.trim(), model, apiStyle, toolsEnabled: tools }, signal) : undefined)
        }}>
          <fieldset disabled={disabled} className="space-y-lg">
            <div><label htmlFor="provider-preset" className="mb-sm block text-sm font-medium text-secondary">Provider</label><select id="provider-preset" className={fieldClass} value={preset} onChange={event => {
              const next = PROVIDERS.find(item => item.id === event.target.value)!
              const saved = preferences.providers?.[next.id]
              setPreset(next.id); setBaseUrl(saved?.baseUrl ?? next.baseUrl); setApiStyle(saved?.apiStyle ?? next.apiStyle); invalidateCatalog(); setApiKey(''); setProfileId(newId()); setProfileName('')
              onPreferences(current => ({ ...current, provider: next.id, providers: { ...current.providers, [next.id]: saved || { baseUrl: next.baseUrl, apiStyle: next.apiStyle } } }))
            }}>{PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
            <div className="flex flex-wrap gap-lg">{selected.keyUrl && <HelpLink href={selected.keyUrl}>Get an API key</HelpLink>}{selected.modelsUrl && <HelpLink href={selected.modelsUrl}>Available models</HelpLink>}{selected.docsUrl && <HelpLink href={selected.docsUrl}>API documentation</HelpLink>}</div>
            <div><label htmlFor="model-api-key" className="mb-sm block text-sm font-medium text-secondary">Model API key{local ? ' (optional for local server)' : ''}</label><input id="model-api-key" type="password" autoComplete="off" data-lpignore="true" maxLength={4096} required={!local} className={fieldClass} value={apiKey} onChange={event => { secret(setApiKey, event.target.value); invalidateCatalog() }} placeholder={preset === 'huggingface' ? 'Hugging Face access token (hf_…)' : 'Only your selected provider’s key'} aria-describedby="model-key-hint" /><p id="model-key-hint" className="mt-sm text-xs text-tertiary">{preset === 'huggingface' ? 'Enable “Make calls to Inference Providers” on this token. ' : ''}Kept through failed checks and tab switches; unused unless saved to the encrypted vault.</p></div>
            <div className="flex flex-wrap items-end gap-lg"><div className="min-w-0 flex-1"><label htmlFor="provider-model" className="mb-sm block text-sm font-medium text-secondary">Model</label><select id="provider-model" required={!manualModel} className={fieldClass} value={manualModel ? '' : model} disabled={disabled || !catalog?.models.length || catalog.baseUrl !== baseUrl || manualModel} onChange={event => { setModel(event.target.value); cacheProvider({ model: event.target.value }) }} aria-describedby="provider-model-hint"><option value="">{catalog?.models.length ? 'Choose a provider model…' : 'Load provider models first'}</option>{catalog?.baseUrl === baseUrl && catalog.models.map(item => <option key={item.id} value={item.id}>{modelLabel(item)}</option>)}</select></div><Button disabled={disabled || !baseUrl || (!local && !apiKey)} onClick={() => { void discoverModels() }}><RefreshCw size={15} className="shrink-0" aria-hidden="true" />{catalog ? 'Refresh models' : 'Load models'}</Button></div>
            {preset === 'openrouter' && <p className="text-xs text-tertiary">Free models appear first when OpenRouter advertises zero prices. An account key is required. HTTP 402 means a credit or spending limit; HTTP 429 can mean a free-model request cap. Your current task stays available when a request fails.</p>}
            {preset === 'huggingface' && <div className="space-y-sm"><p className="text-xs text-tertiary">Free Hugging Face accounts have no included inference credits. Loading models can succeed while generation returns HTTP 402. Check your billing balance and Inference Providers settings before connecting.</p><div className="flex flex-wrap gap-lg"><HelpLink href="https://huggingface.co/settings/billing">Billing &amp; credits</HelpLink><HelpLink href="https://huggingface.co/docs/inference-providers/pricing">Inference pricing</HelpLink></div></div>}
            {preset === 'gemini' && <details open={feedback?.section === 'model' && feedback.error ? true : undefined} className="space-y-sm"><summary className="cursor-pointer rounded-md text-xs text-tertiary focus-visible:ring-2 focus-visible:ring-focus-ring">Gemini HTTP 400 help</summary><p className="text-xs text-tertiary">Use <code className="break-all">https://generativelanguage.googleapis.com/v1beta/openai</code> with Chat Completions, a Google AI Studio key and an exact ID from Load models. This compatibility layer accepts system messages; the native generateContent API uses systemInstruction and a different payload.</p><p className="text-xs text-tertiary">HTTP 400 can also mean an unsupported parameter or an unmet project requirement. Check the error code below and Google AI Studio for billing, region or account verification. For a thought-signature error after a tool call, start a fresh task; a proxy must preserve the original signatures.</p><HelpLink href="https://ai.google.dev/gemini-api/docs/troubleshooting">Gemini troubleshooting</HelpLink></details>}
            <p id="provider-model-hint" className="text-xs text-tertiary">{!catalog && rememberedModel ? `Remembered: ${rememberedModel}. Load models to confirm access with this key.` : 'The list is bound to this provider and key. Changing either clears it; connecting verifies access.'}</p>
            <details key={preset} open={preset === 'custom' ? true : undefined} className="border-t border-secondary pt-lg">
              <summary className="cursor-pointer rounded-md text-sm text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring">Advanced connection options</summary>
              <div className="mt-lg space-y-lg">
                <div><label htmlFor="provider-profile-name" className="mb-sm block text-sm font-medium text-secondary">Profile name (optional)</label><input id="provider-profile-name" className={fieldClass} value={profileName} maxLength={80} onChange={event => setProfileName(event.target.value)} placeholder={selected.label} /><p className="mt-sm text-xs text-tertiary">Distinguish multiple accounts with the same provider. Keep credentials out of the name.</p></div>
                <div><label htmlFor="model-base-url" className="mb-sm block text-sm font-medium text-secondary">API base URL</label><input id="model-base-url" type="url" required className={fieldClass} value={baseUrl} onChange={event => { setBaseUrl(event.target.value); cacheProvider({ baseUrl: event.target.value, model: undefined }); invalidateCatalog() }} placeholder="https://api.example.com/v1" aria-describedby="model-url-hint" /><p id="model-url-hint" className="mt-sm text-xs text-tertiary">Already populated. Do not append /responses or /chat/completions. Custom hosts require a server allowlist.</p></div>
                <div><label htmlFor="model-api-style" className="mb-sm block text-sm font-medium text-secondary">API protocol</label><select id="model-api-style" className={fieldClass} value={apiStyle} onChange={event => { const value = event.target.value as 'chat' | 'responses'; setApiStyle(value); cacheProvider({ apiStyle: value, model: undefined }); invalidateCatalog() }}><option value="responses">Responses</option><option value="chat">Chat Completions</option></select><p className="mt-sm text-xs text-tertiary">Use the protocol required by your model’s docs. There is no automatic protocol fallback.</p></div>
                {catalog && !catalog.discovered && !catalog.models.length && <div className="space-y-md"><Checkbox checked={manualModel} onChange={value => { setManualModel(value); setModel('') }} disabled={disabled}>Use an exact model ID when discovery is unavailable</Checkbox>{manualModel && <div><label htmlFor="model-id-fallback" className="mb-sm block text-sm text-secondary">Exact model ID (fallback)</label><input id="model-id-fallback" required className={fieldClass} maxLength={128} value={model} onChange={event => { setModel(event.target.value); cacheProvider({ model: event.target.value }) }} placeholder="Only an ID confirmed by your provider" /></div>}</div>}
              </div>
            </details>
            {saveChoice('model')}
            <Button primary type="submit" disabled={disabled || !baseUrl || !selectedModel || (!local && !apiKey)}>Connect &amp; verify model</Button>
          </fieldset>
        </form>}
        <details className="border-t border-secondary pt-lg"><summary className="cursor-pointer rounded-md text-xs text-tertiary focus-visible:ring-2 focus-visible:ring-focus-ring">Provider help &amp; usage</summary><p className="mt-lg text-sm text-secondary">{selected.help}</p>{preset === 'agentrouter' && <div className="mt-lg flex items-start gap-sm text-xs text-secondary"><AlertCircle size={15} className="mt-xxs shrink-0 text-fg-warning-primary" aria-hidden="true" /><div>AgentRouter controls client approval and per-model access. RecallLoop approval is not established; if denied, ask the provider to allow this app or choose another provider. We never spoof another client.<p className="mt-sm"><HelpLink href="https://ps.air-outer.com/pricing">Exact IDs &amp; endpoints</HelpLink><span className="mx-lg text-tertiary">·</span><HelpLink href="https://agentrouter.org/docs/terms.html">Usage terms</HelpLink></p></div></div>}</details>
        <details className="border-t border-secondary pt-lg"><summary className="cursor-pointer rounded-md text-sm text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring">Verification &amp; tool options</summary><div className="mt-lg space-y-lg">
          <Checkbox checked={tools} onChange={setTools} disabled={disabled}>Enable bounded coding &amp; memory tools</Checkbox>
          <Checkbox checked={checkCapabilities} onChange={setCheckCapabilities} disabled={disabled}>Also check streaming &amp; enabled tools</Checkbox>
          <p className="text-xs text-tertiary">Capability checks add up to two small requests. The function check never executes a real tool. Known unsupported tools are omitted for that model; you can still receive text-only replies. Unknown capabilities are not guessed from model names. Use Verify model to apply tool settings to a saved connection, or Connect to install a new one.</p>
        </div></details>
      </section>}
      {section === 'tatum' && <section className="space-y-lg" aria-label="Tatum connection">
        <div className="flex flex-wrap items-center justify-between gap-md"><h3 className="flex items-center gap-sm text-md font-semibold"><Server size={17} className="shrink-0 text-fg-secondary" aria-hidden="true" />Tatum chain access</h3><Badge tone={status?.tatum.verified ? 'success' : 'neutral'}>{status?.tatum.verified ? 'Checkpoint verified' : 'Not connected'}</Badge></div>
        <p className="text-sm text-secondary">Read Sui Mainnet checkpoints and verify Walrus account ownership. RecallLoop never submits transactions through this connection.</p>
        <div className="flex flex-wrap gap-xl"><HelpLink href="https://dashboard.tatum.io">Tatum dashboard</HelpLink><HelpLink href="https://docs.tatum.io">Tatum documentation</HelpLink></div>
        {status?.tatum.configured && <><p className="text-xs text-tertiary">Sui Mainnet · {status.tatum.verifiedAt ? `verified ${new Date(status.tatum.verifiedAt).toLocaleString()}` : 'verified with your session key'}</p><div className="flex flex-wrap gap-sm">
          <Button disabled={disabled} onClick={() => { void request('tatum', '/connections/tatum/verify', {}, 'A fresh Sui Mainnet checkpoint was verified through Tatum. Walrus and model connections are unchanged.') }}>Verify Tatum</Button>
          <Button disabled={disabled} onClick={() => setEditing(old => ({ ...old, tatum: !old.tatum }))}>{editing.tatum ? 'Hide reconnect form' : 'Reconnect Tatum'}</Button>
          <Button quiet disabled={locked} onClick={() => { void request('tatum', '/connections/tatum/disconnect', {}, 'Tatum and dependent Walrus authorization disconnected. Stored memories and the model connection are untouched.') }}>Disconnect Tatum &amp; Walrus</Button>
        </div><p className="text-xs text-tertiary">Disconnecting Tatum also disconnects the Walrus authorization that depends on it. It does not delete remote memories.</p></>}
        {editing.tatum && <form className="space-y-lg" onSubmit={event => { event.preventDefault(); registerBrowserSecret(tatumKey); void request('tatum', '/connections/tatum', { apiKey: tatumKey }, 'Tatum Mainnet checkpoint verified. The key was cleared from this form.', remember.tatum && vaultState.unlocked && vault ? signal => vault.save('tatum', { apiKey: tatumKey.trim() }, signal) : undefined) }}>
          <div><label htmlFor="tatum-session-key" className="mb-sm block text-sm font-medium text-secondary">Tatum API key</label><input id="tatum-session-key" type="password" autoComplete="off" data-lpignore="true" maxLength={4096} className={fieldClass} value={tatumKey} onChange={event => secret(setTatumKey, event.target.value)} disabled={disabled} required placeholder="Mainnet-scoped API key" aria-describedby="tatum-key-hint" /><p id="tatum-key-hint" className="mt-sm text-xs text-tertiary">Create a Mainnet key in your Tatum dashboard; verification is a read-only checkpoint and API quotas apply.</p></div>
          {saveChoice('tatum')}
          <Button primary type="submit" disabled={disabled || !tatumKey}>Verify &amp; connect Tatum</Button>
        </form>}
      </section>}
      {section === 'walrus' && <section className="space-y-lg" aria-label="Walrus Memory connection">
        <div className="flex flex-wrap items-center justify-between gap-md"><h3 className="flex items-center gap-sm text-md font-semibold"><Database size={17} className="shrink-0 text-fg-secondary" aria-hidden="true" />Walrus Memory</h3><Badge tone={status?.memoryConnection?.verified ? 'success' : 'neutral'}>{status?.memoryConnection?.verified ? 'Owner & delegate verified' : 'Not connected'}</Badge></div>
        <p className="text-sm text-secondary">Portable memory for later sessions, owned by your wallet. Connect Tatum first, then use an official Mainnet account and a dedicated delegate key.</p>
        <div className="flex flex-wrap gap-xl"><HelpLink href="https://memory.walrus.xyz/dashboard">Walrus dashboard</HelpLink><HelpLink href="https://docs.wal.app/walrus-memory/">Walrus documentation</HelpLink></div>
        {!status?.tatum.configured && <p className="flex flex-wrap items-center gap-md text-sm text-warning-primary">Tatum is needed to verify the account owner.<Button size="sm" disabled={locked} onClick={() => setSection('tatum')}>Connect Tatum first</Button></p>}
        {status?.memoryConnection && <>
          <p className="break-all font-mono text-xs text-secondary">Account: {status.memoryConnection.accountId}</p>
          <div className="flex flex-wrap gap-sm"><Button disabled={disabled} onClick={() => { void request('walrus', '/connections/memwal/verify', {}, 'Walrus account owner and signed delegate access verified again. No memory was written.') }}>Verify Walrus</Button><Button disabled={disabled} onClick={() => setEditing(old => ({ ...old, walrus: !old.walrus }))}>{editing.walrus ? 'Hide reconnect form' : 'Reconnect Walrus'}</Button><Button quiet disabled={locked} onClick={() => { void request('walrus', '/connections/memwal/disconnect', {}, 'Walrus disconnected. Stored memories, Tatum, and the model remain unchanged. Reconnect this account to recall again.') }}>Disconnect Walrus</Button></div>
          <details className="border-t border-secondary pt-lg"><summary className="cursor-pointer rounded-md text-sm text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring">Account &amp; delegate details</summary><div className="mt-lg space-y-sm text-xs text-secondary"><p className="break-all">Owner: {status.memoryConnection.owner}</p><p>Delegate public key · submission agent ID:</p><div className="flex items-start gap-sm"><code className="min-w-0 break-all">{status.memoryConnection.publicKey}</code><CopyButton text={status.memoryConnection.publicKey} label="Copy delegate public key" /></div></div></details>
        </>}
        {editing.walrus && <form className="space-y-lg" onSubmit={event => { event.preventDefault(); registerBrowserSecret(delegateKey); void request('walrus', '/connections/memwal', { accountId, delegateKey }, 'Mainnet account owner and delegate authorization verified. Confirm individual memory writes in Memory; connection verification is not storage evidence.', remember.walrus && vaultState.unlocked && vault ? signal => vault.save('walrus', { accountId: accountId.trim(), delegateKey: delegateKey.trim() }, signal) : undefined) }}>
          <div><label htmlFor="memwal-account" className="mb-sm block text-sm font-medium text-secondary">Walrus Memory account object ID</label><input id="memwal-account" className={fieldClass} value={accountId} maxLength={66} onChange={event => { setAccountId(event.target.value); onPreferences(current => ({ ...current, accountId: event.target.value })) }} disabled={disabled} required placeholder="0x… account object ID" aria-describedby="walrus-account-hint" /><p id="walrus-account-hint" className="mt-sm text-xs text-tertiary">Not your wallet address. The account must be owned by your signed-in wallet on Sui Mainnet.</p></div>
          <div><label htmlFor="memwal-delegate" className="mb-sm block text-sm font-medium text-secondary">Delegate private key</label><input id="memwal-delegate" type="password" autoComplete="off" data-lpignore="true" maxLength={256} className={fieldClass} value={delegateKey} onChange={event => secret(setDelegateKey, event.target.value)} disabled={disabled} required placeholder="32-byte hex or suiprivkey1…" aria-describedby="walrus-delegate-hint" /><p id="walrus-delegate-hint" className="mt-sm text-xs text-warning-primary">Only a dedicated, revocable Walrus delegate key. Never paste a seed phrase or your wallet’s private key.</p></div>
          {saveChoice('walrus')}
          <Button primary type="submit" disabled={disabled || !status?.tatum.configured || !accountId || !delegateKey}>Verify &amp; connect Walrus</Button>
        </form>}
        <p className="border-t border-secondary pt-lg text-xs text-tertiary">Verification confirms owner and signed delegate access only, not stored blobs; signed reads may consume delegate budget. Capture sends plaintext to the relayer; Walrus costs and quotas apply.</p>
      </section>}
      {section === 'advanced' && <section className="space-y-2xl" aria-label="Advanced workspace settings">
        <div><h3 className="mb-md text-sm font-semibold">Remembered fields</h3><p className="text-sm text-tertiary">Provider, model, and workspace options stay remembered for this login; closing Settings or reloading keeps them and logout or a wallet change clears them. Credentials, catalogues, and consents are never cached here.</p><Button quiet size="sm" className="mt-md" disabled={locked} onClick={() => { const cleared = onClearPreferences(); setFeedback({ section: 'advanced', error: !cleared, message: cleared ? 'Remembered fields cleared. Open forms and active connections are unchanged; future field changes will be remembered again.' : 'Remembered fields could not be cleared. Clear this tab’s site data before sharing the browser.' }) }}>Forget remembered fields</Button>{preferenceWarning && <p role="status" className="mt-md text-xs text-warning-primary">{preferenceWarning}</p>}</div>
        <DeviceVaultPanel vault={vault} busy={locked} onReconnect={profileId => { void reconnectSaved(profileId) }} />
        <LegacyCacheCleanup />
        <div className="border-t border-secondary pt-xl"><details><summary className="cursor-pointer rounded-md text-sm text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring">Embedding configuration is separate</summary><p className="mt-md text-sm text-tertiary">Walrus Memory embeddings come from the relayer, not your workspace model key. The optional CLI vector experiment uses a separate operator <code>OPENAI_API_KEY</code>; it is billable and outside this wallet workspace.</p></details></div>
        <div className="border-t border-secondary pt-xl"><details><summary className="cursor-pointer rounded-md text-sm text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring">Private session workspace</summary><p className="mt-md text-sm text-tertiary">New chats and files cache to this tab only, keyed to this login; reload keeps them and logout, expiry or an account change clears them — export first. Storage is unencrypted, so use separate browser profiles on shared devices.</p></details></div>
        <div className="border-t border-secondary pt-xl"><h3 className="mb-md text-sm font-semibold">Scripted model for testing</h3><p className="mb-lg text-sm text-tertiary">A deterministic mock, not a live LLM. Auto-memory can still use a live Walrus connection and incur costs; turn it off in the workspace when needed.</p><Button disabled={locked} onClick={() => { void request('advanced', '/connect', { mode: 'mock' }, 'Scripted mock model selected. Memory mode is unchanged; this is not live-generation evidence.') }}>Use scripted mock model</Button></div>
      </section>}
      {pending && <p role="status" className="mt-xl flex flex-wrap items-center gap-md text-sm text-secondary"><LoaderCircle size={16} className="shrink-0 animate-spin" aria-hidden="true" />{pending.message}{controller.current && <Button size="sm" quiet onClick={() => controller.current?.abort()}>Cancel check</Button>}</p>}
      {feedback?.section === section && <div role={feedback.error ? 'alert' : 'status'} className={`mt-xl rounded-md border p-lg text-sm ${feedback.error ? 'border-error-subtle text-error-primary' : 'border-secondary text-secondary'}`}><p>{feedback.message}</p>{feedback.code && <code className="mt-sm block text-xs">{feedback.code}</code>}</div>}
    </div>
    <p className="mt-xl flex items-start gap-sm border-t border-secondary pt-lg text-xs text-tertiary"><ShieldCheck size={15} className="shrink-0 text-fg-tertiary" aria-hidden="true" />Connections last at most one hour; entered passwords stay temporary and saved credentials go to the encrypted vault. Never paste unrelated secrets into chat.</p>
  </Modal>
}
