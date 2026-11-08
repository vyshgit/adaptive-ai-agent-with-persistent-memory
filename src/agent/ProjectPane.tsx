import { useRef, useState } from 'react'
import { FileCode2, FolderOpen, Download, Plus, Upload } from 'lucide-react'
import type { Project, ProjectFile } from './types.ts'
import { Button, IconButton, Checkbox, Modal, fieldClass } from './ui.tsx'
import { contextCharacters, importTextFiles, normaliseProject, validFilePath, MAX_CONTEXT_CHARS, MAX_FILE_CHARS } from './project.ts'
import { downloadText } from './clientSafety.ts'

export default function ProjectPane({ project, onChange, busy, onNotice }: { project: Project; onChange: (project: Project) => void; busy: boolean; onNotice: (message: string) => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const tabIndent = useRef(true)
  const [newPath, setNewPath] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<{ project: Project; skipped: string[] } | null>(null)
  const file = project.files.find(file => file.path === project.activeFile)
  const selected = project.files.filter(file => file.selected).length
  const characters = contextCharacters(project)
  function updateFile(path: string, update: (file: ProjectFile) => ProjectFile) {
    try { onChange(normaliseProject({ ...project, files: project.files.map(file => file.path === path ? update(file) : file) })); setError('') }
    catch (error) { setError(error instanceof Error ? error.message : 'The project could not be updated.') }
  }
  async function importFiles(list: FileList | null) {
    if (!list?.length) return
    setImporting(true); setError('')
    try {
      const result = await importTextFiles(list)
      if (!result.project.files.length) throw new Error('No supported text files were found. Secret, binary, generated, and oversized files are excluded.')
      setImported(result)
    } catch (error) { setError(error instanceof Error ? error.message : 'Files could not be imported.') }
    finally { setImporting(false); if (fileInput.current) fileInput.current.value = ''; if (folderInput.current) folderInput.current.value = '' }
  }
  return <div className="flex h-full min-h-0 flex-col">
    <header className="shrink-0 border-b border-secondary p-lg">
      <div className="flex items-center justify-between gap-sm"><h2 className="truncate text-sm font-semibold" title={project.name}>{project.name}</h2><IconButton label="Add a browser file" disabled={busy} onClick={() => setNewPath('')}><Plus size={16} /></IconButton></div>
      <div className="mt-md flex flex-wrap items-center gap-sm">
        <Button disabled={busy || importing} onClick={() => folderInput.current?.click()}><FolderOpen size={14} className="shrink-0" />Import folder</Button>
        <IconButton label="Import text files" disabled={busy || importing} onClick={() => fileInput.current?.click()}><Upload size={16} /></IconButton>
        <IconButton label="Export browser project as JSON" disabled={busy} onClick={() => {
          try { downloadText('recallloop-project.json', JSON.stringify(normaliseProject(project), null, 2), 'application/json') }
          catch (error) { setError(error instanceof Error ? error.message : 'Project export failed.') }
        }}><Download size={16} /></IconButton>
        <IconButton label="Load a RecallLoop JSON project" disabled={busy || importing} onClick={() => backupInput.current?.click()}><FileCode2 size={16} /></IconButton>
      </div>
      <input ref={fileInput} type="file" multiple className="hidden" onChange={event => { void importFiles(event.target.files) }} />
      <input ref={folderInput} type="file" multiple {...{ webkitdirectory: '' }} className="hidden" onChange={event => { void importFiles(event.target.files) }} />
      <input ref={backupInput} type="file" accept="application/json,.json" className="hidden" onChange={async event => {
        const candidate = event.target.files?.[0]
        if (!candidate) return
        try {
          if (candidate.size > 3_000_000) throw new Error('Project backup is too large.')
          setImported({ project: normaliseProject(JSON.parse(await candidate.text())), skipped: [] })
        } catch (error) { setError(error instanceof Error ? error.message : 'Invalid project backup.') }
        finally { if (backupInput.current) backupInput.current.value = '' }
      }} />
      <p className="mt-md text-xs text-tertiary">Import is browser-only. Check files to share them with the model. Secret files and dependencies are excluded.</p>
      {importing && <p role="status" className="mt-sm text-xs text-secondary">Reading selected text files…</p>}
      {error && <p role="alert" className="mt-sm text-xs text-error-primary">{error}</p>}
    </header>
    <div className="max-h-48 shrink-0 overflow-y-auto border-b border-secondary p-sm" aria-label="Browser project files">
      {!project.files.length && <p className="p-md text-sm text-tertiary">Import a folder or add a file to start coding.</p>}
      {project.files.map(item => <div key={item.path} className={`flex items-center gap-sm rounded-md px-md ${item.path === project.activeFile ? 'bg-secondary' : 'hover:bg-primary-hover'}`}>
        <Checkbox checked={item.selected} disabled={busy} onChange={selected => updateFile(item.path, file => ({ ...file, selected }))}><span className="sr-only">Share {item.path} with model</span></Checkbox>
        <button disabled={busy} className="flex min-w-0 flex-1 items-center gap-sm rounded-md py-sm text-left font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
          title={item.path} onClick={() => onChange({ ...project, activeFile: item.path })}><FileCode2 size={13} className="shrink-0 text-fg-tertiary" /><span className="truncate">{item.path}</span></button>
      </div>)}
    </div>
    {newPath !== null && <form className="shrink-0 border-b border-secondary p-lg" onSubmit={event => {
      event.preventDefault()
      const path = newPath.trim()
      if (!validFilePath(path) || project.files.some(file => file.path === path)) { setError('Use a unique, safe relative file path. Secret files are not allowed.'); return }
      try { onChange(normaliseProject({ ...project, activeFile: path, files: [...project.files, { path, content: '', selected: true }] })); setNewPath(null); setError('') }
      catch (error) { setError(error instanceof Error ? error.message : 'Cannot add this file.') }
    }}>
      <label htmlFor="new-file-path" className="mb-sm block text-xs text-secondary">New relative file path</label>
      <input id="new-file-path" autoFocus className={fieldClass} value={newPath} maxLength={240} placeholder="src/example.ts" onChange={event => setNewPath(event.target.value)} />
      <div className="mt-sm flex gap-sm"><Button type="submit" disabled={!newPath.trim()}>Add file</Button><Button onClick={() => setNewPath(null)}>Cancel</Button></div>
    </form>}
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-sm px-lg py-sm">
        <label htmlFor="project-editor" className="min-w-0 truncate font-mono text-xs text-secondary">{file?.path || 'No file selected'}</label>
        {file && <IconButton label="Download current file" onClick={() => downloadText(file.path.split('/').at(-1)!, file.content)}><Download size={14} /></IconButton>}
      </div>
      <textarea ref={editor} id="project-editor" aria-label={file ? `Edit ${file.path}` : 'Project editor'} aria-describedby="editor-hint" spellCheck={false} autoCapitalize="off" autoComplete="off" wrap="off"
        disabled={!file || busy} maxLength={MAX_FILE_CHARS} value={file?.content || ''} onChange={event => { if (file) updateFile(file.path, item => ({ ...item, content: event.target.value })) }}
        className="min-h-48 w-full flex-1 resize-none border border-transparent bg-secondary p-lg font-mono text-xs leading-relaxed text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
        onKeyDown={event => {
          if (event.key === 'Escape') tabIndent.current = false
          if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && file) {
            if (!tabIndent.current) { tabIndent.current = true; return }
            event.preventDefault()
            const start = event.currentTarget.selectionStart, end = event.currentTarget.selectionEnd
            const content = file.content.slice(0, start) + '  ' + file.content.slice(end)
            if (content.length <= MAX_FILE_CHARS) { updateFile(file.path, item => ({ ...item, content })); requestAnimationFrame(() => editor.current?.setSelectionRange(start + 2, start + 2)) }
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onNotice('Edits are cached in this browser. Download a file, project JSON, or reviewed patch to save work on disk.') }
        }} />
    </div>
    <footer className="shrink-0 border-t border-secondary p-lg">
      <p className={`text-xs ${characters > MAX_CONTEXT_CHARS ? 'text-error-primary' : 'text-tertiary'}`}>{selected}/{project.files.length} files shared · {characters.toLocaleString()}/{MAX_CONTEXT_CHARS.toLocaleString()} context characters</p>
      <p id="editor-hint" className="mt-sm text-xs text-tertiary">Browser edits only · {file?.content.split('\n').length || 0} lines. Tab indents; Escape then Tab moves focus. Export to write changes locally.</p>
    </footer>
    {imported && <Modal title="Replace the browser project?" onClose={() => setImported(null)} footer={<>
      <Button onClick={() => setImported(null)}>Keep current project</Button><Button primary onClick={() => { onChange(imported.project); onNotice(`Imported ${imported.project.files.length} text files into this browser. No disk files changed.${imported.skipped.length ? ` ${imported.skipped.length} unsupported files were skipped.` : ''}`); setImported(null) }}>Import {imported.project.files.length} files</Button>
    </>}>
      <p className="text-sm text-secondary">The current browser project will be replaced with “{imported.project.name}”. Export your current edits first if you need them. Nothing is written to disk or sent to a model until you submit a chat turn.</p>
      {imported.skipped.length > 0 && <p className="mt-lg text-xs text-warning-primary">Skipped {imported.skipped.length} unsafe, binary, oversized, duplicate, or over-limit files. {imported.skipped.slice(0, 5).join(', ')}{imported.skipped.length > 5 ? '…' : ''}</p>}
    </Modal>}
  </div>
}
