import {indexedDB as fakeIndexedDB} from 'fake-indexeddb'
import {Library} from './library'
import {IndexedDBBackend} from './indexedDBBackend'
import type {LibraryBackend, LibraryEntry, ModelEntry} from './types'

// jsdom 没有 indexedDB,新测 IndexedDBBackend 前装好
;(globalThis as any).indexedDB = fakeIndexedDB
;(URL as any).createObjectURL = jest.fn(() => 'blob:mock-url')
;(URL as any).revokeObjectURL = jest.fn()

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
    listBlobIds: async () => [],
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

describe('blob 生命周期', () => {
  test('deleteEntryDeep: 缩略图被两个模型共享时,删一个不删 blob', async () => {
    const lib = new Library(new IndexedDBBackend())
    const thumbId = await lib.backend.putBlob(new Blob(['thumb']))
    const model = (id: string) => ({
      id,
      kind: 'model' as const,
      name: id,
      rig: 'static',
      blobId: 'b-' + id,
      contentHash: 'h-' + id,
      thumbnailId: thumbId,
      boneCount: 0,
      vertexCount: 1,
      createdAt: 1,
    })
    await lib.putEntry(model('m1'))
    await lib.putEntry(model('m2'))
    await lib.deleteEntryDeep('m1')
    // 共享缩略图仍在;m1 自己的模型 blob 不在本次放入(不影响断言)
    expect(await lib.backend.listBlobIds()).toContain(thumbId)
  })

  test('deleteEntryDeep: 独占 blob 随条目删除', async () => {
    const lib = new Library(new IndexedDBBackend())
    const blobId = await lib.backend.putBlob(new Blob(['glb']))
    await lib.putEntry({
      id: 'm1',
      kind: 'model',
      name: 'm1',
      rig: 'static',
      blobId,
      contentHash: 'h',
      boneCount: 0,
      vertexCount: 1,
      createdAt: 1,
    })
    await lib.deleteEntryDeep('m1')
    expect(await lib.backend.listBlobIds()).not.toContain(blobId)
  })

  test('sweepOrphanBlobs: 清掉无引用 blob,保留有引用的', async () => {
    const lib = new Library(new IndexedDBBackend())
    const used = await lib.backend.putBlob(new Blob(['used']))
    const orphan = await lib.backend.putBlob(new Blob(['orphan']))
    await lib.putEntry({
      id: 'a1',
      kind: 'animation',
      name: 'a1',
      rig: 'r',
      blobId: used,
      contentHash: 'h',
      duration: 1,
      createdAt: 1,
    })
    expect(await lib.sweepOrphanBlobs()).toBe(1)
    const ids = await lib.backend.listBlobIds()
    expect(ids).toContain(used)
    expect(ids).not.toContain(orphan)
  })

  test('并发导入与孤儿清理: blob 与条目都保留', async () => {
    const lib = new Library(new IndexedDBBackend())
    const data = new Blob(['concurrent-sweep-import'])
    let importedBlobId = ''
    await Promise.all([
      lib.sweepOrphanBlobs(),
      lib.putBlobWithEntry(data, (blobId) => {
        importedBlobId = blobId
        return {
          id: 'a-concurrent-sweep',
          kind: 'animation',
          name: 'a-concurrent-sweep',
          rig: 'r',
          blobId,
          contentHash: 'h-concurrent-sweep',
          duration: 1,
          createdAt: 1,
        }
      }),
    ])
    expect(await lib.backend.listBlobIds()).toContain(importedBlobId)
    const entry = await lib.backend.getEntry('a-concurrent-sweep')
    expect(entry).toBeTruthy()
    expect(entry?.kind).toBe('animation')
  })

  test('并发删除与同哈希导入: 新条目与新 blob 都保留', async () => {
    const lib = new Library(new IndexedDBBackend())
    const data = new Blob(['shared-hash'])
    let blobId = ''
    await lib.putBlobWithEntry(data, (id) => {
      blobId = id
      return {
        id: 'm-delete-original',
        kind: 'model',
        name: 'm-delete-original',
        rig: 'static',
        blobId: id,
        contentHash: 'h-shared-hash',
        boneCount: 0,
        vertexCount: 1,
        createdAt: 1,
      }
    })
    await Promise.all([
      lib.deleteEntryDeep('m-delete-original'),
      lib.putBlobWithEntry(data, (id) => ({
        id: 'm-delete-reimport',
        kind: 'model',
        name: 'm-delete-reimport',
        rig: 'static',
        blobId: id,
        contentHash: 'h-shared-hash',
        boneCount: 0,
        vertexCount: 1,
        createdAt: 1,
      })),
    ])
    expect(await lib.backend.listBlobIds()).toContain(blobId)
    expect(await lib.backend.getEntry('m-delete-reimport')).toBeTruthy()
  })
})
