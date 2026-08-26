import {Library} from './library'
import type {LibraryBackend, LibraryEntry, ModelEntry} from './types'

function memoryBackend(): LibraryBackend & {
  entries: Map<string, LibraryEntry>
} {
  const entries = new Map<string, LibraryEntry>()
  return {
    entries,
    listEntries: async (kind) =>
      [...entries.values()].filter((e) => !kind || e.kind === kind),
    getEntry: async (id) => entries.get(id),
    putEntry: async (e) => void entries.set(e.id, e),
    deleteEntry: async (id) => void entries.delete(id),
    putBlob: async () => 'blob-x',
    getBlobUrl: async () => 'blob:x',
    deleteBlob: async () => {},
  }
}

const model = (id: string, name = id): ModelEntry => ({
  id,
  kind: 'model',
  name,
  rig: 'rig-x',
  blobId: 'b',
  contentHash: 'h',
  boneCount: 1,
  vertexCount: 1,
  createdAt: 1,
})

describe('Library', () => {
  it('putEntry/deleteEntry 触发订阅,renameEntry 只改名字', async () => {
    const lib = new Library(memoryBackend())
    const seen: number[] = []
    const unsub = lib.subscribe(() => seen.push(1))
    await lib.putEntry(model('m1'))
    await lib.renameEntry('m1', '新名字')
    await lib.deleteEntry('m1')
    expect(seen.length).toBe(3)
    unsub()
    await lib.putEntry(model('m2'))
    expect(seen.length).toBe(3) // 退订后不再触发
  })

  it('renameEntry 保留其它字段', async () => {
    const backend = memoryBackend()
    const lib = new Library(backend)
    await lib.putEntry(model('m1', '旧'))
    await lib.renameEntry('m1', '新')
    expect(backend.entries.get('m1')).toMatchObject({name: '新', rig: 'rig-x'})
  })
})
