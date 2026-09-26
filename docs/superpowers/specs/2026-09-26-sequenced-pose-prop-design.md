# 时间轴姿势属性(Sequenced Pose Prop)设计

日期:2026-09-26
状态:待评审
关联:docs/superpowers/specs/2026-09-23-threeik-pose-mode-design.md(摆姿势模式)

## 1. 背景与目标

camera playground 的人体模型姿势目前有两个并存属性:

- `pose`(stringLiteral):库姿势条目 id,面板下拉选择。
- `poseOverride`(string):摆姿势模式产出的内联 JSON 骨骼快照。

现有问题:

1. `poseOverride` 在属性面板渲染成一个装满 JSON 的文本框——既不能看也不能改。
2. 姿势完全不参与时间轴:播放时骨骼归 AnimationMixer 管,姿势只在非播放状态静态应用。无法表达「第 1 秒站立、第 3 秒坐下、中间平滑过渡」。
3. 两个属性语义重叠(都是"这个模型摆什么姿势"),优先级规则(override > lib > bind)要用户心智负担。

目标(已与用户对齐):

- **一个属性、一条轨道、一个菱形关键帧**。姿势在时间轴上以聚合形式存在,不拆骨骼通道(明确拒绝 Blender 式每骨每通道碎帧)。
- 合并 `pose` 与 `poseOverride` 为单一 `pose` 属性,值二选一:**库姿势引用** 或 **自定义骨骼快照**。
- 相邻关键帧之间**逐骨骼平滑混合**(四元数 slerp + 位置 lerp),贝塞尔缓动手柄天然生效。
- 面板不再出现 JSON;摆姿势模式改为「写关键帧 / 覆盖关键帧」语义。
- 旧工程数据无损迁移。

## 2. 关键机制发现(不动核心包的依据)

调研 core/studio 后确认:**全部能力用现成机制拼装即可,不改 `@dreamerbird/core`**。

1. `t.string(default, opts)` 的 opts 本来就接受自定义 `interpolate`(packages/core/src/propTypes/index.ts:641),签名 `(left, right, progression) => value`。
2. 「可打关键帧」判定是结构性的:`isPropConfSequencable` = 非 composite 即可(propTypes/utils.ts:157-161),string 天然满足。string 默认插值器是 `leftInterpolate`(阶跃),这就是"字符串属性能打帧但跳变"的原因——换上自定义插值器即变平滑。
3. `CommonOpts.hidden`(propTypes/index.ts:82-91)把属性从详情面板隐藏,**数据行为与时间轴轨道不受影响**——JSON 文本框收起来的现成开关。
4. 程序化打帧通道(studio 自家用法):
   - 无轨道时:`studio.transaction(({stateEditors}) => stateEditors.coreByProject.historic.sheetsById.sequence.setPrimitivePropAsSequenced(propAddress))` 建空轨道(TheatreStudio.ts:152 的 `sequenceProp` 是同一调用的封装)。
   - 有轨道后:`transaction/scrub` 里的 `set(obj.props.pose, value)` 自动在**当前 sequence.position** 写贝塞尔关键帧(createTransactionPrivateApi.ts:set 检测到 trackId 即走 `setKeyframeAtPosition`,`type: 'bezier'`)。
   - 限制:`setPrimitivePropAsSequenced` 的 trackId 是随机生成且无返回值;`set()` 读的是**已提交**状态的轨道映射,看不到同事务草稿里刚建的轨道。因此**首次打帧 = 两个事务**(建轨道 → 写帧),撤销也是两步(先撤帧、再撤空轨道)。空轨道无害( theatre 容忍;「清除姿势」动作会连轨道一起删)。接受此行为,实现期用测试钉死。
   - scrub 的 capture 回调只有 `set`(Scrub.ts:125),拿不到 stateEditors——建轨道必须走 `studio.transaction`。
5. 贝塞尔手柄是 progression 的 ease,与值类型无关——姿势帧的缓动曲线**白得**。
6. `useVal(obj.props.x)` 读到的是**时间轴求值后的当前值**(有轨道时含插值结果)——消费侧不用改读取方式。
7. saaz/存档:值就是普通 JSON 字符串,序列化与多端同步**零改动**(现有 poseOverride 已证明)。

## 3. 数据模型

### 3.1 值形态

`pose` 属性 = `t.string('', {interpolate: poseInterpolate, hidden: true, label})`,值为 JSON 字符串,两种形态:

```ts
type PosePropValue =
  | {kind: 'lib'; id: string}              // 库姿势引用(资产库条目 id)
  | {kind: 'custom'; bones: PoseBones}     // 自定义骨骼快照(与现 poseOverride 同构)

// PoseBones = {[boneName: string]: {rotation: [x,y,z,w], position: [x,y,z]}}
```

空字符串 `''`(默认值)= 无姿势 → 回绑定姿势。

解析函数 `parsePoseValue(json: string): PosePropValue | null`:

- `''` 或非法 JSON → `null`(回绑定)。
- 有 `kind` 字段且合法 → 新格式。
- 无 `kind` 的对象 → **旧格式骨骼快照**(现 poseOverride 的内容),按 `{kind:'custom', bones}` 对待——读取侧天然向后兼容。
- 非 JSON 非空字符串 → **旧格式库 id**(现 pose 的内容),按 `{kind:'lib', id}` 对待。

### 3.2 渲染优先级(取代旧三层)

```ts
resolvePoseBones(value: PosePropValue | null): PoseBones | null
// custom → value.bones;lib → 查 §5 解析缓存(未命中 → null + 每 id 告警一次)

effectivePoseBones = resolvePoseBones(parsePoseValue(poseValue)) ?? bindPose
```

有值用值,没值(空/非法/库引用解析不到)回绑定。旧 `override > lib > bind` 三层规则废弃。

## 4. 插值器契约

```ts
function poseInterpolate(leftJson: string, rightJson: string, progression: number): string
```

同步纯函数,求值热路径调用。语义:

1. 解析两侧(经 §3.1,带旧格式容错)。
2. 任一侧为 `null`('' / 非法 / 库引用解析不到)→ **阶跃**:返回 `leftJson`。可预测、与 theatre 缺省行为一致。
3. 两侧都有骨骼 → 逐骨骼混合:
   - 两侧都有的骨骼:rotation 四元数 `slerp(a, b, t)`,position 三维 `lerp`。
   - 只在一侧有的骨骼:全程取有数据那一侧(不淡入淡出,避免半姿势)。
   - 结果序列化为 `{kind:'custom', bones: mixed}` 返回——**时间轴上两帧之间的求值结果天然是自定义快照**,applyPose 原样可放。
4. 性能:每次调用 parse 两个 JSON(单帧快照约 16KB)+ stringify 一次。用 **以字符串值为键的小容量 LRU 缓存 parse 结果**;拖针/播放时帧值不变,全部命中缓存。

四元数/向量运算用 three(PlacementManager 已依赖)。插值器实现放 `packages/playground/src/shared/camera/poseMode/poseInterpolate.ts`。

## 5. 库姿势引用解析(同步热路径 vs 异步库)

库姿势条目在 IndexedDB,`getEntry` 是异步的,而插值器必须同步。解法:

- 模块级 **`Map<entryId, PoseBones>` 解析缓存**(不可变数据,全 placement 共享)。
- 一个订阅副作用:监听 pose 轨道关键帧值集合(及静态值),发现未缓存的 lib 引用就异步拉取写入缓存,完成后 `invalidate()` 触发重求值。
- 缓存未命中期间的求值按 §4.2 阶跃(返回 left)并对每个 id 只 `console.warn` 一次。**表现**:刚打开工程拖针,第一两帧可能阶跃,库条目到手后即平滑——可接受,条目是本地 IndexedDB 小 JSON。
- 多端同步语义:**引用只带 id**;对端库缺同名条目 → 回绑定姿势 + 告警(与现状 poseId 缺失行为一致)。自定义快照**自带数据**,跨端永远可放。

## 6. 属性注册与面板

### 6.1 注册(PlacementManager.tsx additionalProps)

```ts
pose: t.string('', {
  label: () => translate('pg.props.pose'),   // 「姿势」,复用/新增 i18n key
  hidden: true,                               // 详情面板不显示原始 JSON
  interpolate: poseInterpolate,
}),
```

- 旧 `pose`(stringLiteral 下拉)与旧 `poseOverride` 从面板消失;`poseOverride` 的注册**保留一个版本**但加 `hidden: true`(迁移读取需要,见 §9),下个大版本再删 key。
- 旧 `animation`(动作)属性不动。

### 6.2 面板状态行(playground 自绘)

姿势状态的展示与操作移到 playground 侧(放置面板/姿势库面板,选中人体模型时显示):

```
姿势 · 库:挥手 / 自定义 / 绑定 · 3 个关键帧 · [清除姿势]
```

- 数据来自求值后的当前值 + 轨道关键帧计数(轨道数据经 sheet 对象读取)。
- 「清除姿势」:一个事务内 `setPrimitivePropAsStatic`(删轨道)+ unset 静态覆盖,单步撤销。
- 库姿势选择 UI 也移到这里(列出库姿势条目,点击 = 经 §7 写值/写帧通道写 `{kind:'lib', id}`)。

### 6.3 时间轴上的呈现

- Dope Sheet 出现一行「姿势」轨道(label 走 i18n),菱形帧可拖动、可框选、右键可调贝塞尔手柄——全部 theatre 原生能力。
- 已知粗糙边(本期不修):右键关键帧的内联值编辑器会按 string 类型渲染出 JSON 文本框。用户主路径不经过它(编辑姿势走摆姿势模式),记录在案;将来可做自定义关键帧编辑器扩点。

## 7. 播放、求值与写帧

### 7.1 渲染规则(画面永远渲染时间轴求值结果)

| 情况 | 行为 |
|---|---|
| 有姿势轨道(任意播放状态) | **每帧**应用求值后的姿势;播放时先 `mixer.update(delta)` 再 applyPose——姿势对快照内含的骨骼**逐骨压过**动作片段 |
| 无轨道、有静态值 | 非播放时应用(现状不变);播放时 mixer 独占 |
| 空值 | 绑定姿势 |

- 实现:`useVal(obj.props.pose)` 已在值变化时触发应用 effect(现状两个 effect 保留);**新增**:有轨道时 `useFrame` 里 mixer.update 之后 applyPose 当前求值。求值开销由 §4.4 缓存兜底。
- 「逐骨压过」:全身快照会完全遮住动作片段——这是有意的优先级(用户已拍板:姿势轨道求值压过其他来源)。想看动作就清轨道。
- 播放中与拖动播放头走同一条求值路径,scrub 预览即所得。

### 7.2 程序化写帧(摆姿势模式与库选择共用)

```ts
function writePoseKeyframe(studio, sheetObject, poseValueJson): void
```

1. 读轨道映射判断 `pose` 是否已有轨道:
   - 无轨道:先 `studio.transaction(({stateEditors}) => …setPrimitivePropAsSequenced(propAddress))`(撤销步 1),再 scrub `set(obj.props.pose, json)` 在当前 position 写首帧(撤销步 2)。两步撤销为已知限制(§2.4)。
   - 有轨道:单个 scrub `set(...)` —— 播放头恰在已有帧上 = **覆盖该帧**(同 position 写值即覆盖);在两帧之间 = **新建帧**。一步撤销。
2. 写帧前调用方负责把 `sheet.sequence.position` 设到目标时刻并贴网格(`closestGridPosition`,set 内部也会贴)。

### 7.3 静态写值(无时间轴参与)

无轨道时经 scrub `set()` 写的是静态覆盖(theatre 原生行为)——「我就想要个固定姿势不上时间轴」的路径保留,且随时可经「姿势面板 → 添加关键帧」升级成轨道。

## 8. 摆姿势模式改造

在 9-23 交付的 threeIK 摆姿势模式上改,交互骨架(右键/双击进入、浮动小条)不动。

### 8.1 进入会话

1. 若正在播放,先暂停。
2. **播放头吸附**:当前 position 贴网格后恰等于某姿势帧的 position → 进入**编辑该帧**模式;否则进入**新建帧**模式。
3. **底姿 = 播放头处求值结果**(`effectivePoseBones(求值值, bindPose)`)——帧上进入看到的就是该帧姿势;帧间进入看到的是混合姿势,以此为基础调整。**画面即时间轴求值**,不存在"编辑态与画面两张皮"。
4. **锁播放头**:会话期间订阅 sequence.position,偏离会话时刻即拉回;同时暂停播放。会话记录 `sessionPosition`。

### 8.2 退出语义(Esc=保存退出,以撤销硬化为前置门槛)

| 操作 | 语义 |
|---|---|
| 浮动小条「写入关键帧」/ Enter / **Esc** | 捕获当前骨骼 → 经 §7.2 写帧(帧上=覆盖,帧间=新建)→ 退出会话 |

- Esc 保持 9-23 养成的「保存退出」习惯,不做放弃路径;**后悔路 = 撤销**(Ctrl+Z)。
- **前置门槛(用户拍板)**:Esc=保存 只在 §8.3 撤销/重做硬化落地并验证之后才允许随本特性发布——覆盖关键帧是破坏性操作,必须保证任何误覆盖都能可靠回退(数据与画面同时回退)。
- 实现排期上,撤销/重做硬化任务排在摆姿势写帧改造**之前**。

### 8.3 撤销/重做硬化(Esc=保存 的前置门槛)

目标:任何姿势写入(写帧/覆盖帧/建轨道/清除姿势/迁移)撤销或重做后,**数据与画面同时**回到对应状态,且快捷键在任何焦点位置可用。

1. **焦点修复**:studio 的撤销/重做快捷键只在 studio 面板焦点内生效(9-23 终审遗留②)。playground 在 window 级接管 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z(Ctrl+Y),调 `studio.undo()/redo()`(Studio.ts:574-579 现成);注意不把焦点在输入框里的按键抢走(判 event.target 是否可编辑元素)。
2. **画面跟随验证**:撤销/重做改变姿势值后,既有「值变化即 applyPose」effect(PlacementManager L1319-1327)应立即反映到画面。逐族模型验证;快照含双套骨时 applyPose 按名写回两套,回放路径在 Y Bot 上同样生效(§8.4 的互动预览 bug 不影响回放)。
3. **测试**:覆盖写帧后撤销 → 帧数据回原值且求值结果复原(单骨骼族模型);建轨道+首帧的两步事务 → 两次撤销后轨道消失;清除姿势 → 撤销后轨道与帧复原。

### 8.4 已知关联 bug(不在本设计修复范围,单列)

Y Bot(Mixamo 族)放置实例有**双套骨骼**(原始 52 + 蒙皮 `_1` 52),threeIK 摆的是原始套、画面跟蒙皮套——交互式摆姿势在这族模型上很可能掰了看不到(2026-09-26 查明,台账已记)。本设计的值格式按名存骨(现快照两套都含,共 104 项),插值与回放都按名逐项处理,**该 bug 的修复(如快照只留蒙皮套)与本设计正交**:旧两集快照在新代码下照放,新一集快照在 applyPose 按名写回下照放。

## 9. 迁移

旧工程状态里 `props.pose`(纯 id 字符串)与 `props.poseOverride`(骨骼 JSON)合成新 `pose` 值,**覆盖优先**:

1. 对象加载时检测:新 `pose` 值为空 且 (旧 pose 或旧 poseOverride 非空)→ 执行迁移:
   - `poseOverride` 非空 → `set(props.pose, poseOverride 原样)`(§3.1 读取侧把旧骨骼 JSON 当 custom,原样搬即完成格式升级)。
   - 否则旧 `pose` 非空 → `set(props.pose, 原样)`(读取侧把裸 id 当 lib)。
   - `unset(props.poseOverride)`。
2. 迁移走一个 scrub(可撤销、经 saaz 同步),每个对象至多一次;迁移后写标记(如把 `poseOverride` unset 即天然标记——它已空不会再触发)。
3. `poseOverride` 的注册带 `hidden: true` 保留一个版本(读取/清理兼容),下版本删 key;遗留静态覆盖数据无害(theatre 容忍孤儿 override)。
4. 旧状态里 `pose` 若已带轨道(理论上不存在,stringLiteral 没人打帧)不做特殊处理。

## 10. 测试策略

### 单元测试(packages/playground,jest 从仓库根跑)

- `parsePoseValue`:新两格式 / 旧骨骼 JSON / 旧裸 id / '' / 非法 JSON / kind 非法。
- `poseInterpolate`:
  - custom↔custom:四元数 slerp 中点、position lerp 中点;单侧缺失骨骼取有数据侧。
  - lib↔custom、lib↔lib(缓存预填)。
  - 一侧 null / 库引用未解析 → 返回 left(阶跃)。
  - 返回值可被 `parsePoseValue` 读回为 custom(闭环)。
- 迁移合并:override 优先 / 仅 lib / 双空不触发 / 迁移后旧 key 已 unset。
- `writePoseKeyframe`(mock studio 事务边界):无轨道=两事务(建轨+写帧);有轨道帧上=覆盖(帧数不变);帧间=新建(帧数 +1);position 贴网格。
- 渲染规则:有轨道时播放中 applyPose 在 mixer.update 之后调用(顺序断言);无轨道时播放中不 apply。
- 撤销/重做(§8.3):覆盖帧撤销后数据复原;两步首帧两次撤销后轨道消失;window 级快捷键在画布焦点下触发 studio.undo/redo、输入框焦点下不触发。

### 手工冒烟清单(交付时逐项过)

1. 摆姿势写两帧(站→坐),拖播放头看平滑混合;调贝塞尔手柄看缓动变化。
2. 帧上进入摆姿势 → 调整 → Esc/Enter → 该帧被覆盖(帧数不变);**Ctrl+Z(焦点在画布上)撤销 → 该帧恢复原姿势,画面立即跟随**;重做恢复覆盖。
3. 帧间进入 → 以混合姿势为底 → Esc → 新建一帧;撤销后该帧消失。
4. 库姿势设为关键帧值,与自定义帧之间混合正常。
5. 多端:对端库缺该姿势条目 → 回绑定 + 告警;自定义帧对端照放。
6. 旧工程(含 poseOverride/poseId 数据)打开自动迁移,撤销可回退。
7. 姿势轨道与动作片段并存:姿势逐骨压过;清轨道后动作恢复。
8. 同步:另一窗口看到同样的轨道与帧;重载后姿势如初。

## 11. 范围外(本期不做)

- 姿势值的关键帧内联编辑器(§6.3 粗糙边)。
- 跨骨架/跨族姿势重定向(资产库 P3 已排除,维持)。
- 姿势分层/多条姿势轨道混合。
- Y Bot 双骨骼 bug 修复(§8.4,单独立项)。

## 12. 备选方案与取舍(已讨论否决)

| 方案 | 否决原因 |
|---|---|
| 核心包新增 `t.pose` 类型 | 要动 core 的类型 union + studio 两处渲染分派,收益只是"值不用 parse/stringify";自定义插值器方案零核心改动拿到同等能力。将来若姿势成为一等公民可再升级,值格式不变、迁移平滑。 |
| Blender 式骨骼通道拆分 | 不动核心但一个姿势在时间轴上碎成 700+ 数字通道,用户明确拒绝碎帧形式。 |
| 时间戳快照数组存在值里 | 绕开现有关键帧系统,丢失拖动/缓动/撤销/同步,与 theatre「值与关键帧分离」架构背道而驰。 |
