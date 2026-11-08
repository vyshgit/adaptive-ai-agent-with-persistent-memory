import { useState } from 'react'
import type { ChatMessage, Session } from './types.ts'
import { agentJson } from './api.ts'
import { Button, Modal, fieldClass } from './ui.tsx'

export default function FeedbackModal({ message, session, onClose, onStored }: { message: ChatMessage; session: Session; onClose: () => void; onStored: (notice: string) => void }) {
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  return <Modal title="Teach the next session" onClose={onClose} footer={<>
    <Button onClick={onClose}>Cancel</Button><Button primary type="submit" form="record-feedback" disabled={pending || !note.trim()}>{pending ? 'Waiting for confirmation…' : 'Remember this outcome'}</Button>
  </>}>
    <p className="mb-lg text-sm text-secondary">What worked, failed, or needs correcting? Your own report becomes a memory the next coding session can recall. It does not verify the agent’s code or erase older memories.</p>
    <form id="record-feedback" onSubmit={async event => {
      event.preventDefault(); setPending(true); setError('')
      try {
        const text = `User-reported outcome for session “${session.title}”, assistant message ${message.id}: ${note.trim()}`
        const result = await agentJson<{ blobId: string }>('/remember', { method: 'POST', body: JSON.stringify({ text, tier: 'facts' }) }, 150_000)
        onStored(`Outcome confirmed as ${result.blobId}. Start a new session to recall this lesson.`); onClose()
      } catch (error) { setError(error instanceof Error ? error.message : 'The outcome was not confirmed.') }
      finally { setPending(false) }
    }}>
      <label htmlFor="feedback-note" className="mb-sm block text-sm font-medium text-secondary">Your outcome or correction</label>
      <textarea id="feedback-note" rows={5} autoFocus maxLength={1600} className={fieldClass} value={note} onChange={event => setNote(event.target.value)} disabled={pending} placeholder="The large refactor failed. Next time keep the public API and add a regression test before changing implementation." />
      <p className="mt-sm text-xs text-tertiary">This explicit action writes to the configured memory backend even if automatic chat capture is off. Do not include secrets.</p>
      {error && <p role="alert" className="mt-lg text-sm text-error-primary">{error}</p>}
    </form>
  </Modal>
}
