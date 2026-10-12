/*
 * @jest-environment jsdom
 */
/**
 * legacySeedCleanup 一次性迁移(2026-10-10 内置资产目录化):
 * - 可写源里的 seed-pose-* 旧播种条目删一次;目录沿用同 id,场景里的
 *   姿势引用经聚合读无缝续命(test 1 末尾断言);
 * - 用户条目与旧播种模型条目(当年导入管线随机 id,场景放置引用)保留;
 * - localStorage 标记只跑一次;jsdom 同文件跨用例共享 localStorage,
 *   逐用例清干净,防一次性标记泄漏。
 */
import {indexedDB as fakeIndexedDB} from 'fake-indexeddb'
import {IndexedDBBackend} from './indexedDBBackend'
import {Library} from './library'
import {StaticCatalogSource} from './staticCatalogSource'
import {cleanupLegacySeeds} from './legacySeedCleanup'

// jsdom 没有 indexedDB,也没有 URL.createObjectURL——都在 import 被测模块前装好
;(globalThis as any).indexedDB = fakeIndexedDB
;(URL as any).createObjectURL = jest.fn(() => 'blob:mock-url')
;(URL as any).revokeObjectURL = jest.fn()

// jsdom 沙箱没有 Node 17+ 的 structuredClone,fake-indexeddb 存取值要
// 走它克隆;本文件存的条目全是可 JSON 化的纯数据,JSON 往返即等价克隆
if (typeof globalThis.structuredClone !== 'function') {
  ;(globalThis as any).structuredClone = (v: unknown) =>
    v === undefined ? undefined : JSON.parse(JSON.stringify(v))
}

beforeEach(() => {
  // 同文件跨用例共享 jsdom localStorage:一次性标记不许在用例间泄漏
  localStorage.clear()
})

test('旧 seed-pose-* 条目静默删一次;用户条目与旧模型条目保留', async () => {
  const idb = new IndexedDBBackend({dbName: `legacy-${Math.random()}`})
  // 布置一份「旧时代」的库:播种姿势 + 用户姿势 + 旧播种模型(随机 id)
  await idb.putEntry({
    id: 'seed-pose-qbx-hands-01-base-base-l',
    kind: 'pose',
  } as any)
  await idb.putEntry({id: 'user-pose-1', kind: 'pose'} as any)
  await idb.putEntry({id: 'a1b2c3-model', kind: 'model'} as any)
  const catalog = new StaticCatalogSource({baseUrl: 'https://x/'})
  const lib = new Library({sources: [idb, catalog]})

  const r1 = await cleanupLegacySeeds(lib)
  expect(r1.removed).toBe(1)
  expect(
    await idb.getEntry('seed-pose-qbx-hands-01-base-base-l'),
  ).toBeUndefined()
  expect(await idb.getEntry('user-pose-1')).toBeDefined()
  expect(await idb.getEntry('a1b2c3-model')).toBeDefined()
  // 幂等:第二遍不再删
  expect((await cleanupLegacySeeds(lib)).removed).toBe(0)
  // 场景旧引用经聚合读存活(同 id 由目录取代):
  expect(await lib.getEntry('seed-pose-qbx-hands-01-base-base-l')).toBeDefined()
})

test('旧场景引用已不存在的模型条目:解析返回 undefined,不抛', async () => {
  const lib = new Library({
    sources: [new StaticCatalogSource({baseUrl: 'https://x/'})],
  })
  await expect(lib.getEntry('ghost-model-id')).resolves.toBeUndefined()
})
