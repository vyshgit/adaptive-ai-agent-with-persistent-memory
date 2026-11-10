import { useState } from 'react'
import { clearLegacyWorkspaceCaches, legacyWorkspaceCacheKeys } from './workspaceCache.ts'
import { Button, Modal } from './ui.tsx'

export default function LegacyCacheCleanup() {
  const [count, setCount] = useState(() => legacyWorkspaceCacheKeys().length)
  const [confirm, setConfirm] = useState(false)
  const [message, setMessage] = useState('')
  if (!count && !message) return null
  return <section aria-label="Legacy browser cache privacy" className="border-t border-secondary pt-xl">
    <p className="text-sm font-medium text-secondary">Old persistent browser caches</p>
    <p className="mt-sm text-xs leading-relaxed text-tertiary">{count} old chat/project cache {count === 1 ? 'entry remains' : 'entries remain'} in this browser profile. RecallLoop no longer loads these unencrypted persistent caches. Clear them before sharing this browser; this affects old caches for all wallets on this site.</p>
    <Button size="sm" className="mt-lg" disabled={!count} onClick={() => setConfirm(true)}>Clear legacy browser caches</Button>
    {message && <p role="status" className="mt-md text-xs text-secondary">{message}</p>}
    {confirm && <Modal title="Clear old persistent browser caches?" onClose={() => setConfirm(false)} footer={<>
      <Button onClick={() => setConfirm(false)}>Keep old caches</Button>
      <Button className="text-error-primary" onClick={() => {
        const result = clearLegacyWorkspaceCaches()
        setCount(legacyWorkspaceCacheKeys().length); setConfirm(false)
        setMessage(result.failed ? 'Some old caches could not be removed. Clear this site’s browser data before sharing the device.' : `${result.removed} old cache entries removed. Current tab work, theme settings, and remote memories are untouched.`)
      }}>Clear old caches</Button>
    </>}>
      <p className="text-sm text-secondary">This deletes only RecallLoop’s old persistent chat/project caches for all wallets in this browser profile. Save any old work you need first. It does not delete this session’s tab cache, theme preferences, or Walrus memories. This cannot be undone.</p>
    </Modal>}
  </section>
}
