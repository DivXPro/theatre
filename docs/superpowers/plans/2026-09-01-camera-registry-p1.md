# 相机注册表(真创建/真删除)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 相机从"代码写死挂载"改成"注册表驱动的真创建/真删除",让 添加相机/删除相机 从空场景开始可玩,结构为多相机(P2)铺路。

**Architecture:** 照搬放置模型(Placements)的注册表模式:一个大纲里的注册表对象存相机清单(JSON),每台相机 = 一对 theatre 对象(相机+Target),App 按清单渲染 ShotCamera;添加=注册表加行(组件挂载即创建对象),删除=forgetObject 清持久数据+注册表移除(组件卸载即大纲行消失)。P1 上限一台。

**Tech Stack:** theatre fork(@dreamerbird)、r3f、jest、playwright 浏览器实测。

**Spec:** docs/superpowers/specs/2026-09-01-camera-menu-reorg-design.md(菜单归属原则)+ 2026-09-01 会话决议(见下)。

## 会话决议(本计划的权威依据)

1. 相机**真删**:不要"active 开关藏起来"的方案(用户明确否决);大纲行、视锥、小窗、持久数据都要没。
2. 结构为多相机铺路:注册表清单模式,P1 上限一台(工具条置灰),P2 放开上限+活动相机。
3. 导出视频 = 录"当前相机"(P1 唯一那台;P2 录活动相机——查看此镜头即设为活动);无相机时导出置灰,提示"先添加相机"。
4. 路径不动结构:空=不存在;本次只做一次性状态清理(清空旧弧),不加路径注册表(P3 的事)。
5. 新相机落地取景 = 当前导演视角(机位+朝向+Target 都从导演那对拿)。
6. 没有相机时:添加路径的播种弧从导演视角取(有相机时仍从相机取,不变)。

## Global Constraints

- 只在用户亲口说"提交"时执行 git add/commit/push;实现代理一律不提交。
- 绝不碰用户未跟踪文件:.claude/、.ignore、.mcp.json、AGENTS.md、opencode.json、examples/dom-cra/src/react-app-env.d.ts。
- jest 一律从仓库根目录跑;浏览器验证由控制者做(vite `npx vite --port 5199 --strictPort` 从 packages/playground 起,验完停)。
- 传给 sheet.object 的 config 和 editable 的 objectActions 必须是稳定引用(useMemo/模块级缓存)——t.string/t.number 之外的 propTypes 每次调用生成新闭包,重复调用不同引用会抛 "called twice with different config"。
- 工作区已有未提交的菜单重构 P1 改动(BASE 1dbc964 的 diff 会包含它们);本计划在其上叠加,评审只看本任务范围。
- 删除相机的 forgetObject 对"没写过任何覆盖/轨道"的对象可能触发 saaz draft 的老坑(TypeError)——每个对象单独一个事务 + try/catch 兜底(无持久数据的对象本来刷新即没,跳过即可)。
- 汇报用平实中文,不用黑话。

---

### Task 1: cameraRegistry —— 注册表模块 + 测试

**Files:**
- Create: `packages/playground/src/shared/camera/cameraRegistry.ts`
- Test: `packages/playground/src/shared/camera/cameraRegistry.test.ts`

**Interfaces:**
- Produces(后面任务全靠这些名字):
  ```ts
  export const CAMERAS_REGISTRY_KEY = 'Shot / Cameras'
  export type CameraEntry = {cameraKey: string; targetKey: string}
  export type CameraSeed = {
    position: {x: number; y: number; z: number}
    rotation: {x: number; y: number; z: number}
    targetPosition: {x: number; y: number; z: number}
  }
  export function getCamerasRegistry(sheet: ISheet): ISheetObject<any>
  export function readCameraEntries(registry: ISheetObject<any>): CameraEntry[]
  export function parseCameraEntries(json: string): CameraEntry[]
  export function nextCameraEntry(existing: readonly CameraEntry[]): CameraEntry
  export function useCamerasList(sheet: ISheet): CameraEntry[]
  export function stashCameraSeed(cameraKey: string, seed: CameraSeed): void
  export function consumeCameraSeed(cameraKey: string): CameraSeed | undefined
  export function addCameraToRegistry(sheet: ISheet, entry: CameraEntry, seed?: CameraSeed): void
  export function removeCamera(sheet: ISheet, entry: CameraEntry, objects: {camera?: ISheetObject<any>; target?: ISheetObject<any>}): void
  ```

- [ ] **Step 1: 写测试**

```ts
// packages/playground/src/shared/camera/cameraRegistry.test.ts
import {
  nextCameraEntry,
  parseCameraEntries,
  stashCameraSeed,
  consumeCameraSeed,
} from './cameraRegistry'

describe('parseCameraEntries', () => {
  test('解析合法清单;坏 JSON/非数组回退空', () => {
    expect(parseCameraEntries('[]')).toEqual([])
    const one = [{cameraKey: 'Shot / Camera', targetKey: 'Shot / Target'}]
    expect(parseCameraEntries(JSON.stringify(one))).toEqual(one)
    expect(parseCameraEntries('not json')).toEqual([])
    expect(parseCameraEntries('{"a":1}')).toEqual([])
  })
})

describe('nextCameraEntry', () => {
  test('空清单给第一台(兼容既有状态的 key)', () => {
    expect(nextCameraEntry([])).toEqual({
      cameraKey: 'Shot / Camera',
      targetKey: 'Shot / Target',
    })
  })
  test('占用后递增编号,跳过已用的', () => {
    const existing = [
      {cameraKey: 'Shot / Camera', targetKey: 'Shot / Target'},
      {cameraKey: 'Shot / Camera 3', targetKey: 'Shot / Target 3'},
    ]
    expect(nextCameraEntry(existing)).toEqual({
      cameraKey: 'Shot / Camera 2',
      targetKey: 'Shot / Target 2',
    })
  })
})

describe('相机取景种子', () => {
  test('consume 一次性:取走就没', () => {
    const seed = {
      position: {x: 1, y: 2, z: 3},
      rotation: {x: 0, y: 0, z: 0},
      targetPosition: {x: 0, y: 1, z: 0},
    }
    stashCameraSeed('Shot / Camera', seed)
    expect(consumeCameraSeed('Shot / Camera')).toEqual(seed)
    expect(consumeCameraSeed('Shot / Camera')).toBeUndefined()
    expect(consumeCameraSeed('没存过的')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest packages/playground/src/shared/camera/cameraRegistry.test.ts`(仓库根目录)
Expected: FAIL(模块不存在)

- [ ] **Step 3: 写 cameraRegistry.ts**

```ts
// packages/playground/src/shared/camera/cameraRegistry.ts
/**
 * 相机注册表:场景里有几台相机 = 注册表清单里有几行,每台相机是一对
 * theatre 对象(相机 + 瞄准点 Target)。照搬放置模型(Placements)的
 * 注册表模式,结构天然支持多相机;P1 在工具条上限一台。
 *
 * 生命周期:添加 = 注册表加一行(App 按清单渲染 ShotCamera,组件挂载
 * 即创建对象、大纲行出现);删除 = forgetObject 清持久数据 + 注册表
 * 移除(组件卸载,editable 清理时 detachObject,大纲行消失)。
 */
import {getStudioSync, types as t, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {useEffect, useMemo, useState} from 'react'

/** 注册表对象的 theatre key(大纲里显示为 "Cameras" 行,和 Placements 同款) */
export const CAMERAS_REGISTRY_KEY = 'Shot / Cameras'

/** 一台相机 = 一对 theatre 对象;清单里只存 key */
export type CameraEntry = {cameraKey: string; targetKey: string}

/** 新相机的初始取景(添加时从导演视角捕获,组件挂载后消费) */
export type CameraSeed = {
  position: {x: number; y: number; z: number}
  rotation: {x: number; y: number; z: number}
  targetPosition: {x: number; y: number; z: number}
}

/** 第一台沿用既有 key:老场景的相机数据就是这个名字 */
const FIRST_CAMERA: CameraEntry = {
  cameraKey: 'Shot / Camera',
  targetKey: 'Shot / Target',
}

export function getCamerasRegistry(sheet: ISheet) {
  return sheet.object(CAMERAS_REGISTRY_KEY, {list: t.string('[]')})
}

/** 解析清单 JSON;坏数据一律回退空(注册表是底账,勿手改) */
export function parseCameraEntries(json: string): CameraEntry[] {
  try {
    const list = JSON.parse(json)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function readCameraEntries(registry: ISheetObject<any>): CameraEntry[] {
  return parseCameraEntries(val(registry.props.list) as string)
}

/** 多相机(P2)的命名:第一台用既有 key,之后 Camera 2 / Camera 3… */
export function nextCameraEntry(
  existing: readonly CameraEntry[],
): CameraEntry {
  if (existing.length === 0) return FIRST_CAMERA
  const used = new Set(existing.map((e) => e.cameraKey))
  for (let n = 2; ; n++) {
    const cameraKey = `Shot / Camera ${n}`
    if (!used.has(cameraKey)) {
      return {cameraKey, targetKey: `Shot / Target ${n}`}
    }
  }
}

/** 响应式读相机清单:scrub 提交/撤销/同步都会触发 onValuesChange */
export function useCamerasList(sheet: ISheet): CameraEntry[] {
  const registry = useMemo(() => getCamerasRegistry(sheet), [sheet])
  const [list, setList] = useState<CameraEntry[]>(() =>
    readCameraEntries(registry),
  )
  useEffect(() => {
    setList(readCameraEntries(registry))
    return registry.onValuesChange(() => setList(readCameraEntries(registry)))
  }, [registry])
  return list
}

/**
 * 新相机的取景种子:组件挂载前对象还不存在,没法直接写属性——
 * 添加时先把种子存这里,ShotCamera 挂载后消费一次。
 */
const pendingSeeds = new Map<string, CameraSeed>()

export function stashCameraSeed(cameraKey: string, seed: CameraSeed) {
  pendingSeeds.set(cameraKey, seed)
}

export function consumeCameraSeed(cameraKey: string): CameraSeed | undefined {
  const seed = pendingSeeds.get(cameraKey)
  pendingSeeds.delete(cameraKey)
  return seed
}

/** 添加相机:注册表加一行(App 按清单渲染,组件挂载即创建对象) */
export function addCameraToRegistry(
  sheet: ISheet,
  entry: CameraEntry,
  seed?: CameraSeed,
) {
  const studio = getStudioSync()
  if (!studio) return
  const registry = getCamerasRegistry(sheet)
  const list = readCameraEntries(registry)
  const scrub = studio.scrub()
  scrub.capture(({set}) =>
    set(registry.props.list, JSON.stringify([...list, entry])),
  )
  scrub.commit()
  if (seed) stashCameraSeed(entry.cameraKey, seed)
}

/**
 * 删除相机:先清持久数据(forgetObject:静态覆盖 + 时间轴轨道,
 * 同步到所有客户端),再从注册表移除(组件卸载 → detachObject →
 * 大纲行消失)。两个事务,撤销也是两步,都能完整回滚。
 */
export function removeCamera(
  sheet: ISheet,
  entry: CameraEntry,
  objects: {camera?: ISheetObject<any>; target?: ISheetObject<any>},
) {
  const studio = getStudioSync()
  if (!studio) return
  for (const obj of [objects.camera, objects.target]) {
    if (!obj) continue
    try {
      studio.transaction(({forgetObject}) => forgetObject(obj as any))
    } catch (err) {
      // forgetObject 对"没写过任何覆盖/轨道"的对象会触发 saaz draft 的
      // 老坑(TypeError);这类对象本来就没在持久态留痕,刷新即没,跳过
      console.warn('[camera] forgetObject 跳过(对象无持久数据)', err)
    }
  }
  const registry = getCamerasRegistry(sheet)
  const list = readCameraEntries(registry)
  const scrub = studio.scrub()
  scrub.capture(({set}) =>
    set(
      registry.props.list,
      JSON.stringify(list.filter((e) => e.cameraKey !== entry.cameraKey)),
    ),
  )
  scrub.commit()
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest packages/playground/src/shared/camera/cameraRegistry.test.ts`(仓库根目录)
Expected: PASS

---

### Task 2: ShotCamera 参数化 key + 消费取景种子

**Files:**
- Modify: `packages/playground/src/shared/camera/ShotCamera.tsx`

**Interfaces:**
- Consumes: Task 1 的 `CameraEntry`/`consumeCameraSeed`。
- Produces: `ShotCamera` 新 props 签名(App Task 4 按这个挂):
  ```tsx
  <ShotCamera
    cameraKey={entry.cameraKey}
    targetKey={entry.targetKey}
    makeDefault={shotView}
    cameraObjRef={shotCameraObjRef}
    targetObjRef={shotTargetObjRef}
    onCameraContextMenu={(x, y) => ...}
  />
  ```

- [ ] **Step 1: 改 props 和 theatreKey**

`ShotCamera` props 加 `cameraKey: string`、`targetKey: string`(必填)。两处 theatreKey 写死值改掉:
- `ShotCamera.tsx` 约 376 行:`theatreKey="Shot / Camera"` → `theatreKey={cameraKey}`
- 约 400 行:`theatreKey="Shot / Target"` → `theatreKey={targetKey}`

- [ ] **Step 2: 挂载时消费种子**

组件内加(import `useLayoutEffect`、`consumeCameraSeed`):

```tsx
// 新相机落地即取景:添加时从导演视角捕获的种子(机位/朝向/瞄准点),
// 挂载后消费一次——此后相机数据归面板/拖拽/时间轴管,种子不再介入
useLayoutEffect(() => {
  const seed = consumeCameraSeed(cameraKey)
  const camObj = cameraObjRef.current
  const targetObj = targetObjRef.current
  if (!seed || !camObj || !targetObj) return
  const studio = getStudioSync()
  if (!studio) return
  const scrub = studio.scrub()
  scrub.capture(({set}) => {
    set(camObj.props.position, seed.position)
    set(camObj.props.rotation, seed.rotation)
    set(targetObj.props.position, seed.targetPosition)
  })
  scrub.commit()
  // cameraObjRef/targetObjRef 是稳定引用;子组件(editable)的 layout
  // effect 先跑,到这里 objRef 已填好
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [cameraKey])
```

- [ ] **Step 3: 检查组件内其它写死 key**

全文搜 `"Shot /` ——除 theatreKey 外不应再有写死的相机 key(POS_PATH_KEY 是路径,不动)。

- [ ] **Step 4: 测试**

Run: `npx jest packages/playground`(仓库根目录)全过。

---

### Task 3: 右键菜单加"删除相机" + TopToolbar 接活

**Files:**
- Modify: `packages/playground/src/shared/camera/menuModel.ts`(+ test)
- Modify: `packages/playground/src/shared/camera/TopToolbar.tsx`

**Interfaces:**
- Produces:
  ```ts
  buildCameraMenuItems(opts: {onViewShot: () => void; onDeleteCamera: () => void}): ContextMenuItem[]
  ```
  ```tsx
  TopToolbar props 变化:
  + addCameraEnabled: boolean
  + onAddCamera: () => void
  + exportDisabled: boolean        // 无相机时 true
  (原有的 placing/onOpenLibrary/addPathEnabled/onAddPath/exportSinks/exporting/onPickExportSink/onStopExport 不变)
  ```

- [ ] **Step 1: menuModel 加删除项**

`buildCameraMenuItems` 改为:

```ts
/** 右键相机(视锥/机身):镜头视角入口 + 删除(真删:注册表移除+持久数据清理) */
export function buildCameraMenuItems(opts: {
  onViewShot: () => void
  onDeleteCamera: () => void
}): ContextMenuItem[] {
  return [
    {type: 'normal', label: '查看此镜头', callback: opts.onViewShot},
    {type: 'separator'},
    {type: 'normal', label: '删除相机', callback: opts.onDeleteCamera},
  ]
}
```

- [ ] **Step 2: 更新 menuModel.test.ts 的相机菜单用例**

改为断言三项:查看此镜头 / separator / 删除相机,两个回调各自触发。

- [ ] **Step 3: TopToolbar**

props 加 `addCameraEnabled`/`onAddCamera`/`exportDisabled`(见 Interfaces)。
- "添加相机"按钮不再是恒灰占位:

```tsx
<button
  disabled={!addCameraEnabled}
  onClick={onAddCamera}
  style={buttonStyle(!addCameraEnabled)}
  title={
    addCameraEnabled
      ? '从当前导演视角创建一台相机'
      : '已存在相机;多相机将在后续版本开放'
  }
>
  添加相机
</button>
```

- "导出视频"按钮:`disabled={exportDisabled && !exporting}`,disabled 时 title `"先添加相机"`,否则沿用原文案。`buttonStyle(exportDisabled && !exporting, exporting)`。

- [ ] **Step 4: 测试**

Run: `npx jest packages/playground`(仓库根目录)全过。

---

### Task 4: App 接线 —— 注册表渲染 + 添加/删除 + 无相机降级

**Files:**
- Modify: `packages/playground/src/shared/camera/App.tsx`

**Interfaces:**
- Consumes: Task 1 全部、Task 2 的 ShotCamera 签名、Task 3 的菜单/工具条签名。

- [ ] **Step 1: 注册表接入**

```tsx
import {
  addCameraToRegistry,
  nextCameraEntry,
  removeCamera,
  useCamerasList,
} from './cameraRegistry'
```

App 组件内(放在 shotCameraObjRef 声明之后):

```tsx
// 相机清单:P1 上限一台(工具条置灰控制);P2 多相机时这里改成
// "活动相机"(右键查看此镜头 = 设为活动),refs 也要按实例分开
const cameras = useCamerasList(sheet)
const activeCamera = cameras.length > 0 ? cameras[0] : null

// 添加相机:新机位/朝向/瞄准点都取当前导演视角(用户正看着的画面)
const addCamera = useCallback(() => {
  if (cameras.length > 0) return
  const entry = nextCameraEntry(cameras)
  const mainCam = cameraObjRef.current
  const mainTarget = targetObjRef.current
  const seed =
    mainCam && mainTarget
      ? {
          position: val(mainCam.props.position),
          rotation: val(mainCam.props.rotation),
          targetPosition: val(mainTarget.props.position),
        }
      : undefined
  addCameraToRegistry(sheet, entry, seed)
}, [cameras, sheet])

// 删除相机(右键菜单):真删——持久数据清掉、大纲行消失、回到无相机态
const deleteCamera = useCallback(() => {
  const entry = cameras[0]
  if (!entry) return
  removeCamera(sheet, entry, {
    camera: shotCameraObjRef.current,
    target: shotTargetObjRef.current,
  })
}, [cameras, sheet])
```

- [ ] **Step 2: 无相机降级**

```tsx
// 无相机:镜头视角强制退出(没有镜头可看)
useEffect(() => {
  if (!activeCamera && shotView && !exporting) setShotView(false)
}, [activeCamera, shotView, exporting])

// 导出中途相机被删:取消录制(丢弃)
useEffect(() => {
  if (exporting && !activeCamera) exportHandleRef.current?.abort()
}, [exporting, activeCamera])
```

targetMissing 的 trySubscribe effect:deps 加 `activeCamera`,开头加 `if (!activeCamera) { setTargetMissing(false); return }`(没有相机不再轮询)。

画中画边框(`{!shotView && (...)}` 那段,约 969 行)改成 `{!shotView && activeCamera && (...)}`。

- [ ] **Step 3: 播种回退导演视角**

`addPosPathPoint` 的 seed 改为:

```tsx
// 有相机从相机机位播种;没有相机(还没添加)从导演视角播种
const cam = shotCameraObjRef.current
const target = shotTargetObjRef.current
const mainCam = cameraObjRef.current
const mainTarget = targetObjRef.current
const seed =
  cam && target
    ? seedArcPoints(val(cam.props.position), val(target.props.position))
    : mainCam && mainTarget
      ? seedArcPoints(val(mainCam.props.position), val(mainTarget.props.position))
      : undefined
```

- [ ] **Step 4: 工具条和右键菜单接线**

TopToolbar 挂载处加三个 prop:`addCameraEnabled={cameras.length === 0}`、`onAddCamera={addCamera}`、`exportDisabled={!activeCamera}`。

cameraMenu 的 items 改为 `buildCameraMenuItems({onViewShot: () => setShotView(true), onDeleteCamera: deleteCamera})`。

- [ ] **Step 5: 按清单渲染 ShotCamera**

`<ShotCamera makeDefault={shotView} ... />`(约 1148 行)改为:

```tsx
{cameras.map((entry) => (
  <ShotCamera
    key={entry.cameraKey}
    cameraKey={entry.cameraKey}
    targetKey={entry.targetKey}
    makeDefault={shotView}
    cameraObjRef={shotCameraObjRef}
    targetObjRef={shotTargetObjRef}
    onCameraContextMenu={(x, y) => setCameraMenu({x, y})}
  />
))}
```

- [ ] **Step 6: 测试**

Run: `npx jest packages/playground packages/core`(仓库根目录)全过。

---

### Task 5: 收尾 —— 全量回归 + 记忆 + 状态清理

**Files:**
- Modify: 视浏览器验证结果而定的注释同步
- Modify: `/Users/huhui/.claude/projects/-Users-huhui-Projects-theatre/memory/camera-playground-ops.md`

- [ ] **Step 1: 全量测试**

Run: `npx jest packages/playground packages/core packages/r3f`(仓库根目录)全过。

- [ ] **Step 2: 浏览器验证矩阵 + 一次性状态清理(控制者做)**

一次性清理(在当前共享状态上,经 scrub/transaction 提交,同步给所有客户端):
1. forgetObject 旧的 'Shot / Camera' + 'Shot / Target'(它们有覆盖,不会踩老坑)——旧相机数据彻底清掉。
2. 路径:points 清空、变换回默认(position 0,0,0 / rotation 0,0,0 / scale 1,1,1)、行进进度归 0。
3. 清完刷新:大纲无 Camera/Target、无路径线、添加相机/添加路径都可点、导出视频置灰。

验证矩阵:
1. 空场景:大纲有 Cameras 注册行、无 Shot / Camera;添加相机/添加路径可点,导出置灰(悬浮提示"先添加相机")。
2. 点添加相机 → 相机出现在导演视角的位置(视锥+小窗出现),大纲有 Shot / Camera + Shot / Target,按钮变灰。
3. 无路径时点添加路径 → 从相机机位播种弧 + 进编辑(和现状一致)。
4. 删除路径(右键)→ 添加路径又可点;无相机时(先删相机)点添加路径 → 从导演视角播种。
5. 右键相机 → 查看此镜头 → Esc 返回;右键相机 → 删除相机 → 视锥/小窗/大纲行全没,添加相机又可点。
6. 有相机时导出视频全流程(下选一个 sink,Esc 取消);删除相机后导出置灰。
7. 刷新页面:添加过的相机还在(持久化);删除过的相机不回来(forgetObject 生效)。
8. 回归:路径编辑(Tab/加点/删点)、相机面板动作(对齐到路径起点/恢复 Target)、模型右键菜单、jest 全绿。

- [ ] **Step 3: 记忆更新**

`camera-playground-ops.md` 追加/修正:相机注册表模式(CAMERAS_REGISTRY_KEY、真创建/真删除配方:forgetObject 每对象单独事务+try/catch 兜底老坑、注册表移除即卸载)、取景种子 stash/consume、大纲行=挂载实例(卸载即消失,不需要 forgetObject 也有视觉效果)、导出=录当前相机(P2 活动相机)、播种回退导演视角。修正菜单体系条里"添加相机 P1 恒灰"的过时描述。

- [ ] **Step 4: Commit**(仅用户说"提交"时执行)
