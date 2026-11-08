import { AppError, requireText, redactSecrets } from '../safety.mjs'

export function safeProjectPath(value, secrets = []) {
  const path = requireText(value, 'file path', 240)
  if (redactSecrets(path, secrets) !== path || !/^[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/.test(path)
    || path !== value || path.split('/').some(part => !part.trim() || part !== part.trim() || ['.', '..', '.git', 'node_modules', '.ssh', '.aws'].includes(part))
    || /(^|\/)(\.env(?:\..*)?|credentials?(?:\..*)?|id_rsa|id_ed25519)$/i.test(path)
    || /\.(pem|key|p12|pfx)$/i.test(path)) {
    throw new AppError('invalid_request', 'Only safe relative text-file paths are allowed. Secret files and generated dependencies are excluded.')
  }
  return path
}

export function validateProject(input, secrets = []) {
  if (input === undefined) return { name: 'Untitled project', files: [], activeFile: null }
  if (!input || !Array.isArray(input.files) || input.files.length > 64) throw new AppError('invalid_request', 'A project can contain at most 64 selected text files.')
  const seen = new Set()
  let size = 0
  const files = input.files.map(file => {
    const path = safeProjectPath(file?.path, secrets)
    if (seen.has(path)) throw new AppError('invalid_request', 'Duplicate project paths are not allowed.')
    seen.add(path)
    if (typeof file.content !== 'string' || file.content.length > 20_000 || file.content.includes('\0')) throw new AppError('invalid_request', 'Each selected file must be text and at most 20,000 characters.')
    size += file.content.length
    return { path, content: redactSecrets(file.content, secrets) }
  })
  if (size > 160_000) throw new AppError('invalid_request', 'Selected project context exceeds 160,000 characters. Select fewer files.')
  const activeFile = input.activeFile && seen.has(input.activeFile) ? input.activeFile : files[0]?.path || null
  return { name: typeof input.name === 'string' ? redactSecrets(input.name, secrets).slice(0, 80) : 'Untitled project', files, activeFile }
}
