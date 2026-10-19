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

`useCameraStudio(config)` 返回 `{ready, error, sceneProps, api}`;`sceneProps` 对
宿主 **不透明**(当前 = `{project, onFlows, onError}` 的转发),不要解构它。`api`
是Agent JS 命令面门面的模块级单例(首帧即稳定),页内自动化/Agent 场景见§9
与[专项指南](./camera-studio-agent-js-api.md)。

### config 全字段参考

| 字段                 | 类型                                                     | 缺省            | 说明                                                                                                 |
| -------------------- | -------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `project`            | `string \| IProject`                                     | `'Space'`       | 场景 id 字符串(getProject),或宿主自建的 IProject 实例(传实例时 `state.initialState` 被忽略)          |
| `state`              | `{initialState?, onStateChange?, throttleMs?}`           | 不传            | 传了 = **宿主接管场景状态**,同时关掉 theatre 本地持久化(见 §5)                                       |
| `onError`            | `(error: CameraStudioError) => void`                     | 不传            | 库存储/启动清理/视频导出错误上告给宿主提示组件(见下节)                                               |
| `storage`            | `WritableLibrarySource \| {namespace?: string} \| false` | 内置 IndexedDB  | 可写源实例 / 「namespace」简写(库名 `toybox-asset-library[-namespace]`)/ `false` 纯查看器(见 §3、§8) |
| `assets.baseUrl`     | `string`                                                 | 包内 `assets/`  | 内置目录文件根(见 §4)                                                                                |
| `sync`               | `{serverUrl?: string} \| false`                          | `false`         | 协作端点(见 §6)                                                                                      |
| `ui.portalContainer` | `HTMLElement`                                            | `document.body` | 模块停靠框的 portal 挂载点                                                                           |
| `ui.zIndexBase`      | `number`                                                 | `1000`          | 模块停靠框 z-index 基准(见 §7 层级地图)                                                              |
| `ui.locale`          | `string`                                                 | 不生效          | 仅当宿主**未**包 I18nProvider 时应用,一次性 setLanguage(见 §7)                                       |
| `ui.hideLeftStrip`   | `boolean`                                                | `false`         | 隐藏 studio 左上角带 logo 的整条 LeftStrip(应用 logo + 工作区按钮);boot 级一次性应用,换值需整页刷新  |
| `flows.onFlows`      | `(flows: CameraFlows) => void`                           | 不传            | 接管「添加模型/添加路径/添加相机」入口,拿到模块的 flows 句柄                                         |
| `agent.exposeGlobal` | `boolean`                                                | `false`         | 场景 ready 后把 Agent JS API 门面挂到 `window.__cameraStudioApi`,dispose 时删除(见 §9)               |
| `agent.bridge`       | `{url, token, httpUrl}`                                  | 不传            | 连接本机 Agent HTTP 桥接(`url` 是 WS 命令通道,`httpUrl` 走文件传输);缺省不连桥接(见 §9)              |

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
`network` / `conflict` / `not-found` / `unknown`);`source: 'export'` = 视频导出
错误,当前 `code` 为 `unknown`。不传 `onError` 时保持旧行为:库错误按原路径静默或
console 留痕,视频导出错误用浏览器 `alert`。初始化失败不走 `onError`,仍从 hook 的
`error` 返回。

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

### 完整示例:内存版可写存储(与 examples/camera-host-demo 逐字一致)

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

## 5. 场景状态接管

传了 `state` 字段 = 宿主接管场景状态持久化,模块初始化 theatre 时自动带
`usePersistentStorage: false`(两者联动,不用你手动管):

```tsx
const {ready, error, sceneProps} = useCameraStudio({
  project: 'Space',
  state: {
    initialState: savedState ?? undefined, // 打开时回放(JSON 或 undefined)
    onStateChange: (content) => {
      // 已按 throttleMs(缺省 1000ms,尾部触发)节流;
      // 组件卸载时会自动 flush 尾部变更,不丢
      void fetch('/api/scene-state', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(content),
      })
    },
  },
})
```

语义要点:

- `initialState` 经 `getProject(name, {state})` 透传;`project` 传 IProject实例时
  它会被忽略(实例的状态由创建方负责),控制台有警告。
- 节流是**尾部触发**:持续编辑期间每秒最多回调一次,停顿 1s 后必触发一次。
- **冲突矩阵**:如果宿主在挂载模块**之前**已经自己调过 `theatre.init`, 模块检测到
  init 配置不一致时**以先到的为准**(告警到 console,绝不悄悄重连)。所以要么把
  `init` 交给模块,要么自己 init 且保持一致,不要两头都管。

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
  见」)。monorepo 里联调可直接跑现成服务:`yarn sync-server`。

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
  `ui.locale` 不生效;宿主没包 → 模块自包一层,`ui.locale` 这时生效 (经全局
  `setLanguage` 应用一次,不是子树级隔离)。模块词条 key 一律 `pg.` 前
  缀;`registerMessages` 是合并语义,宿主可后注册**覆盖同名 key** 做品牌定制:

  ```ts
  import {registerMessages} from '@dreamerbird/studio/i18n'
  registerMessages('zh-CN', {'pg.toolbar.addModel': '添加角色'})
  ```

- **config 首帧锁定,不热更**:`useCameraStudio` 只在首帧取一次 config (与
  theatre.init 的一次性语义对齐),后续渲染传新对象不会生效。配置要变需 **整页刷
  新**:React 重挂(SPA 路由切换)传新 config 不会生效——模块会console.warn 点名差异
  键并沿用首次 boot 的配置(sceneProps/存储/状态/ sync 全部按首次 boot)。

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
