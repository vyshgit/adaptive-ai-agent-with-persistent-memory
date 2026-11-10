// Test-only defense against accidental billable parent-app requests. The private
// SDK worker has its own fetch boundary and does not inherit NODE_OPTIONS.
const original = globalThis.fetch.bind(globalThis)
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input)
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('The local-builder browser fixture permits loopback traffic only.')
  }
  return original(input, init)
}
