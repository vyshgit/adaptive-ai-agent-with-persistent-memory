import type { BuilderApproval, LocalFile, LocalRun } from './builderTypes.ts'

// A disk acknowledgement refreshes the preimage, not whatever the user typed
// after reviewing it. Deletion also preserves a newer draft as a possible new file.
export function editorAfterApply(file: LocalFile, draft: string, next: LocalFile, approval?: BuilderApproval | { kind: 'file'; after: string | null }) {
  const replace = draft === (file.content ?? '') || (approval?.kind === 'file' && draft === approval.after)
  if (next.content === null && replace) return { file: null, draft: '', keptDraft: false }
  return { file: next, draft: replace ? next.content ?? '' : draft, keptDraft: !replace }
}

// Replay only bounded visible prose, never source snapshots, terminal output,
// approval capabilities or provider-stored response/message/reasoning IDs.
export function workingHistory(runs: LocalRun[]) {
  const history: { role: 'user' | 'assistant'; content: string }[] = []
  let size = 0
  for (const run of runs.slice(-6).reverse()) {
    const prompt = run.prompt.slice(0, 8000)
    const warning = run.status === 'complete' ? '' : `\n[This earlier task ${run.status}; inspect current files before continuing.]`
    const answer = `${run.answer.trim().slice(0, 8000 - warning.length)}${warning}`.trim()
    const messages = [{ role: 'user' as const, content: prompt }, ...(answer ? [{ role: 'assistant' as const, content: answer }] : [])]
    const characters = messages.reduce((sum, message) => sum + message.content.length, 0)
    if (size + characters > 24_000) break
    size += characters; history.unshift(...messages)
  }
  return history
}

export function dismissReview(current: BuilderApproval | null, id: string) {
  return current?.id === id ? null : current
}
