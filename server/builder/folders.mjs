import path from 'node:path'
import { opendir, realpath } from 'node:fs/promises'
import { AppError } from '../safety.mjs'
import { BUILDER_LIMITS, hiddenPathPart, localDirectory, projectFolderIssue } from './policy.mjs'

export async function listLocalFolders(directory, { signal, limit = BUILDER_LIMITS.entries } = {}) {
  signal?.throwIfAborted()
  const root = await localDirectory(directory)
  signal?.throwIfAborted()
  const entries = []
  let scanned = 0, truncated = false
  try {
    const handle = await opendir(root)
    for await (const entry of handle) {
      signal?.throwIfAborted()
      if (++scanned > BUILDER_LIMITS.scannedEntries) { truncated = true; break }
      if (!entry.isDirectory() || hiddenPathPart(entry.name) || /[\x00-\x1f\x7f]/.test(entry.name) || entry.name !== entry.name.trim()) continue
      const absolute = path.join(root, entry.name)
      if (absolute === '/data' || absolute.length > 4096) continue
      if (entries.length >= limit) { truncated = true; break }
      entries.push({ name: entry.name, path: absolute })
    }
    if (await realpath(root) !== root) throw new AppError('workspace_changed', 'The folder changed while browsing. Check the path again.', 409)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof AppError) throw error
    throw new AppError('folder_unavailable', 'This folder cannot be listed. Check its OS permissions or choose another path.', 403)
  }
  signal?.throwIfAborted()
  entries.sort((a, b) => a.name.localeCompare(b.name))
  const issue = projectFolderIssue(root)
  return { path: root, parent: path.dirname(root) === root ? null : path.dirname(root), entries, truncated, selectable: !issue, issue }
}
