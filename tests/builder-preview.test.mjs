import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createStaticPreview } from '../server/builder/preview.mjs'
import { createLocalFiles } from '../server/builder/filesystem.mjs'
import { BUILDER_LIMITS } from '../server/builder/policy.mjs'
import { temporaryProject } from './helpers/builder-fixture.mjs'
import { deferred } from './helpers/workspace-http.mjs'

const parent = 'http://127.0.0.1:3118'
async function fixture(t, options) {
  const directory = await temporaryProject(t)
  await mkdir(path.join(directory, 'dist'))
  await writeFile(path.join(directory, 'dist', 'index.html'), '<h1>Bounded snapshot</h1>')
  const files = createLocalFiles(directory), preview = await createStaticPreview(options)
  t.after(() => preview.close())
  const create = (overrides = {}) => preview.create({ files, directory: 'dist', entry: 'index.html', origin: parent, ...overrides })
  return { directory, files, preview, create }
}

test('static snapshots enforce each file, total bytes and asset count before minting a capability', async t => {
  const f = await fixture(t)
  const asset = path.join(f.directory, 'dist', 'a.js')
  await writeFile(asset, 'x'.repeat(BUILDER_LIMITS.previewFileBytes + 1))
  await assert.rejects(f.create(), { code: 'preview_limit' })
  await writeFile(asset, 'x'.repeat(BUILDER_LIMITS.previewFileBytes))
  for (let index = 0; index < 5; index++) await writeFile(path.join(f.directory, 'dist', `large-${index}.js`), 'x'.repeat(BUILDER_LIMITS.previewFileBytes))
  await assert.rejects(f.create(), { code: 'preview_limit' })
  // This independent owned folder tests the count limit without the byte limit.
  await mkdir(path.join(f.directory, 'small'))
  await writeFile(path.join(f.directory, 'small', 'index.html'), '<h1>Small assets</h1>')
  await Promise.all(Array.from({ length: BUILDER_LIMITS.previewFiles }, (_, index) => writeFile(path.join(f.directory, 'small', `${index}.js`), '1')))
  await assert.rejects(f.create({ directory: 'small' }), { code: 'preview_limit' })
})

test('snapshot reads recheck real disk growth after listing, including the combined byte budget', async t => {
  const f = await fixture(t), asset = path.join(f.directory, 'dist', 'growing.js')
  await writeFile(asset, '1')
  await assert.rejects(f.create({ files: { ...f.files, async list(...args) {
    const listed = await f.files.list(...args)
    await writeFile(asset, 'x'.repeat(BUILDER_LIMITS.previewFileBytes + 1))
    return listed
  } } }), { code: 'file_too_large' })
  await writeFile(asset, '1')
  for (let index = 0; index < 5; index++) await writeFile(path.join(f.directory, 'dist', `large-${index}.js`), '1')
  await assert.rejects(f.create({ files: { ...f.files, async list(...args) {
    const listed = await f.files.list(...args)
    for (const entry of listed.entries.filter(entry => entry.name.endsWith('.js'))) {
      await writeFile(path.join(f.directory, entry.path), 'x'.repeat(BUILDER_LIMITS.previewFileBytes))
    }
    return listed
  } } }), { code: 'preview_limit' })
})

test('revocation, expiry, query/path tampering and HEAD never expose credentials or revive an old snapshot', async t => {
  let now = Date.now()
  const f = await fixture(t, { clock: () => now }), snapshot = await f.create()
  const head = await fetch(snapshot.url, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.equal(head.headers.has('set-cookie'), false)
  for (const suffix of ['?token=forged', '/%2e%2e/.env', '/%252e%252e/index.html']) {
    assert.equal((await fetch(`${snapshot.url}${suffix}`)).status, 404)
  }
  now += BUILDER_LIMITS.previewMs
  assert.equal((await fetch(snapshot.url)).status, 404)
  const next = await f.create()
  f.preview.revoke(next.id); f.preview.revoke(next.id)
  assert.equal((await fetch(next.url)).status, 404)
  await writeFile(path.join(f.directory, 'dist', 'index.html'), '<script>const key = "sk-' + 's'.repeat(30) + '"</script>')
  await assert.rejects(f.create(), { code: 'sensitive_file' })
})

test('in-flight snapshots reserve their slots, and cancellation or listener closure cannot mint a late capability', async t => {
  const f = await fixture(t), started = deferred(), release = deferred(), controller = new AbortController()
  let reads = 0
  const heldFiles = { ...f.files, async list(...args) { if (++reads === BUILDER_LIMITS.workspaces) started.resolve(); await release.promise; return f.files.list(...args) } }
  const attempts = Array.from({ length: BUILDER_LIMITS.workspaces }, (_, index) => f.create({ files: heldFiles, ...(index === 0 ? { signal: controller.signal } : {}) }))
  // Register handlers before cancellation to avoid unhandled late rejections.
  const settled = Promise.allSettled(attempts)
  try {
    await started.promise
    await assert.rejects(f.create(), { code: 'busy' })
    controller.abort()
    await Promise.all([f.preview.close(), f.preview.close()])
    release.resolve()
    const results = await settled
    assert.ok(results.every(result => result.status === 'rejected'))
    assert.equal(results[0].reason.name, 'AbortError')
    for (const result of results.slice(1)) assert.equal(result.reason.code, 'preview_unavailable')
    await assert.rejects(f.create(), { code: 'preview_unavailable' })
  } finally { release.resolve(); await settled }
})
