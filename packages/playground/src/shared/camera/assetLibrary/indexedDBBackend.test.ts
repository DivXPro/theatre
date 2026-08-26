import {indexedDB as fakeIndexedDB} from 'fake-indexeddb'
import type {ModelEntry} from './types'

// jsdom 没有 indexedDB,也没有 URL.createObjectURL——都在 import 被测模块前装好
;(globalThis as any).indexedDB = fakeIndexedDB
;(URL as any).createObjectURL = jest.fn(() => 'blob:mock-url')
;(URL as any).revokeObjectURL = jest.fn()

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {IndexedDBBackend} =
  require('./indexedDBBackend') as typeof import('./indexedDBBackend')

const DB_NAME = 'toybox-asset-library'

// 追踪所有打开的连接,reset 前先 close,否则 deleteDatabase 会被阻塞
const openDatabases: IDBDatabase[] = []
const originalOpen = indexedDB.open.bind(indexedDB)
indexedDB.open = (...args: Parameters<IDBFactory['open']>) => {
  const req = originalOpen(...args)
  req.addEventListener('success', () => {
    openDatabases.push(req.result)
  })
  return req
}

function resetDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    for (const db of openDatabases) {
      try {
        db.close()
      } catch {}
    }
    openDatabases.length = 0
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

beforeEach(async () => {
  await resetDB()
})

function makeModel(id: string): ModelEntry {
  return {
    id,
    kind: 'model',
    name: id,
    rig: 'rig-x',
    blobId: 'b1',
    contentHash: 'h1',
    boneCount: 3,
    vertexCount: 24,
    createdAt: 1,
  }
}

describe('IndexedDBBackend', () => {
  it('条目增删查 + 按 kind 过滤', async () => {
    const backend = new IndexedDBBackend()
    await backend.putEntry(makeModel('m1'))
    await backend.putEntry({
      ...makeModel('m2'),
      kind: 'animation',
      duration: 1,
    } as any)
    expect(await backend.getEntry('m1')).toMatchObject({
      id: 'm1',
      kind: 'model',
    })
    expect((await backend.listEntries()).length).toBe(2)
    expect((await backend.listEntries('model')).map((e: any) => e.id)).toEqual([
      'm1',
    ])
    await backend.deleteEntry('m1')
    expect(await backend.getEntry('m1')).toBeUndefined()
  })

  it('blob 内容寻址:同内容同 id;可取 URL;可删', async () => {
    const backend = new IndexedDBBackend()
    const data = new Blob([new Uint8Array([1, 2, 3])])
    const id1 = await backend.putBlob(data)
    const id2 = await backend.putBlob(new Blob([new Uint8Array([1, 2, 3])]))
    expect(id1).toBe(id2)
    expect(id1).not.toBe(await backend.putBlob(new Blob([new Uint8Array([9])])))
    expect(await backend.getBlobUrl(id1)).toBe('blob:mock-url')
    await backend.deleteBlob(id1)
    await expect(backend.getBlobUrl(id1)).rejects.toThrow()
  })
})

describe('骨架族别名', () => {
  it('存取往返,同 rig 覆盖', async () => {
    const backend = new IndexedDBBackend()
    await backend.putRigAlias({rig: 'rig-a', name: 'Mixamo'})
    await backend.putRigAlias({rig: 'rig-b', name: '自带骨架'})
    await backend.putRigAlias({rig: 'rig-a', name: 'Mixamo 标准'})
    const aliases = await backend.getRigAliases()
    expect(aliases).toContainEqual({rig: 'rig-a', name: 'Mixamo 标准'})
    expect(aliases).toContainEqual({rig: 'rig-b', name: '自带骨架'})
    expect(aliases).toHaveLength(2)
  })

  it('v1 老库升级到 v2 后别名表可用,旧数据不丢', async () => {
    // 先以 v1 结构建库,模拟老用户已有的库
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('toybox-asset-library', 1)
      req.onupgradeneeded = () => {
        const d = req.result
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs')
        if (!d.objectStoreNames.contains('entries')) {
          const s = d.createObjectStore('entries', {keyPath: 'id'})
          s.createIndex('kind', 'kind', {unique: false})
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    // 写入老数据后再关闭,验证升级后旧数据仍然可读
    const seededEntry = makeModel('legacy-model')
    const blobKey = 'seed-blob'
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['entries', 'blobs'], 'readwrite')
      tx.objectStore('entries').put(seededEntry)
      tx.objectStore('blobs').put(new Blob(['seed']), blobKey)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    // 新版本后端打开触发升级
    const backend = new IndexedDBBackend()
    expect(await backend.getEntry('legacy-model')).toEqual(seededEntry)
    expect(await backend.listBlobIds()).toContain(blobKey)
    expect(await backend.getBlobUrl(blobKey)).toBe('blob:mock-url')
    await backend.putRigAlias({rig: 'rig-x', name: '升级后可用'})
    expect(await backend.getRigAliases()).toEqual([
      {rig: 'rig-x', name: '升级后可用'},
    ])
  })
})
