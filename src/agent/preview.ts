import type { Project } from './types.ts'
import { MAX_FILE_CHARS } from './project.ts'

// Builds a self-contained HTML document from the browser's own project for a
// sandboxed iframe (`allow-scripts` only, no same-origin). Local CSS/JS/SVG
// references are inlined from project files; every external, absolute-URL or
// missing reference is stripped, so the preview issues no network requests
// and never shares the app's origin.
const ASSET_EXTENSIONS = /\.(?:html?|css|m?js|json|txt|svg)$/i
const MAX_PREVIEW_CHARS = 500_000

type ProjectSource = Pick<Project, 'files'>

function collection(source: ProjectSource) {
  const files = new Map<string, string>()
  let total = 0
  for (const file of source.files) {
    if (!ASSET_EXTENSIONS.test(file.path) || file.content.length > MAX_FILE_CHARS) continue
    total += file.content.length
    if (total > MAX_PREVIEW_CHARS) return null
    files.set(file.path, file.content)
  }
  return files
}

export function previewEntry(source: Pick<Project, 'files'>) {
  return source.files.find(file => file.path === 'index.html')?.path
    || source.files.find(file => /\.(?:html?)$/i.test(file.path))?.path || null
}

/** Project-local relative path from an asset reference, or null for anything
 * that is not a plain relative path inside the project. */
export function localPreviewPath(reference: string) {
  if (reference.startsWith('data:') || reference.startsWith('/') || /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(reference)) return null
  const path = reference.split(/[?#]/)[0].trim().replace(/^\.\//, '')
  return /^[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/.test(path)
    && !path.split('/').some(part => ['.', '..', '', '.git', 'node_modules'].includes(part.trim()))
    ? path : null
}

function dataUri(path: string, content: string) {
  if (/[\x00-\x08\x0e-\x1f]/.test(content.slice(0, 200))) return null
  const type = /\.svg$/i.test(path) ? 'image/svg+xml' : /\.json$/i.test(path) ? 'application/json' : ''
  return `data:${type};charset=utf-8,${encodeURIComponent(content)}`
}

function inlineCss(css: string, files: Map<string, string>, depth: number) {
  // Single-pass substitution: one combined regex per round so nested inlined
  // content is never rescanned. @import is expanded recursively; url(...) and
  // favicon-ish references become data URIs or are removed.
  let round = 0
  for (;;) {
    const before = css
    css = css.replace(/@import\s+[^;]*;?/gi, (match) => {
      const reference = /@import\s+url\(\s*([^)]*?)\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/i.exec(match)
      const path = reference ? localPreviewPath(reference[1]?.replace(/^["']|["']$/g, '') ?? reference[2] ?? reference[3]) : null
      const asset = path ? files.get(path) : undefined
      if (depth > 2 || asset === undefined) return ''
      return `/* from ${path!} */ ${inlineCss(asset, files, depth + 1)}`
    })
    if (css === before || ++round > 5) break
  }
  return css
}

const linkTag = /<link\b[^>]*?>/gi
const scriptTag = /<script\b([^>]*?)\ssrc="([^"]*)"([^>]*?)(?:>([\s\S]*?)<\/script>|(\/?)>)/gi
const imageTag = /<(?:img|source|audio|video)\b[^>]*?>/gi

function inlineHtml(html: string, files: Map<string, string>, depth: number): string {
  if (depth > 2) return html
  const next = html
    .replace(scriptTag, (tag, before: string, reference: string, after: string, body: string, selfClose: string) => {
      const path = localPreviewPath(reference)
      const source = path ? files.get(path) : undefined
      if (source === undefined) return ''
      return `<script${before}${after}>${/\.json$/i.test(path!) ? `window.__RECALLLOOP_ASSETS__=${source}` : source.replace(/<\/script/gi, '<\\/script')}<\/script>`
    })
    .replace(linkTag, (tag: string) => {
      const attributes = /<link\b([^>]*)>/.exec(tag)?.[1] || ''
      const reference = /\shref="([^"]+)"/.exec(attributes)?.[1]
      if (reference === undefined) return /\srel="[^"]*stylesheet"[^>]*>/.test(tag) ? '' : tag.replace(/\shref="[^"]*"/gi, '')
      const path = localPreviewPath(reference)
      const css = path ? files.get(path) : undefined
      if (!/stylesheet/i.test(tag)) return css !== undefined ? tag.replace(/\shref="[^"]*"/gi, '') : tag
      return css === undefined ? '' : `<style>\n${inlineCss(css, files, depth + 1)}\n</style>`
    })
    .replace(imageTag, (tag: string) => tag.replace(/\ssrc="([^"]+)"/i, (attribute, reference: string) => {
      if (reference.startsWith('data:')) return attribute
      const path = localPreviewPath(reference)
      const asset = path ? files.get(path) : undefined
      if (asset === undefined || path === null) return ''
      const uri = dataUri(path, asset)
      return uri ? ` src="${uri}"` : ''
    }))
    // Local page-to-page navigation and every absolute URL leave the sandbox
    // or fail silently; neutral anchors stay clickable without navigation.
    .replace(/\shref="(?!#)([^"]*)"/gi, (attribute, reference: string) => /^#/.test(reference) ? attribute : '')
  return next !== html && depth < 3 ? inlineHtml(next, files, depth + 1) : next
}

/** Build the preview document, or null when the project has no HTML entry. */
export function previewDocument(source: Pick<Project, 'files'>) {
  const files = collection(source)
  if (!files) return null
  const entry = previewEntry(source)
  if (!entry || !files.has(entry)) return null
  const body = inlineHtml(files.get(entry)!, files, 0)
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;">
<title>RecallLoop sandbox preview</title><style>:root{font-family:system-ui,sans-serif}</style></head><body>${body}</body></html>`
}

