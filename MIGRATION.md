# 迁移指南:0.7 → 1.0

Theatre.js 1.0 是这个 fork 的首个主版本。本指南分两部分:Part 1 面向从 0.7 升级的使用者,Part 2 面向想了解内部改动的贡献者。

## Part 1 用户迁移

### scope 改名

所有包的 npm scope 从 `@theatre/*` 改为 `@toy-box/*`。

```diff
- npm install @theatre/core @theatre/studio
+ npm install @toy-box/core @toy-box/studio
```

```diff
- import {getProject} from '@theatre/core'
- import studio from '@theatre/studio'
+ import {getProject} from '@toy-box/core'
+ import '@toy-box/studio'
```

受影响的包:`core`、`studio`、`dataverse`、`react`、`r3f`、`utils`、`browser-bundles`。`@theatre/theatric` → `@toy-box/theatric`。

### init() 流程

1.0 定稿了初始化顺序:`getStudio()` 现在要求先 `init()`,顺序相反会抛 `You seem to have called getStudio() before init()`。

```diff
+ import '@toy-box/studio'   // 副作用注册 studio bundle
  import theatre from '@toy-box/core'

+ void theatre.init({studio: true})
  void theatre.getStudio().then((studio) => {
    studio.extend(extension)
  })
```

要点:先 `init({studio: true, ...})`,再 `getStudio()`;并确保 `import '@toy-box/studio'` 副作用存在,否则 `getStudioSync()` 返回 `undefined`。

### 被删 / 改的 API

- three.js 0.155+:`BoxBufferGeometry` 已移除,改用 `BoxGeometry`(r3f 用户把 `<boxBufferGeometry>` 改成 `<boxGeometry>`)。

### 常见问题

- **`getStudioSync()` 返回 undefined**:缺 `import '@toy-box/studio'` 副作用 import,见「init() 流程」。
- **自托管 sync-server 起不来**:minimal loop 需要 `AUTH_DISABLED=true`;auth-on 则必须配 `DATABASE_URL`/`APP_URL`(dev 下还要 `DEV_DB_PORT`/`DEV_DB_PASSWORD`)。
- **安装 `@toy-box/r3f` 报 `ERESOLVE`**:`@toy-box/r3f` 的 peer 是 `@react-three/fiber@^8`,fiber@8 只支持 react 18(`react >=18 <19`)。npm 7+ 会自动把 peer 装成最新版(react 19),还会顺带装 fiber@8 声明的 peerOptional `expo` 链(同样拽入 react 19),于是一个「裸」`npm install @toy-box/r3f` 必失败——裸装上游 `@react-three/fiber@8` 本身就以同样方式失败,非本包缺陷。正确姿势是按 r3f 惯例显式声明 react 18 技术栈:
  ```bash
  npm install react@^18 react-dom@^18 three @react-three/fiber@^8 @toy-box/r3f
  ```
  兜底:确需让 npm 跳过 peer 自动安装时用 `npm install --legacy-peer-deps`(已验证可装通)。需要 react 19 的用户请等 r3f 升级到 fiber@9。

## Part 2 内部架构说明

面向 fork 贡献者,描述 1.0 的内部结构。

- **saaz 桥**:同步引擎改为 saaz;StudioStore 通过 saaz front/back 适配器持久化(IndexedDB / memory),serverUrl 模式下经 saaz 与 sync-server 同步。
- **StudioStore 后端可选**:serverUrl 默认 `undefined` 时 studio 完全离线(无 AppLink/SyncServerLink/Auth,零网络);提供 serverUrl 才启用后端。
- **直连 ws 分流**:`isDirectSyncServerUrl`(`ws://`/`wss://`)时 SyncServerLink 直连 sync-server,免 Auth,`authedLinks.syncServer` 为裸 client;http(s) 走 app-backed 路径。
- **连接状态**:`ephemeralAtom.connectionStatus`(`'connected' | 'reconnecting'`),直连分支订阅 `SyncServerLink.onConnectionStateChange`(1s 轮询 ws readyState)写入,GlobalToolbar 渲染断线徽标。
- **鉴权可关**:sync-server `AUTH_DISABLED=true` 为自托管 minimal loop;`requireValidSession`/`verifyAccessTokenOrThrow` 经 `authConfig.isAuthDisabled()` 单一读点放行;仅精确 `'true'` 放行,其余 fail-closed。
