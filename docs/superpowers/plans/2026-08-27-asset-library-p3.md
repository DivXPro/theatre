# 资产库 P3(Draco 压缩 + 骨架族别名)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 入库模型 GLB 走 Draco 压缩缩小存储体积;骨架族可起人话名字并显示在库面板卡片上。

**Architecture:** 导入管线在 GLTFExporter 产出 GLB 后增加一道 gltf-transform Draco 压缩(仅模型;动作 GLB 无网格可压,跳过)。所有 GLTFLoader 创建点改走统一的 createGLTFLoader()(接 DRACOLoader,解码器文件放 playground public/draco),压缩与未压缩内容都能读,旧库内容零迁移。别名存库 IndexedDB 新增的 rigAliases 表(DB 版本 1→2 迁移),后端接口加两个方法,面板卡片骨架标签显示别名并可点击改名。

**Tech Stack:** @gltf-transform/core+extensions+functions v4、draco3dgltf(浏览器可用,wasm 内嵌 base64;不要用 draco3d 包,其 main 是 node 专用,浏览器里会读 fs)、three-stdlib DRACOLoader、fake-indexeddb。

**Spec:** docs/superpowers/specs/2026-08-26-asset-library-design.md(P3 一节;跨族重定向经用户确认不做)。本计划经用户在会话中按 bounded 流程口头批准(2026-08-27),设计要点已浓缩在上文。

## Global Constraints

- jest 一律从仓库根跑:`npx jest <path>`;测试文件 `*.test.ts` 与源码同目录。
- jest 用 jest-esbuild:`jest.mock` 不提升;需要 mock 时 `jest.doMock` + `jest.resetModules` + 运行时 `require`。
- fake-indexeddb 对无效 key 静默宽容,真实 IDB 抛错:IDB 相关改动需行为回归测试 + 控制器真实浏览器验证。
- blob URL 主动 revoke 只发生在此前的既有逻辑里,新代码不引入新的 revoke。
- 注释与提交信息用中文,风格贴同目录现有代码。
- 直接在 main 上工作(用户已批准),每个任务的提交由 SDD 流程授权。
- UI 行为由控制器做真实浏览器验证(playground dev server:`cd packages/playground && yarn serve --port 5199 --strictPort`,场景 http://localhost:5199/shared/camera/;验证完必须停服务器)。
- Playwright 文件选择器只能用 browser_file_upload 应答,绝不在 run_code 里应答(幻影堆积会阻塞工具)。
- 已知不报案底:main 上既有 6 个 studio 集成测试失败;首次放置的 duplicate-key 警告(既有竞态)。

---

### Task 1: Draco 压缩(导出后处理)

**Files:**
- Create: `packages/playground/src/shared/camera/assetLibrary/draco.ts`
- Create: `packages/playground/src/shared/camera/assetLibrary/draco.test.ts`
- Modify: `packages/playground/src/shared/camera/assetLibrary/exportGLB.ts`
- Modify: `packages/playground/package.json`(新增 4 个 devDependencies)
- Modify: `yarn.lock`(安装产物,随本任务提交)

**Interfaces:**
- Consumes: 现有 `exportGLB(root, animations)`(exportGLB.ts 内部函数)。
- Produces: `compressGLBDraco(glb: ArrayBuffer): Promise<ArrayBuffer>`(draco.ts);`exportModelGLB` 签名不变,返回值变为压缩后的 GLB(Task 2 的解码接线依赖这一点)。

- [ ] **Step 1: 装依赖**

```bash
yarn workspace playground add --dev @gltf-transform/core@^4 @gltf-transform/extensions@^4 @gltf-transform/functions@^4 draco3dgltf@^1
```

若沙箱无网络导致安装失败,把确切的 4 个依赖写进 package.json(devDependencies,版本 `^4.0.0` / `^1.5.7`),在报告里标注"yarn install 需用户本地补跑",不要假装装过。

- [ ] **Step 2: 写压缩模块 draco.ts**

```ts
import {WebIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {draco} from '@gltf-transform/functions'
import draco3dgltf from 'draco3dgltf'

/**
 * Draco 压缩的 IO 单例:wasm 模块编译一次,全局复用。
 * 用 draco3dgltf(wasm 内嵌 base64,浏览器/节点都能跑);
 * draco3d 包的 main 是 node 专用实现,浏览器里会读 fs,不要用。
 */
let ioPromise: Promise<WebIO> | undefined

function getIO(): Promise<WebIO> {
  return (ioPromise ??= (async () => {
    const [decoder, encoder] = await Promise.all([
      draco3dgltf.createDecoderModule(),
      draco3dgltf.createEncoderModule(),
    ])
    return new WebIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        'draco3d.decoder': decoder,
        'draco3d.encoder': encoder,
      })
  })())
}

/**
 * Draco 压缩 GLB(只压网格几何,骨骼/动画轨道不受影响)。
 * 无网格的动作 GLB 没有可压内容,调用方不应走这里。
 */
export async function compressGLBDraco(glb: ArrayBuffer): Promise<ArrayBuffer> {
  const io = await getIO()
  const doc = await io.readBinary(new Uint8Array(glb))
  await doc.transform(draco())
  const out = await io.writeBinary(doc)
  // writeBinary 返回的 Uint8Array 可能带偏移,切出干净的 ArrayBuffer
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
}
```

注意:`readBinary`/`writeBinary` 的签名以装上的 v4 实际为准(v4 为 `readBinary(data: Uint8Array)`、`writeBinary(doc): Promise<Uint8Array>`);若类型报错按 node_modules 里的 .d.ts 调整,不要用 any 糊。

- [ ] **Step 3: exportModelGLB 接入压缩**

exportGLB.ts 中(import 加到文件头):

```ts
import {compressGLBDraco} from './draco'

/** 模型入库:剥掉动画,只留网格+骨架+绑定姿势;几何走 Draco 压缩 */
export function exportModelGLB(root: Object3D): Promise<ArrayBuffer> {
  return exportGLB(root, []).then(compressGLBDraco)
}
```

`exportAnimationGLB` 不动(纯骨骼树无网格,Draco 无可压内容)。

- [ ] **Step 4: 写测试 draco.test.ts**

GLTFExporter 不进 jest(现有 exportGLB.test.ts 也只测 cloneBoneTree),测试直接用 gltf-transform 造一个小 GLB 来测压缩:

```ts
import {Document, WebIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import draco3dgltf from 'draco3dgltf'
import {compressGLBDraco} from './draco'

/** 造一个 vertexCount 顶点的三角网格 GLB(不压缩) */
async function buildGLB(vertexCount: number): Promise<Uint8Array> {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const positions = new Float32Array(vertexCount * 3)
  for (let i = 0; i < positions.length; i++) positions[i] = Math.sin(i) * i
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(positions)
    .setBuffer(buffer)
  const prim = doc.createPrimitive().setAttribute('POSITION', position)
  const mesh = doc.createMesh('m').addPrimitive(prim)
  const node = doc.createNode('n').setMesh(mesh)
  doc.createScene('s').addChild(node)
  return new WebIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc)
}

describe('compressGLBDraco', () => {
  it('压缩后体积更小且声明 draco 扩展', async () => {
    const glb = await buildGLB(5000)
    const raw = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength)
    const compressed = await compressGLBDraco(raw)
    expect(compressed.byteLength).toBeLessThan(glb.byteLength)
    const text = new TextDecoder().decode(new Uint8Array(compressed))
    expect(text).toContain('KHR_draco_mesh_compression')
  })

  it('读回后顶点数不丢', async () => {
    const glb = await buildGLB(5000)
    const raw = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength)
    const compressed = await compressGLBDraco(raw)
    const io = new WebIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        'draco3d.decoder': await draco3dgltf.createDecoderModule(),
      })
    const doc = await io.readBinary(new Uint8Array(compressed))
    const pos = doc
      .getRoot()
      .listMeshes()[0]
      .listPrimitives()[0]
      .getAttribute('POSITION')!
    expect(pos.getCount()).toBe(5000)
  })
})
```

- [ ] **Step 5: 跑测试**

```bash
npx jest packages/playground/src/shared/camera/assetLibrary/
```

预期:draco.test.ts 2 个新测试通过,既有 34 个测试不回归(draco3dgltf 内嵌 base64 较大,jest-esbuild 转译变慢属正常)。

- [ ] **Step 6: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/draco.ts \
  packages/playground/src/shared/camera/assetLibrary/draco.test.ts \
  packages/playground/src/shared/camera/assetLibrary/exportGLB.ts \
  packages/playground/package.json yarn.lock
git commit -m "feat(playground): 模型入库几何走 Draco 压缩"
```

---

### Task 2: Draco 解码接线(统一 createGLTFLoader)

**Files:**
- Create: `packages/playground/src/shared/camera/assetLibrary/gltfLoader.ts`
- Create: `packages/playground/public/draco/`(3 个解码器文件,从 three 原样拷贝)
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`(3 处 `new GLTFLoader()`,约 482/800/954 行)
- Modify: `packages/playground/src/shared/camera/assetLibrary/thumbnail.ts`(1 处 parse)
- Modify: `packages/playground/src/shared/camera/assetLibrary/importPipeline.ts`(defaultLoad 的 glb 分支)

**Interfaces:**
- Consumes: Task 1 的压缩产物(浏览器端必须能读回)。
- Produces: `createGLTFLoader(): GLTFLoader`(gltfLoader.ts),全库唯一 GLTFLoader 创建入口。

- [ ] **Step 1: 拷贝解码器文件**

```bash
mkdir -p packages/playground/public/draco
cp node_modules/three/examples/jsm/libs/draco/draco_decoder.js \
   node_modules/three/examples/jsm/libs/draco/draco_decoder.wasm \
   node_modules/three/examples/jsm/libs/draco/draco_wasm_wrapper.js \
   packages/playground/public/draco/
```

vite 会把 public/ 原样serve/打包到根路径,运行时 `/draco/draco_decoder.wasm` 可达。

- [ ] **Step 2: 写 gltfLoader.ts**

```ts
import {DRACOLoader, GLTFLoader} from 'three-stdlib'

let dracoLoader: DRACOLoader | undefined

/**
 * 统一创建 GLTFLoader:接 Draco 解码(解码器文件在 public/draco,
 * 从 three 原样拷贝)。未压缩的 GLB 走原路径,不受影响;
 * DRACOLoader 全局一个,解码 wasm 只加载一次。
 */
export function createGLTFLoader(): GLTFLoader {
  dracoLoader ??= new DRACOLoader().setDecoderPath('/draco/')
  return new GLTFLoader().setDRACOLoader(dracoLoader)
}
```

- [ ] **Step 3: 替换 5 处创建点**

- `PlacementManager.tsx` 3 处:`new GLTFLoader()` → `createGLTFLoader()`(import 相应替换;`SkeletonUtils` 仍从 three-stdlib 导)。
- `thumbnail.ts`:`new GLTFLoader().parse(glb, '', resolve, reject)` → `createGLTFLoader().parse(...)`。
- `importPipeline.ts` defaultLoad:文件头静态 `import {createGLTFLoader} from './gltfLoader'`;动态导入收窄为 `const {FBXLoader} = await import('three-stdlib')`;glb 分支改 `createGLTFLoader().loadAsync(url)`。(importPipeline 经 exportGLB 本就静态依赖 three-stdlib,不引入新的测试负担。)

- [ ] **Step 4: 类型检查 + 回归测试**

```bash
yarn workspace playground typecheck
npx jest packages/playground/src/shared/camera/assetLibrary/
```

预期:typecheck 通过;34+2 个测试不回归。本任务无新单测(解码正确性由控制器浏览器端到端验证:压缩模型能放置、缩略图能出、动作能播)。

- [ ] **Step 5: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/gltfLoader.ts \
  packages/playground/public/draco \
  packages/playground/src/shared/camera/PlacementManager.tsx \
  packages/playground/src/shared/camera/assetLibrary/thumbnail.ts \
  packages/playground/src/shared/camera/assetLibrary/importPipeline.ts
git commit -m "feat(playground): GLTFLoader 统一接 Draco 解码"
```

---

### Task 3: 骨架族别名存储(DB v2 + 接口 + 门面)

**Files:**
- Modify: `packages/playground/src/shared/camera/assetLibrary/types.ts`
- Modify: `packages/playground/src/shared/camera/assetLibrary/indexedDBBackend.ts`
- Modify: `packages/playground/src/shared/camera/assetLibrary/library.ts`
- Modify: `packages/playground/src/shared/camera/assetLibrary/indexedDBBackend.test.ts`
- Modify: `packages/playground/src/shared/camera/assetLibrary/library.test.ts`
- Modify: `packages/playground/src/shared/camera/assetLibrary/importPipeline.test.ts`(若其 backend mock 需补新方法)

**Interfaces:**
- Consumes: 无(独立功能)。
- Produces(Task 4 依赖):
  - `type RigAlias = {rig: RigId; name: string}`(types.ts)
  - `LibraryBackend.getRigAliases(): Promise<RigAlias[]>`、`LibraryBackend.putRigAlias(alias: RigAlias): Promise<void>`
  - `Library.getRigAliases()`(直读透传)、`Library.setRigAlias(rig, name)`(走 enqueue + emit)
  - `useRigAliases(): Record<string, string>`(library.ts,rig → name)

- [ ] **Step 1: types.ts 加类型 + 接口扩展**

```ts
/** 骨架族别名:给人看的名字,面板骨架标签显示 */
export type RigAlias = {rig: RigId; name: string}
```

`LibraryBackend` 接口追加(注释放 listBlobIds 后):

```ts
  /** 列出全部骨架族别名 */
  getRigAliases(): Promise<RigAlias[]>
  /** 设置/覆盖某骨架族的别名 */
  putRigAlias(alias: RigAlias): Promise<void>
```

- [ ] **Step 2: indexedDBBackend 版本升级 + 两个方法**

`DB_VERSION = 1` → `2`;`onupgradeneeded` 追加:

```ts
      if (!db.objectStoreNames.contains('rigAliases')) {
        db.createObjectStore('rigAliases', {keyPath: 'rig'})
      }
```

类内追加:

```ts
  async getRigAliases(): Promise<RigAlias[]> {
    const db = await this.db()
    const req = db
      .transaction('rigAliases', 'readonly')
      .objectStore('rigAliases')
      .getAll()
    return (await requestToPromise(req)) as RigAlias[]
  }

  async putRigAlias(alias: RigAlias): Promise<void> {
    const db = await this.db()
    const req = db
      .transaction('rigAliases', 'readwrite')
      .objectStore('rigAliases')
      .put(alias)
    await requestToPromise(req)
  }
```

(import 处把 `RigAlias` 加进 types 导入。)

- [ ] **Step 3: Library 门面 + 订阅 hook**

library.ts 的 `Library` 类追加(写操作走既有 enqueue 串行队列,与 P2 修复一致):

```ts
  /** 直读别名(透传,不 emit) */
  getRigAliases(): Promise<RigAlias[]> {
    return this.backend.getRigAliases()
  }

  /** 设置/覆盖骨架族别名 */
  async setRigAlias(rig: string, name: string): Promise<void> {
    await this.enqueue(async () => {
      await this.backend.putRigAlias({rig, name})
      this.emit()
    })
  }
```

文件尾部追加 hook(模式照抄 useLibraryEntries):

```ts
/** 订阅式读骨架族别名:rig → 名字;改名后自动刷新 */
export function useRigAliases(): Record<string, string> {
  const [aliases, setAliases] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    const reload = () => {
      void getLibrary()
        .getRigAliases()
        .then((list) => {
          if (alive)
            setAliases(
              Object.fromEntries(list.map((a) => [a.rig, a.name])),
            )
        })
    }
    reload()
    const unsub = getLibrary().subscribe(reload)
    return () => {
      alive = false
      unsub()
    }
  }, [])
  return aliases
}
```

- [ ] **Step 4: 测试**

indexedDBBackend.test.ts 追加(贴现有测试的搭建方式;若文件里有每个用例重建库的工具就复用):

```ts
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
    db.close()
    // 新版本后端打开触发升级
    const backend = new IndexedDBBackend()
    await backend.putRigAlias({rig: 'rig-x', name: '升级后可用'})
    expect(await backend.getRigAliases()).toEqual([
      {rig: 'rig-x', name: '升级后可用'},
    ])
  })
})
```

注意 fake-indexeddb 的库是全局的:若现有测试文件有 beforeEach 清库逻辑,新用例必须遵守同样的模式,否则用例间会互相污染。

library.test.ts 追加:

```ts
it('setRigAlias 写入并触发订阅', async () => {
  const lib = /* 贴现有用例的构造方式 */
  const seen: string[][] = []
  const unsub = lib.subscribe(() => {
    void lib.getRigAliases().then((l) => seen.push(l.map((a) => a.name)))
  })
  await lib.setRigAlias('rig-a', 'Mixamo')
  unsub()
  expect(await lib.getRigAliases()).toEqual([{rig: 'rig-a', name: 'Mixamo'}])
  expect(seen.length).toBeGreaterThan(0)
})
```

importPipeline.test.ts 若有 LibraryBackend 的假实现/mock,补上 `getRigAliases: async () => []` 与 `putRigAlias: async () => {}` 两个成员(接口扩展的连带,属预期内的文件数偏差)。

- [ ] **Step 5: 跑测试**

```bash
npx jest packages/playground/src/shared/camera/assetLibrary/
```

预期:全部通过;真实 IDB 升级路径由控制器浏览器验证(老库不丢数据)。

- [ ] **Step 6: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/types.ts \
  packages/playground/src/shared/camera/assetLibrary/indexedDBBackend.ts \
  packages/playground/src/shared/camera/assetLibrary/library.ts \
  packages/playground/src/shared/camera/assetLibrary/indexedDBBackend.test.ts \
  packages/playground/src/shared/camera/assetLibrary/library.test.ts \
  packages/playground/src/shared/camera/assetLibrary/importPipeline.test.ts
git commit -m "feat(playground): 骨架族别名存储(库 DB 升 v2)"
```

---

### Task 4: 别名 UI(卡片骨架标签显示 + 点击改名)

**Files:**
- Modify: `packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx`

**Interfaces:**
- Consumes: Task 3 的 `useRigAliases()`、`Library.setRigAlias(rig, name)`。
- Produces: 无(终端 UI)。

- [ ] **Step 1: 面板接入别名**

文件头 import 追加 `useRigAliases`(来自 './library' 或既有库导入路径,以现状为准);组件内:

```ts
const rigAliases = useRigAliases()
/** 骨架标签文案:有别名显示别名,否则短哈希 */
const rigLabel = (rig: string) =>
  rigAliases[rig] ?? (rig.length > 12 ? rig.slice(0, 11) + '…' : rig)
const renameRig = (rig: string) => (ev: React.MouseEvent) => {
  ev.stopPropagation() // 标签在卡片内,不能触发卡片的放置/套用
  const name = window
    .prompt('骨架族名称', rigAliases[rig] ?? '')
    ?.trim()
  if (name) void getLibrary().setRigAlias(rig, name)
}
```

- [ ] **Step 2: 两处标签替换**

模型卡(现 240-242 行,无 rigMismatch):

```tsx
<div
  style={{...tagStyle, cursor: 'pointer'}}
  title={`${entry.rig}\n点击给这套骨架起名`}
  onClick={renameRig(entry.rig)}
>
  {rigLabel(entry.rig)}
</div>
```

套用卡(现 282-285 行,保留 rigMismatch 追加):

```tsx
<div
  style={{...tagStyle, cursor: 'pointer'}}
  title={`${entry.rig}\n点击给这套骨架起名`}
  onClick={renameRig(entry.rig)}
>
  {rigLabel(entry.rig)}
  {rigMismatch && ' · 骨架不匹配'}
</div>
```

- [ ] **Step 3: typecheck + 回归**

```bash
yarn workspace playground typecheck
npx jest packages/playground/src/shared/camera/assetLibrary/
```

- [ ] **Step 4: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx
git commit -m "feat(playground): 卡片骨架标签显示别名,点击可改名"
```

- [ ] **Step 5: 控制器浏览器验证(控制器执行,不派实现代理)**

验证清单(发现新问题由控制器裁定是否开修复轮):
1. 导入一个 FBX 模型(新导入走压缩):库里模型 blob 明显小于 P3 前导入的同模型(IndexedDB 里比 byteLength);导入确认清单/去重流程不回归
2. 放置该模型:能放、缩略图能出、套动作能播、姿势能套(解码链路全通);网络面板 `/draco/draco_decoder.wasm` 200
3. 旧内容零迁移:P3 前已入库的未压缩模型照常放置/播放
4. 刷新页面后上述一切仍在(持久化 + 老库 v1→v2 升级不丢数据)
5. 点骨架标签改名 → 三个 tab 的卡片标签都变新名字;取消/留空不改;刷新后名字还在
6. 异族卡片仍置灰且带" · 骨架不匹配";标签点击不触发卡片的放置/套用
