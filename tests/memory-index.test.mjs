import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('memory index persists records across reloads and serializes concurrent writes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recallloop-index-'))
  const previousDirectory = process.env.RECALLLOOP_DATA_DIR
  process.env.RECALLLOOP_DATA_DIR = directory

  try {
    // Import only after setting the directory because the index reads its config
    // once when the module is initialized.
    const index = await import(`../server/memory-index.mjs?test=${Date.now()}`)
    assert.deepEqual(await index.loadMemories(), [])

    await Promise.all(Array.from({ length: 12 }, (_, i) => index.persistMemory({
      id: `memory-${i}`,
      blobId: `blob-${i}`,
      agentId: 'agent-a',
      title: `Experience ${i}',
      timestamp: new Date().toISOString()
    })))

    const stored = await index.loadMemories()
    assert.equal(stored.length, 12)
    assert.equal(new Set(stored.map(item => item.blobId)).size, 12)

    await index.persistMemory(stored[0])
    assert.equal((await index.loadMemories()).length, 12)

    // A new module instance simulates a process/module restart reading disk.
    const reloaded = await import(`../server/memory-index.mjs?reload=${Date.now()}`)
    const afterReload = await reloaded.loadMemories()
    assert.equal(afterReload.length, 12)
    assert.ok(afterReload.some(item => item.agentId === 'agent-a' && item.title === 'Experience 7'))
  } finally {
    if (previousDirectory === undefined) delete process.env.RECALLLOOP_DATA_DIR
    else process.env.RECALLLOOP_DATA_DIR = previousDirectory
    await rm(directory, { recursive: true, force: true })
  }
})
