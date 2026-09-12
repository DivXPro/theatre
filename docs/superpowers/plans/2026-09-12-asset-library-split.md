# 资产库分拆(四框体按需弹出)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把统一资产库面板拆成模型/姿势/动作/路径四个独立框体,按使用需要弹出:模型/路径走顶栏新增按钮,姿势/动作走右键模型菜单。

**Architecture:** `AssetLibraryPanel` 加一个 `kind` 属性改成单类型框体组件(不复制代码);App 把一个总开关换成四个独立开关并挂载四个实例;顶栏「资产库」换「添加模型」「添加路径」两按钮;对象右键菜单加「改变姿势」「播放动作」两个可选菜单项。

**Tech Stack:** React + three.js/@react-three/fiber + theatre.js(jest + jest-esbuild 单测,Playwright 手动验收)

**Spec:** `docs/superpowers/specs/2026-09-12-asset-library-split-design.md`

## Global Constraints

- 只改 `packages/playground/src/shared/camera/` 内文件;1.0 公开 API 冻结,不动其他包
- commit 格式 `type(scope): 中文描述`,结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- **禁止** `git add -u` / `git add .`——逐文件显式 `git add`
- 每次 commit 后跑 `git checkout -- packages/dataverse/api/`(lint-staged/typedoc 会顺手改它,不归我们管)
- 单测命令:`yarn test packages/playground/src/shared/camera/<文件>.test.ts`
- 双 typecheck 都要过:`npx tsc --noEmit -p packages/playground/tsconfig.json` 和 `yarn typecheck`
- jest 用 jest-esbuild,**不提升 jest.mock**;需要 mock 就 `jest.doMock` + `jest.resetModules()` + 运行时 require
- theatre prop 配置保持模块级稳定(本计划不新增 sheet.object 配置,仅复用既有)
- 用户规矩:发生需要回退的情况时**提示用户,绝不自动回退**

---

### Task 1: 对象右键菜单加「改变姿势」「播放动作」可选项

**Files:**
- Modify: `packages/playground/src/shared/camera/menuModel.ts:55-73`(`buildObjectMenuItems`)
- Test: `packages/playground/src/shared/camera/menuModel.test.ts`

**Interfaces:**
- Consumes: 现有 `ContextMenuItem`(`{type: 'normal'|'separator', label, callback}`)
- Produces: `buildObjectMenuItems` 新签名——`opts` 增加两个可选回调 `onChangePose?: () => void`、`onPlayAnimation?: () => void`。提供时菜单结构为 `[改变姿势?, 播放动作?, separator, translate, rotate, scale, separator, 删除]`;不提供时保持现状 5 项不变。Task 2 的 App 接线消费这两个参数。

- [ ] **Step 1: 写失败测试**

在 `menuModel.test.ts` 现有「对象右键菜单」测试(约 45-61 行,断言 5 项结构)之后追加:

```ts
test('对象右键菜单:提供姿势/动作回调时多出两项,位于手柄模式上方', () => {
  const onSelectMode = jest.fn()
  const onDelete = jest.fn()
  const onChangePose = jest.fn()
  const onPlayAnimation = jest.fn()
  const items = buildObjectMenuItems({
    mode: 'rotate',
    onSelectMode,
    onDelete,
    onChangePose,
    onPlayAnimation,
  })
  // [改变姿势, 播放动作, sep, translate, rotate, scale, sep, 删除]
  expect(items.map((i) => i.type)).toEqual([
    'normal', 'normal', 'separator',
    'normal', 'normal', 'normal',
    'separator', 'normal',
  ])
  expect(String((items[0] as any).label)).toContain('改变姿势')
  expect(String((items[1] as any).label)).toContain('播放动作')
  expect(String((items[7] as any).label)).toContain('删除')
  ;(items[0] as any).callback?.({} as any)
  expect(onChangePose).toHaveBeenCalled()
  ;(items[1] as any).callback?.({} as any)
  expect(onPlayAnimation).toHaveBeenCalled()
})

test('对象右键菜单:只传姿势回调时只有「改变姿势」一项', () => {
  const items = buildObjectMenuItems({
    mode: 'translate',
    onSelectMode: jest.fn(),
    onDelete: jest.fn(),
    onChangePose: jest.fn(),
  })
  // [改变姿势, sep, translate, rotate, scale, sep, 删除]
  expect(items).toHaveLength(7)
  expect(String((items[0] as any).label)).toContain('改变姿势')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn test packages/playground/src/shared/camera/menuModel.test.ts`
Expected: FAIL(两个新测试报 `onChangePose is not a function` 或结构断言不通过;旧测试仍绿)

- [ ] **Step 3: 改 `buildObjectMenuItems`**

把 `menuModel.ts:55-73` 整个函数替换为:

```ts
export function buildObjectMenuItems(opts: {
  mode: GizmoMode
  onSelectMode: (mode: GizmoMode) => void
  onDelete: () => void
  /** 提供时菜单顶部出「改变姿势」(右键库来源模型时由 App 传入) */
  onChangePose?: () => void
  /** 提供时菜单顶部出「播放动作」 */
  onPlayAnimation?: () => void
}): ContextMenuItem[] {
  const modes: Array<GizmoMode> = ['translate', 'rotate', 'scale']
  const applyItems: ContextMenuItem[] = []
  if (opts.onChangePose) {
    applyItems.push({
      type: 'normal',
      label: '改变姿势',
      callback: opts.onChangePose,
    } as ContextMenuItem)
  }
  if (opts.onPlayAnimation) {
    applyItems.push({
      type: 'normal',
      label: '播放动作',
      callback: opts.onPlayAnimation,
    } as ContextMenuItem)
  }
  if (applyItems.length > 0) applyItems.push({type: 'separator'})
  return [
    ...applyItems,
    ...modes.map(
      (m): ContextMenuItem => ({
        type: 'normal',
        // 无前导图标位,用全角空格对齐文字
        label: `${m === opts.mode ? '✓' : '　'}${GIZMO_MODE_LABELS[m]}`,
        callback: () => opts.onSelectMode(m),
      }),
    ),
    {type: 'separator'},
    {type: 'normal', label: '删除', callback: opts.onDelete},
  ]
}
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `yarn test packages/playground/src/shared/camera/menuModel.test.ts`
Expected: PASS(新 2 个 + 旧全部)

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/menuModel.ts packages/playground/src/shared/camera/menuModel.test.ts
git commit -m "feat(playground): 对象右键菜单加「改变姿势」「播放动作」可选项

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git checkout -- packages/dataverse/api/
```

---

### Task 2: 四框体接线(panel kind 化 + 顶栏两按钮 + App 四开关与菜单接线)

**Files:**
- Modify: `packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx`(整体:加 `kind`、去 tab)
- Modify: `packages/playground/src/shared/camera/TopToolbar.tsx:24-103`
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`(导出 `PlacementEntry` 类型 + 新增 `readPlacementEntries`,约 56-63 行与 294-299 行附近)
- Modify: `packages/playground/src/shared/camera/App.tsx`(660 行开关状态、1230-1239 顶栏、1310-1325 面板挂载、1326-1339 对象菜单)

**Interfaces:**
- Consumes: Task 1 的 `buildObjectMenuItems` 新可选参数 `onChangePose`/`onPlayAnimation`
- Produces:
  - `AssetLibraryPanel` 新签名:`kind: 'model'|'pose'|'animation'|'path'` 必填;`onPlaceModel` 改为可选(其余可选性不变)
  - `TopToolbar` 新签名:`onToggleModelLibrary: () => void`、`onTogglePathLibrary: () => void`(替换 `onToggleLibrary`)
  - `PlacementManager` 新导出:`type PlacementEntry`(已有类型加 export)、`readPlacementEntries(sheet: ISheet): PlacementEntry[]`

- [ ] **Step 1: PlacementManager 导出类型与清单读取**

`PlacementManager.tsx:56` 的 `type PlacementEntry = {` 改为 `export type PlacementEntry = {`。

在 `readPlacementPositions`(约 294-299 行)后面加:

```ts
/** 读放置清单全部 entry(App 判右键对象是否库来源用)。registry 对象由
 *  PlacedModels 挂载时已创建,同 key 同配置的 sheet.object 是安全的重复调用 */
export function readPlacementEntries(sheet: ISheet): PlacementEntry[] {
  return readRegistry(getRegistry(sheet))
}
```

(纯访问器,与 `readPlacementPositions` 同样不写单测——registry 读取的正确性由 Task 3 浏览器验收覆盖。)

- [ ] **Step 2: AssetLibraryPanel 按 kind 单类型化**

2a. 文件顶部删掉 `type Tab = 'model' | 'pose' | 'animation' | 'path'`(约 11 行),换成:

```ts
export type AssetKind = 'model' | 'pose' | 'animation' | 'path'

/** 框体标题:一个组件四个实例,按类型各显各的 */
const KIND_TITLE: Record<AssetKind, string> = {
  model: '模型库',
  pose: '姿势库',
  animation: '动作库',
  path: '路径预设',
}

/** 多框体同开时贴左边缘按类型错开,避免完全重叠 */
const KIND_OFFSET: Record<AssetKind, number> = {
  model: 0,
  path: 16,
  pose: 32,
  animation: 48,
}
```

2b. 组件 props(约 80-106 行):加 `kind: AssetKind` 必填,`onPlaceModel` 改为可选(`onPlaceModel?: (entry: ModelEntry) => void`),其余不动。删掉 `const [tab, setTab] = useState<Tab>('model')`(约 107 行)。

2c. `modelGesture` 的 onClick 改为 `(entry) => onPlaceModel?.(entry)`(约 121 行)。

2d. 头部(约 461-564 行):删掉四个 tab 按钮,换成标题文本;导入按钮条件从 `tab !== 'path'` 改为 `kind !== 'path'`:

```tsx
      {/* 头部:类型标题 + 导入(路径框体没有)+ 关闭 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
        }}
      >
        <span style={{fontSize: 13, fontWeight: 600}}>{KIND_TITLE[kind]}</span>
        <div style={{flex: 1}} />
        {kind !== 'path' && (
          <button
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.9)',
              cursor: busy ? 'default' : 'pointer',
              fontSize: 13,
            }}
          >
            导入
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            padding: '4px 8px',
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer',
            fontSize: 15,
          }}
          aria-label="关闭"
        >
          ×
        </button>
      </div>
```

2e. 其余 `tab` 引用全部换 `kind`(语义一一对应):
- filterRig 提示条(约 578 行):`(tab === 'animation' || tab === 'pose')` → `(kind === 'animation' || kind === 'pose')`
- 存姿势行(约 593 行):`tab === 'pose'` → `kind === 'pose'`
- 卡片网格(约 636-642 行):`tab === 'model'` → `kind === 'model'`,`tab === 'pose'` → `kind === 'pose'`,`tab === 'path'` → `kind === 'path'`

2f. 外层容器样式(约 445 行):`left: 0` 改为 `left: KIND_OFFSET[kind]`。

- [ ] **Step 3: TopToolbar 两按钮**

3a. 文件头注释(1-6 行)改为:

```ts
/**
 * 顶栏工具条:只放全局动作——添加模型、添加路径(各弹各的框体)、添加
 * 相机、导出视频。姿势/动作绑定具体物体,入口在右键模型的菜单里;物体
 * 的属性设置在各自面板(见 docs/superpowers/specs/2026-09-12-asset-library-split-design.md)。
 */
```

3b. props:`onToggleLibrary: () => void` 换成两个:

```ts
export function TopToolbar({
  onToggleModelLibrary,
  onTogglePathLibrary,
  onAddCamera,
  exportSinks,
  exporting,
  exportDisabled,
  onPickExportSink,
  onStopExport,
  libraryDisabled = false,
}: {
  onToggleModelLibrary: () => void
  onTogglePathLibrary: () => void
  onAddCamera: () => void
  exportSinks: readonly ExportSink[]
  exporting: boolean
  exportDisabled: boolean
  onPickExportSink: (sink: ExportSink) => void
  onStopExport: () => void
  /** 放置中/拖拽中禁用添加入口,避免再开一次放置流程 */
  libraryDisabled?: boolean
}) {
```

3c. 「资产库」按钮(约 63-70 行)换成两枚:

```tsx
      <button
        disabled={libraryDisabled}
        onClick={onToggleModelLibrary}
        style={buttonStyle(libraryDisabled)}
        title={libraryDisabled ? '放置中:先确认或取消当前放置' : undefined}
      >
        添加模型
      </button>
      <button
        disabled={libraryDisabled}
        onClick={onTogglePathLibrary}
        style={buttonStyle(libraryDisabled)}
        title={libraryDisabled ? '放置中:先确认或取消当前放置' : undefined}
      >
        添加路径
      </button>
```

- [ ] **Step 4: App 四开关 + 四框体挂载 + 菜单接线**

4a. `App.tsx:660` 的 `const [libraryOpen, setLibraryOpen] = useState(false)` 替换为:

```ts
  // 资产库拆成四个独立框体,按使用需要弹出:模型/路径走顶栏按钮,
  // 姿势/动作走右键模型的菜单;框体不自动收起,各关各的
  type LibraryFrameKind = 'model' | 'pose' | 'animation' | 'path'
  const [frameOpen, setFrameOpen] = useState<
    Record<LibraryFrameKind, boolean>
  >({model: false, pose: false, animation: false, path: false})
  const openFrame = useCallback(
    (kind: LibraryFrameKind) => setFrameOpen((f) => ({...f, [kind]: true})),
    [],
  )
  const toggleFrame = useCallback(
    (kind: LibraryFrameKind) =>
      setFrameOpen((f) => ({...f, [kind]: !f[kind]})),
    [],
  )
  const closeFrame = useCallback(
    (kind: LibraryFrameKind) =>
      setFrameOpen((f) => (f[kind] ? {...f, [kind]: false} : f)),
    [],
  )
```

(注意:`type` 声明写在组件函数体内顶部、useState 之前即可;若 lint 报组件内类型声明问题,提到组件外模块级。)

4b. 顶栏(1230-1239 行)`onToggleLibrary={() => setLibraryOpen((v) => !v)}` 换成:

```tsx
        onToggleModelLibrary={() => toggleFrame('model')}
        onTogglePathLibrary={() => toggleFrame('path')}
```

4c. 面板挂载(1310-1325 行的 `{libraryOpen && (<AssetLibraryPanel ... />)}`)整块替换为四个实例:

```tsx
      {frameOpen.model && (
        <AssetLibraryPanel
          kind="model"
          onPlaceModel={placeModelAtDefault}
          onDragStartModel={startModelDrag}
          disabled={rigLoading}
          onClose={() => closeFrame('model')}
        />
      )}
      {frameOpen.path && (
        <AssetLibraryPanel
          kind="path"
          onPlacePreset={(preset: PathPreset) => placePresetPath(preset)}
          onDragStartPreset={(preset: PathPreset) => setPresetDrag(preset)}
          onClose={() => closeFrame('path')}
        />
      )}
      {frameOpen.pose && (
        <AssetLibraryPanel
          kind="pose"
          onApplyPose={applyPose}
          onSavePose={onSavePose}
          canSavePose={canSavePose}
          applyDisabled={!canApplyPose}
          disabled={rigLoading}
          filterRig={selectedRig}
          onClose={() => closeFrame('pose')}
        />
      )}
      {frameOpen.animation && (
        <AssetLibraryPanel
          kind="animation"
          onApplyAnimation={applyAnimation}
          applyDisabled={!canApplyAnimation}
          disabled={rigLoading}
          filterRig={selectedRig}
          onClose={() => closeFrame('animation')}
        />
      )}
```

4d. 对象菜单(1326-1339 行)的 `items={buildObjectMenuItems({...})}` 加两个条件回调:

```tsx
          items={buildObjectMenuItems({
            mode: gizmoMode,
            onSelectMode: setGizmoMode,
            onDelete: () => {
              deletePlacement(sheet, objectMenu.key)
              // 被删的对象留在选中列表里没意义，顺带清掉
              getStudioSync()?.setSelection([])
            },
            // 库来源模型才有姿势/动作可套(本地遗留放置体没有库 id);
            // 骨架不匹配的置灰由框体自己兜
            ...(readPlacementEntries(sheet).find(
              (e) => e.key === objectMenu.key,
            )?.libraryEntryId !== undefined
              ? {
                  onChangePose: () => openFrame('pose'),
                  onPlayAnimation: () => openFrame('animation'),
                }
              : {}),
          })}
```

4e. App 顶部 import:`readPlacementEntries` 加入 `./PlacementManager` 的既有 import 列表(约 40-57 行区域,和 `deletePlacement` 等同来源)。

- [ ] **Step 5: 双 typecheck**

Run: `npx tsc --noEmit -p packages/playground/tsconfig.json`
Expected: 无错误
Run: `yarn typecheck`
Expected: 无错误

- [ ] **Step 6: 全量单测回归**

Run: `yarn test packages/playground/src/shared/camera/`
Expected: 全部 PASS(menuModel / dropPoint / pathPresets 等)

- [ ] **Step 7: Commit**

```bash
git add packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx packages/playground/src/shared/camera/TopToolbar.tsx packages/playground/src/shared/camera/PlacementManager.tsx packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): 资产库拆四框体按需弹出,顶栏收编为添加模型/添加路径

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git checkout -- packages/dataverse/api/
```

---

### Task 3: 浏览器验收(Playwright)

**Files:** 无改动;验收脚本化操作 dev server 上的 playground

**Interfaces:**
- Consumes: Task 2 的全部 UI

- [ ] **Step 1: 起 dev server 并打开 playground**

若 dev server 已在跑(端口 8082)直接复用;否则 `yarn playground:camera`(或既有启动命令)后台起。用 Playwright 打开相机 playground 页面。

- [ ] **Step 2: 顶栏与模型框体**

断言:顶栏有「添加模型」「添加路径」「添加相机」「导出视频」,**没有**「资产库」。
点「添加模型」→ 模型框体出现(标题「模型库」,有导入按钮);点卡片 → 模型落默认位;再点一次 → 自动错位;从卡片拖拽到画布 → 落在指针处;框体不收起;点 × 关闭。

- [ ] **Step 3: 路径框体**

点「添加路径」→ 路径框体出现(标题「路径预设」,**无**导入按钮);点「环绕圆」→ 默认位生成并进编辑模式;框体不收起;拖拽「8 字」到画布 → 落点生成;点 × 关闭。

- [ ] **Step 4: 姿势/动作框体(右键入口)**

右键一个库来源已放置模型 → 菜单含「改变姿势」「播放动作」(在手柄模式上方);点「改变姿势」→ 姿势框体出现(标题「姿势库」,有「存当前姿势」按钮和导入按钮);点「播放动作」→ 动作框体出现。右键相机/背景/路径 → 菜单**无**这两项。
(注:本 demo 场景无带骨架模型,姿势/动作卡片会全部置灰——验证框体出现、置灰、提示条即可,套用链路此前已验。)

- [ ] **Step 5: 多框体同开与独立关闭**

同时开模型框体 + 路径框体 + 姿势框体:互不遮挡关键内容(按类型错开),各点 × 各关各的;放置/拖拽一个模型后框体都保持打开。

- [ ] **Step 6: 汇报验收结果**

逐项列出通过/失败;有失败回到对应任务修,不要带着失败收尾。
