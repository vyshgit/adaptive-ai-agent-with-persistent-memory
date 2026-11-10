import path from 'node:path'
import { constants } from 'node:fs'
import { lstat, realpath, open, rename, unlink } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { AppError, redactSecrets } from '../safety.mjs'
import { BUILDER_LIMITS, relativePath, cleanText } from './policy.mjs'

export const fileVersion = content => createHash('sha256').update(content).digest('hex')
const unsafe = () => new AppError('unsafe_path', 'The project path changed, is a link, or is not a supported regular file/directory. No access was granted.', 403)

// This is a bounded file API, not an OS sandbox against a malicious local process.
// No-follow opens, component checks, hard-link refusal and preimage checks are
// repeated at the point of use. Native commands deliberately have a separate gate.
export function createLocalFiles(root, { secrets = () => [] } = {}) {
  async function resolve(value, { directory = false, missing = false } = {}) {
    const relative = relativePath(value, { directory })
    if (await realpath(root).catch(() => null) !== root || (await lstat(root)).isSymbolicLink()) throw unsafe()
    let absolute = root
    const parts = relative === '.' ? [] : relative.split('/')
    for (const [index, part] of parts.entries()) {
      absolute = path.join(absolute, part)
      const info = await lstat(absolute).catch(error => {
        if (missing && error.code === 'ENOENT' && index === parts.length - 1) return null
        if (error.code === 'ENOENT') throw new AppError('file_missing', 'This file or parent directory no longer exists.', 404)
        throw unsafe()
      })
      if (!info) return { absolute, relative, info: null }
      if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))
        || (index < parts.length - 1 && !info.isDirectory())) throw unsafe()
    }
    const info = await lstat(absolute)
    if (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) throw unsafe()
    if (await realpath(absolute) !== absolute) throw unsafe()
    return { absolute, relative, info }
  }

  async function rawFile(value, { missing = false, maxBytes = BUILDER_LIMITS.fileBytes, signal } = {}) {
    signal?.throwIfAborted()
    const target = await resolve(value, { missing })
    signal?.throwIfAborted()
    if (!target.info) return { ...target, content: null, version: null, bytes: 0 }
    const handle = await open(target.absolute, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => { throw unsafe() })
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.nlink !== 1 || info.dev !== target.info.dev || info.ino !== target.info.ino) throw unsafe()
      if (info.size > maxBytes) throw new AppError('file_too_large', `File exceeds the ${maxBytes}-byte read limit.`, 413)
      // readFile() would allow a concurrently growing file to escape the budget.
      const buffer = Buffer.alloc(Math.min(info.size + 1, maxBytes + 1))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const bytes = buffer.subarray(0, bytesRead)
      if (bytesRead > maxBytes || bytesRead !== info.size) throw new AppError('file_changed', 'The file changed while being read. Refresh before editing.', 409)
      let content
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new AppError('binary_file', 'Only bounded UTF-8 text files can be edited.', 415) }
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) throw new AppError('binary_file', 'Binary/control-character files are not exposed by the editor.', 415)
      const after = await handle.stat()
      const current = await resolve(value)
      signal?.throwIfAborted()
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs
        || current.info.dev !== info.dev || current.info.ino !== info.ino) {
        throw new AppError('file_changed', 'The file changed while being read. Refresh before editing.', 409)
      }
      return { ...target, content, version: fileVersion(bytes), bytes: bytesRead, mode: info.mode & 0o777 }
    } finally { await handle.close() }
  }

  async function read(value, options) {
    const file = await rawFile(value, options)
    const content = file.content === null ? null : redactSecrets(file.content, secrets())
    return { path: file.relative, content, version: file.version, bytes: file.bytes, redacted: content !== file.content }
  }

  async function list(value = '.', { limit = BUILDER_LIMITS.entries, signal } = {}) {
    signal?.throwIfAborted()
    const target = await resolve(value, { directory: true })
    const entries = []
    let scanned = 0, truncated = false
    // opendir/readdir with a returned array can allocate for an arbitrarily large
    // directory. Use the directory's bounded async iterator instead.
    const { opendir } = await import('node:fs/promises')
    const directory = await opendir(target.absolute)
    for await (const entry of directory) {
      signal?.throwIfAborted()
      if (++scanned > BUILDER_LIMITS.scannedEntries || entries.length >= limit) { truncated = true; break }
      const relative = target.relative === '.' ? entry.name : `${target.relative}/${entry.name}`
      try {
        relativePath(relative, { directory: entry.isDirectory() })
        if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue
        const child = await resolve(relative, { directory: entry.isDirectory() })
        entries.push({ path: relative, name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', bytes: child.info.size })
      } catch { /* unsafe or concurrently removed entries are not disclosed */ }
    }
    signal?.throwIfAborted()
    const current = await resolve(value, { directory: true })
    if (current.info.dev !== target.info.dev || current.info.ino !== target.info.ino) throw unsafe()
    entries.sort((a, b) => (a.type === b.type ? 0 : a.type === 'directory' ? -1 : 1) || a.name.localeCompare(b.name))
    return { path: target.relative, entries, truncated, scanned }
  }

  async function search({ path: directory = '.', query = '', name = '' } = {}, { signal } = {}) {
    relativePath(directory, { directory: true })
    const cleanQuery = cleanText(query, 'search query', 200, secrets(), { empty: true })
    const cleanName = cleanText(name, 'filename filter', 120, secrets(), { empty: true })
    if (!cleanQuery && !cleanName) throw new AppError('invalid_request', 'Provide a literal content query or filename fragment.')
    const queue = [directory], matches = []
    let visited = 0, files = 0, bytes = 0, truncated = false
    while (queue.length && !truncated) {
      signal?.throwIfAborted()
      const page = await list(queue.shift(), { limit: Math.min(500, BUILDER_LIMITS.scannedEntries - visited), signal })
      visited += page.scanned
      if (page.truncated) truncated = true
      for (const entry of page.entries) {
        signal?.throwIfAborted()
        if (entry.type === 'directory') { if (entry.path.split('/').length < 16) queue.push(entry.path); continue }
        if (++files > BUILDER_LIMITS.searchFiles || visited >= BUILDER_LIMITS.scannedEntries || bytes >= BUILDER_LIMITS.searchBytes || matches.length >= 100) { truncated = true; break }
        if (cleanName && !entry.path.toLowerCase().includes(cleanName.toLowerCase())) continue
        if (!cleanQuery) { matches.push({ path: entry.path }); continue }
        if (entry.bytes > BUILDER_LIMITS.fileBytes || bytes + entry.bytes > BUILDER_LIMITS.searchBytes) continue
        try {
          const file = await read(entry.path, { signal })
          if (bytes + file.bytes > BUILDER_LIMITS.searchBytes) { truncated = true; break }
          bytes += file.bytes
          const lines = file.content.split('\n')
          for (const [index, line] of lines.entries()) {
            if (line.toLowerCase().includes(cleanQuery.toLowerCase())) matches.push({ path: entry.path, line: index + 1, text: line.slice(0, 500) })
            if (matches.length >= 100) { truncated = true; break }
          }
        } catch { /* unsupported files do not stop a bounded search */ }
      }
    }
    signal?.throwIfAborted()
    return { matches, truncated, filesScanned: Math.min(files, BUILDER_LIMITS.searchFiles), bytesRead: bytes }
  }

  async function proposal({ path: value, content, version, reason }, { signal } = {}) {
    signal?.throwIfAborted()
    if (content !== null) {
      const cleaned = cleanText(content, 'file content', BUILDER_LIMITS.fileBytes, secrets(), { empty: true })
      if (cleaned !== content || Buffer.byteLength(content) > BUILDER_LIMITS.fileBytes) throw new AppError('sensitive_file', 'Redacted credentials or oversized content cannot be written through the editor.', 403)
    }
    if (version !== null && (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version))) throw new AppError('invalid_request', 'Read the file first and supply its exact version, or null for a new file.')
    const previous = await rawFile(value, { missing: true, signal })
    if (previous.version !== version) throw new AppError('file_changed', 'The file changed since it was read. Refresh and make a new proposal; nothing was overwritten.', 409)
    if (previous.content !== null && redactSecrets(previous.content, secrets()) !== previous.content) {
      throw new AppError('sensitive_file', 'This file contains a recognized credential. Its redacted view is read-only.', 403)
    }
    if (previous.content === content) throw new AppError('invalid_request', 'There is no file change to review.')
    return { path: previous.relative, before: previous.content, after: content, version,
      reason: cleanText(reason || 'Review this local file change.', 'reason', 1000, secrets()),
      operation: content === null ? 'delete' : version === null ? 'create' : 'update' }
  }

  async function apply(change, { signal } = {}) {
    signal?.throwIfAborted()
    // Revalidate both content and preimage AFTER the approval wait.
    await proposal({ path: change.path, content: change.after, version: change.version, reason: change.reason }, { signal })
    const target = await rawFile(change.path, { missing: true, signal })
    if (target.version !== change.version) throw new AppError('file_changed', 'The file changed during approval. Nothing was overwritten.', 409)
    if (change.after === null) {
      signal?.throwIfAborted()
      await resolve(change.path)
      signal?.throwIfAborted()
      await unlink(target.absolute)
      return { path: change.path, version: null, deleted: true }
    }
    const temporary = path.join(path.dirname(target.absolute), `.recallloop-edit-${randomBytes(16).toString('hex')}`)
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, target.mode ?? 0o600)
    let moved = false
    try {
      await handle.writeFile(change.after, 'utf8')
      await handle.sync()
      await handle.close()
      signal?.throwIfAborted()
      const latest = await rawFile(change.path, { missing: true, signal })
      if (latest.version !== change.version) throw new AppError('file_changed', 'The file changed while saving. Nothing was overwritten.', 409)
      signal?.throwIfAborted()
      if (change.version === null) {
        // Exclusive creation must not replace a file created after the review.
        const { link } = await import('node:fs/promises')
        await link(temporary, target.absolute).catch(error => {
          if (error.code === 'EEXIST') throw new AppError('file_changed', 'A file appeared at this path. Nothing was overwritten.', 409)
          throw error
        })
        await unlink(temporary)
      } else await rename(temporary, target.absolute)
      moved = true
      return { path: change.path, version: fileVersion(Buffer.from(change.after)), deleted: false }
    } finally {
      await handle.close().catch(() => {})
      if (!moved) await unlink(temporary).catch(() => {})
    }
  }
  return { root, resolve, read, list, search, proposal, apply }
}
