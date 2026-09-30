# 资产库（模型 / 姿势 / 动作）设计

日期：2026-08-26
状态：已评审（分段设计经用户确认）
范围：playground camera 场景 + 一套系统级共享资产库

## 背景与目标

目前 camera 场景支持从本地选 FBX 放置模型，模型文件存进 theatre 项目
资产（IndexedDB），自带动画只有"播放第一个片段"一种用法。问题：

- 模型和动作数据混在一个文件里，N 个动作 = N 份模型数据，存储浪费
- 没有统一的资源库，模型、姿势无法复用和浏览
- 无法切换模型自带的动画片段（"姿势"）

目标：建一套**系统级共享资产库**，模型、静态姿势、动作三类资源分开
存储、按骨架族关联；网格与动作彻底分离（模型文件一律不含动画），
同骨架族的模型共享全部姿势/动作，任何数据只存一份。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 模型格式 | GLB（FBX 仅作导入源，入库即转换；一期不做 Draco 压缩） |
| 静态姿势格式 | JSON（骨骼名 → 旋转/位置，几 KB，可读可 diff） |
| 动作格式 | 纯动画 GLB（骨骼节点树 + 动画轨道，无网格） |
| 防冗余机制 | 姿势/动作绑"骨架族"不绑具体模型；导入时内容哈希去重 |
| 模型自带动画 | 入库时全部剥离，逐个导出为动作条目，一个不丢 |
| 库作用域 | 系统级共享库（独立 IndexedDB，跨项目） |
| 转换管线 | 一期就做，浏览器内完成（FBXLoader 解析 + GLTFExporter 导出） |
| 库界面 | 场景左侧可收起面板，模型/姿势/动作三个 tab，网格卡片 |
| 导入类型识别 | 一个入口，按文件内容自动识别模型/动作/姿势 |
| 存储访问 | 统一走异步适配接口；playground 用 IndexedDB 实现，应用层可换 HTTP API 实现 |

## 数据结构与存储

### 存储适配层（本地 IndexedDB / 远程 API）

库的所有读写都经过 `LibraryBackend` 异步接口，上层（导入管线、
面板、姿势应用）不直接碰 IndexedDB：

```ts
interface LibraryBackend {
  // 元数据
  listEntries(kind?: EntryKind): Promise<LibraryEntry[]>
  getEntry(id: string): Promise<LibraryEntry | undefined>
  putEntry(entry: LibraryEntry): Promise<void>
  deleteEntry(id: string): Promise<void>
  // 大二进制:以 URL 形式暴露——本地实现返回 blob: URL,
  // 远程实现直接返回 CDN/接口地址,渲染层无感
  putBlob(data: Blob): Promise<string>   // 返回 blobId(内容哈希)
  getBlobUrl(blobId: string): Promise<string>
  deleteBlob(blobId: string): Promise<void>
}
```

两个实现：

- **P1：`IndexedDBBackend`**（playground），即下面两张表的封装；
- **将来：`HttpBackend`**（应用层），entries 走 REST JSON，
  blob 上传走 multipart，`getBlobUrl` 返回远程地址。接口形状
  按"远程也好实现"设计：全部方法异步、blob 内容寻址（blobId =
  内容哈希，天然支持服务端去重和缓存）、无流式/长事务。

切换实现只在库初始化时注入不同 backend，场景代码零改动。

### 本地存储结构

独立 IndexedDB 数据库 `toybox-asset-library`，与 theatre 各项目存储
平级、互不干扰。两个 object store：

- `blobs`：大二进制（模型 GLB、动作 GLB、缩略图）
- `entries`：元数据条目

```ts
type RigId = string // 骨骼名列表排序后的哈希;无骨架模型为 'static'

type ModelEntry = {
  id: string
  kind: 'model'
  name: string
  rig: RigId
  blobId: string        // GLB 在 blobs 表的 key
  contentHash: string   // 去动画 GLB 的字节哈希,去重用
  thumbnailId?: string
  boneCount: number
  vertexCount: number   // 模糊去重(第二层)的比对依据
  createdAt: number
}

type PoseEntry = {
  id: string
  kind: 'pose'
  name: string
  rig: RigId
  bones: Record<string, {
    rotation?: [number, number, number, number]  // 四元数
    position?: [number, number, number]          // 仅根骨骼/位移骨骼需要
  }>
  createdAt: number
}

type AnimationEntry = {
  id: string
  kind: 'animation'
  name: string
  rig: RigId
  blobId: string        // 纯动画 GLB
  contentHash: string
  duration: number      // 秒
  createdAt: number
}
```

骨架族 id：遍历模型骨骼节点收集骨骼名，排序后取哈希（如
`rig-a3f9c2`）。同一套 Mixamo 骨架的模型自动同族。给骨架族起人话
名字（别名表）放到 P3。

场景侧：每个已放置模型的 theatre 属性只存引用 id（模型条目 id +
姿势/动作条目 id），大二进制一律不进 theatre 状态。撤销、同步、
刷新恢复走 theatre 现成机制。

## 导入管线（浏览器内）

库面板一个"导入"按钮，按文件内容自动识别类型：

| 文件内容 | 识别结果 |
|---|---|
| 网格 + 骨架（±动画） | 模型 ×1 + 自带动画逐个提取为动作条目 |
| 网格、无骨架 | 静态模型 ×1（rig = 'static'） |
| 无网格、有骨架 + 动画 | 仅动作条目（每条动画一个），不产生模型条目 |
| `.pose.json`（自有格式） | 姿势条目 ×1 |
| 无网格无动画 | 无法识别，提示并放弃 |

模型处理流程（FBX 为例，GLB 跳过解析转换直接入库）：

1. FBXLoader 解析 → Group + animations
2. 遍历骨骼收集骨骼名 → rig id
3. 自带动画逐条导出：骨骼节点树 + 单条动画 → GLTFExporter →
   纯动画 GLB → 动画条目
4. 模型本体剥掉动画 → GLTFExporter → GLB（无压缩）→ blobs 表
5. 离屏渲染一帧生成缩略图（失败降级为图标占位，不阻塞导入）
6. 写元数据

### 去重（两层）

**第一层 完全相同（自动）**：剥动画后的 GLB 字节哈希比对。

- 模型哈希命中 → 不新建模型条目，仅入库新增动作；确认清单注明
  "模型已存在（同库中「角色A」），仅导入新动作 ×N"
- 动作哈希命中 → 跳过该动作，注明"动作 idle 已在库中，跳过"

**第二层 高度相似（用户定）**：哈希不同但骨架族相同 + 顶点数/
骨骼数相同（典型：同一角色两次"含模型"导出、参数略有差异）。
确认清单给选择：

- ① 仅导入动作，复用已有模型（默认，不重复存模型）
- ② 仍作为新模型入库（确认是改过的版本）

### 导入确认清单

识别完成后弹确认："识别为：模型 ×1（骨架族 rig-a3f9）+ 动作 ×3"
或"识别为：动作 ×2，将并入骨架族 rig-a3f9"，确认后入库。动作的
骨架族暂无同族模型时照常入库，卡片标"无同族模型"。识别冲突的
怪文件一期不做手动覆盖，按启发式判定。

## 库面板界面

- 场景左侧可收起面板，三个 tab：**模型 / 姿势 / 动作**，网格卡片
  （缩略图 + 名称 + 骨架族标签；姿势卡片一期无缩略图，显示名称+族）。
- 点击模型卡片 → 进入现有放置模式（ghost 跟随光标那套不变）。
- 右键卡片：重命名、删除。删除只删库条目；场景中已放置实例走
  现有错误边界，一期不做级联清理。
- 选中场景中的模型时，姿势/动作 tab 自动过滤为同骨架族条目，
  点击即套用；不同族条目标记不匹配原因（P1 只过滤，P2 加提示）。
- 现有顶部"放置 FBX 模型"按钮改为打开库面板，导入入口收进库里。

## 姿势 / 动作的应用规则

已放置模型新增两个 theatre 属性：

- `pose`：姿势条目 id，默认空（绑定姿势）
- `animation`：动作条目 id，默认空

行为：

- **序列播放中**：animation 非空 → 播放该动作，切换时 0.2s 淡入
  淡出；animation 为空 → 保持 pose 姿势静止
- **序列停止**：回到 pose 指定的静态姿势（按 JSON 逐骨骼设置
  四元数/位置）；pose 也为空 → 绑定姿势（T-pose）
- 套用动作：加载纯动画 GLB → AnimationClip → 接到目标模型骨架，
  轨道按骨骼名寻址，同族即可播

## 与现有代码的对接点

- `PlacementManager.tsx`：放置流程的模型来源从"本地 File"扩展为
  "库条目 id"；ghost 预览照常（库模型加载后克隆半透明）
- studio 项目资产存储**不动**（库是独立数据库）；旧的已放置 FBX
  实例继续有效，不迁移
- 动画播放门控沿用现有逻辑（`sheet.sequence.pointer.playing`），
  只是 clip 来源从 `fbx.animations[0]` 变为库动作
- 缩略图离屏渲染与场景 canvas 分离，WebGL 上下文创建失败时降级

## 分期

- **P1（本设计实现）**：库数据层（LibraryBackend 接口 + IndexedDB
  实现）+ 导入管线（含自动识别与两层去重）+ 模型 tab + 动作 tab（同族过滤、点击套用、淡入淡出）
  + 缩略图 + 导入确认清单。交付后"导入模型 → 放置 → 切换动作"
  完整可用
- **P2**：静态姿势（从动作抽一帧存姿势 JSON、摆好骨骼一键保存）
  + 姿势 tab + 删除级联提示
- **P3**：Draco 压缩、骨架族别名、跨族重定向

## 风险与边界

- GLTFExporter 对 SkinnedMesh 导出 three 官方支持，但 FBX 内嵌
  贴图能否完整带进 GLB 需实现时验证；丢失时模型仍可放置（灰模），
  不阻塞
- GLTFExporter 输出字节序对"同一 FBX 源"是确定的，但两个不同
  FBX 文件即便内容相同也可能字节不同——所以去重要两层，不能只
  靠哈希
- 纯动画 GLB 内含骨骼节点树（glTF 要求动画轨道指向文件内存在的
  节点），几 KB，不算冗余，且天然记录骨架族
- 库浏览器侧数据（IndexedDB）不随 theatre 同步协议走；多端各自
  建库，P1 不做库的同步/导出导入。应用层接入 HttpBackend 后
  天然多端正，无需再改设计
