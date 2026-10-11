# camera-studio 可嵌入模块设计

2026-10-10 · 状态:已逐段评审通过(公开 API / 装配拆分 / 统一数据源 / 状态与协作 / 生命周期 / 验收标准)

## 1. 背景与目标

playground 里的相机场景系统(3D 画布 + 资产库 + 姿势/手势 + 相机路径 + 视频导出)目前是一个写死装配的私有应用(`packages/playground`,`private: true`,无库产物)。目标:把它封装成别的应用系统能 `import` 进去、作为模块功能使用的库包 `@dreamerbird/camera-studio`。

**植入形态(已确认):完整编辑体验**——宿主给一个整页/整路由,studio(大纲/属性面板/时间轴)+ 相机场景整体嵌入。不做「只嵌画布不带 studio」和「纯运行时」两种形态。

**初始化封装形态(已确认):hooks**——初始化生命周期收进一个 hook,宿主两行接入。

## 2. 现状关键事实(设计的立足点)

- studio UI 是页级覆盖层:`position: fixed` 铺满视口、挂 `document.body`、shadow DOM,z-index 100(`packages/studio/src/UI/UINonSSRBits.ts`);`getStudio()` 是进程级单例,**同页多实例在 studio 层面就不支持**。
- studio 覆盖层可收可放:`studio.ui.hide()` / `ui.restore()` / `isHidden`(`packages/studio/src/TheatreStudio.ts:55`)。
- 装配写死在应用壳:`theatre.init({studio: true, serverUrl: 'ws://localhost:3000'})`(`index.tsx`)、`getProject('Space')`(`App.tsx:729`)、I18nProvider 与词典副作用 import、编辑器注册(`App.tsx:1616` 注册 gestureL/gestureR)。
- 资产库后端是 IndexedDB,库名常量 `toybox-asset-library`;`getLibrary()` 模块级单例,无注入口。
- 种子资产(6 个 Mixamo 模型 74MB + 110 张 QBX 预览图)走 `import.meta.glob` eager——vite 私有语法,jest 已需动态 import 迂回,非 vite 宿主(如 Next.js)直接断。
- 场景状态持久化:theatre 内核 `InitOpts.usePersistentStorage`(默认 true,浏览器 IDB);关掉后宿主可用 `initialState` + `onChange`/`createContentOfSaveFile` 全权接管。
- 协作:客户端经 tRPC-over-WebSocket 连 sync-server(`packages/studio/src/SyncStore/SyncServerLink.ts`);协议逻辑全在 `@dreamerbird/saaz`(已是可发布形态),sync-server 是百行级薄壳参考实现,内存态、重启即清,同步范围 = 场景文档增量 + presence,**资产库不过 sync**;鉴权桥的类型目前绑死 `@dreamerbird/app`。
- `camera/` 目录自包含,playground 其他页面零引用(已核实)。

## 3. 公开 API

```tsx
import {useCameraStudio, CameraScene} from '@dreamerbird/camera-studio'

function SceneEditorPage() {
  const {ready, error, sceneProps} = useCameraStudio({
    project: 'space',               // id 字符串;或 IProject 实例
    state: {                        // 场景状态宿主接管(可选)
      initialState,                 // 打开场景回放
      onStateChange: (content) => save(content),  // 模块已节流(缺省 1s)
    },
    storage: myHttpSource,          // WritableLibrarySource;缺省内置 IDB
    assets: {baseUrl: 'https://cdn.example.com/camera-assets'},
    sync: {serverUrl: 'wss://sync.example.com'},  // 缺省 false(关)
    ui: {zIndexBase: 1000},         // portalContainer / locale 可选
    flows: {onFlows: (flows) => ...},  // 接管添加模型/路径/相机入口(现有机制透传)
  })
  if (error) return <LoadFailed error={error} />
  if (!ready) return <Splash />
  return <CameraScene {...sceneProps} />
}
```

- `useCameraStudio(config)` 管全部初始化生命周期(见 §6);`CameraScene` 是静态导出组件,`sceneProps` 对宿主不透明(当前 = `{project, onFlows}` 的转发),宿主不解构。
- config 全可选;`useCameraStudio({project: 'space'})` 之外裸调等价于 playground 现状行为。

## 4. 装配拆分

**新建 `packages/camera-studio`,`src/shared/camera/` 整目录 `git mv`**(保历史;目录自包含已核实;jest 的 `packages/*/src` 通配与 tsconfig paths 别名生成都自动覆盖新包)。playground 留演示页 import 该包,立刻吃自己的狗粮。不选原地库化:playground 是应用包,顶着它发库语义混乱,迟早再搬。

代码拆分四处:

| 现在 | 搬到/改成 |
|---|---|
| `index.tsx` 的 `theatre.init`、I18nProvider、词典副作用 import | 库内 `bootstrap.ts`:init 前检测宿主已初始化则复用、配置冲突告警;词典注册改显式函数 |
| `App.tsx` 的 `getProject('Space')` | 删除,project 走 `sceneProps`;`App` 改名导出 `CameraScene` |
| `App.tsx:1616` 编辑器注册 useEffect | 挪进 `useCameraStudio` init(注册/注销与库生命周期对齐);`registerEditorOnly` 留在场景组件(按画布,非全局) |
| `index.tsx` 本体 | playground 薄壳 ≤40 行 |

**资产去打包器耦合**:提交前本地跑脚本扫 `seedModels/`、`poseThumbsQbx/` 生成 `seedAssetsManifest.ts`(纯 TS 数据,产物入库、diff 可审);运行时 URL = `assets.baseUrl ?? 包内缺省路径` + file,缺省路径 `new URL('../assets/', import.meta.url)` 惰性求值(jest/不跑播种的场景永远不碰);清单同时导出,宿主构建脚本可照它把资产拷到自己的 CDN。现有 jest 迂回模块 `poseThumbsQbxUrls.ts` 删除。

## 5. 统一数据源(存储的正式形态)

模型/姿势/动画数据**完全由应用提供的存储承担**;模块附带的基础资产也走同一接口——实现层面一个接口、三种实现,零特判:

```ts
/** 统一数据源(读):内置目录、宿主生产存储、本地 IDB 演示,全走它 */
export interface LibrarySource {
  readonly id: string
  listEntries(kind?: EntryKind): Promise<LibraryEntry[]>
  getEntry(id: string): Promise<LibraryEntry | undefined>
  /** 每个源自己解析自己的 blob:静态源→CDN 地址,HTTP 源→预签名,IDB→blob: */
  getBlobUrl(blobId: string): Promise<string>
  capabilities?: {
    writable?: boolean
    permanentUrls?: boolean    // URL 长效才允许跨挂载缓存
    maxUploadBytes?: number    // 导入前先校验先提示
  }
  /** 远端变更推送(可选,v1 不强制) */
  subscribe?(fn: () => void): () => void
}

/** 可写源 = 用户库(宿主生产存储 / 内置 IDB) */
export interface WritableLibrarySource extends LibrarySource {
  putEntry(entry: LibraryEntry): Promise<void>
  deleteEntry(id: string): Promise<void>
  putBlob(
    data: Blob,
    opts?: {onProgress?: (ratio: number) => void; signal?: AbortSignal},
  ): Promise<string>
  deleteBlob(blobId: string): Promise<void>
  getRigAliases(): Promise<RigAlias[]>
  putRigAlias(alias: RigAlias): Promise<void>
}
```

- **内置目录 = `StaticCatalogSource`**:6 个模型 + 182 个姿势 + 全部预览图,随包清单 + `assets.baseUrl` 文件根,只读。**种子不再播种进用户存储**——消掉每用户 74MB 重复存储、播种幂等、种子 upsert 迁移、孤儿清扫误删内置图这一整类问题。
- **config 的 `storage` 字段**:生产传 `WritableLibrarySource` 实例;`{namespace?: string}` 简写 = 内置 IndexedDB 实现(库名 `toybox-asset-library[-namespace]`,**不传 namespace 时库名与现状一字不差**——现有用户浏览器里的库存数据零迁移,硬约束);整个字段缺省 = 现状行为。实现上给 `IndexedDBBackend` 加构造参数,现在的模块级常量降为缺省值。
- **Library 门面 = 聚合器**:读 = 各源合并(骨架族过滤/选择框/属性面板无感);写 = 路由到唯一可写源,宿主不给可写源即纯查看器模式(导入/保存姿势/删除入口整体隐藏,不是置灰报错)。
- **id 命名空间**:内置条目保留 `seed-pose-*` / `seed-model-*` 前缀,聚合层拒绝可写源返回同前缀条目。
- **缩略图**:运行时渲染回填只对可写源里的用户姿势生效;内置姿势预览图用内置模型运行时渲染、内存缓存,不写任何存储。
- **错误统一**:`LibraryError`,code ∈ `auth / quota / network / conflict / not-found / unknown`;门面发错误事件,面板出错误条(替代现在到处 console.warn 吞掉)。
- **孤儿清扫让位服务端**:`listBlobIds` 降为可选,HTTP 源不实现则跳过清扫。
- **保留**:blob 内容寻址去重、写操作串行队列、条目 upsert 语义。
- **契约测试套件**:导出 `runLibrarySourceContractTests(makeSource)`,宿主的 HTTP 实现先跑它再上线;套件对内置 IDB 实现自身也要跑通。
- **旧数据清理**:现存用户浏览器里已播种的 `seed-*` 条目,启动时静默删一次(已被内置目录取代)。

## 6. 场景状态与协作

**场景状态**:`state` 通道传了 = 宿主接管(模块 theatre.init 时 `usePersistentStorage: false`,`onStateChange` 节流缺省 1s);不传 = theatre 本地持久化(现状)。初始化冲突(宿主已 init 且配置不一致)告警并以先到的为准。

**协作**:
- sync 服务同步范围 = 场景文档增量 + presence;**资产数据一致性是存储服务的职责,不过 sync**(现状 A 导入模型 B 看不见的坑,由统一数据源 + 宿主存储天然解决)。
- 模块交付物 = 客户端 + `sync: {serverUrl}`,**不含任何服务端代码**;缺省 `false`(对齐 1.0 程序「协作默认关」)。
- sync-server 不进发布包,定位 = monorepo 内的联调工具 + 宿主参考实现。宿主自实现配方:`@dreamerbird/saaz` + `@trpc/server` WS 适配器,照 sync-server 路由抄(客户端协议是 tRPC-over-WebSocket,不建议非 tRPC 重写)。
- 待办:sync-server 验权回调与 `@dreamerbird/app` 的类型解耦(宿主直接部署参考实现时才需要);`@dreamerbird/saaz` 纳入 1.0 发布范围的名分确认。

## 7. 生命周期与约束

**`useCameraStudio` 状态机**:`idle → initializing → ready / error`。

- 幂等与 StrictMode:init 挂共享 promise,重复触发只复用;卸载后允许干净重挂。
- 卸载清理(对称、逐项可测):注销 gestureL/gestureR 编辑器 → 清框体注册表 → 清宿主句柄 → 断库订阅 + dispose 库(关 IDB/清聚合源)→ `studio.ui.hide()`。重新挂载 = init 幂等复用 + `ui.restore()`。
- 冲突矩阵:宿主未 init → 模块按 config init;已 init 且一致 → 静默复用;不一致 → 告警以先到为准,绝不悄悄重连。

**约束(写进宿主文档)**:

- **单页单实例**(根源在 studio 全局单例);同页第二个 `useCameraStudio` 直接报错。
- **嵌入单位 = 整页/整路由**(studio 覆盖层铺满视口 z-100;模块停靠框基准 1000 可配)。嵌进页面局部区域 = 非目标。
- **i18n 嵌套**:CameraScene 自带 I18nProvider;宿主已包则检测跳过、语言以宿主为准,`ui.locale` 仅在模块自包时生效。

## 8. 验收标准

1. 包形态:`packages/camera-studio` 存在(git mv 保历史),package.json 非 private、exports 地图完整,react/three/@dreamerbird 全部 peerDependencies。
2. playground 薄壳化:入口 ≤40 行;现有功能冒烟全过(放置/姿势/手势/路径/相机/视频导出/撤销)。
3. hook 单测(renderHook + fake-indexeddb):幂等、StrictMode 双跑、卸载四项清理、第二实例报错、各 config 字段生效(namespace 库名/sync 透传/state 联动 `usePersistentStorage`)。
4. 统一数据源:聚合读、写路由、id 前缀拒绝、无可写源时导入/保存入口隐藏;契约测试套件导出并对内置 IDB 实现自身跑通。
5. 资产去打包器耦合:全量 jest 不碰 `import.meta.glob`;清单产物入库;baseUrl 可配。
6. 旧数据清理:带旧 `seed-*` 条目的库启动静默清理,fake-indexeddb 下有迁移测试。
7. 最小宿主 demo(examples/ 下)import 包跑通;集成指南文档(含 saaz 协作端点配方)。
8. 基线全绿:全量 jest、tsc、eslint;公共 API 快照建档(core 的 api.md 同款)。

## 9. 非目标

同页多实例;studio 嵌进页面局部区域;协作远端推送订阅(`LibrarySource.subscribe`,v2);库分页;内置条目的隐藏/墓碑;sync-server 的验权解耦与发布(记在 §6 待办)。
