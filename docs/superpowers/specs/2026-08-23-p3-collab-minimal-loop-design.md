# P3 协作最小闭环设计(spec)

> **母规格**:`docs/superpowers/specs/2026-08-21-theatre-1.0-release-design.md`。
> **P3 出口标准(母规格)**:两个浏览器经自托管 sync-server 实时同步。
> **本文档**:把该出口落成可执行设计。范围深度 = **纯管道收口**(用户 2026-08-23 裁定:不做 studio 设置面板、不做完整 presence 可视化;现有 presence/conflicts UI 保持可用 + 补断线指示;服务器连接入口 = `init({serverUrl})` + demo)。

## 1. 现状盘点

**已就位(fork 2023 Q4 骨架 + P1 收口后),非从零**:

- **sync-server**(`packages/sync-server`,private):tRPC WebSocket 服务;`projectStateRouter` 暴露 SaazBack 全量操作(`saaz_applyUpdates`/`saaz_updatePresence`/`saaz_closePeer`/`saaz_getUpdatesSinceClock`/`saaz_getLastIncorporatedPeerClock` 等);`getSaazBack` 用 **`BackMemoryAdapter`**(内存,非 Postgres——prisma 在 sync 运行时路径零引用,已核实);`envSchema` 目前要求 `DATABASE_URL`/`PORT`/`HOST`/`APP_URL`(+ dev `DEV_DB_PORT`/`DEV_DB_PASSWORD`);JWT 鉴权(`requireValidSession`→`verifyAccessTokenOrThrow`,后者 fetch app 的 `/api/jwt-public-key` 验签);docker-compose(postgres)。**唯一测试:`env.test.ts`**。
- **studio 远程后端**:`createTrpcBackend`(StudioStore.ts:261)在 `serverUrl` 存在时选中,否则本地 SaazBack;`wrapTrpcProcedureWithAuth`(Auth.ts:345)**无 access token 即抛「Not authenticated」**;`SyncServerLink` 的 ws 地址来自 app 的 `syncServerUrl` 查询(Studio.ts:213);无 `serverUrl` 时 Auth 完全静默(P1 已落地)。
- **presence / conflicts UI**:`usePresence` + `usePresenceListenersOnRootElement`(已接线 DetailPanel);`uesConflicts()` 钩子(拼写错名,功能在——读 saaz `loadingState.type === 'browserStateIsNotBasedOnDiskState'`)驱动 GlobalToolbar 冲突计数徽标 + ProjectListItem「Has Conflicts」。
- **playground sync demo**:`shared/sync/index.tsx`,现设 `serverUrl: 'http://localhost:3000'`(http 形式走 app 解析,无 app 时打不通)。
- **app**(private,永不发布):鉴权 app + UI,零投入。

**关键耦合(自托管的拦路点)**:协作链路把 **app 当枢纽**——`serverUrl`(http)→ AppLink → 问 app 要 sync-server ws 地址 → 客户端 JWT 鉴权也走 app。自托管最小闭环**没有 app**。因此设计核心 = 给 studio 加**直连 ws 的自托管路径**,app-backed 旧路径保留不动。

## 2. 范围

### 做(6 块)

1. **连接链路:直连 ws 自托管路径**(核心改造)——studio 支持 `serverUrl` 为 `ws://`/`wss://` 直连 sync-server,绕过 app 解析与客户端鉴权。
2. **sync-server 自托管简化**——`AUTH_DISABLED` 环境变量(鉴权可关)、env schema 放宽(`DATABASE_URL`/`APP_URL` 可选)、`.env.example` 模板、README 自托管文档、docker-compose 注明 postgres 仅 app/auth 场景需要。
3. **断线状态指示**——SyncServerLink 暴露 wsClient 连接状态 → studio `ephemeralAtom.connectionStatus` → GlobalToolbar 小徽标(仅直连模式显示)。
4. **presence / conflicts 收尾**——`uesConflicts` → `useConflicts` 改名(内部,非公共 API);presence hooks 保持接线;不隐藏。
5. **两浏览器 e2e(出口命中)**——测试内起 sync-server(`AUTH_DISABLED` + 随机端口)→ 两个 browser context 打开 sync demo(ws URL)→ A 编辑,B 实时看到。
6. **测试**——sync-server env/auth-off 单测;studio 连接状态信号 + 徽标单测。

### 明确不做(范围决策,已代码层核实)

- **studio 服务器连接设置面板** → 用户裁定裁减(纯管道收口)。入口 = `init({serverUrl})` + demo 演示。
- **sync-server Postgres 持久化** → 不做。P3 出口「两浏览器实时同步」不要求跨服务器重启持久化;sync-server 的 SaazBack 保持 `BackMemoryAdapter`(内存)。Postgres 持久化记 **future work**(需实现 `BackStorageAdapter` 的 prisma 后端,不在 P3 任务列表)。
- **完整 presence 可视化**(远程光标/选择) → 用户裁定裁减。现有 presence 监听保持,不新增可视化。
- **app-backed 旧路径改动**(http serverUrl → AppLink → syncServerUrl) → 不动。app 零投入不发布,旧路径仅供未来接回官方 app 时用。
- **sync-server 多 DB / 租户 / 项目权限隔离** → 超出最小闭环。`dbName` 即隔离粒度。

## 3. 架构

### 3.1 连接链路双路径

```
自托管(默认协作形态,无 app):
  init({serverUrl: 'ws://localhost:3000'})
    └─ serverUrl 为 ws://wss:// → 直接 new SyncServerLink(serverUrl)
         ├─ 客户端不包 auth wrapper(直连 = 无鉴权)
         └─ sync-server(AUTH_DISABLED)忽略一切 token

app-backed(旧路径,保留不动):
  init({serverUrl: 'https://app.example.com'})
    └─ serverUrl 为 http(s):// → AppLink → syncServerUrl 查询 → SyncServerLink + JWT
```

**判定规则**:`serverUrl` 以 `ws://`/`wss://` 开头 → 直连自托管路径;以 `http(s)://` 开头 → app-backed 旧路径。两种 serverUrl 的 sanitize 校验(`sanitizeOpts.ts`)保持不变,仅新增 ws 前缀的接受。

### 3.2 数据流(直连模式)

```
A 浏览器编辑 → studio.transaction() → SaazFront.tx()
  ├─ 乐观应用到 A 本地 atom(UI 立即响应)
  ├─ 入 optimisticUpdatesQueue + undo 栈
  └─ createTrpcBackend → SyncServerLink(ws) → sync-server
       └─ getSaazBack(dbName).applyUpdates(内存 SaazBack)→ clock+1 → 广播
B 浏览器(同 dbName 的 front)→ 订阅收到 → _processBackendUpdate → B 本地 atom 更新 → UI 更新
断线:applyUpdates 走 C9 瞬时故障重试;saaz 乐观更新不丢;指示器显示「重连中」
```

front 代码零改动(协作与单人间唯一区别是 `SaazBackInterface` 实现,spec:143)。

### 3.3 组件边界

| 组件 | 职责 | 依赖 |
|---|---|---|
| `@dreamerbird/sync-server` | 自托管状态服务器;内存 SaazBack;AUTH_DISABLED 鉴权开关;env 简化 | saaz/core/utils/trpc/ws |
| `@dreamerbird/studio` | serverUrl 分流;SyncServerLink 连接状态信号;断线徽标 | core/saaz/react/trpc |
| `@dreamerbird/playground` | sync demo 改 ws URL;sync-collab e2e | studio/core/sync-server(仅测试) |

## 4. 组件级设计

### 4.1 sync-server

- **`AUTH_DISABLED`**:env 布尔。为真 → `requireValidSession` 直接放行(返回空 Session),`verifyAccessTokenOrThrow` 不再被调用(避免 fetch app 公钥)。为假 → 现行为不变。
- **env schema 放宽**:`DATABASE_URL`、`APP_URL` 从必填改可选(运行时 sync 路径零引用 prisma/app,已核实)。保留 `PORT`/`HOST` 必填。dev 模式不再要求 `DEV_DB_*`(无 postgres 场景)。
- **`.env.example`**:最小自托管模板(`PORT`/`HOST`/`AUTH_DISABLED=true`)。
- **README**:自托管步骤(装依赖 → `.env` → `yarn dev`);注明「状态存内存,重启即失,生产持久化(future work)」;docker-compose 注明 postgres 仅 app/auth 场景需要。
- 测试:扩展 `env.test.ts`(AUTH_DISABLED 分支 + 放宽后缺省值合法);新增 auth-off 单测(禁用时 `requireValidSession` 放行、不触发公钥 fetch)。

### 4.2 studio

- **serverUrl 分流**(Studio.ts:204 附近):serverUrl 为 `ws://`/`wss://` → 直接 `new SyncServerLink(serverUrl)`,且**不创建 `Auth`、不包 `wrapTrpcProcedureWithAuth`**(`authedLinks.syncServer` = 裸 SyncServerLink.api)。http(s):// → 现路径不动。
- **连接状态信号**:`SyncServerLink` 暴露 `onConnectionStateChange(cb)`,内部用 tRPC `createWSClient().getConnection()`(v10.43 返回底层 `WebSocket`,已核实)的 `readyState` + `onopen`/`onclose` 映射 `'connected' | 'reconnecting'`(readyState OPEN=connected,其余含重连=reconnecting);studio 把它汇入 `ephemeralAtom.connectionStatus`(仿 C8 `persistenceStatus` 内部信号模式)。仅直连模式有意义;本地模式恒 'connected'。
- **断线徽标**:GlobalToolbar 小徽标(「重连中/离线」),仅当直连模式且状态非 connected 时显示。saaz 乐观更新 + C9 重试语义已在,断线期间编辑不丢。
- 测试:连接状态信号单测(模拟 wsClient 状态变化);徽标组件单测(`renderToStaticMarkup` 风格,仿 PersistenceStatusBanner.test.ts)。

### 4.3 playground

- **sync demo**:`shared/sync/index.tsx` 的 `serverUrl` 改为可配置——从 URL query param 读(默认 `ws://localhost:3000`),供 e2e 注入随机端口。
- **sync-collab e2e**(新):`packages/playground/src/tests/sync-collab/test.e2e.ts`
  - 测试内起 sync-server 进程(env:随机端口 + `AUTH_DISABLED=true`,仿 compat-tests 的 `startServerOnPort` 模式)→ 等待 ready。
  - 两个 browser context,各开一个 sync demo 页面(同 `?serverUrl=ws://localhost:<port>` 且同 project/dbName)。
  - **编辑驱动 = demo 内确定性测试钩子**(不依赖 studio UI 内部元素——C8 e2e 的 data-header 教训):demo 把 `obj.props.x` 渲染为可见文本 + 一个「+1」按钮(`obj.props.x += 1`);e2e 在 A 点按钮,断言 B 的文本实时变。
  - 内存后端 → 无需 Postgres,e2e 自足。

## 5. 错误处理

| 场景 | 处理 |
|---|---|
| 断线/服务器不可达(直连) | saaz 乐观更新 + C9 瞬时故障重试;指示器「重连中」;编辑不丢不崩 |
| AUTH_DISABLED 下无 token | 客户端不包 auth wrapper → 不抛「Not authenticated」;服务端放行 |
| serverUrl 非法(非 ws/http) | sanitize 校验拒绝(现行为) |
| 服务器重启 | 内存状态丢失 → 各 front 重新 init 拉空;文档注明 |

## 6. 测试策略

- **sync-server**:`env.test.ts` 扩展;`authDisabled.test.ts`(放行 + 不 fetch 公钥)。
- **studio**:连接状态信号单测;断线徽标组件单测。
- **playground**:`sync-collab` e2e(两浏览器同步,出口命中)。
- 回归:全量 jest + typecheck 绿(P2 基线 309 通过)。

## 7. 出口标准映射(母规格 P3)

| 母规格项 | 本设计 |
|---|---|
| 两个浏览器经自托管 sync-server 实时同步 | §4.3 sync-collab e2e |
| 自托管文档 + env 简化 | §4.1(.env.example/README/schema 放宽) |
| 鉴权简化或可关 | §4.1 `AUTH_DISABLED` + §4.2 直连免鉴权 |
| studio 服务器连接设置入口 | `init({serverUrl: 'ws://…'})` + demo(用户裁定不建设置面板) |
| presence/冲突 UI 收尾或隐藏 | §4.2 `uesConflicts`→`useConflicts`;presence 保持可用(收尾) |
| 断线状态指示 | §4.2 connectionStatus + 徽标 |

## 8. 范围决策(Rulings,记录于本 spec)

1. **sync-server 保持内存存储**(BackMemoryAdapter):P3 出口不要求跨重启持久化;Postgres 持久化 = future work。
2. **`uesConflicts` → `useConflicts`** 内部改名(非公共 API,无迁移负担)。
3. **直连 ws = 无鉴权模式**:客户端不包 auth wrapper,服务端 AUTH_DISABLED 忽略 token;app-backed 旧路径(含鉴权)完整保留。
4. **serverUrl 分流判定**:`ws://wss://` → 直连;`http(s)://` → app-backed。sanitize 仅新增 ws 前缀接受。
