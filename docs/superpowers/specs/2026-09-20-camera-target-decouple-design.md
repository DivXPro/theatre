# 相机与瞄准点解耦 + 骨骼锚点设计

日期:2026-09-20
状态:待评审

## 背景

camera playground 里每台拍摄相机是**成对**创建的:注册表每行存
`{cameraKey, targetKey}`,添加相机时同时创建相机对象和一个橙色线框
小方块(下文叫"旧 Target"),相机面板只有"朝向绑定"开关,瞄准目标
写死是自家那个 Target。

实际需求是:相机应该能瞄准**任意**东西——用户手动放的空物体、
已放置人体模型的头部/手部等。这正好和人体模型"可分解部件"调查
的结论衔接:模型没有独立的脸/手网格,但骨架里有现成的头、手、
腿骨骼(Blender/引擎惯例也是"锚点挂骨骼",不是"模型上标点")。

用户已拍板的方向:

- 相机和瞄准点解耦,不再成对出现
- 瞄准目标 = 用户按需添加的独立空物体,**或**放置模型的骨骼锚点
- 骨骼锚点部位:**头、胸口、左手、右手、左腿、右腿**(6 个)
- 独立锚点入口:**顶栏加"添加锚点"按钮**
- **不做旧工程迁移**:老存档的相机保持自由朝向

## 目标

1. 注册表每行只存相机一个 key;新相机落地不再自带 Target。
2. 相机面板增加"瞄准目标"下拉:无 / 独立锚点 / 各模型的骨骼锚点。
3. 顶栏新增"添加锚点"按钮:点击在当前导演视角前方放一个空物体锚点,
   可点选、可拖、可删,与相机平级独立。
4. 骨骼锚点是挂在骨骼上的运行时小节点:不进大纲、无属性面板、
   只出现在瞄准目标下拉里;动画/摆姿势时相机自动跟。
5. 朝向绑定开关退役:用"瞄准目标 = 无"表达自由朝向,解绑瞬间保持
   现有"当前朝向定格进 rotation 属性、画面不跳"的行为。

## 非目标

- 骨骼锚点注册成 theatre 对象(路线 2,未来按需升级)
- 五官级锚点(眼睛、嘴角等)——需要脸部绑定,现模型没有
- 旧 Target 对的数据迁移(用户明确排除;老对象残留状态无害)
- 锚点重命名、多目标混合瞄准

## 设计

### 1. id 方案

`aimTarget` 是字符串属性,取值约定:

| 取值 | 含义 |
|---|---|
| `''` | 无(自由朝向) |
| `anchor:<theatreKey>` | 独立空物体锚点 |
| `bone:<placementKey>#<part>` | 放置模型的骨骼锚点 |

`<part>` ∈ `head` / `chest` / `handL` / `handR` / `legL` / `legR`。

前缀让两种锚点命名空间不打架;选项函数拥有全部映射,属性值本身
是透明的。

### 2. 相机注册表瘦身

`CameraEntry` 从 `{cameraKey, targetKey}` 改为 `{cameraKey}`。
`parseCameraEntries` 对旧格式宽容:容忍行内多出的 `targetKey`
字段(直接忽略),只要求 `cameraKey` 非空——老注册表 JSON 因此
天然可读,相机照常列出、自由朝向。

`removeCamera` 不再 forget 第二个对象。`CameraSeed` 删掉
`targetPosition` 字段(添加时本来就要取导演视角,只留机位和朝向)。

### 3. 相机属性:`aimTarget` 取代 `trackTarget`

```ts
aimTarget: t.stringLiteral('', aimTargetOptions, {
  label: () => translate('pg.props.aimTarget'),
  as: 'menu',
})
```

`aimTargetOptions` 是模块级选项函数(对齐 `pathBindingOptions`
模式):每次读取现调 `t()` 取词,选项 = 「无」+ 经 `dropdownSheet`
读 Anchors 注册表的独立锚点 + 遍历骨骼锚点 Map。相机面板重渲染
即热切换语言。

`trackTarget` 布尔属性**保留但 hidden**(对齐 moveMode 先例:
配置里硬编码留着,只为兼容已持久化状态值,不再显示不再读写)。
老相机 `trackTarget=true` + `aimTarget=''` = 自由朝向,即用户
拍板的不迁移语义。

### 4. 瞄准解析与驱动(ShotCamera)

- `tracking = aimTarget !== '' 且目标可解析`(目标被删 → 同
  路径绑定:回退自由朝向,不出现异常画面)。
- 解绑瞬间(aimTarget 从非空变 `''`)沿用现有定格逻辑:此刻用
  真实机位(路径采样优先)和最后瞄准点位置重算 lookAt,把朝向写进
  `rotation` 属性,一个事务提交。
- `useFrame(-1)` 每帧解析 aimTarget:
  - `anchor:` → 独立锚点 objRef 的网格位置(现有行为);
  - `bone:` → `getWorldPosition` 读骨骼锚点(骨骼在层级深处且
    被动画驱动,必须取世界坐标);
  - 解析不到 → 本帧跳过 lookAt(等同无目标)。
- 旧 Target 的 `e.mesh` 渲染从 ShotCamera 删除。

### 5. 独立锚点(Anchors 注册表)

新文件 `anchorsRegistry.ts`,照搬 `cameraRegistry.ts` 的注册表
模式:

- 底账:"Anchors" 隐藏注册表对象,清单存 key 数组;增删都是
  可撤销事务;key 命名 `Anchor N`(N 从 1 递增取第一个空位)。
- 添加:顶栏按钮 → 捕获导演视角,在其前方约 5 单位处生成种子,
  注册表加行;组件挂载消费种子(模式同相机)。
- 渲染:橙色线框小方块(沿用旧 Target 视觉),仅编辑视角可见
  (`visible={!shotView}` + `registerEditorOnly`),挂选中 gizmo
  (可拖),右键菜单给「删除」:真删(forgetObject + 注册表移除,
  两步事务,同相机的删除语义)。
- 删除保护:被相机指着的锚点删除后,相机自动回退自由朝向
  (解析不到 → 无目标,天然成立,无需专门清理)。

### 6. 骨骼锚点(运行时,非 theatre 对象)

新文件 `boneAnchors.ts`:

- **骨骼名解析**:`resolveAnchorBones(root: Object3D)` 纯函数,
  按部位在骨骼树里找候选名(Y Bot 实测骨架:`mixamorig` 前缀、
  无冒号;匹配做大小写不敏感 + 去 `mixamorig:`/`mixamorig` 前缀
  + 裸名三层兜底,容忍其他工具导出的变体):
  | part | 候选(Mixamo 优先序) |
  |---|---|
  | head | Head |
  | chest | Spine1, Spine2 |
  | handL / handR | LeftHand / RightHand |
  | legL / legR | LeftLeg / RightLeg |
  找不到部位的模型不出现在该部位的下拉选项里;完全不认识的骨架
  整模型不出现在骨骼锚点选项里。
- **挂载**:`PlacedModelCore` 克隆实例后,在骨骼上 `bone.add(anchor)`
  (对齐 Blender 空物体"骨骼父子"惯例)。锚点是普通 Object3D,
  无网格,不进大纲。
- **登记**:模块级 `Map<anchorId, Object3D>`,`bone:<placementKey>#part`
  为键;组件卸载时按 placementKey 清理整组。
- **动画兼容**:锚点是骨骼子节点,mixer 更新骨骼后每帧
  `getWorldPosition` 自然拿到新位置;摆姿势同理。

### 7. 顶栏

顶栏结构按钮区加第五项「添加锚点」,与 添加模型/添加路径/添加相机
同构;i18n 词条 `pg.toolbar.addAnchor`。

### 8. i18n 词条(camera 场景 i18n.ts)

- `pg.props.aimTarget` 瞄准目标 / Aim Target
- `pg.parts.head/chest/handL/handR/legL/legR` 头/胸口/左手/右手/左腿/右腿
- `pg.toolbar.addAnchor` 添加锚点 / Add Anchor
- `pg.anchor.menu.delete` 删除锚点 / Delete Anchor
- `trackTarget` 词条下线(属性 hidden,词条可留可删——随这次提交删掉)

### 9. 测试

- `anchorsRegistry.test.ts`:清单解析(坏数据回退空)、增删、
  key 递增取空位。
- `boneAnchors.test.ts`:mixamo 命名骨架全部位命中;前缀/大小写
  变体命中;不相关骨架(如纯静态模型)全部落空;Map 登记/清理。
- `cameraRegistry.test.ts` 扩充:旧格式 `{cameraKey, targetKey}`
  JSON 解析通过且 targetKey 被忽略。
- 选项函数:无 sheet 时只有「无」;注入 fake 注册表后选项齐全。
- 定格行为:模拟 aimTarget 非空→空切换,断言 rotation 被写入
  (沿用现有测试手法,jest 从仓库根目录跑)。

## 风险与对策

- **旧存档残留**:老 Target 对象的持久态数据成为无对象引用的
  残留(saaz 序列化里静态覆盖还在,但运行时没人创建该对象,
  大纲不出现)。无害,同任何下线功能;不处理。
- **选项函数读运行时 Map**:骨骼锚点 Map 是普通模块级状态,
  相机面板打开期间的增删(放置/删除模型)不会自动刷新选项——
  与路径下拉现状一致(新增路径后面板不重开也看不到),接受。
- **混合器更新顺序**:锚点取世界坐标走 `getWorldPosition`(内部
  强制更新世界矩阵),不依赖帧内更新次序。
- **相机指着的锚点被删**:解析落空即自由朝向,画面定格(同路径
  绑定失效语义),用户重选即可。
