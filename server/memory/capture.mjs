import { publicError, redactSecrets } from '../safety.mjs'

export const skippedCapture = (reason = 'disabled', message = 'Auto-memory is off for this turn.') => ({
  verbatim: 0, facts: 0, failed: 0, blobs: [], skipped: true, reason, message,
})
export const pendingCapture = () => ({ verbatim: 0, facts: 0, failed: 0, blobs: [], pending: true,
  message: 'Memory capture is still pending. Refresh inventory to check confirmed writes before retrying.' })

// Only user-authored prose is eligible for automatic analysis. The relayer
// extracts durable facts; these local filters avoid submitting obvious chat
// filler, pasted code/log blocks and quoted material as personal context.
// This is deliberately not a dump of model history, files or tool results.
export function relevantContext(text, secrets = []) {
  const clean = redactSecrets(text, secrets).replace(/\r\n?/g, '\n')
  if (/\b(?:off the record|keep (?:this|that|it|everything) private|(?:do not|don't|don’t|never)\s+(?:save|store|remember|memorize)\b)/i.test(clean)) return ''
  let fence = null
  const lines = []
  for (const line of clean.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      continue
    }
    if (fence || /^(?:\t| {4}|\s*>)/.test(line)) continue
    const prose = line.trim().replace(/^[-*+]\s+/, '')
    // Nested speakers and pasted conversation exports are not this turn's
    // assertions. Skip the dump as a whole, including its surrounding preamble.
    if (/^(?:#{1,6}\s*)?(?:\[?(?:user|human|assistant|system|developer|tool)(?:\s+tool (?:call|result))?\]?\s*:|<\/?(?:conversation(?:-checkpoint)?|recent-context|transcript|(?:user|assistant|system)(?:_message)?)\b|<\|(?:im_start|start_header_id)\|>|(?:begin|end) (?:conversation|transcript)\b)/i.test(prose)) return ''
    if (!prose || /\[REDACTED\]/i.test(prose)
      || /^["'“‘].*["'”’][.!?]?$/.test(prose)
      || /^(?:[{}[\]<>]|(?:export|import|const|let|var|function|class|def|from|SELECT|INSERT)\b|(?:npm|pnpm|yarn|git|curl|sudo)\s|\$\s|at\s+\S+\s*\(|\d{4}-\d\d-\d\d[T ])/.test(prose)
      || /(?:=>|[{}]|^\w+\s*=|^[\w$.]+\s*\(.*\)\s*;?$)/.test(prose)) continue
    if (/^(?:(?:hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great|cool|nice|done|continue|go ahead|sounds good|please)[\s,.!?]*)+$/i.test(prose)) continue
    if (!/[\p{L}\p{N}]/u.test(prose)) continue
    lines.push(prose)
  }
  // Bound analysis independently of the model's larger coding-task budget.
  return lines.join('\n').slice(0, 4000).trim()
}

// Called after successful generation, while the original wallet binding is
// still active. Accepted SDK jobs may outlive a disconnected HTTP response;
// service disposal and its write limits remain authoritative.
export function captureTurn({ memory, agentId, sessionId, message, occurredAt, project = '', capture = true,
  captureMode = 'facts', answer = '', toolCapture = [], secrets = [] }) {
  if (!capture) return Promise.resolve(skippedCapture())
  const automatic = captureMode === 'facts'
  const context = automatic ? relevantContext(message, secrets) : message
  if (!context) return Promise.resolve(skippedCapture('no_context', 'No relevant user context to remember.'))
  const label = redactSecrets(project, secrets).replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 120)
  const messages = automatic
    ? [{ role: 'user', content: `${label && !label.includes('[REDACTED]') ? `Project: ${label}\n` : ''}${context}` }]
    : [{ role: 'user', content: message }, ...(answer.trim() ? [{ role: 'assistant', content: answer.slice(0, 20_000) }] : []), ...toolCapture]
  try {
    return Promise.resolve(memory.ingest({ agentId, sessionId, occurredAt, mode: captureMode, messages }, { secrets, automatic }))
      .then(result => {
        const stored = { ...result.stored, blobs: result.blobs, chainAnchor: result.chainAnchor }
        if (result.deduplicated && stored.facts && !stored.failed) return { ...stored, deduplicated: true, message: 'This context is already remembered; no new write was needed.' }
        return !stored.facts && !stored.verbatim && !stored.failed
          ? { ...skippedCapture('no_facts', 'No durable facts were found to remember.'), ...(result.deduplicated ? { deduplicated: true } : {}) } : stored
      }).catch(error => captureFailure(error, secrets))
  } catch (error) { return Promise.resolve(captureFailure(error, secrets)) }
}

function captureFailure(error, secrets) {
  return { verbatim: 0, facts: 0, failed: 1, blobs: [], code: error?.code === 'memory_not_configured' ? 'capture_unavailable' : 'capture_failed',
    message: error?.code === 'memory_not_configured' ? 'Auto-memory is unavailable. Connect Walrus in Memory settings.' : redactSecrets(publicError(error).error, secrets) }
}
