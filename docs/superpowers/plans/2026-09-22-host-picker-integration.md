# 宿主接管"添加模型/路径"选择界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** camera 场景暴露 `CameraFlows` 能力句柄 + `usePlacing()` hook,顶栏"添加模型/路径"按钮点击改走宿主回调,宿主可注入自己的 shadcn 选择界面完成点选/拖拽放置。

**Architecture:** 新建 `hostFlows.ts` 模块:句柄注册表 + placing 外部 store + `dropPointFromClient` 落点封装(场景内捕获 gl/camera)+ 纯工厂 `createHostFlows(deps)`(转发 App 既有函数)。`importModelFile` 走既有 planImport/executeImport 管线。App.tsx 只做组装与按钮分流;不传新 props 时行为与现状逐字节等价。

**Tech Stack:** React 18 / three / @react-three/fiber / jest(jest-esbuild)/ TypeScript strict。

**Spec:** `docs/superpowers/specs/2026-09-21-host-picker-integration-design.md`

## Global Constraints

- 不传 `onFlows / onOpenModelPicker / onOpenPathPicker` 三个 props 时,运行时行为与现状完全一致(内置框体照常开合)。
- 放置幽灵在画布内的交互(跟随光标/落点吸附/确认取消)本期零改动。
- 顶栏按钮、加相机/锚点/导出/画中画按钮形态不变;姿势/动作框体本期不做宿主化。
- 三个新 props 全部 optional;场景未 mount / 已卸载时 `dropPointFromClient` 返回 null,不抛异常。
- 测试命令:`yarn jest <path>`(仓库根);类型检查:`npx tsc --noEmit -p packages/playground`。
- 提交:中文 conventional message + 尾行 `Co-Authored-By: Claude Code <noreply@anthropic.com>`;只 stage 本任务触碰的文件(git 树有无关未跟踪文件,禁止 `git add -A`)。
- 无新 i18n 词条。
- jest-esbuild 不提升 `jest.mock`(若需 mock,用 `jest.doMock` + `resetModules` + 运行时 require,见 devEnv 既有模式)。

---

### Task 1: hostFlows 基础模块——类型、句柄注册表、placing store、usePlacing

**Files:**
- Create: `packages/playground/src/shared/camera/hostFlows.ts`
- Test: `packages/playground/src/shared/camera/hostFlows.test.ts`

**Interfaces:**
- Consumes: `PlacingState`(`PlacementManager.tsx:75`,`{url: string; label: string; source: PlacementSource}`);`ModelEntry`(`assetLibrary/types.ts:9`);`PathPreset`(`pathPresets.ts`,字段以该文件为准)。
- Produces(后续任务依赖,逐字一致):
  - `export type Vec3 = {x: number; y: number; z: number}`
  - `export type CameraFlows = {startPlacingModel(entry: ModelEntry): Promise<void>; placeModelAt(entry: ModelEntry, point: Vec3): void; addPresetPath(preset: PathPreset, at?: Vec3): void; addCamera(): void; addAnchor(): void; cancelPlacing(): void; importModel(file: File): Promise<ModelEntry>; dropPointFromClient(clientX: number, clientY: number): Vec3 | null}`
  - `export function setHostFlowsHandle(f: CameraFlows | null): void` / `export function getHostFlowsHandle(): CameraFlows | null`
  - `export function setPlacingSnapshot(p: PlacingState | null): void` / `export function getPlacingSnapshot(): PlacingState | null` / `export function subscribePlacing(l: () => void): () => void`
  - `export function usePlacing(): PlacingState | null`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * hostFlows:宿主能力句柄的基础设施——句柄注册表、placing 外部 store、
 * usePlacing hook。模块级单例,场景 mount 时挂句柄、卸载时清句柄。
 */
import {act} from 'react-dom/test-utils'
import ReactDOM from 'react-dom/client'
import React from 'react'
import type {PlacingState} from './PlacementManager'
import {
  getHostFlowsHandle,
  getPlacingSnapshot,
  setHostFlowsHandle,
  setPlacingSnapshot,
  subscribePlacing,
  usePlacing,
} from './hostFlows'

const placingA: PlacingState = {
  url: 'blob:a',
  label: 'A',
  source: {type: 'library', entryId: 'e1'},
}

afterEach(() => {
  setHostFlowsHandle(null)
  setPlacingSnapshot(null)
})

describe('句柄注册表', () => {
  it('未设置时返回 null,设置后可取回,清空后归 null', () => {
    expect(getHostFlowsHandle()).toBeNull()
    const fake = {} as never
    setHostFlowsHandle(fake)
    expect(getHostFlowsHandle()).toBe(fake)
    setHostFlowsHandle(null)
    expect(getHostFlowsHandle()).toBeNull()
  })
})

describe('placing store', () => {
  it('初始快照为 null', () => {
    expect(getPlacingSnapshot()).toBeNull()
  })
  it('设置快照后订阅者被通知;同值重复设置不通知', () => {
    const seen: Array<PlacingState | null> = []
    const unsub = subscribePlacing(() => seen.push(getPlacingSnapshot()))
    setPlacingSnapshot(placingA)
    setPlacingSnapshot(placingA)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(placingA)
    unsub()
    setPlacingSnapshot(null)
    expect(seen).toHaveLength(1)
  })
})

describe('usePlacing', () => {
  it('跟随 store 变化重渲染', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = ReactDOM.createRoot(el)
    let rendering: () => PlacingState | null = () => null
    function Probe() {
      rendering = usePlacing
      return null
    }
    function Host() {
      const placing = usePlacing()
      rendering = () => placing
      return null
    }
    await act(async () => {
      root.render(<Host />)
    })
    expect(rendering()).toBeNull()
    await act(async () => {
      setPlacingSnapshot(placingA)
    })
    expect(rendering()).toBe(placingA)
    await act(async () => {
      root.unmount()
    })
    el.remove()
    // Probe 只为引用 usePlacing 而设,避免 lint 报未使用
    void Probe
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest packages/playground/src/shared/camera/hostFlows.test.ts`
Expected: FAIL,`Cannot find module './hostFlows'`。

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * 宿主能力句柄的基础设施(规格 §1–§3)。
 * 句柄注册表:onFlows 一次性交付,宿主自存;模块级单例,场景卸载清空。
 * placing store:useSyncExternalStore 的外部 store,宿主组件(含 portal
 * 到 body 的 shadcn Dialog)用 usePlacing() 读放置状态,不依赖 context。
 * dropPointFromClient 与 createHostFlows 在同文件后续任务补齐。
 */
import {useSyncExternalStore} from 'react'
import type {PlacingState} from './PlacementManager'
import type {ModelEntry} from './assetLibrary/types'
import type {PathPreset} from './pathPresets'

export type Vec3 = {x: number; y: number; z: number}

export type CameraFlows = {
  /** 点选放置:宿主选中模型后调用,进入画布放置模式 */
  startPlacingModel(entry: ModelEntry): Promise<void>
  /** 拖拽放置:在指定三维落点直接放置,无幽灵阶段 */
  placeModelAt(entry: ModelEntry, point: Vec3): void
  /** 路径预设生成路径;不传 at = 场景中心(现状语义) */
  addPresetPath(preset: PathPreset, at?: Vec3): void
  addCamera(): void
  addAnchor(): void
  cancelPlacing(): void
  /** 宿主外部模型入库(走既有导入管线),返回正式库条目 */
  importModel(file: File): Promise<ModelEntry>
  /** 指针客户端坐标 → 场景三维落点;场景未就绪返回 null */
  dropPointFromClient(clientX: number, clientY: number): Vec3 | null
}

// ── 句柄注册表 ──────────────────────────────────────────────
let currentHandle: CameraFlows | null = null
export function setHostFlowsHandle(f: CameraFlows | null): void {
  currentHandle = f
}
export function getHostFlowsHandle(): CameraFlows | null {
  return currentHandle
}

// ── placing 外部 store ──────────────────────────────────────
let placingSnapshot: PlacingState | null = null
const placingListeners = new Set<() => void>()
export function setPlacingSnapshot(p: PlacingState | null): void {
  if (p === placingSnapshot) return
  placingSnapshot = p
  placingListeners.forEach((l) => l())
}
export function getPlacingSnapshot(): PlacingState | null {
  return placingSnapshot
}
export function subscribePlacing(l: () => void): () => void {
  placingListeners.add(l)
  return () => {
    placingListeners.delete(l)
  }
}
export function usePlacing(): PlacingState | null {
  return useSyncExternalStore(subscribePlacing, getPlacingSnapshot)
}
```

注意:文件此时未导出 `createHostFlows/dropPointFromClient` —— Task 2/3 才加;本任务末尾先不引用它们,类型 `CameraFlows` 里已声明。

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest packages/playground/src/shared/camera/hostFlows.test.ts`
Expected: PASS(4 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/hostFlows.ts packages/playground/src/shared/camera/hostFlows.test.ts
git commit -m "feat(playground): hostFlows 基础设施——能力句柄注册表 + placing 外部 store + usePlacing

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: dropPointFromClient 落点封装 + 场景上下文捕获

**Files:**
- Modify: `packages/playground/src/shared/camera/hostFlows.ts`(追加 dropPoint 段)
- Test: `packages/playground/src/shared/camera/hostFlows.test.ts`(追加 describe)

**Interfaces:**
- Consumes: `computeDropPoint`(`dropPoint.ts:13`,签名为 `(raycaster, camera, surfaces, rect, clientX, clientY, out?) => Vector3`);`getPlacementSurfaces`(`PlacementManager.tsx:216`,返回 `ReadonlySet<Object3D>`)。
- Produces:
  - `export function setDropPointContext(ctx: {gl: {domElement: HTMLElement}; camera: Camera} | null): void`
  - `export function dropPointFromClient(clientX: number, clientY: number): Vec3 | null`(已作为 `CameraFlows.dropPointFromClient` 的实现)

- [ ] **Step 1: Write the failing test**

在 `hostFlows.test.ts` 末尾追加:

```ts
import {
  dropPointFromClient,
  setDropPointContext,
} from './hostFlows'
import {PerspectiveCamera} from 'three'

describe('dropPointFromClient', () => {
  afterEach(() => setDropPointContext(null))
  it('未设置上下文时返回 null', () => {
    expect(dropPointFromClient(50, 50)).toBeNull()
  })
  it('上下文就绪时按地面兜底规则返回落点(rect 中心的垂直射线打 y=0)', () => {
    // 相机在 (0,10,0) 垂直朝下,rect 100×100,(50,50) = NDC 原点
    const camera = new PerspectiveCamera()
    camera.position.set(0, 10, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const domElement = {
      getBoundingClientRect: () =>
        ({left: 0, top: 0, width: 100, height: 100}) as DOMRect,
    } as unknown as HTMLElement
    setDropPointContext({
      gl: {domElement} as never,
      camera,
    })
    const p = dropPointFromClient(50, 50)
    expect(p).not.toBeNull()
    expect(p!.x).toBeCloseTo(0, 5)
    expect(p!.z).toBeCloseTo(0, 5)
    expect(p!.y).toBeCloseTo(0, 5)
  })
  it('清空上下文后回到 null', () => {
    const camera = new PerspectiveCamera()
    setDropPointContext({gl: {domElement: {
      getBoundingClientRect: () =>
        ({left: 0, top: 0, width: 100, height: 100}) as DOMRect,
    }} as never, camera})
    setDropPointContext(null)
    expect(dropPointFromClient(50, 50)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest packages/playground/src/shared/camera/hostFlows.test.ts`
Expected: FAIL,`dropPointFromClient is not a function`(或导出不存在)。

- [ ] **Step 3: Write minimal implementation**

在 `hostFlows.ts` 末尾追加:

```ts
// ── 落点换算 ────────────────────────────────────────────────
// 场景内(HostFlowsDropPointCapture,App 的 Canvas 子树)把 gl/camera
// 捕获进来;宿主 dragover/drop 事件里的 clientX/clientY 直接喂给
// dropPointFromClient,规则与放置幽灵一致(表面优先、地面兜底)。
import {Raycaster} from 'three'
import type {Camera} from 'three'
import {computeDropPoint} from './dropPoint'
import {getPlacementSurfaces} from './PlacementManager'

export type DropPointContext = {
  gl: {domElement: HTMLElement}
  camera: Camera
}
let dropCtx: DropPointContext | null = null
export function setDropPointContext(ctx: DropPointContext | null): void {
  dropCtx = ctx
}
export function dropPointFromClient(
  clientX: number,
  clientY: number,
): Vec3 | null {
  if (!dropCtx) return null
  const {gl, camera} = dropCtx
  const rect = gl.domElement.getBoundingClientRect()
  const p = computeDropPoint(
    new Raycaster(),
    camera,
    getPlacementSurfaces(),
    rect,
    clientX,
    clientY,
  )
  return {x: p.x, y: p.y, z: p.z}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest packages/playground/src/shared/camera/hostFlows.test.ts`
Expected: PASS(7 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/hostFlows.ts packages/playground/src/shared/camera/hostFlows.test.ts
git commit -m "feat(playground): dropPointFromClient——宿主拖拽落点换算,场景捕获 gl/camera,未就绪返 null

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: createHostFlows 纯工厂 + pickerToggleHandler 分流

**Files:**
- Modify: `packages/playground/src/shared/camera/hostFlows.ts`
- Test: `packages/playground/src/shared/camera/hostFlows.test.ts`(追加 describe)

**Interfaces:**
- Consumes: 无新外部依赖(转发 Task 1 的类型)。
- Produces(App.tsx 与后续任务依赖,逐字一致):
  - `export type HostFlowDeps = {startPlacingFromLibrary: (entry: ModelEntry) => Promise<void>; placeLibraryEntryAt: (entry: ModelEntry, point: Vec3) => void; placePresetPath: (preset: PathPreset, at?: Vec3) => void; addCamera: () => void; addAnchor: () => void; cancelPlacing: () => void; importModel: (file: File) => Promise<ModelEntry>}`
  - `export function createHostFlows(deps: HostFlowDeps): CameraFlows`
  - `export function pickerToggleHandler(hostCb: (() => void) | undefined, toggleFrame: (kind: 'model' | 'path') => void, kind: 'model' | 'path'): () => void`

- [ ] **Step 1: Write the failing test**

在 `hostFlows.test.ts` 末尾追加:

```ts
import {createHostFlows, pickerToggleHandler} from './hostFlows'
import type {HostFlowDeps} from './hostFlows'
import type {ModelEntry} from './assetLibrary/types'

function makeDeps(): HostFlowDeps & Record<string, jest.Mock> {
  return {
    startPlacingFromLibrary: jest.fn(async () => undefined),
    placeLibraryEntryAt: jest.fn(),
    placePresetPath: jest.fn(),
    addCamera: jest.fn(),
    addAnchor: jest.fn(),
    cancelPlacing: jest.fn(),
    importModel: jest.fn(async () => ({id: 'm1'}) as unknown as ModelEntry),
  }
}
const entry = {id: 'e1', name: 'A'} as unknown as ModelEntry
const preset = {id: 'p1'} as never

describe('createHostFlows', () => {
  it('七个动作逐一转发到注入的 deps,dropPointFromClient 挂上模块实现', async () => {
    const deps = makeDeps()
    const flows = createHostFlows(deps)
    await flows.startPlacingModel(entry)
    expect(deps.startPlacingFromLibrary).toHaveBeenCalledWith(entry)
    flows.placeModelAt(entry, {x: 1, y: 2, z: 3})
    expect(deps.placeLibraryEntryAt).toHaveBeenCalledWith(entry, {
      x: 1, y: 2, z: 3,
    })
    flows.addPresetPath(preset, {x: 0, y: 5, z: 0})
    expect(deps.placePresetPath).toHaveBeenCalledWith(preset, {
      x: 0, y: 5, z: 0,
    })
    flows.addCamera()
    expect(deps.addCamera).toHaveBeenCalled()
    flows.addAnchor()
    expect(deps.addAnchor).toHaveBeenCalled()
    flows.cancelPlacing()
    expect(deps.cancelPlacing).toHaveBeenCalled()
    const file = new File(['x'], 'm.fbx')
    await flows.importModel(file)
    expect(deps.importModel).toHaveBeenCalledWith(file)
    // 未设 dropPoint 上下文时按模块实现返 null
    expect(flows.dropPointFromClient(0, 0)).toBeNull()
  })
})

describe('pickerToggleHandler', () => {
  it('宿主回调存在时只调宿主回调,toggleFrame 不执行', () => {
    const hostCb = jest.fn()
    const toggleFrame = jest.fn()
    pickerToggleHandler(hostCb, toggleFrame, 'model')()
    expect(hostCb).toHaveBeenCalledTimes(1)
    expect(toggleFrame).not.toHaveBeenCalled()
  })
  it('宿主回调缺省时走 toggleFrame(kind)', () => {
    const toggleFrame = jest.fn()
    pickerToggleHandler(undefined, toggleFrame, 'path')()
    expect(toggleFrame).toHaveBeenCalledWith('path')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest packages/playground/src/shared/camera/hostFlows.test.ts`
Expected: FAIL,`createHostFlows is not a function`。

- [ ] **Step 3: Write minimal implementation**

在 `hostFlows.ts` 末尾追加:

```ts
// ── 句柄组装与按钮分流 ──────────────────────────────────────
/** App 用既有函数注入组装 CameraFlows;纯转发,可单测。 */
export type HostFlowDeps = {
  startPlacingFromLibrary: (entry: ModelEntry) => Promise<void>
  placeLibraryEntryAt: (entry: ModelEntry, point: Vec3) => void
  placePresetPath: (preset: PathPreset, at?: Vec3) => void
  addCamera: () => void
  addAnchor: () => void
  cancelPlacing: () => void
  importModel: (file: File) => Promise<ModelEntry>
}
export function createHostFlows(deps: HostFlowDeps): CameraFlows {
  return {
    startPlacingModel: (entry) => deps.startPlacingFromLibrary(entry),
    placeModelAt: (entry, point) => deps.placeLibraryEntryAt(entry, point),
    addPresetPath: (preset, at) => deps.placePresetPath(preset, at),
    addCamera: () => deps.addCamera(),
    addAnchor: () => deps.addAnchor(),
    cancelPlacing: () => deps.cancelPlacing(),
    importModel: (file) => deps.importModel(file),
    dropPointFromClient,
  }
}

/** 顶栏按钮分流:宿主接了选择框就只通知宿主,否则开内置框体(现状)。 */
export function pickerToggleHandler(
  hostCb: (() => void) | undefined,
  toggleFrame: (kind: 'model' | 'path') => void,
  kind: 'model' | 'path',
): () => void {
  return () => {
    if (hostCb) hostCb()
    else toggleFrame(kind)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest packages/playground/src/shared/camera/hostFlows.test.ts`
Expected: PASS(9 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/hostFlows.ts packages/playground/src/shared/camera/hostFlows.test.ts
git commit -m "feat(playground): createHostFlows 纯工厂转发既有能力 + 顶栏按钮宿主分流

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: importModelFile——宿主外部模型走既有导入管线

**Files:**
- Create: `packages/playground/src/shared/camera/assetLibrary/importModelFile.ts`
- Test: `packages/playground/src/shared/camera/assetLibrary/importModelFile.test.ts`

**Interfaces:**
- Consumes: `planImport / executeImport / realImportDeps`(`importPipeline.ts:128/286/25`);`getLibrary`(`library.ts:158`);`Library`(`library.ts:10`);`LibraryBackend / LibraryEntry / ModelEntry`(`types.ts`)。测试复用 `importPipeline.test.ts:40` 的 `memoryBackend` 与 `depsFor` 模式(本任务测试内自建一份,不跨测试文件 import)。
- Produces(Task 5 的 App 组装依赖):
  - `export async function importModelFile(file: File, library?: Library, deps?: ImportDeps): Promise<ModelEntry>` —— `library` 缺省 `getLibrary()`,`deps` 缺省 `realImportDeps()`;导入完成后返回**本次新建**的 model 条目;未找到新建条目时 throw `new Error('[hostFlows] 模型导入失败:未找到新建条目')`。

- [ ] **Step 1: Write the failing test**

```ts
/**
 * importModelFile:宿主外部模型入库——planImport + executeImport 复用
 * 既有导入管线,按 id 差分找回新建条目返回。假 backend/deps 模式同
 * importPipeline.test.ts。
 */
import {importModelFile} from './importModelFile'
import type {ImportDeps} from './importPipeline'
import {Library} from './library'
import type {LibraryBackend, LibraryEntry} from './types'
import {Group, Bone, Mesh, BoxGeometry, MeshBasicMaterial} from 'three'

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

function depsFor(
  map: Record<string, {root: Group}>,
): ImportDeps {
  return {
    load: async (f) => {
      const hit = map[f.name]
      if (!hit) throw new Error('无法解析')
      return {root: hit.root, animations: []}
    },
    exportModel: async () => new TextEncoder().encode('glb').buffer,
    exportAnimation: async () => new TextEncoder().encode('anim').buffer,
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
  } as LibraryBackend
}

describe('importModelFile', () => {
  it('导入 FBX 后返回新建的 model 条目', async () => {
    const backend = memoryBackend()
    const library = new Library(backend)
    const deps = depsFor({'robot.fbx': {root: skinnedModel('hips')}})
    const file = new File(['x'], 'robot.fbx')
    const entry = await importModelFile(file, library, deps)
    expect(entry.kind).toBe('model')
    // 条目真实入库:再列一次拿得到
    const all = await backend.listEntries('model')
    expect(all.some((e) => e.id === entry.id)).toBe(true)
  })
  it('连续导入两个模型,各自返回各自的新条目', async () => {
    const backend = memoryBackend()
    const library = new Library(backend)
    const deps = depsFor({
      'a.fbx': {root: skinnedModel('hips')},
      'b.fbx': {root: skinnedModel('spine')},
    })
    const first = await importModelFile(new File(['x'], 'a.fbx'), library, deps)
    const second = await importModelFile(new File(['x'], 'b.fbx'), library, deps)
    expect(first.id).not.toBe(second.id)
    expect((await backend.listEntries('model')).length).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest packages/playground/src/shared/camera/assetLibrary/importModelFile.test.ts`
Expected: FAIL,`Cannot find module './importModelFile'`。

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * 宿主外部模型入库:File → 既有导入管线(planImport/executeImport)。
 * 放置管线只认库条目(按 id 解析 blob),外部模型必须真实入库,
 * 姿势/骨架匹配/持久化全部照常。library/deps 可注入(测试用)。
 */
import {planImport, executeImport, realImportDeps} from './importPipeline'
import type {ImportDeps} from './importPipeline'
import {getLibrary} from './library'
import type {Library} from './library'
import type {ModelEntry} from './types'

export async function importModelFile(
  file: File,
  library: Library = getLibrary(),
  deps: ImportDeps = realImportDeps(),
): Promise<ModelEntry> {
  const before = new Set(
    (await library.backend.listEntries('model')).map((e) => e.id),
  )
  const plan = await planImport([file], library.backend, deps)
  // 宿主场景无"相似条目"交互,一律保留为新条目
  await executeImport(
    plan,
    plan.similar.map(() => 'keep'),
    library,
  )
  const models = await library.backend.listEntries('model')
  const created = models.find((m) => !before.has(m.id))
  if (!created || created.kind !== 'model') {
    throw new Error('[hostFlows] 模型导入失败:未找到新建条目')
  }
  return created
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest packages/playground/src/shared/camera/assetLibrary/importModelFile.test.ts`
Expected: PASS(2 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/assetLibrary/importModelFile.ts packages/playground/src/shared/camera/assetLibrary/importModelFile.test.ts
git commit -m "feat(playground): importModelFile——宿主外部模型走既有导入管线入库,返回新建条目

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: App 集成——三 props、句柄交付、按钮分流、frame 门控

**Files:**
- Modify: `packages/playground/src/shared/camera/App.tsx`(props 定义处 `607`;TopToolbar 渲染 `1465–1479`;四个框体渲染 `1545–1580`;Canvas 子树 `1685` 起;flows 组装插在 `return (` 前约 1457 行)

**Interfaces:**
- Consumes: Task 1–4 全部导出(`createHostFlows / pickerToggleHandler / setHostFlowsHandle / setPlacingSnapshot / setDropPointContext / dropPointFromClient / usePlacing / importModelFile`);App 内既有 `startPlacingFromLibrary / placeLibraryEntryAt / cancelPlacing`(placement 控制器解构处)、`placePresetPath`(约 1105 行 useCallback)、`addCamera / addAnchor`、`toggleFrame`(916 行)。
- Produces: `App` 新增可选 props(宿主接入面,与规格 §1 逐字一致):
  - `onFlows?: (flows: CameraFlows) => void`
  - `onOpenModelPicker?: () => void`
  - `onOpenPathPicker?: () => void`

- [ ] **Step 1: 写组件级接线测试(先红)**

Create `packages/playground/src/shared/camera/App.hostFlows.test.tsx`:

```tsx
/**
 * App 宿主接线:三 props 的透传与默认行为。App 内含 R3F Canvas,
 * jsdom 下渲染成本高——本文件只测纯接线逻辑(HostFlowsWiring 子组件
 * 抽出,见实现),不整树渲染 App。
 */
import React from 'react'
import {act} from 'react-dom/test-utils'
import ReactDOM from 'react-dom/client'
import {
  getHostFlowsHandle,
  getPlacingSnapshot,
} from './hostFlows'

// HostFlowsWiring 在 App.tsx 内导出(实现见 Step 3)
import {HostFlowsWiring} from './App'

describe('HostFlowsWiring', () => {
  it('mount 时交付句柄并挂注册表,unmount 清空注册表', () => {
    const flows = {fake: true} as never
    const onFlows = jest.fn()
    const el = document.createElement('div')
    const root = ReactDOM.createRoot(el)
    act(() => {
      root.render(<HostFlowsWiring flows={flows} onFlows={onFlows} />)
    })
    expect(onFlows).toHaveBeenCalledWith(flows)
    expect(getHostFlowsHandle()).toBe(flows)
    act(() => {
      root.unmount()
    })
    expect(getHostFlowsHandle()).toBeNull()
    el.remove()
  })
})

describe('默认行为等价(回归)', () => {
  it('placing 快照接线未运行时为 null', () => {
    expect(getPlacingSnapshot()).toBeNull()
  })
})
```

Run: `yarn jest packages/playground/src/shared/camera/App.hostFlows.test.tsx`
Expected: FAIL,`HostFlowsWiring` 未导出。

- [ ] **Step 2: 实现——App.tsx 五处接线**

(1) props 签名(607 行):

```tsx
export default function App({
  onFlows,
  onOpenModelPicker,
  onOpenPathPicker,
}: {
  /** 场景 mount 后一次性交付能力句柄;句柄生命周期内稳定 */
  onFlows?: (flows: CameraFlows) => void
  /** 点了顶栏"添加模型"按钮;不传 = 打开内置模型框体(现状) */
  onOpenModelPicker?: () => void
  /** 点了顶栏"添加路径"按钮;不传 = 打开内置路径框体(现状) */
  onOpenPathPicker?: () => void
} = {}) {
```

(2) import(并入现有 import 区):

```tsx
import {
  createHostFlows,
  pickerToggleHandler,
  setDropPointContext,
  setHostFlowsHandle,
  setPlacingSnapshot,
} from './hostFlows'
import type {CameraFlows} from './hostFlows'
import {importModelFile} from './assetLibrary/importModelFile'
```

(3) flows 组装与交付:**位置在 `return (` 之前(约 1457 行)**——`placePresetPath`(1105)、`addCamera`、`addAnchor` 都在组件体内更靠前定义,放这里保证全部就绪(放解构处会触发暂时性死区):

```tsx
// ── 宿主能力句柄(规格:host-picker-integration)────────────
// 纯转发既有函数;宿主注入自己的选择框后,经 onFlows 拿到句柄,
// 在选择框里调 startPlacingModel(点选)/ placeModelAt + dropPointFromClient(拖拽)。
const flows = useMemo(
  () =>
    createHostFlows({
      startPlacingFromLibrary,
      placeLibraryEntryAt,
      placePresetPath,
      addCamera,
      addAnchor,
      cancelPlacing,
      importModel: importModelFile,
    }),
  [
    startPlacingFromLibrary,
    placeLibraryEntryAt,
    placePresetPath,
    addCamera,
    addAnchor,
    cancelPlacing,
  ],
)
useEffect(() => {
  setHostFlowsHandle(flows)
  onFlows?.(flows)
  return () => setHostFlowsHandle(null)
}, [flows, onFlows])
useEffect(() => {
  setPlacingSnapshot(placing)
}, [placing])
```

(4) TopToolbar 接线(1466–1467 行替换):

```tsx
onToggleModelLibrary={useMemo(
  () => pickerToggleHandler(onOpenModelPicker, toggleFrame, 'model'),
  [onOpenModelPicker, toggleFrame],
)}
onTogglePathLibrary={useMemo(
  () => pickerToggleHandler(onOpenPathPicker, toggleFrame, 'path'),
  [onOpenPathPicker, toggleFrame],
)}
```

(注意:把 useMemo 提到组件体顶部变量再传 prop,勿在 JSX 内联调用 hook——保持 JSX 处只引用变量。)

```tsx
const handleToggleModel = useMemo(
  () => pickerToggleHandler(onOpenModelPicker, toggleFrame, 'model'),
  [onOpenModelPicker, toggleFrame],
)
const handleTogglePath = useMemo(
  () => pickerToggleHandler(onOpenPathPicker, toggleFrame, 'path'),
  [onOpenPathPicker, toggleFrame],
)
// JSX 处:
//   onToggleModelLibrary={handleToggleModel}
//   onTogglePathLibrary={handleTogglePath}
```

(5) 框体门控(1545 与 1554 行的两个渲染分支,条件追加宿主接管判断):

```tsx
{!onOpenModelPicker && frameOpen.model && (
  <AssetLibraryPanel
    // ...既有 props 一行不动
  />
)}
{!onOpenPathPicker && frameOpen.path && (
  <AssetLibraryPanel
    // ...既有 props 一行不动
  />
)}
```

(6) 落点上下文捕获组件(App.tsx 底部,`export default App` 之前):

```tsx
/**
 * 宿主拖拽落点的上下文捕获:把 gl/camera 塞进 hostFlows 模块,
 * 宿主 dropPointFromClient 闭包读取。挂 Canvas 子树,卸载即清。
 */
function HostFlowsDropPointCapture() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    setDropPointContext({gl, camera})
    return () => setDropPointContext(null)
  }, [gl, camera])
  return null
}

/** 句柄交付/清理独立成组件,便于脱离整树做单测。 */
export function HostFlowsWiring({
  flows,
  onFlows,
}: {
  flows: CameraFlows
  onFlows?: (f: CameraFlows) => void
}) {
  useEffect(() => {
    setHostFlowsHandle(flows)
    onFlows?.(flows)
    return () => setHostFlowsHandle(null)
  }, [flows, onFlows])
  return null
}
```

并把 Step (3) 中的交付 effect 换成 `<HostFlowsWiring flows={flows} onFlows={onFlows} />`(渲染在组件体根部任意稳定位置,如 TopToolbar 之前),删除原内联 effect。

(7) Canvas 子树(1685 行 `<Canvas>` 内、`SheetProvider` 旁)挂捕获:

```tsx
<HostFlowsDropPointCapture />
```

- [ ] **Step 3: Run tests**

Run: `yarn jest packages/playground/src/shared/camera/App.hostFlows.test.tsx packages/playground/src/shared/camera/hostFlows.test.ts`
Expected: 全 PASS。

Run: `npx tsc --noEmit -p packages/playground`
Expected: 0 错误。

Run: `yarn jest packages/playground/src/shared/camera 2>&1 | tail -5`
Expected: 全量(27+ 套件)绿。

- [ ] **Step 4: Commit**

```bash
git add packages/playground/src/shared/camera/App.tsx packages/playground/src/shared/camera/App.hostFlows.test.tsx
git commit -m "feat(playground): App 宿主接线——onFlows/onOpenModelPicker/onOpenPathPicker 三回调、句柄交付、按钮分流、frame 门控

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 收尾验证

**Files:** 无新增。

- [ ] **Step 1: 类型检查**

Run: `npx tsc --noEmit -p packages/core && npx tsc --noEmit -p packages/sync-server && npx tsc --noEmit -p packages/studio && npx tsc --noEmit -p packages/playground`
Expected: 全部 0 错误。

- [ ] **Step 2: camera 全量 + 关联套件**

Run: `yarn jest packages/playground/src/shared/camera packages/studio/src/panels/OutlinePanel 2>&1 | tail -5`
Expected: 全绿。

- [ ] **Step 3: 手工冒烟(浏览器,需用户执行)**

1. **默认行为回归**:playground 不传任何新 props 打开——顶栏"添加模型/添加路径"照常弹内置框体,点选/拖拽放置、路径预设、姿势动作全部与现状一致。
2. **宿主接管**:临时在 `index.tsx` 传 `onOpenModelPicker={() => alert('host picker')}`——点"添加模型"按钮弹 alert、内置框体**不**出现;"添加路径"不传则照常弹内置路径框体(混合接管)。
3. **句柄**:同页 `onFlows={(f) => (window.__flows = f))}`,控制台执行 `__flows.addCamera()`——相机出现;`__flows.dropPointFromClient(innerWidth/2, innerHeight/2)` 返回三维坐标;放置模式下 `usePlacing` 有值(宿主组件订阅验证留给真实接入方)。
4. **importModel**:控制台 `f = new File([await (await fetch(模型url)).blob()], 'test.fbx'); __flows.importModel(f)`——库面板出现新条目,可点选放置。

- [ ] **Step 4: 文档**

在 `docs/superpowers/specs/2026-09-21-host-picker-integration-design.md` 附录的宿主接入示例处补一句:`importModel` 为正式接口(规格 §2 已定),无需改动。若冒烟发现示例与实际接口有出入,修正规格附录并提交一个 docs commit。

---

## Self-Review 记录

- **Spec 覆盖**:§1 三回调→T5;§2 句柄八方法→T1(类型)/T3(转发)/T4(importModel)/T2(dropPointFromClient);§3 usePlacing→T1;§4 库内调整四点→T5(1、2、3)与 T2(4 的捕获半);§5 示例→T6 冒烟验证;错误边界(未就绪返 null/不抛)→T1/T2 测试;测试策略→各任务 TDD + T6。
- **与调查结论的对齐**:规格原文的 `makeExternalModelEntry` 薄工厂经代码核实不可行(放置管线只认库条目),已改写规格为 `importModelFile`(planImport/executeImport 既有管线),计划 Task 4 落地。
- **占位符扫描**:无 TBD/TODO;每个代码步骤可直接转写;测试代码完整给出。
- **类型一致性**:`CameraFlows` 八方法签名 T1 定义、T3/T4/T5 引用一致;`HostFlowDeps` 七键与 App 注入的既有函数签名逐一核对(startPlacingFromLibrary 异步、placeLibraryEntryAt/placePresetPath 同步,签名与 PlacementManager/App 现状一致);`pickerToggleHandler` 的 kind 字面量与 App 的 `LibraryFrameKind` 兼容('model'|'path' 是其子集)。
- **已知风险**:T5 的 `useMemo` 依赖数组若漏项会造陈旧闭包——步骤中已给出完整依赖列表;`toggleFrame` 的 useCallback 稳定性来自既有代码(916 行),不改动。
