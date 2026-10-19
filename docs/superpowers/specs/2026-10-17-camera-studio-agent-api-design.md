# Camera Studio Agent API 与 HTTP 桥接设计

日期：2026-10-17  
状态：设计已逐节确认，待书面规格复核

## 1. 背景

`camera-studio` 当前通过 `CameraFlows / onFlows` 暴露少量宿主流程：模型放置、模型导入、路径预设、添加相机、添加锚点、取消放置和落点换算。大量场景操作仍散落在 `CameraScene`、React 闭包、Three 运行时和 Theatre core/studio 内部接口中，外部 Agent 无法以稳定、可发现、可验证的方式操作完整场景。

本设计建立一套浏览器内领域 API，并提供本机 HTTP 桥接和标准 Agent Skill。JS 与 HTTP 共用同一份命令定义和领域实现，不通过 DOM 点击模拟 UI，也不开放任意原始状态写入。

## 2. 目标

1. 为宿主提供稳定、类型化的 `CameraStudioApi` JS 接口。
2. 为外部 Agent 提供仅 HTTP 的调用入口，浏览器与桥接进程之间可使用内部 WebSocket。
3. 覆盖模型、资产、姿势、手势、动画、相机、锚点、路径、时间轴、关键帧、选择、视图、UI、历史、项目导出和视频导出。
4. 让每个命令具备可发现的参数、结果、错误、撤销和完成阶段语义。
5. 区分持久项目状态、资产库状态、会话状态和异步任务状态。
6. 提供标准 SKILL、参考文档和轻量客户端脚本，使 Agent 无需阅读源码即可完成常见工作流。
7. 保持现有 `CameraFlows / onFlows` 和宿主嵌入方式兼容。

## 3. 非目标

1. 不提供 `eval`、任意 JavaScript 执行或任意 Theatre 原始状态写入。
2. 不把启动时 `initialState` 伪装成运行时热导入；首版不实现替换当前项目的运行时导入命令。
3. 不向外部 Agent 提供 WebSocket 事件流；外部状态更新通过 HTTP 查询取得。
4. 首版一个桥接实例只绑定一个活动场景，不设计多项目、多页面的路由和权限模型。
5. 不将资产库操作包装成 Theatre 历史事务，也不承诺 `history.undo` 能恢复资产变化。
6. 不通过 DOM 自动化作为正式 Agent API 的实现方式。

## 4. 已确认的部署决策

- 外部 Agent 仅使用 HTTP。
- 页面与本地桥接进程之间使用 WebSocket 传输命令、结果和进度。
- 默认监听 `127.0.0.1`，要求 Bearer Token，不开放宽泛 CORS。
- 监听地址、端口、鉴权、CORS、上传限制和启用状态均可由植入应用调整。
- 改成局域网或远程监听时，不自动取消 Token 或放宽 CORS。
- 浏览器默认不连接桥接，也不挂载全局 `window` API；均由宿主显式启用。

## 5. 总体架构

```text
外部 Agent
   │ HTTP + Bearer Token
   ▼
@dreamerbird/camera-studio-bridge
   │ 内部 WebSocket：命令、结果、任务进度
   │ 内部 HTTP：文件字节
   ▼
浏览器中的 CameraStudioApi
   │
   ├─ 查询适配层：注册表、Theatre 对象、实时求值值
   ├─ 领域命令层：模型、相机、路径、姿势、动画等
   ├─ Scene Runtime：React/Three 挂载、会话、canvas、导出
   ├─ Theatre core/studio：事务、选择、sequence、历史、UI
   └─ Library：资产读写、导入队列、blob
```

核心约束：

1. `CameraStudioApi` 是唯一场景操作入口，HTTP 桥接只负责传输、鉴权、任务和文件适配。
2. 命令元数据是唯一契约来源，用于 JS 类型、HTTP schema、错误文档和 SKILL 命令参考。
3. 查询与命令分离；查询不得因 `sheet.object()` 或路径读取而意外创建对象。
4. 只有必须访问 React/Three 的操作才进入 Scene Runtime；纯数据和纯计算操作留在可独立测试的领域模块。
5. 私有 core/studio 接口集中在内部适配层，优先使用公共 API。

## 6. 模块边界

### 6.1 `camera-studio` 浏览器包

新增内部 Agent 运行时，职责包括：

- 命令注册、schema、校验、错误和结果封装；
- 带类型 ID 解析和无副作用对象查询；
- 场景快照与实时属性读取；
- 领域命令编排、事务和撤销粒度；
- React/Three 挂载完成、资源加载和会话操作；
- 异步任务、取消和 disposed 生命周期；
- 可选桥接客户端和可选全局 JS 暴露。

### 6.2 `@dreamerbird/camera-studio-bridge`

新增独立 Node 包，避免 Node 依赖进入浏览器构建。职责包括：

- HTTP 路由、JSON DTO 校验和 Bearer 鉴权；
- WebSocket 页面连接管理；
- `requestId` 去重、超时、任务状态和取消转发；
- 上传、下载、临时文件和大小限制；
- 页面断连、场景不可用和任务失败映射。

桥接不包含模型、路径、姿势等领域规则。

### 6.3 现有 UI 与 `CameraFlows`

现有 `CameraFlows / onFlows` 保留。其内部逐步改为调用同一领域服务，保证 UI 与 Agent 行为一致。新能力通过正式包出口公开，不要求宿主深导入 `src` 文件。

## 7. JS API 与生命周期

`useCameraStudio` 返回稳定的 `api` 句柄；直接使用 `initCameraStudio` 的高级宿主也能从启动上下文取得同一实例。

```ts
const {ready, error, sceneProps, api} = useCameraStudio(config)
await api.ready
const snapshot = await api.scene.getSnapshot()
```

生命周期规则：

1. `api.ready` 在 project、studio 和 Scene Runtime 都可用后完成，而不只等待 React 首次渲染。
2. 页面卸载或会话拆解后，API 进入 disposed；后续调用以 `API_DISPOSED` 失败。
3. 页面断连时，桥接使尚未完成的远程命令失败或按命令能力取消，不把命令静默排队到未知页面。
4. 宿主显式配置 `exposeGlobal` 后，API 才挂载为 `window.__cameraStudioApi`；卸载时清除。
5. 命令注册表使用稳定句柄和惰性依赖读取，避免缓存陈旧 React 闭包。

## 8. 命令契约

### 8.1 命令元数据

每个命令定义以下元数据：

- `name`：如 `objects.update`；
- `kind`：`query | mutation | job`；
- `stateDomain`：`project | asset | session | transport`；
- `undoable`：`single-step | none`；
- `completion`：修改和任务命令声明 `committed | mounted | loaded`，查询命令省略；
- `inputSchema` 与 `outputSchema`；
- 可用能力条件和稳定错误码；
- 是否支持取消及是否接受 `expectedRevision`。

`api.describe()` 和 `GET /v1/schema` 返回 API 版本、命令元数据、当前能力和支持的错误码。只发布真实可用的命令，不发布空壳方法。

### 8.2 JS 与 HTTP 调用

JS 使用命名空间方法：

```ts
await api.objects.update({
  objectId: 'model:Y Bot',
  props: {position: {x: 2, y: 0, z: -1}},
})
```

HTTP 使用同名命令：

```http
POST /v1/commands
Authorization: Bearer <token>
Content-Type: application/json

{
  "requestId": "agent-20261017-0001",
  "name": "objects.update",
  "args": {
    "objectId": "model:Y Bot",
    "props": {
      "position": {"x": 2, "y": 0, "z": -1}
    }
  }
}
```

除二进制文件需要在传输层进行 `File / Blob / fileId` 适配外，JS 与 HTTP 使用相同 DTO、结果和错误语义。

### 8.3 结果与错误

成功结果：

```json
{
  "ok": true,
  "result": {},
  "revision": 42
}
```

`revision` 只在结果涉及持久项目状态时返回。长任务由 HTTP `202` 返回 `jobId` 和初始任务状态。

失败结果：

```json
{
  "ok": false,
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "场景已在读取后发生变化",
    "retryable": false,
    "details": {
      "expectedRevision": 41,
      "actualRevision": 42
    }
  }
}
```

HTTP 同时使用合适的状态码：参数错误为 `400/422`，鉴权失败为 `401/403`，资源不存在为 `404`，revision 或状态冲突为 `409`，场景未连接为 `503`，未处理内部错误为 `500`。HTTP 状态表达传输和结果类别，`error.code` 才是 Agent 的稳定分支依据。

内部静默 `return`、`console.warn` 或未挂载 `null` 不得直接翻译成成功。

### 8.4 带类型 ID

场景对象使用以下稳定 ID：

- `model:<key>`；
- `camera:<key>`；
- `anchor:<key>`；
- `path:<key>`。

显示名称只用于搜索和展示，不作为主键。资产 ID、路径点 ID、Theatre 完整对象地址和骨骼锚点 ID 属于不同命名空间，不能互相代替。命令在解析时同时校验类型和存在性，类型不匹配返回 `INVALID_ID_KIND`。

`revision` 是当前浏览器场景会话内的单调递增项目版本，页面重载或新会话后不得复用旧 revision。

### 8.5 `requestId` 与 `expectedRevision`

- 所有 HTTP 命令携带 `requestId`；轻量客户端自动生成，也允许调用者显式提供。
- 写命令在同一桥接和场景会话内按 `requestId` 去重，重复请求返回第一次的结果，不重复创建对象或关键帧。
- 去重不承诺跨桥接重启持久保存。
- 项目写命令可选接受 `expectedRevision`；不匹配时返回 `REVISION_CONFLICT`，不执行写入。
- 资产和会话命令不使用项目 revision 伪装并发保护。

### 8.6 事务与撤销

1. 项目写命令在事务外完成文件、网络、异步等待和数据准备，在同步事务回调内完成 Theatre 写入，不跨 `await` 使用事务 API。
2. 一个高层项目命令默认只产生一个清晰的撤销步骤。首次建轨再写值、删除对象再清注册表等内部细节必须被重新编排，不暴露为多步历史噪音。
3. `undoable: single-step` 只用于 Theatre 项目状态。
4. 资产导入、重命名、删除、保存姿势以及视图/UI 会话操作标记为 `undoable: none`。
5. 查询、播放、暂停和定位不制造项目撤销记录。
6. 资产导入后再放置模型不是跨资产库与项目状态的原子操作，SKILL 按两个命令表达，不声称可整体回滚。

### 8.7 完成阶段与任务

以下阶段必须区分：

1. 命令已接受；
2. 项目或资产数据已提交；
3. React/Three 对象已挂载；
4. 动画、姿势或其他资源已加载。

同步命令只有在自身 `completion` 声明的阶段到达后才返回成功。无法在合理请求周期内完成的操作返回任务句柄。`accepted` 不等于最终成功。

任务状态为：

```text
pending | running | succeeded | failed | cancelled
```

任务结果包含进度、当前阶段、错误和输出引用。只有元数据标记可取消的任务才接受 `jobs.cancel`，其他任务返回 `JOB_NOT_CANCELABLE`。

## 9. 操作覆盖

| 命名空间 | 方法 | 语义 |
|---|---|---|
| `scene` | `getSnapshot` | 返回项目 revision、带类型对象清单、当前求值属性、挂载与资源状态；无副作用 |
| `selection` | `get`、`selectObject`、`clear` | 管理 Theatre 对象选择；清空时同时清理相关会话选择 |
| `objects` | `list`、`get`、`update`、`delete` | 读取、静态属性更新和按类型执行完整删除清理 |
| `models` | `create` | 从模型资产直接创建到指定位置，可带初始变换，等待声明的完成阶段 |
| `assets` | `list`、`get`、`importModel`、`rename`、`delete` | 管理模型、姿势和动画资产；不属于 Theatre undo |
| `poses` | `apply`、`applyCustom`、`clear`、`saveCurrent`、`setGesture` | 库姿势、自定义骨骼姿势、清除、保存和左右手势 |
| `poses.session` | `start`、`commit`、`cancel` | 管理需要已挂载 Rig 的 IK 姿势会话 |
| `animations` | `apply`、`clear`、`getStatus` | 设置/清除动画资产并独立查询资源加载状态 |
| `cameras` | `create`、`setActive`、`setAimTarget`、`bindPath`、`unbindPath` | 相机创建、活动镜头、瞄准目标和路径绑定 |
| `anchors` | `create`、`setParent`、`clearParent` | 锚点创建、父级/骨骼绑定及坐标换算 |
| `paths` | `listPresets`、`createPreset`、`addPoint`、`updatePoint`、`deletePoint`、`setPointTiming`、`sample` | 路径预设、控制点、手柄、自动/固定 `u` 和运行时采样 |
| `paths.session` | `startEditing`、`exitEditing`、`selectPoint` | 路径编辑态和控制点选择 |
| `sequence` | `getState`、`play`、`pause`、`seek`、`setLength` | 播放、暂停、定位、可选网格吸附和时长 |
| `keyframes` | `list`、`set`、`move`、`delete` | 显式关键帧读取、创建、移动和删除 |
| `history` | `undo`、`redo` | Theatre 项目历史，不处理资产或会话状态 |
| `view` | `getState`、`setShotView`、`setPipVisible`、`orbit`、`pan`、`dolly`、`reset` | 活动镜头视图、PIP 和导演视角会话 |
| `ui` | `hide`、`restore`、`setLeftStripHidden`、`openPanel`、`closePanel`、`setGizmoMode` | 现有 Studio 和 CameraScene UI 操作 |
| `project` | `exportState` | 导出 Theatre 项目存档，不包含资产和会话状态 |
| `exports` | `startVideo` | 从指定或活动相机导出视频，返回任务 ID |
| `jobs` | `get`、`cancel` | 查询或取消长任务 |

### 9.1 静态属性与关键帧

`objects.update` 只修改静态属性，不根据对象当前是否已建轨而改变含义。`props` 是顶层属性 patch；compound 属性必须提供完整有效值，不做任意深层合并。

写关键帧必须显式调用 `keyframes.set`，并明确对象、属性路径、位置和是否吸附。首次建轨和写值合并为一个领域命令。`keyframes.move` 和 `sequence.setLength` 如必须使用 Studio 内部能力，只能经内部适配层完成并配套行为测试。

姿势、手势、动画和路径绑定的普通命令默认写静态值；其可动画属性通过 `keyframes.*` 显式建轨或写帧。

### 9.2 删除

统一使用 `objects.delete`，不重复提供同义的 `models.delete`、`cameras.delete` 或 `paths.delete`。带类型 ID 决定清理行为，包括：

- Theatre 对象和持久注册表；
- 相机与路径绑定回退；
- 当前选择和路径控制点选择；
- 路径编辑态、活动相机和其他必要会话状态；
- 已挂载 refs 和运行时资源。

删除失败不得只完成其中一部分却返回成功。

### 9.3 资产和项目存档

资产条目、blob、缩略图和写队列由 Library 管理。`project.exportState` 只表示 Theatre 项目存档，不包含资产、活动相机、PIP、placing、路径编辑态、姿势会话或导出任务。需要完整工作区恢复时，宿主必须分别处理项目存档与资产一致性。

## 10. HTTP 桥接

### 10.1 路由

| 路由 | 用途 |
|---|---|
| `GET /v1/health` | 返回桥接状态和浏览器场景连接状态 |
| `GET /v1/schema` | 返回 API 版本、命令、DTO、错误和能力 |
| `POST /v1/commands` | 执行命令 |
| `GET /v1/jobs/:id` | 查询任务状态和结果 |
| `POST /v1/jobs/:id/cancel` | 取消支持取消的任务 |
| `POST /v1/files` | 上传二进制文件并返回 `fileId` |
| `GET /v1/files/:id` | 下载导出结果或其他输出文件 |

所有 `/v1` 路由默认要求 Bearer Token。未知命令、任务、文件和场景对象分别返回明确的结构化错误。

### 10.2 文件传输

模型导入流程：

1. Agent `POST /v1/files` 上传字节，获得 `fileId`；
2. Agent 调用 `assets.importModel`，引用该 `fileId`；
3. 浏览器通过受鉴权的内部 HTTP 通道读取字节并构造 `File`；
4. 领域层复用现有导入规划、重复检测和资产写队列；
5. 任务完成后返回正式资产条目或部分完成详情。

视频导出流程：

1. Agent 调用 `exports.startVideo`；
2. 浏览器使用既有 canvas、sequence 和导出管线；
3. 导出 Blob 通过内部 HTTP 写入桥接临时文件；
4. 任务成功结果包含 `fileId`、文件名、MIME 和大小；
5. Agent 通过 `GET /v1/files/:id` 下载。

二进制内容不进入 JSON，也不使用 Base64 经 WebSocket 来回复制。临时文件具有大小限制、过期清理和访问鉴权；上传临时文件不等于已写入资产库。

### 10.3 配置

```ts
createCameraStudioBridge({
  host: '127.0.0.1',
  port: 43110,
  token: process.env.CAMERA_STUDIO_TOKEN,
  corsOrigins: [],
  maxUploadBytes: 200 * 1024 * 1024,
})
```

桥接支持程序化配置以及命令行/环境变量配置。没有 Token 或等效显式鉴权配置时不得启动。宿主可替换鉴权校验，但必须显式操作。

浏览器 `CameraStudioConfig` 控制桥接地址、认证信息、是否连接和是否暴露全局 API。桥接监听配置的修改通过重启桥接生效；场景本身无需重建。

### 10.4 连接与故障

- 一个桥接实例只接受一个活动场景会话，避免命令路由歧义。
- 无页面连接时返回 `SCENE_UNAVAILABLE`。
- 页面 disposed 后，旧命令和任务以结构化错误结束。
- WebSocket 校验 Token 和允许的来源；HTTP CORS 与监听地址是独立配置。
- 远程监听不会自动开放任意来源，也不降低鉴权要求。

## 11. Agent SKILL

项目内交付：

```text
.claude/skills/camera-studio-agent/
├── SKILL.md
├── references/
│   ├── commands.md
│   ├── workflows.md
│   └── errors.md
└── scripts/
    └── scene-api.mjs
```

`scene-api.mjs` 只使用 Node 内置能力，支持：

- `health`；
- `schema`；
- `call <command> <json>`；
- 文件上传和下载；
- 任务查询与取消；
- 自动生成或显式复用 `requestId`。

配置通过环境变量提供：

```bash
export CAMERA_STUDIO_API_URL=http://127.0.0.1:43110
export CAMERA_STUDIO_TOKEN='<由部署方提供>'
```

Token 不写入 SKILL、示例输出或日志。

### 11.1 SKILL 工作流规则

1. 先执行 `health`、`schema` 和 `scene.getSnapshot`，不猜命令、对象 ID 或资产 ID。
2. 修改前读取目标；写后重新读取对象或任务结果验证。
3. 静态修改使用 `objects.update`，制作动画才使用 `keyframes.set`。
4. 资产导入与模型放置作为两个命令执行，并分别检查结果。
5. 对并发修改使用 `expectedRevision`；冲突后重新读取，不盲目覆盖。
6. 网络重试写命令时复用原 `requestId`。
7. 长任务持续查询到终态，再下载结果；不将 `accepted` 当成完成。
8. 资产删除、重命名、导入和保存姿势不依赖 `history.undo` 回滚。
9. 根据 `error.code` 和 `retryable` 决定是否重试，不对所有失败盲目重试。

`SKILL.md` 保持精简，完整命令、错误和长工作流放入 `references/`。`commands.md` 从命令元数据生成，避免文档漂移。另提供面向宿主开发者的 JS API 与桥接配置文档。

## 12. 稳定错误类别

首版至少定义以下错误码，具体命令在 schema 中声明自己可能返回的子集：

- `API_NOT_READY`、`API_DISPOSED`、`SCENE_UNAVAILABLE`；
- `COMMAND_NOT_FOUND`、`CAPABILITY_UNAVAILABLE`；
- `INVALID_ARGUMENT`、`INVALID_ID_KIND`；
- `OBJECT_NOT_FOUND`、`ASSET_NOT_FOUND`、`PATH_POINT_NOT_FOUND`；
- `INVALID_STATE`、`REVISION_CONFLICT`；
- `JOB_NOT_FOUND`、`JOB_NOT_CANCELABLE`、`JOB_CANCELLED`；
- `FILE_NOT_FOUND`、`PAYLOAD_TOO_LARGE`；
- `UNAUTHORIZED`、`FORBIDDEN`；
- `STORAGE_ERROR`、`NETWORK_ERROR`、`RESOURCE_LOAD_FAILED`；
- `PARTIAL_FAILURE`、`INTERNAL_ERROR`。

`PARTIAL_FAILURE` 的 `details` 必须列出已完成和未完成部分以及已创建的资产或对象 ID，不能只返回一个模糊失败字符串。

## 13. 验证策略

### 13.1 契约单元测试

- 命令注册和 schema 生成；
- 参数校验和带类型 ID；
- 错误码及 HTTP 映射；
- `requestId` 去重；
- `expectedRevision` 冲突；
- 文档生成与命令注册表一致。

### 13.2 领域行为测试

- 查询不创建对象；
- 静态属性与关键帧语义分离；
- compound 属性完整值校验；
- 高层命令撤销粒度；
- 相机、路径、锚点和模型删除清理；
- 资产操作不进入 Theatre undo；
- 事务回调不跨 `await`；
- 部分导入失败的结构化结果。

### 13.3 React/Three 运行时测试

- 模型创建后的挂载完成；
- 相机默认取景和锚点初始定位；
- 动画与姿势资源加载状态；
- 路径编辑态和控制点选择；
- 姿势会话前置条件；
- 活动相机、PIP、ShotView 和导出后的状态恢复；
- disposed 后调用失败。

### 13.4 桥接与端到端测试

- 同一命令经 JS 和 HTTP 调用的结果一致；
- Token、CORS、默认监听地址和上传限制；
- 页面断连、取消、重复请求和临时文件过期；
- 在 `camera-host-demo` 中通过外部 HTTP 完成：读取场景、上传并放置模型、应用姿势和动画、创建相机路径、写关键帧、播放定位、导出项目状态；
- 视频导出使用小规模浏览器冒烟，底层编码和取消使用可控测试替身；
- 直接从 SKILL 示例执行基本冒烟，无需查阅源码。

## 14. 推荐交付顺序

1. 命令契约、带类型 ID、查询、JS API、revision 和生命周期；
2. 对象、模型、资产、姿势和动画命令；
3. 相机、锚点、路径、时间轴和关键帧命令；
4. HTTP 桥接、任务、文件传输和安全测试；
5. SKILL、宿主文档、JS/HTTP 一致性和真实浏览器端到端验收。

每个阶段独立测试，但最终验收以第 9 节完整操作清单为准，不以只支持创建模型的简化版本收尾。

## 15. 验收标准

1. 宿主可通过稳定 JS API 执行第 9 节操作，并明确等待到命令声明的完成阶段。
2. 外部 Agent 仅使用 HTTP 和 SKILL 客户端即可完成相同工作流。
3. JS 与 HTTP 除二进制传输适配外共享命令契约和领域结果。
4. 所有写操作具备明确的 undoable、revision 和错误语义，不存在静默成功或空壳命令。
5. 默认桥接仅本机监听且需要 Token，宿主能够显式调整部署配置。
6. 现有 `CameraFlows / onFlows` 和正常 UI 操作保持可用，并与 Agent 命令共享行为。
7. SKILL 示例经过真实执行验证，文档与运行时 schema 一致。
