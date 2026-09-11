# 统一放置面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 资产库面板加「路径」tab 统一放置入口:模型/路径预设点击即放、拖拽落点;姿势/动作维持点击套用;顶栏收编为 资产库/添加相机/导出视频。

**Architecture:** 纯函数层(`pathPresets.ts` 预设形状 + 默认落点、`dropPoint.ts` 指针→场景落点数学)与 UI 层分离。拖拽不用 HTML5 DnD,用指针事件:卡片按下超 4px 阈值进入拖拽态,模型拖拽复用现有 placing 幽灵(按下即进 placing、松手即 confirm),路径拖拽用新的落点标记组件。

**Tech Stack:** React 18 + @react-three/fiber + three.js + theatre.js playground;jest + jest-esbuild。

**Spec:** `docs/superpowers/specs/2026-09-12-unified-placement-panel-design.md`(用户已确认的四项决策在里面,执行前必读)

## Global Constraints

- **只动 `packages/playground`**;1.0 公开 API 已冻结,不改 core/studio/r3f/saaz 的任何公开接口。
- theatre prop configs 必须模块级稳定深等引用;`sheet.object`/`getPathMeta` 查找即建——探测存在性一律先用 `pathExists`。
- 注册表是增删的唯一事实来源;路径「先播种再写清单」(没点就不出现)。
- jest 用 jest-esbuild,**不提升 jest.mock**;需要 mock 时用 `jest.doMock` + `jest.resetModules()` + 运行时 require。
- 提交格式 `type(scope): 中文描述`,结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`;**逐文件 `git add`,禁止 `git add -u` / `git add .`**;每次提交后跑 `git checkout -- packages/dataverse/api/` 还原 lint-staged 再生的 typedoc 噪音。
- 测试命令:`yarn test packages/playground/src/shared/camera/<file>.test.ts`;类型检查:`yarn typecheck` 和 `npx tsc --noEmit -p packages/playground/tsconfig.json` 都要过(jest 不挂 App,TDZ 类错误只有 tsc 能抓)。
- 画布是 `frameloop="demand"`:程序化改动后要 invalidate 才重画。
- **如果发生了提示我,不要自动回退**:任何回退触发器触发时停下来问用户。

---

### Task 1: 路径预设形状 + 默认落点纯函数

**Files:**
- Create: `packages/playground/src/shared/camera/pathPresets.ts`
- Test: `packages/playground/src/shared/camera/pathPresets.test.ts`

**Interfaces:**
- Consumes: `Vec3Like` from `./pathModel`(已存在,L20 `export type Vec3Like = {x: number; y: number; z: number}`)
- Produces:
  - `export type PathPreset = {id: 'circle' | 'line' | 'arc' | 'figure8'; name: string; icon: string}`
  - `export const PATH_PRESETS: readonly PathPreset[]`
  - `export function presetPoints(preset: PathPreset, center: Vec3Like): Vec3Like[]`
  - `export function findFreeSpot(occupied: readonly Vec3Like[], base?: Vec3Like): Vec3Like`

- [ ] **Step 1: 写失败测试**

创建 `packages/playground/src/shared/camera/pathPresets.test.ts`:

```ts
import {PATH_PRESETS, findFreeSpot, presetPoints} from './pathPresets'
import type {PathPreset} from './pathPresets'

const byId = (id: string): PathPreset => {
  const p = PATH_PRESETS.find((p) => p.id === id)
  if (!p) throw new Error(`missing preset ${id}`)
  return p
}

describe('presetPoints', () => {
  const center = {x: 10, y: 4, z: -2}

  it('环绕圆:半径 5 的 8 点,全部与中心共面(y 相等)', () => {
    const pts = presetPoints(byId('circle'), center)
    expect(pts).toHaveLength(8)
    for (const p of pts) {
      expect(p.y).toBe(4)
      expect(Math.hypot(p.x - 10, p.z + 2)).toBeCloseTo(5, 6)
    }
  })

  it('直线往返:2 点,长 10,中点是落点', () => {
    const pts = presetPoints(byId('line'), center)
    expect(pts).toHaveLength(2)
    expect(pts[0]).toEqual({x: 5, y: 4, z: -2})
    expect(pts[1]).toEqual({x: 15, y: 4, z: -2})
  })

  it('弧线:半径 6 的 180° 弧,5 点共面', () => {
    const pts = presetPoints(byId('arc'), center)
    expect(pts).toHaveLength(5)
    for (const p of pts) {
      expect(p.y).toBe(4)
      expect(Math.hypot(p.x - 10, p.z + 2)).toBeCloseTo(6, 6)
    }
    // 首尾张角 180°
    expect(pts[0].x).toBeCloseTo(16, 6)
    expect(pts[4].x).toBeCloseTo(4, 6)
  })

  it('8 字:12 点,两圆在落点相切', () => {
    const pts = presetPoints(byId('figure8'), center)
    expect(pts).toHaveLength(12)
    for (const p of pts) expect(p.y).toBe(4)
    // 左圆右缘与右圆左缘都过落点
    expect(pts[0].x).toBeCloseTo(10, 6)
    expect(pts[0].z).toBeCloseTo(-2, 6)
    expect(pts[6].x).toBeCloseTo(10, 6)
    expect(pts[6].z).toBeCloseTo(-2, 6)
  })
})

describe('findFreeSpot', () => {
  it('空场景落原点', () => {
    expect(findFreeSpot([])).toEqual({x: 0, y: 0, z: 0})
  })

  it('原点被占沿 +X 错开 2,直到空位', () => {
    expect(findFreeSpot([{x: 0.5, y: 0, z: 0.5}])).toEqual({x: 2, y: 0, z: 0})
    expect(
      findFreeSpot([
        {x: 0, y: 0, z: 0},
        {x: 2, y: 0, z: 0},
      ]),
    ).toEqual({x: 4, y: 0, z: 0})
  })

  it('远处占用不影响原点', () => {
    expect(findFreeSpot([{x: 10, y: 0, z: 10}])).toEqual({x: 0, y: 0, z: 0})
  })

  it('自定义 base 生效', () => {
    expect(findFreeSpot([], {x: 3, y: 0, z: 3})).toEqual({x: 3, y: 0, z: 3})
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn test packages/playground/src/shared/camera/pathPresets.test.ts`
Expected: FAIL,模块不存在

- [ ] **Step 3: 实现 pathPresets.ts**

创建 `packages/playground/src/shared/camera/pathPresets.ts`:

```ts
/**
 * 内置路径预设:4 种几何形状,给落点返回一串世界坐标路径点。
 * 纯函数,无 React/theatre 依赖。预设不可删改、不可自定义(用户决策)。
 *
 * 路径是相机轨迹:点都在 y = center.y 的水平面上(高度由调用方取
 * 活动相机当前 Y)。直线往返的"往返"由行进进度回摆实现,点列不重复。
 */
import type {Vec3Like} from './pathModel'

export type PathPreset = {
  id: 'circle' | 'line' | 'arc' | 'figure8'
  name: string
  icon: string
}

export const PATH_PRESETS: readonly PathPreset[] = [
  {id: 'circle', name: '环绕圆', icon: '⭕'},
  {id: 'line', name: '直线往返', icon: '↔️'},
  {id: 'arc', name: '弧线', icon: '◠'},
  {id: 'figure8', name: '8 字', icon: '♾️'},
]

const TAU = Math.PI * 2

/** 给落点返回该形状的路径点(世界坐标,共面于 y = center.y) */
export function presetPoints(preset: PathPreset, center: Vec3Like): Vec3Like[] {
  const {x: cx, y, z: cz} = center
  switch (preset.id) {
    case 'circle': {
      const r = 5
      const n = 8
      return Array.from({length: n}, (_, i) => {
        const a = (i / n) * TAU
        return {x: cx + r * Math.cos(a), y, z: cz + r * Math.sin(a)}
      })
    }
    case 'line':
      return [
        {x: cx - 5, y, z: cz},
        {x: cx + 5, y, z: cz},
      ]
    case 'arc': {
      const r = 6
      const n = 5
      return Array.from({length: n}, (_, i) => {
        const a = (i / (n - 1)) * Math.PI
        return {x: cx + r * Math.cos(a), y, z: cz + r * Math.sin(a)}
      })
    }
    case 'figure8': {
      const r = 3
      const per = 6
      const pts: Vec3Like[] = []
      // 左圆:圆心 (cx - r, cz),右缘过落点
      for (let i = 0; i < per; i++) {
        const a = (i / per) * TAU
        pts.push({x: cx - r + r * Math.cos(a), y, z: cz + r * Math.sin(a)})
      }
      // 右圆:圆心 (cx + r, cz),左缘过落点
      for (let i = 0; i < per; i++) {
        const a = (i / per) * TAU
        pts.push({x: cx + r - r * Math.cos(a), y, z: cz + r * Math.sin(a)})
      }
      return pts
    }
  }
}

/**
 * 模型点击放置的默认位:base(默认原点)被占时沿 +X 每次错开 2。
 * XZ 平面距离小于 1.5 视为占用;100 次保底防死循环。
 */
export function findFreeSpot(
  occupied: readonly Vec3Like[],
  base: Vec3Like = {x: 0, y: 0, z: 0},
): Vec3Like {
  const CLEAR_RADIUS = 1.5
  const STEP = 2
  let spot = {...base}
  for (let guard = 0; guard < 100; guard++) {
    const clash = occupied.some(
      (p) => Math.hypot(p.x - spot.x, p.z - spot.z) < CLEAR_RADIUS,
    )
    if (!clash) return spot
    spot = {x: spot.x + STEP, y: base.y, z: base.z}
  }
  return spot
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `yarn test packages/playground/src/shared/camera/pathPresets.test.ts`
Expected: PASS,8 个用例

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/pathPresets.ts packages/playground/src/shared/camera/pathPresets.test.ts
git commit -m "feat(playground): 路径预设形状与默认落点纯函数(环绕圆/直线/弧线/8字)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git checkout -- packages/dataverse/api/
```

---

### Task 2: 落点数学抽出共用 + PlacementManager 放置扩展

**Files:**
- Create: `packages/playground/src/shared/camera/dropPoint.ts`
- Test: `packages/playground/src/shared/camera/dropPoint.test.ts`
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`(`computePoint` 内联实现 L525-559;`usePlacementController` L337-430;`PlacementRig` 系列 L438-505;`PlacementRigCore` L512+)

**Interfaces:**
- Consumes: Task 1 无依赖(本任务与 Task 1 平行)
- Produces:
  - `export function computeDropPoint(raycaster: Raycaster, camera: Camera, surfaces: Iterable<Object3D>, rect: {left: number; top: number; width: number; height: number}, clientX: number, clientY: number): Vector3`(dropPoint.ts)
  - `export function getPlacementSurfaces(): ReadonlySet<Object3D>`(PlacementManager)
  - `export function readPlacementPositions(sheet: ISheet): Array<{x: number; y: number; z: number}>`(PlacementManager)
  - `placeLibraryEntryAt(entry: ModelEntry, point: {x: number; y: number; z: number}): void`(`usePlacementController` 返回值新增成员)
  - `PlacementRig` / `PlacementRigCore` 新增可选 prop `confirmOnPointerUp?: boolean`

- [ ] **Step 1: 写失败测试**

创建 `packages/playground/src/shared/camera/dropPoint.test.ts`:

```ts
import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
} from 'three'
import {computeDropPoint} from './dropPoint'

const rect = {left: 0, top: 0, width: 800, height: 600}

function groundCam() {
  const c = new PerspectiveCamera(50, 800 / 600, 0.1, 1000)
  c.position.set(0, 10, 20)
  c.lookAt(0, 0, 0)
  c.updateMatrixWorld()
  return c
}

describe('computeDropPoint', () => {
  it('指向地面:命中 y=0 平面', () => {
    const p = computeDropPoint(new Raycaster(), groundCam(), new Set(), rect, 400, 300)
    expect(p.y).toBeCloseTo(0, 6)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.z).toBeCloseTo(0, 6)
  })

  it('视线朝天:退到前方 30 个单位并压到地面', () => {
    const c = new PerspectiveCamera(50, 800 / 600, 0.1, 1000)
    c.position.set(0, 10, 20)
    c.lookAt(0, 30, -10) // 抬头,中心射线打不到地面
    c.updateMatrixWorld()
    const p = computeDropPoint(new Raycaster(), c, new Set(), rect, 400, 300)
    expect(p.y).toBe(0)
    expect(p.z).toBeCloseTo(-4.96, 1)
  })

  it('登记过的表面优先于地面', () => {
    const slab = new Mesh(new PlaneGeometry(100, 100), new MeshBasicMaterial())
    slab.rotation.x = -Math.PI / 2
    slab.position.y = 2
    slab.updateMatrixWorld()
    const p = computeDropPoint(new Raycaster(), groundCam(), new Set([slab]), rect, 400, 300)
    expect(p.y).toBeCloseTo(2, 6)
  })

  it('未登记的物体不参与命中(地面兜底)', () => {
    const p = computeDropPoint(new Raycaster(), groundCam(), new Set(), rect, 400, 300)
    expect(p.y).toBeCloseTo(0, 6)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn test packages/playground/src/shared/camera/dropPoint.test.ts`
Expected: FAIL,模块不存在

- [ ] **Step 3: 实现 dropPoint.ts**

创建 `packages/playground/src/shared/camera/dropPoint.ts`(从 `PlacementRigCore.computePoint` 原样抽出,逻辑不变):

```ts
/**
 * 指针位置 → 场景落点:登记过的物体表面优先,y=0 地面(数学平面,无限大)
 * 兜底,视线朝天/贴地时退到"前方 30 个单位、压到地面"——任何视角都有落点。
 * 从 PlacementRigCore 抽出,模型放置幽灵和路径预设落点标记共用。
 *
 * 不用不可见网格接事件:视线与地面平行时网格永远打不中,事件根本不触发。
 */
import {Plane, Raycaster, Vector2, Vector3} from 'three'
import type {Camera, Mesh, Object3D} from 'three'

const GROUND_PLANE = new Plane(new Vector3(0, 1, 0), 0)

export function computeDropPoint(
  raycaster: Raycaster,
  camera: Camera,
  surfaces: Iterable<Object3D>,
  rect: {left: number; top: number; width: number; height: number},
  clientX: number,
  clientY: number,
): Vector3 {
  const ndc = new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, camera)
  // 表面优先:只对登记过的落点表面检测,只认 Mesh 命中
  const surface = raycaster
    .intersectObjects([...surfaces], true)
    .find((h) => (h.object as Mesh).isMesh)
  const ground = raycaster.ray.intersectPlane(GROUND_PLANE, new Vector3())
  // 相机贴地(y≈0)时地面会在"相机脚下"命中(t≈0),这个命中比任何
  // 表面都"近"但就在相机自己身上,没有放置意义——半单位以内丢弃
  const usableGround =
    ground && raycaster.ray.origin.distanceTo(ground) > 0.5 ? ground : null
  if (
    surface &&
    (!usableGround ||
      surface.distance <= raycaster.ray.origin.distanceTo(usableGround))
  ) {
    return surface.point
  }
  if (usableGround) return usableGround
  // 视线与地面平行、朝天、或贴地:放到正前方 30 个单位、压到地面
  const ahead = raycaster.ray.at(30, new Vector3())
  ahead.y = 0
  return ahead
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `yarn test packages/playground/src/shared/camera/dropPoint.test.ts`
Expected: PASS,4 个用例

- [ ] **Step 5: PlacementManager 接入 computeDropPoint**

在 `PlacementManager.tsx`:

1. 顶部 import 加 `import {computeDropPoint} from './dropPoint'`,并从 three 的 import 里删掉不再直接用的 `Plane`(若仅 computePoint 在用)。
2. `PlacementRigCore` 里的 `groundPlane` useMemo 删除,`computePoint` 改为:

```ts
  const computePoint = useCallback(
    (clientX: number, clientY: number): Vector3 =>
      computeDropPoint(
        raycaster,
        camera,
        placementSurfaces,
        gl.domElement.getBoundingClientRect(),
        clientX,
        clientY,
      ),
    [gl, camera, raycaster],
  )
```

3. 在 `usePlacementSurface` 之后加:

```ts
/** 落点表面登记表的只读视图(路径预设落点标记也用这套射线目标) */
export function getPlacementSurfaces(): ReadonlySet<Object3D> {
  return placementSurfaces
}
```

4. 在 `readRegistry` 之后加:

```ts
/** 所有已放置模型的落点(给 findFreeSpot 算默认位用) */
export function readPlacementPositions(
  sheet: ISheet,
): Array<{x: number; y: number; z: number}> {
  return readRegistry(getRegistry(sheet)).map((e) => e.position)
}
```

- [ ] **Step 6: usePlacementController 加 placeLibraryEntryAt**

在 `confirmPlacing` 之后加(注意 key 规则与 confirmPlacing 保持一致):

```ts
  /** 点击库卡片直接落点:跳过幽灵预览,走与 confirmPlacing 相同的落地管线 */
  const placeLibraryEntryAt = useCallback(
    (entry: ModelEntry, point: {x: number; y: number; z: number}) => {
      const base =
        entry.name.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_') || 'model'
      setPendingEntry({
        key: `Placed / ${base}-${Date.now().toString(36)}`,
        libraryEntryId: entry.id,
        position: point,
        pending: true,
      })
    },
    [],
  )
```

并在 return 对象里加 `placeLibraryEntryAt`。

- [ ] **Step 7: PlacementRig 加拖拽松手确认模式**

`PlacementRig`、`PlacementRigFBX`、`PlacementRigGLTF`、`PlacementRigCore` 的 props 都加 `confirmOnPointerUp?: boolean`,逐层透传。

`PlacementRigCore` 的事件 effect 里:

1. `onClick` 开头加守卫:`if (confirmOnPointerUp) return`(拖拽模式下画布点击不确认,确认只走松手)。
2. 新增一个 effect(依赖 `[confirmOnPointerUp, gl, camera, computePoint, onConfirm, onCancel]`):

```ts
  // 拖拽模式:按下发生在面板卡片上,松手才是确认。松手在画布外(面板区域)
  // = 取消;太远(>300)也取消,防止误放到天边
  useEffect(() => {
    if (!confirmOnPointerUp) return
    const el = gl.domElement
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return
      const rect = el.getBoundingClientRect()
      const inside =
        ev.clientX >= rect.left &&
        ev.clientX <= rect.right &&
        ev.clientY >= rect.top &&
        ev.clientY <= rect.bottom
      if (!inside) {
        onCancel()
        return
      }
      const p = computePoint(ev.clientX, ev.clientY)
      if (p.distanceTo(camera.position) > 300) {
        onCancel()
        return
      }
      onConfirm({x: p.x, y: p.y, z: p.z})
    }
    window.addEventListener('pointerup', onUp)
    return () => window.removeEventListener('pointerup', onUp)
  }, [confirmOnPointerUp, gl, camera, computePoint, onConfirm, onCancel])
```

- [ ] **Step 8: 类型检查 + 回归测试**

Run: `npx tsc --noEmit -p packages/playground/tsconfig.json && yarn typecheck && yarn test packages/playground/src/shared/camera/`
Expected: 全部通过(既有 116+8+4 用例)

- [ ] **Step 9: Commit**

```bash
git add packages/playground/src/shared/camera/dropPoint.ts packages/playground/src/shared/camera/dropPoint.test.ts packages/playground/src/shared/camera/PlacementManager.tsx
git commit -m "feat(playground): 落点数学抽出共用,库模型支持直放与拖拽松手确认

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git checkout -- packages/dataverse/api/
```

---

### Task 3: 资产库面板「路径」tab + 卡片点击/拖拽手势

**Files:**
- Modify: `packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx`(`Tab` 类型 L9、props L11-31、tab 按钮 L368-412、导入按钮 L414-428、卡片网格 L505-521、`renderModelCard` L232-265)

**Interfaces:**
- Consumes: `PATH_PRESETS`、`type PathPreset` from `../pathPresets`(Task 1)
- Produces: `AssetLibraryPanel` 新增 props:
  - `onDragStartModel?: (entry: ModelEntry) => void`
  - `onPlacePreset: (preset: PathPreset) => void`
  - `onDragStartPreset: (preset: PathPreset) => void`
  - (`onPlaceModel` 保留,语义由 App 改为"立即放置")

- [ ] **Step 1: 加手势 hook**

在 `AssetLibraryPanel.tsx` 组件外(文件级)加:

```ts
/** 卡片手势阈值:按下后移动超过 4px 算拖拽(沿用场景点选的拖拽判定惯例) */
const DRAG_THRESHOLD_PX = 4

/**
 * 卡片手势:按下后移动超阈值 = 拖拽(onDragStart 触发一次),否则松开 = 点击。
 * 监听挂 window:拖出卡片后移动/松手照样生效。右键不走这里(另有 onContextMenu)。
 */
function useCardGesture<T>(
  onClick: (item: T) => void,
  onDragStart?: (item: T) => void,
) {
  const gestureRef = useRef<{item: T; x: number; y: number; dragging: boolean} | null>(null)
  const onClickRef = useRef(onClick)
  const onDragStartRef = useRef(onDragStart)
  onClickRef.current = onClick
  onDragStartRef.current = onDragStart

  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const g = gestureRef.current
      if (!g || g.dragging) return
      if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) > DRAG_THRESHOLD_PX) {
        const start = onDragStartRef.current
        if (!start) return
        g.dragging = true
        start(g.item)
      }
    }
    const onUp = () => {
      const g = gestureRef.current
      gestureRef.current = null
      if (g && !g.dragging) onClickRef.current(g.item)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  return useCallback(
    (item: T) => (ev: React.PointerEvent) => {
      if (ev.button !== 0) return
      gestureRef.current = {item, x: ev.clientX, y: ev.clientY, dragging: false}
    },
    [],
  )
}
```

- [ ] **Step 2: 面板 props 与 tab 扩展**

1. `type Tab = 'model' | 'pose' | 'animation' | 'path'`
2. props 加 `onDragStartModel?: (entry: ModelEntry) => void`、`onPlacePreset: (preset: PathPreset) => void`、`onDragStartPreset: (preset: PathPreset) => void`,并从 `../pathPresets` import `PATH_PRESETS` 和 `type PathPreset`。
3. 组件内加两个手势:

```ts
  const modelGesture = useCardGesture<ModelEntry>(
    (entry) => onPlaceModel(entry),
    onDragStartModel,
  )
  const presetGesture = useCardGesture<PathPreset>(
    (preset) => onPlacePreset(preset),
    (preset) => onDragStartPreset(preset),
  )
```

- [ ] **Step 3: 模型卡片改走手势**

`renderModelCard` 里把 `onClick={() => onPlaceModel(entry)}` 换成 `onPointerDown={modelGesture(entry)}`(`onContextMenu` 保持不变)。

- [ ] **Step 4: 路径预设卡片**

在 `renderPoseCard` 之后加:

```ts
  // 预设卡片:内置不可删改,无右键菜单、无骨架标签
  const renderPresetCard = (preset: PathPreset) => (
    <div
      key={preset.id}
      style={cardBaseStyle}
      onPointerDown={presetGesture(preset)}
      title="点击放到场景中心;按住拖到画布指定落点"
    >
      <div style={placeholderStyle}>{preset.icon}</div>
      <div style={labelStyle}>{preset.name}</div>
    </div>
  )
```

- [ ] **Step 5: tab 按钮、导入按钮、网格接线**

1. 头部在「动作」按钮后加「路径」按钮(样式照抄既有三个 tab 按钮,`tab === 'path'`)。
2. 导入按钮包一层条件:`{tab !== 'path' && (<button ...>导入</button>)}`。
3. 卡片网格的渲染三元改为:

```tsx
        {tab === 'model'
          ? models.map(renderModelCard)
          : tab === 'pose'
            ? visiblePoses.map(renderPoseCard)
            : tab === 'path'
              ? PATH_PRESETS.map(renderPresetCard)
              : visibleAnimations.map(renderAnimationCard)}
```

姿势/动作卡片维持 `onClick` 不变(用户决策:姿势只点击)。

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit -p packages/playground/tsconfig.json && yarn typecheck`
Expected: 通过(App 尚未传新 props,`onPlacePreset`/`onDragStartPreset` 是必填——本任务先把它们标成必填会让 App 报错;**因此这两个 prop 在 Task 3 先声明为可选 `?`,Task 4 接线后再收紧为必填**,或保持可选并在面板内对 path tab 做 `onPlacePreset?.(...)` 调用。取后者,简单)

- [ ] **Step 7: Commit**

```bash
git add packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx
git commit -m "feat(playground): 资产库面板加「路径」tab,卡片支持点击/拖拽手势

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git checkout -- packages/dataverse/api/
```

---

### Task 4: App/TopToolbar 接线 + 路径预设落点标记

**Files:**
- Create: `packages/playground/src/shared/camera/PathPresetDropRig.tsx`
- Modify: `packages/playground/src/shared/camera/TopToolbar.tsx`(整体重写,50 行级文件)
- Modify: `packages/playground/src/shared/camera/App.tsx`(TopToolbar 接线 L1191-1200、`addPosPathPoint` L803-824、`AssetLibraryPanel` 接线 L1253-1270、`PlacementRig` 接线 L1486-1497、Canvas 内加 PathPresetDropRig 与拖拽提示条)

**Interfaces:**
- Consumes: Task 1 的 `PATH_PRESETS`/`PathPreset`/`presetPoints`/`findFreeSpot`;Task 2 的 `computeDropPoint`/`getPlacementSurfaces`/`readPlacementPositions`/`placeLibraryEntryAt`/`confirmOnPointerUp`;Task 3 的面板新 props
- Produces: 无新导出(接线任务)

- [ ] **Step 1: 创建 PathPresetDropRig**

`packages/playground/src/shared/camera/PathPresetDropRig.tsx`:

```tsx
/**
 * 路径预设拖拽的 Canvas 内容:落点标记(小球)跟随指针,松开 = 在该处
 * 生成预设路径,画布外松开/Esc/右键 = 取消。落点数学与模型放置共用
 * computeDropPoint(表面优先、地面兜底、朝天退前方 30)。
 * 路径生成在活动相机高度,标记只指示 XZ 落点,不预览形状(落地即进
 * 编辑模式,点立即可见可改)。
 */
import React, {useEffect, useMemo, useRef} from 'react'
import {useFrame, useThree} from '@react-three/fiber'
import {Raycaster} from 'three'
import type {Mesh} from 'three'
import {computeDropPoint} from './dropPoint'
import {getPlacementSurfaces} from './PlacementManager'

export function PathPresetDropRig({
  onConfirm,
  onCancel,
}: {
  onConfirm: (point: {x: number; y: number; z: number}) => void
  onCancel: () => void
}) {
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const markerRef = useRef<Mesh>(null!)
  const raycaster = useMemo(() => new Raycaster(), [])

  // pointermove 一秒上百次:只记坐标并申请一帧,落点计算在帧回调里做一次
  const pendingMoveRef = useRef<{x: number; y: number} | null>(null)
  useFrame(() => {
    const pending = pendingMoveRef.current
    if (!pending) return
    pendingMoveRef.current = null
    const p = computeDropPoint(
      raycaster,
      camera,
      getPlacementSurfaces(),
      gl.domElement.getBoundingClientRect(),
      pending.x,
      pending.y,
    )
    if (markerRef.current) {
      markerRef.current.visible = true
      markerRef.current.position.copy(p)
    }
  })

  useEffect(() => {
    const el = gl.domElement
    const onMove = (ev: PointerEvent) => {
      pendingMoveRef.current = {x: ev.clientX, y: ev.clientY}
      invalidate()
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return
      const rect = el.getBoundingClientRect()
      const inside =
        ev.clientX >= rect.left &&
        ev.clientX <= rect.right &&
        ev.clientY >= rect.top &&
        ev.clientY <= rect.bottom
      if (!inside) {
        onCancel()
        return
      }
      const p = computeDropPoint(
        raycaster,
        camera,
        getPlacementSurfaces(),
        rect,
        ev.clientX,
        ev.clientY,
      )
      if (p.distanceTo(camera.position) > 300) {
        onCancel()
        return
      }
      onConfirm({x: p.x, y: p.y, z: p.z})
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCancel()
    }
    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault()
      onCancel()
    }
    el.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    window.addEventListener('contextmenu', onContextMenu)
    return () => {
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [gl, camera, raycaster, invalidate, onConfirm, onCancel])

  return (
    <mesh ref={markerRef} visible={false}>
      <sphereGeometry args={[0.3, 16, 16]} />
      <meshBasicMaterial color="#ffaa00" transparent opacity={0.8} depthTest={false} />
    </mesh>
  )
}
```

- [ ] **Step 2: 重写 TopToolbar**

```tsx
/**
 * 顶栏工具条:只放全局动作——资产库(模型/姿势/动作/路径预设的统一
 * 入口)、添加相机、导出视频。物体的属性设置在各自面板,物体的动作在
 * 面板动作区和右键菜单(见 docs/superpowers/specs/2026-09-01-camera-menu-reorg-design.md
 * 与 2026-09-12-unified-placement-panel-design.md)。
 */
import React, {useCallback, useRef} from 'react'
import useMenu from '@dreamerbird/studio/uiComponents/simpleContextMenu/useMenu'
import {buildExportMenuItems} from './menuModel'
import type {ExportSink} from './videoExport/sinks'

function buttonStyle(disabled: boolean, danger = false): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid #444',
    background: disabled ? '#333' : danger ? '#633a3a' : '#272730',
    color: disabled ? '#888' : '#eee',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 13,
  }
}

export function TopToolbar({
  onToggleLibrary,
  onAddCamera,
  exportSinks,
  exporting,
  exportDisabled,
  onPickExportSink,
  onStopExport,
}: {
  onToggleLibrary: () => void
  onAddCamera: () => void
  exportSinks: readonly ExportSink[]
  exporting: boolean
  exportDisabled: boolean
  onPickExportSink: (sink: ExportSink) => void
  onStopExport: () => void
}) {
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const exportMenuItems = useCallback(
    () => buildExportMenuItems(exportSinks, (sink) => onPickExportSink(sink)),
    [exportSinks, onPickExportSink],
  )
  const [exportMenuNode, openExportMenu] = useMenu({items: exportMenuItems})

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        display: 'flex',
        gap: 8,
      }}
    >
      <button onClick={onToggleLibrary} style={buttonStyle(false)}>
        资产库
      </button>
      <button
        onClick={onAddCamera}
        style={buttonStyle(false)}
        title="从当前导演视角创建一台相机(落地即活动相机)"
      >
        添加相机
      </button>
      <button
        ref={exportButtonRef}
        disabled={exportDisabled && !exporting}
        onClick={() => {
          if (exporting) {
            onStopExport()
            return
          }
          const rect = exportButtonRef.current?.getBoundingClientRect()
          openExportMenu(
            rect ? {clientX: rect.left, clientY: rect.bottom + 4} : undefined,
          )
        }}
        style={buttonStyle(exportDisabled && !exporting, exporting)}
        title={
          exportDisabled && !exporting
            ? '先添加相机'
            : '把镜头取景实时录成视频:序列从头播到尾,录完自动保存'
        }
      >
        {exporting ? '停止并保存(Esc 取消)' : '导出视频'}
      </button>
      {exportMenuNode}
    </div>
  )
}
```

- [ ] **Step 3: App 接线**

`App.tsx`:

1. import 调整:
   - 从 `./pathPresets` 加 `import {findFreeSpot, presetPoints} from './pathPresets'` 和 `import type {PathPreset} from './pathPresets'`
   - 从 `./PlacementManager` 的既有 import 里加 `placeLibraryEntryAt`(从 `usePlacementController` 返回值解构)和 `readPlacementPositions`
   - 加 `import {PathPresetDropRig} from './PathPresetDropRig'`
   - 检查 `seedArcPoints` 是否只剩 `addPosPathPoint` 在用——是则删掉该 import
2. 删除 `addPosPathPoint`(L803-824 整个 callback),替换为:

```ts
  // 路径预设放置:点击 = 场景中心;拖拽 = 指针落点。高度跟活动相机当前 Y
  // (无相机跟主视角,再退回 5)。先播种再登记(没点就不出现),落地即进
  // 编辑模式。每一步都是既有可撤销事务,撤销 = 清单行消失 + 点数据回滚
  const placePresetPath = useCallback(
    (preset: PathPreset, centerXZ?: {x: number; z: number}) => {
      const camObj = activeCamera
        ? shotRefsMapRef.current.get(activeCamera.cameraKey)?.camera.current
        : undefined
      const camY =
        (camObj ? (val(camObj.props.position) as {y: number}).y : undefined) ??
        (cameraObjRef.current
          ? (val(cameraObjRef.current.props.position) as {y: number}).y
          : 5)
      const center = {x: centerXZ?.x ?? 0, y: camY, z: centerXZ?.z ?? 0}
      const entry = nextPathEntry(readPathEntries(getPathsRegistry(sheet)))
      addPathPoint(sheet, entry.pathKey, presetPoints(preset, center))
      addPathToRegistry(sheet, entry)
      enterPathEdit(entry.pathKey)
    },
    [sheet, activeCamera, enterPathEdit],
  )
```

3. `usePlacementController` 解构加 `placeLibraryEntryAt`;其后加:

```ts
  // 点击模型卡片 = 立即放到默认位(原点被占沿 +X 自动错开);要指定位置用拖拽
  const placeModelAtDefault = useCallback(
    (entry: ModelEntry) => {
      placeLibraryEntryAt(entry, findFreeSpot(readPlacementPositions(sheet)))
    },
    [sheet, placeLibraryEntryAt],
  )

  // 拖拽态:模型拖拽复用 placing 幽灵(按下即进 placing,松手即 confirm);
  // 路径预设拖拽挂落点标记
  const [modelDragging, setModelDragging] = useState(false)
  const [presetDrag, setPresetDrag] = useState<PathPreset | null>(null)
  const startModelDrag = useCallback(
    (entry: ModelEntry) => {
      setModelDragging(true)
      startPlacingFromLibrary(entry).catch((err) => {
        console.warn('[placement] 库模型加载失败', err)
        setModelDragging(false)
      })
    },
    [startPlacingFromLibrary],
  )
```

4. TopToolbar 接线改为:

```tsx
      <TopToolbar
        onToggleLibrary={() => setLibraryOpen((v) => !v)}
        onAddCamera={addCamera}
        exportSinks={exportSinks}
        exporting={exporting}
        onPickExportSink={handlePickExportSink}
        onStopExport={handleStopExport}
      />
```

5. AssetLibraryPanel 接线加三个 prop:

```tsx
          onPlaceModel={placeModelAtDefault}
          onDragStartModel={startModelDrag}
          onPlacePreset={(preset: PathPreset) => placePresetPath(preset)}
          onDragStartPreset={(preset: PathPreset) => setPresetDrag(preset)}
```

(原 `onPlaceModel` 的 startPlacingFromLibrary 包装删除。)

6. PlacementRig 接线改为拖拽感知:

```tsx
          {placing && (
            <Suspense fallback={null}>
              <PlacementRigErrorBoundary
                onCancel={() => {
                  cancelPlacing()
                  setModelDragging(false)
                }}
              >
                <PlacementRig
                  placing={placing}
                  confirmOnPointerUp={modelDragging}
                  onConfirm={(p) => {
                    confirmPlacing(p)
                    setModelDragging(false)
                  }}
                  onCancel={() => {
                    cancelPlacing()
                    setModelDragging(false)
                  }}
                />
              </PlacementRigErrorBoundary>
            </Suspense>
          )}
```

7. Canvas 内(`SelectionGizmo` 之后)加路径预设拖拽标记:

```tsx
          {presetDrag && (
            <PathPresetDropRig
              onConfirm={(p) => {
                placePresetPath(presetDrag, {x: p.x, z: p.z})
                setPresetDrag(null)
              }}
              onCancel={() => setPresetDrag(null)}
            />
          )}
```

8. 拖拽提示条(Canvas 外、与 GizmoModeHint 同级的绝对定位区):

```tsx
      {(modelDragging || presetDrag) && (
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            padding: '6px 12px',
            borderRadius: 6,
            background: 'rgba(24,24,28,0.9)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: '#eee',
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          松开鼠标落点,Esc/右键取消
        </div>
      )}
```

- [ ] **Step 4: 类型检查 + 全量 camera 测试**

Run: `npx tsc --noEmit -p packages/playground/tsconfig.json && yarn typecheck && yarn test packages/playground/src/shared/camera/`
Expected: 全过。若有测试引用了被删的 `addPosPathPoint`/TopToolbar 旧 props,按新接口修。

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/PathPresetDropRig.tsx packages/playground/src/shared/camera/TopToolbar.tsx packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): 顶栏收编为资产库/添加相机/导出视频,接通统一放置与拖拽落点

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git checkout -- packages/dataverse/api/
```

---

### Task 5: 手动验收(Playwright)

**Files:**
- 无代码改动;验收记录写进台账

- [ ] **Step 1: 起 playground**

`yarn playground` 后台起服务,Playwright 打开 camera 场景。

- [ ] **Step 2: 验收清单(逐项过)**

1. 顶栏只剩「资产库 / 添加相机 / 导出视频」三按钮;点「资产库」开面板,面板有「模型/姿势/动作/路径」四个 tab
2. 点击模型卡片 → 模型立即落原点,大纲出现 `Placed / ...` 行;再点一次 → 第二个落在 x=2 附近
3. 从模型卡片按住拖到画布 → 幽灵跟随指针;松开 → 落在指针处;再来一次按 Esc → 取消不留对象;在面板区域松开 → 同样取消
4. 「路径」tab 点「环绕圆」→ 场景中心出现圆形路径、大纲出现 `Pos Path` 行、自动进编辑模式;撤销一次 → 路径消失
5. 拖拽「弧线」到画布某处 → 松开在该落点生成弧线并进编辑模式;右键取消一次 → 不生成
6. 路径生成高度 = 活动相机当前高度(有相机时)
7. 姿势 tab 点击姿势卡片 → 套用到选中模型(回归)
8. 撤销/重做:模型点击放置、模型拖拽放置、路径点击放置、路径拖拽放置各做一次,逐步撤销都能完整回滚
9. 冒烟回归:添加相机、导出视频菜单、面板导入按钮在路径 tab 下隐藏、模型卡片右键重命名/删除仍可用

- [ ] **Step 3: 验收记录写台账**

把逐项结果(含发现的问题与处置)追加到 `.superpowers/sdd/2026-09-12-unified-placement-panel/progress.md`。

---

## Self-Review 记录

- **Spec 覆盖**:决策 1(姿势只点击)= Task 3 Step 5 保持不变 + Task 5 回归项 7;决策 2(内置预设)= Task 1;决策 3(统一面板 + 顶栏收编)= Task 3 + Task 4;决策 4(点击即放)= Task 2 Step 6 + Task 4 Step 3.2/3.3;拖拽机制 = Task 2 Step 7 + Task 3 Step 1 + Task 4 Step 1;默认位/错位 = Task 1 `findFreeSpot`;默认高度 = Task 4 Step 3.2;撤销语义 = 复用既有事务 + Task 5 验收项 8;错误处理(面板内松开/太远取消)= Task 2 Step 7 + Task 4 Step 1。
- **类型一致性**:`presetPoints(preset, center)`、`findFreeSpot(occupied, base?)`、`computeDropPoint(raycaster, camera, surfaces, rect, x, y)`、`placeLibraryEntryAt(entry, point)`、`confirmOnPointerUp` 在各任务间签名一致。Task 3 的 `onPlacePreset`/`onDragStartPreset` 声明为可选,Task 4 接线时不收紧(保持可选)。
- **已知边界(写进计划,免得实现者踩坑)**:模型拖拽中 URL 还在加载时松手 = 进入普通放置模式(placing 仍在,Esc 取消),首次拖拽某模型可能遇到;拖拽的起点 pointerdown 在面板上,所以画布上不会触发既有 click 确认(click 需要 down+up 同元素链)。
