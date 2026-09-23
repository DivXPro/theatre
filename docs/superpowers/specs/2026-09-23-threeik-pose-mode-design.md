# threeIK 交互摆姿势(姿势模式)设计

> 状态:待评审(2026-09-23)
> 依赖库:`@dreamerbird/threeik@0.0.1`(npm 钉版,three peer >= 0.160,本仓库 playground 用 ^0.185.1,兼容)

## 背景与问题

- 资产库 P2 交付的姿势系统是**静态**的:`capturePose`/`applyPose`
  (`packages/playground/src/shared/camera/assetLibrary/pose.ts`)按骨骼名存取
  四元数/位置,姿势条目存库、按骨架族(rig)匹配、右键库模型有
  「改变姿势/播放动作」入口。
- 缺**交互式摆姿势**能力:想摆一个库里没有的姿势,只能去别处摆好再导入,
  没有 IK、没有骨骼控制点。
- threeIK(用户自研库,本地仓 `~/Projects/threeIK`)正好补这块:SkeletonRig
  扁平姿势存储 + CCD/FABRIK/Two-Bone IK + 关节限制,controls 子路径提供
  声明式控制点装配(五种内置 kind,W/E 操纵器),README 已预留 theatre
  接入钩子(`targetResolver` 按名注入场景对象)。

## 目标

1. 引入 threeIK **只做交互摆姿势**:摆的过程由 IK 控制点驱动,摆完仍按现有
   静态格式(capturePose 的 bones 记录)落地。
2. 入口两条:右键菜单新项「摆姿势」;**已选中**的人形模型再双击。
3. 出口两条:Esc;双击空白处。两种退出都提交。
4. 摆完的姿势**内联存进场景状态**(新 theatre 属性 `poseOverride`),
   刷新/撤销重做/同步自动走得通;「保存姿势到库」仍是手动动作。
5. 姿势模式与现有选中体系(选中描边、W/G/R/S 手柄、放置流程)共存不打架。

## 非目标(本期不做)

- 跨骨架族的姿势/动作重定向(threeIK 的 RetargetModifier 不引入;与资产库
  P3 的既有取舍一致)。
- 静态姿势系统本身的重写:capturePose/applyPose/姿势库格式不变。
- 顶栏加「姿势」工具模式(入口走右键+双击,不动 W/G/R/S 工具体系的结构)。
- 姿势模式内移动整个模型(退出后用 G);姿势缩略图自动生成;多人同时摆
  同一模型的协同语义。

## 方案

### 1. 模块划分

新建 `packages/playground/src/shared/camera/poseMode/`:

- `poseSession.ts` — 姿势会话状态:当前哪个模型在摆(placementKey)、
  进入/退出/订阅。模块级小状态 + 变更通知,仿 targetRegistry 的既有写法。
  会话天然唯一:同时只有一个模型在摆。
- `controlSpec.ts` — 骨名映射与控制点装配:对模型实例跑 threeIK 的
  人形映射(Mixamo/VRM/ReadyPlayerMe 预设 + suggestBoneMap),产出标准人形
  控制点表(髋部重心 root、四肢 limb + 肘膝 pole、脊柱 chain、头部 lookAt、
  胸口 bone)。关键骨(髋/脊柱/头/四肢)缺任一 → 返回 null = 不支持。
- `PoseModeRig.tsx` — 挂在被摆模型的组件里:建 SkeletonRig + 控制点、
  每帧求解、退出时捕获骨骼写 theatre。
- `poseOverride.ts` — 新属性的读写/解析与优先级帮手。

接线改动:`App.tsx`(会话状态、右键菜单项、Esc/双击空白退出监听、播放
自动退出)、`PlacementManager.tsx`(会话命中挂 PoseModeRig、additionalProps
加 poseOverride、姿势来源优先级、双击进入)、`menuModel.ts`(菜单项 +
置灰逻辑)、`i18n.ts`(文案)。资产库面板不动。

### 2. 进入/退出闭环

- **右键进入**:`buildObjectMenuItems` 加 `onPoseMode` 项,排在「改变姿势」
  上方。无骨骼模型不显示(对齐「改变姿势」既有逻辑);有骨骼但映射不出
  关键骨的置灰,悬停提示"骨架不支持摆姿势"。
- **双击进入**:模型组挂 `onDoubleClick`,已选中且人形 → 进入;未选中时
  双击的第一击选中、第二击自然满足"已选中"条件,双击直接进。
- **Esc 退出 / 双击空白退出**:双击落在模型或控制点上不算退出(模型
  onDoubleClick 记录 timeStamp,DOM 级监听比对区分)。
- **退出即提交**:`capturePose(instance)` 全量骨骼 → 一步 `studio.scrub()`
  写 `poseOverride` → 可 Ctrl+Z 撤销。拖动过程不写 theatre 状态,历史不被
  刷爆。
- 姿势模式期间:单击空白**不**取消选中(防误触掉出);单击其他模型不响应;
  **序列开始播放 → 自动提交退出**(mixer 与 rig 不能同时写骨骼)。
- 会话唯一:已在摆 A 时进入 B(右键/双击 B),先按退出流程提交 A,再开 B。

### 3. threeIK 装配与每帧更新

- 进入时:遍历实例找骨骼根(父不是 Bone 的第一个 Bone)→
  `new SkeletonRig(rootBone)` → **立即 `captureBasePose()` 一次**:基准 =
  当前姿势(含已应用的 poseOverride/库姿势/绑定姿势),没被控制点覆盖的
  骨骼保持原样,不弹回绑定姿势。
- `createSkeletonControls({rig, scene, camera, dom, facing, controls})`;
  `facing` v1 用库缺省 `(0,0,-1)`,内置 Mixamo 模型实测不对再按模型朝向传。
- 控制点 spec **不给初始 position**,保持当前姿势,避免进入瞬间骨架被
  解到别处。
- 每帧(useFrame,序列未播时):`rig.update(dt)` + `ctl.update()`;拖动回调
  里 `invalidate()`(demand 帧循环:拖一下画一帧,不拖不费帧)。
- 退出时:捕获写回 → `ctl.dispose()` + rig 释放,控制点辅助对象不留痕。
- 序列未播时 mixer 本来就不更新(现有逻辑),无需额外隔离。

### 4. 与选中体系的共存

- 模型保持选中态,**橙色描边继续画**(描边只取模型子树,控制点不在子树里)。
- 会话期间该模型的三轴手柄不挂(SelectionGizmo 的 showControls 关掉)。
- 按键分工:姿势模式内 W/E 归 threeIK(移动/旋转操纵器),G/R/S 不响应,
  Esc 退出;退出后恢复原语义。App 的快捷键分发按会话状态分流。
- threeIK 的 TransformControls 与选中手柄的 TransformControls 同一时刻只有
  一套在听指针,不抢拖拽。

### 5. 持久化:poseOverride 属性

- `additionalProps` 新增 `poseOverride`:`t.string('')` 存 bones JSON 字符串
  (label 用函数形式,i18n 热切换对齐既有写法)。Mixamo 骨架约 65 根骨,
  每条模型状态多约 10KB。
- PlacedModelCore 应用姿势的优先级:**poseOverride > 库姿势 poseId >
  绑定姿势**(现有两条 effect 扩展)。
- 「改变姿势」应用库姿势:写 `poseId` 并**清掉** `poseOverride`。
- 「保存姿势」入库按钮不变:抽实时骨骼,姿势模式摆完的能直接存库;
  库条目与模型的 poseOverride 互不影响。
- JSON 解析失败(手改坏/同步损坏):回退到 poseId/绑定姿势路径,警告一次,
  不崩画布。

### 6. 骨架支持范围

- v1 = threeIK 预设能映射的族:Mixamo(内置 6 模型全覆盖)、VRM、
  ReadyPlayerMe。关键骨缺失 → 菜单项置灰 + 原因提示。
- 纯静态模型(Thingy 等):不显示「摆姿势」项。

### 7. 依赖与构建

- `packages/playground` 加依赖 `@dreamerbird/threeik: 0.0.1`(npm 钉版)。
  库为纯 ESM(`./controls` 子路径导出);jest 走 jest-esbuild 转换。
- threeIK 无运行时依赖,three 为 peer(复用仓库的 ^0.185.1)。

### 8. 错误处理

- 装配返回 null(骨架不支持):不进入会话,菜单置灰已在入口拦住;双击
  路径静默不进入(不弹窗)。
- threeIK `warning` 事件(target 未解析/NaN 守卫,库内 warnOnce 不刷屏):
  接到 console.warn。
- 摆姿势期间模型被删除:会话订阅放置清单,命中模型消失 → 直接退出会话
  (骨骼随实例销毁,无提交对象,跳过写回)。
- 摆姿势期间对 poseOverride 的撤销/重做:属罕见路径。不做特殊处理——
  退出提交以 `capturePose` 的实时骨骼为准,会话外的撤销重放在退出后
  照常生效。

### 9. 测试

- jest(纯逻辑,不碰 WebGL):
  - `controlSpec`:Mixamo 骨名 → 完整控制点表;缺关键骨 → null;VRM/RPM
    命名映射。
  - `poseOverride`:优先级解析(override/poseId/bind 三态)、坏 JSON 回退。
  - 菜单项:静态模型不显示、映射不出置灰、人形可点。
  - `poseSession`:进入/退出/订阅通知、唯一性(会话唯一:已进入 A 时再
    进入 B,先按"退出即提交"流程关掉 A 再开 B)。
- 浏览器实测清单:右键/双击进入各一次;拖手、脚、脊柱控制点;W/E 切换;
  Esc 与双击空白退出;退出后刷新页面姿势还在;Ctrl+Z 撤销;「保存姿势」
  入库可用;播放序列自动退出;静态模型无菜单项;非人形骨架置灰;姿势
  模式期间单击空白不掉出、单击其他模型无响应。
