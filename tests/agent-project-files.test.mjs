import test from 'node:test'
import assert from 'node:assert/strict'
import { crc32 as crcZlib } from 'node:zlib'
import { zipFiles } from '../src/agent/zip.ts'
import { previewDocument, previewEntry, localPreviewPath } from '../src/agent/preview.ts'
import { blankProject, normaliseProject, starterProject, loadProject } from '../src/agent/project.ts'

test('zipFiles writes a valid STORE archive referencing every project file', async () => {
  const blob = zipFiles([
    { path: 'src/greet.ts', content: 'export const x = 1\n' },
    { path: 'README.md', content: '# hi\n' },
  ])
  assert.equal(blob.type, 'application/zip')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const decoder = new TextDecoder()
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'local header signature')
  const eocd = new DataView(bytes.buffer, bytes.byteLength - 22)
  assert.equal(eocd.getUint32(0, true), 0x06054b50, 'end-of-central-directory signature')
  assert.equal(eocd.getUint16(8, true), 2)
  assert.equal(eocd.getUint16(10, true), 2)
  const centralOffset = eocd.getUint32(16, true)
  assert.equal(centralOffset + eocd.getUint32(12, true) + 22, bytes.byteLength, 'sizes cover the whole archive')
  const text = decoder.decode(bytes)
  assert.ok(text.includes('src/greet.ts'), 'entry name is present')
  assert.ok(text.includes('export const x = 1\n'), 'stored file payload is recoverable byte-for-byte')
  assert.ok(text.includes('README.md') && text.includes('# hi\n'))
})

test('zip archive entries validate against node zlib crc and round-trip through normaliseProject', async () => {
  const project = normaliseProject({ name: 'x', files: [{ path: 'a.txt', content: 'one' }, { path: 'src/nested/read+1@b.txt', content: 'two\nwith lines\n' }] })
  const bytes = new Uint8Array(await zipFiles(project.files.map(({ path, content }) => ({ path, content }))).arrayBuffer())
  const eocd = new DataView(bytes.buffer, bytes.byteLength - 22)
  const centralStart = eocd.getUint32(16, true), centralSize = eocd.getUint32(12, true)
  // Walk every entry twice: local (data) headers and central flattened directory sanity.
  let offset = 0, parsed = []
  while (offset < centralStart) {
    const view = new DataView(bytes.buffer, offset, 30)
    assert.equal(view.getUint32(0, true), 0x04034b50, 'local header signature per entry')
    assert.equal(view.getUint16(8, true), 0, 'stored, no compression')
    const nameLength = view.getUint16(26, true), dataLength = view.getUint32(18, true)
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength))
    const data = bytes.slice(offset + 30 + nameLength, offset + 30 + nameLength + dataLength)
    assert.equal(view.getUint32(14, true), crcZlib(data), `local CRC of ${name} matches zlib over the payload`)
    parsed.push([name, new TextDecoder().decode(data)])
    offset += 30 + nameLength + dataLength
  }
  // Central directory entries must repeat each CRC, exactly.
  for (let header = centralStart; header < centralStart + centralSize;) {
    const view = new DataView(bytes.buffer, header, 46)
    assert.equal(view.getUint32(0, true), 0x02014b50, 'central header signature')
    const nameLength = view.getUint16(28, true)
    const name = new TextDecoder().decode(bytes.slice(header + 46, header + 46 + nameLength))
    const [entryName, entryData] = parsed.find(([candidate]) => candidate === name) || []
    assert.ok(entryName, `central entry ${name} matches a local entry`)
    assert.equal(view.getUint32(16, true), crcZlib(new TextEncoder().encode(entryData)), `central CRC of ${name} matches zlib`)
    header += 46 + nameLength
  }
  assert.deepEqual(parsed, [['a.txt', 'one'], ['src/nested/read+1@b.txt', 'two\nwith lines\n']])
  assert.deepEqual(normaliseProject({ name: 'reimported', files: parsed.map(([path, content]) => ({ path, content })) }).files.length, 2)
})

test('preview inlines local css, js and svg while stripping external and missing references', () => {
  const project = { files: [
    { path: 'index.html', content: `<html><head><link rel="stylesheet" href="theme.css"><script src="app.js"></script></head><body><img src="logo.svg"><img src="https://evil.example/track.png"><a href="https://other.example/">link</a><a href="#top">anchor</a><link rel="stylesheet" href="missing.css"></body></html>` },
    { path: 'theme.css', content: 'body{color:red} @import url(other.css); .x{background:url(logo.svg)}' },
    { path: 'other.css', content: '.nested{color:blue}' },
    { path: 'app.js', content: 'document.title = "inlined<' + '/script-escape>' },
    { path: 'logo.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
  ] }
  const document = previewDocument(project)
  assert.ok(document)
  assert.ok(!document.includes('<link'), 'stylesheet link is replaced or external links are dropped')
  assert.ok(document.includes('.nested{color:blue}'), 'nested @import css is expanded')
  assert.ok(document.includes('body{color:red}'))
  assert.ok(document.includes('document.title = "inlined<\\/script-escape>'), 'inline script escapes its closing tag')
  assert.ok(document.includes(`data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"></svg>')}`), 'local svg becomes a data URI')
  assert.ok(!document.includes('https://evil.example/track.png'), 'external image references are stripped')
  assert.ok(!document.includes('href="https://other.example/"'), 'external anchors are neutralized')
  assert.ok(!document.includes('missing.css'), 'missing local stylesheet is removed')
  assert.ok(document.includes('href="#top"'), 'in-document anchors stay active')
  assert.match(document, /Content-Security-Policy" content="default-src 'none'/, 'CSP blocks any residual network fetch')
})

test('preview rejects projects without HTML entries and over-budget asset collections', () => {
  assert.equal(previewEntry({ files: [{ path: 'src/x.ts', content: '', selected: true }] }), null)
  assert.equal(previewDocument({ files: [{ path: 'src/x.ts', content: '', selected: true }] }), null)
  assert.equal(previewDocument({ files: [] }), null)
  const big = { files: Array.from({ length: 40 }, (_, index) => ({ path: `a${index}.css`, content: 'x'.repeat(20_000), selected: true })) }
  assert.equal(previewDocument(big), null, 'asset collection over the preview budget is refused')
  const plain = { files: [{ path: 'index.html', content: '<p>x</p>', selected: true }] }
  assert.ok(previewDocument(plain)?.includes('<body><p>x</p></body>'), 'a minimal html project previews inline')
})

test('localPreviewPath accepts only plain relative project paths', () => {
  for (const path of ['assets/site.css', './nested/a.css', 'index.html']) assert.ok(localPreviewPath(path))
  for (const path of ['https://x/y.css', '//host/x.css', '/abs.css', '../up.css', 'data:image/png;base64,zz', 'a/../b', '']) assert.equal(localPreviewPath(path), null)
})

test('starterProject seeds only demo workspaces; wallet workspaces start blank', () => {
  const demo = starterProject(true)
  assert.equal(demo.files.length, 4)
  assert.equal(demo.activeFile, 'src/greet.ts')
  const blank = starterProject(false)
  assert.deepEqual(blank, { name: 'RecallLoop project', activeFile: null, files: [] })
  assert.deepEqual(blankProject(), blank)
  const storage = {
    store: new Map(),
    getItem(key) { return this.store.get(key) ?? null },
    setItem(key, value) { this.store.set(key, value) },
  }
  assert.equal(loadProject(storage, 'demo.scope', true).files.length, 4)
  assert.deepEqual(loadProject(storage, 'wallet.scope', false).files, [])
  storage.setItem('recallloop.project.v1:wallet.scope', JSON.stringify({ name: 'saved', files: [{ path: 'a.txt', content: 'x' }] }))
  assert.equal(loadProject(storage, 'wallet.scope', false).files[0].path, 'a.txt', 'stored project loads for wallets too')
  const broken = { getItem: () => 'not-json', setItem() {} }
  assert.equal(loadProject(broken, 'wallet.scope', false).files.length, 0, 'a corrupt cache starts a blank wallet project')
})
