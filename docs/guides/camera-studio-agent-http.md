# camera-studio Agent HTTP 桥接(部署与调用指南)

> 面向把 camera-studio 嵌入自己应用的宿主开发者与外部 Agent 运维方。浏览器里的命
> 令面本身见 [camera-studio-agent-js-api.md](./camera-studio-agent-js-api.md),
> 嵌入编辑器 UI 见 [camera-studio-embedding.md](./camera-studio-embedding.md);
> 设计规
> 格:`docs/superpowers/specs/2026-10-17-camera-studio-agent-api-design.md`(§10)。
>
> 本文回答一个问题:**外部进程如何只经 HTTP 驱动浏览器里的场景**——桥接进程怎么
> 起、凭据怎么注、文件怎么传、任务怎么轮询、断连是什么语义,附完整 curl 示例
> (token 一律用环境变量占位,任何真实值都不进文档、不进日志)。

## 1. 架构与两个 URL 的区别

```text
外部 Agent
   │  HTTP + Bearer Token(本文的全部内容)
   ▼
@dreamerbird/camera-studio-bridge   ← Node 进程,默认只听 127.0.0.1:43110
   │  内部 WebSocket:命令 / 结果 / 任务进度
   │  内部 HTTP:文件字节
   ▼
浏览器页面(CameraStudioApi)
```

浏览器配置里有**两个地址**,职责不同、缺一不可:

| 配置(env / 字段)       | 形态                     | 用途                                          |
| ---------------------- | ------------------------ | --------------------------------------------- |
| `agent.bridge.url`(WS) | `ws://127.0.0.1:43110`   | 页面与桥接的命令通道:hello、command、job 事件 |
| `agent.bridge.httpUrl` | `http://127.0.0.1:43110` | 二进制文件传输:上传取字节、导出结果写临时文件 |

外部 Agent **只用 HTTP**,永远不碰那条 WebSocket——它是页面与桥接之间的内部通道(凭
据走 `Sec-WebSocket-Protocol` 的 `token.<encodeURIComponent(token)>`, 不是 HTTP
头)。

## 2. 启动桥接

### 2.1 程序化

```ts
import {createCameraStudioBridge} from '@dreamerbird/camera-studio-bridge'

const bridge = await createCameraStudioBridge({
  host: '127.0.0.1', // 缺省 127.0.0.1
  port: 43110, // 缺省 43110;0 = 系统分配,返回值带实际端口
  token: process.env.CAMERA_STUDIO_TOKEN, // 见 §3;也可用 authenticate 回调
  corsOrigins: ['http://localhost:3000'], // 见 §4:精确 origin 白名单
  maxUploadBytes: 200 * 1024 * 1024, // 缺省 200MB
})
console.log(bridge.origin) // http://127.0.0.1:43110
await bridge.close() // 幂等:场景会话、HTTP、任务投影、临时文件全部清理
```

没有 token 也没有 `authenticate` 回调时**拒绝启动**;两者同时配置是 AND (两项都必
须通过),不存在「配多了反而放宽」。

### 2.2 CLI

```bash
yarn workspace @dreamerbird/camera-studio-bridge build:ts   # 先产出 dist
CAMERA_STUDIO_BRIDGE_TOKEN='<由部署方提供>' \
  node packages/camera-studio-bridge/dist/cli.js \
  --port 43110 \
  --cors-origin http://localhost:3000
```

或安装后的 bin:`camera-studio-bridge --port 43110 ...`。参数:

- `--host <host>`(默认 127.0.0.1)、`--port <port>`(0 = 系统分配);
- `--token-env <name>`:token 的**环境变量名**(默认
  `CAMERA_STUDIO_BRIDGE_TOKEN`)—— CLI 刻意不接受命令行直传 token,避免它出现在进
  程列表与 shell 历史里;
- `--cors-origin <origin>`:放行一个 CORS 来源,可重复;缺省不放行任何来源;
- 进程只打印实际 origin 与场景连接状态翻转(connected/unavailable),不打印凭据。

### 2.3 环境变量

`resolveBridgeConfigFromEnv()`(CLI 之外的部署脚本可直接用):

| 变量                                    | 含义                         |
| --------------------------------------- | ---------------------------- |
| `CAMERA_STUDIO_BRIDGE_HOST`             | 监听地址                     |
| `CAMERA_STUDIO_BRIDGE_PORT`             | 端口                         |
| `CAMERA_STUDIO_BRIDGE_TOKEN`            | Bearer Token                 |
| `CAMERA_STUDIO_BRIDGE_CORS_ORIGINS`     | 逗号分隔的精确 origin 白名单 |
| `CAMERA_STUDIO_BRIDGE_MAX_UPLOAD_BYTES` | 上传字节上限                 |

### 2.4 浏览器侧(宿主页面)

页面**默认不连桥接**;宿主显式给三个值才启动桥接客户端:

```tsx
useCameraStudio({
  project: 'Space',
  agent: {
    bridge: {
      url: 'ws://127.0.0.1:43110', // WS 通道
      httpUrl: 'http://127.0.0.1:43110', // 文件传输
      token: injectedToken, // 部署方注入;不要硬编码进仓库
    },
  },
})
```

`examples/camera-host-demo` 是可直接跑的范例:三个环境变量
`VITE_CAMERA_STUDIO_AGENT_WS` / `VITE_CAMERA_STUDIO_AGENT_HTTP` /
`VITE_CAMERA_STUDIO_AGENT_TOKEN` 齐全才连接,缺一就保持默认(不连桥接), demo 照常
可用。注意 `corsOrigins` 是**桥接(服务端)配置**,浏览器配置没有、也不需要这个字
段。

## 3. Token 注入与鉴权

- 所有 `/v1` 路由要求 `Authorization: Bearer <token>`;缺失或错误一律 401
  (`UNAUTHORIZED`),且不区分「路由不存在」与「未授权」,不泄露路由表。
- token 比对是 constant-time;桥接任何模块都不打印 token。
- Agent 侧用环境变量持有 token,不要写进脚本、日志或提交记录:

```bash
export CAMERA_STUDIO_API_URL=http://127.0.0.1:43110
export CAMERA_STUDIO_TOKEN='<由部署方提供>'
curl -H "Authorization: Bearer $CAMERA_STUDIO_TOKEN" \
  "$CAMERA_STUDIO_API_URL/v1/health"
```

## 4. CORS:精确白名单

浏览器的文件传输(fetch 到 `httpUrl`)是受 CORS 约束的跨域请求;WS upgrade不走
CORS(鉴权在 subprotocol)。规则:

- 白名单为空 = 不放行任何来源(默认);
- 命中白名单才回显该 origin,**绝不回显任意 origin**;
- `*` 可用但永不携带 credentials 头,不建议——写页面的**精确 origin** (如
  `http://localhost:3000`,协议 + 主机 + 端口,不带路径);
- 浏览器侧文件请求被 CORS 拦时,页面控制台会打出提示,给出页面 origin 与桥接
  httpUrl,照它把精确 origin 加进 `corsOrigins` 即可。

WS upgrade 不走 CORS 预检,但 origin 检查沿用同一份 `corsOrigins` 白名单:白名单
为空(本地开发默认)时不做来源检查;白名单非空时,upgrade 请求的 `Origin` 头必须
精确命中白名单,不匹配或缺失一律拒绝(403)。所以部署到远程页面时,把页面的精确
origin 写进 `corsOrigins` 后,HTTP 与 WebSocket 两条通道的来源约束是一致的。

改监听地址、端口、CORS 都靠**重启桥接**生效,浏览器场景无需重建。

## 5. HTTP 路由一览

| 路由                       | 用途                                                          |
| -------------------------- | ------------------------------------------------------------- |
| `GET /v1/health`           | 桥接状态 + 浏览器场景连接状态(`scene: connected/unavailable`) |
| `GET /v1/schema`           | API 版本、命令元数据、DTO、错误码;无场景连接时 503            |
| `POST /v1/commands`        | 执行命令(见 §6)                                               |
| `POST /v1/files`           | 上传原始字节 → `fileId`(见 §7)                                |
| `GET /v1/files/:id`        | 下载导出结果等临时文件                                        |
| `GET /v1/jobs/:id`         | 任务状态与结果(见 §8)                                         |
| `POST /v1/jobs/:id/cancel` | 取消可取消的任务(202 = 已转发,终态以轮询为准)                 |

## 6. 命令调用、requestId 与重试

```http
POST /v1/commands
Authorization: Bearer <token>
Content-Type: application/json

{"requestId": "agent-20261019-0007", "name": "objects.update", "args": {...}}
```

- `requestId` 必填非空;同一桥接 + 同一场景会话内,写命令按 `requestId` **去重**:
  重放返回第一次的缓存结果,不会重复创建对象或关键帧。网络超时后重试写命令时**复
  用原 requestId**,不要换新的。去重不跨桥接重启、不跨页面重连(新会话重置作用
  域)。
- 成功:`200 {"ok": true, "result": ..., "revision"?: n}`(`revision` 只在涉及持久
  项目状态的 mutation 上返回);job 命令见 §8。
- 失败:`{"ok": false, "error": {code, message, retryable, details?}}` 加合适的
  HTTP 状态(400/401/404/409/413/503/500)。**分支依据是 `error.code`**, HTTP 状态
  只表达类别;`retryable: true` 才建议重试。
- 项目写命令可选 `args.expectedRevision`(取自已读快照的 `revision`),不匹配返回
  `REVISION_CONFLICT` 且不执行写入——冲突后重新读取再改,不盲目覆盖。

## 7. 文件:fileId 上传与下载

模型导入两步走(二进制不进 JSON、不经 WebSocket):

```bash
# 1) 上传原始字节(body 即文件内容,不是 multipart;X-File-Name 需百分号编码)
curl -X POST "$CAMERA_STUDIO_API_URL/v1/files" \
  -H "Authorization: Bearer $CAMERA_STUDIO_TOKEN" \
  -H "Content-Type: model/gltf-binary" \
  -H "X-File-Name: $(python3 -c 'from urllib.parse import quote; print(quote("Y Bot.glb"))')" \
  --data-binary '@/path/to/Y Bot.glb'
# → 201 {"ok":true,"result":{"fileId":"...","fileName":"Y Bot.glb","mimeType":"...","size":267904}}

# 2) 命令引用 fileId;浏览器经内部 HTTP 取回字节后走既有导入管线
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" \
  -H "Authorization: Bearer $CAMERA_STUDIO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"requestId":"agent-…-0008","name":"assets.importModel",
       "args":{"file":{"fileId":"<上一步的 fileId>","fileName":"Y Bot.glb","mimeType":"model/gltf-binary"}}}'
# → 202 + 任务快照(见 §8)
```

导出结果(视频)反向流动:任务成功结果的 `result` 是
`{fileId, fileName, mimeType, size}`,下载:

```bash
curl "$CAMERA_STUDIO_API_URL/v1/files/<fileId>" \
  -H "Authorization: Bearer $CAMERA_STUDIO_TOKEN" -o shot.webm
```

临时文件有大小上限(`maxUploadBytes`,超限 413 `PAYLOAD_TOO_LARGE`)与过期清理(默认
1 小时);**上传成功 ≠ 已入资产库**,入库以导入任务终态为准。

## 8. 任务:202、轮询与取消

`assets.importModel` 与 `exports.startVideo` 是任务型命令:`POST /v1/commands` 返
回 `202` + 初始快照(不会紧接着 404):

```json
{
  "ok": true,
  "result": {
    "jobId": "…",
    "kind": "assets.importModel",
    "state": "pending",
    "phase": "accepted",
    "progress": 0,
    "cancelable": false
  }
}
```

轮询 `GET /v1/jobs/:id` 到终
态:`pending | running | succeeded | failed | cancelled`。**`accepted` 只是「已受
理」,不是成功**;成功结果在终态快照的 `result` 里(导入是资产条目,导出是文件描述),
失败原因在 `error`。 `cancelable: true` 的任务可 `POST /v1/jobs/:id/cancel`(202
= 取消请求已转发;终态仍以轮询为准,取消成功为 `cancelled`,不支持取消的任务 409
`JOB_NOT_CANCELABLE`)。

## 9. 断连与故障语义

- 一个桥接实例只绑定**一个活动场景会话**;第二个页面连接会被拒绝并关闭, 不影响第
  一连接。
- 无页面连接时:`GET /v1/schema` 与命令返回 503 `SCENE_UNAVAILABLE`
  (`retryable: true`——页面连上后重试即可)。
- 页面断开(关标签页/崩溃):所有在途命令立即以 `SCENE_UNAVAILABLE` 失败, 非终态任
  务投影为 `failed`;命令**不会**被静默排队等「下一个页面」。
- 页面重连是新的场景会话:旧 `requestId` 去重作用域、旧 revision 都不复用。

## 10. 远程监听警告

默认只听 `127.0.0.1`。把 `--host` 改成 `0.0.0.0` 或局域网地址时,桥接**不会** 自
动放松任何安全检查——token 依旧必需、CORS 白名单依旧精确;但 token 是唯一防线,明文
HTTP 上它会被嗅探。远程部署请把桥接放在反向代理(TLS 终止 + 来源限制)之后,并照旧
显式配置 token 与精确 `corsOrigins`;不要因为「换远程了」就配 `*`。

## 11. 完整 curl 工作流(验收级)

以下序列就是 `examples/camera-host-demo` 端到端测试
(`yarn workspace camera-host-demo test:e2e`)走的那条主流程,全程纯 HTTP:

```bash
export CAMERA_STUDIO_API_URL=http://127.0.0.1:43110
export CAMERA_STUDIO_TOKEN='<由部署方提供>'
AUTH="Authorization: Bearer $CAMERA_STUDIO_TOKEN"

# 0. 健康与能力发现:先 health(scene: connected 才有命令可发),再 schema
curl -H "$AUTH" "$CAMERA_STUDIO_API_URL/v1/health"
curl -H "$AUTH" "$CAMERA_STUDIO_API_URL/v1/schema"   # 命令清单、参数 schema、错误码

# 1. 上传模型文件 → fileId(见 §7)
# 2. assets.importModel(202)→ 轮询 GET /v1/jobs/<jobId> 到 succeeded,
#    从 result.id 拿到资产条目 id(见 §8)

# 3. 放置模型(等到挂载完成才返回)
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{
    "requestId": "agent-…-0003", "name": "models.create",
    "args": {"assetId": "<资产id>", "position": {"x": 0, "y": 0, "z": 0}}}'
# → {"ok":true,"result":{"objectId":"model:Y_Bot","revision":n},"revision":n}

# 4. 读快照验证(对象清单 + 当前求值属性;无副作用)
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{
    "requestId": "agent-…-0004", "name": "scene.getSnapshot", "args": {}}'

# 5. 静态属性修改(compound 属性给完整值;可带 expectedRevision 乐观并发)
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{
    "requestId": "agent-…-0005", "name": "objects.update",
    "args": {"objectId": "model:Y_Bot",
             "props": {"position": {"x": 2, "y": 0, "z": -1}}}}'

# 6. 时长 + 关键帧 + 定位(做动画才用 keyframes.set;propPath 是叶子路径数组)
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{
    "requestId": "agent-…-0006", "name": "sequence.setLength", "args": {"length": 4}}'
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{
    "requestId": "agent-…-0007", "name": "keyframes.set",
    "args": {"objectId": "model:Y_Bot", "propPath": ["position", "x"],
             "at": 2, "value": 4}}'
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{
    "requestId": "agent-…-0008", "name": "sequence.seek", "args": {"position": 1}}'

# 7. 相机 + 路径 + 绑定(预设 id 用 paths.listPresets 查,不要猜)
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{
    "requestId": "agent-…-0009", "name": "cameras.create",
    "args": {"fromCurrentView": true}}'
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{
    "requestId": "agent-…-0010", "name": "paths.createPreset",
    "args": {"preset": "circle"}}'
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{
    "requestId": "agent-…-0011", "name": "cameras.bindPath",
    "args": {"objectId": "<camera:…>", "pathId": "<path:…>"}}'

# 8. 项目存档导出(只含 Theatre 项目状态,不含资产与会话状态)
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{
    "requestId": "agent-…-0012", "name": "project.exportState", "args": {}}'

# 9. 统一删除(带类型 ID 决定完整清理:注册表、绑定回退、选择、会话态)
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{
    "requestId": "agent-…-0013", "name": "objects.delete",
    "args": {"objectId": "model:Y_Bot"}}'
```

视频导出(任务 + 文件往返):

```bash
# sequence 调短后从指定相机导出;202 → 轮询终态 → 下载
curl -X POST "$CAMERA_STUDIO_API_URL/v1/commands" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{
    "requestId": "agent-…-0014", "name": "exports.startVideo",
    "args": {"cameraId": "<camera:…>"}}'
# 轮询 GET /v1/jobs/<jobId> 到 succeeded,result = {fileId, fileName, mimeType, size}
curl "$CAMERA_STUDIO_API_URL/v1/files/<fileId>" -H "$AUTH" -o shot.webm
```

工作流纪律(与 SKILL 一致):先 `health`/`schema`/`scene.getSnapshot` 再动手; 写后
重读验证;长任务轮询到终态再下载;重试写命令复用原 `requestId`;按 `error.code` 与
`retryable` 决定是否重试。
