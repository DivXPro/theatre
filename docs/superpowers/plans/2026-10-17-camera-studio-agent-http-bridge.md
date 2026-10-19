# Camera Studio Agent HTTP Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已完成的第一段浏览器 Agent API 增加仅本机安全默认、宿主可配置的 HTTP 桥接、内部 WebSocket 会话、任务和文件传输。

**Architecture:** 独立 Node 包只负责 HTTP、鉴权、去重、文件和连接管理；浏览器桥接客户端直接调用第一段命令注册表。二进制仅通过 HTTP `fileId` 适配，普通命令在 JS 与 HTTP 间保持同名同参数。

**Tech Stack:** Node >=18、TypeScript 5.6、Node `http/fs/crypto`、WebSocket `ws`、浏览器 WebSocket/fetch、Jest、Playwright、Vite。

**Spec:** `docs/superpowers/specs/2026-10-17-camera-studio-agent-api-design.md`

**前置依赖:** `docs/superpowers/plans/2026-10-17-camera-studio-agent-browser-api.md` 已完成；可取得 `CameraStudioApi`、`AgentCommandRegistry`、`AgentRuntime` 和任务订阅接口。

## Global Constraints

- 外部 Agent 只使用 HTTP；WebSocket 只存在于浏览器与桥接之间。
- 默认 `host: 127.0.0.1`、`port: 43110`、`corsOrigins: []`、`maxUploadBytes: 209715200`。
- 没有 Token 或显式自定义鉴权回调时，桥接不得启动。
- 一个桥接只绑定一个活动场景；第二连接返回冲突，不静默替换。
- 不提供 eval、任意 JS 或原始 Theatre 状态写入。
- 所有 `/v1` HTTP 路由和内部 WebSocket upgrade 都鉴权；CORS 只按精确白名单开放。
- JSON 命令不携带二进制；File/Blob 与 fileId 的适配只在浏览器桥接客户端完成。
- 桥接不复制领域规则，不自行判断对象、资产、路径或关键帧是否合法。

## Review Focus

- 非法 Token 的 HTTP 与 WebSocket：都必须被拒绝且不能启动场景命令；由 Task 2 和 Task 4 测试锁定。
- 同一写命令网络重试：必须共享第一次结果，不能创建第二个对象；由 Task 4 测试锁定。
- 页面在导出中断连：HTTP 长任务必须进入失败终态而不是永远 running；由 Task 5 测试锁定。
- 非 UTF-8 二进制和超限上传：字节必须原样往返，超限不能留下临时文件；由 Task 3 测试锁定。
- 页面来源不在 CORS 白名单：浏览器文件适配必须给出可诊断错误，不能把 CORS 失败包装成领域成功；由 Task 6 和 Task 8 测试锁定。

## File Structure

- `packages/camera-studio-bridge/`：独立 Node 包。
- `src/config.ts`：默认配置、环境变量和鉴权配置校验。
- `src/httpServer.ts`、`src/auth.ts`：HTTP 路由、CORS、Bearer 和错误映射。
- `src/FileStore.ts`：受限临时文件、下载和过期清理。
- `src/SceneSession.ts`：单页面 WebSocket、命令转发、断连和 schema 缓存。
- `src/RequestDeduplicator.ts`：requestId 在途/完成结果去重。
- `src/JobStore.ts`：任务投影、查询、取消和断连终态。
- `src/bridge.ts`：程序化 `createCameraStudioBridge` 和生命周期。
- `src/cli.ts`：命令行启动。
- `packages/camera-studio/src/agent/bridgeClient.ts`：浏览器 WebSocket、命令执行和文件适配。
- `examples/camera-host-demo/`：可运行接入与真实端到端测试。

---

### Task 1: 桥接包、传输 DTO 和安全配置

**Files:**
- Create: `packages/camera-studio-bridge/package.json`
- Create: `packages/camera-studio-bridge/tsconfig.json`
- Create: `packages/camera-studio-bridge/src/types.ts`
- Create: `packages/camera-studio-bridge/src/config.ts`
- Modify: `devEnv/typecheck-all-projects/tsconfig.all.json`
- Test: `packages/camera-studio-bridge/src/config.test.ts`

**Interfaces:**
- Produces: `CameraStudioBridgeConfig`、`ResolvedBridgeConfig`、`CommandRequest`、`CommandSuccess<T>`、`CommandFailure`、`BridgeJobSnapshot`、`SceneWireMessage`。
- Produces: `resolveBridgeConfig(config): ResolvedBridgeConfig` 和 `resolveBridgeConfigFromEnv(env)`。

- [ ] **Step 1: 写安全默认值测试**

```ts
import {resolveBridgeConfig, resolveBridgeConfigFromEnv} from './config'

test('uses local secure defaults', () => {
  const config = resolveBridgeConfig({token: 'secret'})
  expect(config).toMatchObject({
    host: '127.0.0.1', port: 43110, corsOrigins: [],
    maxUploadBytes: 200 * 1024 * 1024,
  })
})

test('refuses to start without any authentication', () => {
  expect(() => resolveBridgeConfig({})).toThrow(/Token|authenticate/)
})

test('does not relax auth when host becomes public', () => {
  expect(() => resolveBridgeConfig({host: '0.0.0.0'})).toThrow()
  expect(resolveBridgeConfig({host: '0.0.0.0', token: 'secret'}).host).toBe('0.0.0.0')
})
```

环境变量测试覆盖 `CAMERA_STUDIO_BRIDGE_HOST/PORT/TOKEN/CORS_ORIGINS/MAX_UPLOAD_BYTES`；非法端口、负上传限制和重复/空 CORS origin 均拒绝。

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn test packages/camera-studio-bridge/src/config.test.ts --runInBand`  
Expected: FAIL，包和模块不存在。

- [ ] **Step 3: 创建包并定义 DTO**

`package.json` 名称为 `@dreamerbird/camera-studio-bridge`，`main/types` 指向 `dist`，scripts 提供 `build:ts` 和 `start`，dependencies 使用 `ws:^8.18.0`，devDependencies 使用 `@types/ws:^8.5.10`、`@types/node:^18.19.0` 和本仓库 TypeScript。导入使用 `http`、`fs/promises`、`crypto` 等裸模块名，兼容仓库现有 Node 类型配置。

核心 DTO：

```ts
export type CommandRequest = {
  requestId: string
  name: string
  args: unknown
}
export type CommandSuccess<T = unknown> = {
  ok: true
  result: T
  revision?: number
}
export type CommandFailure = {
  ok: false
  error: {
    code: string
    message: string
    retryable: boolean
    details?: unknown
  }
}
export type BridgeJobSnapshot<T = unknown> = {
  jobId: string
  kind: string
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  progress: number
  phase: 'accepted' | 'committed' | 'mounted' | 'loaded'
  result?: T
  error?: CommandFailure['error']
  cancelable: boolean
}
export type BridgeAuth = {
  token?: string
  authenticate?: (request: import('http').IncomingMessage) => boolean | Promise<boolean>
}
export type CameraStudioBridgeConfig = Partial<{
  host: string
  port: number
  corsOrigins: string[]
  maxUploadBytes: number
  maxCommandBytes: number
  fileTtlMs: number
}> & BridgeAuth
```

`SceneWireMessage` 使用 discriminated union：`hello(sessionId,schema)`、`command(commandId,request)`、`result(commandId,response)`、`job(sessionId,snapshot)`、`cancel(jobId)`、`error(commandId,response)`。`snapshot` 使用上面的 `BridgeJobSnapshot`，二进制结果已在浏览器侧转换为 fileId。

- [ ] **Step 4: 实现配置并接入类型检查**

`resolveBridgeConfig` 返回 frozen config；`maxCommandBytes` 默认 1 MiB，`fileTtlMs` 默认 1 小时。token 与自定义 `authenticate` 至少存在一个：只有 token 时使用默认 Bearer/subprotocol 校验；只有 authenticate 时，该回调同时负责 HTTP 和 WebSocket upgrade，并自行从 header/subprotocol 取凭据；两者同时存在时采用 AND，两项都必须通过，禁止组合配置反而降低安全。浏览器桥接配置始终由宿主注入对应凭据。

在 `tsconfig.all.json` references 添加 `{"path": "../../packages/camera-studio-bridge"}`，不顺便加入其他既有遗漏包。

- [ ] **Step 5: 安装 workspace 链接并验证**

Run: `yarn install`  
Expected: 新 workspace 和 `ws` 依赖链接成功。  
Run: `yarn test packages/camera-studio-bridge/src/config.test.ts --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio-bridge build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio-bridge devEnv/typecheck-all-projects/tsconfig.all.json yarn.lock .yarn
git commit -m "feat(camera-studio-bridge): scaffold secure bridge package"
```

---

### Task 2: HTTP 鉴权、CORS、health/schema 和错误映射

**Files:**
- Create: `packages/camera-studio-bridge/src/auth.ts`
- Create: `packages/camera-studio-bridge/src/errors.ts`
- Create: `packages/camera-studio-bridge/src/httpServer.ts`
- Test: `packages/camera-studio-bridge/src/httpServer.test.ts`

**Interfaces:**
- Produces: `createHttpServer({config,session,files,jobs}): http.Server`；本任务先用 fake session/files/jobs。
- Produces: `authorizeRequest(req,config)`、`applyCors(req,res,config)`、`writeAgentError(res,error)`。

- [ ] **Step 1: 写鉴权和 CORS 测试**

启动 `http.createServer` 于 `127.0.0.1:0`。无 Authorization、错误 token、Bearer 之外 scheme 都返回 401 且 fake session 未收到命令。正确 token 可访问 health。`OPTIONS` 只对白名单 origin 返回 `Access-Control-Allow-Origin`，非白名单 origin 不返回允许头；不允许 `*` 与 credentials 同时出现。

- [ ] **Step 2: 写 health/schema 和 HTTP 错误测试**

无场景时 `/v1/health` 返回 `{ok:true,result:{bridge:'running',scene:'unavailable'}}`，`/v1/schema` 返回 503 `SCENE_UNAVAILABLE`。场景 hello 后返回缓存 schema。未知路由返回 404；JSON 超过 maxCommandBytes 返回 413；无效 JSON 返回 400；`REVISION_CONFLICT` 映射 409，`OBJECT_NOT_FOUND` 映射 404，`INVALID_ARGUMENT` 映射 422。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio-bridge/src/httpServer.test.ts --runInBand`  
Expected: FAIL，HTTP server 未实现。

- [ ] **Step 4: 实现 HTTP 基础设施**

`authorizeRequest` 支持 Bearer token 或配置提供的异步 authenticate；普通 HTTP 从 Authorization 取凭据，WebSocket upgrade 从 `camera-studio-v1` 之外的 `token.<encoded>` subprotocol 取凭据。所有 `/v1` 和 upgrade 共用同一函数。响应只包含 `error.code/message/retryable/details`，不把 stack 返回给客户端。

`httpServer.ts` 使用 URL 精确匹配，不用正则执行用户输入。JSON body 按 maxCommandBytes 流式计数并销毁超限请求。CORS 设置 `Vary: Origin`，白名单为空时不输出允许来源头。

本任务实现 `GET /v1/health`、`GET /v1/schema` 和通用错误 writer；`POST /v1/commands` 在 Task 4 接入，files/jobs 路由在对应任务接入。

- [ ] **Step 5: 运行测试和类型检查**

Run: `yarn test packages/camera-studio-bridge/src/httpServer.test.ts --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio-bridge build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio-bridge/src
git commit -m "feat(camera-studio-bridge): add authenticated http surface"
```

---

### Task 3: 临时文件上传、下载、过期和大小限制

**Files:**
- Create: `packages/camera-studio-bridge/src/FileStore.ts`
- Modify: `packages/camera-studio-bridge/src/httpServer.ts`
- Test: `packages/camera-studio-bridge/src/FileStore.test.ts`
- Test: `packages/camera-studio-bridge/src/files.test.ts`

**Interfaces:**
- Produces: `FileStore.put({stream,fileName,mimeType}): Promise<FileDescriptor>`、`get(fileId)`、`openReadStream(fileId)`、`delete(fileId)`、`close()`。
- Produces: `FileDescriptor {fileId;fileName;mimeType;size}`。

- [ ] **Step 1: 写二进制往返和超限测试**

使用字节 `[0,255,1,128,10,13]` 和 Readable stream 上传，下载后 Buffer 完全相等。声明 fileName 为 `模型.glb` 时通过 `encodeURIComponent` 的 `X-File-Name` 保留原名。超过 maxUploadBytes 时返回 413，`fileId` 不返回，临时目录最终为空。

- [ ] **Step 2: 写过期和路径攻击测试**

使用可注入 clock：过期文件 `get` 返回 `FILE_NOT_FOUND` 并删除磁盘文件；`GET /v1/files/../../etc/passwd` 和编码后的斜线只按单个 fileId 处理，不能逃出临时目录；未知 ID 返回 404；`close()` 停止清理 timer 并删除该 store 自己创建的临时目录。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio-bridge/src/FileStore.test.ts packages/camera-studio-bridge/src/files.test.ts --runInBand`  
Expected: FAIL，FileStore 不存在。

- [ ] **Step 4: 实现流式 FileStore**

每次 `createFileStore` 用 `mkdtemp(join(tmpdir(),'camera-studio-bridge-'))` 创建独立目录。fileId 使用 `randomUUID()`，磁盘路径只允许 `${fileId}.bin`；元数据只存内存 Map。`put` 以 `wx` 标志创建文件，流式写入并累计字节，超限或流错误时关闭并 unlink 部分文件。

下载先检查存在和过期，再设置 `Content-Type`、`Content-Length`、`Content-Disposition: attachment; filename*=UTF-8''<encoded>`。上传和下载都由 Task 2 鉴权与 CORS 包裹，浏览器桥接客户端也复用这两个 `/v1/files` 路由。

- [ ] **Step 5: 接入路由并验证**

实现 `POST /v1/files` 和 `GET /v1/files/:id`。上传成功后返回 201 `{ok:true,result:FileDescriptor}`；不解析 multipart，body 即原始字节，文件名来自 `X-File-Name`，MIME 来自 `Content-Type` 或 `application/octet-stream`。

Run: `yarn test packages/camera-studio-bridge/src --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio-bridge build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio-bridge/src
git commit -m "feat(camera-studio-bridge): add bounded binary file transport"
```

---

### Task 4: 单场景 WebSocket、命令转发和 requestId 去重

**Files:**
- Create: `packages/camera-studio-bridge/src/SceneSession.ts`
- Create: `packages/camera-studio-bridge/src/RequestDeduplicator.ts`
- Modify: `packages/camera-studio-bridge/src/httpServer.ts`
- Test: `packages/camera-studio-bridge/src/SceneSession.test.ts`
- Test: `packages/camera-studio-bridge/src/commands.test.ts`

**Interfaces:**
- Produces: `SceneSession.attachUpgrade(req,socket,head)`、`execute(request): Promise<CommandSuccess>`、`schema()`、`health()`、`close()`。
- Produces: `RequestDeduplicator.execute(request,fn)`，同 requestId 的在途和已完成写请求共享结果。

- [ ] **Step 1: 写 WebSocket 鉴权和单场景测试**

用 `ws` 客户端以 `camera-studio-v1` 和 `token.${encodeURIComponent(token)}` 两个 subprotocol 连接。无 token 或错误 token upgrade 被拒绝；正确连接发送 hello/schema 后 health 变为 available。第二个活动连接收到 `INVALID_STATE` 后被关闭，第一连接仍可执行命令。

- [ ] **Step 2: 写命令转发和断连测试**

HTTP POST command 后 fake 浏览器收到同名同 args 的 wire command；浏览器 result 返回后 HTTP body 为 `{ok:true,result,revision?}`。页面在执行中关闭时，pending HTTP 请求以 503 `SCENE_UNAVAILABLE` 结束，不等待默认超时。浏览器返回未知 commandId 的 result 不创建新请求也不崩溃。

- [ ] **Step 3: 写去重测试**

第一个 `models.create` 的 deferred 尚未完成时，以相同 requestId 再发两次，fake 浏览器只收到一次 command；三个 HTTP 请求得到完全相同结果。完成后再重试仍只执行一次。相同 requestId 但不同 name/args 返回 409 `INVALID_STATE`，details 指明 requestId 冲突。query 不被长期缓存。

- [ ] **Step 4: 运行测试确认失败**

Run: `yarn test packages/camera-studio-bridge/src/SceneSession.test.ts packages/camera-studio-bridge/src/commands.test.ts --runInBand`  
Expected: FAIL，SceneSession 未实现。

- [ ] **Step 5: 实现 session、upgrade 和去重**

`SceneSession` 用 `WebSocketServer({noServer:true})`，upgrade 先解析 subprotocol 中的凭据，再调用 `authorizeRequest`，`handleProtocols` 只选择 `camera-studio-v1`。每个 commandId 使用 randomUUID，pending Map 保存 resolve/reject；close 时全部 reject。

`RequestDeduplicator` 以 requestId 保存 `{fingerprint,promise}`，fingerprint 使用 stable stringify（递归排序对象键，数组保持顺序）。只缓存 schema 中 `kind !== 'query'` 的命令；失败结果同样按第一次结果返回，调用者修正参数必须更换 requestId。缓存使用 1000 条 LRU，避免无限增长。

- [ ] **Step 6: 接入 POST /v1/commands 并验证**

请求必须包含非空 requestId/name 和 args；args 可以是任意 JSON 值，由浏览器命令 validator 做最终校验。HTTP 不在 Node 侧复制领域 schema 校验。命令为 job 时仍等待浏览器返回 `{jobId}`，随后按 Task 5 输出 202。

Run: `yarn test packages/camera-studio-bridge/src --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio-bridge build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio-bridge/src
git commit -m "feat(camera-studio-bridge): add deduplicated scene command channel"
```

---

### Task 5: HTTP 任务投影、进度、取消和断连终态

**Files:**
- Create: `packages/camera-studio-bridge/src/JobStore.ts`
- Modify: `packages/camera-studio-bridge/src/SceneSession.ts`
- Modify: `packages/camera-studio-bridge/src/httpServer.ts`
- Test: `packages/camera-studio-bridge/src/jobs.test.ts`

**Interfaces:**
- Produces: `JobStore.upsert(snapshot)`、`get(jobId)`、`cancel(jobId)`、`failAllForScene(code)`。
- Produces: HTTP `GET /v1/jobs/:id`、`POST /v1/jobs/:id/cancel`。

- [ ] **Step 1: 写任务路由和状态测试**

job 命令返回 `{jobId}` 后 HTTP 为 202，body 含初始 job。浏览器发送 progress 后 GET 返回 running、0.5 和当前 phase；succeeded 后结果完整可读。未知 job 返回 404 `JOB_NOT_FOUND`。不可取消任务返回 409 `JOB_NOT_CANCELABLE`。

- [ ] **Step 2: 写取消和断连测试**

取消请求向浏览器发送 `jobs.cancel` 命令，最终以浏览器 job snapshot 为准，不由 HTTP 假装已取消。页面断连时 pending/running 任务统一转为 failed，error.code 为 `SCENE_UNAVAILABLE`；已 succeeded/failed/cancelled 的终态不被覆盖。重连新页面不会继承旧任务为 running。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio-bridge/src/jobs.test.ts --runInBand`  
Expected: FAIL，JobStore 和路由未实现。

- [ ] **Step 4: 实现 JobStore 与事件接线**

JobStore 只接受来自当前场景执行代次的 job 事件；SceneSession 每次 hello 带 sessionId，旧连接迟到事件被丢弃。`failAllForScene` 只修改非终态。取消转发复用 `SceneSession.execute({name:'jobs.cancel',args:{jobId},requestId})`，requestId 由桥接生成并带 `cancel-` 前缀，不与 Agent 请求冲突。

- [ ] **Step 5: 运行全部桥接测试和类型检查**

Run: `yarn test packages/camera-studio-bridge/src --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio-bridge build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio-bridge/src
git commit -m "feat(camera-studio-bridge): add http job tracking and cancellation"
```

---

### Task 6: 浏览器桥接客户端和二进制适配

**Files:**
- Create: `packages/camera-studio/src/agent/bridgeClient.ts`
- Create: `packages/camera-studio/src/agent/bridgeFiles.ts`
- Modify: `packages/camera-studio/src/config.ts`
- Modify: `packages/camera-studio/src/bootstrap.ts`
- Modify: `packages/camera-studio/src/index.ts`
- Test: `packages/camera-studio/src/agent/bridgeClient.test.ts`
- Test: `packages/camera-studio/src/agent/bridgeFiles.test.ts`

**Interfaces:**
- Consumes: 第一段 `CameraStudioApi`、registry、runtime.jobs、Task 13 `VideoExportResult`。
- Produces: `CameraStudioConfig.agent.bridge {url;token;httpUrl}` 和 `createAgentBridgeClient({api,registry,runtime,config}): {close}`。

- [ ] **Step 1: 写命令执行和生命周期测试**

fake WebSocket 收到 command 后断言 registry.execute 的 name/args 与请求一致，requestId 原样传入；结果为 AgentApiError 时返回结构化 error 而非关闭 socket。每次连接生成新的 sessionId，hello 携带 sessionId 和 `registry.describe()`；job 事件也携带同一 sessionId。浏览器 result 使用 `CommandSuccess/CommandFailure`，项目命令同时带当前 revision。浏览器 close/dispose 后 socket 停止重连并拒绝新执行。

- [ ] **Step 2: 写模型文件 hydrate 测试**

`assets.importModel` 的 HTTP args 为 `{file:{fileId:'f1',fileName:'Y Bot.glb',mimeType:'model/gltf-binary'}}` 时，bridgeFiles 用 fetch 下载字节并构造 File，再调用 registry；断言 File 名称、类型和字节正确。下载 401/404/CORS rejection 分别结构化上抛，不能调用 importModelFile。

- [ ] **Step 3: 写视频结果 dehydrate 测试**

构造包含 `VideoExportResult` 的 succeeded job，bridgeFiles 将 Blob 原始字节 POST 到 `/v1/files`，发给 Node 的 job snapshot 中 result 改为 `{fileId,fileName,mimeType,size}`，不含 Blob。上传失败时 job 为 failed `NETWORK_ERROR`，不能报告成功但缺文件。

- [ ] **Step 4: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/bridgeClient.test.ts packages/camera-studio/src/agent/bridgeFiles.test.ts --runInBand`  
Expected: FAIL，客户端不存在。

- [ ] **Step 5: 实现客户端和配置**

浏览器 WebSocket 使用 `camera-studio-v1` 与 `token.${encodeURIComponent(token)}` subprotocol。指数退避重连只针对临时断线，最大 5 秒；配置变化按现有 boot 规则要求整页刷新。CORS 错误在日志中保留 bridge httpUrl 和当前 `location.origin`，提示宿主把精确 origin 加入 `corsOrigins`，不建议使用 `*`。

`bootstrap` 在 API/runtime 创建后启动客户端，在 sessionTeardown 先关闭客户端再 disposed runtime。`index.ts` 公开 bridge 配置类型但不公开 Node API。

- [ ] **Step 6: 运行浏览器包测试和构建**

Run: `yarn test packages/camera-studio/src/agent/bridgeClient.test.ts packages/camera-studio/src/agent/bridgeFiles.test.ts packages/camera-studio/src/agent/api.test.tsx --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:api`  
Expected: PASS，浏览器产物无 `ws`、fs 或 Node http 依赖。

```bash
git add packages/camera-studio/src/agent packages/camera-studio/src/config.ts packages/camera-studio/src/bootstrap.ts packages/camera-studio/src/index.ts
git commit -m "feat(camera-studio): add browser agent bridge client"
```

---

### Task 7: 程序化服务、CLI 和 JS/HTTP 契约一致性

**Files:**
- Create: `packages/camera-studio-bridge/src/bridge.ts`
- Create: `packages/camera-studio-bridge/src/cli.ts`
- Create: `packages/camera-studio-bridge/src/index.ts`
- Test: `packages/camera-studio-bridge/src/contract.test.ts`
- Modify: `packages/camera-studio-bridge/package.json`

**Interfaces:**
- Produces: `createCameraStudioBridge(config): Promise<CameraStudioBridge>`；返回 `{origin,port,close()}`，port 0 时返回实际端口。
- Produces: CLI `camera-studio-bridge`，支持 `--host/--port/--token-env/--cors-origin` 重复参数；Token 只从指定环境变量读取。

- [ ] **Step 1: 写程序化生命周期测试**

以 port 0 创建桥接，health 可访问，`close()` 后新连接失败且没有存活 timer。重复 close 幂等。第二场景、FileStore、JobStore 和 WebSocketServer 都随 close 清理。

- [ ] **Step 2: 写 JS/HTTP 一致性测试**

用第一段真实 registry 注册一组 fake 领域命令，通过浏览器 bridgeClient 和 Node SceneSession 建立真实 WS。对每个命令分别直接 registry.execute 和 HTTP POST，比较 result/revision/error.code。覆盖静态更新成功、revision 冲突、对象不存在、job accepted 和非法参数。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio-bridge/src/contract.test.ts --runInBand`  
Expected: FAIL，程序化入口未实现。

- [ ] **Step 4: 实现 bridge 和 CLI**

`createCameraStudioBridge` 组合 config、FileStore、JobStore、SceneSession 和 HTTP server，不在此处添加领域逻辑。CLI 打印实际 origin 和 scene 连接状态，不打印 Token；SIGINT/SIGTERM 调用 close。`package.json` 增加 `bin` 和 exports。

- [ ] **Step 5: 运行全部测试与构建**

Run: `yarn test packages/camera-studio-bridge/src packages/camera-studio/src/agent --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio-bridge build:ts && yarn workspace @dreamerbird/camera-studio build:api`  
Expected: PASS。

```bash
git add packages/camera-studio-bridge packages/camera-studio/src/agent
git commit -m "feat(camera-studio-bridge): add public server and contract parity"
```

---

### Task 8: camera-host-demo 接入、真实浏览器 E2E 和部署文档

**Files:**
- Modify: `examples/camera-host-demo/src/main.tsx`
- Modify: `examples/camera-host-demo/package.json`
- Create: `examples/camera-host-demo/devEnv/playwright.config.ts`
- Create: `examples/camera-host-demo/src/agent.e2e.ts`
- Create: `docs/guides/camera-studio-agent-http.md`
- Modify: `docs/guides/camera-studio-embedding.md`

**Interfaces:**
- Consumes: 前两段的公开 JS 配置和 `createCameraStudioBridge`。
- Produces: 可通过环境变量启用桥接的宿主示例和真实 HTTP 验收脚本。

- [ ] **Step 1: 写失败的端到端场景**

Playwright webServer 同时启动 demo Vite 和测试桥接，demo 从 `VITE_CAMERA_STUDIO_AGENT_WS/HTTP/TOKEN` 读取配置；Token 只用测试常量并注入浏览器环境，不提交真实密钥。测试通过 Node fetch，不通过页面点击：

1. GET health/schema；
2. POST 上传 `packages/camera-studio/assets/models/Y Bot.glb`；
3. `assets.importModel` 并轮询 job；
4. `models.create`；
5. `scene.getSnapshot` 验证模型；
6. `objects.update` 移动模型并读取验证；
7. `sequence.setLength`、`keyframes.set`、`sequence.seek`；
8. `cameras.create`、`paths.createPreset`、`cameras.bindPath`；
9. `project.exportState`；
10. `objects.delete` 并验证清理。

- [ ] **Step 2: 运行 E2E 确认初始失败**

Run: `yarn workspace camera-host-demo test:e2e -- --grep "agent api"`  
Expected: FAIL，demo 尚未启用 bridge client。

- [ ] **Step 3: 完成 demo 和测试接线**

`main.tsx` 只在三个 Vite 环境变量都存在时设置 `agent.bridge`。Playwright 测试在创建桥接时把测试页面的精确 origin 传给桥接的 `corsOrigins`，浏览器配置不接收该服务端选项。Playwright 配置使用 Chromium、trace retain-on-failure，截图和视频只在失败时保留。`package.json` 添加与 playground 相同版本的 `@playwright/test` devDependency 和 `test:e2e` script。

视频导出单独一个短用例：将 sequence length 设为 0.2，启动导出、轮询终态并下载文件检查非零字节；若运行环境没有 MediaRecorder，测试必须明确报告 skipped，验收汇报不得声称视频路径已验证。

- [ ] **Step 4: 编写部署文档**

文档包含程序化启动、CLI/env、Token 注入、WS/HTTP URL 区别、CORS 精确白名单、fileId 上传下载、requestId 重试、任务轮询、断连语义、远程监听警告和完整 curl 示例。示例不打印或提交真实 Token。

- [ ] **Step 5: 执行真实验收**

Run: `yarn install && yarn workspace camera-host-demo build`  
Expected: PASS。  
Run: `yarn workspace camera-host-demo test:e2e`  
Expected: PASS；任何 skip 在结果中单独列出。  
Run: `yarn test packages/camera-studio-bridge/src packages/camera-studio/src/agent --runInBand`  
Expected: PASS。

- [ ] **Step 6: 更新 graft 并提交**

Run: `graft build`  
Expected: PASS。

```bash
git add examples/camera-host-demo docs/guides packages/camera-studio-bridge packages/camera-studio/src graft yarn.lock
git commit -m "feat(camera-studio): verify agent http bridge in browser"
```

**第二段完成判据:** 外部进程仅通过 HTTP 即可执行第一段命令，鉴权、去重、任务、文件和断连均有自动化验证；真实 demo 的主工作流通过。下一段开始编写 Agent SKILL。
