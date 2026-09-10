# Camera 场景多相机 + 多路径（P2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** camera playground 解除单相机/单路径限制：多台相机共存（单活动相机承接取景能力），多条路径共存，相机可按 key 绑定任意路径。

**Architecture:** 注册表（`cameraRegistry` / `pathRegistry`）已是列表结构，P2 主要改两处：`ShotCamera` 从写死 `POS_PATH_KEY` 改为按相机对象的 `pathKey` 属性解析绑定路径（含失效回退看护）；`App.tsx` 引入 `activeCameraKey` 与按 cameraKey 的 ref 表，取景/导出/面板动作全部归到活动相机。

**Tech Stack:** React 18 + @react-three/fiber + theatre（本仓 fork，scope `@dreamerbird`）+ jest（jest-esbuild）+ Playwright（e2e）。

**Spec:** `docs/superpowers/specs/2026-09-10-camera-multi-camera-multi-path-design.md`

## Global Constraints

- theatre 属性配置必须是模块级稳定引用且 deep-equal（`sheet.object` 重复调用配置不一致会炸）：`moveMode` 的 stringLiteral 选项**不能**塞动态路径清单；绑定选择器只能放面板动作区/右键菜单这类动态入口。
- `sheet.object`（含 `getPathMeta`）查不存在的 key 会顺手创建对象：探测一律先 `pathExists`（走内部对象表），确认存在才 `getPathMeta`。
- 行进进度共享：`progress` 只在路径对象上，多相机绑同一路径读同一份；不做每相机进度。
- 注册表是底账：相机/路径的增删都过 registry 函数，不走旁路。
- jest 用 jest-esbuild，**不提升 jest.mock**；本计划的单测都是纯函数，不需要 mock（如确需 mock，用 `jest.doMock` + `resetModules` + 运行时 require）。
- 提交信息格式 `type(scope): 中文描述`，结尾带：
  ```
  Co-Authored-By: Claude Code <noreply@anthropic.com>
  ```
- 单测命令（仓库根目录）：`yarn test packages/playground/src/shared/camera/<file>.test.ts`
- 类型检查（仓库根目录）：`yarn typecheck`

---

### Task 1: pathBinding 纯函数（绑定解析 + 失效判定）

**Files:**
- Create: `packages/playground/src/shared/camera/pathBinding.ts`
- Test: `packages/playground/src/shared/camera/pathBinding.test.ts`

**Interfaces:**
- Consumes: `POS_PATH_KEY`（`./CameraPath`，值为 `'Pos Path'`，legacy 回退用）
- Produces（Task 3 的 ShotCamera 使用，签名以此为准）:
  - `resolveBoundPathKey(moveMode: string, pathKey: string, registeredKeys: readonly string[]): string | null`
  - `isBindingStale(moveMode: string, pathKey: string, registeredKeys: readonly string[]): boolean`

- [ ] **Step 1: 写失败测试**

`packages/playground/src/shared/camera/pathBinding.test.ts`：

```ts
import {resolveBoundPathKey, isBindingStale} from './pathBinding'

const REG = ['Pos Path', 'Pos Path 2']

test('手动模式:不解析任何绑定', () => {
  expect(resolveBoundPathKey('manual', 'Pos Path 2', REG)).toBe(null)
  expect(isBindingStale('manual', '', REG)).toBe(false)
})

test('path 模式 + 已绑定的 key 在册 → 绑定生效', () => {
  expect(resolveBoundPathKey('path', 'Pos Path 2', REG)).toBe('Pos Path 2')
  expect(isBindingStale('path', 'Pos Path 2', REG)).toBe(false)
})

test('path 模式 + pathKey 为空 + legacy Pos Path 在册 → 回退 legacy(旧状态兼容)', () => {
  expect(resolveBoundPathKey('path', '', REG)).toBe('Pos Path')
  expect(isBindingStale('path', '', REG)).toBe(false)
})

test('path 模式 + pathKey 为空 + 无 legacy → 失效', () => {
  expect(resolveBoundPathKey('path', '', ['Pos Path 2'])).toBe(null)
  expect(isBindingStale('path', '', ['Pos Path 2'])).toBe(true)
})

test('path 模式 + 绑定的路径已不在册(被删/对端同步删)→ 失效', () => {
  expect(resolveBoundPathKey('path', 'Pos Path 3', REG)).toBe(null)
  expect(isBindingStale('path', 'Pos Path 3', REG)).toBe(true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn test packages/playground/src/shared/camera/pathBinding.test.ts`
Expected: FAIL（模块不存在，Cannot find module './pathBinding'）

- [ ] **Step 3: 实现**

`packages/playground/src/shared/camera/pathBinding.ts`：

```ts
/**
 * 相机→路径的绑定解析(纯函数,单测直接断言)。
 *
 * 绑定存在相机对象的 pathKey 属性上(moveMode=path 时生效);
 * pathKey 为空 + legacy 'Pos Path' 在册 = 旧状态,读侧回退视为绑定
 * legacy,不做写迁移。解析不到 = 绑定失效(路径被删/对端同步删),
 * 调用方(ShotCamera 的看护 effect)负责回退手动并清绑定。
 */
import {POS_PATH_KEY} from './CameraPath'

/** 解析当前生效的绑定路径 key;不生效返回 null */
export function resolveBoundPathKey(
  moveMode: string,
  pathKey: string,
  registeredKeys: readonly string[],
): string | null {
  if (moveMode !== 'path') return null
  if (pathKey && registeredKeys.includes(pathKey)) return pathKey
  if (!pathKey && registeredKeys.includes(POS_PATH_KEY)) return POS_PATH_KEY
  return null
}

/** 绑定是否失效:处于 path 模式但已解析不到生效路径 */
export function isBindingStale(
  moveMode: string,
  pathKey: string,
  registeredKeys: readonly string[],
): boolean {
  return (
    moveMode === 'path' &&
    resolveBoundPathKey(moveMode, pathKey, registeredKeys) === null
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `yarn test packages/playground/src/shared/camera/pathBinding.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/pathBinding.ts packages/playground/src/shared/camera/pathBinding.test.ts
git commit -m "feat(playground): 相机路径绑定解析纯函数(含 legacy 回退与失效判定)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: menuModel 扩展（路径菜单绑定项 + 相机面板绑定按钮）

**Files:**
- Modify: `packages/playground/src/shared/camera/menuModel.ts`
- Test: `packages/playground/src/shared/camera/menuModel.test.ts`

**Interfaces:**
- Consumes: 无新依赖（`ContextMenuItem`、`SheetObjectActionsConfig` 已在文件中）
- Produces（签名变更全是**新增可选参数**，旧调用点不受影响）:
  - `buildPathMenuItems` 新增可选 `onBindToActiveCamera?: () => void`（提供时才出「绑定到活动相机」项，插在编辑项之后、分隔线之前）
  - `buildCameraPanelActions` 新增可选 `bindablePaths?: readonly {pathKey: string; label: string}[]`、`boundPathKey?: string | null`、`onBindPath?: (pathKey: string) => void`、`onUnbindPath?: () => void`
  - `buildCameraMenuItems` 不变（多相机的菜单行为差异在 App 侧闭包里，不在构建层）

- [ ] **Step 1: 写失败测试**

在 `menuModel.test.ts` 末尾追加：

```ts
test('路径右键菜单:提供 onBindToActiveCamera 时出「绑定到活动相机」', () => {
  const onBind = jest.fn()
  const items = buildPathMenuItems({
    metaKey: 'Pos Path 2',
    editing: false,
    onToggleEdit: jest.fn(),
    onDelete: jest.fn(),
    onBindToActiveCamera: onBind,
  })
  // [编辑路径(Tab), 绑定到活动相机, separator, 删除路径]
  expect(items.map((i) => i.type)).toEqual([
    'normal',
    'normal',
    'separator',
    'normal',
  ])
  expect((items[1] as any).label).toBe('绑定到活动相机')
  ;(items[1] as any).callback?.({} as any)
  expect(onBind).toHaveBeenCalled()

  // 不提供时结构不变(向后兼容)
  const plain = buildPathMenuItems({
    metaKey: 'Pos Path 2',
    editing: false,
    onToggleEdit: jest.fn(),
    onDelete: jest.fn(),
  })
  expect(plain.map((i) => i.type)).toEqual(['normal', 'separator', 'normal'])
})

test('相机面板动作:未绑定时每条可绑路径一个按钮;已绑定出解绑', () => {
  const onBindPath = jest.fn()
  const onUnbindPath = jest.fn()
  const unbound = buildCameraPanelActions({
    hasPoints: false,
    targetHidden: false,
    onAlignToPathStart: jest.fn(),
    onRestoreTarget: jest.fn(),
    bindablePaths: [
      {pathKey: 'Pos Path', label: 'Pos Path'},
      {pathKey: 'Pos Path 2', label: 'Pos Path 2'},
    ],
    boundPathKey: null,
    onBindPath,
    onUnbindPath,
  })
  expect(Object.keys(unbound)).toEqual(['绑定到 Pos Path', '绑定到 Pos Path 2'])
  unbound['绑定到 Pos Path 2']()
  expect(onBindPath).toHaveBeenCalledWith('Pos Path 2')

  const bound = buildCameraPanelActions({
    hasPoints: false,
    targetHidden: false,
    onAlignToPathStart: jest.fn(),
    onRestoreTarget: jest.fn(),
    bindablePaths: [
      {pathKey: 'Pos Path', label: 'Pos Path'},
      {pathKey: 'Pos Path 2', label: 'Pos Path 2'},
    ],
    boundPathKey: 'Pos Path',
    onBindPath,
    onUnbindPath,
  })
  // 已绑定的那条不再出「绑定到」,改出「解绑路径」
  expect(Object.keys(bound)).toEqual(['解绑路径', '绑定到 Pos Path 2'])
  bound['解绑路径']()
  expect(onUnbindPath).toHaveBeenCalled()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn test packages/playground/src/shared/camera/menuModel.test.ts`
Expected: FAIL（新用例断言的 key 不存在）

- [ ] **Step 3: 实现**

`menuModel.ts` 中替换这两个函数（其余不动）：

```ts
export function buildPathMenuItems(opts: {
  metaKey: string
  editing: boolean
  onToggleEdit: () => void
  onDelete: () => void
  /** 提供时出「绑定到活动相机」(无活动相机/已绑给活动相机时调用方不传) */
  onBindToActiveCamera?: () => void
}): ContextMenuItem[] {
  return [
    {
      type: 'normal',
      label: opts.editing ? '退出编辑(Tab)' : '编辑路径(Tab)',
      callback: () => opts.onToggleEdit(),
    },
    ...(opts.onBindToActiveCamera
      ? [
          {
            type: 'normal',
            label: '绑定到活动相机',
            callback: opts.onBindToActiveCamera,
          } as ContextMenuItem,
        ]
      : []),
    {type: 'separator'},
    {
      type: 'normal',
      label: '删除路径',
      callback: () => opts.onDelete(),
    },
  ]
}
```

```ts
export function buildCameraPanelActions(opts: {
  hasPoints: boolean
  targetHidden: boolean
  onAlignToPathStart: () => void
  onRestoreTarget: () => void
  /** 多路径绑定(P2):可绑的路径清单与当前绑定。
   *  theatre 属性配置是静态的,路径清单是动态的——绑定选择器不能做成
   *  属性下拉,放面板动作区(动作是动态注册的) */
  bindablePaths?: readonly {pathKey: string; label: string}[]
  boundPathKey?: string | null
  onBindPath?: (pathKey: string) => void
  onUnbindPath?: () => void
}): SheetObjectActionsConfig {
  const actions: SheetObjectActionsConfig = {}
  // 空路径没有"起点"可对齐,不出按钮(actions 无 disabled 概念,用不出现表达)
  if (opts.hasPoints) {
    actions['对齐到路径起点'] = () => opts.onAlignToPathStart()
  }
  if (opts.targetHidden) {
    actions['恢复 Target'] = () => opts.onRestoreTarget()
  }
  if (opts.boundPathKey && opts.onUnbindPath) {
    actions['解绑路径'] = () => opts.onUnbindPath!()
  }
  for (const p of opts.bindablePaths ?? []) {
    if (p.pathKey === opts.boundPathKey) continue
    actions[`绑定到 ${p.label}`] = () => opts.onBindPath?.(p.pathKey)
  }
  return actions
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `yarn test packages/playground/src/shared/camera/menuModel.test.ts`
Expected: PASS（旧用例 + 2 个新用例全绿）

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/menuModel.ts packages/playground/src/shared/camera/menuModel.test.ts
git commit -m "feat(playground): 菜单模型支持多路径绑定(路径菜单绑定项+相机面板绑定按钮)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: ShotCamera 多实例化 + 按 pathKey 绑定路径

**Files:**
- Modify: `packages/playground/src/shared/camera/ShotCamera.tsx`
- Modify: `packages/playground/src/shared/camera/App.tsx`（仅 cameras.map 调用点的最小适配，保持 P1 行为）

**Interfaces:**
- Consumes:
  - `resolveBoundPathKey` / `isBindingStale`（Task 1）
  - `buildCameraPanelActions` 新可选参数（Task 2）
  - `usePathsList(sheet): PathEntry[]`（`./pathRegistry`）
  - `usePathExists(sheet, metaKey): boolean`、`usePathHasPoints(sheet, metaKey): boolean`、`getPathMeta(sheet, metaKey)`（`./CameraPath`，都支持动态 metaKey）
- Produces（App 侧 Task 4/5 依赖）:
  - `ShotCamera` props 变更为 `{cameraKey, targetKey, isActive, shotView, cameraObjRef, targetObjRef, onCameraContextMenu}`（`makeDefault` 删除，内部由 `shotView && isActive` 推导）
  - 相机对象新增 `pathKey: string` 属性（空 = 未绑定）

- [ ] **Step 1: 属性配置加 pathKey,moveMode 选项标签改通用**

`ShotCamera.tsx` 的 `shotCameraAdditionalProps` 改为：

```ts
const shotCameraAdditionalProps = {
  trackTarget: t.boolean(true, {label: '朝向绑定 Target'}),
  targetHidden: t.boolean(false, {label: '删除 Target(可恢复)'}),
  moveMode: t.stringLiteral(
    'manual',
    // 选项标签保持通用:配置是模块级常量(deep-equal 约束),
    // 动态路径清单塞不进来;绑定哪条路径由 pathKey 表达
    {manual: '手动', path: '路径'},
    {label: '机位驱动'},
  ),
  // 绑定路径的 key(注册表里的 pathKey);空 = 未绑定。
  // 主交互入口是面板动作区的绑定按钮,这个文本框只当兜底
  pathKey: t.string('', {label: '绑定路径'}),
}
```

同时更新文件顶部注释里「moveMode 开关」相关描述为「moveMode=path 时沿 pathKey 绑定的路径」。

- [ ] **Step 2: 组件签名与绑定解析**

`ShotCamera` props 从 `makeDefault: boolean` 改为：

```ts
export function ShotCamera({
  cameraKey,
  targetKey,
  isActive,
  shotView,
  cameraObjRef,
  targetObjRef,
  onCameraContextMenu,
}: {
  cameraKey: string
  targetKey: string
  /** 活动相机:画中画/镜头视角全屏/导出都只对它生效 */
  isActive: boolean
  /** 镜头视角全屏中(此时非活动相机的视锥/Target 也全部隐藏) */
  shotView: boolean
  cameraObjRef: MutableRefObject<ISheetObject<any> | undefined>
  targetObjRef: MutableRefObject<ISheetObject<any> | undefined>
  onCameraContextMenu?: (x: number, y: number) => void
}) {
  // ...
  const makeDefault = shotView && isActive
```

路径相关块（原 L251-260 附近）替换为：

```ts
  const sheet = useCurrentSheet()!
  // 绑定解析:moveMode=path 时沿 pathKey 绑定的路径;空 pathKey 回退
  // legacy 'Pos Path'(见 pathBinding.ts);进度仍在路径对象上(共享进度)
  const paths = usePathsList(sheet)
  const registeredKeys = useMemo(() => paths.map((e) => e.pathKey), [paths])
  const camMoveMode = useObjPropScalar<string>(cameraObjRef, 'moveMode', 'manual')
  const camPathKey = useObjPropScalar<string>(cameraObjRef, 'pathKey', '')
  const boundKey = resolveBoundPathKey(camMoveMode, camPathKey, registeredKeys)
  // boundKey 为 null 时用 '' 探测(getObject('') 恒不存在,不创建)
  const boundPathExists = usePathExists(sheet, boundKey ?? '')
  const boundHasPoints = usePathHasPoints(sheet, boundKey ?? '')
  const boundMeta = useMemo(
    () => (boundKey && boundPathExists ? getPathMeta(sheet, boundKey) : null),
    [sheet, boundKey, boundPathExists],
  )
  const camDriveLocked = boundKey !== null && boundHasPoints
```

新增绑定失效看护 effect（放在绑定解析之后）：

```ts
  // 绑定失效看护:绑定的路径被删(本地删除/对端同步删除都会走到)→
  // 回退手动并清绑定,机位定格当前位置(对齐 Blender:约束目标被删,
  // 物体保持当前变换)。空路径(没控制点)不算失效,维持绑定
  useEffect(() => {
    if (!isBindingStale(camMoveMode, camPathKey, registeredKeys)) return
    const obj = cameraObjRef.current
    const studio = getStudioSync()
    if (!obj || !studio) return
    const scrub = studio.scrub()
    scrub.capture(({set}) => {
      set(obj.props.moveMode, 'manual')
      set(obj.props.pathKey, '')
    })
    scrub.commit()
  }, [camMoveMode, camPathKey, registeredKeys, cameraObjRef])
```

新增绑定/解绑回调（供面板动作区）：

```ts
  // 绑定/解绑:一次 scrub 同时写 pathKey 和 moveMode,
  // 不留"绑了但没生效"的中间态
  const bindPath = useCallback(
    (pathKey: string) => {
      const obj = cameraObjRef.current
      const studio = getStudioSync()
      if (!obj || !studio) return
      const scrub = studio.scrub()
      scrub.capture(({set}) => {
        set(obj.props.pathKey, pathKey)
        set(obj.props.moveMode, 'path')
      })
      scrub.commit()
    },
    [cameraObjRef],
  )
  const unbindPath = useCallback(() => {
    const obj = cameraObjRef.current
    const studio = getStudioSync()
    if (!obj || !studio) return
    const scrub = studio.scrub()
    scrub.capture(({set}) => {
      set(obj.props.moveMode, 'manual')
      set(obj.props.pathKey, '')
    })
    scrub.commit()
  }, [cameraObjRef])
```

- [ ] **Step 3: 替换组件内所有 POS_PATH_KEY 消费点**

把以下三处从 `POS_PATH_KEY` / `posPathMeta` 改为 `boundKey` / `boundMeta`：

(a) 朝向失效定格 effect（原 L290-296 附近）：

```ts
    const sampled = capturePosTmp.current
    const from =
      boundMeta &&
      samplePathPoint(boundKey!, val(boundMeta.props.progress), sampled)
        ? sampled
        : cam.position
```

该 effect 的 deps 从 `[tracking, cameraObjRef, posPathMeta]` 改为 `[tracking, cameraObjRef, boundKey, boundMeta]`。

(b) `alignToPathStart`（原 L304-315）：

```ts
  const alignToPathStart = useCallback(() => {
    const obj = cameraObjRef.current
    const studio = getStudioSync()
    if (!obj || !studio || !boundKey) return
    const tmp = new Vector3()
    if (!samplePathPoint(boundKey, 0, tmp)) return
    const scrub = studio.scrub()
    scrub.capture(({set}) =>
      set(obj.props.position, {x: tmp.x, y: tmp.y, z: tmp.z}),
    )
    scrub.commit()
  }, [cameraObjRef, boundKey])
```

(c) 运镜驱动 useFrame（原 L349-363）：条件改为

```ts
    if (
      boundMeta &&
      samplePathPoint(boundKey!, val(boundMeta.props.progress), tmp)
    ) {
      cam.position.copy(tmp)
    }
```

- [ ] **Step 4: 面板动作区接绑定按钮**

`objectActions` 的 useMemo 改为：

```ts
  const objectActions = useMemo(
    () =>
      buildCameraPanelActions({
        hasPoints: boundHasPoints,
        targetHidden,
        onAlignToPathStart: alignToPathStart,
        onRestoreTarget: restoreTarget,
        bindablePaths: registeredKeys.map((pathKey) => ({
          pathKey,
          label: pathObjectName(pathKey),
        })),
        boundPathKey: boundKey,
        onBindPath: bindPath,
        onUnbindPath: unbindPath,
      }),
    [
      boundHasPoints,
      targetHidden,
      alignToPathStart,
      restoreTarget,
      registeredKeys,
      boundKey,
      bindPath,
      unbindPath,
    ],
  )
```

（`pathObjectName` 的 import 保留——moveMode 选项不再用它，但这里用。）

- [ ] **Step 5: 活动相机门控渲染与调试挂钩**

(a) 渲染器只在活动相机上挂（原 L450）：

```tsx
      {isActive && <ShotCameraRenderer camRef={camRef} pip={!makeDefault} />}
```

(b) 视锥/Target 可见性：镜头视角下所有相机的编辑标记都隐藏（原逻辑只盯自己 makeDefault，多相机后非活动相机的视锥会漏进别人的全屏取景）：

```ts
  useEffect(() => {
    frustum.visible = !shotView
    frustumFill.visible = !shotView
  }, [shotView, frustum, frustumFill])
```

Target mesh 的 `visible={!targetHidden && !makeDefault}` 改为 `visible={!targetHidden && !shotView}`。

(c) `__shotCam3` 调试挂钩只在活动相机上写（原 L382-384）：

```ts
  useEffect(() => {
    if (isActive) (window as any).__shotCam3 = camRef.current
  }, [isActive])
```

(d) import 更新：去掉 `POS_PATH_KEY`（不再直接用），新增：

```ts
import {resolveBoundPathKey, isBindingStale} from './pathBinding'
import {usePathsList} from './pathRegistry'
import {usePathExists} from './CameraPath'
```

（`getPathMeta`、`usePathHasPoints`、`pathObjectName`、`samplePathPoint` 原有 import 保留。）

- [ ] **Step 6: App.tsx 的 cameras.map 最小适配（保持 P1 单相机行为不变）**

`App.tsx` 原 L1267-1277 改为（P1 上限还在，`cameras[0]` 即活动相机；`activeCameraKey` 状态在 Task 4 引入）：

```tsx
          {cameras.map((entry) => (
            <ShotCamera
              key={entry.cameraKey}
              cameraKey={entry.cameraKey}
              targetKey={entry.targetKey}
              isActive={entry.cameraKey === cameras[0]?.cameraKey}
              shotView={shotView}
              cameraObjRef={shotCameraObjRef}
              targetObjRef={shotTargetObjRef}
              onCameraContextMenu={(x, y) => setCameraMenu({x, y})}
            />
          ))}
```

- [ ] **Step 7: 验证**

Run: `yarn typecheck && yarn test packages/playground/src/shared/camera/`
Expected: typecheck 无报错；全部单测 PASS

手动冒烟（playground camera 场景）：添加相机 → 添加路径 → 相机面板机位驱动选「路径」→ 播放头拖动时相机沿路径走（legacy 回退：pathKey 为空仍走 Pos Path）→ 删除路径 → 相机自动回退手动。

- [ ] **Step 8: Commit**

```bash
git add packages/playground/src/shared/camera/ShotCamera.tsx packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): ShotCamera 按 pathKey 绑定路径 + 活动相机门控渲染

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: App 多相机接通（activeCameraKey + 每实例 refs + 解除添加置灰）

**Files:**
- Modify: `packages/playground/src/shared/camera/App.tsx`

**Interfaces:**
- Consumes: `ShotCamera` 新签名（Task 3）；`removeCamera(sheet, entry, objects)`（`./cameraRegistry`，签名不变）
- Produces:
  - `window.__cameraShot` 形态变为 `{cameraObjRef, targetObjRef, shotRefs: Map<string, {camera: MutableRefObject<...>, target: MutableRefObject<...>}>, activeKey: () => string | null}`（自动化脚本若引用旧字段需同步改）

- [ ] **Step 1: refs 改按 cameraKey 的 Map**

删除 `shotCameraObjRef` / `shotTargetObjRef` 两个 useRef，替换为：

```ts
  // 每台相机一对 objRef(多相机:单对 ref 会被 map 里的实例互相覆盖)。
  // 普通对象即可,不进 React 渲染——可放 Map 里按 key 取
  type ShotObjRefs = {
    camera: MutableRefObject<ISheetObject<any> | undefined>
    target: MutableRefObject<ISheetObject<any> | undefined>
  }
  const shotRefsMapRef = useRef(new Map<string, ShotObjRefs>())
  const getShotRefs = (cameraKey: string): ShotObjRefs => {
    const map = shotRefsMapRef.current
    let refs = map.get(cameraKey)
    if (!refs) {
      refs = {camera: {current: undefined}, target: {current: undefined}}
      map.set(cameraKey, refs)
    }
    return refs
  }
```

（`MutableRefObject` 需要从 react import；`type` 声明移到组件外顶部。）

注册表移除相机后清理 slot（放在 cameras 声明之后）：

```ts
  // 相机被删(含对端同步):清掉它的 ref slot,不留失效引用
  useEffect(() => {
    const map = shotRefsMapRef.current
    for (const key of [...map.keys()]) {
      if (!cameras.some((e) => e.cameraKey === key)) map.delete(key)
    }
  }, [cameras])
```

- [ ] **Step 2: activeCameraKey 状态与活动相机推导**

替换 `const activeCamera = cameras.length > 0 ? cameras[0] : null` 为：

```ts
  // 活动相机:画中画/镜头视角/导出只对它生效(右键「查看此镜头」= 设活动)。
  // 持久化没必要(session 态);key 失效(被删)时顺位回退清单第一台
  const [activeCameraKey, setActiveCameraKey] = useState<string | null>(null)
  const activeCamera =
    cameras.find((e) => e.cameraKey === activeCameraKey) ?? cameras[0] ?? null
```

活动相机 refs 的取用 helper（组件内）：

```ts
  const activeShotRefs = activeCamera
    ? getShotRefs(activeCamera.cameraKey)
    : undefined
```

- [ ] **Step 3: addCamera 解除上限,deleteCamera 按 entry**

```ts
  // 添加相机:新机位/朝向/瞄准点都取当前导演视角(用户正看着的画面)
  const addCamera = useCallback(() => {
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
    // 新相机落地即活动(用户刚加的就是他想看的)
    setActiveCameraKey(entry.cameraKey)
  }, [cameras, sheet])

  // 删除相机(右键菜单):真删——持久数据清掉、大纲行消失;
  // 活动相机被删时 activeCamera 推导自动顺位给清单第一台
  const deleteCamera = useCallback(
    (entry: CameraEntry) => {
      const refs = shotRefsMapRef.current.get(entry.cameraKey)
      removeCamera(sheet, entry, {
        camera: refs?.camera.current,
        target: refs?.target.current,
      })
    },
    [sheet],
  )
```

（`CameraEntry` 需要从 `./cameraRegistry` import type。）

- [ ] **Step 4: 相机菜单带 cameraKey**

`cameraMenu` 状态类型改为 `{cameraKey: string; x: number; y: number} | null`。菜单渲染处（原 L1187-1196）改为：

```tsx
      {cameraMenu && (
        <CanvasContextMenu
          position={cameraMenu}
          items={buildCameraMenuItems({
            // 查看此镜头 = 设为活动 + 进镜头视角
            onViewShot: () => {
              setActiveCameraKey(cameraMenu.cameraKey)
              setShotView(true)
            },
            onDeleteCamera: () => {
              const entry = cameras.find(
                (e) => e.cameraKey === cameraMenu.cameraKey,
              )
              if (entry) deleteCamera(entry)
            },
          })}
          onClose={closeCameraMenu}
        />
      )}
```

cameras.map 里的 `onCameraContextMenu` 改为带 key：

```tsx
              onCameraContextMenu={(x, y) =>
                setCameraMenu({cameraKey: entry.cameraKey, x, y})
              }
```

同时 map 里传入 Task 3 的 refs slot 与正确的 isActive：

```tsx
          {cameras.map((entry) => (
            <ShotCamera
              key={entry.cameraKey}
              cameraKey={entry.cameraKey}
              targetKey={entry.targetKey}
              isActive={entry.cameraKey === activeCamera?.cameraKey}
              shotView={shotView}
              cameraObjRef={getShotRefs(entry.cameraKey).camera}
              targetObjRef={getShotRefs(entry.cameraKey).target}
              onCameraContextMenu={(x, y) =>
                setCameraMenu({cameraKey: entry.cameraKey, x, y})
              }
            />
          ))}
```

- [ ] **Step 5: 取景/导出/提示条全部改读活动相机 refs**

(a) `targetMissing` 订阅 effect（原 L736-765）：`shotCameraObjRef` 依赖改为读活动 refs——把 `const cam = shotCameraObjRef.current` 改为 `const cam = activeShotRefs?.camera.current`，effect deps 从 `[shotCameraObjRef, activeCamera]` 改为 `[activeCamera]`（`activeShotRefs` 每次 render 重算，参与 deps 无意义，内部直接调 `getShotRefs`）。

(b) 导出保卫（原 L531-533）：导出绑定开录时的那台相机，它被删才中止（而不是"没有相机"才中止——多相机下活动相机被删还有别的相机，但录到一半换镜头是错的）：

```ts
  // 导出锁定开录时的相机;它中途被删(本地/对端)就中止录制(丢弃)
  const exportCameraKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (
      exporting &&
      !cameras.some((e) => e.cameraKey === exportCameraKeyRef.current)
    ) {
      exportHandleRef.current?.abort()
    }
  }, [exporting, cameras])
```

导出启动 effect（原 L902-928）里 `startShotExport` 成功前加一行：

```ts
    exportCameraKeyRef.current = activeCamera?.cameraKey ?? null
```

（该 effect deps 从 `[shotView, sheet]` 改为 `[shotView, sheet, activeCamera]`。）

(c) `__cameraShot` 调试挂钩（原 L556-561）改为：

```ts
  ;(window as any).__cameraShot = {
    cameraObjRef,
    targetObjRef,
    shotRefs: shotRefsMapRef.current,
    activeKey: () => activeCamera?.cameraKey ?? null,
  }
```

(d) 工具条解除置灰（原 L1079）：`addCameraEnabled={true}`，`addPathEnabled` 保持 `paths.length === 0` 不动（Task 5 解除）。

- [ ] **Step 6: 验证**

Run: `yarn typecheck && yarn test packages/playground/src/shared/camera/`
Expected: 无报错，全 PASS

手动冒烟：添加两台相机（工具条不再置灰）→ 各自右键「查看此镜头」切换活动（画中画跟着换）→ 删除非活动相机（导出/画中画不受影响）→ 删除活动相机（画中画收敛到下一台）。

- [ ] **Step 7: Commit**

```bash
git add packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): 多相机接通——activeCameraKey + 每实例 refs,解除添加上限

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: App 多路径泛化（进度/钉帧/Tab/平移/播种/绑定入口）

**Files:**
- Modify: `packages/playground/src/shared/camera/App.tsx`

**Interfaces:**
- Consumes:
  - `readPathPoints`、`translatePath`、`samplePathPoint`、`pathExists`、`getPathMeta`、`setPathPanelActions`、`usePathHasPoints`、`addPathPoint`（`./CameraPath`，全部已支持任意 metaKey）
  - `buildPathMenuItems` 的 `onBindToActiveCamera`（Task 2）
  - `buildPathPanelActions`（`./menuModel`，不变）
- Produces: 无新导出；`window.__cameraPathEdit` 形态不变

- [ ] **Step 1: 删除 POS_PATH_KEY 单例块,改为按编辑态参数化**

删除原 L797-855 的 `posPathExists` / `posPathMeta` / `posPathHasPoints` / `movePathToCamera` / `pathPanelActions` / `pathProgressOf` 单例声明（保留 L804-810 的 legacy 孤儿清扫 effect 不动——它专查老结构残留的 `'Pos Path'` 对象）。替换为：

```ts
  // 正在编辑的路径对象(钉帧/关键帧列表都按它算;对象不存在为 null)
  const editingPathExists = usePathExists(sheet, editingPath ?? '')
  const editingPathMeta = useMemo(
    () =>
      editingPath && editingPathExists
        ? getPathMeta(sheet, editingPath)
        : null,
    [sheet, editingPath, editingPathExists],
  )

  // 每条路径的进度读取(进度标记用):按 key 读对应路径对象,
  // 对象不存在时报 0(共享进度:进度只在路径对象上)
  const pathProgressOf = useCallback(
    (pathKey: string) => () =>
      pathExists(sheet, pathKey)
        ? (val(getPathMeta(sheet, pathKey).props.progress) as number)
        : 0,
    [sheet],
  )
```

`pinPathPointAtPlayhead`（原 L861-882）里的 `posPathMeta` 全部换成 `editingPathMeta`，deps 相应改。`progressKeyframes` 的 usePrism（原 L886-895）同样换成 `editingPathMeta`。

`PathPointEditor` 调用处（原 L1232-1241）改为不再限定 Pos Path：

```tsx
          <PathPointEditor
            sheet={sheet}
            metaKey={editingPath}
            pointKey={selectedPathPoint.key}
            onPinAtPlayhead={pinPathPointAtPlayhead}
            progressKeyframes={progressKeyframes}
          />
```

- [ ] **Step 2: Tab 进入编辑泛化到注册表任意路径**

原 L676-684 的 `selectedPath` 探测改为：

```ts
        // 选中注册表里任意一条路径的本体 → Tab 进编辑(Blender:Tab 作用于
        // 选中物)。先探测再取句柄:getPathMeta 查不存在会顺手创建
        const selectedPath =
          studio &&
          paths.find(
            (e) =>
              pathExists(sheet, e.pathKey) &&
              (studio.selection as unknown[]).includes(
                getPathMeta(sheet, e.pathKey),
              ),
          )?.pathKey
        if (selectedPath) enterPathEdit(selectedPath)
```

该 effect 的 deps 从 `[sheet, shotView, enterPathEdit, exitPathEdit]` 改为 `[sheet, shotView, enterPathEdit, exitPathEdit, paths]`。

- [ ] **Step 3: 路径面板动作按条注册（PathPanelActionsRegistrar）**

App.tsx 顶部组件区新增（放在 `ExitPathEditOnEmptyClick` 之前的任意位置）：

```tsx
/**
 * 给单条已注册路径挂面板动作(「路径平移到相机」):hasPoints 要响应式
 * (加点/删点/撤销都反映),每条路径一个实例,避开 hooks 不能按动态清单
 * 调用的问题
 */
function PathPanelActionsRegistrar({
  sheet,
  pathKey,
  onMovePathToCamera,
}: {
  sheet: ISheet
  pathKey: string
  onMovePathToCamera: (pathKey: string) => void
}) {
  const hasPoints = usePathHasPoints(sheet, pathKey)
  const actions = useMemo(
    () =>
      buildPathPanelActions({
        hasPoints,
        onMovePathToCamera: () => onMovePathToCamera(pathKey),
      }),
    [hasPoints, onMovePathToCamera, pathKey],
  )
  useEffect(() => {
    // setPathPanelActions 内部走 sheet.object,查不存在会顺手创建——
    // 必须登记在册(注册表里有)才注册动作;本组件只在 paths.map 里渲染
    if (pathExists(sheet, pathKey)) setPathPanelActions(sheet, pathKey, actions)
  }, [sheet, pathKey, actions])
  return null
}
```

`movePathToCamera` 改为按 key + 平移目标是活动相机机位：

```ts
  // 路径平移到活动相机机位(采样起点对齐相机;空路径采样失败不出手)
  const movePathToCamera = useCallback(
    (pathKey: string) => {
      const cam = activeCamera
        ? shotRefsMapRef.current.get(activeCamera.cameraKey)?.camera.current
        : undefined
      if (!cam) return
      const tmp = new Vector3()
      if (!samplePathPoint(pathKey, 0, tmp)) return
      const c = val(cam.props.position)
      translatePath(sheet, pathKey, {
        x: c.x - tmp.x,
        y: c.y - tmp.y,
        z: c.z - tmp.z,
      })
    },
    [sheet, activeCamera],
  )
```

在 paths.map 渲染 `CameraPath` 的旁边挂 registrar，并把 `progressOf` 换成按 key 的：

```tsx
          {paths.map((entry) => (
            <PathPanelActionsRegistrar
              key={`actions-${entry.pathKey}`}
              sheet={sheet}
              pathKey={entry.pathKey}
              onMovePathToCamera={movePathToCamera}
            />
          ))}
          {paths.map((entry) => (
            <CameraPath
              key={entry.pathKey}
              metaKey={entry.pathKey}
              color={0x4a90d9}
              hidden={shotView}
              editing={editingPath === entry.pathKey}
              selectedKey={
                selectedPathPoint?.metaKey === entry.pathKey
                  ? selectedPathPoint.key
                  : null
              }
              onSelectPoint={(key) =>
                setSelectedPathPoint(key ? {metaKey: entry.pathKey, key} : null)
              }
              onContextMenu={(metaKey, x, y) => setPathMenu({metaKey, x, y})}
              progressOf={pathProgressOf(entry.pathKey)}
            />
          ))}
```

（注意：`ISheet` 类型若 App.tsx 尚未 import 需补 `import type {ISheet} from '@dreamerbird/core'`；`buildPathPanelActions` 已 import。）

- [ ] **Step 4: 添加路径从活动相机播种 + 解除置灰**

`addPosPathPoint`（原 L713-731）的播种来源改为活动相机优先：

```ts
  const addPosPathPoint = useCallback(() => {
    const cam = activeCamera
      ? shotRefsMapRef.current.get(activeCamera.cameraKey)?.camera.current
      : undefined
    const target = activeCamera
      ? shotRefsMapRef.current.get(activeCamera.cameraKey)?.target.current
      : undefined
    const mainCam = cameraObjRef.current
    const mainTarget = targetObjRef.current
    const seed =
      cam && target
        ? seedArcPoints(val(cam.props.position), val(target.props.position))
        : mainCam && mainTarget
          ? seedArcPoints(
              val(mainCam.props.position),
              val(mainTarget.props.position),
            )
          : undefined
    const entry = nextPathEntry(readPathEntries(getPathsRegistry(sheet)))
    addPathPoint(sheet, entry.pathKey, seed)
    addPathToRegistry(sheet, entry)
    enterPathEdit(entry.pathKey)
  }, [sheet, activeCamera, enterPathEdit])
```

工具条 `addPathEnabled={paths.length === 0}` 改为 `addPathEnabled={true}`。

- [ ] **Step 5: 路径右键菜单接「绑定到活动相机」+ 修复编辑浮条加点**

(a) 新增回调（App 组件内）：

```ts
  // 绑定到活动相机:一次 scrub 同时写 pathKey 和 moveMode(同 ShotCamera
  // 的 bindPath;这里是无相机面板时的入口)
  const bindPathToActiveCamera = useCallback(
    (pathKey: string) => {
      const studio = getStudioSync()
      const cam = activeCamera
        ? shotRefsMapRef.current.get(activeCamera.cameraKey)?.camera.current
        : undefined
      if (!studio || !cam) return
      const scrub = studio.scrub()
      scrub.capture(({set}) => {
        set(cam.props.pathKey, pathKey)
        set(cam.props.moveMode, 'path')
      })
      scrub.commit()
    },
    [activeCamera],
  )
```

(b) pathMenu 渲染处（原 L1169-1186）的 `buildPathMenuItems` 调用加：

```tsx
          items={buildPathMenuItems({
            metaKey: pathMenu.metaKey,
            editing: editingPath === pathMenu.metaKey,
            onToggleEdit: () => {
              if (editingPath === pathMenu.metaKey) {
                exitPathEdit()
              } else {
                enterPathEdit(pathMenu.metaKey)
              }
            },
            // 有活动相机且它没绑这条时才出「绑定到活动相机」
            onBindToActiveCamera: (() => {
              const cam = activeCamera
                ? shotRefsMapRef.current.get(activeCamera.cameraKey)?.camera
                    .current
                : undefined
              if (!cam) return undefined
              if (val(cam.props.pathKey) === pathMenu.metaKey) return undefined
              return () => bindPathToActiveCamera(pathMenu.metaKey)
            })(),
            onDelete: () => removePath(pathMenu.metaKey),
          })}
```

(c) **顺手修 P1 接线错误**：编辑浮条的「加点」（语义是"在路径末尾续一个控制点"）现在接的是 `addPosPathPoint`（会新建一条路径）。改为往正在编辑的路径续点：

```tsx
        <PathEditBar
          hasSelection={
            !!selectedPathPoint && selectedPathPoint.metaKey === editingPath
          }
          onAddPoint={() => {
            if (editingPath) addPathPoint(sheet, editingPath, undefined)
          }}
          onDeleteSelected={deleteSelectedPathPoint}
        />
```

（`addPathPoint(sheet, key, undefined)` 在非空路径上的语义就是末尾续点，见 `CameraPath.tsx` L365-367。）

- [ ] **Step 6: 验证**

Run: `yarn typecheck && yarn test packages/playground/src/shared/camera/`
Expected: 无报错，全 PASS

手动冒烟：添加两条路径 → 各自右键进编辑、加点、钉帧互不干扰 → 相机 A 绑 Path 1、相机 B 绑 Path 2（面板按钮和右键菜单两种入口都试）→ 拖播放头两台各走各的 → 删 Path 1 → 相机 A 自动回退手动（机位定格不跳）。

- [ ] **Step 7: Commit**

```bash
git add packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): 多路径泛化——进度/钉帧/Tab/平移按 key,路径绑定入口接通

顺手修 P1 接线错误:编辑浮条「加点」原来会新建一条路径,改为往
正在编辑的路径末尾续点

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: TopToolbar 清理 + 全量验收

**Files:**
- Modify: `packages/playground/src/shared/camera/TopToolbar.tsx`
- Modify: `packages/playground/src/shared/camera/App.tsx`（工具条调用点）

**Interfaces:**
- Consumes: 无
- Produces: `TopToolbar` props 删除 `addCameraEnabled` / `addPathEnabled`（按钮恒可用）

- [ ] **Step 1: 删除置灰 props 与"后续版本开放"文案**

`TopToolbar.tsx`：props 类型与解构删除 `addCameraEnabled`、`addPathEnabled`；两个按钮改为：

```tsx
      <button
        onClick={onAddCamera}
        style={buttonStyle(false)}
        title="从当前导演视角创建一台相机(落地即活动相机)"
      >
        添加相机
      </button>
      <button
        onClick={onAddPath}
        style={buttonStyle(false)}
        title="从活动相机机位播种一段环绕弧,并进入编辑模式"
      >
        添加路径
      </button>
```

`App.tsx` 工具条调用点删除 `addCameraEnabled={true}` / `addPathEnabled={true}` 两行。

- [ ] **Step 2: 全量验证**

Run: `yarn typecheck && yarn test packages/playground/src/shared/camera/`
Expected: 无报错，全 PASS

- [ ] **Step 3: 手动验收清单（camera playground，对齐规格逐项过）**

启动 camera playground 后按序验证（括号里是预期）：

1. 连续添加两台相机（工具条不置灰；第二台命名 Shot Camera 2 / 大纲两行；落地即活动）
2. 右键相机 1「查看此镜头」（画中画/镜头视角切到相机 1；非活动相机只画机身+视锥）
3. 添加两条路径（Pos Path / Pos Path 2；各自右键编辑、加点、钉到播放头互不干扰）
4. 相机 1 面板「绑定到 Pos Path」，相机 2 面板「绑定到 Pos Path 2」（绑定即生效沿路径走；两台各走各的，同路径时共享进度）
5. 右键 Path 2「绑定到活动相机」入口（活动相机已绑 Path 2 时该项不出现）
6. 删除 Pos Path（相机 1 自动回退手动、pathKey 清空、机位定格不跳）
7. 删除活动相机（画中画/导出收敛到下一台；导出中删活动相机会中止录制）
8. 撤销/重做往返（添加/删除/绑定每步一次撤销完整回滚）

- [ ] **Step 4: Commit**

```bash
git add packages/playground/src/shared/camera/TopToolbar.tsx packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): 工具条移除单例置灰,多相机多路径全量开放

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
