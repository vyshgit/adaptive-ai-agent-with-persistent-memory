// Model links are untrusted. Allow explicit web links only; relative API/file
// paths, credential-bearing URLs, executable schemes and embedded data are text.
export function safeMarkdownUrl(value: string) {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return ''
    return url.href
  } catch { return '' }
}
