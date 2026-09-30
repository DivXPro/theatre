# 大纲树对象操作设计（右键菜单：删除 / 复制粘贴 / 重命名 / 伪集合）

> 状态：待评审（2026-09-20）
> 关联评估：storage 向 Blender 模型靠拢（对象 ID 化）估计 3~5 周高风险，本期不采用；
> 本期采用 Blender "名单"思想的显示层投影。

## 背景与问题

- studio 大纲树（OutlinePanel）目前只有点选/折叠，没有任何对象操作入口；camera 场景的
  相机/锚点/模型/路径删除只能从画布右键触发，大纲里删不掉。
- theatre 存储按路径键寻址：`SheetState_Historic.staticOverrides.byObject` 与
  `sequence.tracksByObject` 均以 ObjectAddressKey（对象键路径）分桶；core 无改键/迁移
  API。真改名、真集合 = 存储层大手术（评估结论见上与对话记录）。
- 结论：用显示层投影拿到 Blender 式组织能力——名字与归属只是显示状态，不碰存储键。

## 目标

1. 大纲对象行右键菜单：**复制 / 粘贴 / 重命名 / 删除**（studio 内置，全量 i18n）。
2. 扩展协议 `outlineObjectMenu`：宿主可接管对象菜单（camera 场景接入后，大纲删除 =
   注册表真删，与画布右键同一套流程）。
3. **伪集合**：显示层分组（新建 / 重命名 / 删除集合 / 成员管理）。
4. 所有新词条 en + zh-CN 双语，走既有 i18n 基建（useT / translate 热切换）。

## 非目标（本期明确不做）

- 真改名 / 真删除对象 / 真集合（存储层迁移,ID 化另立项）。
- 复制粘贴携带关键帧（本期只拷静态值）。
- 集合多归属（DAG）、集合嵌套、集合实例。
- 拖拽进集合（二期，chordial/useDrag 手势基础设施另排）。
- 骨骼锚点（运行时 Object3D，非表格对象）不在本期范围。

## 方案概述（方案 A：studio 内置 + 宿主扩展点）

大纲行右键弹 chordial 菜单（chordial 原生支持 contextmenu 触发）。通用能力由 studio
内置；删除项可被宿主扩展以 `role: 'delete'` 接管——因为 camera 场景的对象挂在四个
注册表上，只有宿主知道怎么删干净（注册表移除 + 组件卸载 + forgetObject 三步，
缺一"刷新复活"）。未接管的普通对象（如演示模型 Thingy）使用 studio 默认删除
（仅清持久数据）。

## 详细设计

### 1. 扩展协议

core `types/public.ts` 的 `IExtension` 新增可选字段（与 i18n/toolbars/panes 同级）：

```ts
outlineObjectMenu?: (
  object: ISheetObject<UnknownShorthandCompoundProps>,
) => OutlineObjectMenuContribution | undefined

export type OutlineMenuItem = {
  type: 'normal'
  label: string
  onSelect: () => void
  enabled?: boolean
  /** role: 'delete' 表示该项接管 studio 内置删除（studio 不再显示默认删除项） */
  role?: 'delete'
}

export type OutlineObjectMenuContribution = {items: OutlineMenuItem[]}
```

- studio 按扩展注册顺序收集所有非 undefined 返回的 items，追加在内置项之后。
- 任一 item 带 `role: 'delete'` → 该对象的内置删除项被隐藏（只隐藏第一个之外无特殊
  语义；多个 delete 项则都显示，语义由宿主自控，studio 不拦）。
- studio 侧读取路径：`getStudio().ephemeralAtom.pointer.extensions.byId`
  （usePrism 订阅，模式同 globalToolbarHooks）。
- 纯运行时回调，不进任何持久配置；i18n 词条由宿主各自注册（复用现有机制）。

### 2. 内置菜单（对象行右键）

挂点：`ObjectItem` / `MergedObjectItem` 现有的 `useChordial(() => ({title, items}))`
（当前 items 恒为空数组，直接填充）。

自上而下：

| 项 | 语义 |
|---|---|
| 复制 Copy | 快照该对象全部**顶层**属性的当前静态值（`val(obj.props[k])`）+ 模板结构指纹，存入 studio 模块级剪贴板（会话内有效） |
| 粘贴 Paste | 剪贴板非空且目标模板指纹匹配才 enabled；一次事务写入全部值；不匹配置灰 |
| 重命名 Rename | 进入行内输入态（见 §3） |
| ─ 分隔符 | |
| 删除 Delete（内置默认） | `studio.transaction(({forgetObject}) => forgetObject(obj))`；被宿主接管时整项替换 |

- **指纹**：模板结构的稳定序列化——顶层键 + 各 propType 的 type 名 + compound 子键树
  （只取结构，不含函数/选项/默认值）。指纹只用于粘贴启用判断：宁可保守禁用，不可
  误粘贴。
- 词条：`outline.ctx.copy/paste/rename/delete` 进 studio 词典（`en.ts`/`zh-CN.ts`），
  用 `useT()` 消费。

### 3. 显示名重命名

- 存储：**studio historic**（随项目存盘 + 同步），新增每 project 切片：
  `outlineNamesByObjectAddress: StrictRecord<string, string>`
  （key = 对象地址的 JSON 序列化，含 projectId/sheetId/sheetInstanceId/objectKey）。
- 显示优先级：显示名 > 现有 overrideLabel / 命名空间标签 > objectKey。
- 行内编辑：BaseItem 新增受控 editing 态（label 位置换 input）；Enter 提交
  （studio transaction 写入），Esc 取消；提交空字符串 = 清除显示名（回退原名）。
- 重命名只改显示状态，不触碰任何 core 存储。

### 4. 伪集合

- 存储：studio historic 每 project 新增切片：
  `outlineCollections: Array<{id: string; name: string; members: string[]}>`
  - `members` 存对象键路径（objectKey 字符串，sheet 内唯一）；归属按对象地址的
    sheetId/sheetInstanceId 区分（集合挂在 sheet 维度，渲染时对不上当前 sheet 的
    集合不显示）。
  - 扁平单归属：一个对象至多在一个集合里（一期）。
- 树渲染（ObjectsList）：顶层先渲染集合行，成员对象以 ObjectItem 平铺其中
  （depth+1）；成员对象从默认命名空间树中过滤；非成员对象照常渲染。集合行复用
  BaseItem + 折叠交互（collapse itemKey 前缀 `collection:{id}`，扩展
  useCollapseStateInOutlinePanel 的分支）。
- 集合行右键菜单：重命名（行内输入）/ 删除集合（仅解散分组，对象不动）。
- 对象菜单追加项（在分隔符上方、内置项之后、宿主项之前）：
  - `移到集合：{name}` —— 每个集合一项；
  - `从集合移出` —— 仅在集合中 enabled；
  - `新建集合…` —— chordial invoke popover 内联输入名称，创建并把该对象移入。
- 空白处入口：对象列表容器空白区域右键 → 菜单仅一项 `新建集合…`（容器上独立
  chordial 元素；chordial 事件捕获按 DOM 就近匹配，空白处自然落到容器元素）。
- 残留清理：成员对象被真删后名单会残留——渲染时与现存对象求交自动忽略；宿主删除
  流程顺手把该对象从所有集合成员名单中移除。

### 5. camera 场景宿主接入

- 新文件 `packages/playground/src/shared/camera/outlineObjectMenu.ts`：
  纯函数 `cameraOutlineMenuItems(object, handlers)`：
  - 用四个注册表反查对象归属（cameras / anchors / placements / paths）；
  - 命中 → 返回 `{items: [{type: 'normal', label: translate('pg.outline.delete'),
    onSelect: handlers.removeX(object), role: 'delete'}]}`；
  - 未命中（Thingy / Key Light / 导演相机组等）→ 返回 undefined（studio 默认菜单）。
- handlers 绑 App 现有删除流程（removeCamera / removeAnchor / removePlacement /
  removePath），与画布右键菜单共用同一函数，保证两个入口行为一致（含集合成员清理）。
- App 内 `studio.extend({id: '@dreamerbird/camera-outline-menu', outlineObjectMenu})`。
- camera i18n.ts 新增 `pg.outline.delete`（删除 / Delete；复用词即可，若与
  `pg.menu.deleteCamera` 语义不合则单独一条）。

### 6. i18n

- studio 词典新增（en + zh-CN 同步，key 集合必须一致）：
  `outline.ctx.copy / paste / rename / delete / newCollection / moveToCollection /
  removeFromCollection / deleteCollection / collectionNamePlaceholder`。
- camera 场景：`pg.outline.delete`。
- 全部经 useT()/translate 消费，语言切换热改。

### 7. 测试策略

- studio（纯逻辑单测为主，组件测试跟随仓库既有稀疏模式）：
  - 指纹计算与匹配（同构可粘、异构禁粘、compound 嵌套）；
  - 菜单合并（内置 + 多扩展追加、role:'delete' 抑制内置删除）；
  - 显示名/集合的状态操作封装（setName/clearName/addCollection/renameCollection/
    deleteCollection/addMember/removeMember，含残留成员清理）。
- camera：`cameraOutlineMenuItems` 纯函数单测（注入假注册表 + handlers，覆盖四类
  命中、未命中返回 undefined、删除项 role 正确），模式对齐 menuModel.test.ts。
- 不新增测试类型；i18n 词条若仓库已有 en/zh 配对断言则同步补 key。

### 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 指纹序列化对模板演进敏感 | 指纹仅控粘贴开关，保守禁用；序列化只取结构键与类型名 |
| 集合成员残留（对象被删） | 渲染求交忽略 + 宿主删除流程同步清名单（§4） |
| 扩展菜单与画布 ContextMenu 并存冲突 | chordial 在 studio shadow DOM 内独立捕获，互不可见 |
| 显示名/集合进 studio historic 的合并冲突 | 走常规 state 合并语义（同现有 panel 状态），冲突代价 = 名称/分组回退，不动数据 |
| BaseItem 行内编辑态与折叠箭头/点选手势打架 | 输入态 stopPropagation 点击/折叠，Esc/失焦退出 |

### 9. 二期方向（不在本期）

- 行拖拽进集合（chordial/useDrag 手势 + 落点指示器）。
- 复制粘贴携带关键帧（轨道级拷贝，需指纹扩展到轨道结构）。
- 集合多归属 / 嵌套。
- 存储层对象 ID 化（真改名/真集合，另行评估立项）。

## 决策记录

- 2026-09-20：存储 ID 化（向 Blender 底层靠拢）评估为 3~5 周高风险，放弃；本期 =
  显示层投影。触发重评条件：显示层方案在真实使用中证明不够用（如必须"关键帧跟随
  改名跨端同步"）。
- 伪集合 ≠ 大纲现有命名空间文件夹：后者是对象键路径的派生物（受存储约束），前者
  是纯显示层名单（本设计）。
- 成员管理一期用右键菜单（Blender 的 M 键兜底同款），拖拽列二期——与 Blender
  自身"拖拽为主、菜单兜底"的手势优先级一致，只是实现顺序反过来。
