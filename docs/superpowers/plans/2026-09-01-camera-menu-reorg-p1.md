# Camera Playground 菜单归位(P1)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 camera playground 的菜单按"toolbar 只放全局动作、属性归面板、动作归面板动作区/右键菜单、点级操作归编辑浮条"的原则重新归位(单例语义)。

**Architecture:** toolbar 收进一个新 TopToolbar 组件(4 项,下拉用 studio 的 useMenu/ContextMenu);三个手写右键菜单统一换成 studio ContextMenu 的薄封装;面板动作用 core 已有的 `sheet.object(key, config, {__actions__})` 机制(r3f editable 补一个 `objectActions` 透传 prop);编辑浮条新增加点/删点按钮。

**Tech Stack:** TypeScript、React、@react-three/fiber、styled-components、jest(jest-esbuild)、playwright MCP(浏览器验证)。

**Spec:** `docs/superpowers/specs/2026-09-01-camera-menu-reorg-design.md`

## Global Constraints

- jest 必须从**仓库根目录**运行(`npx jest packages/playground` / `npx jest packages/core`);从 packages/playground 下跑会拿到非 TS transform,全部套件 SyntaxError。
- 提交只在用户明确说"提交"时才做;本计划各任务末尾的 commit 步骤仅在实际执行时按用户指令进行(默认不提交)。
- 用户的未跟踪文件(.claude/、.ignore、.mcp.json、AGENTS.md、opencode.json、examples/dom-cra/src/react-app-env.d.ts)绝不加入提交。
- 面向用户的汇报用平实中文,不用黑话。
- vite 开发服务器从 `packages/playground` 目录起,`--port 5199 --strictPort`;验证完必须停掉。
- playwright 应答文件选择器只能用 `browser_file_upload`(幻影 filechooser 坑)。
- `sheet.object(key, config)` 重复调用要求 config deep-equal、函数按引用比;所有 config 和 actions 对象必须是模块级常量或 useMemo 缓存的引用。
- 面板动作区机制已存在,不要新造:core 的 `sheet.object(key, config, {__actions__THIS_API_IS_UNSTABLE_AND_WILL_CHANGE_IN_THE_NEXT_VERSION: {...}})`,studio 的 ObjectDetails 会自动把 actions 渲染成属性后的按钮;对已存在对象重复调用(同 config)会更新 actions。
- 不自动切驱动:添加路径/播种不得修改任何相机的 moveMode。
- ContextMenuItem 形状(`packages/studio/src/uiComponents/chordial/chordialInternals.ts`):`{type: 'normal', label: string | ElementType, callback?: (e) => void, enabled?: boolean}` 或 `{type: 'separator'}`。

---

### Task 1: core 测试锁定 sheet.object actions 更新机制 + r3f editable 透传 objectActions

**Files:**
- Test: `packages/core/src/tests/sheetObjectActions.test.ts`(新建;`packages/core/src/tests/` 目录不存在则一并建)
- Modify: `packages/r3f/src/main/editable.tsx:136-185`(创建 sheet object 的 useLayoutEffect)

**Interfaces:**
- Consumes: core 的 `sheet.object(key, config, {__actions__THIS_API_IS_UNSTABLE_AND_WILL_CHANGE_IN_THE_NEXT_VERSION})`(`packages/core/src/sheets/TheatreSheet.ts:38-107`,已存在对象时 `if (actions) existingObject.template._temp_setActions(actions)`);`SheetObjectActionsConfig = Record<string, (object: ISheetObject) => void>`(`packages/core/src/types/public.ts:383-385`)。
- Produces: r3f editable 组件新 prop `objectActions?: SheetObjectActionsConfig`(Task 4 的 ShotCamera 用它挂相机面板动作)。

- [ ] **Step 1: 写 core 失败测试**

```ts
// packages/core/src/tests/sheetObjectActions.test.ts
import {setupTestSheet} from '@toy-box/core/tests/testUtils' // 若不存在,见 Step 2 备选
```

先读 `packages/core/src/index.test.ts` 头部,照搬它建 project/sheet 的方式。测试内容:

```ts
test('sheet.object 重复调用带 actions 会更新模板上的 actions', () => {
  // 建 project + sheet(照搬 index.test.ts 的写法)
  const config = {n: 0} // shorthand number
  const obj = sheet.object('obj', config)
  const template = privateAPI(obj).template // privateAPI 从 @toy-box/core/__private 或测试内已有用法照搬
  expect(template._temp_actions).toEqual(undefined)

  const actionA = jest.fn()
  sheet.object('obj', config, {
    __actions__THIS_API_IS_UNSTABLE_AND_WILL_CHANGE_IN_THE_NEXT_VERSION: {
      动作A: actionA,
    },
  })
  expect(Object.keys(template._temp_actions ?? {})).toEqual(['动作A'])

  // 换一份 actions:覆盖更新
  sheet.object('obj', config, {
    __actions__THIS_API_IS_UNSTABLE_AND_WILL_CHANGE_IN_THE_NEXT_VERSION: {
      动作B: jest.fn(),
    },
  })
  expect(Object.keys(template._temp_actions ?? {})).toEqual(['动作B'])
})
```

注意:`privateAPI` 的引入方式照抄 core 现有测试(若没有现成用法,用 `import {__private} from '@toy-box/core'` 不可行时,改为断言 `sheet.object` 不抛错 + 通过 studio 侧 ObjectDetails 的行为在 Task 4 浏览器验证;core 内可用 `import {privateAPI} from '@toy-box/core/theatre'`——先 grep `privateAPI` 在 core 测试里的用法再定)。

- [ ] **Step 2: 跑测试确认现状**

Run: `npx jest packages/core/src/tests/sheetObjectActions.test.ts`(仓库根目录)
Expected: 若机制已如代码所示,直接 PASS(机制已存在,这个测试是锁定行为防回归);若 FAIL,按失败信息修正测试写法(多半是 privateAPI 引入路径),不要改机制实现。

- [ ] **Step 3: r3f editable 加 objectActions prop**

`packages/r3f/src/main/editable.tsx`:

a) 文件顶部 import 加类型:

```ts
import type {SheetObjectActionsConfig} from '@toy-box/core/types/public'
```

b) 创建 sheet object 的 useLayoutEffect(现 deps `[sheet, storeKey, additionalProps]`,约 136-185 行)改为:

```ts
      // create sheet object and add editable to store
      useLayoutEffect(() => {
        if (!sheet) return
        const objectConfig = Object.assign(
          {
            ...additionalProps,
          },
          // @ts-ignore
          ...Object.values(config[actualType].props).map(
            // @ts-ignore
            (value) => value.type,
          ),
        )
        if (sheetObject) {
          sheet.object(theatreKey, objectConfig, {
            reconfigure: true,
            // 面板动作区(属性后的按钮):core 机制,重复调用同 config 时只更新 actions
            __actions__THIS_API_IS_UNSTABLE_AND_WILL_CHANGE_IN_THE_NEXT_VERSION:
              objectActions,
          })
          return
        } else {
          const sheetObject = sheet.object(theatreKey, objectConfig, {
            __actions__THIS_API_IS_UNSTABLE_AND_WILL_CHANGE_IN_THE_NEXT_VERSION:
              objectActions,
          })
          // ……(其余照旧)
        }
      }, [sheet, storeKey, additionalProps, objectActions])
```

注意:保持原有两个分支的结构和注释,只做:①抽 objectConfig 变量;②两处 sheet.object 调用加第三个参数;③deps 加 `objectActions`。`objectActions` 从组件 props 解构(和 `additionalProps` 同处)。

c) 底部 props 类型(两处:`extensions` 对象类型里的 editable 组件 props 和 `primitive` 的 props,约 264-285 行)各加一行:

```ts
        objectActions?: SheetObjectActionsConfig
```

- [ ] **Step 4: 类型检查 + 现有测试不回归**

Run: `yarn tsc --noEmit -p packages/r3f`(若该包无 tsconfig 脚本,用仓库根的 typecheck 命令;先看 `packages/r3f/package.json` scripts)
Run: `npx jest packages/core/src/tests/sheetObjectActions.test.ts`(根目录)
Expected: 全过

- [ ] **Step 5: Commit**(仅用户说"提交"时执行)

```bash
git add packages/core/src/tests/sheetObjectActions.test.ts packages/r3f/src/main/editable.tsx
git commit -m "feat(r3f): pass objectActions through editable to sheet.object panel actions"
```

---

### Task 2: menuModel —— 菜单项/动作构建的纯函数层 + 测试

**Files:**
- Create: `packages/playground/src/shared/camera/menuModel.ts`
- Test: `packages/playground/src/shared/camera/menuModel.test.ts`

**Interfaces:**
- Consumes: `ContextMenuItem` 类型(`@toy-box/studio/uiComponents/chordial/chordialInternals`);`SheetObjectActionsConfig`(`@toy-box/core/types/public`)。
- Produces(后面任务全部从这里取):
  - `buildCameraMenuItems(opts: {onViewShot: () => void}): ContextMenuItem[]`
  - `buildPathMenuItems(opts: {metaKey: string; editing: boolean; onToggleEdit: () => void; onDelete: () => void}): ContextMenuItem[]`
  - `buildObjectMenuItems(opts: {mode: GizmoMode; onSelectMode: (m: GizmoMode) => void; onDelete: () => void}): ContextMenuItem[]`
  - `buildCameraPanelActions(opts: {hasPoints: boolean; targetHidden: boolean; onAlignToPathStart: () => void; onRestoreTarget: () => void}): SheetObjectActionsConfig`
  - `buildPathPanelActions(opts: {hasPoints: boolean; onMovePathToCamera: () => void}): SheetObjectActionsConfig`
  - `buildExportMenuItems(sinks: readonly {id: string; label: string}[], onPick: (sink) => void): ContextMenuItem[]`
  - `GizmoMode` 类型从 PlacementManager import;`GIZMO_MODE_LABELS` 从 PlacementManager import(若未导出则补 export)。

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/menuModel.test.ts
import {
  buildCameraMenuItems,
  buildPathMenuItems,
  buildObjectMenuItems,
  buildCameraPanelActions,
  buildPathPanelActions,
  buildExportMenuItems,
} from './menuModel'

test('相机右键菜单:查看此镜头', () => {
  const onViewShot = jest.fn()
  const items = buildCameraMenuItems({onViewShot})
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({type: 'normal', label: '查看此镜头'})
  ;(items[0] as any).callback?.({} as any)
  expect(onViewShot).toHaveBeenCalled()
})

test('路径右键菜单:编辑(带 Tab 标注)与删除,编辑中显示退出编辑', () => {
  const onToggleEdit = jest.fn()
  const onDelete = jest.fn()
  const items = buildPathMenuItems({
    metaKey: 'Shot / Pos Path',
    editing: false,
    onToggleEdit,
    onDelete,
  })
  // [编辑路径(Tab), separator, 删除路径]
  expect(items.map((i) => i.type)).toEqual(['normal', 'separator', 'normal'])
  expect(String((items[0] as any).label)).toContain('编辑路径')
  expect(String((items[0] as any).label)).toContain('Tab')
  expect(String((items[2] as any).label)).toContain('删除路径')

  const editingItems = buildPathMenuItems({
    metaKey: 'Shot / Pos Path',
    editing: true,
    onToggleEdit,
    onDelete,
  })
  expect(String((editingItems[0] as any).label)).toContain('退出编辑')
})

test('模型右键菜单:三种 gizmo 模式,当前模式打勾,末尾删除', () => {
  const onSelectMode = jest.fn()
  const onDelete = jest.fn()
  const items = buildObjectMenuItems({
    mode: 'rotate',
    onSelectMode,
    onDelete,
  })
  // [translate, rotate, scale, separator, 删除]
  expect(items).toHaveLength(5)
  expect(String((items[0] as any).label)).not.toContain('✓')
  expect(String((items[1] as any).label)).toContain('✓')
  expect(String((items[4] as any).label)).toContain('删除')
})

test('相机面板动作:路径为空不含对齐;Target 在不含恢复', () => {
  const a = buildCameraPanelActions({
    hasPoints: false,
    targetHidden: false,
    onAlignToPathStart: jest.fn(),
    onRestoreTarget: jest.fn(),
  })
  expect(Object.keys(a)).toEqual([])
  const b = buildCameraPanelActions({
    hasPoints: true,
    targetHidden: true,
    onAlignToPathStart: jest.fn(),
    onRestoreTarget: jest.fn(),
  })
  expect(Object.keys(b)).toEqual(['对齐到路径起点', '恢复 Target'])
})

test('路径面板动作:空路径不含平移', () => {
  expect(
    Object.keys(
      buildPathPanelActions({hasPoints: false, onMovePathToCamera: jest.fn()}),
    ),
  ).toEqual([])
  expect(
    Object.keys(
      buildPathPanelActions({hasPoints: true, onMovePathToCamera: jest.fn()}),
    ),
  ).toEqual(['路径平移到相机'])
})

test('导出菜单:每个 sink 一项,点击回传 sink', () => {
  const onPick = jest.fn()
  const sinks = [
    {id: 'a', label: 'WebM'},
    {id: 'b', label: 'MP4'},
  ] as any
  const items = buildExportMenuItems(sinks, onPick)
  expect(items).toHaveLength(2)
  ;(items[1] as any).callback?.({} as any)
  expect(onPick).toHaveBeenCalledWith(sinks[1])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest packages/playground/src/shared/camera/menuModel.test.ts`(根目录)
Expected: FAIL(module not found)

- [ ] **Step 3: 实现 menuModel.ts**

```ts
// packages/playground/src/shared/camera/menuModel.ts
/**
 * 菜单项/面板动作的纯构建层:所有右键菜单、下拉菜单、面板动作区的内容
 * 都在这里组装成数据,组件层(App/TopToolbar/各右键挂载点)只负责渲染
 * 和接回调。纯函数,单测直接断言结构。
 */
import type {ContextMenuItem} from '@toy-box/studio/uiComponents/chordial/chordialInternals'
import type {SheetObjectActionsConfig} from '@toy-box/core/types/public'
import {GIZMO_MODE_LABELS} from './PlacementManager'
import type {GizmoMode} from './PlacementManager'

export function buildCameraMenuItems(opts: {
  onViewShot: () => void
}): ContextMenuItem[] {
  return [
    {
      type: 'normal',
      label: '查看此镜头',
      callback: () => opts.onViewShot(),
    },
  ]
}

export function buildPathMenuItems(opts: {
  metaKey: string
  editing: boolean
  onToggleEdit: () => void
  onDelete: () => void
}): ContextMenuItem[] {
  return [
    {
      type: 'normal',
      label: opts.editing ? '退出编辑(Tab)' : '编辑路径(Tab)',
      callback: () => opts.onToggleEdit(),
    },
    {type: 'separator'},
    {
      type: 'normal',
      label: '删除路径',
      callback: () => opts.onDelete(),
    },
  ]
}

export function buildObjectMenuItems(opts: {
  mode: GizmoMode
  onSelectMode: (mode: GizmoMode) => void
  onDelete: () => void
}): ContextMenuItem[] {
  const modes: Array<GizmoMode> = ['translate', 'rotate', 'scale']
  return [
    ...modes.map(
      (m): ContextMenuItem => ({
        type: 'normal',
        // 无前导图标位,用全角空格对齐文字
        label: `${m === opts.mode ? '✓' : '　'}${GIZMO_MODE_LABELS[m]}`,
        callback: () => opts.onSelectMode(m),
      }),
    ),
    {type: 'separator'},
    {type: 'normal', label: '删除', callback: () => opts.onDelete()},
  ]
}

export function buildCameraPanelActions(opts: {
  hasPoints: boolean
  targetHidden: boolean
  onAlignToPathStart: () => void
  onRestoreTarget: () => void
}): SheetObjectActionsConfig {
  const actions: SheetObjectActionsConfig = {}
  // 空路径没有"起点"可对齐,不出按钮(actions 无 disabled 概念,用不出现表达)
  if (opts.hasPoints) {
    actions['对齐到路径起点'] = () => opts.onAlignToPathStart()
  }
  if (opts.targetHidden) {
    actions['恢复 Target'] = () => opts.onRestoreTarget()
  }
  return actions
}

export function buildPathPanelActions(opts: {
  hasPoints: boolean
  onMovePathToCamera: () => void
}): SheetObjectActionsConfig {
  if (!opts.hasPoints) return {}
  return {['路径平移到相机']: () => opts.onMovePathToCamera()}
}

export function buildExportMenuItems<S extends {label: string}>(
  sinks: readonly S[],
  onPick: (sink: S) => void,
): ContextMenuItem[] {
  return sinks.map((sink) => ({
    type: 'normal',
    label: sink.label,
    callback: () => onPick(sink),
  }))
}
```

注意:先确认 `GIZMO_MODE_LABELS` 和 `GizmoMode` 已从 PlacementManager 导出(`GizmoMode` 已导出;`GIZMO_MODE_LABELS` 若没有 export 关键字就补上)。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest packages/playground/src/shared/camera/menuModel.test.ts`(根目录)
Expected: 6 个测试全 PASS

- [ ] **Step 5: Commit**(仅用户说"提交"时执行)

```bash
git add packages/playground/src/shared/camera/menuModel.ts packages/playground/src/shared/camera/menuModel.test.ts packages/playground/src/shared/camera/PlacementManager.tsx
git commit -m "feat(playground): pure menu/action item builders for camera scene"
```

---

### Task 3: CanvasContextMenu 薄封装 + 三个右键菜单切换

**Files:**
- Create: `packages/playground/src/shared/camera/contextMenu.tsx`
- Modify: `packages/playground/src/shared/camera/App.tsx`(PathContextMenu 组件删除、pathMenu/objectMenu 渲染处、ShotCamera 的右键回调改相机菜单)
- Modify: `packages/playground/src/shared/camera/ShotCamera.tsx`(右键回调语义从"弹路径菜单"改"弹相机菜单",prop 改名)
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx:1276-1400` 附近(ObjectContextMenu 重写为薄封装调用)

**Interfaces:**
- Consumes: Task 2 的 `buildCameraMenuItems/buildPathMenuItems/buildObjectMenuItems`;studio `ContextMenu`(`@toy-box/studio/uiComponents/simpleContextMenu/ContextMenu/ContextMenu`,default export,props `{items, clickPoint?: {clientX, clientY}, onRequestClose}`)。
- Produces:
  ```tsx
  export function CanvasContextMenu(props: {
    position: {x: number; y: number}
    items: ContextMenuItem[]
    onClose: () => void
  }): JSX.Element
  ```
  App/PlacementManager 渲染它;ShotCamera 的右键 prop 改名 `onCameraContextMenu?: (x: number, y: number) => void`。

- [ ] **Step 1: 写薄封装**

```tsx
// packages/playground/src/shared/camera/contextMenu.tsx
/**
 * 画布右键菜单的统一出口:studio ContextMenu 的薄封装。
 * 样式/定位/点外关闭/Esc 关闭全部交给 studio 实现,
 * 这里只把"光标位置 + 菜单项 + 关闭回调"对齐过去。
 */
import React from 'react'
import ContextMenu from '@toy-box/studio/uiComponents/simpleContextMenu/ContextMenu/ContextMenu'
import type {ContextMenuItem} from '@toy-box/studio/uiComponents/chordial/chordialInternals'

export function CanvasContextMenu({
  position,
  items,
  onClose,
}: {
  position: {x: number; y: number}
  items: ContextMenuItem[]
  onClose: () => void
}) {
  return (
    <ContextMenu
      items={items}
      clickPoint={{clientX: position.x, clientY: position.y}}
      onRequestClose={onClose}
    />
  )
}
```

风险:ContextMenu 内部用了 reakit 的 `PortalContext`(默认应是 document.body)。浏览器验证时若菜单不渲染/报错,在封装里包一层 `<PortalContext.Provider value={document.body}>`(reakit 导出)。

- [ ] **Step 2: App.tsx 右键路径菜单切换**

删除 App.tsx 底部的 `PathContextMenu` 组件(约 1390-1501 行,整块删)。渲染处(约 1207-1222 行)改为:

```tsx
      {pathMenu && (
        <CanvasContextMenu
          position={{x: pathMenu.x, y: pathMenu.y}}
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
            onDelete: () => removePath(pathMenu.metaKey),
          })}
          onClose={() => setPathMenu(null)}
        />
      )}
```

objectMenu 渲染处(约 1194-1206 行)改为:

```tsx
      {objectMenu && (
        <CanvasContextMenu
          position={{x: objectMenu.x, y: objectMenu.y}}
          items={buildObjectMenuItems({
            mode: gizmoMode,
            onSelectMode: setGizmoMode,
            onDelete: () => {
              deletePlacement(sheet, objectMenu.key)
              getStudioSync()?.setSelection([])
            },
          })}
          onClose={() => setObjectMenu(null)}
        />
      )}
```

顶部 import 更新:去掉 `ObjectContextMenu`,加 `CanvasContextMenu`(来自 './contextMenu')和 `buildPathMenuItems/buildObjectMenuItems`(来自 './menuModel')。

- [ ] **Step 3: ShotCamera 右键 = 相机菜单**

ShotCamera.tsx:
- prop `onPathContextMenu?: (metaKey: string, x: number, y: number) => void` 改名 `onCameraContextMenu?: (x: number, y: number) => void`(两个 `contextMenu(...)` 用法同步改,不再传 POS_PATH_KEY);
- 相机右键不再选中相机后弹路径菜单,而是弹相机菜单。保留"右键先选中相机"的现状行为。

App.tsx:
- `<ShotCamera ... onCameraContextMenu={(x, y) => setCameraMenu({x, y})} />`,新 state `const [cameraMenu, setCameraMenu] = useState<{x: number; y: number} | null>(null)`;
- 渲染:

```tsx
      {cameraMenu && (
        <CanvasContextMenu
          position={cameraMenu}
          items={buildCameraMenuItems({
            onViewShot: () => setShotView(true),
          })}
          onClose={() => setCameraMenu(null)}
        />
      )}
```

- [ ] **Step 4: PlacementManager 的 ObjectContextMenu 删除**

`ObjectContextMenu` 组件(约 1276 行起到组件结束)整个删除——App 已改用 menuModel + CanvasContextMenu。`GIZMO_MODE_LABELS` 保留(加 export 若缺)。grep 确认没有其他文件 import ObjectContextMenu(只有 App.tsx)。

- [ ] **Step 5: 测试 + 浏览器验证**

Run: `npx jest packages/playground`(根目录)——现有 94 个测试 + menuModel 6 个全过。
浏览器(vite 起在 5199,`packages/playground` 目录,验完停掉):
1. 右键路径线 → studio 样式菜单,含"编辑路径(Tab)"/"删除路径";点外关闭。
2. 右键相机视锥 → 菜单只有"查看此镜头",点击切镜头视角。
3. 右键已放置模型 → 三项模式(当前打勾)+ 删除。
4. Esc / 点菜单外任意处,菜单关闭。

- [ ] **Step 6: Commit**(仅用户说"提交"时执行)

```bash
git add packages/playground/src/shared/camera/contextMenu.tsx packages/playground/src/shared/camera/App.tsx packages/playground/src/shared/camera/ShotCamera.tsx packages/playground/src/shared/camera/PlacementManager.tsx
git commit -m "refactor(playground): unify canvas context menus on studio ContextMenu"
```

---

### Task 4: 面板动作下沉(相机:对齐到路径起点/恢复 Target;路径:平移到相机)

**Files:**
- Modify: `packages/playground/src/shared/camera/ShotCamera.tsx`
- Modify: `packages/playground/src/shared/camera/CameraPath.tsx`(加 `setPathPanelActions`)
- Modify: `packages/playground/src/shared/camera/App.tsx`(删 alignCameraToPathStart/movePathToCamera/restoreTarget,注册路径面板动作)

**Interfaces:**
- Consumes: Task 1 的 `objectActions` prop;Task 2 的 `buildCameraPanelActions/buildPathPanelActions`;`samplePathPoint`/`usePathHasPoints`(CameraPath 已有)。
- Produces:
  ```ts
  // CameraPath.tsx
  export function setPathPanelActions(
    sheet: ISheet,
    metaKey: string,
    actions: SheetObjectActionsConfig,
  ): void
  ```

- [ ] **Step 1: CameraPath 加 setPathPanelActions**

```ts
// CameraPath.tsx,getPathMeta 之后
import type {SheetObjectActionsConfig} from '@toy-box/core/types/public'

/**
 * 给路径对象挂面板动作(属性后的按钮区,core 的 __actions__ 机制)。
 * 重复调用同 key 同 config 只更新 actions;actions 传 {} = 清空。
 * 调用前必须保证 getPathMeta 跑过(metaConfigCache 里有 config)。
 */
export function setPathPanelActions(
  sheet: ISheet,
  metaKey: string,
  actions: SheetObjectActionsConfig,
) {
  const config = metaConfigCache.get(metaKey)
  if (!config) return
  sheet.object(metaKey, config, {
    __actions__THIS_API_IS_UNSTABLE_AND_WILL_CHANGE_IN_THE_NEXT_VERSION:
      actions,
  })
}
```

- [ ] **Step 2: ShotCamera 挂相机面板动作**

把 App.tsx 的 `alignCameraToPathStart`(约 707-718 行)和 `restoreTarget`(约 639-646 行)逻辑搬进 ShotCamera:

```tsx
// ShotCamera.tsx 内,tracking 相关 hooks 之后
const alignToPathStart = useCallback(() => {
  const obj = cameraObjRef.current
  const studio = getStudioSync()
  if (!obj || !studio) return
  const tmp = new Vector3()
  if (!samplePathPoint(POS_PATH_KEY, 0, tmp)) return
  const scrub = studio.scrub()
  scrub.capture(({set}) =>
    set(obj.props.position, {x: tmp.x, y: tmp.y, z: tmp.z}),
  )
  scrub.commit()
}, [cameraObjRef])

const restoreTarget = useCallback(() => {
  const obj = cameraObjRef.current
  const studio = getStudioSync()
  if (!obj || !studio) return
  const scrub = studio.scrub()
  scrub.capture(({set}) => set(obj.props.targetHidden, false))
  scrub.commit()
}, [cameraObjRef])

// 面板动作区(属性后的按钮):动作配置必须 useMemo 缓存引用,
// 否则 editable 的 effect 每 render 重跑(见 Global Constraints)
const objectActions = useMemo(
  () =>
    buildCameraPanelActions({
      hasPoints: posPathHasPoints,
      targetHidden,
      onAlignToPathStart: alignToPathStart,
      onRestoreTarget: restoreTarget,
    }),
  [posPathHasPoints, targetHidden, alignToPathStart, restoreTarget],
)
```

`<PerspectiveCamera ... objectActions={objectActions}>`(`additionalProps` 旁边)。Vector3 已在 three import 里;`buildCameraPanelActions` 从 './menuModel' import。

- [ ] **Step 3: App 注册路径面板动作 + 删旧逻辑**

App.tsx 中 `posPathMeta` 声明之后加:

```tsx
// 路径面板动作区:路径平移到相机(空路径不出按钮);
// 动作配置必须 useMemo 缓存引用,重复注册同引用是幂等的
const posPathHasPoints = usePathHasPoints(sheet, POS_PATH_KEY)
const movePathToCamera = useCallback(() => {
  const cam = shotCameraObjRef.current
  if (!cam) return
  const tmp = new Vector3()
  if (!samplePathPoint(POS_PATH_KEY, 0, tmp)) return
  const c = val(cam.props.position)
  translatePath(sheet, POS_PATH_KEY, {x: c.x - tmp.x, y: c.y - tmp.y, z: c.z - tmp.z})
}, [sheet])
const pathPanelActions = useMemo(
  () => buildPathPanelActions({hasPoints: posPathHasPoints, onMovePathToCamera: movePathToCamera}),
  [posPathHasPoints, movePathToCamera],
)
useEffect(() => {
  setPathPanelActions(sheet, POS_PATH_KEY, pathPanelActions)
}, [sheet, pathPanelActions])
```

删除 App 里旧的 `alignCameraToPathStart`、`movePathToCamera`(原版)、`restoreTarget` 三个 useCallback。import 相应增减(`usePathHasPoints`、`setPathPanelActions`、`buildPathPanelActions` 加入;`samplePathPoint`/`translatePath` 保留)。

注意:App 已有 `usePathHasPoints`?——ShotCamera 里有,App 没有,需要从 './CameraPath' import。

- [ ] **Step 4: 测试 + 浏览器验证**

Run: `npx jest packages/playground packages/core`(根目录)全过。
浏览器验证(5199,验完停):
1. 路径有点时选中相机 → 面板属性下方出现"对齐到路径起点",点击后手动机位 = 路径起点(切手动模式看相机位置)。
2. 相机面板勾"删除 Target(可恢复)"→ 面板出现"恢复 Target"按钮,点击 Target 回来。
3. 选中路径(点路径线)→ 面板出现"路径平移到相机",点击后路径起点落到手动机位。
4. 空路径时两处按钮都不出现。

- [ ] **Step 5: Commit**(仅用户说"提交"时执行)

```bash
git add packages/playground/src/shared/camera/ShotCamera.tsx packages/playground/src/shared/camera/CameraPath.tsx packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): move camera/path actions into object panel action area"
```

---

### Task 5: TopToolbar —— 顶栏四项收进一个组件

**Files:**
- Create: `packages/playground/src/shared/camera/TopToolbar.tsx`
- Modify: `packages/playground/src/shared/camera/App.tsx`(删 4 个绝对定位按钮 + 两个手写下拉,改挂 TopToolbar)

**Interfaces:**
- Consumes: studio `useMenu`(`@toy-box/studio/uiComponents/simpleContextMenu/useMenu`,default export,签名 `[node, open, close, isOpen] = useMenu({items, ...})`);Task 2 的 `buildExportMenuItems`;Task 3 的 `CanvasContextMenu` 不需要(导出下拉直接用 useMenu 返回的 node)。
- Produces:
  ```tsx
  export function TopToolbar(props: {
    placing: boolean
    onOpenLibrary: () => void
    addPathEnabled: boolean
    onAddPath: () => void
    exportSinks: readonly ExportSink[]
    exporting: boolean
    onPickExportSink: (sink: ExportSink) => void
    onStopExport: () => void
  }): JSX.Element
  ```
  `ExportSink` 用 App 现有 `listSinks()` 返回元素的类型(看 App.tsx 里 `listSinks` 的 import 来源,从同一模块 import 类型,不新造)。

- [ ] **Step 1: 写 TopToolbar**

```tsx
// packages/playground/src/shared/camera/TopToolbar.tsx
/**
 * 顶栏工具条:只放全局动作——添加(模型/相机/路径)和导出视频。
 * 物体的属性设置在各自面板,物体的动作在面板动作区和右键菜单,
 * 都不进这里(见 docs/superpowers/specs/2026-09-01-camera-menu-reorg-design.md)。
 * 一个 flex 容器按顺序排,不再写死像素偏移。
 */
import React, {useRef} from 'react'
import useMenu from '@toy-box/studio/uiComponents/simpleContextMenu/useMenu'
import {buildExportMenuItems} from './menuModel'

/** listSinks() 返回元素的类型,由 App 从 videoExport 模块 re-export 传入 */
export type ToolbarExportSink = {id: string; label: string}

function buttonStyle(
  disabled: boolean,
  danger = false,
): React.CSSProperties {
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
  placing,
  onOpenLibrary,
  addPathEnabled,
  onAddPath,
  exportSinks,
  exporting,
  onPickExportSink,
  onStopExport,
}: {
  placing: boolean
  onOpenLibrary: () => void
  addPathEnabled: boolean
  onAddPath: () => void
  exportSinks: readonly ToolbarExportSink[]
  exporting: boolean
  onPickExportSink: (sink: ToolbarExportSink) => void
  onStopExport: () => void
}) {
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const [exportMenuNode, openExportMenu] = useMenu({
    items: () =>
      buildExportMenuItems(exportSinks, (sink) => onPickExportSink(sink)),
  })

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
      <button
        disabled={placing}
        onClick={onOpenLibrary}
        style={buttonStyle(placing)}
      >
        {placing ? '放置中:左键确认落点,Esc/右键取消' : '添加模型'}
      </button>
      {/* P1 单例:相机恒存在,按钮恒灰;多相机在 P2 开放 */}
      <button disabled style={buttonStyle(true)} title="多相机将在后续版本开放">
        添加相机
      </button>
      <button
        disabled={!addPathEnabled}
        onClick={onAddPath}
        style={buttonStyle(!addPathEnabled)}
        title={
          addPathEnabled
            ? '从当前机位播种一段环绕弧,并进入编辑模式'
            : '已存在路径;多路径将在后续版本开放'
        }
      >
        添加路径
      </button>
      <button
        ref={exportButtonRef}
        onClick={() => {
          if (exporting) {
            onStopExport()
            return
          }
          const rect = exportButtonRef.current?.getBoundingClientRect()
          openExportMenu(
            rect
              ? {clientX: rect.left, clientY: rect.bottom + 4}
              : undefined,
          )
        }}
        style={buttonStyle(false, exporting)}
        title="把镜头取景实时录成视频:序列从头播到尾,录完自动保存"
      >
        {exporting ? '停止并保存(Esc 取消)' : '导出视频'}
      </button>
      {exportMenuNode}
    </div>
  )
}
```

注意:现状导出下拉每项有 description,studio ContextMenu 没有对应物,只用 label(P1 接受这个信息损失;sink 的 label 已自解释)。

- [ ] **Step 2: App.tsx 换挂 TopToolbar**

删除:4 个绝对定位按钮(约 944-1033 行)、`pathMenuOpen` 下拉(约 1034-1101 行)、`exportMenuOpen` 下拉(约 1102-1146 行)、`pathMenuOpen`/`exportMenuOpen` 两个 state、"路径"按钮的 title 长文案、旧 `addPosPathPoint` 里 moveMode 切换(见 Step 3)。

新增(替换在原按钮区位置):

```tsx
      <TopToolbar
        placing={!!placing}
        onOpenLibrary={() => setLibraryOpen((v) => !v)}
        addPathEnabled={!posPathHasPoints}
        onAddPath={addPosPathPoint}
        exportSinks={listSinks()}
        exporting={exporting}
        onPickExportSink={(sink) => {
          prevShotViewRef.current = shotView
          pendingExportSinkRef.current = sink
          setShotView(true)
        }}
        onStopExport={() => exportHandleRef.current?.finishEarly()}
      />
```

- [ ] **Step 3: addPosPathPoint 去掉自动切驱动**

```ts
// App.tsx
// 添加路径:空路径从当前机位播种一段环绕弧,然后进编辑模式。
// 不自动切相机驱动(用户决策:驱动与否只在相机面板配)
const addPosPathPoint = useCallback(() => {
  const cam = shotCameraObjRef.current
  const target = shotTargetObjRef.current
  const seed =
    cam && target
      ? seedArcPoints(val(cam.props.position), val(target.props.position))
      : undefined
  addPathPoint(sheet, POS_PATH_KEY, seed)
  enterPathEdit(POS_PATH_KEY)
}, [sheet, enterPathEdit])
```

即删掉 `addPathPoint` 的第四个参数(原 `(set) => {if (cam) set(cam.props.moveMode, 'path')}` 回调)。先确认 `addPathPoint` 签名(`CameraPath.tsx:287`),第四参数省略合法。

- [ ] **Step 4: 测试 + 浏览器验证**

Run: `npx jest packages/playground`(根目录)全过。
浏览器(5199,验完停):
1. 顶栏一条工具条,四按钮横排:添加模型 / 添加相机(灰) / 添加路径 / 导出视频。
2. 空路径点"添加路径"→ 播种弧出现并进编辑模式;相机 moveMode 面板里仍是手动(没被自动切)。
3. 路径非空后"添加路径"变灰。
4. "导出视频"下拉列出 sink,选一个进入导出流程(可 Esc 取消)。

- [ ] **Step 5: Commit**(仅用户说"提交"时执行)

```bash
git add packages/playground/src/shared/camera/TopToolbar.tsx packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): consolidate top overlay buttons into TopToolbar"
```

---

### Task 6: 编辑浮条收编 + 提示条降级 + 镜头视角退出

**Files:**
- Modify: `packages/playground/src/shared/camera/CameraPath.tsx`(PathPointEditor 区域加 PathEditBar)
- Modify: `packages/playground/src/shared/camera/App.tsx`(浮条挂载、提示条、Esc、删 removePathPoint、删镜头视角按钮残留)

**Interfaces:**
- Consumes: `addPathPoint`/`deletePathPoint`/`seedArcPoints`(CameraPath);App 的 `editingPath/selectedPathPoint/shotView`。
- Produces:
  ```tsx
  // CameraPath.tsx
  export function PathEditBar(props: {
    hasSelection: boolean
    onAddPoint: () => void
    onDeleteSelected: () => void
  }): JSX.Element
  ```

- [ ] **Step 1: CameraPath 加 PathEditBar**

放在 PathPointEditor 上方文件区域(样式与 PathPointEditor 同款):

```tsx
/**
 * 路径编辑模式的工具浮条:加点/删点。点级操作的家——全局菜单不出现
 * 这些(见菜单设计文档)。选中点的数值/锚点编辑在它下面的 PathPointEditor。
 */
export function PathEditBar({
  hasSelection,
  onAddPoint,
  onDeleteSelected,
}: {
  hasSelection: boolean
  onAddPoint: () => void
  onDeleteSelected: () => void
}) {
  const btn = (disabled: boolean): React.CSSProperties => ({
    padding: '3px 10px',
    borderRadius: 4,
    border: '1px solid #555',
    background: 'transparent',
    color: disabled ? '#777' : '#eee',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 12,
  })
  return (
    <div
      style={{
        position: 'absolute',
        top: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: '#272730',
        border: '1px solid #444',
        borderRadius: 6,
        fontSize: 12,
        color: '#eee',
      }}
    >
      <button style={btn(false)} onClick={onAddPoint} title="在路径末尾续一个控制点">
        加点
      </button>
      <button
        style={btn(!hasSelection)}
        disabled={!hasSelection}
        onClick={onDeleteSelected}
        title={hasSelection ? '删除选中的控制点' : '先点选一个控制点'}
      >
        删除选中点
      </button>
    </div>
  )
}
```

注意:PathPointEditor 现 top:56 —— 两个条都 56 会叠。PathEditBar 保持 top:56,把 PathPointEditor 的 top 改成 96(下移一层)。

- [ ] **Step 2: App 挂浮条 + 删 removePathPoint**

App.tsx:
- `removePathPoint` useCallback(约 677-686 行,含 alert 教学)删除,替换为:

```tsx
const deleteSelectedPathPoint = useCallback(() => {
  if (
    selectedPathPoint &&
    deletePathPoint(sheet, selectedPathPoint.metaKey, selectedPathPoint.key)
  ) {
    setSelectedPathPoint(null)
  }
}, [sheet, selectedPathPoint])
```

- PathPointEditor 挂载处(约 1259-1272 行)前面加:

```tsx
      {editingPath && !shotView && (
        <PathEditBar
          hasSelection={
            !!selectedPathPoint && selectedPathPoint.metaKey === editingPath
          }
          onAddPoint={addPosPathPoint}
          onDeleteSelected={deleteSelectedPathPoint}
        />
      )}
```

(`addPosPathPoint` 在 Task 5 已改为"空则播种、非空续点、不自动切驱动"。它调 enterPathEdit 无害——已在编辑模式。)
- import:`PathEditBar` 从 './CameraPath',`deletePathPoint` 保留。

- [ ] **Step 3: Target 提示条降级 + 挪位**

App.tsx 的 targetMissing 条(约 1223-1258 行):
- 删掉 `<button>重新添加 Target</button>` 及其样式(restoreTarget 已在 Task 4 搬到 ShotCamera 面板动作,App 里的 restoreTarget 已删);
- 文案改:`Target 已删除,相机保持当前朝向(相机面板可恢复)`;
- `top: 12` 改 `top: 52`(工具条下方,不再和资产库/工具条重叠)。

- [ ] **Step 4: 镜头视角 Esc 退出 + 提示**

App.tsx:
- 镜头视角按钮已在 Task 5 随旧顶栏删除;`shotView` state 和导出流程保留。
- 加 Esc 退出(导出有自己独立的 Esc=取消导出 effect,优先;这里只在非导出时挂):

```tsx
// 镜头视角下 Esc 返回导演视角(导出中 Esc 是取消导出,见上面的导出 effect;
// 两个 effect 不共存:导出中 exporting=true 时本 effect 不挂)
useEffect(() => {
  if (!shotView || exporting) return
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setShotView(false)
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [shotView, exporting])
```

- 镜头视角下顶部加一个不可点击的提示 chip(GizmoModeHint 同款样式):

```tsx
      {shotView && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '4px 10px',
            borderRadius: 6,
            background: 'rgba(0,0,0,0.55)',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 12,
            pointerEvents: 'none',
            userSelect: 'none',
            zIndex: 10,
          }}
        >
          镜头视角 · Esc 返回导演视角
        </div>
      )}
```

- [ ] **Step 5: 全量测试 + 浏览器验证矩阵**

Run: `npx jest packages/playground packages/core`(根目录)全过。
浏览器(5199,验完停)验证矩阵:
1. 编辑模式下顶部出现编辑浮条:加点 → 末尾续点;选中点 → 删除选中点可用;未选点 → 删除选中点置灰。
2. 选中控制点 → 数值浮条在编辑浮条**下方**(不重叠),锚点/钉播放头照常。
3. Target 软删后:顶部警告条只有文字、在工具条下方;恢复走相机面板"恢复 Target"。
4. 右键相机 → 查看此镜头 → 进镜头视角,顶部出现提示 chip;Esc 返回。
5. 回归:Tab 进出编辑、失焦退出、点选控制点、G 抓取、导出视频全流程。

- [ ] **Step 6: Commit**(仅用户说"提交"时执行)

```bash
git add packages/playground/src/shared/camera/CameraPath.tsx packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): edit-mode float bar, demoted target warning, Esc exits shot view"
```

---

### Task 7: 收尾回归 + 记忆/文档更新

**Files:**
- Modify: `packages/playground/src/shared/camera/App.tsx`(顶部注释/头文件说明若提到旧菜单布局则更新)
- Modify: `/Users/huhui/.claude/projects/-Users-huhui-Projects-theatre/memory/camera-playground-ops.md`(菜单新体系要点)

- [ ] **Step 1: 全仓测试**

Run: `npx jest packages/playground packages/core packages/r3f`(根目录)
Expected: 全过(r3f 若无测试套件会自动跳过)

- [ ] **Step 2: 代码内注释同步**

检查 App.tsx 文件头注释、ShotCamera.tsx 头注释(提到"右键相机弹机位路径菜单"之类的旧描述)改为新归属;CameraPath.tsx 头注释里"App 层另有数值浮条"补编辑浮条。

- [ ] **Step 3: 记忆更新**

`camera-playground-ops.md` 追加:菜单体系 = toolbar 四项(添加模型/相机/路径/导出)+ studio ContextMenu 右键 + 面板动作区(__actions__ 机制,r3f objectActions 透传)+ 编辑浮条;镜头视角 = 右键相机/Esc;menuModel 纯函数层位置;添加路径不自动切驱动(用户决策)。

- [ ] **Step 4: Commit**(仅用户说"提交"时执行)

```bash
git add packages/playground/src/shared/camera
git commit -m "docs(playground): sync header comments with new menu ownership"
```
