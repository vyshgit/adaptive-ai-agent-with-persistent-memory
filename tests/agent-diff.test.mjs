import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileDiff } from '../src/agent/diff.ts'

const exec = promisify(execFile)

test('downloaded diffs pass git apply --check and produce exact content, including empty files and missing newlines', async t => {
  const temporary = join(tmpdir(), 'opencode')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, 'recallloop-patches-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const texts = ['', 'one', 'one\n', '\n', 'one\ntwo', 'one\ntwo\n', 'one\r\ntwo\r\n', 'a\nb\nc\nd\ne\nf\ng\nh\n']
  const cases = [
    ...texts.map(after => ({ before: null, after })),
    ...texts.flatMap(before => texts.filter(after => after !== before).map(after => ({ before, after }))),
    { before: 'a\nb\nc\nd\ne\nf\ng\nh\n', after: 'a\nb\nc\nd\nchanged\nf\ng\nh\n' },
  ]
  for (const [i, { before, after }] of cases.entries()) {
    const path = `src/${i % 2 ? 'file with space' : 'file'}-${i}.txt`
    const filename = join(root, path)
    await mkdir(dirname(filename), { recursive: true })
    if (before !== null) await writeFile(filename, before)
    const { patch } = fileDiff(path, before, after)
    const patchPath = join(root, `change-${i}.patch`)
    await writeFile(patchPath, patch)
    try {
      await exec('git', ['apply', '--check', '--', patchPath], { cwd: root })
      if (before !== null) assert.equal(await readFile(filename, 'utf8'), before)
      await exec('git', ['apply', '--', patchPath], { cwd: root })
      assert.equal(await readFile(filename, 'utf8'), after)
    } catch (error) {
      assert.fail(`Invalid downloaded patch for ${JSON.stringify({ before, after })}: ${error.message}\n${patch}`)
    }
  }
  assert.deepEqual(fileDiff('unchanged.ts', 'same\n', 'same\n'), { patch: '', lines: [] })
})
