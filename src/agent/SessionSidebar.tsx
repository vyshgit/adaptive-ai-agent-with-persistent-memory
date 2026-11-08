import { useState } from 'react'
import { MessageSquare, Plus, Pencil, Trash2, History } from 'lucide-react'
import type { Session } from './types.ts'
import { Button, IconButton, Modal, fieldClass } from './ui.tsx'

interface Props {
  sessions: Session[]
  activeId: string
  busy: boolean
  onNew: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onClear: () => void
}

export default function SessionSidebar({ sessions, activeId, busy, onNew, onSelect, onRename, onDelete, onClear }: Props) {
  const [editing, setEditing] = useState<Session | null>(null)
  const [title, setTitle] = useState('')
  const [deleting, setDeleting] = useState<Session | 'all' | null>(null)
  const today = new Date().toLocaleDateString()
  const groups = new Map<string, Session[]>()
  for (const session of sessions) {
    const date = new Date(session.updatedAt)
    const label = date.toLocaleDateString() === today ? 'Today' : Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Earlier'
    groups.set(label, [...(groups.get(label) || []), session])
  }
  return <div className="flex h-full min-h-0 flex-col bg-secondary">
    <header className="flex items-center justify-between gap-sm border-b border-secondary p-lg">
      <h2 className="flex items-center gap-sm text-sm font-semibold"><History size={16} className="shrink-0 text-fg-tertiary" />Sessions</h2>
      <IconButton label="New session" disabled={busy} onClick={onNew}><Plus size={18} /></IconButton>
    </header>
    <nav aria-label="Conversation sessions" className="min-h-0 flex-1 overflow-y-auto p-sm">
      {[...groups].map(([label, group]) => <section key={label} className="mb-lg">
        <h3 className="px-md py-sm text-xs font-medium text-tertiary">{label}</h3>
        {group.map(session => <div key={session.id} className={`mb-xxs flex items-center gap-xxs rounded-md ${session.id === activeId ? 'bg-primary shadow-xs' : 'hover:bg-secondary-hover'}`}>
          <button disabled={busy} onClick={() => onSelect(session.id)} aria-current={session.id === activeId ? 'page' : undefined} title={session.title}
            className="flex min-w-0 flex-1 items-center gap-sm rounded-md px-md py-md text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50">
            <MessageSquare size={14} className="shrink-0 text-fg-tertiary" /><span className="truncate">{session.title}</span>
          </button>
          {session.id === activeId && <div className="flex shrink-0 items-center">
            <IconButton label="Rename session" disabled={busy} onClick={() => { setEditing(session); setTitle(session.title) }}><Pencil size={13} /></IconButton>
            <IconButton label="Delete session" disabled={busy} onClick={() => setDeleting(session)}><Trash2 size={13} /></IconButton>
          </div>}
        </div>)}
      </section>)}
    </nav>
    <footer className="flex flex-col gap-md border-t border-secondary p-lg">
      <p className="text-xs text-tertiary">Conversation history stays in this browser. Portable memory is separate.</p>
      <Button disabled={busy} onClick={() => setDeleting('all')} className="w-full"><Trash2 size={14} className="shrink-0" />Clear local history</Button>
    </footer>
    {editing && <Modal title="Rename session" onClose={() => setEditing(null)} footer={<>
      <Button onClick={() => setEditing(null)}>Cancel</Button><Button primary type="submit" form="rename-session" disabled={!title.trim()}>Save name</Button>
    </>}>
      <form id="rename-session" onSubmit={event => { event.preventDefault(); onRename(editing.id, title); setEditing(null) }}>
        <label htmlFor="session-title" className="mb-sm block text-sm font-medium text-secondary">Session name</label>
        <input id="session-title" autoFocus className={fieldClass} maxLength={60} value={title} onChange={event => setTitle(event.target.value)} />
      </form>
    </Modal>}
    {deleting && <Modal title={deleting === 'all' ? 'Clear local conversation history?' : 'Delete this local session?'} onClose={() => setDeleting(null)} footer={<>
      <Button onClick={() => setDeleting(null)}>Keep history</Button>
      <Button className="text-error-primary" onClick={() => { if (deleting === 'all') onClear(); else onDelete(deleting.id); setDeleting(null) }}>Clear local history</Button>
    </>}>
      <p className="text-sm text-secondary">{deleting === 'all' ? 'All cached sessions in this browser will be removed.' : `“${deleting.title}” will be removed from this browser.`} Walrus memories and your browser project are untouched. This does not delete remote data.</p>
    </Modal>}
  </div>
}
