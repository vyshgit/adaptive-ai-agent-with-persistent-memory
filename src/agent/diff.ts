export interface DiffLine { kind: 'context' | 'removed' | 'added'; text: string }

function lines(text: string) {
  return text ? text.replace(/\n$/, '').split('\n') : []
}

// A bounded single-hunk diff: preserve common prefix/suffix, replace the changed middle.
// No quadratic LCS, dependency, or execution of user code is involved.
export function fileDiff(path: string, before: string | null, after: string): { patch: string; lines: DiffLine[] } {
  if (before === after) return { patch: '', lines: [] }
  const a = JSON.stringify(`a/${path}`), b = JSON.stringify(`b/${path}`)
  if (before === null && after === '') return { patch: `diff --git ${a} ${b}\nnew file mode 100644\nindex 0000000..e69de29\n`, lines: [] }
  const old = lines(before || '')
  const next = lines(after)
  const same = (oldIndex: number, nextIndex: number) => old[oldIndex] === next[nextIndex]
    && (oldIndex < old.length - 1 || (before || '').endsWith('\n')) === (nextIndex < next.length - 1 || after.endsWith('\n'))
  let prefix = 0
  while (prefix < old.length && prefix < next.length && same(prefix, prefix)) prefix++
  let suffix = 0
  while (suffix < old.length - prefix && suffix < next.length - prefix && same(old.length - 1 - suffix, next.length - 1 - suffix)) suffix++
  const start = Math.max(0, prefix - 3)
  const endOld = Math.min(old.length, old.length - suffix + 3)
  const endNext = Math.min(next.length, next.length - suffix + 3)
  const output: DiffLine[] = [
    ...old.slice(start, prefix).map(text => ({ kind: 'context' as const, text })),
    ...old.slice(prefix, old.length - suffix).map(text => ({ kind: 'removed' as const, text })),
    ...next.slice(prefix, next.length - suffix).map(text => ({ kind: 'added' as const, text })),
    ...old.slice(old.length - suffix, endOld).map(text => ({ kind: 'context' as const, text })),
  ]
  const oldCount = endOld - start
  const nextCount = endNext - start
  const header = `diff --git ${a} ${b}\n${before === null ? 'new file mode 100644\n' : ''}--- ${before === null ? '/dev/null' : a}\n+++ ${b}\n@@ -${oldCount ? start + 1 : start},${oldCount} +${nextCount ? start + 1 : start},${nextCount} @@\n`
  let oldLine = start, nextLine = start
  const body = output.map(line => {
    if (line.kind !== 'added') oldLine++
    if (line.kind !== 'removed') nextLine++
    const noNewline = (line.kind !== 'added' && oldLine === old.length && old.length && !(before || '').endsWith('\n'))
      || (line.kind !== 'removed' && nextLine === next.length && next.length && !after.endsWith('\n'))
    return `${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}${line.text}\n${noNewline ? '\\ No newline at end of file\n' : ''}`
  }).join('')
  return { patch: header + body, lines: output }
}
