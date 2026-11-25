# 把 camera-studio 嵌进你的应用(@dreamerbird/camera-studio 集成指南)

> 面向宿主应用开发者。`@dreamerbird/camera-studio` 把完整的相机场景编辑体验 (3D
> 画布 + 资产库 + 姿势/手势 + 相机路径 + 视频导出 + studio 大纲/属性面板/时间轴)
> 打包成一个模块,宿主给一个**整页/整路由**即可接入。
>
> 配套有一个可跑的最小宿主示例:`examples/camera-host-demo`(顶部导航条 + 整页
> CameraScene);其中 §3 的存储示例与它的 `src/memorySource.ts` 逐字一致,可直接拷
> 贝。

## 1. 安装

### npm 工程

```bash
npm install @dreamerbird/camera-studio
```

peer 依赖(按包内 peerDependencies 逐字列出,需由宿主提供):

| 包                    | 版本要求  | 说明                             |
| --------------------- | --------- | -------------------------------- |
| `react`               | `>=19`    |                                  |
| `react-dom`           | `>=19`    |                                  |
| `three`               | `>=0.185` |                                  |
| `@react-three/fiber`  | `^9.0.0`  |                                  |
| `@dreamerbird/core`   | `*`       | 与 studio 同代发布(1.0 程序范围) |
| `@dreamerbird/studio` | `*`       | 同上                             |

```bash
npm install react react-dom three @react-three/fiber
```

其余运行时库(`@react-three/drei`、`styled-components`、`three-stdlib`、
`@phosphor-icons/react`、`@gltf-transform/*`、`draco3dgltf`、`@dreamerbird/threeik`
等)已列入包自身 dependencies,随包安装,无需宿主操心。

运行时导出的 `CAMERA_STUDIO_VERSION` 与 `package.json` 的 `version` 同源(包内直
接读package.json),排查版本时不需要核对第二个版本号。

### monorepo 消费方(theatre 仓库内,含本示例)

`package.json` 里用 workspace 协议:

```json
{
  "dependencies": {"@dreamerbird/camera-studio": "workspace:*"}
}
```

vite 侧把 `@dreamerbird/*` 别名到源码(与 playground 同款,从 `tsconfig.base.json`
的 paths 派生,别手写死路径):

```ts
// vite.config.ts
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react-swc'
import {getAliasesFromTsConfigForRollup} from '../../devEnv/getAliasesFromTsConfig'

export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.gltf', '**/*.glb', '**/*.fbx'], // 包内有 .glb 静态导入
  resolve: {alias: [...getAliasesFromTsConfigForRollup()]},
})
```

**project references 的 dist 坑**:经 project references(如本示例的
`tsconfig.json`)消费时,类型检查吃的是 camera-studio 的 **dist 类型声明**; 拉了新
代码如果 dist 是旧的,会报 TS2305「幻出已删导出」。重建声明:

```bash
npx tsc -b packages/camera-studio
```

## 2. 两行接入

```tsx
// src/CameraPage.tsx
import {useCameraStudio, CameraScene} from '@dreamerbird/camera-studio'

export function CameraPage() {
  const {ready, error, sceneProps} = useCameraStudio({
    project: 'Space', // 场景 id;全部用缺省则与 playground 现状行为一致
    // (sync 除外:缺省为关,playground 是显式开启的特例)
  })
  if (error) return <div>加载失败:{error.message}</div>
  if (!ready) return null // 或你的 Splash
  return <CameraScene {...sceneProps} />
}
```

`useCameraStudio(config)` 返回
`{ready, error, sceneProps, api, closeScene, flushState, hasTemporaryChanges}`;`sceneProps`
对宿主 **不透明**(当前 = `{project, onFlows, onError}` 的转发),不要解构它。`api`
是 Agent JS 命令面门面的模块级单例(首帧即稳定),页内自动化/Agent 场景见§9
与[专项指南](./camera-studio-agent-js-api.md)。`hasTemporaryChanges()` 可用于判
断拖拽等尚未提交的编辑预览,宿主替换场景前应先检查它。

### config 全字段参考

| 字段                    | 类型                                                     | 缺省            | 说明                                                                                                |
| ----------------------- | -------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| `project`               | `string \| IProject`                                     | `'Space'`       | 场景 id 字符串(getProject),或宿主自建的 IProject 实例(传实例时 `state.initialState` 被忽略)         |
| `state`                 | `{initialState?, onStateChange?, throttleMs?}`           | 不传            | 传了 = **宿主接管场景状态**,同时关掉 theatre 本地持久化(见 §5)                                      |
| `onError`               | `(error: CameraStudioError) => void`                     | 不传            | 资产库、场景保存和视频导出的错误由宿主展示                                                          |
| `onSceneClosed`         | `({projectId}) => void \| Promise<void>`                 | 不传            | 启用工具栏退出按钮，场景清理完成后通知宿主                                                          |
| `onSaveExport`          | `CameraStudioSaveExport`                                | 浏览器保存      | 接收工具栏导出的图片或视频成品                                                                      |
| `storage`               | `WritableLibrarySource \| {namespace?: string} \| false` | 见 §5           | 宿主资产库接口、浏览器 IndexedDB 命名空间，或 `false` 只用内置目录                                  |
| `assets.baseUrl`        | `string`                                                 | 包内 `assets/`  | 内置目录文件根(见 §4)                                                                               |
| `assets.projectStorage` | `{getAssetUrl, createAsset}`                             | 不传            | 项目文件的 URL 和上传接口。传 `IProject` 时由创建方通过 `assets.storage` 配置                       |
| `sync`                  | `{serverUrl?: string} \| false`                          | `false`         | 协作端点(见 §6)                                                                                     |
| `ui.portalContainer`    | `HTMLElement`                                            | `document.body` | 模块停靠框的 portal 挂载点                                                                          |
| `ui.zIndexBase`         | `number`                                                 | `1000`          | 模块停靠框 z-index 基准(见 §7 层级地图)                                                             |
| `ui.theme`             | `CameraStudioTheme`                                      | 内置深色主题    | 初始化时覆盖 UI 主题变量，未传的字段沿用内置样式                                                    |
| `ui.locale`             | `string`                                                 | 不生效          | 仅当宿主**未**包 I18nProvider 时应用,一次性 setLanguage(见 §7)                                      |
| `ui.hideLeftStrip`      | `boolean`                                                | `false`         | 隐藏 studio 左上角带 logo 的整条 LeftStrip(应用 logo + 工作区按钮);boot 级一次性应用,换值需整页刷新 |
| `flows.onFlows`         | `(flows: CameraFlows) => void`                           | 不传            | 接管「添加模型/添加路径/添加相机」入口,拿到模块的 flows 句柄                                        |
| `agent.exposeGlobal`    | `boolean`                                                | `false`         | 场景 ready 后把 Agent JS API 门面挂到 `window.__cameraStudioApi`,dispose 时删除(见 §9)              |
| `agent.bridge`          | `{url, token, httpUrl}`                                  | 不传            | 连接本机 Agent HTTP 桥接(`url` 是 WS 命令通道,`httpUrl` 走文件传输);缺省不连桥接(见 §9)             |

### 打开、退出和导出场景

宿主先读取要打开的场景，再挂载编辑器。把场景 ID 传给 `project`，把快照传给
`state.initialState`，并在 `state.onStateChange` 中保存编辑提交。

```tsx
import {CameraScene, useCameraStudio} from '@dreamerbird/camera-studio'

function SceneEditor({scene, host, locale}) {
  const {ready, error, sceneProps} = useCameraStudio({
    project: scene.id,
    state: {
      initialState: scene.snapshot,
      onStateChange: (snapshot) => host.saveScene(scene.id, snapshot),
    },
    ui: {locale},
    onSceneClosed: ({projectId}) => host.showSceneList(projectId),
    onSaveExport: ({kind, blob, fileName, mimeType}) =>
      host.saveExport(scene.id, {kind, blob, fileName, mimeType}),
    onError: host.showEditorError,
  })

  if (error) return <p role="alert">{error.message}</p>
  return ready ? <CameraScene {...sceneProps} /> : null
}

```

- **退出。** 工具栏和宿主调用 `closeScene()` 走同一保存及关闭流程。保存失败或仍有临时编辑时保留场景。成功后 `ready` 变为 `false`，场景会话清理完成，再调用 `onSceneClosed({projectId})`。切换场景时，等关闭完成后为新的宿主快照挂载新的 `SceneEditor`。若宿主直接卸载编辑器，可以先等待 `flushState()`，卸载后再调用 `resetCameraStudio()` 以载入另一份快照。
- **导出。** `onSaveExport` 收到 `kind`、`blob`、`fileName`、`mimeType` 和渲染元数据。图片是当前镜头在播放头位置的 PNG。视频使用编码器实际生成的 MP4 或 WebM，并携带帧率和时长。回调可返回 Promise，失败经 `onError` 报告。省略回调时，图片直接下载，视频仍提供浏览器保存选项。
- **语言。** `ui.locale` 设置初始语言。内置简体中文 `zh-CN`、英语 `en`、日语 `ja`、韩语 `ko`、俄语 `ru`、德语 `de`、西班牙语 `es`、巴西葡萄牙语 `pt` 和法语 `fr`。`ja-JP`、`ko-KR`、`pt-BR` 等地区代码会匹配对应的基础语言词典。场景挂载后，调用 `setCameraStudioLocale('ja')` 即时更新视口和 Studio 面板，同时保留浏览器中的用户语言偏好。

### 单机桌面接入

在桌面 WebView 的渲染进程中调用 `mountCameraStudioDesktop`。宿主用自己的
IPC 传递打开场景、退出和语言切换指令，并处理持久化。编辑器只使用页内 JS API，
HTTP 和 WebSocket 可由宿主按需提供。

```ts
import {mountCameraStudioDesktop} from '@dreamerbird/camera-studio'

const editor = mountCameraStudioDesktop(container, {
  saveScene: (scene) => ipc.saveScene(scene),
  saveExport: (output) => ipc.saveExport(output),
  sceneClosed: (scene) => ipc.sceneClosed(scene),
})

await editor.openScene(await ipc.loadScene())
editor.setLocale('en')
await editor.closeScene()
```

- **加载。** `openScene({projectId, initialState})` 等待编辑器就绪。省略 `initialState` 可建空白场景。打开另一场景前先等待 `closeScene()` 完成。`editor.api` 提供页内命令接口，宿主可经自己的 IPC 包装需要的命令。
- **保存和退出。** `saveScene({projectId, state})` 接收编辑提交。关闭时先等待保存和会话清理，再向宿主调用 `sceneClosed({projectId})`。应用退出前调用 `dispose()`。保存失败时场景保留，可重试。
- **图片和视频。** 工具栏导出会调用 `saveExport({projectId, kind, fileName, mimeType, data})`。`data` 是 `ArrayBuffer`，适合传给本机主进程。若宿主通过 `editor.api.exports` 发起导出，可从 `editor.api.jobs.get()` 读取成品，再调用 `editor.saveExport({kind, ...result})` 走同一保存通道。
- **语言。** `setLocale('zh-CN')` 或 `setLocale('en')` 在当前场景即时生效，后续打开的场景也会沿用该语言。

仓库中的 Electron 示例通过 preload 暴露专用 IPC 方法。渲染器、资产和 `/draco/` 解码器由本机 `app://` 协议载入。主进程把场景快照保存到应用数据目录下的 `camera-studio-desktop/scene.json`，导出则由系统保存对话框选择位置。 [Electron IPC 文档](https://www.electronjs.org/docs/latest/tutorial/ipc) · [Electron 本地协议文档](https://www.electronjs.org/docs/latest/api/protocol)

```bash
pnpm --filter camera-host-demo build
pnpm dlx --allow-build=electron electron@41 ./examples/camera-host-demo/desktop/main.cjs
```

启动后自动打开本地场景。可从系统菜单关闭或重新打开场景、切换语言，也可使用编辑器工具栏导出图片和视频。

### 自定义工作台主题

`ui.theme` 接受颜色、字体和圆角等 CSS 值。每个字段都可选，缺省时显示原有深色界面。

```tsx
const {ready, sceneProps} = useCameraStudio({
  ui: {
    theme: {
      surface: '#202633',
      raisedSurface: '#2a3444',
      recessedSurface: '#171d28',
      border: '#495a74',
      text: '#f0f4ff',
      accent: '#85e5cf',
      fontFamily: 'Inter, system-ui, sans-serif',
      radius: '10px',
    },
  },
})

return ready ? <CameraScene {...sceneProps} /> : null
```

工具栏、Studio 面板和浮层共享这些主题值。`CameraStudioTheme` 类型由
`@dreamerbird/camera-studio` 导出。传 CSS 变量也是有效的，例如
`accent: 'var(--brand-accent)'`，宿主可在页面根元素更新该变量来切换配色。
`ui.theme` 本身与其他 `ui` 配置一样，在初始化时读取。

Tailwind 样式随模块预编译发布，宿主无需额外安装 Tailwind 或导入样式。
修改模块内的样式源文件后，在仓库内运行
`pnpm --filter @dreamerbird/camera-studio build:styles` 更新编译结果。

### 错误提示:onError 交给宿主组件

模块不内置错误条;运行期可展示错误统一转成 `CameraStudioError`,经 `onError` 交给
你自己的提示组件:

```tsx
import {useState} from 'react'
import {
  useCameraStudio,
  CameraScene,
  type CameraStudioError,
} from '@dreamerbird/camera-studio'

function CameraPage() {
  const [notice, setNotice] = useState<CameraStudioError | null>(null)
  const {ready, error, sceneProps} = useCameraStudio({
    project: 'Space',
    onError: setNotice,
  })

  if (error) return <YourErrorPage error={error} /> // 初始化失败
  if (!ready) return null
  return (
    <>
      {notice && (
        <YourToast role="alert" onClose={() => setNotice(null)}>
          {notice.message}
        </YourToast>
      )}
      <CameraScene {...sceneProps} />
    </>
  )
}
```

`CameraStudioError` 形状:`{source, code, message, cause?}`。`source: 'library'`
= 库存储与启动清理错误,`code` 沿用 `LibraryError` 六码(`auth` / `quota` /
`network` / `conflict` / `not-found` / `unknown`)。`source: 'export'` 表示视频导
出失败， `source: 'state'` 表示场景保存失败，两者的 `code` 均为 `unknown`。省略
`onError` 时，场景保存失败会写入控制台，视频导出失败通过浏览器 `alert` 展示。初
始化错误从 hook 的 `error` 返回。

## 3. 存储:实现 WritableLibrarySource

模型/姿势/动画数据完全由你提供的存储承担。接口与条目类型全部从包根导出
(`LibrarySource`、`WritableLibrarySource`、`LibrarySourceCapabilities`、
`LibraryEntry`、`ModelEntry`、`PoseEntry`、`AnimationEntry`、`EntryKind`、
`RigId`、`RigAlias`、`LibraryError`、`LibraryErrorCode`、`isWritableSource`), 直
接 `import type {...} from '@dreamerbird/camera-studio'` 即可;接口形状(照包内定
义逐字):

```ts
// 统一数据源(读)
interface LibrarySource {
  readonly id: string
  listEntries(kind?: 'model' | 'pose' | 'animation'): Promise<LibraryEntry[]>
  getEntry(id: string): Promise<LibraryEntry | undefined>
  /** 每个源自己解析自己的 blob:静态源→CDN 地址,HTTP 源→预签名,IDB→blob: */
  getBlobUrl(blobId: string): Promise<string>
  capabilities?: {
    writable?: boolean // 可写源必须 true
    permanentUrls?: boolean // URL 长效才允许跨挂载缓存
    maxUploadBytes?: number // 导入前先校验先提示
  }
  /** 远端变更推送(可选,v1 不强制) */
  subscribe?(fn: () => void): () => void
}

// 可写源 = 用户库(宿主生产存储 / 内置 IDB)
interface WritableLibrarySource extends LibrarySource {
  putEntry(entry: LibraryEntry): Promise<void>
  deleteEntry(id: string): Promise<void>
  putBlob(
    data: Blob,
    opts?: {onProgress?: (ratio: number) => void; signal?: AbortSignal},
  ): Promise<string>
  deleteBlob(blobId: string): Promise<void>
  getRigAliases(): Promise<RigAlias[]>
  putRigAlias(alias: RigAlias): Promise<void>
  /** 孤儿清扫用;不实现则跳过清扫 */
  listBlobIds?(): Promise<string[]>
}
```

实现时必须满足的语义。标注【契约覆盖】的两条由契约套件逐条自检(§3 末尾的
`runLibrarySourceContractTests`);其余三条当前套件未覆盖,靠实现约定——想自验的话,
照契约套件的写法在自己仓库里补用例即可。

- **upsert**【契约覆盖】:`putEntry` 同 id 是覆盖,不是报错;`getEntry`(不存在)返回
  `undefined`,不抛。
- **内容寻址**【契约覆盖】:`putBlob` 返回内容哈希 id,**同内容两次返回同一 id**
  (这是去重和孤儿清扫的前提;生产请用 SHA-256)。
- **错误码**(契约未覆盖):抛 `LibraryError`(code ∈ `auth` / `quota` / `network` /
  `conflict` / `not-found` / `unknown`),不要把业务错误混成 `unknown`。透出现
  状:Library 聚合错误经配置的顶层 `onError` 转成 `CameraStudioError`(source =
  `library`)上告,宿主用自己的提示组件渲染(见 §2);不传 `onError` 则保持库层原有静
  默/console 语义。
- **id 命名空间**(契约未覆盖):你的源**不得**返回 `seed-pose-*` / `seed-model-*`
  前缀条目(内置目录专属,聚合层会拒绝并报 conflict)。源 id 同样占用命名空
  间:`catalog`(内置目录)与 `idb`(内置 IndexedDB)是保留名,宿主源自定义id 勿用——撞
  名会上告 conflict 且以先注册者胜,blobId 前缀路由可能走错源。
- **capabilities**(契约未覆盖):写上 `writable: true` 是契约的一部分(供
  capabilities查询与自描述);模块以 `putEntry` 方法存在性判别可写源,不读这个
  flag。 `permanentUrls` 是预留 capability,当前模块未据此改变行为,标不标无实际差
  异。

### 完整示例：内存版可写存储

```ts
// src/memorySource.ts —— 演示/测试用;生产换你的 HTTP 实现
// 条目/别名类型全部由包根导出,直接 import;WritableLibrarySource 接口
// 形状见上文,TS 结构化校验会在 storage: 传参与契约套件注册处兜底。
import type {
  EntryKind,
  LibraryEntry,
  RigAlias,
} from '@dreamerbird/camera-studio'

/** FNV-1a 64 位:非加密,只做内容寻址(与包内 hashBytes 同算法) */
function fnv1a64(data: Uint8Array): string {
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < data.length; i++) {
    h ^= BigInt(data[i])
    h = (h * prime) & mask
  }
  return h.toString(16).padStart(16, '0')
}

export class MemorySource {
  readonly id = 'memory'
  readonly capabilities = {writable: true} as const

  private entries = new Map<string, LibraryEntry>()
  private blobs = new Map<string, Blob>()
  private urls = new Map<string, string>()
  private aliases = new Map<string, RigAlias>()

  async listEntries(kind?: EntryKind): Promise<LibraryEntry[]> {
    const all = [...this.entries.values()]
    return kind ? all.filter((e) => e.kind === kind) : all
  }

  async getEntry(id: string): Promise<LibraryEntry | undefined> {
    return this.entries.get(id)
  }

  async putEntry(entry: LibraryEntry): Promise<void> {
    this.entries.set(entry.id, entry)
  }

  async deleteEntry(id: string): Promise<void> {
    this.entries.delete(id)
  }

  async putBlob(
    data: Blob,
    opts?: {onProgress?: (ratio: number) => void; signal?: AbortSignal},
  ): Promise<string> {
    const id = fnv1a64(new Uint8Array(await data.arrayBuffer()))
    this.blobs.set(id, data)
    opts?.onProgress?.(1) // 内存写入瞬时完成,进度语义上直接报满
    return id
  }

  async getBlobUrl(blobId: string): Promise<string> {
    const cached = this.urls.get(blobId)
    if (cached) return cached
    const blob = this.blobs.get(blobId)
    if (!blob) throw new Error(`blob 不存在: ${blobId}`)
    const url = URL.createObjectURL(blob)
    this.urls.set(blobId, url)
    return url
  }

  async deleteBlob(blobId: string): Promise<void> {
    const url = this.urls.get(blobId)
    if (url) URL.revokeObjectURL(url)
    this.urls.delete(blobId)
    this.blobs.delete(blobId)
  }

  async getRigAliases(): Promise<RigAlias[]> {
    return [...this.aliases.values()]
  }

  async putRigAlias(alias: RigAlias): Promise<void> {
    this.aliases.set(alias.rig, alias)
  }

  async listBlobIds(): Promise<string[]> {
    return [...this.blobs.keys()]
  }
}
```

内存版刻意省略了跨会话持久化(刷新即失)与去重存储(同 id 覆盖写)——对演示可接
受,**生产 HTTP 实现不要学这两样**;「同内容同 id」的寻址契约必须保留。

### 先用契约套件自检,再上线

包导出了对 `WritableLibrarySource` 的契约测试套件。你的实现先跑通它:

```ts
// src/memorySource.test.ts —— jest 下直接跑;内存源无 IndexedDB 依赖。
// 真 IDB 实现的宿主:用 fake-indexeddb 垫一个环境,或在浏览器/Playwright 里跑。
import {runLibrarySourceContractTests} from '@dreamerbird/camera-studio/contract-tests'
import {MemorySource} from './memorySource'

runLibrarySourceContractTests(async () => {
  // 每个用例拿全新空实例;有清理需求就返回 cleanup
  return {source: new MemorySource()}
})
```

```bash
npx jest memorySource
# 预期:条目 round-trip / 不存在返回 undefined / upsert 覆盖 /
#       blob 内容寻址(同内容两次同 id)/ 骨架别名 round-trip 全绿
```

## 4. 内置资产上架到自有 CDN

包自带内置目录(**一个标准人体模型 Y Bot** + 手势姿势预览图),缺省从**包内
`assets/`** 加载。包内模型只承担开箱可用的人体骨架基线;业务模型一律由宿主存储
(§3)提供,不随包附带。生产建议把内置目录拷到你自己的 CDN:

```
assets/
├── models/       # Y Bot.glb(清单里 models[].file)
└── poseThumbs/   # 110 张姿势预览图(清单里 poseThumbs[].file)
```

要拷哪些文件,以包内的入库清单 `seedAssetsManifest` 为唯一事实源
(`dist/assetLibrary/seedAssetsManifest.js`,纯数据):

```bash
# 从 node_modules(或 monorepo 的 packages/camera-studio/assets)整目录拷走
cp -r node_modules/@dreamerbird/camera-studio/assets/models     ./camera-assets/
cp -r node_modules/@dreamerbird/camera-studio/assets/poseThumbs ./camera-assets/
# 然后把 camera-assets/ 传到你 CDN 的 camera-assets/ 前缀下
```

配置 `assets.baseUrl` 指过去(**以 / 结尾**,模块也会自动补):

```tsx
useCameraStudio({
  project: 'Space',
  assets: {baseUrl: 'https://cdn.example.com/camera-assets/'},
})
```

URL 拼装规则:`baseUrl + 'models/<file>'`、`baseUrl + 'poseThumbs/<file>'` (纯拼
接,模块不探测;404 的表象见 §8)。

### 直接用内置静态姿势数据(不启动 Studio)

内置目录同时带 **180 个静态姿势**(12 个基础姿势 + 58 个 DPL 全身姿势 + 110 个
QBX 手势),id 稳定为 `seed-pose-*`,骨架族是内置 Y Bot 的 Mixamo rig。引用本包的项
目可以直接从 `@dreamerbird/camera-studio/poses` 取数据, 不依赖 IndexedDB、网络或
React。直接使用 `applyPose` 时，目标骨架的骨名和局部坐标系需与 Y Bot 对应。编辑
器通过内置姿势 ID 应用全身姿势时，会将髋骨旋转换到目标骨架的父坐标系。

```ts
import {
  BUILTIN_POSE_RIG,
  applyPose,
  getBuiltinPose,
  listBuiltinPoses,
} from '@dreamerbird/camera-studio/poses'

const poses = listBuiltinPoses() // PoseEntry[]
const relaxed = getBuiltinPose('seed-pose-stand-relaxed')!

const {applied, missed} = applyPose(myModelRoot, relaxed.bones)
```

- 条目格式:`{id, kind: 'pose', name, rig, bones, createdAt}`;`bones` 是
  `骨骼名 → {rotation?: [x,y,z,w], position?: [x,y,z]}`。
- 手势条目(QBX)只有手指骨,是叠加片段;应用时要保留身体姿势。
- 想在编辑器内使用,仍走 Agent API:`assets.list({kind: 'pose'})` 取 `assetId`,再
  `poses.apply({objectId, assetId})`(见 §9)。

## 5. 场景状态接管

传入 `state` 后，编辑器从宿主提供的 `initialState` 打开项目，场景编辑通过
`onStateChange` 保存。Studio 在内存中运行撤销和重做。网络应用可以在挂载前通过
`loadSceneSyncState` 加载远端项目。

```tsx
import {
  HttpPatchAdapter,
  loadSceneSyncState,
  useCameraStudio,
} from '@dreamerbird/camera-studio'

// 在宿主路由的数据加载阶段为当前项目执行。
const state = await loadSceneSyncState(new HttpPatchAdapter(sceneUrl), {
  throttleMs: 0,
})

// 在数据加载完成后挂载的编辑器组件内调用。
const {ready, error, sceneProps} = useCameraStudio({
  project: projectId,
  state,
})
```

- 自有存储也可直接提供 `initialState` 和 `onStateChange`，或实现
  `SceneSyncAdapter` 的 `load()`、`commit()` 和可选的 `commitPatch()`。
- `initialState` 经 `getProject(projectId, {state})` 传入。传 `IProject` 实例
  时，由创建方提供初始状态。
- 只保存已提交的编辑。`throttleMs` 默认是 1000 毫秒，设为 `0` 会在每次提交后立即
  排队。保存请求串行执行，等待期间合并为最新快照。
- 保存失败会上报 `onError`，其 `source` 为 `state`。最新待保存状态保留在当前会话
  内，可用 `await flushState()` 重试。需要在离开路由前确认保存时，先等待
  `flushState()` 成功。
- `loadSceneSyncState()` 返回的 `hasUnsavedChanges()` 跟踪进入保存通道后的编辑
  （排队、在途或失败待重试）。远端重载前应先调用 `flushState()` 处理编辑器节流队列，
  并通过 `hasTemporaryChanges()` 检查拖拽中的临时事务。
- 由模块初始化 Studio 时会自动关闭浏览器持久化。宿主自行初始化时需使用
  `theatre.init({studio: true, usePersistentStorage: false})`。宿主管理状态时关
  闭 `sync`，以便场景由同一个来源管理。
- 宿主可通过 `storage: WritableLibrarySource` 接管可写资产库，通过
  `assets.projectStorage` 接管场景直接引用的文件。上传接口应在远端文件可读取后返
  回资产 ID。接管场景状态且省略 `storage` 时，资产库只提供内置目录。独立使用时默
  认资产库使用 IndexedDB。

### HTTP 快照与增量协议

配套示例 `camera-host-demo` 内置同源的 `/api/scene`。在仓库根目录运行以下命令即
可启用。

```sh
VITE_CAMERA_STUDIO_STATE_URL=/api/scene pnpm --filter camera-host-demo dev
```

示例把快照、版本和幂等记录一并保存在 `~/.camera-host-demo/scene.json`，重启后继
续读取。可以用 `CAMERA_HOST_DEMO_STATE_FILE` 指定其他文件，每个文件由一个示例服
务进程管理。内置接口使用 `HttpPatchAdapter`。也可以把
`VITE_CAMERA_STUDIO_STATE_URL` 指向宿主的全量接口，示例会使用 `HttpSnapshotAdapter`。

| 操作     | 请求                                         | 响应                                                                          |
| -------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| 打开场景 | `GET`                                        | `200`、场景 JSON 和强 `ETag`，例如 `"17"`。场景尚未创建时返回 `404`。         |
| 创建场景 | `PUT`、`If-None-Match: *`、`Idempotency-Key` | 成功返回 `2xx` 和此次提交的强 `ETag`。场景已存在时返回 `412`。                |
| 全量更新 | `PUT`、`If-Match`、`Idempotency-Key`         | 成功返回 `2xx` 和此次提交的强 `ETag`。版本不匹配返回 `412`，可附当前 `ETag`。 |
| 增量更新 | `PATCH`、`If-Match`、`Idempotency-Key`、`Content-Type: application/json-patch+json` | 版本条件和响应同全量更新。向当前快照应用 JSON Patch。 |

`HttpPatchAdapter` 用 `GET` 加载完整快照，首次创建用 `PUT`，后续保存仅发送相对
最近已确认快照的 JSON Patch（`add`、`remove`、`replace`）。空补丁不发请求。
数组长度改变时替换该数组，等长数组可按索引更新。远端版本通知触发重载时仍用
`GET`。现有只实现 `PUT` 的宿主可以继续使用 `HttpSnapshotAdapter`。

服务端应原子地校验版本、保存场景并记录提交结果。对于同一项目中已成功的
`Idempotency-Key`，在检查版本条件前先核对重试的请求内容和基准版本，再返回原提交
的版本。每次成功的新提交都应获得新的版本。`loadSceneSyncState` 会用原提交 ID 重
试结果未确认的请求。

示例接口在缺少版本条件时返回 `428`。重复使用提交 ID 且请求内容或基准版本不同则返
回 `409`。

跨域部署时，在 CORS 配置中暴露响应头 `ETag`，并允许 `PUT`、`PATCH` 及请求头
`Content-Type`、`If-Match`、`If-None-Match`、`Idempotency-Key`。

版本冲突通过 `onError` 上报 `SceneRevisionConflictError`（`cause`）。待保存编辑
留在当前会话，宿主可据此提示用户处理冲突。

自定义 `SceneSyncAdapter` 时，`load()` 在场景尚未创建时返回 `null`，`commit()`
和 `commitPatch()` 在远端保存成功后返回新版本。适配器可用 `SceneCommitRejectedError` 表示服务端已明
确拒绝提交，版本冲突使用其子类 `SceneRevisionConflictError`。

示例启用内置接口时，也通过 `SceneSyncAdapter.subscribe` 连接同源 WebSocket
`/api/scene/revisions`。保存继续走 HTTP。新快照写入成功后，服务端发送包含 ETag
的通知，格式为 `{revision, clientId?}`。`clientId` 来自保存请求的
`X-Scene-Client-Id`，用于识别本标签页的提交。幂等重试和拒绝的提交均不会广播。

连接建立时，服务端会发送当前已保存版本，便于检查断线期间是否有更新。其他标签页保
存后，示例会先 flush 本页尾部保存，再判断是否有未保存编辑：空闲页自动通过 HTTP
重新加载最新快照并重建场景，顶栏短暂显示「场景已更新」；有未保存编辑（提交在途/
失败，或拖拽中的临时事务）时只显示「场景有新版本，当前编辑未保存，未自动覆盖」，
不替换当前场景。宿主也可以用自己的 WebSocket 或 SSE 实现 `subscribe`。

#### 接入已有场景服务

对于 DreamLoom 这类按场景保存快照和整数 `revision` 的宿主，可在现有接口上增加
`PATCH`，并将版本作为强 ETag 返回（例如 `"17"`）。写入时在同一数据库事务内，
按场景检查幂等记录和基准版本、应用补丁、校验完整场景，再用版本条件更新快照和
`revision`，一并写入幂等记录。通知在事务成功后发送。读取权限和写入权限由宿主
校验。前端在挂载前调用 `loadSceneSyncState(new HttpPatchAdapter(sceneUrl))`，
用返回值作为 `useCameraStudio` 的 `state`，并设置 `sync: false`。已有保存状态和
冲突提示可通过 `flushState()` 和 `onError` 接线。

## 6. 协作

**模块只含客户端**。`sync: {serverUrl}` 经 theatre.init 透传给 studio 的
SyncStore,由它连你的服务端:

```tsx
useCameraStudio({
  project: 'Space',
  sync: {serverUrl: 'ws://localhost:3000'}, // 缺省 false = 关
})
```

**断线是软失败**:serverUrl 不可达时页面照常可用(本地编辑不受影响), console 会有
重连警告——这是预期行为,不是接入错误。

### 服务端配方(参考实现)

客户端协议是 **tRPC-over-WebSocket**,不建议用非 tRPC 重写。服务端 =
`@dreamerbird/saaz` + `@trpc/server` 的 WS 适配器,照 `packages/sync-server/src`
抄。六个路由:

| 路由                                | 类型         | 作用           |
| ----------------------------------- | ------------ | -------------- |
| `saaz_applyUpdates`                 | mutation     | 应用文档增量   |
| `saaz_updatePresence`               | mutation     | 更新在线状态   |
| `saaz_closePeer`                    | mutation     | 关闭 peer      |
| `saaz_getUpdatesSinceClock`         | query        | 按时钟拉增量   |
| `saaz_getLastIncorporatedPeerClock` | query        | 查询 peer 时钟 |
| `saaz_subscribe`                    | subscription | 订阅变更推送   |

```ts
// server.ts —— 精简骨架,与 packages/sync-server/src 同构
// npm i @dreamerbird/saaz @trpc/server ws zod superjson
import http from 'http'
import {WebSocketServer} from 'ws'
import {applyWSSHandler} from '@trpc/server/adapters/ws'
import {initTRPC} from '@trpc/server'
import {observable} from '@trpc/server/observable'
import {z} from 'zod'
import superjson from 'superjson'
import {SaazBack, BackMemoryAdapter} from '@dreamerbird/saaz'
import {schema} from './schema' // 整文件照抄 packages/sync-server/src/state/schema.ts

const t = initTRPC.create({transformer: superjson})
const studioAuth = z.object({accessToken: z.string()}).optional()
const dbInput = z.object({dbName: z.string(), opts: z.any(), studioAuth})
const peerInput = z.object({
  dbName: z.string(),
  opts: z.object({peerId: z.string()}),
  studioAuth,
})

const backs: Record<string, SaazBack> = {}
function getSaazBack(dbName: string): SaazBack {
  // BackMemoryAdapter 重启即清;生产换持久化 adapter(Saaz 还有 BackIDBAdapter 可参)
  return (backs[dbName] ??= new SaazBack({
    dbName,
    schema,
    storageAdapter: new BackMemoryAdapter(),
  }))
}

const projectState = t.router({
  saaz_applyUpdates: t.procedure
    .input(dbInput)
    .mutation(({input}) => getSaazBack(input.dbName).applyUpdates(input.opts)),
  saaz_updatePresence: t.procedure
    .input(dbInput)
    .mutation(({input}) =>
      getSaazBack(input.dbName).updatePresence(input.opts),
    ),
  saaz_closePeer: t.procedure
    .input(peerInput)
    .mutation(({input}) => getSaazBack(input.dbName).closePeer(input.opts)),
  saaz_getUpdatesSinceClock: t.procedure
    .input(dbInput)
    .query(({input}) =>
      getSaazBack(input.dbName).getUpdatesSinceClock(input.opts),
    ),
  saaz_getLastIncorporatedPeerClock: t.procedure
    .input(peerInput)
    .query(({input}) =>
      getSaazBack(input.dbName).getLastIncorporatedPeerClock(input.opts),
    ),
  saaz_subscribe: t.procedure.input(dbInput).subscription(({input}) =>
    observable<unknown>((emit) => {
      const p = getSaazBack(input.dbName).subscribe(input.opts, (s) =>
        emit.next(s),
      )
      return () => void p.then((unsub) => unsub())
    }),
  ),
})

const appRouter = t.router({projectState})

const server = http.createServer((_req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'})
  res.end('sync server')
})
const wss = new WebSocketServer({server})
const handler = applyWSSHandler({
  wss,
  router: appRouter,
  createContext: () => Promise.resolve({}),
})
server.listen(3000, () => console.log('sync server: ws://localhost:3000'))
process.on('SIGTERM', () => {
  handler.broadcastReconnectNotification()
  wss.close()
  server.close()
})
```

两点边界:

- **验权**:上面骨架是直通版(等于参考实现的 `AUTH_DISABLED=true` 模式)。生产把
  `studioAuth` 换成你的会话验权(参考实现里 `ctx.requireValidSession` 的位置)。
- **资产库不过 sync**:sync 只同步场景文档增量 + presence;模型/姿势数据的一致性
  是**存储服务**的职责(§3 的统一数据源天然解决「A 导入的模型 B 看不
  见」)。monorepo 里联调可直接跑现成服务:`pnpm sync-server`。

## 7. 约束(接入前必读)

- **单页单实例**。根源在 studio 全局单例(页级覆盖层 + 进程级实例):同页第二个
  `useCameraStudio` 不占位、直接 `error`(错误信息写明原因)。需要多场景就走路由切
  换,挂载即初始化、卸载即清理,重挂幂等。
- **嵌入单位 = 整页/整路由**。studio 覆盖层 `position: fixed` 铺满视口 (挂
  document.body,shadow DOM),「嵌进页面局部区域」不是支持形态——局部容器装不下编辑
  器的面板体系。
- **z-index 层级地图**(宿主自己的全局浮层请避开这几档;按代码实测):

  | 层         | 谁                                  | 能否调             |
  | ---------- | ----------------------------------- | ------------------ |
  | 100        | studio 覆盖层(大纲/属性面板/时间轴) | 否(studio 体系)    |
  | 1000(基准) | 模块停靠框(模型库/姿势库等)         | 能:`ui.zIndexBase` |
  | 15         | 姿势模式条(画布内横条)              | 否(模块内部体系)   |
  | 10         | 模块顶栏                            | 否(模块内部体系)   |

  注意:顶栏与姿势模式条本体都在 studio 覆盖层(100)**之下**,并非盖在studio 之上;
  它俩按钮的 tooltip 气泡用 10000——那仅是气泡自身的层级, 不代表这两条栏。宿主全
  局浮层建议用 10 以下的档(如顶栏 5);要盖过编辑器全貌属于特例,自行评估与上面几档
  的相对关系。

- **i18n 嵌套**:宿主树已包 studio 的 `I18nProvider`
  (`@dreamerbird/studio/i18n`)→ 模块检测后原样渲染,**语言以宿主为准**,
  `ui.locale` 不生效;宿主没包 → 模块自包一层并应用 `ui.locale`。两种方式均可用
  `setCameraStudioLocale()` 更新共享词典语言。模块词条 key 一律 `pg.` 前
  缀;`registerMessages` 是合并语义,宿主可后注册**覆盖同名 key** 做品牌定制:

  ```ts
  import {registerMessages} from '@dreamerbird/studio/i18n'
  registerMessages('zh-CN', {'pg.toolbar.addModel': '添加角色'})
  ```

- **config 首帧锁定**。`useCameraStudio` 在首帧读取配置。宿主可通过 `closeScene()`
  关闭宿主管理的场景并释放启动配置，再以新的场景 ID 和快照挂载编辑器。普通卸载后，
  模块复用首次启动配置。如需更换配置，可在所有消费者卸载后调用 `resetCameraStudio()`。

## 8. 排错

- **导入/保存姿势/删除入口整个消失了?** 先看 `storage`:只有 `storage: false` 会
  进入**纯查看器模式**(模块内即「无可写源」状态),这些入口是**整体隐藏**(不是置
  灰)——预期行为。完全省略 `storage` 走的是内置 IndexedDB 可写源,入口都在。
- **保存/导出错想进自己的提示组件?** 配顶层 `onError`:库存储与启动清理错误
  (`source: 'library'`)带 `LibraryError` 六码,视频导出错误(`source: 'export'`)
  当前为 `unknown`;`message` 可直接展示。不传时保持旧行为——库存储按原路径静默或
  console 留痕,导出用浏览器 `alert`。
- **`seed-*` id 前缀的条目写不进/读不出?** `seed-pose-*` / `seed-model-*` 是内置
  目录专属前缀,可写源返回它们会被聚合层拒绝(conflict)。旧浏览器里历史播种留下的
  `seed-*` 条目,模块启动时会静默清理一次(仅内置 IDB缺省库名分支)。
- **baseUrl 404 的表象**:模型库卡片空白、预览图裂,网络面板里 `models/...` 或
  `poseThumbs/...` 404。多数是 CDN 拷贝不全(少了 `models/`、`poseThumbs/` 子目
  录)或路径段拼错;模块是**纯拼接、不探测** 的,配错不会启动期报错,只在使用时显
  形。
- **导入 Draco 压缩的 GLB 卡住,网络面板 `/draco/draco_wasm_wrapper.js` 404**: 解
  码器 wasm 按页面 origin 的 `/draco/` 路径加载,宿主必须把解码器文件伺服在该路径
  下(5 个文件:3 个来自 `three/examples/jsm/libs/draco/gltf/`,2 个
  `_gltf.wasm`/encoder 来自 `draco3dgltf` 包;现成的一份在
  `examples/camera-host-demo/public/draco/`——Vite 宿主放 `public/draco/` 即可,
  构建会原样拷贝)。未压缩的 GLB 不触发该加载,所以问题只在导入压缩模型时显形。
- **旧浏览器出现两个 Y Bot?** 2026-10-10 前用过旧版(播种制)的浏览器, 模型库可能
  同时有「旧播种 Y Bot」和「内置目录 Y Bot」。这是刻意保留: 旧播种是浏览器内
  FBX→GLB 转换的非确定性产物,内容哈希与出货文件不同, 内容寻址下视为另一份资产;旧
  场景对它的引用不受影响,两边都能用。新用户只见目录里的一个。无需处理。
- **想直接组合内置 IndexedDB 实现?** `IndexedDBBackend` 类同样从包根导出
  (`new IndexedDBBackend({dbName})`),与 `storage: {namespace}` 简写用的是同一实
  现;存储类型族(`WritableLibrarySource`、`LibraryEntry`、`LibraryError` 等) 全部
  从包根导出,`@dreamerbird/camera-studio/contract-tests` 子路径导出稳定。

## 9. Agent JS API(浏览器命令面)

除了编辑器 UI,模块还暴露一个稳定的浏览器 JS 命令面,供页内自动化与 Agent 驱动场
景:18 个命名空间、71 条命令
(`scene / objects / models / assets / poses / animations / cameras / anchors / paths / sequence / keyframes / history / view / ui / project / exports / jobs`)。

```ts
const {ready, sceneProps, api} = useCameraStudio({project: 'Space'})
// ...
await api.ready
const snapshot = await api.scene.getSnapshot()
await api.objects.update({
  objectId: 'model:Y Bot',
  props: {position: {x: 2, y: 0, z: -1}},
  expectedRevision: snapshot.revision,
})
```

要点速记(细节、完整签名与错误码见
[Agent JS API 专项指南](./camera-studio-agent-js-api.md)):

- `api` 是模块级单例,hook 首帧即返回同一对象;`api.ready` 在 project + studio +
  Scene Runtime 就位后兑现,命令调用也会自动等它。
- `objects.update` 只写静态属性(已建轨报 `INVALID_STATE`);做动画显式走
  `keyframes.set`。
- 项目写命令可选 `expectedRevision` 乐观并发,冲突返回 `REVISION_CONFLICT` 且不执
  行写入。
- `models.create` / `cameras.create` / `anchors.create` 等到对象**挂载完成**才返
  回; `assets.importModel` / `exports.startVideo` 返回任务句柄,用 `jobs.get` 轮
  询、 `jobs.cancel` 取消。
- 资产操作不可 undo;`history.undo`/`redo` 只管 Theatre 项目状态。
- 默认不挂 window 全局;`agent: {exposeGlobal: true}` 时场景 ready 后挂载
  `window.__cameraStudioApi`,dispose 时删除。
- 外部进程(宿主导航之外的 Agent)走本机 HTTP 桥接:`agent.bridge` 给出桥接的WS 命
  令通道地址(`url`)、Bearer token 与文件传输地址(`httpUrl`),页面才会连接;桥接进
  程的启动、鉴权、CORS、文件与任务语义见
  [Agent HTTP 桥接部署指南](./camera-studio-agent-http.md)。
