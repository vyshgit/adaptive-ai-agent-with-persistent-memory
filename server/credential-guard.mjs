// Defense-in-depth: redact credential values from any outbound HTTP response.
//
// Credentials are server-only and must never reach the browser. That rule is enforced
// first by convention (keep blockchain calls in server/routes/), but this guard makes
// it structural: even if a response accidentally embeds one — an echoed request,
// a stringified error from a failed fetch, a debug dump — the exact value is
// replaced with a placeholder before the bytes leave the process.
//
// Exact-value replacement plus defence-in-depth detection of common pasted keys.
// Streaming agent responses use a separate chunk-aware redactor.
//
// Read from credentials-store on every call, not captured once at import — a
// credential rewritten mid-session must be scrubbed against its new value, not
// whatever was live when this module first loaded.
import { credentialValues } from './credentials-store.mjs'
import { redactSecrets, redactValue } from './safety.mjs'

function scrub(body) {
  // credentialValues() covers anything seeded/pushed into creds.json, but a
  // credential can also reach this process directly via the environment
  // (e.g. local dev exporting TATUM_API_KEY with no creds file mounted) —
  // include it so that path is still redacted.
  const secrets = credentialValues()
  if (body == null) return body
  let text
  if (typeof body === 'string') {
    text = body
  } else if (Buffer.isBuffer(body)) {
    text = body.toString('utf8')
  } else {
    return body // streams, etc. — left untouched
  }
  const redacted = redactSecrets(text, secrets)
  return redacted === text ? body : redacted
}

export function credentialGuard(_req, res, next) {
  const json = res.json.bind(res)
  res.json = (payload) => {
    res.type('application/json')
    return send(JSON.stringify(redactValue(payload, credentialValues())))
  }

  const send = res.send.bind(res)
  res.send = (payload) => {
    // res.send(object) serializes to JSON *after* this override would run, so a
    // raw object payload must be stringified here or the redaction is bypassed.
    if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload)) {
      res.type('application/json')
      return send(JSON.stringify(redactValue(payload, credentialValues())))
    }
    return send(scrub(payload))
  }

  next()
}
