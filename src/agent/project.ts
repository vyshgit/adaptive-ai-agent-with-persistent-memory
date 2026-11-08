import type { Project, ProjectFile, Proposal } from './types.ts'
import type { CacheStorage } from './clientSafety.ts'
import { browserStorage, redactBrowserText, scopedCacheKey } from './clientSafety.ts'

export const PROJECT_KEY = 'recallloop.project.v1'
export const MAX_FILE_CHARS = 20_000
export const MAX_CONTEXT_CHARS = 160_000
const MAX_PROJECT_CHARS = 600_000

export function validFilePath(value: string) {
  const path = value
  return redactBrowserText(path) === path && path.length > 0 && path.length <= 240 && /^[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/.test(path)
    && !path.split('/').some(part => !part.trim() || part !== part.trim() || ['.', '..', '.git', 'node_modules', '.ssh', '.aws'].includes(part))
    && !/(^|\/)(\.env(?:\..*)?|credentials?(?:\..*)?|id_rsa|id_ed25519)$/i.test(path)
    && !/\.(pem|key|p12|pfx)$/i.test(path)
}

export function starterProject(): Project {
  return { name: 'RecallLoop sandbox', activeFile: 'src/greet.ts', files: [
    { path: 'src/greet.ts', content: 'export function greet(name: string) {\n  return `Hello, ${name.trim()}!`\n}\n', selected: true },
    { path: 'src/greet.test.ts', content: "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { greet } from './greet.ts'\n\ntest('greets a named person', () => {\n  assert.equal(greet(' Ada '), 'Hello, Ada!')\n})\n\ntest('falls back for an empty name', () => {\n  assert.equal(greet(''), 'Hello, friend!')\n})\n", selected: true },
    { path: 'package.json', content: '{\n  "name": "recallloop-sandbox",\n  "private": true,\n  "type": "module",\n  "scripts": { "test": "node --test src/greet.test.ts" }\n}\n', selected: true },
    { path: 'README.md', content: '# RecallLoop sandbox\n\nThe greet function needs a safe fallback for empty names.\nAsk the agent for a small fix, review the proposal, then apply it in this browser.\nExport the files and run npm test locally with a supported Node.js version.\nRecallLoop never executes this project or writes it to disk.\n', selected: true },
  ] }
}

export function normaliseProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid project format.')
  const input = raw as Partial<Project>
  if (!Array.isArray(input.files) || input.files.length > 64) throw new Error('A project can contain at most 64 text files.')
  const paths = new Set<string>()
  let size = 0
  const files = input.files.map(file => {
    if (!file || typeof file.path !== 'string' || !validFilePath(file.path) || paths.has(file.path) || typeof file.content !== 'string'
      || file.content.length > MAX_FILE_CHARS || file.content.includes('\0')) throw new Error('Project contains duplicate, oversized, binary, or unsafe files.')
    paths.add(file.path)
    size += file.content.length
    return { path: file.path, content: redactBrowserText(file.content), selected: file.selected !== false }
  })
  if (size > MAX_PROJECT_CHARS) throw new Error('Browser project exceeds 600,000 characters. Import fewer files.')
  return { name: typeof input.name === 'string' ? redactBrowserText(input.name).slice(0, 80) : 'Imported project', files,
    activeFile: typeof input.activeFile === 'string' && paths.has(input.activeFile) ? input.activeFile : files[0]?.path || null }
}

export function loadProject(storage: CacheStorage | null = browserStorage(), scope = 'offline'): Project {
  try {
    const raw = storage?.getItem(scopedCacheKey(PROJECT_KEY, scope))
    return raw ? normaliseProject(JSON.parse(raw)) : starterProject()
  } catch { return starterProject() }
}

export function saveProject(project: Project, storage: CacheStorage | null = browserStorage(), scope = 'offline') {
  try { storage?.setItem(scopedCacheKey(PROJECT_KEY, scope), JSON.stringify(normaliseProject(project))); return Boolean(storage) } catch { return false }
}

export function selectedProject(project: Project) {
  const clean = normaliseProject(project)
  return { ...clean, files: clean.files.filter(file => file.selected).map(({ path, content }) => ({ path, content })) }
}

export function contextCharacters(project: Project) {
  return project.files.filter(file => file.selected).reduce((total, file) => total + file.content.length, 0)
}

export function applyProposal(project: Project, proposal: Proposal): Project {
  if (proposal.status !== 'pending') throw new Error('This proposal was already reviewed.')
  if (!validFilePath(proposal.path) || proposal.after.length > MAX_FILE_CHARS || proposal.after.includes('\0')) throw new Error('This proposal contains an unsafe path or oversized file.')
  const existing = project.files.find(file => file.path === proposal.path)
  if ((proposal.before === null && existing) || (proposal.before !== null && (!existing || existing.content !== proposal.before))) {
    throw new Error('The file changed or was not selected when this proposal was created. Ask for a new proposal; nothing was overwritten.')
  }
  const files: ProjectFile[] = existing ? project.files.map(file => file.path === proposal.path ? { ...file, content: proposal.after } : file)
    : [...project.files, { path: proposal.path, content: proposal.after, selected: true }]
  return normaliseProject({ ...project, activeFile: proposal.path, files })
}

export async function importTextFiles(list: FileList | File[]) {
  const source = Array.from(list)
  const folder = source.length > 0 && source.every(file => (file.webkitRelativePath || '').includes('/'))
  const name = folder ? source[0].webkitRelativePath.split('/')[0] : 'Imported project'
  const skipped: string[] = []
  const paths = new Set<string>()
  const candidates: { file: File; path: string }[] = []
  for (const file of source) {
    const path = folder ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name
    if (!validFilePath(path) || file.size > MAX_FILE_CHARS * 4 || candidates.length >= 64 || paths.has(path)) { skipped.push(path); continue }
    paths.add(path)
    candidates.push({ file, path })
  }
  const loaded = await Promise.all(candidates.map(async ({ file, path }) => {
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (content.length > MAX_FILE_CHARS || /[\x00-\x08\x0e-\x1f]/.test(content)) throw new Error('not a supported text file')
      return { path, content: redactBrowserText(content), selected: true }
    } catch { skipped.push(path); return null }
  }))
  const files = loaded.filter((file): file is ProjectFile => Boolean(file))
  return { project: normaliseProject({ name, files, activeFile: files[0]?.path }), skipped }
}
