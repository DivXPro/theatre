# 宿主接管"添加模型/路径"选择界面设计(host picker integration)

> 状态:待评审(2026-09-21)
> 关联评估:UI 全面替换 shadcn 的评估结论为不做全面替换;宿主化只切"选择框"这一层。

## 背景与问题

- camera 场景(模型放置/路径预设)要嵌进使用 shadcn 的宿主应用,宿主希望
  "新增模型、路径"的**选择界面用自己的 UI**,风格与宿主一致。
- 现状:顶栏按钮、库框体(`AssetLibraryPanel`)、放置流程全在
  `packages/playground/src/shared/camera/` 内,选择框样式是库自己的
  styled-components,宿主无法替换;能力函数(`startPlacingFromLibrary`、
  `placeLibraryEntryAt`、`placePresetPath`)已存在,但埋在 App.tsx /
  PlacementManager 内部,外部够不到。

## 目标

1. 顶栏"添加模型/添加路径"按钮**留在库里**(视觉与行为统一),点击后打开
   的**选择框由宿主注入**:宿主收到通知,用自己的组件(如 shadcn Dialog)
   渲染选择界面,可挂在宿主树的任意位置。
2. 库暴露**方法句柄 + hook**,让宿主 UI 组件能衔接两种放置交互:
   - **点选**:调 `startPlacingModel(entry)` → 画布出放置幽灵,点击落点确认;
   - **拖拽**:宿主组件可拖,松手时调 `placeModelAt(entry, point)`,
     `point` 由库提供的 `dropPointFromClient(clientX, clientY)` 换算。
3. 不传宿主回调时行为与今天完全一致(内置框体作为默认实现保留)。

## 非目标(本期不做)

- 顶栏按钮本身的替换/换肤;加相机、加锚点、导出、画中画按钮的形态不变
  (这些没有"选择界面",宿主日后想自管入口时可直接调句柄里的方法)。
- 姿势/动作两个框体的宿主化(接口形态跑通后照抄同一模式,二期)。
- studio 内核(shadow DOM 部分)的任何改动。
- 放置幽灵在画布内的交互(跟随光标/落点吸附/确认取消)留在库里。

## 方案

### 1. 对外接口:场景根组件新增三个可选 prop

```ts
type CameraSceneProps = {
  // ...既有 props 不变

  /** 场景 mount 后一次性交付能力句柄;宿主自行存储(模块/ref/状态库皆可)。
   *  句柄在整个场景生命周期内稳定。 */
  onFlows?: (flows: CameraFlows) => void

  /** 点了顶栏"添加模型"按钮。不传 = 打开内置模型框体(现状)。 */
  onOpenModelPicker?: () => void

  /** 点了顶栏"添加路径"按钮。不传 = 打开内置路径框体(现状)。 */
  onOpenPathPicker?: () => void
}
```

### 2. CameraFlows 句柄

```ts
type Vec3 = {x: number; y: number; z: number}

type CameraFlows = {
  /** 点选放置:宿主选中模型后调用。进入画布放置模式(幽灵跟随光标,
   *  点击确认/Esc 取消),宿主应同时关闭自己的选择框。 */
  startPlacingModel(entry: ModelEntry): Promise<void>

  /** 拖拽放置:在指定三维落点直接放置,无幽灵阶段(与库内拖拽落点同管线)。 */
  placeModelAt(entry: ModelEntry, point: Vec3): void

  /** 路径预设生成路径。不传 at = 场景中心(高度跟活动相机,现状语义);
   *  拖拽放置时传 dropPointFromClient 的返回值。 */
  addPresetPath(preset: PathPreset, at?: Vec3): void

  /** 无选择界面的直接动作(宿主在自管入口里用) */
  addCamera(): void
  addAnchor(): void

  /** 放置状态(响应式读法见 §3)与取消 */
  cancelPlacing(): void

  /** 指针客户端坐标 → 场景三维落点(物体表面优先、地面兜底,与放置幽灵
   *  同一套规则)。dragover/drop 事件里的 clientX/clientY 直接喂进来。
   *  场景未就绪时返回 null。 */
  dropPointFromClient(clientX: number, clientY: number): Vec3 | null
}
```

`ModelEntry` 复用资产库现有类型;宿主模型不进内置库时,补一个薄工厂
`makeExternalModelEntry(ref: {url: string; name: string; rig?: string}): ModelEntry`
(占位条目,放置管线只依赖 url/名称,rig 用于骨架姿势匹配,可选)。

### 3. 响应式:placing 状态用 hook 读

句柄一次性交付,但 `placing` 会变。库导出:

```ts
function usePlacing(): PlacingState | null
```

内部用 `useSyncExternalStore` 订阅场景内的一个小外部 store;宿主任意组件
(包括 portal 到 body 的 shadcn Dialog 内容)都能用,不依赖 React context
穿透。

### 4. 库内调整

1. **能力收口**:App.tsx 内用现有函数组装 `flows` 对象(`startPlacingFromLibrary`、
   `placeLibraryEntryAt`、`placePresetPath`、`addCamera`、`addAnchor`、
   `cancelPlacing`),相机/画布引用(gl.domElement rect、活动相机)与
   `getPlacementSurfaces()` 由场景内一个 effect 捕获进模块级 ref,
   `dropPointFromClient` 闭包读取组装 `computeDropPoint`。
2. **按钮通知**:`TopToolbar` 的 `onToggleModelLibrary/onTogglePathLibrary`
   改接:传了对应宿主回调则调回调,否则走现状 `toggleFrame(...)`。
   传了回调时,`frameOpen.model / frameOpen.path` 的内置框体渲染分支
   整体不渲染(宿主自管);`pose / animation` 分支不变。
3. **句柄交付**:场景 mount effect 里调 `onFlows?.(flows)`;卸载时把模块级
   捕获清掉(`dropPointFromClient` 返回 null)。
4. 内置框体、放置幽灵、路径拖拽 marker 等其余部分**零改动**。

### 5. 宿主接入示例(规格附录,非接口的一部分)

```tsx
const flowsRef = useRef<CameraFlows | null>(null)
const [modelPickerOpen, setModelPickerOpen] = useState(false)

<CameraScene
  onFlows={(f) => (flowsRef.current = f)}
  onOpenModelPicker={() => setModelPickerOpen(true)}
/>

// shadcn Dialog 挂在宿主树任意位置
<Dialog open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
  <DialogContent>
    {models.map((m) => (
      <div key={m.id}
        draggable
        onClick={() => { flowsRef.current!.startPlacingModel(m); setModelPickerOpen(false) }}
        onDragEnd={(e) => {
          const p = flowsRef.current!.dropPointFromClient(e.clientX, e.clientY)
          if (p) flowsRef.current!.placeModelAt(m, p)
        }}
      >{m.name}</div>
    ))}
    <PlacingHint />  {/* 内部用 usePlacing() 显示"放置中,点击画布确认" */}
  </DialogContent>
</Dialog>
```

## 错误处理与边界

- 场景未 mount / 已卸载:flows 未交付(宿主拿不到句柄)或
  `dropPointFromClient` 返回 null;宿主判空即可,库不抛异常。
- 放置进行中宿主再调 `startPlacingModel`:沿用现状语义(新一次调用顶替旧
  幽灵,`libraryGenRef` 代际丢弃已处理竞态)。
- 宿主不传 `onOpenModelPicker` 但传了 `onFlows`:按钮仍开内置框体,宿主可
  在框体外用句柄(合法组合,不拦)。

## 测试策略

- flows 纯组装层:`flows.placeModelAt / addPresetPath` 直接转发现有函数,
  以现有测试覆盖;新增句柄组装测试(方法存在性 + 转发正确性,假 sheet 注入)。
- `dropPointFromClient`:场景未就绪返 null;就绪时复用 `dropPoint.test.ts`
  的坐标用例断言同规则(薄封装,不重复全量用例)。
- 按钮分支:`TopToolbar` 传回调时调回调不传时 toggleFrame(组件测试,
  跟随仓库既有稀疏模式;若成本过高则交由手工冒烟)。
- 回归:camera 全套 jest + 四包 tsc;不传新 props 的行为等价性靠现有
  测试全绿兜底。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 宿主忘了判空(场景未就绪调句柄) | 接口文档 + 示例显式判空;库内不抛 |
| flows 句柄依赖的 ref 在卸载后残留 | 卸载清理 + dropPointFromClient 返 null |
| 宿主拖拽用 HTML5 DnD,dragover 里不 preventDefault 会禁 drop | 附录示例补 dragover 处理说明(宿主侧职责) |
| 双轨并存(内置默认 + 宿主)的长期维护 | 内置框体本身即默认实现的验收测试,行为回归有现有套件兜底 |

## 二期方向(不在本期)

- 姿势/动作框体宿主化(照抄本模式)。
- `CameraFlows` 增补导出视频、PIP 控制等(宿主全局命令面板场景)。
- 路径拖拽的视平面/轴向约束语义暴露(本期宿主拖拽用简单落点规则)。
