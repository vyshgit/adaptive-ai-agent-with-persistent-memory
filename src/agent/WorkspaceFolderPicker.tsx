import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUp, FolderOpen, Home, LoaderCircle } from 'lucide-react'
import { agentJson } from './api.ts'
import { redactBrowserText } from './clientSafety.ts'
import type { LocalFolders, PermissionMode } from './builderTypes.ts'
import { Button, Checkbox, Modal, fieldClass } from './ui.tsx'

export default function WorkspaceFolderPicker({ root, opened, permissionMode, busy, error, onOpen, onClose }: {
  root: string; opened: boolean; permissionMode: PermissionMode; busy: boolean; error: string
  onOpen: (directory: string, permissions: PermissionMode) => Promise<boolean>; onClose: () => void
}) {
  const [directory, setDirectory] = useState(root)
  const [folders, setFolders] = useState<LocalFolders | null>(null)
  const [loading, setLoading] = useState(true)
  const [validated, setValidated] = useState(false)
  const [browseError, setBrowseError] = useState('')
  const [permissions, setPermissions] = useState(permissionMode)
  const [consent, setConsent] = useState(false)
  const controller = useRef<AbortController | null>(null), mounted = useRef(false)
  const initialRoot = useRef(root).current, id = useId()
  const checked = Boolean(validated && folders && directory === folders.path)
  const sameProject = opened && checked && folders?.path === root
  const canOpen = !busy && !loading && checked && folders?.selectable && consent && !sameProject

  async function browse(value: string) {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setLoading(true); setValidated(false); setBrowseError(''); setConsent(false); setDirectory(value)
    try {
      const next = await agentJson<LocalFolders>('/builder/folders', { method: 'POST', body: JSON.stringify({ directory: value }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]) })
      if (!mounted.current || abort.signal.aborted) return
      setFolders(next); setDirectory(next.path); setValidated(true)
    } catch (value) {
      if (mounted.current && !abort.signal.aborted) setBrowseError(redactBrowserText(value instanceof Error ? value.message : 'Could not browse this folder. Check the path and try again.'))
    } finally {
      if (mounted.current && controller.current === abort) { controller.current = null; setLoading(false) }
    }
  }
  useEffect(() => {
    let current = true
    mounted.current = true
    // StrictMode replays mount effects. Start only the surviving effect so an
    // aborted first browse cannot race the real browse's server-side idle lock.
    queueMicrotask(() => { if (current) void browse(initialRoot) })
    return () => { current = false; mounted.current = false; controller.current?.abort() }
  }, [initialRoot])

  return <Modal title="Choose workspace folder" onClose={onClose} bodyClassName="workspace-scroll" footer={<>
    <Button disabled={busy} onClick={onClose}>Cancel</Button>
    <Button primary disabled={!canOpen} onClick={async () => {
      if (canOpen && folders && await onOpen(folders.path, permissions) && mounted.current) onClose()
    }}>{busy ? <LoaderCircle size={16} className="shrink-0 animate-spin" aria-hidden="true" /> : <FolderOpen size={16} className="shrink-0" aria-hidden="true" />}{opened ? 'Switch project' : 'Open project'}</Button>
  </>}>
    <div className="space-y-lg">
      <p className="text-sm text-secondary">Browse folders on the machine running RecallLoop, or paste an absolute project path.</p>
      <form className="space-y-sm" onSubmit={event => { event.preventDefault(); if (!busy && !loading && directory.trim()) void browse(directory.trim()) }}>
        <label htmlFor={`${id}-directory`} className="block text-sm font-medium text-secondary">Workspace folder path</label>
        <div className="flex items-center gap-sm">
          <input id={`${id}-directory`} className={`${fieldClass} min-w-0 flex-1 ${browseError ? 'border-error-subtle focus-visible:ring-focus-ring-error' : ''}`} value={directory} maxLength={4096} required disabled={busy || loading}
            autoComplete="off" spellCheck={false} autoCapitalize="off" aria-invalid={Boolean(browseError)} aria-describedby={`${id}-path-hint${browseError ? ` ${id}-error` : ''}`}
            onChange={event => { setDirectory(event.target.value); setValidated(false); setConsent(false); setBrowseError('') }} />
          <Button type="submit" disabled={busy || loading || !directory.trim()}>Browse</Button>
        </div>
        <p id={`${id}-path-hint`} className="text-xs text-tertiary">Press Enter or Browse to check the path. Folder selection stays in this login.</p>
      </form>
      <div className="flex flex-wrap items-center gap-sm" role="group" aria-label="Folder navigation">
        <Button size="sm" disabled={busy || loading || !folders?.parent} onClick={() => { if (folders?.parent) void browse(folders.parent) }}><ArrowUp size={14} className="shrink-0" aria-hidden="true" />Parent</Button>
        <Button size="sm" disabled={busy || loading || !folders} onClick={() => { if (folders) void browse(folders.home) }}><Home size={14} className="shrink-0" aria-hidden="true" />Home</Button>
        <Button size="sm" disabled={busy || loading} onClick={() => { void browse(folders?.launch || initialRoot) }}>Launch folder</Button>
      </div>
      <section aria-label="Workspace folders" aria-busy={loading} className="rounded-md border border-secondary bg-secondary">
        <p className="break-all border-b border-secondary px-lg py-md font-mono text-xs text-secondary">{loading || browseError ? directory || initialRoot : folders?.path || initialRoot}</p>
        <div className="workspace-scroll h-40 overflow-y-auto p-sm">
          {loading ? <p role="status" className="flex items-center gap-sm p-md text-xs text-tertiary"><LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden="true" />Loading folders…</p>
            : browseError ? <p className="p-md text-xs text-tertiary">Folder listing unavailable. Check the path or use the navigation above to try again.</p>
            : folders?.entries.length ? <ul>{folders.entries.map(folder => <li key={folder.path}><button type="button" disabled={busy} onClick={() => { void browse(folder.path) }}
              className="flex min-h-10 w-full items-center gap-sm rounded-md border border-transparent px-md py-sm text-left text-sm text-secondary hover:bg-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50">
              <FolderOpen size={16} className="shrink-0 text-fg-tertiary" aria-hidden="true" /><span className="min-w-0 break-all">{folder.name}</span>
            </button></li>)}</ul> : <p className="p-md text-xs text-tertiary">{folders ? 'No browsable subfolders. You can select this folder or enter another path.' : 'Enter a local folder path to continue.'}</p>}
        </div>
      </section>
      {checked && folders?.truncated && <p className="text-xs text-tertiary">Listing limit reached. Paste a more specific folder path.</p>}
      <p role="status" className="break-all text-xs text-tertiary">{sameProject ? 'This project is already open. Choose a different folder to switch.' : checked ? folders?.issue || `Selected folder: ${folders?.path}` : 'Check the new path before opening a project.'}</p>
      <div className="space-y-lg border-t border-secondary pt-lg">
        <div><label htmlFor={`${id}-permissions`} className="mb-sm block text-sm font-medium text-secondary">Project permissions</label><select id={`${id}-permissions`} className={fieldClass} value={permissions} disabled={busy} onChange={event => { setPermissions(event.target.value as PermissionMode); setConsent(false) }}>
          <option value="standard">Standard · routine edits automatic, risky actions ask</option><option value="strict">Strict · review every edit and command</option>
        </select></div>
        <Checkbox checked={consent} onChange={setConsent} disabled={busy || loading || !checked || !folders?.selectable || sameProject}>I trust this project and consent to its selected permissions for this login.</Checkbox>
        <p className="text-xs leading-relaxed text-tertiary">{opened ? 'Switching starts a fresh project conversation and clears the editor, terminal, recalled attachments and pending reviews. ' : ''}Native commands run with your OS permissions. Auto-memory follows your workspace setting.</p>
      </div>
      {(browseError || error) && <p id={`${id}-error`} role="alert" className="break-words rounded-md border border-error-subtle p-lg text-sm text-error-primary">{browseError || error}</p>}
    </div>
  </Modal>
}
