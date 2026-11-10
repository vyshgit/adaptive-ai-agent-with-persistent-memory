import { AppError } from '../safety.mjs'

// Opaque provider state belongs only to this server-side tool loop. A WeakMap
// keeps it out of JSON, browser events, tool arguments and memory capture.
const signatures = new WeakMap()
const invalid = () => new AppError('provider_invalid_response', 'The provider returned invalid or oversized tool-call signature metadata.', 502)
const object = value => value && typeof value === 'object' && !Array.isArray(value)
export const MAX_TOOL_SIGNATURE = 64_000

export function readThoughtSignature(extraContent) {
  if (extraContent == null) return undefined
  if (!object(extraContent)) throw invalid()
  if (extraContent.google === undefined) return undefined
  if (!object(extraContent.google)) throw invalid()
  const signature = extraContent.google.thought_signature
  if (signature === undefined) return undefined
  if (typeof signature !== 'string' || !signature.length || signature.length > MAX_TOOL_SIGNATURE) throw invalid()
  return signature
}

export function rememberToolSignature(call, extraContent) {
  const signature = readThoughtSignature(extraContent)
  if (signature !== undefined) {
    // Signatures are complete opaque values, not text deltas. Never concatenate,
    // decode, redact or replace an earlier signature with a conflicting chunk.
    if (signatures.has(call) && signatures.get(call) !== signature) throw invalid()
    signatures.set(call, signature)
  }
  return call
}

export function copyToolSignature(source, target) {
  if (signatures.has(source)) signatures.set(target, signatures.get(source))
  return target
}

export function toolSignatureContent(call) {
  const signature = signatures.get(call)
  return signature === undefined ? {} : { extra_content: { google: { thought_signature: signature } } }
}
