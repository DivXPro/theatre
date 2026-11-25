# Theatre.js changelog

## 1.4.2

- Camera Studio 的视图坐标轴会随属性面板调整位置。画中画默认关闭，可从工具栏开启。
- 漫画模式的阴影开关和网点预设改由宿主通过 `scene.viewportRendering` 配置，工具栏保留漫画模式切换。
- 提高浅色主题下时间轴主刻度和次刻度网格线的对比度，暂停时切换主题也会立即更新。

## 1.4.1

- 修复 Camera Studio 的 npm 接入。Core、Studio 和 R3F 的同版本包共享编辑器运行时，发布包包含 Studio 类型声明、演示模型和 `@dreamerbird/camera-studio/scene-sync` 入口。
- 宿主可以异步读取场景后再启动 Camera Studio，并在关闭后重新打开场景。

## 1.4.0

- Studio 和 Camera Studio 新增浅色主题。宿主可通过 `data-theme` 即时切换工具栏、场景树、属性面板、时间轴和浮层。主题切换期间保留场景和编辑状态。[主题接入指南](docs/guides/camera-studio-embedding.md#宿主控制工作台主题)
- 工作台的外观和语言由宿主管理。网页和桌面示例移除了编辑器设置入口，Electron 示例在启动时读取系统语言，并实时同步系统外观。

## 1.3.0

- Camera Studio 新增 `assets.saveModel`。Agent 可以把多个程序生成的静态网格保存为一个可复用的模型资产，再通过 `models.create` 放进场景。示例宿主使用 IndexedDB 保存资产。调用示例见 [Agent HTTP 接口指南](docs/guides/camera-studio-agent-http.md#保存生成的网格)。
- 新增日语、韩语、俄语、德语、西班牙语、巴西葡萄牙语和法语界面。
- Studio 的右键菜单改用 shadcn/ui 的 Radix Context Menu，支持键盘导航。对象树的右键菜单直接显示操作项，重命名时高亮边框只围住名称输入区。

## 1.2.0

- 新增 Camera Studio 单机桌面接入入口 `mountCameraStudioDesktop()` 和 Electron 示例。宿主可通过内部 JS API 和 IPC 加载场景、处理关闭通知、保存图片和视频、切换语言。接入步骤见 [单机桌面接入指南](docs/guides/camera-studio-embedding.md#单机桌面接入)。
- 嵌入式宿主可自定义工作台主题和 Studio 工具栏标识。Camera Studio 新增漫画渲染模式、网点阴影预设和视口人物名称开关。
- 时间轴新增角色动画片段与运镜路径相关操作。Agent API 新增动画片段、角色路径绑定、Fullbody IK 目标和视口渲染设置命令。
- 改进视频导出，支持 H.264 与 MediaRecorder 回退路径。

## 1.1.0

- Camera Studio 宿主可用 `HttpPatchAdapter` 从服务器加载场景，并通过 HTTP JSON Patch 保存增量。示例接口支持 ETag 版本校验、幂等提交和 WebSocket 版本通知。
- 宿主管理场景时，Studio 在内存中保留未保存编辑。空闲标签页收到远端更新后重新加载，编辑中的标签页会提示版本变化并保留本地编辑。
- 宿主可配置场景资产的上传与读取接口。接入步骤见 [Camera Studio 嵌入指南](docs/guides/camera-studio-embedding.md#5-场景状态接管)。

## 1.0.0

Theatre.js 1.0 将 npm scope 从 `@theatre/*` 迁至 `@dreamerbird/*`,定稿 `init()` 流程,并引入实验性的自托管协作。完整迁移步骤见 [MIGRATION.md](MIGRATION.md)。

* Breaking
  * npm scope 改名:`@theatre/*` → `@dreamerbird/*`。所有 install / import 都需更新,见 MIGRATION.md「scope 改名」。
  * `init()` 流程定稿:调用 `getStudio()` 前必须先调用 `theatre.init()`。此前顺序相反的代码现在会抛错,见 MIGRATION.md「init() 流程」。
  * `@dreamerbird/r3f` 升级到 `@react-three/fiber` 9:需要 react 19 + `@react-three/fiber@^9` + `@react-three/drei@^10`,仍在 react 18 的项目请留在旧版 r3f。fiber 9 移除了 `<line>` 元素,`<e.line>` 随之移除,见 MIGRATION.md「被删 / 改的 API」。
* 协作(实验性)
  * 自托管 sync-server minimal loop:`AUTH_DISABLED=true` 下无需 app / postgres 即可运行。
  * studio 支持直连 ws serverUrl(`ws://` / `wss://`),无需经 app 中转。
  * 断线时全局工具栏显示「Reconnecting…」徽标。
* 内部
  * 同步引擎改为 saaz 桥;StudioStore 后端按配置可选。
  * `@dreamerbird/studio` 内置 UI 升级到 react 19 + styled-components 6(均打包进 dist;消费端项目用 react 16/17/18/19 均可,无感知)。

## 0.4.5

* New features
  * `sequence.attachAudio()` now uses an internal [`GainNode`](https://developer.mozilla.org/en-US/docs/Web/API/GainNode) that you can customize by connecting it to your own audio graph. Docs [here](https://docs.theatrejs.com/in-depth/#sound-and-music).

## 0.4.4

* New features
  * Implemented [@theatre/browser-bundles](https://www.npmjs.com/package/@theatre/browser-bundles), a custom build of Theatre.js that can be used via a `<script>` tag and a CDN. This should enable Theatre.js to be used in CodePen or projects that don't use a bundler.

## 0.4.3

* New features
  * `sequence.attachAudio()` now [accepts](https://github.com/AriaMinaei/theatre/commit/3f0556b9eb66a0893b43e38a3ee889e13d3a6667) any `AudioNode` as destination.
  * Implemented `studio.createContentOfSaveFile()` for programmatically exporting the project's state.

## 0.4.2

* New features
  * `sequence.attachAudio` now handles autoplay blocking ([Docs](https://docs.theatrejs.com/in-depth/#sequence-attachaudio)).
  * `studio.selection` and co have a more [lax](https://github.com/AriaMinaei/theatre/commit/dcf90983a565e585661b631b457a807eb4a4d874) type constraint.
* Bug fixes
  * Fixed the builds of internal examples.

## 0.4.1

* Bug fixes
  * [Fixed](https://github.com/AriaMinaei/theatre/commit/fe4010c2c64626029a26e29b9ad9104df9c56ad4) the jumping issue with `sequence.play({range})`.
  * [Fixed](https://github.com/AriaMinaei/theatre/commit/769eefb5e521c8206152b0e23937d5a3cd872b8b) a typo in the `dependencies` field, thanks [Nikhil Saraf](https://github.com/nksaraf)!
