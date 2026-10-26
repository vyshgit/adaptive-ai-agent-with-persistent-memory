import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

// A small durable metadata index for the prototype. Point RECALLLOOP_DATA_DIR at
// a persistent mounted volume in deployment; container-local disks may be ephemeral.
const dataDirectory = process.env.RECALLLOOP_DATA_DIR || path.join(process.cwd(), 'data')
const indexPath = path.join(dataDirectory, 'memories.json')
let writeQueue = Promise.resolve()

async function readIndex() {
  try {
    const parsed = JSON.parse(await readFile(indexPath, 'utf8'))
    if (!Array.isArray(parsed)) throw new Error('Memory index must contain a JSON array.')
    return parsed
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

export async function loadMemories() {
  return readIndex()
}

export async function persistMemory(memory) {
  const operation = writeQueue.then(async () => {
    const memories = await readIndex()
    if (memories.some(item => item.blobId === memory.blobId)) return memories
    memories.unshift(memory)
    await mkdir(dataDirectory, { recursive: true })
    const temporaryPath = `${indexPath}.${process.pid}.tmp`
    await writeFile(temporaryPath, JSON.stringify(memories, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, indexPath)
    return memories
  })
  // Keep the queue usable after a failed write while returning the failure to caller.
  writeQueue = operation.catch(() => {})
  return operation
}
