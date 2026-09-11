# 统一放置面板设计:模型/姿势/预设路径同面板,点击即放 + 拖拽落点

日期:2026-09-12
状态:已与用户确认设计方向,待实施

## 背景

camera playground 目前三类「往场景里加东西」的入口形态不一:

- **模型**:顶栏「添加模型」→ 资产库面板 → 点卡片 → 幽灵预览 → 点场景确认(两步)
- **姿势/动作**:资产库面板点卡片 → 套用到选中模型
- **路径**:顶栏「添加路径」→ 从活动相机机位播种一段固定环绕弧 → 进编辑模式

用户要求:模型、姿势、预设轨迹路径统一在资产库面板的相似框体中选择;支持**点击自动放置**和**从卡片拖拽到场景指定位置**两种放置方式。

## 用户已确认的决策

1. **姿势只点击**:姿势不是独立物体,点击卡片 = 套用到当前选中模型(现状),不支持拖拽。动作同理。
2. **预设路径 = 内置几何预设**:环绕圆、直线往返、弧线、8 字,共 4 种;不可删改、不可自定义保存。
3. **统一进资产库面板**:面板加第 4 个 tab「路径」;顶栏收掉「添加模型」「添加路径」,只留「资产库」「添加相机」「导出视频」。
4. **点击 = 立即放到默认位**:不再走「幽灵预览 → 点场景确认」两步;要指定位置用拖拽。

## 设计

### 1. 面板结构

`AssetLibraryPanel` 加第 4 个 tab「路径」,与现有 模型/姿势/动作 并列。路径 tab 的卡片网格复用现有 `cardBaseStyle` 样式(相似框体),卡片内容为形状图标 + 名称。

路径 tab 与现有 tab 的差异:

- 无「导入」按钮(导入只针对模型/姿势/动作文件),路径 tab 下隐藏导入按钮
- 无右键菜单(内置预设不可重命名/删除)
- 无骨架族标签(预设与骨架无关)

顶栏 `TopToolbar` 改为三个按钮:

- 「资产库」:开关资产库面板(原「添加模型」按钮演变,去掉放置中文案逻辑)
- 「添加相机」:不变
- 「导出视频」:不变

### 2. 交互语义

| 卡片类型 | 点击 | 拖拽到场景 |
|---|---|---|
| 模型 | 立即放到默认位 | 幽灵跟随,松开落在指针处 |
| 路径预设 | 以场景中心为落点生成,进编辑模式 | 落在指针处生成,进编辑模式 |
| 姿势/动作 | 套用到选中模型(现状) | 不支持 |

**模型默认位**:场景原点 (0,0,0);若原点附近(半径 1.5)已有放置模型,沿 +X 每次错开 2,直到空位。错位计算是纯函数 `findFreeSpot(existing: Vec3Like[]): Vec3Like`。

**路径默认高度**:预设形状生成在与地面平行、高度 = 活动相机当前 Y 的平面上;无活动相机时用主视角相机 Y;都没有时默认 5。与现有 `addPosPathPoint` 的种子来源顺序一致(活动相机 → 主视角)。

### 3. 拖拽机制

不用浏览器原生 Drag & Drop(要跨面板进 3D 画布、要幽灵跟随、要射线求交)。用指针事件自实现:

- `pointerdown` 在卡片上启动拖拽态(记录拖的条目),卡片不触发点击
- 指针移动:模型拖拽复用现有 placing 幽灵(`startPlacingFromLibrary` 已把模型 URL 加载进 placing 态,幽灵本来就跟指针);路径拖拽只显示一个落点标记(小球),不画形状预览线框——落地即进编辑模式,点本来就立即可见可改
- `pointerup`:在画布区域松开 = 确认落点(模型走 `confirmPlacing(point)`,路径走预设放置);在面板区域松开 = 取消
- `Esc` 取消拖拽
- 拖拽与点击的区分:按下后移动超过 4px 阈值算拖拽,否则算点击(沿用 `ExitPathEditOnEmptyClick` 的拖拽判定惯例)

模型拖拽本质 = 把现有「点卡片 → 进 placing → 点场景确认」合并成一个手势:按下即进 placing,松开即 confirm。

### 4. 预设路径模块

新文件 `packages/playground/src/shared/camera/pathPresets.ts`,纯函数,无 React 依赖:

```ts
export type PathPreset = {
  id: 'circle' | 'line' | 'arc' | 'figure8'
  name: string   // 环绕圆 / 直线往返 / 弧线 / 8 字
  icon: string   // 卡片图标(emoji)
}

export const PATH_PRESETS: readonly PathPreset[]

// 给落点和高度,返回该形状的路径点(相对落点铺开)
export function presetPoints(
  preset: PathPreset,
  center: Vec3Like,
): Vec3Like[]
```

形状参数:

- **环绕圆**:半径 5,8 点,闭合(首尾同位由曲线闭合处理,不重复点)
- **直线往返**:长 10,2 点(相机路径上往返由行进进度回摆实现,不在点列里重复)
- **弧线**:半径 6 的 180° 弧,5 点
- **8 字**:两个半径 3 的相切圆,12 点

所有点位于 `y = center.y` 的水平面上。

### 5. 放置数据流与撤销

**路径预设放置**(点击或拖拽确认后):

1. `entry = nextPathEntry(readPathEntries(getPathsRegistry(sheet)))`
2. `addPathPoint(sheet, entry.pathKey, presetPoints(preset, dropPoint))` —— 先播种
3. `addPathToRegistry(sheet, entry)` —— 再登记(沿用「没点就不出现」)
4. `enterPathEdit(entry.pathKey)` —— 落地即进编辑模式可改点

每一步都是既有可撤销事务,撤销 = 清单行消失 + 点数据回滚,与现有添加路径行为一致。

**模型立即放置**(点击):

跳过 placing 态,直接走现有落地管线:`setPendingEntry({key, libraryEntryId, position: findFreeSpot(...), pending: true})`。PlacementManager 的 PlacedModel 挂载后写入 theatre 对象,撤销语义与现有放置一致。

### 6. 组件改动清单(预估)

- `assetLibrary/AssetLibraryPanel.tsx`:加「路径」tab、卡片指针拖拽接线
- `pathPresets.ts`(新):预设定义 + 形状纯函数 + `findFreeSpot`
- `App.tsx`:顶栏按钮调整;路径预设放置回调;模型立即放置回调;拖拽状态桥接(面板 ↔ Canvas)
- `TopToolbar.tsx`:三按钮
- `PlacementManager.tsx`:拖拽确认与现有 confirmPlacing 的衔接(如需)
- 测试:`pathPresets.test.ts`(形状点数/半径/共面/默认位错位)

### 7. 错误处理

- 拖拽中指针松开在面板区域:静默取消,不落任何对象
- 模型库条目 blob 加载失败:沿用现有 `console.warn('[placement] ...')` 模式,不留半截 placing 态
- 路径落点射线未命中地面(指向天空):在视线前方 30 个单位处落点(压到地面);落点距相机超过 300 才取消本次放置

### 8. 测试策略

- **jest 纯函数**:4 种预设的点数/半径/共面断言;`findFreeSpot` 错位序列;拖拽阈值的判定函数(如抽出)
- **Playwright 手动验收**:点击模型立即落原点、再次点击自动错位;拖拽模型到指定位置;点击路径预设出现在场景中心并进编辑;拖拽路径到落点;撤销逐步回滚;Esc/面板内松开取消

### 9. 非目标(YAGNI)

- 姿势/动作的拖拽套用(用户已排除)
- 自定义预设路径的保存/管理(用户已排除)
- 预设形状的参数化(半径/点数在面板里调)
- 触屏拖拽支持(playground 仅桌面)
- 顶栏「资产库」按钮的面板开关记忆
