# Studio / Camera Studio Light / Dark 双主题设计

日期：2026-10-28
状态：已获批准，待编写实施计划

## 背景与目标

宿主应用具有 Light / Dark 两种视觉模式，需要 Studio 与 Camera Studio 的编辑器 UI 随宿主同步切换。当前 Studio 默认深色，`packages/studio/THEMING.md` 已开放第一阶段 `--theatre-*` CSS 变量，但仍存在硬编码颜色；Camera Studio 部分 UI 位于主文档，无法直接继承 Studio Shadow DOM `:host` 上定义的变量。

目标：

- 系统内置完整 Light / Dark 两套主题；
- 宿主通过 `data-theme="light|dark"` 主动切换，不跟随操作系统，不新增公开 JS 主题 API；
- 同一主题同时覆盖 `packages/studio` 与 `packages/camera-studio`；
- 未设置属性时保持当前 Dark 外观，兼容既有接入；
- 保留宿主通过 `--theatre-*` 变量进一步换肤的能力。

## 已确认的方案

采用“内置双主题 + CSS 语义变量 + `data-theme` 桥接”。

未采用：

- 内部主题状态加公开 JS API：增加初始化时序和状态同步成本，且不符合宿主属性驱动的接入选择；
- 宿主自行维护全部变量：接入成本高，无法形成一致、完整的内置 Light 主题。

## 宿主契约

### Camera Studio

宿主在 Camera Studio 容器上设置：

```html
<div id="camera-host" data-theme="light"></div>
```

容器对应 `ui.portalContainer`；未配置 `ui.portalContainer` 时，主题源为 `document.body`。运行时允许直接修改属性：

```ts
hostElement.dataset.theme = 'dark'
```

桥接层把主题源属性同步到 `#theatrejs-studio-root`、Camera Studio UI 根节点及使用的浮层容器。初始化前已存在的属性与初始化后的属性变更都必须生效。

### 独立 Studio

不使用 Camera Studio 桥接层时，宿主直接在 Studio 容器上设置：

```html
<div id="theatrejs-studio-root" data-theme="light"></div>
```

### 回退与覆盖

- 属性缺失、被移除或值不是 `light` / `dark` 时使用 Dark；
- 不读取 `prefers-color-scheme`；
- 内置主题提供默认变量值，宿主对具体 `--theatre-*` 变量的显式覆盖优先于预设值。

## 主题令牌

扩展现有 `--theatre-*` 变量，形成 Light / Dark 共用的语义接口。至少覆盖：

- 面板与标题栏背景、不同透明度的浮层背景；
- 边框、分隔线、阴影；
- 主文字、次级文字、弱化文字、标题与标点；
- 按钮、输入框、菜单、Tooltip、Popover 的背景与前景；
- hover、active、disabled、selected、focus 等交互状态；
- 编辑器强调色及需要随背景调整对比度的数据可视化颜色。

Dark 令牌沿用当前色值，确保默认外观不变。Light 令牌使用对应的浅色语义配色，而不是简单反转颜色。组件只消费语义令牌，不直接判断当前主题。

现有变量的名称与用途保持兼容；新增变量写入 `packages/studio/THEMING.md`，并说明双主题接入方式。透明背景变量仍为独立令牌，覆盖主背景不会自动联动。

## 组件与渲染路径

### 共享令牌定义

集中定义两套令牌及令牌到 CSS 的转换，Studio 与 Camera Studio 复用同一来源，避免两套 UI 的色值漂移。该模块不保存运行时主题状态。

### Studio Shadow DOM

`packages/studio/src/css.tsx` 的 `GlobalStyle` 根据 Shadow 宿主的 `data-theme` 输出对应变量。现有 `theme` 对象与 `panelUtils` 继续引用变量，不恢复 ThemeProvider。

面板、时间轴、工具栏、属性编辑器、菜单和各类浮层中影响 UI 外观的硬编码颜色迁移到语义变量。必须核对 Portal 的实际挂载位置，确保变量在所有浮层路径上均可继承。

### Camera Studio 主文档 UI

Camera Studio 根节点使用同一套语义变量。顶栏、资产库、姿势选择/编辑条及其他 DOM 覆盖层迁移硬编码颜色，移除“Shadow DOM 不可见所以永远使用深色兜底”的旧策略；保留变量兜底值时，兜底必须与 Dark 令牌一致。

### 主题桥接

桥接层只负责：

1. 挂载时读取主题源并同步属性；
2. 用 `MutationObserver` 监听主题源的 `data-theme`；
3. 将规范化后的 `light` / `dark` 同步到各 UI 根节点与浮层容器；
4. 销毁时断开观察并清理本模块拥有的监听资源。

桥接层不复制业务状态，不触发场景重新初始化，也不要求 React 全量重渲染。主题变化通过 CSS 变量生效。

## 范围边界

包含：

- Studio 面板、时间轴、工具栏、属性编辑器；
- Camera Studio 工具栏、资产库、姿势编辑及场景上的 DOM 控件；
- 菜单、通知、Tooltip、Popover、上下文菜单等浮层；
- 与上述 UI 相关的 hover、disabled、selected 和 focus 状态。

不包含：

- Three.js 场景中的模型、灯光、材质和用户内容；
- 取色器所展示的用户颜色、资产缩略图等内容本身；
- 操作系统主题自动跟随、公开 JS 主题切换 API、每套主题的宿主自定义预设编辑器。

## 异常与兼容

- 非法或缺失主题值回退 Dark，不抛出初始化错误；
- 桥接目标尚未挂载时，待其出现后应用当前主题，而不是固定使用首次读取值；
- 销毁桥接层后不再响应属性变化；
- 主题切换不得改变场景内容、选中对象、面板状态、播放状态或持久化数据；
- 既有宿主未设置 `data-theme` 时维持 Dark；
- 既有宿主自定义 `--theatre-*` 变量的能力继续有效。

## 验证与验收

### 单元测试

- 两套主题包含相同的语义令牌，Dark 默认值与现有值一致；
- 独立 Studio 的 Light / Dark 选择及默认回退正确；
- 桥接层覆盖初始属性、动态切换、非法值、属性移除、延迟挂载和销毁；
- 浮层容器与主 UI 使用相同主题。

### 样式回归

- 已迁移组件不再包含固定面板色和文字色；
- Camera Studio 不再使用固定深色值作为唯一视觉来源；
- 新增样式检查防止后续代码绕开已建立的语义令牌。

### 视觉与端到端验证

- 分别检查两种主题下的工具栏、资产库、属性面板、时间轴、姿势编辑及浮层；
- 检查文字对比度、边框、hover、disabled、selected 和 focus；
- 宿主反复切换 `data-theme`，Shadow DOM 与主文档 UI 同步变化；
- 切换前后场景内容、选中对象、面板状态与播放状态不变；
- 未设置属性的既有示例保持当前 Dark 外观；
- 项目现有测试、类型检查和标准构建通过。
