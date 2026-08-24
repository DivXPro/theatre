# Theatre.js changelog

## 1.0.0

Theatre.js 1.0 将 npm scope 从 `@theatre/*` 迁至 `@toy-box/*`,定稿 `init()` 流程,并引入实验性的自托管协作。完整迁移步骤见 [MIGRATION.md](MIGRATION.md)。

* Breaking
  * npm scope 改名:`@theatre/*` → `@toy-box/*`。所有 install / import 都需更新,见 MIGRATION.md「scope 改名」。
  * `init()` 流程定稿:调用 `getStudio()` 前必须先调用 `theatre.init()`。此前顺序相反的代码现在会抛错,见 MIGRATION.md「init() 流程」。
  * `@toy-box/r3f` 升级到 `@react-three/fiber` 9:需要 react 19 + `@react-three/fiber@^9` + `@react-three/drei@^10`,仍在 react 18 的项目请留在旧版 r3f。fiber 9 移除了 `<line>` 元素,`<e.line>` 随之移除,见 MIGRATION.md「被删 / 改的 API」。
* 协作(实验性)
  * 自托管 sync-server minimal loop:`AUTH_DISABLED=true` 下无需 app / postgres 即可运行。
  * studio 支持直连 ws serverUrl(`ws://` / `wss://`),无需经 app 中转。
  * 断线时全局工具栏显示「Reconnecting…」徽标。
* 内部
  * 同步引擎改为 saaz 桥;StudioStore 后端按配置可选。
  * `@toy-box/studio` 内置 UI 升级到 react 19 + styled-components 6(均打包进 dist;消费端项目用 react 16/17/18/19 均可,无感知)。

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