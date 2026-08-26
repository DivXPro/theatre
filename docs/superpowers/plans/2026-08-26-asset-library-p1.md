# 资产库 P1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成系统级共享资产库：模型/动作入库（FBX 浏览器内转换去重）、库面板浏览、从库放置模型、为已放置模型切换动作。

**Architecture:** 独立 IndexedDB 库（`toybox-asset-library`，blobs/entries 两表）经 `LibraryBackend` 异步接口访问，导入管线在浏览器内完成 FBX→去动画 GLB 转换与动画提取，库面板（三个 tab 中的模型/动作两个）挂在 camera 场景左侧，已放置模型通过 theatre 属性引用库条目 id。

**Tech Stack:** three.js（FBXLoader/GLTFLoader/GLTFExporter，均来自 three-stdlib）、IndexedDB、React、jest（根配置，jest-esbuild）。

**Spec:** `docs/superpowers/specs/2026-08-26-asset-library-design.md`

## Global Constraints

- 测试从**仓库根**运行：`yarn jest <test 文件路径>`（根 jest.config 只匹配 `packages/*/src/**/*.test.ts`，**测试文件必须是 `.test.ts`，不能是 `.tsx`**）。
- 类型检查：`cd packages/playground && yarn typecheck`。
- 提交信息用中文 conventional commit，末尾带 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- jest 用 jest-esbuild，**不提升 jest.mock**——需要 mock 时用 `jest.doMock` + `jest.resetModules` + 运行时 `require`；能依赖注入就依赖注入，不 mock。
- fake-indexeddb 对无效 key 静默宽容（真实 IDB 会抛错）：backend 测试只走正常路径，浏览器验证任务里必须覆盖真实 IndexedDB 行为。
- 浏览器验证用 Playwright MCP；文件选择器**只能**用 `browser_file_upload` 应答（run_code 里应答会堆积幻影选择器阻塞后续工具）。验证用的 FBX：`/Users/huhui/Projects/theatre/.playwright-mcp/test-cube.fbx`。
- 开发服务器验证完必须关闭（TaskStop）。
- 所有新代码放在 `packages/playground/src/shared/camera/assetLibrary/`（除非任务另注明），注释用中文，风格对齐 `PlacementManager.tsx`。
- 工作分支：`feat/playground-fbx-placement`。

## 文件结构

新建 `packages/playground/src/shared/camera/assetLibrary/`：

| 文件 | 职责 |
|---|---|
| `hash.ts` | FNV-1a 64 位哈希（内容去重、骨架族 id） |
| `types.ts` | 条目类型、`LibraryBackend` 接口 |
| `rig.ts` | 骨骼名收集、骨架族 id、网格统计 |
| `indexedDBBackend.ts` | IndexedDB 实现（blobs/entries 两表） |
| `library.ts` | Library 封装（变更事件）+ React hooks + 单例 |
| `classify.ts` | 导入类型识别、姿势 JSON 校验 |
| `exportGLB.ts` | 模型剥动画导出 GLB、纯动画 GLB 导出、骨骼树克隆 |
| `importPipeline.ts` | planImport（识别+去重）/ executeImport（落库） |
| `thumbnail.ts` | 离屏渲染缩略图 |
| `AssetLibraryPanel.tsx` | 库面板 UI（tab/网格/导入/确认清单/右键菜单） |

修改：`PlacementManager.tsx`（库条目作为放置来源、PlacedModel 动作/姿势属性）、`App.tsx`（挂面板、按钮行为、选中模型联动过滤）。

---

### Task 1: 哈希与骨架族工具

**Files:**
- Create: `packages/playground/src/shared/camera/assetLibrary/hash.ts`
- Create: `packages/playground/src/shared/camera/assetLibrary/rig.ts`
- Test: `packages/playground/src/shared/camera/assetLibrary/rig.test.ts`

**Interfaces:**
- Produces: `hashBytes(data: Uint8Array): string`、`hashString(s: string): string`、`collectBoneNames(root: Object3D): string[]`（排序后）、`rigIdOf(root: Object3D): string`（无骨骼返回 `'static'`，否则 `'rig-<hash>'`）、`meshStats(root: Object3D): {meshCount: number; vertexCount: number}`。后续所有任务依赖这些。

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/assetLibrary/rig.test.ts
import {Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial} from 'three'
import {hashBytes, hashString} from './hash'
import {collectBoneNames, meshStats, rigIdOf} from './rig'

function makeRig(...names: string[]): Group {
  const root = new Group()
  let parent: Bone | undefined
  for (const name of names) {
    const bone = new Bone()
    bone.name = name
    if (parent) parent.add(bone)
    else root.add(bone)
    parent = bone
  }
  return root
}

describe('hashBytes', () => {
  it('同样输入同样输出,不同输入不同输出', () => {
    const a = new Uint8Array([1, 2, 3])
    expect(hashBytes(a)).toBe(hashBytes(new Uint8Array([1, 2, 3])))
    expect(hashBytes(a)).not.toBe(hashBytes(new Uint8Array([1, 2, 4])))
    expect(hashBytes(a)).toMatch(/^[0-9a-f]{16}$/)
  })
  it('hashString 对字符串稳定', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})

describe('rigIdOf', () => {
  it('同一套骨骼名(顺序不同)得到同一个骨架族 id', () => {
    expect(rigIdOf(makeRig('Hips', 'Spine', 'Head'))).toBe(
      rigIdOf(makeRig('Head', 'Hips', 'Spine')),
    )
  })
  it('不同骨骼名得到不同 id', () => {
    expect(rigIdOf(makeRig('Hips'))).not.toBe(rigIdOf(makeRig('Legs')))
  })
  it('没有骨骼返回 static', () => {
    const g = new Group()
    g.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
    expect(rigIdOf(g)).toBe('static')
  })
})

describe('meshStats', () => {
  it('统计网格数和顶点数', () => {
    const g = makeRig('Hips')
    g.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
    g.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
    expect(meshStats(g)).toEqual({meshCount: 2, vertexCount: 48})
  })
})

describe('collectBoneNames', () => {
  it('返回排序后的骨骼名', () => {
    expect(collectBoneNames(makeRig('b', 'a', 'c'))).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/assetLibrary/rig.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 hash.ts**

```ts
// packages/playground/src/shared/camera/assetLibrary/hash.ts
/**
 * FNV-1a 64 位哈希:非加密,只用于内容去重和骨架族 id。
 * 同步、无依赖,浏览器和 jest 都能跑。
 */
export function hashBytes(data: Uint8Array): string {
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < data.length; i++) {
    h ^= BigInt(data[i])
    h = (h * prime) & mask
  }
  return h.toString(16).padStart(16, '0')
}

export function hashString(s: string): string {
  return hashBytes(new TextEncoder().encode(s))
}
```

- [ ] **Step 4: 实现 rig.ts**

```ts
// packages/playground/src/shared/camera/assetLibrary/rig.ts
import {Bone, Mesh} from 'three'
import type {Object3D} from 'three'
import {hashString} from './hash'

/** 收集整棵树的骨骼名,排序后返回(排序保证同名集合同结果) */
export function collectBoneNames(root: Object3D): string[] {
  const names: string[] = []
  root.traverse((obj) => {
    if ((obj as Bone).isBone) names.push(obj.name)
  })
  return names.sort()
}

/**
 * 骨架族 id:骨骼名集合的哈希。同一套骨骼命名(如都是 Mixamo 导出)
 * 的模型自动同族,姿势/动作在同族内通用;无骨骼的模型记 'static'。
 */
export function rigIdOf(root: Object3D): string {
  const names = collectBoneNames(root)
  if (names.length === 0) return 'static'
  return 'rig-' + hashString(names.join(''))
}

/** 网格数量与顶点总数:导入分类和"高度相似"去重比对用 */
export function meshStats(root: Object3D): {
  meshCount: number
  vertexCount: number
} {
  let meshCount = 0
  let vertexCount = 0
  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (mesh.isMesh) {
      meshCount++
      vertexCount += mesh.geometry?.attributes?.position?.count ?? 0
    }
  })
  return {meshCount, vertexCount}
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/assetLibrary/rig.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 6: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/{hash,rig,rig.test}.ts
git commit -m "feat(playground): 资产库哈希与骨架族工具

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: LibraryBackend 接口与 IndexedDB 实现

**Files:**
- Create: `packages/playground/src/shared/camera/assetLibrary/types.ts`
- Create: `packages/playground/src/shared/camera/assetLibrary/indexedDBBackend.ts`
- Test: `packages/playground/src/shared/camera/assetLibrary/indexedDBBackend.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `hashBytes`。
- Produces: `LibraryEntry`/`ModelEntry`/`PoseEntry`/`AnimationEntry`/`EntryKind` 类型；`LibraryBackend` 接口；`IndexedDBBackend implements LibraryBackend`。Task 3/6/8/9/10 全部依赖。

- [ ] **Step 1: 写类型 types.ts**

```ts
// packages/playground/src/shared/camera/assetLibrary/types.ts
/** 骨架族 id(rigIdOf 生成);无骨架模型为 'static' */
export type RigId = string

export type EntryKind = 'model' | 'pose' | 'animation'

export type ModelEntry = {
  id: string
  kind: 'model'
  name: string
  rig: RigId
  blobId: string
  contentHash: string
  thumbnailId?: string
  boneCount: number
  vertexCount: number
  createdAt: number
}

export type PoseEntry = {
  id: string
  kind: 'pose'
  name: string
  rig: RigId
  bones: Record<
    string,
    {
      rotation?: [number, number, number, number]
      position?: [number, number, number]
    }
  >
  createdAt: number
}

export type AnimationEntry = {
  id: string
  kind: 'animation'
  name: string
  rig: RigId
  blobId: string
  contentHash: string
  duration: number
  createdAt: number
}

export type LibraryEntry = ModelEntry | PoseEntry | AnimationEntry

/**
 * 库的存储适配接口:playground 用 IndexedDB 实现,应用层可换 HTTP
 * 实现。大二进制以 URL 形式暴露(本地 blob: / 远程 CDN 地址),
 * blobId = 内容哈希,天然支持去重。
 */
export interface LibraryBackend {
  listEntries(kind?: EntryKind): Promise<LibraryEntry[]>
  getEntry(id: string): Promise<LibraryEntry | undefined>
  putEntry(entry: LibraryEntry): Promise<void>
  deleteEntry(id: string): Promise<void>
  putBlob(data: Blob): Promise<string>
  getBlobUrl(blobId: string): Promise<string>
  deleteBlob(blobId: string): Promise<void>
}
```

- [ ] **Step 2: 写失败测试**

```ts
// packages/playground/src/shared/camera/assetLibrary/indexedDBBackend.test.ts
import {indexedDB as fakeIndexedDB} from 'fake-indexeddb'
import type {ModelEntry} from './types'

// jsdom 没有 indexedDB,也没有 URL.createObjectURL——都在 import 被测模块前装好
;(globalThis as any).indexedDB = fakeIndexedDB
;(URL as any).createObjectURL = jest.fn(() => 'blob:mock-url')
;(URL as any).revokeObjectURL = jest.fn()

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {IndexedDBBackend} = require('./indexedDBBackend') as typeof import('./indexedDBBackend')

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
    await backend.putEntry({...makeModel('m2'), kind: 'animation', duration: 1} as any)
    expect(await backend.getEntry('m1')).toMatchObject({id: 'm1', kind: 'model'})
    expect((await backend.listEntries()).length).toBe(2)
    expect((await backend.listEntries('model')).map((e: any) => e.id)).toEqual(['m1'])
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
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/assetLibrary/indexedDBBackend.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 indexedDBBackend.ts**

```ts
// packages/playground/src/shared/camera/assetLibrary/indexedDBBackend.ts
import {hashBytes} from './hash'
import type {EntryKind, LibraryBackend, LibraryEntry} from './types'

const DB_NAME = 'toybox-asset-library'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries', {keyPath: 'id'})
        store.createIndex('kind', 'kind', {unique: false})
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** IndexedDB 实现的库后端:blobs 表存大二进制,entries 表存元数据 */
export class IndexedDBBackend implements LibraryBackend {
  private dbPromise: Promise<IDBDatabase> | undefined
  private urlCache = new Map<string, string>()

  private db(): Promise<IDBDatabase> {
    return (this.dbPromise ??= openDB())
  }

  async listEntries(kind?: EntryKind): Promise<LibraryEntry[]> {
    const db = await this.db()
    const store = db.transaction('entries', 'readonly').objectStore('entries')
    const req = kind
      ? store.index('kind').getAll(kind)
      : store.getAll()
    return (await requestToPromise(req)) as LibraryEntry[]
  }

  async getEntry(id: string): Promise<LibraryEntry | undefined> {
    const db = await this.db()
    const req = db.transaction('entries', 'readonly').objectStore('entries').get(id)
    return (await requestToPromise(req)) as LibraryEntry | undefined
  }

  async putEntry(entry: LibraryEntry): Promise<void> {
    const db = await this.db()
    const req = db.transaction('entries', 'readwrite').objectStore('entries').put(entry)
    await requestToPromise(req)
  }

  async deleteEntry(id: string): Promise<void> {
    const db = await this.db()
    const req = db.transaction('entries', 'readwrite').objectStore('entries').delete(id)
    await requestToPromise(req)
  }

  async putBlob(data: Blob): Promise<string> {
    const id = hashBytes(new Uint8Array(await data.arrayBuffer()))
    const db = await this.db()
    const req = db.transaction('blobs', 'readwrite').objectStore('blobs').put(data, id)
    await requestToPromise(req)
    return id
  }

  async getBlobUrl(blobId: string): Promise<string> {
    const cached = this.urlCache.get(blobId)
    if (cached) return cached
    const db = await this.db()
    const req = db.transaction('blobs', 'readonly').objectStore('blobs').get(blobId)
    const data = (await requestToPromise(req)) as Blob | undefined
    if (!data) throw new Error(`资产数据不存在: ${blobId}`)
    const url = URL.createObjectURL(data)
    this.urlCache.set(blobId, url)
    return url
  }

  async deleteBlob(blobId: string): Promise<void> {
    const cached = this.urlCache.get(blobId)
    if (cached) {
      URL.revokeObjectURL(cached)
      this.urlCache.delete(blobId)
    }
    const db = await this.db()
    const req = db.transaction('blobs', 'readwrite').objectStore('blobs').delete(blobId)
    await requestToPromise(req)
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/assetLibrary/indexedDBBackend.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/{types,indexedDBBackend,indexedDBBackend.test}.ts
git commit -m "feat(playground): 资产库存储接口与 IndexedDB 实现

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Library 封装与 React hooks

**Files:**
- Create: `packages/playground/src/shared/camera/assetLibrary/library.ts`
- Test: `packages/playground/src/shared/camera/assetLibrary/library.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `LibraryBackend`/`IndexedDBBackend`/`LibraryEntry`。
- Produces: `Library` 类（`backend` 直读 + `putEntry/deleteEntry/renameEntry` 带变更事件 + `subscribe(fn): () => void`）；`getLibrary(): Library`（单例）；`useLibraryEntries(kind?: EntryKind): LibraryEntry[]`。Task 6/8/9/10 依赖。

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/assetLibrary/library.test.ts
import {Library} from './library'
import type {LibraryBackend, LibraryEntry, ModelEntry} from './types'

function memoryBackend(): LibraryBackend & {entries: Map<string, LibraryEntry>} {
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
  id, kind: 'model', name, rig: 'rig-x', blobId: 'b', contentHash: 'h',
  boneCount: 1, vertexCount: 1, createdAt: 1,
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/assetLibrary/library.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 library.ts**

```ts
// packages/playground/src/shared/camera/assetLibrary/library.ts
import {useEffect, useState} from 'react'
import {IndexedDBBackend} from './indexedDBBackend'
import type {EntryKind, LibraryBackend, LibraryEntry} from './types'

/**
 * 库的对外门面:backend 直读,写操作在 backend 之上加变更事件,
 * React 侧用 useLibraryEntries 订阅刷新。换远程后端时只需在
 * getLibrary 里注入不同 LibraryBackend 实现。
 */
export class Library {
  private listeners = new Set<() => void>()

  constructor(readonly backend: LibraryBackend) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit() {
    this.listeners.forEach((fn) => fn())
  }

  async putEntry(entry: LibraryEntry): Promise<void> {
    await this.backend.putEntry(entry)
    this.emit()
  }

  async deleteEntry(id: string): Promise<void> {
    await this.backend.deleteEntry(id)
    this.emit()
  }

  async renameEntry(id: string, name: string): Promise<void> {
    const entry = await this.backend.getEntry(id)
    if (!entry) return
    await this.backend.putEntry({...entry, name})
    this.emit()
  }
}

let singleton: Library | undefined

/** 库单例:playground 固定用 IndexedDB 实现 */
export function getLibrary(): Library {
  return (singleton ??= new Library(new IndexedDBBackend()))
}

/** 订阅式读库条目:导入/删除/重命名后自动刷新 */
export function useLibraryEntries(kind?: EntryKind): LibraryEntry[] {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  useEffect(() => {
    let alive = true
    const reload = () => {
      void getLibrary()
        .backend.listEntries(kind)
        .then((list) => {
          if (alive) setEntries(list)
        })
    }
    reload()
    const unsub = getLibrary().subscribe(reload)
    return () => {
      alive = false
      unsub()
    }
  }, [kind])
  return entries
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/assetLibrary/library.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/{library,library.test}.ts
git commit -m "feat(playground): 资产库门面与订阅式 hooks

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 导入类型识别与姿势 JSON 校验

**Files:**
- Create: `packages/playground/src/shared/camera/assetLibrary/classify.ts`
- Test: `packages/playground/src/shared/camera/assetLibrary/classify.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `collectBoneNames`/`meshStats`，Task 2 的 `PoseEntry`。
- Produces: `ModelClass = 'model' | 'static-model' | 'animations-only' | 'unusable'`；`classifyModel(root, animations): ModelClass`；`validatePoseJson(json: unknown): {rig: string; bones: PoseEntry['bones']} | null`。Task 6 依赖。

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/assetLibrary/classify.test.ts
import {AnimationClip, Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial} from 'three'
import {classifyModel, validatePoseJson} from './classify'

function withBone(root: Group): Group {
  const b = new Bone()
  b.name = 'Hips'
  root.add(b)
  return root
}
function withMesh(root: Group): Group {
  root.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
  return root
}
const clip = new AnimationClip('idle', 1, [])

describe('classifyModel', () => {
  it('网格+骨架 = model', () => {
    expect(classifyModel(withMesh(withBone(new Group())), [])).toBe('model')
  })
  it('网格、无骨架 = static-model', () => {
    expect(classifyModel(withMesh(new Group()), [])).toBe('static-model')
  })
  it('无网格、有骨架+动画 = animations-only', () => {
    expect(classifyModel(withBone(new Group()), [clip])).toBe('animations-only')
  })
  it('无网格无动画/有骨架无动画/有网格空组 = unusable', () => {
    expect(classifyModel(new Group(), [])).toBe('unusable')
    expect(classifyModel(withBone(new Group()), [])).toBe('unusable')
  })
})

describe('validatePoseJson', () => {
  it('合法姿势返回 rig 和 bones', () => {
    const out = validatePoseJson({
      rig: 'rig-x',
      bones: {Hips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]}},
    })
    expect(out?.rig).toBe('rig-x')
    expect(Object.keys(out?.bones ?? {})).toEqual(['Hips'])
  })
  it('缺 bones/旋转不是四元数/位置不是三元组 = null', () => {
    expect(validatePoseJson({})).toBeNull()
    expect(validatePoseJson({bones: {Hips: {rotation: [0, 0, 1]}}})).toBeNull()
    expect(validatePoseJson({bones: {Hips: {position: [0, 1]}}})).toBeNull()
    expect(validatePoseJson('x')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/assetLibrary/classify.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 classify.ts**

```ts
// packages/playground/src/shared/camera/assetLibrary/classify.ts
import type {AnimationClip, Object3D} from 'three'
import {collectBoneNames, meshStats} from './rig'
import type {PoseEntry} from './types'

export type ModelClass =
  | 'model' // 网格+骨架(自带动画与否都算)
  | 'static-model' // 网格、无骨架
  | 'animations-only' // 无网格、有骨架+动画(纯动作文件)
  | 'unusable'

/** 按内容识别导入文件的类型,决定生成哪些库条目 */
export function classifyModel(
  root: Object3D,
  animations: AnimationClip[],
): ModelClass {
  const {meshCount} = meshStats(root)
  const boneCount = collectBoneNames(root).length
  if (meshCount > 0) return boneCount > 0 ? 'model' : 'static-model'
  if (boneCount > 0 && animations.length > 0) return 'animations-only'
  return 'unusable'
}

/**
 * 校验 .pose.json 文件内容:必须是 {rig, bones:{骨骼名:{rotation?,position?}}},
 * rotation 为四元数(4 个数),position 为三元组。合法返回内容,否则 null。
 */
export function validatePoseJson(
  json: unknown,
): {rig: string; bones: PoseEntry['bones']} | null {
  if (!json || typeof json !== 'object') return null
  const {rig, bones} = json as {rig?: unknown; bones?: unknown}
  if (!bones || typeof bones !== 'object') return null
  for (const [name, v] of Object.entries(bones as Record<string, unknown>)) {
    if (!name) return null
    const {rotation, position} = v as {rotation?: unknown; position?: unknown}
    if (
      rotation !== undefined &&
      (!Array.isArray(rotation) ||
        rotation.length !== 4 ||
        !rotation.every((n) => Number.isFinite(n)))
    ) {
      return null
    }
    if (
      position !== undefined &&
      (!Array.isArray(position) ||
        position.length !== 3 ||
        !position.every((n) => Number.isFinite(n)))
    ) {
      return null
    }
  }
  return {
    rig: typeof rig === 'string' ? rig : 'unknown',
    bones: bones as PoseEntry['bones'],
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/assetLibrary/classify.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/{classify,classify.test}.ts
git commit -m "feat(playground): 资产库导入类型识别与姿势校验

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: GLB 导出（模型剥动画 / 纯动画 GLB）

**Files:**
- Create: `packages/playground/src/shared/camera/assetLibrary/exportGLB.ts`
- Test: `packages/playground/src/shared/camera/assetLibrary/exportGLB.test.ts`

**Interfaces:**
- Consumes: 无（纯 three）。
- Produces: `exportModelGLB(root: Object3D): Promise<ArrayBuffer>`（剥动画）；`exportAnimationGLB(root: Object3D, clip: AnimationClip): Promise<ArrayBuffer>`（骨骼树克隆 + 单条动画）；`cloneBoneTree(root: Object3D): Group`（可单测的纯函数）。Task 6 依赖前两个。

说明：GLTFExporter 在 jest 环境不可用（依赖 FileReader/canvas），所以单测只覆盖纯函数 `cloneBoneTree`；两个导出函数在 Task 8 的浏览器验证里覆盖。

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/assetLibrary/exportGLB.test.ts
import {Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial} from 'three'
import {cloneBoneTree} from './exportGLB'

describe('cloneBoneTree', () => {
  it('只保留骨骼节点(名字/变换),剔除网格', () => {
    const root = new Group()
    const hips = new Bone()
    hips.name = 'Hips'
    hips.position.set(0, 1, 0)
    const spine = new Bone()
    spine.name = 'Spine'
    hips.add(spine)
    const prop = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
    prop.name = 'SwordMesh'
    spine.add(prop) // 挂在骨骼上的网格不应进动画 GLB
    root.add(hips)
    root.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))

    const clone = cloneBoneTree(root)
    const names: string[] = []
    clone.traverse((o) => names.push(`${o.name}:${o.type}`))
    expect(names).toEqual(['AnimationRig:Group', 'Hips:Bone', 'Spine:Bone'])
    const hipsClone = clone.children[0]
    expect(hipsClone.position.y).toBe(1)
    expect(hipsClone).not.toBe(hips) // 是克隆不是引用
  })

  it('多根骨骼并列保留', () => {
    const root = new Group()
    for (const name of ['L', 'R']) {
      const b = new Bone()
      b.name = name
      root.add(b)
    }
    expect(cloneBoneTree(root).children.map((c) => c.name)).toEqual(['L', 'R'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/assetLibrary/exportGLB.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 exportGLB.ts**

```ts
// packages/playground/src/shared/camera/assetLibrary/exportGLB.ts
import {Bone, Group} from 'three'
import type {AnimationClip, Object3D} from 'three'
import {GLTFExporter} from 'three-stdlib'

/**
 * 克隆纯骨骼层级(容器名 AnimationRig):动画轨道按骨骼名寻址,
 * 纯动画 GLB 只需要这棵带名字的骨骼树,网格一律剔除。
 */
export function cloneBoneTree(root: Object3D): Group {
  const container = new Group()
  container.name = 'AnimationRig'
  const cloneBone = (bone: Bone): Bone => {
    const copy = new Bone()
    copy.name = bone.name
    copy.position.copy(bone.position)
    copy.quaternion.copy(bone.quaternion)
    copy.scale.copy(bone.scale)
    for (const child of bone.children) {
      if ((child as Bone).isBone) copy.add(cloneBone(child as Bone))
    }
    return copy
  }
  root.traverse((obj) => {
    if ((obj as Bone).isBone && !(obj.parent as Bone)?.isBone) {
      container.add(cloneBone(obj as Bone))
    }
  })
  return container
}

function exportGLB(
  root: Object3D,
  animations: AnimationClip[],
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (result) => resolve(result as ArrayBuffer),
      (err) => reject(err),
      {binary: true, animations},
    )
  })
}

/** 模型入库:剥掉动画,只留网格+骨架+绑定姿势 */
export function exportModelGLB(root: Object3D): Promise<ArrayBuffer> {
  return exportGLB(root, [])
}

/** 动作入库:骨骼树克隆 + 单条动画,不含网格 */
export function exportAnimationGLB(
  root: Object3D,
  clip: AnimationClip,
): Promise<ArrayBuffer> {
  return exportGLB(cloneBoneTree(root), [clip])
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/assetLibrary/exportGLB.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/{exportGLB,exportGLB.test}.ts
git commit -m "feat(playground): 模型/纯动画 GLB 导出

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 导入管线（识别 + 两层去重 + 落库）

**Files:**
- Create: `packages/playground/src/shared/camera/assetLibrary/importPipeline.ts`
- Test: `packages/playground/src/shared/camera/assetLibrary/importPipeline.test.ts`

**Interfaces:**
- Consumes: Task 1-5 全部。
- Produces: `ImportItem`/`SimilarMatch`/`ImportPlan` 类型；`ImportDeps = {load, exportModel, exportAnimation}`（依赖注入,测试用假的,UI 用真的）；`planImport(files, backend, deps): Promise<ImportPlan>`；`executeImport(plan, choices, library): Promise<void>`（choices 与 plan.similar 一一对应,'reuse' 丢弃对应 model 项）。Task 8 依赖。

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/assetLibrary/importPipeline.test.ts
import {AnimationClip, Bone, Group, BoxGeometry, Mesh, MeshBasicMaterial} from 'three'
import {executeImport, planImport} from './importPipeline'
import type {ImportDeps} from './importPipeline'
import {Library} from './library'
import type {LibraryBackend, LibraryEntry, ModelEntry} from './types'

function skinnedModel(...bones: string[]): Group {
  const root = new Group()
  for (const name of bones) {
    const b = new Bone()
    b.name = name
    root.add(b)
  }
  root.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
  return root
}
const clip = (name: string) => new AnimationClip(name, 1.5, [])
const file = (name: string, content = 'x') => new File([content], name)

function depsFor(map: Record<string, {root: Group; animations: AnimationClip[]}>): ImportDeps {
  return {
    load: async (f) => {
      const hit = map[f.name]
      if (!hit) throw new Error('无法解析')
      return hit
    },
    exportModel: async () => new TextEncoder().encode('model-glb').buffer,
    exportAnimation: async (_root, c) =>
      new TextEncoder().encode('anim:' + c.name).buffer,
  }
}

function memoryBackend(existing: LibraryEntry[] = []): LibraryBackend {
  const entries = new Map(existing.map((e) => [e.id, e]))
  return {
    listEntries: async (kind) =>
      [...entries.values()].filter((e) => !kind || e.kind === kind),
    getEntry: async (id) => entries.get(id),
    putEntry: async (e) => void entries.set(e.id, e),
    deleteEntry: async (id) => void entries.delete(id),
    putBlob: async () => 'blob-' + Math.random().toString(36).slice(2),
    getBlobUrl: async () => 'blob:x',
    deleteBlob: async () => {},
  }
}

describe('planImport', () => {
  it('模型文件:1 模型 + 动画逐个提取', async () => {
    const plan = await planImport(
      [file('hero.fbx')],
      memoryBackend(),
      depsFor({'hero.fbx': {root: skinnedModel('Hips'), animations: [clip('idle'), clip('run')]}),
    )
    expect(plan.items.map((i) => i.type)).toEqual(['model', 'animation', 'animation'])
    expect(plan.items[1]).toMatchObject({name: 'idle', duration: 1.5})
    expect(plan.summary).toContain('模型 ×1')
    expect(plan.summary).toContain('动作 ×2')
  })

  it('纯动画文件:只出动作,不出模型', async () => {
    const root = new Group()
    const b = new Bone()
    b.name = 'Hips'
    root.add(b)
    const plan = await planImport(
      [file('walk.fbx')],
      memoryBackend(),
      depsFor({'walk.fbx': {root, animations: [clip('walk')]}}),
    )
    expect(plan.items.map((i) => i.type)).toEqual(['animation'])
  })

  it('完全相同的模型已在库中:跳过模型,只收新动作', async () => {
    // 第一层去重:contentHash 命中。假导出器输出固定字节,先算出会命中的 hash
    const probe = await planImport(
      [file('a.fbx')],
      memoryBackend(),
      depsFor({'a.fbx': {root: skinnedModel('Hips'), animations: []}}),
    )
    const hash = (probe.items[0] as any).contentHash
    const existing: ModelEntry = {
      id: 'm0', kind: 'model', name: '角色A', rig: 'rig-x', blobId: 'b',
      contentHash: hash, boneCount: 1, vertexCount: 24, createdAt: 1,
    }
    const plan = await planImport(
      [file('b.fbx')],
      memoryBackend([existing]),
      depsFor({'b.fbx': {root: skinnedModel('Hips'), animations: [clip('jump')]}),
    )
    expect(plan.items.map((i) => i.type)).toEqual(['animation'])
  })

  it('哈希不同但同族同结构:记入 similar 由用户定', async () => {
    const existing: ModelEntry = {
      id: 'm0', kind: 'model', name: '角色A', rig: 'rig-x', blobId: 'b',
      contentHash: 'different', boneCount: 1, vertexCount: 24, createdAt: 1,
    }
    // 让 rig 相同:需要真实骨骼名一致——rigIdOf 是真算的,existing.rig 要对上
    const probePlan = await planImport(
      [file('c.fbx')],
      memoryBackend(),
      depsFor({'c.fbx': {root: skinnedModel('Hips'), animations: []}}),
    )
    existing.rig = (probePlan.items[0] as any).rig
    const plan = await planImport(
      [file('c.fbx')],
      memoryBackend([{...existing, contentHash: 'different'}]),
      depsFor({'c.fbx': {root: skinnedModel('Hips'), animations: []}}),
    )
    expect(plan.similar).toEqual([
      {index: 0, existingName: '角色A', newName: 'c'},
    ])
  })

  it('姿势 JSON / 无法识别 / 解析失败', async () => {
    const pose = new File(
      [JSON.stringify({rig: 'rig-x', bones: {Hips: {rotation: [0, 0, 0, 1]}}})],
      '弓步.pose.json',
    )
    const plan = await planImport(
      [pose, file('empty.fbx'), file('bad.fbx')],
      memoryBackend(),
      depsFor({'empty.fbx': {root: new Group(), animations: []}}),
    )
    expect(plan.items.map((i) => i.type)).toEqual(['pose', 'skip', 'skip'])
    expect(plan.items[0]).toMatchObject({name: '弓步', rig: 'rig-x'})
  })
})

describe('executeImport', () => {
  it('按 choices 丢弃 similar 模型,其余落库并触发事件', async () => {
    const backend = memoryBackend()
    const lib = new Library(backend)
    let events = 0
    lib.subscribe(() => events++)
    const plan = await planImport(
      [file('hero.fbx')],
      backend,
      depsFor({'hero.fbx': {root: skinnedModel('Hips'), animations: [clip('idle')]}}),
    )
    plan.similar.push({index: 0, existingName: '旧', newName: 'hero'})
    await executeImport(plan, ['reuse'], lib)
    const entries = await backend.listEntries()
    expect(entries.map((e) => e.kind)).toEqual(['animation']) // 模型被 reuse 丢弃
    expect(events).toBe(1)
  })

  it("choices 选 keep 时模型照常入库", async () => {
    const backend = memoryBackend()
    const lib = new Library(backend)
    const plan = await planImport(
      [file('hero.fbx')],
      backend,
      depsFor({'hero.fbx': {root: skinnedModel('Hips'), animations: []}}),
    )
    plan.similar.push({index: 0, existingName: '旧', newName: 'hero'})
    await executeImport(plan, ['keep'], lib)
    expect((await backend.listEntries('model')).length).toBe(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/assetLibrary/importPipeline.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 importPipeline.ts**

```ts
// packages/playground/src/shared/camera/assetLibrary/importPipeline.ts
import type {AnimationClip, Group, Object3D} from 'three'
import {classifyModel, validatePoseJson} from './classify'
import {exportAnimationGLB, exportModelGLB} from './exportGLB'
import {hashBytes} from './hash'
import type {Library} from './library'
import {collectBoneNames, meshStats, rigIdOf} from './rig'
import type {
  AnimationEntry,
  LibraryBackend,
  ModelEntry,
  PoseEntry,
} from './types'

export type LoadedModel = {root: Group; animations: AnimationClip[]}

/** 依赖注入:测试给假实现,UI 给 FBXLoader/GLTFLoader + GLTFExporter 真实现 */
export type ImportDeps = {
  load: (file: File) => Promise<LoadedModel>
  exportModel: (root: Object3D) => Promise<ArrayBuffer>
  exportAnimation: (root: Object3D, clip: AnimationClip) => Promise<ArrayBuffer>
}

export const realImportDeps: () => ImportDeps = () => ({
  load: defaultLoad,
  exportModel: exportModelGLB,
  exportAnimation: exportAnimationGLB,
})

async function defaultLoad(file: File): Promise<LoadedModel> {
  const {FBXLoader, GLTFLoader} = await import('three-stdlib')
  const url = URL.createObjectURL(file)
  try {
    if (/\.glb$|\.gltf$/i.test(file.name)) {
      const gltf = await new GLTFLoader().loadAsync(url)
      return {root: gltf.scene as Group, animations: gltf.animations}
    }
    const root = await new FBXLoader().loadAsync(url)
    return {root: root as Group, animations: root.animations}
  } finally {
    URL.revokeObjectURL(url)
  }
}

export type ImportItem =
  | {
      type: 'model'
      name: string
      rig: string
      contentHash: string
      boneCount: number
      vertexCount: number
      glb: ArrayBuffer
    }
  | {
      type: 'animation'
      name: string
      rig: string
      contentHash: string
      duration: number
      glb: ArrayBuffer
    }
  | {type: 'pose'; name: string; rig: string; bones: PoseEntry['bones']}
  | {type: 'skip'; name: string; reason: string}

/** 哈希不同但同族同结构的模型,入库前要用户选 reuse/keep */
export type SimilarMatch = {
  index: number // items 里对应 model 项的下标
  existingName: string
  newName: string
}

export type ImportPlan = {
  items: ImportItem[]
  similar: SimilarMatch[]
  summary: string
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/\.pose$/, '')
}

function summarize(items: ImportItem[]): string {
  const count = (t: ImportItem['type']) => items.filter((i) => i.type === t).length
  const parts: string[] = []
  if (count('model')) parts.push(`模型 ×${count('model')}`)
  if (count('animation')) parts.push(`动作 ×${count('animation')}`)
  if (count('pose')) parts.push(`姿势 ×${count('pose')}`)
  if (count('skip')) parts.push(`跳过 ×${count('skip')}`)
  return parts.length ? `识别为:${parts.join(' + ')}` : '没有可导入的内容'
}

function newId(): string {
  return 'lib-' + Math.random().toString(36).slice(2, 10)
}

/**
 * 识别 + 两层去重,生成导入计划(不落库)。
 * 第一层:剥动画 GLB 的内容哈希命中 → 跳过模型,仅收新动作;
 * 第二层:哈希不同但同族 + 顶点/骨骼数相同 → 记入 similar 交给用户。
 */
export async function planImport(
  files: File[],
  backend: LibraryBackend,
  deps: ImportDeps,
): Promise<ImportPlan> {
  const existing = await backend.listEntries()
  const items: ImportItem[] = []
  const similar: SimilarMatch[] = []

  for (const file of files) {
    if (file.name.endsWith('.pose.json')) {
      let parsed: ReturnType<typeof validatePoseJson> = null
      try {
        parsed = validatePoseJson(JSON.parse(await file.text()))
      } catch {
        parsed = null
      }
      if (!parsed) {
        items.push({type: 'skip', name: file.name, reason: '姿势 JSON 格式不正确'})
      } else {
        items.push({type: 'pose', name: baseName(file.name), rig: parsed.rig, bones: parsed.bones})
      }
      continue
    }

    let loaded: LoadedModel
    try {
      loaded = await deps.load(file)
    } catch {
      items.push({type: 'skip', name: file.name, reason: '文件解析失败'})
      continue
    }
    const cls = classifyModel(loaded.root, loaded.animations)
    if (cls === 'unusable') {
      items.push({type: 'skip', name: file.name, reason: '无网格也无动画,无法识别'})
      continue
    }
    const rig = rigIdOf(loaded.root)

    if (cls !== 'animations-only') {
      const glb = await deps.exportModel(loaded.root)
      const contentHash = hashBytes(new Uint8Array(glb))
      const dup = existing.find(
        (e): e is ModelEntry => e.kind === 'model' && e.contentHash === contentHash,
      )
      if (!dup) {
        const stats = meshStats(loaded.root)
        const boneCount = collectBoneNames(loaded.root).length
        const index =
          items.push({
            type: 'model',
            name: baseName(file.name),
            rig,
            contentHash,
            boneCount,
            vertexCount: stats.vertexCount,
            glb,
          }) - 1
        const hit = existing.find(
          (e): e is ModelEntry =>
            e.kind === 'model' &&
            e.rig === rig &&
            e.vertexCount === stats.vertexCount &&
            e.boneCount === boneCount &&
            e.contentHash !== contentHash,
        )
        if (hit) {
          similar.push({index, existingName: hit.name, newName: baseName(file.name)})
        }
      }
      // dup 命中:模型跳过,下面的动作照常提取
    }

    for (const clip of loaded.animations) {
      const glb = await deps.exportAnimation(loaded.root, clip)
      const contentHash = hashBytes(new Uint8Array(glb))
      if (
        existing.some((e) => e.kind === 'animation' && e.contentHash === contentHash)
      ) {
        items.push({
          type: 'skip',
          name: `${baseName(file.name)}/${clip.name}`,
          reason: '动作已在库中',
        })
        continue
      }
      items.push({
        type: 'animation',
        name: clip.name || baseName(file.name),
        rig,
        contentHash,
        duration: clip.duration,
        glb,
      })
    }
  }

  return {items, similar, summary: summarize(items)}
}

/** 落库:choices 与 plan.similar 一一对应,'reuse' 丢弃对应 model 项 */
export async function executeImport(
  plan: ImportPlan,
  choices: Array<'reuse' | 'keep'>,
  library: Library,
): Promise<void> {
  const drop = new Set(
    plan.similar.filter((_, i) => choices[i] === 'reuse').map((s) => s.index),
  )
  for (let i = 0; i < plan.items.length; i++) {
    const item = plan.items[i]
    if (item.type === 'skip') continue
    if (item.type === 'model') {
      if (drop.has(i)) continue
      const blobId = await library.backend.putBlob(new Blob([item.glb]))
      const entry: ModelEntry = {
        id: newId(),
        kind: 'model',
        name: item.name,
        rig: item.rig,
        blobId,
        contentHash: item.contentHash,
        boneCount: item.boneCount,
        vertexCount: item.vertexCount,
        createdAt: Date.now(),
      }
      await library.putEntry(entry)
    } else if (item.type === 'animation') {
      const blobId = await library.backend.putBlob(new Blob([item.glb]))
      const entry: AnimationEntry = {
        id: newId(),
        kind: 'animation',
        name: item.name,
        rig: item.rig,
        blobId,
        contentHash: item.contentHash,
        duration: item.duration,
        createdAt: Date.now(),
      }
      await library.putEntry(entry)
    } else {
      await library.putEntry({
        id: newId(),
        kind: 'pose',
        name: item.name,
        rig: item.rig,
        bones: item.bones,
        createdAt: Date.now(),
      })
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/assetLibrary/importPipeline.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/{importPipeline,importPipeline.test}.ts
git commit -m "feat(playground): 资产库导入管线(识别+去重+落库)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 缩略图离屏渲染

**Files:**
- Create: `packages/playground/src/shared/camera/assetLibrary/thumbnail.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `renderThumbnail(glb: ArrayBuffer): Promise<Blob | undefined>`（失败/不支持返回 undefined,不抛）。Task 8 在 executeImport 后为 model 条目补缩略图。

- [ ] **Step 1: 实现 thumbnail.ts**（无单测——WebGL 只在浏览器可用,Task 8 浏览器验证覆盖）

```ts
// packages/playground/src/shared/camera/assetLibrary/thumbnail.ts
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import {GLTFLoader} from 'three-stdlib'

/**
 * 离屏渲染模型缩略图(128×128 PNG)。WebGL 上下文创建失败、
 * 解析失败等情况一律返回 undefined,调用方降级为图标占位。
 */
export async function renderThumbnail(glb: ArrayBuffer): Promise<Blob | undefined> {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: true,
    })
    try {
      const scene = new Scene()
      scene.add(new AmbientLight(0xffffff, 1.4))
      const dir = new DirectionalLight(0xffffff, 1.6)
      dir.position.set(3, 5, 4)
      scene.add(dir)

      const gltf = await new Promise<{scene: import('three').Group}>(
        (resolve, reject) =>
          new GLTFLoader().parse(glb, '', resolve, reject),
      )
      scene.add(gltf.scene)

      const box = new Box3().setFromObject(gltf.scene)
      const center = box.getCenter(new Vector3())
      const size = box.getSize(new Vector3()).length() || 1
      const camera = new PerspectiveCamera(40, 1, size / 100, size * 10)
      camera.position
        .copy(center)
        .add(new Vector3(size * 0.7, size * 0.5, size * 0.7))
      camera.lookAt(center)
      renderer.render(scene, camera)

      return await new Promise<Blob | undefined>((resolve) =>
        canvas.toBlob((b) => resolve(b ?? undefined), 'image/png'),
      )
    } finally {
      renderer.dispose()
    }
  } catch {
    return undefined
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `cd /Users/huhui/Projects/theatre/packages/playground && yarn typecheck`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/thumbnail.ts
git commit -m "feat(playground): 资产库缩略图离屏渲染

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 库面板 UI

**Files:**
- Create: `packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx`

**Interfaces:**
- Consumes: 前面全部任务。
- Produces: `AssetLibraryPanel({onPlaceModel, filterRig, onClose}: {onPlaceModel: (entry: ModelEntry) => void; filterRig?: string; onClose: () => void})`。Task 9 在 App.tsx 挂载。

要点：模型/动作两个 tab（姿势 tab 留 P2，但 tab 位留好）；隐藏 file input 多选导入；planImport → 确认清单弹层（含 similar 的 reuse/keep 单选）→ executeImport → 对 model 项补缩略图（renderThumbnail 成功后 putEntry 更新 thumbnailId——条目 id 已知,用 library.putEntry({...entry, thumbnailId})）；卡片网格（缩略图或占位图标、名称、骨架族标签）；点模型卡片调 onPlaceModel；右键卡片弹小菜单（重命名用 prompt、删除用 confirm,删除条目时连同 blobId/thumbnailId 的 blob 一起删）；filterRig 存在时动作 tab 只显示同族,顶部显示"仅显示与选中模型同骨架族的动作"。样式沿 ObjectContextMenu 的暗色系。

完整组件约 260 行,结构：

```tsx
// packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx
import React, {useRef, useState} from 'react'
import {getLibrary, useLibraryEntries} from './library'
import {planImport, executeImport, realImportDeps} from './importPipeline'
import type {ImportPlan} from './importPipeline'
import {renderThumbnail} from './thumbnail'
import type {AnimationEntry, ModelEntry} from './types'

type Tab = 'model' | 'animation'

export function AssetLibraryPanel({
  onPlaceModel,
  filterRig,
  onClose,
}: {
  onPlaceModel: (entry: ModelEntry) => void
  filterRig?: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('model')
  const models = useLibraryEntries('model') as ModelEntry[]
  const animations = useLibraryEntries('animation') as AnimationEntry[]
  const fileRef = useRef<HTMLInputElement>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [choices, setChoices] = useState<Array<'reuse' | 'keep'>>([])
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{x: number; y: number; id: string} | null>(null)
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})

  // 缩略图 URL 懒加载:卡片出现时取 blob URL 并缓存
  const thumbUrl = (entry: ModelEntry): string | undefined => {
    if (!entry.thumbnailId) return undefined
    const cached = thumbUrls[entry.id]
    if (cached) return cached
    void getLibrary()
      .backend.getBlobUrl(entry.thumbnailId)
      .then((url) => setThumbUrls((m) => ({...m, [entry.id]: url})))
      .catch(() => {})
    return undefined
  }

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const p = await planImport([...files], getLibrary().backend, realImportDeps())
      setChoices(p.similar.map(() => 'reuse'))
      setPlan(p)
    } finally {
      setBusy(false)
    }
  }

  const confirmImport = async () => {
    if (!plan) return
    setBusy(true)
    try {
      await executeImport(plan, choices, getLibrary())
      // 补缩略图:导入成功的 model 项逐个渲染
      for (const item of plan.items) {
        if (item.type !== 'model') continue
        const blob = await renderThumbnail(item.glb)
        if (!blob) continue
        const thumbnailId = await getLibrary().backend.putBlob(blob)
        const list = (await getLibrary().backend.listEntries('model')) as ModelEntry[]
        const entry = list.find(
          (e) => e.contentHash === item.contentHash && !e.thumbnailId,
        )
        if (entry) await getLibrary().putEntry({...entry, thumbnailId})
      }
    } finally {
      setBusy(false)
      setPlan(null)
    }
  }

  const removeEntry = async (id: string) => {
    const entry = await getLibrary().backend.getEntry(id)
    if (!entry) return
    if (!window.confirm(`删除「${entry.name}」?场景里已放置的实例不受影响。`)) return
    await getLibrary().deleteEntry(id)
    if ('blobId' in entry) await getLibrary().backend.deleteBlob(entry.blobId)
    if (entry.kind === 'model' && entry.thumbnailId) {
      await getLibrary().backend.deleteBlob(entry.thumbnailId)
    }
  }

  const renameEntry = async (id: string) => {
    const entry = await getLibrary().backend.getEntry(id)
    if (!entry) return
    const name = window.prompt('重命名', entry.name)
    if (name) await getLibrary().renameEntry(id, name)
  }

  // …渲染:容器(左侧固定 260px 暗色面板) / 头部(tab 切换 + 导入按钮 + 关闭)
  // / filterRig 提示条 / 卡片网格(模型卡:缩略图+名称+rig 标签,点击 onPlaceModel;
  // 动作卡:名称+时长+rig 标签) / 卡片右键菜单(重命名/删除) / 确认清单弹层
  // (summary + skip 原因列表 + similar 每项 reuse/keep 单选 + 确认/取消)
  // 样式:与 ObjectContextMenu 同套暗色(背景 rgba(24,24,28,0.96)、圆角 8、
  // 边框 rgba(255,255,255,0.12)、字号 13)
}
```

实现时把上述省略的渲染部分补全（网格用 `display:grid; gridTemplateColumns:'1fr 1fr'; gap:8`，卡片高 96px，占位图标模型用 📦、动作用 🎬、姿势用 🧍）。右键菜单点击其它处关闭的逻辑可照搬 `ObjectContextMenu` 的 window pointerdown capture 写法。

- [ ] **Step 1: 实现 AssetLibraryPanel.tsx**（按上述结构补全渲染）

- [ ] **Step 2: 类型检查 + 全量测试**

Run: `cd /Users/huhui/Projects/theatre/packages/playground && yarn typecheck && cd .. && yarn jest packages/playground/src/shared/camera/assetLibrary`
Expected: 全通过

- [ ] **Step 3: 浏览器验证（真实 IndexedDB + 真实转换管线）**

临时在 App.tsx 挂出面板（Task 9 会正式接入,此步用最小挂载验证）：
1. `yarn serve --port 5199 --strictPort`（后台）,打开 `http://localhost:5199/shared/camera/`
2. 点导入,`browser_file_upload` 传 `.playwright-mcp/test-cube.fbx` → 确认清单显示"模型 ×1" → 确认 → 模型卡出现（含缩略图或占位图标）
3. 再导入同一文件 → 清单显示模型被去重（动作已在库中/模型已存在）
4. F12 console 无报错;页面刷新后卡片仍在（真实 IndexedDB 持久化验证）
5. 关闭 dev server

- [ ] **Step 4: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx
git commit -m "feat(playground): 资产库面板(导入/浏览/确认清单)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: 放置整合（从库放置模型）

**Files:**
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`
- Modify: `packages/playground/src/shared/camera/App.tsx`

**Interfaces:**
- Consumes: Task 8 的 `AssetLibraryPanel`，Task 3 的 `getLibrary`。
- Produces: `PlacingState` 扩展为 `{url: string; label: string; source: {type: 'local'; file: File; assetId: string} | {type: 'library'; entryId: string}}`；`PlacementEntry` 增加可选 `libraryEntryId`；`usePlacementController` 增加 `startPlacingFromLibrary(entry: ModelEntry)`。

要点：
- `PlacementEntry` 增加 `libraryEntryId?: string`（与旧 `assetId` 并存,旧实例不迁移）。
- `PlacedModel` 加载 URL 的来源：`libraryEntryId` → `getLibrary().backend.getBlobUrl(entry.blobId)`（entry 用 state 存,异步取）；否则走旧 `assetId` 路径。GLB 用 GLTFLoader、FBX 用 useFBX——统一为：`libraryEntryId` 路径用 GLTFLoader.loadAsync（库内必为 GLB）,旧路径不变。SkeletonUtils.clone、归一化、动画 mixer 逻辑两条路径共用（把"从 Group 建实例"的部分抽成共用函数）。
- ghost 预览同样支持库 GLB（PlacementRig 的模型加载按 source 分支）。
- `startPlacingFromLibrary`：`const url = await getLibrary().backend.getBlobUrl(entry.blobId); setPlacing({url, label: entry.name, source: {type: 'library', entryId: entry.id}})`。library 来源不进 theatre 项目资产（不 createAsset）。
- App.tsx：顶部"放置 FBX 模型"按钮改为"资产库"（开关面板）；面板 `onPlaceModel={(entry) => startPlacingFromLibrary(entry)}`；面板关闭按钮。
- 本地 FBX 导入入口收进库面板（Task 8 已有）,`startPlacing` 旧本地路径保留代码但 UI 入口移除——**不删代码**,后续 P 再清。

- [ ] **Step 1: 改 PlacementManager.tsx**（PlacingState/PlacementEntry/startPlacingFromLibrary/双路径加载）

- [ ] **Step 2: 改 App.tsx**（按钮改开关、挂面板）

- [ ] **Step 3: 类型检查**

Run: `cd /Users/huhui/Projects/theatre/packages/playground && yarn typecheck`
Expected: 通过

- [ ] **Step 4: 浏览器验证**

1. 起 server,开 camera 场景
2. 库里点模型卡 → ghost 跟随 → 左键确认 → 模型出现在场景,大纲出现条目
3. 刷新页面 → 模型仍在（库引用持久化）
4. 旧的已放置 FBX 实例仍正常（回归）
5. 关 server

- [ ] **Step 5: 提交**

```bash
git add packages/playground/src/shared/camera/{PlacementManager,App}.tsx
git commit -m "feat(playground): 从资产库放置模型

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: 动作套用（播放/停止/淡入淡出 + 同族过滤）

**Files:**
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`
- Modify: `packages/playground/src/shared/camera/App.tsx`

**Interfaces:**
- Consumes: 全部前序任务。
- Produces: PlacedModel 新增 theatre 属性 `animation`/`pose`（条目 id,默认空）；动作 GLB 加载与 0.2s 淡入淡出切换逻辑。

要点：
- 属性配置模块级常量（配置引用稳定性,同 fileConfigCache 的教训）：
```ts
const animPropConfig = t.string('', {label: '动作'})
const posePropConfig = t.string('', {label: '姿势'})
```
`additionalProps` 挂上,命令式创建路径（pending 提交 effect）不预设值（默认 '' 即可）。
- PlacedModel 内：
  - `const animationId = useVal(obj.props.animation)`（字符串）
  - effect：animationId 变化 → getEntry + getBlobUrl + GLTFLoader 加载 → `setClip(animations[0])`；空 id → `setClip(null)`
  - effect：clip 变化 → `mixer.clipAction(clip)`，`action.reset().fadeIn(0.2).play()`，旧 action `fadeOut(0.2)`；clip 为 null 时旧 action fadeOut
  - 现有"只在序列播放时 mixer.update"的门控**保留**；停止时若 clip 非空,模型停在当前帧（不做回绑定姿势,简单一致）
  - pose 属性 P1 只注册不实现应用逻辑（姿势 tab 在 P2）——面板不显示姿势 tab,属性先留好
- 动作 tab 的套用入口：选中已放置模型时,App 通过 studio selection 找到选中对象的 `animation` 属性所在对象,点动作卡 → 一次 scrub 提交 `set(obj.props.animation, entry.id)`（一步撤销）。选中多个/未选中时点动作卡无效（卡片置灰）。
- App 侧 `filterRig`：由选中放置对象的 `libraryEntryId` 查库条目拿 rig,传给面板。

- [ ] **Step 1: 改 PlacementManager.tsx**（属性注册 + 动作加载/切换）

- [ ] **Step 2: 改 App.tsx + AssetLibraryPanel**（动作卡点击套用 + 置灰 + filterRig）

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `cd /Users/huhui/Projects/theatre/packages/playground && yarn typecheck && cd .. && yarn jest packages/playground/src/shared/camera/assetLibrary`
Expected: 通过

- [ ] **Step 4: 浏览器验证**

1. 起 server,放置一个带多段动画的 FBX（若无多段动画资产,先用 test-cube 验证属性与套用的撤销链路,动画效果用 console 断言 action 切换）
2. 选中模型 → 动作 tab 只列同族动作 → 点另一动作 → 属性面板"动作"值变化,0.2s 淡入淡出
3. Cmd+Z → 回到上一动作（一步撤销）
4. 序列播放/空格 → 动画播放;停止 → 静止
5. 刷新 → 动作选择保留
6. 关 server

- [ ] **Step 5: 提交**

```bash
git add packages/playground/src/shared/camera/{PlacementManager,App}.tsx packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx
git commit -m "feat(playground): 已放置模型切换库动作(淡入淡出/可撤销)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 自我评审记录

- Spec 覆盖:P1 范围（数据层/导入管线/模型 tab/动作 tab/缩略图/确认清单）逐项对应 Task 1-10;姿势 tab 与姿势应用明确留 P2（Task 10 只注册属性）。
- 占位符检查:Task 8/9/10 的 UI/集成代码按结构描述 + 关键代码给出（这些在浏览器验证收口）,逻辑代码全部完整给出。
- 类型一致性:`ImportDeps`/`ImportItem`/`SimilarMatch`/`ImportPlan`、`Library` 方法名（putEntry/renameEntry/deleteEntry/subscribe）、`PlacingState.source` 联合类型在任务间一致。
