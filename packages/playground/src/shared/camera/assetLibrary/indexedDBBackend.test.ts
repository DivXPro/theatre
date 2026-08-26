import {indexedDB as fakeIndexedDB} from 'fake-indexeddb'
import type {ModelEntry} from './types'

// jsdom 没有 indexedDB,也没有 URL.createObjectURL——都在 import 被测模块前装好
;(globalThis as any).indexedDB = fakeIndexedDB
;(URL as any).createObjectURL = jest.fn(() => 'blob:mock-url')
;(URL as any).revokeObjectURL = jest.fn()

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {IndexedDBBackend} =
  require('./indexedDBBackend') as typeof import('./indexedDBBackend')

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
