import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile, mkdir, symlink, link, rename, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { createLocalFiles, fileVersion } from '../server/builder/filesystem.mjs'
import { builderRoot, relativePath, commandInput, localBuilderGuard } from '../server/builder/policy.mjs'
import { temporaryProject } from './helpers/builder-fixture.mjs'

test('local paths refuse traversal, credentials, engine configuration and unsafe encodings', () => {
  for (const value of ['../a', '/etc/passwd', 'a/../b', 'a//b', 'a\\b', '%2e%2e/a', 'a/./b', '.env', '.env.local', 'a/.npmrc',
    '.opencode/plugin.mjs', 'a/node_modules/b', '.git/config', '.ssh/id_rsa', 'secret.pem', 'secrets.json', '.recallloop-edit-x', ' a.ts']) {
    assert.throws(() => relativePath(value), { code: 'unsafe_path' }, value)
  }
  assert.equal(relativePath('src/my component.tsx'), 'src/my component.tsx')
  assert.equal(relativePath('.', { directory: true }), '.')
  assert.throws(() => commandInput({ command: 'echo synthetic-private-key', reason: 'x' }, ['synthetic-private-key']), { code: 'unsafe_command' })
  assert.throws(() => commandInput({ command: 'node -v', timeoutMs: 0 }), { code: 'invalid_request' })
  assert.throws(() => commandInput({ command: 'node -v', env: { SECRET: 'x' } }), { code: 'invalid_request' })
})

test('the whole-app localhost guard rejects rebinding, forwarded origins and remote peers', () => {
  function check(headers = {}, peer = '127.0.0.1', protocol = 'http') {
    let allowed = false, status
    const values = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', ...headers }
    localBuilderGuard({ get: key => values[key], socket: { remoteAddress: peer }, protocol },
      { status(value) { status = value; return this }, json() {} }, () => { allowed = true })
    return { allowed, status }
  }
  assert.equal(check().allowed, true)
  for (const args of [[{ host: 'attacker.example:3000' }], [{ origin: 'https://127.0.0.1:3000' }], [{ origin: 'null' }],
    [{ origin: 'http://evil.example' }], [{ 'sec-fetch-site': 'cross-site' }], [{}, '192.168.1.5'], [{}, '127.0.0.1', 'https']]) {
    assert.deepEqual(check(...args), { allowed: false, status: 403 })
  }
})

test('workspace roots must be existing specific local directories', async t => {
  const root = await temporaryProject(t)
  assert.equal(await builderRoot(root), root)
  for (const value of ['/', '/data', 'relative/path', path.join(root, 'missing')]) await assert.rejects(builderRoot(value))
  await assert.rejects(builderRoot(root, '0.0.0.0'), { code: 'local_only' })
})

test('file tools omit sensitive paths and refuse links, hardlinks, binary and oversized content', async t => {
  const root = await temporaryProject(t), files = createLocalFiles(root)
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1\n')
  await writeFile(path.join(root, '.env'), 'SECRET=not-for-the-model')
  await writeFile(path.join(root, 'binary.dat'), Buffer.from([255, 0, 128]))
  await writeFile(path.join(root, 'huge.txt'), 'x'.repeat(100_001))
  await symlink(path.join(root, 'src'), path.join(root, 'alias'))
  await link(path.join(root, 'src', 'a.ts'), path.join(root, 'hard.ts'))
  const listed = await files.list()
  assert.equal(listed.entries.some(entry => ['.env', 'alias', 'hard.ts'].includes(entry.name)), false)
  await assert.rejects(files.read('alias/a.ts'), { code: 'unsafe_path' })
  await assert.rejects(files.read('hard.ts'), { code: 'unsafe_path' })
  await assert.rejects(files.read('binary.dat'), { code: 'binary_file' })
  await assert.rejects(files.read('huge.txt'), { code: 'file_too_large' })
  assert.deepEqual((await files.search({ query: 'export' })).matches, []) // both names of the hardlinked source are refused
})

test('recognized credentials are redacted on reads/search and make the original file read-only', async t => {
  const root = await temporaryProject(t), files = createLocalFiles(root, { secrets: () => ['synthetic-session-credential'] })
  await writeFile(path.join(root, 'config.ts'), 'export const token = "synthetic-session-credential"\n')
  const file = await files.read('config.ts')
  assert.equal(file.redacted, true)
  assert.match(file.content, /\[REDACTED\]/)
  assert.equal(JSON.stringify(await files.search({ query: 'token' })).includes('synthetic-session-credential'), false)
  await assert.rejects(files.proposal({ path: file.path, version: file.version, content: 'safe replacement' }), { code: 'sensitive_file' })
  await assert.rejects(files.proposal({ path: 'new.ts', version: null, content: 'synthetic-session-credential' }), { code: 'sensitive_file' })
})

test('exact-preimage proposals create, update and delete regular UTF-8 files without leftover temporary files', async t => {
  const root = await temporaryProject(t), files = createLocalFiles(root)
  const created = await files.apply(await files.proposal({ path: 'hello.ts', version: null, content: 'hello 🌍\n' }))
  assert.equal(created.version, fileVersion(Buffer.from('hello 🌍\n')))
  const file = await files.read('hello.ts')
  await files.apply(await files.proposal({ path: file.path, version: file.version, content: 'updated\n' }))
  assert.equal(await readFile(path.join(root, 'hello.ts'), 'utf8'), 'updated\n')
  const updated = await files.read('hello.ts')
  await files.apply(await files.proposal({ path: updated.path, version: updated.version, content: null }))
  await assert.rejects(stat(path.join(root, 'hello.ts')), { code: 'ENOENT' })
  assert.deepEqual(await readdir(root), [])
})

test('changed preimages, newly created paths and replaced parents cannot consume stale file edits', async t => {
  const root = await temporaryProject(t), files = createLocalFiles(root)
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src', 'a.ts'), 'before\n')
  const file = await files.read('src/a.ts')
  const edit = await files.proposal({ path: file.path, version: file.version, content: 'after\n' })
  await writeFile(path.join(root, 'src', 'a.ts'), 'user work\n')
  await assert.rejects(files.apply(edit), { code: 'file_changed' })
  assert.equal(await readFile(path.join(root, 'src', 'a.ts'), 'utf8'), 'user work\n')
  const create = await files.proposal({ path: 'new.ts', version: null, content: 'new\n' })
  await writeFile(path.join(root, 'new.ts'), 'concurrent\n')
  await assert.rejects(files.apply(create), { code: 'file_changed' })
  await rename(path.join(root, 'src'), path.join(root, 'original'))
  await symlink(path.join(root, 'original'), path.join(root, 'src'))
  await assert.rejects(files.apply(edit), { code: 'unsafe_path' })
  const stopped = AbortSignal.abort()
  await assert.rejects(files.apply(create, { signal: stopped }), { name: 'AbortError' })
  assert.equal((await readdir(root)).some(name => name.startsWith('.recallloop-edit-')), false)
})

test('file listings/searches respect explicit bounds and cancellation', async t => {
  const root = await temporaryProject(t), files = createLocalFiles(root)
  await Promise.all(Array.from({ length: 8 }, (_, i) => writeFile(path.join(root, `${i}.ts`), `literal needle ${i}\n`)))
  const result = await files.list('.', { limit: 3 })
  assert.equal(result.entries.length, 3)
  assert.equal(result.truncated, true)
  assert.equal((await files.search({ query: 'needle' })).matches.length, 8)
  await assert.rejects(files.search({ query: 'needle' }, { signal: AbortSignal.abort() }), { name: 'AbortError' })
})
