import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const indexModule = new URL('../server/memory-index.mjs', import.meta.url).href

function runNode(source, directory) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8',
    env: { ...process.env, RECALLLOOP_DATA_DIR: directory }
  })
  assert.equal(result.status, 0, `child process failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
  return result.stdout.trim()
}

test('memory index survives an actual Node process exit and restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recallloop-process-restart-'))
  try {
    const writeScript = `import { persistMemory } from ${JSON.stringify(indexModule)}; await persistMemory({ id: 'restart-check', blobId: 'restart-blob-1', agentId: 'agent-restart', title: 'Survives process restart', timestamp: new Date().toISOString() }); console.log('written')`
    assert.equal(runNode(writeScript, directory), 'written')

    const readScript = `import { loadMemories } from ${JSON.stringify(indexModule)}; const memories = await loadMemories(); if (memories.length !== 1 || memories[0].blobId !== 'restart-blob-1' || memories[0].title !== 'Survives process restart') process.exit(2); console.log(JSON.stringify({ count: memories.length, title: memories[0].title }))`
    const result = JSON.parse(runNode(readScript, directory))
    assert.deepEqual(result, { count: 1, title: 'Survives process restart' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
