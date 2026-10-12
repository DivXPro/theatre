# camera-studio 可嵌入模块——spec §8 验收记录(2026-10-12)

对应
spec:`docs/superpowers/specs/2026-10-10-camera-studio-embeddable-module-design.md`
§8。核对人:T12 实现者;核对基线:分支 `camera-studio-embeddable`(BASE 7885fa88 +
T12 改动)。

## 验收 8 条

### 1. 包形态 ✅

- **git mv 保历
  史**:`git log --follow --oneline -- packages/camera-studio/src/CameraScene.tsx`
  共 94 个提交,跨过 T2 的 `git mv`(53b4aa4f)一路追到 playground 时期(0b11719f
  等)。
- **非 private**:`packages/camera-studio/package.json` 无 `private` 字段(对
  照:`@dreamerbird/utils` 有 `private: true`)。
- **exports 完整**:`"."`(dist/index.{d.ts,js})+ `./contract-tests`
  (dist/assetLibrary/contractTests.{d.ts,js}),T12 未动后者。
- **peerDeps 无遗**(T12 核心收尾):产物(dist/_.js,排除 _.test.js)外部 import 全量
  普查
  (`grep -rho "from '[^']*'" packages/camera-studio/dist --include='*.js' | sort -u`),
  逐条落在 peerDependencies 或 dependencies:
  - peer(宿主提供):react / react-dom(含 /client)/ three(含 examples 子路径)/
    @react-three/fiber / @dreamerbird/core(含 initState、privateAPIs 深路径)/
    @dreamerbird/studio(含 getStudio、i18n、panels、propEditors、uiComponents 深
    路径)。
  - dependencies(T12 从 devDependencies 平移,版本规格一字未
    动):@dreamerbird/dataverse、
    @dreamerbird/r3f、@dreamerbird/react(workspace:\*,照 core/studio 的
    dataverse 惯例)、@dreamerbird/threeik 0.2.1、@react-three/drei
    ^10.7.8、three-stdlib ^2.36.1、styled-components
    ^6.5.3、@phosphor-icons/react ^2.1.10、@gltf-transform/{core,
    extensions,functions} ^4.0.0、draco3dgltf ^1.5.7。
  - **例外处理**:`@dreamerbird/utils/getDeep` 原是唯一指向 private 未发布包的运
    行时 import——无法用 dependencies 声明,已用包内 `src/getDeep.ts` 本地等价实现
    替换 (CameraScene.tsx / CameraPath.tsx 两处调用点,语义逐行对齐原
    lodash-es/get 包装), `@dreamerbird/utils` 依赖与 tsconfig project reference
    一并摘除。
  - 测试专用 import(fake-indexeddb、fs、path、react-dom/test-utils)经核实**全部
    局限于 dist 内 \*.test.js**(运行时入口链不可达),不构成产物依赖。

### 2. playground 薄壳 ≤40 行 + 冒烟 ✅

- 薄壳:`wc -l packages/playground/src/shared/camera/index.tsx` = **23
  行**(< 40)。
- 冒烟:控制器在 T10 完成 playwright 浏览器冒烟 **7/7 全过**(放置/姿势/手势/路径/
  相机/ 导出 webm/撤销链;另验目录资产 vite-dev 200、旧场景恢复、旧种子清理、sync
  断线软失败、中文 i18n)——见 SDD 台账 Task 10 complete 条目(2026-10-11)。

### 3. hook 单测 ✅

`npx jest packages/camera-studio/src/bootstrap.test.tsx`:**17/17 绿**,覆盖 T8 契
约用例 1-9 及 T10 补的 10a-10d:幂等(3)/StrictMode 双跑(1)/卸载四项清理(2)/第二实
例报错(4)/namespace 库名(5a、5b)/sync 透传(7a、7b)/state 联动
usePersistentStorage(6)/ 纯查看器(8、10c)/宿主 init 冲突矩阵(9a-9c)/启动清理分支
(10a-10d)。

### 4. 统一数据源 ✅

`npx jest packages/camera-studio/src/assetLibrary`:**17 套件 91 测试全绿**。点
名:

- 聚合读:`library.test.ts`「聚合读:多源合并,id 冲突先注册者胜并告警」+
  contentHash去重两条(R11/R12)。
- 写路由:`blobId 路由:带源前缀走该源,裸 hash 走可写源`。
- 前缀拒绝:`seed-* 前缀拒绝:可写源返回内置前缀条目被剔除并告警`。
- 纯查看器隐藏:`纯查看器模式:无可写源,写操作抛 auth;面板照常可读`(入口整体隐藏的
  UI 面另经 T5/T9 评审与 T10 冒烟坐实)。
- 契约套件对 IDB:`contract.indexeddb.test.ts` 5 用例(round-trip/不存在不抛
  /upsert/ blob 内容寻址/骨架别名)对内置 IndexedDBBackend 跑通;套件经
  `@dreamerbird/camera-studio/contract-tests` 子路径导出。

### 5. 资产去打包器耦合 ✅

- `grep -rn "import.meta.glob" packages/camera-studio/src` = **空**。
- 清单入
  库:`git ls-files packages/camera-studio/src/assetLibrary/seedAssetsManifest.ts`
  在跟踪清单;`packages/camera-studio/assets/` 111 个文件(110 姿势缩略图 + Y
  Bot.glb) 全部入库。
- baseUrl 可配:`config.assets.baseUrl`(指南 §4;T6 实现,T10 冒烟验过 vite-dev 缺
  省解析 200)。

### 6. 旧数据清理 ✅

`npx jest packages/camera-studio/src/assetLibrary/legacySeedCleanup`:**2/2 绿**
(fake-indexeddb)——「旧 seed-pose-\* 条目静默删一次;用户条目与旧模型条目保留」+
「旧场景引用已不存在的模型条目:解析返回 undefined,不抛」。

### 7. examples demo + 集成指南 ✅

- `examples/camera-host-demo`:`npx tsc -p examples/camera-host-demo/tsconfig.json --noEmit`
  绿;`npx vite build` 成功(10.96s)。T12 已把 `src/memorySource.ts` 的类型本地拷
  贝换成包根真出口
  (`import type {EntryKind, LibraryEntry, RigAlias} from '@dreamerbird/camera-studio'`),
  与指南 §3 示例重新逐字一致。
- 集成指南 `docs/guides/camera-studio-embedding.md` 含 saaz 协作服务端配方(§6,六
  路由表 + tRPC-over-WebSocket 骨架)。T12 同步:§1 删除「运行时 import 未全部入
  dependencies」已知限制(已修复);§3 改口包根导出清单;§8 排错末条换成
  IndexedDBBackend 直出口说明; §5「把init」缺空格手修为「把 `init` 交给模
  块」(prettier 对 CJK-latin 邻接空格在折行处不稳定,反引号写法是 prettier 不动
  点)。

### 8. 基线全绿 + API 快照建档 ✅

- **jest 全量**:`npx jest` = 134 套件中 **3 红 131 绿 4 跳**(882 测试中 6 红 867
  绿)。红的 3 套件 = memory sequenced-pose-prop 台账记载的既有债
  (`packages/studio/src/integration-tests/{Sequence, createContentOfSaveFile, SheetObject}`,setupTestSheet
  基建,fork 既有,分支起点已实证)。 **第 4 个红已
  修**:`devEnv/verify-docker-compose.test.ts` 因本分支新增两个包
  (camera-studio@T1、camera-host-demo@T11)的 node_modules 未登记 docker-compose
  排除而红——与本分支相关,已在 docker-compose.yml 补两行排除,转绿。
- **tsc**:`npx tsc -p packages/camera-studio/tsconfig.json --noEmit` 绿;
  `npx tsc -p packages/playground/tsconfig.json --noEmit` 绿。
- **eslint**:`NODE_OPTIONS=--max-old-space-size=8192 npx eslint packages/camera-studio/src packages/playground/src/shared/camera examples/camera-host-demo/src`
  = **0 error / 46 warning**(全部为搬迁文件既有风格项, T2 起登记;T12 触碰文件经
  scoped 复跑 0 警告)。
- **API 快照建档**:`packages/camera-studio/etc/camera-studio.api.md` 已由
  api-extractor 7.28.6 生成入库(core 同款基座:devEnv/api-extractor.json extends
  根 devEnv/api-extractor-base.json;`yarn build:api` = `tsc -b` +
  `api-extractor run --local`)。一次接线成功,未触发降级快照测试。
  - 导出面定格(R18/R19):useCameraStudio / CameraScene / CAMERA_STUDIO_VERSION /
    initCameraStudio / disposeCameraStudio / BootCtx / CameraStudioConfig /
    CameraStudioHandle / CameraSceneProps / CameraFlows / Vec3 / PathPreset /
    LibrarySource / LibrarySourceCapabilities / WritableLibrarySource /
    LibraryEntry / EntryKind / ModelEntry / PoseEntry / AnimationEntry / RigId /
    RigAlias / LibraryError / LibraryErrorCode / isWritableSource /
    IndexedDBBackend。 **不含** setUiConfig/getUiConfig(R18:config.ui 已覆盖,不
    出口)。
  - 残留 1 条 ae-forgotten-export(BootCtx.library 的 Library 类):容忍——BootCtx
    是「测试与高级宿主」逃逸舱,Library 聚合器整体不出口;core.api.md 同类警告 12
    条为既有先例。

## 附注

- **initState 深导入结论**(T8 观察,brief #4):bootstrap.ts 的
  `@dreamerbird/core/initState` 深路径导入在发布形态可解析——core 的 package.json
  无 exports map(仅 main/types),Node/打包器按文件路径回退解析 dist/initState.js;
  同包既有 4 处 `@dreamerbird/core/privateAPIs` 深导入(T2 起)同一机制,先例成立。
- **I18nContext 建档**(T9 新公共 API,brief #9):`@dreamerbird/studio` 无
  api-extractor 机制(无 etc/ 目录)。T9 起 `I18nContext`(及配套的
  I18nProvider/useI18n/useT/TFunction)从 `@dreamerbird/studio/i18n` 子路径出口,
  camera-studio 经它探测宿主是否自包 I18nProvider(CameraScene.tsx:2079)。记录在
  此, 供 studio 后续建档时收编。
- **threeik 深导入**:`@dreamerbird/threeik/dist/controls/index` 仅出现在包内
  `src/types/threeikControls.d.ts` 的 `declare module` 类型映射里,非运行时
  import; 运行时只走 exports map 覆盖的 `@dreamerbird/threeik` 与 `/controls` 两
  子路径。
- **peerDeps 平移清单**:见验收 #1 的 dependencies 条目;devDependencies 同步摘除
  (react/react-dom/three/@react-three/fiber 按 peer 惯例双份保留供本地构建)。
