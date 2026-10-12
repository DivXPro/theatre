import {indexedDB as fakeIndexedDB} from 'fake-indexeddb'
import {Library} from './library'
import {IndexedDBBackend} from './indexedDBBackend'
import {seedAssetsManifest} from './seedAssetsManifest'
import type {LibraryError, LibrarySource, WritableLibrarySource} from './source'
import type {LibraryBackend, LibraryEntry, ModelEntry} from './types'

// jsdom 没有 indexedDB,新测 IndexedDBBackend 前装好
;(globalThis as any).indexedDB = fakeIndexedDB
;(URL as any).createObjectURL = jest.fn(() => 'blob:mock-url')
;(URL as any).revokeObjectURL = jest.fn()

function memoryBackend(): LibraryBackend & {
  entries: Map<string, LibraryEntry>
  aliases: Map<string, string>
} {
  const entries = new Map<string, LibraryEntry>()
  const aliases = new Map<string, string>()
  return {
    id: 'mock',
    entries,
    aliases,
    listEntries: async (kind) =>
      [...entries.values()].filter((e) => !kind || e.kind === kind),
    getEntry: async (id) => entries.get(id),
    putEntry: async (e) => void entries.set(e.id, e),
    deleteEntry: async (id) => void entries.delete(id),
    putBlob: async () => 'blob-x',
    getBlobUrl: async () => 'blob:x',
    deleteBlob: async () => {},
    listBlobIds: async () => [],
    getRigAliases: async () =>
      [...aliases.entries()].map(([rig, name]) => ({rig, name})),
    putRigAlias: async ({rig, name}) => void aliases.set(rig, name),
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
    const lib = new Library({sources: [memoryBackend()]})
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

  it('setRigAlias 写入并触发订阅', async () => {
    const lib = new Library({sources: [memoryBackend()]})
    const events: number[] = []
    const unsub = lib.subscribe(() => events.push(1))
    await lib.setRigAlias('rig-a', 'Mixamo')
    unsub()
    const aliases = await lib.getRigAliases()
    expect(aliases).toContainEqual({rig: 'rig-a', name: 'Mixamo'})
    expect(events.length).toBe(1)
  })

  it('renameEntry 保留其它字段', async () => {
    const backend = memoryBackend()
    const lib = new Library({sources: [backend]})
    await lib.putEntry(model('m1', '旧'))
    await lib.renameEntry('m1', '新')
    expect(backend.entries.get('m1')).toMatchObject({name: '新', rig: 'rig-x'})
  })
})

describe('聚合器(多数据源)', () => {
  const fakeSource = (
    id: string,
    entries: LibraryEntry[],
    writable = false,
  ): LibrarySource => ({
    id,
    capabilities: {writable},
    listEntries: async () => entries,
    getEntry: async (eid) => entries.find((e) => e.id === eid),
    getBlobUrl: async (b) => `${id}://${b}`,
  })

  test('聚合读:多源合并,id 冲突先注册者胜并告警', async () => {
    const errors: LibraryError[] = []
    const lib = new Library({
      sources: [
        fakeSource('a', [{id: 'x', name: 'A 的 x'} as any]),
        fakeSource('b', [{id: 'x', name: 'B 的 x'} as any, {id: 'y'} as any]),
      ],
      onError: (e) => errors.push(e),
    })
    const entries = await lib.listEntries()
    expect(entries.map((e) => e.id).sort()).toEqual(['x', 'y'])
    expect((await lib.getEntry('x'))?.name).toBe('A 的 x')
    expect(errors.some((e) => e.code === 'conflict')).toBe(true)
  })

  test('seed-* 前缀拒绝:可写源返回内置前缀条目被剔除并告警', async () => {
    const errors: LibraryError[] = []
    const writable: WritableLibrarySource = {
      ...(fakeSource('idb', [{id: 'seed-pose-fake'} as any], true) as any),
      putEntry: async () => {},
      deleteEntry: async () => {},
      putBlob: async () => 'h',
      deleteBlob: async () => {},
      getRigAliases: async () => [],
      putRigAlias: async () => {},
    }
    const lib = new Library({
      sources: [writable],
      onError: (e) => errors.push(e),
    })
    expect(await lib.listEntries()).toEqual([])
    expect(errors.some((e) => e.code === 'conflict')).toBe(true)
  })

  test('纯查看器模式:无可写源,写操作抛 auth;面板照常可读', async () => {
    const lib = new Library({
      sources: [fakeSource('catalog', [{id: 'seed-pose-a'} as any])],
    })
    expect(lib.canWrite).toBe(false)
    expect(await lib.listEntries()).toHaveLength(1)
    await expect(lib.putEntry({id: 'u1'} as any)).rejects.toMatchObject({
      code: 'auth',
    })
  })

  test('blobId 路由:带源前缀走该源,裸 hash 走可写源', async () => {
    const writable = {
      ...(fakeSource('idb', [], true) as any),
      putEntry: async () => {},
      deleteEntry: async () => {},
      putBlob: async () => 'h',
      deleteBlob: async () => {},
      getRigAliases: async () => [],
      putRigAlias: async () => {},
    } as WritableLibrarySource
    const lib = new Library({
      sources: [fakeSource('catalog', []), writable],
    })
    expect(await lib.getBlobUrl('catalog:models/a.glb')).toBe(
      'catalog://catalog:models/a.glb',
    )
    expect(await lib.getBlobUrl('abc123')).toBe('idb://abc123')
  })

  test('无 IndexedDB + 只给静态目录:降级只读可用,不白屏', async () => {
    const lib = new Library({
      sources: [fakeSource('catalog', [{id: 'p1'} as any])],
    })
    expect(lib.canWrite).toBe(false)
    expect(await lib.listEntries()).toHaveLength(1) // 目录照常
  })

  test('renameEntry 只读源守卫:内置条目不写影子副本,上告 conflict', async () => {
    const errors: LibraryError[] = []
    const stored = new Map<string, LibraryEntry>()
    const putEntry = jest.fn(
      async (e: LibraryEntry) => void stored.set(e.id, e),
    )
    const writable: WritableLibrarySource = {
      id: 'idb',
      capabilities: {writable: true},
      listEntries: async () => [...stored.values()],
      getEntry: async (id) => stored.get(id),
      getBlobUrl: async (b) => `idb://${b}`,
      putEntry,
      deleteEntry: async (id) => void stored.delete(id),
      putBlob: async () => 'h',
      deleteBlob: async () => {},
      getRigAliases: async () => [],
      putRigAlias: async () => {},
    }
    const lib = new Library({
      sources: [
        fakeSource('catalog', [{id: 'seed-pose-a', name: '内置姿势'} as any]),
        writable,
      ],
      onError: (e) => errors.push(e),
    })
    await lib.listEntries() // 建 id→源映射(守卫的依据)
    await lib.renameEntry('seed-pose-a', '改名')
    expect(putEntry).not.toHaveBeenCalled() // 可写源无影子副本
    expect(errors.some((e) => e.code === 'conflict')).toBe(true)
    expect(await writable.getEntry('seed-pose-a')).toBeUndefined()
    // 可写源自己的条目照常可改(守卫不误伤)
    errors.length = 0
    await lib.putEntry({id: 'u1', name: '用户条目'} as any)
    await lib.renameEntry('u1', '改名后')
    expect(errors).toEqual([])
    expect((await writable.getEntry('u1'))?.name).toBe('改名后')
  })

  test('renameEntry 只读源守卫(冷会话):未 listEntries 探源命中回填映射,守卫不绕过', async () => {
    // T9 顺带(T8 评审遗留):entrySourceMap 只在 listEntries 时重建;
    // 冷会话里 getEntry 探源命中若不回填,getEntrySource 拿不到所属源,
    // 内置条目会被写进可写源成影子副本
    const errors: LibraryError[] = []
    const stored = new Map<string, LibraryEntry>()
    const putEntry = jest.fn(
      async (e: LibraryEntry) => void stored.set(e.id, e),
    )
    const writable: WritableLibrarySource = {
      id: 'idb',
      capabilities: {writable: true},
      listEntries: async () => [...stored.values()],
      getEntry: async (id) => stored.get(id),
      getBlobUrl: async (b) => `idb://${b}`,
      putEntry,
      deleteEntry: async (id) => void stored.delete(id),
      putBlob: async () => 'h',
      deleteBlob: async () => {},
      getRigAliases: async () => [],
      putRigAlias: async () => {},
    }
    const lib = new Library({
      sources: [
        fakeSource('catalog', [{id: 'seed-pose-a', name: '内置姿势'} as any]),
        writable,
      ],
      onError: (e) => errors.push(e),
    })
    // 关键:不 listEntries——冷映射会话直接 rename 内置条目
    await lib.renameEntry('seed-pose-a', '改名')
    expect(putEntry).not.toHaveBeenCalled() // 不写影子副本
    expect(errors.some((e) => e.code === 'conflict')).toBe(true)
    expect(await writable.getEntry('seed-pose-a')).toBeUndefined()
    // 冷命中已回填映射:来源可查,且再次 rename 守卫依旧拦
    expect(lib.getEntrySource('seed-pose-a')?.id).toBe('catalog')
    errors.length = 0
    await lib.renameEntry('seed-pose-a', '再改')
    expect(putEntry).not.toHaveBeenCalled()
    expect(errors.some((e) => e.code === 'conflict')).toBe(true)
  })

  test('模型按 contentHash 去重:可写源副本优先,两个 id 都能 getEntry', async () => {
    // 场景:旧浏览器 IDB 里已播种 Y Bot(随机管线 id),目录源又提供
    // 同一模型(seed-model-<contentHash>)。列表只出一个且是可写源的 id
    // (用户的条目,场景引用不断);目录条目不删数据,getEntry 两个 id
    // 都仍解析。姿势/动画不按 contentHash 去重,维持 id 规则。
    const sameHash = 'hash-ybot'
    const userCopy = model('user-ybot-random-id', 'Y Bot')
    userCopy.contentHash = sameHash
    const catalogCopy = model('seed-model-' + sameHash, 'Y Bot')
    catalogCopy.contentHash = sameHash
    // 可写源注册在后,证明优先级不看注册顺序而看 writable 身份
    const lib = new Library({
      sources: [
        fakeSource('catalog', [catalogCopy]),
        {
          ...(fakeSource('idb', [userCopy], true) as any),
          putEntry: async () => {},
          deleteEntry: async () => {},
          putBlob: async () => 'h',
          deleteBlob: async () => {},
          getRigAliases: async () => [],
          putRigAlias: async () => {},
        } as WritableLibrarySource,
      ],
    })
    const listed = await lib.listEntries('model')
    expect(listed.map((e) => e.id)).toEqual(['user-ybot-random-id'])
    // 不删数据:两个 id 都仍解析
    expect((await lib.getEntry('user-ybot-random-id'))?.name).toBe('Y Bot')
    expect((await lib.getEntry('seed-model-' + sameHash))?.name).toBe('Y Bot')
  })

  test('模型 contentHash 去重不殃及:不同 hash 并存;无 contentHash 不去重;姿势同 hash 不去重', async () => {
    const a = model('m-a')
    a.contentHash = 'h1'
    const b = model('m-b')
    b.contentHash = 'h2' // 不同 hash → 并存
    // 两个无 contentHash 的模型条目:哈希去重以 contentHash 为键,缺
    // undefined 守卫会在 'undefined' 键上相撞、第二个被静默丢弃——护栏
    // 须名副其实:两者都该照常列出。
    const noHash1 = model('m-nohash-1')
    delete (noHash1 as {contentHash?: string}).contentHash
    const noHash2 = model('m-nohash-2')
    delete (noHash2 as {contentHash?: string}).contentHash
    const pose = {
      id: 'seed-pose-x',
      kind: 'pose' as const,
      name: 'p',
      rig: 'rig-x',
      bones: {},
      createdAt: 1,
    }
    const lib = new Library({
      sources: [fakeSource('catalog', [a, b, noHash1, noHash2, pose])],
    })
    const ids = (await lib.listEntries()).map((e) => e.id).sort()
    expect(ids).toEqual([
      'm-a',
      'm-b',
      'm-nohash-1',
      'm-nohash-2',
      'seed-pose-x',
    ])
  })

  test('数据源 id 撞名(含撞内置保留名):上告 conflict 一次,先注册者胜不换源', async () => {
    // 终审 M-5:宿主源起名 'catalog'/'idb' 与内置源相撞——上告 conflict,
    // 行为维持先注册者胜(blobId 前缀路由 find 首个匹配),不抛、不换源
    const mkSource = (name: string): LibrarySource => ({
      id: 'catalog', // 撞内置保留名
      capabilities: {writable: false},
      listEntries: async () => [{id: `${name}-m`, name} as any],
      getEntry: async (id) =>
        id === `${name}-m` ? ({id: `${name}-m`, name} as any) : undefined,
      getBlobUrl: async (b) => `${name}://${b}`,
    })
    const builtin = mkSource('builtin')
    const host = mkSource('host')
    const errors: LibraryError[] = []
    const lib = new Library({
      sources: [builtin, host],
      onError: (e) => errors.push(e),
    })
    expect(errors.filter((e) => e.code === 'conflict')).toHaveLength(1)
    expect(errors[0].message).toContain('catalog')
    expect(lib.sources).toHaveLength(2) // 不换源
    // 先注册者胜:同前缀 blobId 路由仍走第一个源
    expect(await lib.getBlobUrl('catalog:x')).toBe('builtin://catalog:x')
    // 两源条目照常聚合(条目层 id 不撞就不裁)
    const ids = (await lib.listEntries()).map((e) => e.id).sort()
    expect(ids).toEqual(['builtin-m', 'host-m'])
  })

  test('getEntry 映射源已删该 id:落回探源循环解析目录条目(升级首启清理竞态)', async () => {
    // 终审 I-2:冷会话 getEntry 探源先命中可写源并回填映射(同 id 目录
    // 条目注册在后);随后启动清理把可写源里该 id 删了,映射重建前的
    // 毫秒窗口内再来 getEntry——修复前直接返回 undefined,姿势预取
    // (模块级缓存、不重试)整会话解析失败
    const stored = new Map<string, LibraryEntry>([
      ['seed-pose-x', {id: 'seed-pose-x', name: '旧播种副本'} as any],
    ])
    // 闸门挡住构造器 refreshSnapshot 的 listEntries:确定性冷映射会话
    // (否则快照先重建映射,把 seed-pose-x 指向目录,窗口就合不上了)
    let releaseList!: () => void
    const listGate = new Promise<void>((r) => (releaseList = r))
    const gatedList =
      (entries: LibraryEntry[]) => async (): Promise<LibraryEntry[]> => {
        await listGate
        return entries
      }
    const writable: WritableLibrarySource = {
      id: 'idb',
      capabilities: {writable: true},
      listEntries: gatedList([...stored.values()]),
      getEntry: async (id) => stored.get(id),
      getBlobUrl: async (b) => `idb://${b}`,
      putEntry: async (e) => void stored.set(e.id, e),
      deleteEntry: async (id) => void stored.delete(id),
      putBlob: async () => 'h',
      deleteBlob: async () => {},
      getRigAliases: async () => [],
      putRigAlias: async () => {},
    }
    const catalogEntries = [{id: 'seed-pose-x', name: '目录条目'} as any]
    const lib = new Library({
      sources: [
        writable,
        {
          id: 'catalog',
          capabilities: {writable: false},
          listEntries: gatedList(catalogEntries),
          getEntry: async (id) => catalogEntries.find((e) => e.id === id),
          getBlobUrl: async (b) => `catalog://${b}`,
        },
      ],
    })
    // 冷映射:探源先命中可写源(注册序在先)并回填映射
    expect((await lib.getEntry('seed-pose-x'))?.name).toBe('旧播种副本')
    expect(lib.getEntrySource('seed-pose-x')?.id).toBe('idb')
    // 升级首启清理删掉可写源副本(直调源自身,不发变更事件;映射仍指
    // idb、下次 listEntries 重建前的窗口)
    await writable.deleteEntry('seed-pose-x')
    const resolved = await lib.getEntry('seed-pose-x')
    expect(resolved?.name).toBe('目录条目') // 落回探源,不卡 undefined
    expect(lib.getEntrySource('seed-pose-x')?.id).toBe('catalog') // 映射照旧回填
    releaseList()
  })
})

describe('骨架族别名并集读(终审 M-4)', () => {
  // 内置默认别名的事实源 = seedAssetsManifest(与 ensureBuiltinRigAlias
  // 共用 BUILTIN_RIG_ALIASES);测试取清单首个模型的 rig
  const manifestRig = seedAssetsManifest.models[0].rig
  const readOnlySource = (entries: LibraryEntry[] = []): LibrarySource => ({
    id: 'catalog',
    capabilities: {writable: false},
    listEntries: async () => entries,
    getEntry: async (id) => entries.find((e) => e.id === id),
    getBlobUrl: async (b) => `catalog://${b}`,
  })

  test('纯查看器(无可写源)也返回内置 Mixamo 族名', async () => {
    const lib = new Library({
      sources: [readOnlySource([{id: 'p1'} as any])],
    })
    const aliases = await lib.getRigAliases()
    expect(aliases).toEqual([{rig: manifestRig, name: 'Mixamo'}])
  })

  test('可写源覆盖同名族时优先;可写源新增别名并存', async () => {
    const writable: WritableLibrarySource = {
      id: 'idb',
      capabilities: {writable: true},
      listEntries: async () => [],
      getEntry: async () => undefined,
      getBlobUrl: async (b) => `idb://${b}`,
      putEntry: async () => {},
      deleteEntry: async () => {},
      putBlob: async () => 'h',
      deleteBlob: async () => {},
      getRigAliases: async () => [
        {rig: manifestRig, name: '自定义族名'},
        {rig: 'rig-other', name: '其它'},
      ],
      putRigAlias: async () => {},
    }
    const lib = new Library({sources: [writable]})
    const aliases = await lib.getRigAliases()
    expect(aliases.find((a) => a.rig === manifestRig)?.name).toBe('自定义族名')
    expect(aliases.find((a) => a.rig === 'rig-other')?.name).toBe('其它')
    expect(aliases.filter((a) => a.rig === manifestRig)).toHaveLength(1)
  })
})

describe('blob 生命周期', () => {
  test('deleteEntryDeep: 缩略图被两个模型共享时,删一个不删 blob', async () => {
    const lib = new Library({sources: [new IndexedDBBackend()]})
    const thumbId = await lib.putBlob(new Blob(['thumb']))
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
    expect(await lib.listBlobIds()).toContain(thumbId)
  })

  test('deleteEntryDeep: 独占 blob 随条目删除', async () => {
    const lib = new Library({sources: [new IndexedDBBackend()]})
    const blobId = await lib.putBlob(new Blob(['glb']))
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
    expect(await lib.listBlobIds()).not.toContain(blobId)
  })

  test('sweepOrphanBlobs: 清掉无引用 blob,保留有引用的', async () => {
    const lib = new Library({sources: [new IndexedDBBackend()]})
    const used = await lib.putBlob(new Blob(['used']))
    const orphan = await lib.putBlob(new Blob(['orphan']))
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
    const ids = await lib.listBlobIds()
    expect(ids).toContain(used)
    expect(ids).not.toContain(orphan)
  })

  test('并发导入与孤儿清理: blob 与条目都保留', async () => {
    const lib = new Library({sources: [new IndexedDBBackend()]})
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
    expect(await lib.listBlobIds()).toContain(importedBlobId)
    const entry = await lib.getEntry('a-concurrent-sweep')
    expect(entry).toBeTruthy()
    expect(entry?.kind).toBe('animation')
  })

  test('并发删除与同哈希导入: 新条目与新 blob 都保留', async () => {
    const lib = new Library({sources: [new IndexedDBBackend()]})
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
    expect(await lib.listBlobIds()).toContain(blobId)
    expect(await lib.getEntry('m-delete-reimport')).toBeTruthy()
  })
})
