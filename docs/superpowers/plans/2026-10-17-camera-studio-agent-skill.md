# Camera Studio Agent SKILL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个 Agent 可以直接发现和使用的标准 SKILL、零依赖 HTTP 客户端、命令参考和端到端工作流。

**Architecture:** `SKILL.md` 只保留触发条件、启动流程和关键决策；完整命令由运行时 schema 生成参考，长工作流和错误处理按需读取。`scene-api.mjs` 统一处理 HTTP、requestId、任务和文件，Agent 不需要手写 fetch。

**Tech Stack:** Agent SKILL/SKILL.md、Node >=18 内置 fetch/fs/test、Playwright 验收、既有 HTTP 桥接。

**Spec:** `docs/superpowers/specs/2026-10-17-camera-studio-agent-api-design.md`

**前置依赖:** `2026-10-17-camera-studio-agent-browser-api.md` 与 `2026-10-17-camera-studio-agent-http-bridge.md` 已完成，demo 可运行真实 HTTP API。

## Global Constraints

- SKILL 以 HTTP 为 Agent 入口，不要求 Agent 读取或模拟 Studio DOM。
- Token 只从 `CAMERA_STUDIO_TOKEN` 环境变量读取，不出现在命令行参数、stdout、stderr 或文档真实值中。
- `scene-api.mjs` 只使用 Node 内置模块，兼容 Node >=18，不要求全局 npm install。
- 除 `--help` 外，stdout 只输出机器可读 JSON；错误以 JSON 写 stderr 并设置非零 exit code。
- 写命令自动生成 requestId；网络重试必须显式复用原 requestId。
- `accepted` 不是成功；长任务必须 wait 到 succeeded 后再使用结果。
- 静态属性修改与关键帧写入在文档和示例中严格分开。
- `commands.md` 从 schema 生成，不手改命令表。

## Review Focus

- Token 错误或服务器错误响应包含请求细节：客户端不得把 Authorization 回显到 stderr；由 Task 1 测试锁定。
- 写命令网络失败后重试：必须能复用 requestId，不能默认生成第二个写操作；由 Task 1 测试锁定。
- 导出任务 failed/cancelled：`wait` 必须非零退出，不能下载不存在的结果；由 Task 1 测试锁定。
- 下载目标已存在：默认拒绝覆盖，只有显式 `--force` 才允许；由 Task 1 测试锁定。
- Agent 只想移动物体却误用 keyframes.set：SKILL 的决策规则必须在任何关键帧示例之前先说明 objects.update；由 Task 3 和 Task 4 检查锁定。

## File Structure

```text
.claude/skills/camera-studio-agent/
├── SKILL.md
├── references/
│   ├── commands.md
│   ├── workflows.md
│   └── errors.md
├── scripts/
│   ├── scene-api.mjs
│   └── schema-to-markdown.mjs
└── tests/
    ├── scene-api.test.mjs
    ├── schema-to-markdown.test.mjs
    └── skill-docs.test.mjs
```

`examples/camera-host-demo/src/agent-skill.e2e.ts` 负责在真实浏览器和桥接上执行 SKILL 客户端。

---

### Task 1: 零依赖 scene-api 客户端

**Files:**
- Create: `.claude/skills/camera-studio-agent/scripts/scene-api.mjs`
- Test: `.claude/skills/camera-studio-agent/tests/scene-api.test.mjs`

**Interfaces:**
- Produces CLI: `health`、`schema [command]`、`call <name> <json> [--request-id id]`、`upload <path> [--mime type]`、`job <jobId>`、`wait <jobId> [--interval-ms n] [--timeout-ms n]`、`cancel <jobId>`、`download <fileId> <output> [--force]`。
- Consumes: `CAMERA_STUDIO_API_URL` 默认 `http://127.0.0.1:43110`，`CAMERA_STUDIO_TOKEN` 必填。

- [ ] **Step 1: 写 CLI 行为测试**

使用 `node:test` 和本地 `http.createServer`，通过 `execFile(process.execPath,[script,...args],{env})` 调用真实脚本。覆盖：

```js
import {execFile} from 'child_process'
import {promisify} from 'util'
import {fileURLToPath} from 'url'
const execFileAsync = promisify(execFile)
const script = fileURLToPath(new URL('../scripts/scene-api.mjs', import.meta.url))

async function runCli(args) {
  const {stdout} = await execFileAsync(process.execPath, [script, ...args], {
    env: {
      ...process.env,
      CAMERA_STUDIO_API_URL: server.baseUrl,
      CAMERA_STUDIO_TOKEN: 'test-secret',
    },
  })
  return {json: JSON.parse(stdout)}
}

test('call emits json and reuses an explicit request id', async () => {
  const first = await runCli(['call', 'models.create', '{"assetId":"m1"}', '--request-id', 'retry-1'])
  const second = await runCli(['call', 'models.create', '{"assetId":"m1"}', '--request-id', 'retry-1'])
  assert.equal(first.json.objectId, 'model:one')
  assert.equal(second.json.objectId, 'model:one')
  assert.equal(server.receivedRequestIds.filter((id) => id === 'retry-1').length, 2)
})
```

另测：缺 token 在发请求前失败；401 只输出 `UNAUTHORIZED`，不含 secret；`call` 自动生成的 requestId 是非空 UUID；`schema cameras.create` 只输出该命令；无效 JSON 在发请求前退出 2。

- [ ] **Step 2: 写任务和文件测试**

fake server 依次返回 running、succeeded，`wait` 输出最终 succeeded；failed/cancelled 退出 1 且不调用 download。上传非 UTF-8 文件后服务器收到的 Buffer 完全一致，`X-File-Name` 可解码为原文件名。下载已存在文件默认退出 1 且内容不变，`--force` 才覆盖；下载失败不留下半文件。

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test .claude/skills/camera-studio-agent/tests/scene-api.test.mjs`  
Expected: FAIL，脚本不存在。

- [ ] **Step 4: 实现 HTTP 核心和错误输出**

```js
const baseUrl = (process.env.CAMERA_STUDIO_API_URL ?? 'http://127.0.0.1:43110').replace(/\/$/, '')
const token = process.env.CAMERA_STUDIO_TOKEN

class CliError extends Error {
  constructor(code, message, exitCode, details) {
    super(message)
    this.code = code
    this.exitCode = exitCode
    this.details = details
    this.retryable = details?.retryable ?? false
  }
}

function requireToken() {
  if (!token) throw new CliError('UNAUTHORIZED', 'CAMERA_STUDIO_TOKEN is required', 2)
}

async function request(path, options = {}) {
  requireToken()
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${baseUrl}${path}`, {...options, headers})
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok === false) {
    const error = body?.error ?? {code: 'NETWORK_ERROR', message: `HTTP ${response.status}`, retryable: response.status >= 500}
    throw new CliError(error.code, error.message, 1, error)
  }
  return body.result
}
```

网络异常单独捕获，只输出 `error.name/message` 和 URL origin，不输出 headers。`request` 统一返回 HTTP envelope 中的 `result`，因此 health/schema/call/job/upload 的 stdout 都是该领域结果本身，例如 `models.create` 直接输出 `{objectId,revision}`；schema 可直接管道给 Markdown 转换器。所有成功输出使用 `JSON.stringify(result,null,2)`；所有错误输出 `{ok:false,error:{code,message,retryable,details?}}`。

- [ ] **Step 5: 实现完整 CLI 分派**

`call` 解析 JSON 后发送 `{requestId: parsedFlag ?? randomUUID(),name,args}`，其中 `randomUUID` 从 Node `crypto` 显式导入；`upload` 用 `fs.createReadStream` 和 `duplex:'half'`，`X-File-Name` 为 `encodeURIComponent(basename(path))`；`wait` 只在 `pending/running` 时继续，timeout 返回 `NETWORK_ERROR` 且 `retryable:true`；`download` 先写入同目录临时文件，成功后 rename，已存在目标且无 `--force` 时拒绝。

实现 `--help`，逐行列出上述命令和两个环境变量，不打印 Token 值。

- [ ] **Step 6: 运行测试并提交**

Run: `node --test .claude/skills/camera-studio-agent/tests/scene-api.test.mjs`  
Expected: PASS。  
Run: `node .claude/skills/camera-studio-agent/scripts/scene-api.mjs --help`  
Expected: 输出全部命令，exit 0。

```bash
git add .claude/skills/camera-studio-agent/scripts .claude/skills/camera-studio-agent/tests
git commit -m "feat(camera-studio): add agent skill http client"
```

---

### Task 2: 从运行时 schema 生成命令参考

**Files:**
- Create: `.claude/skills/camera-studio-agent/scripts/schema-to-markdown.mjs`
- Create: `.claude/skills/camera-studio-agent/references/commands.md`
- Test: `.claude/skills/camera-studio-agent/tests/schema-to-markdown.test.mjs`

**Interfaces:**
- Consumes: `GET /v1/schema` 的 `{apiVersion,commands}` JSON。
- Produces: stdin JSON → stdout Markdown 的零依赖转换器。

- [ ] **Step 1: 写 Markdown 生成测试**

输入包含 query、project mutation 和 job 三条命令，断言输出按名称排序，包含 apiVersion、参数/结果 JSON Schema、undoable、stateDomain、completion、cancelable、errorCodes 和 `expectedRevision` 支持标记；job 还必须输出 `jobResultSchema`。断言 `validate`、`execute` 或函数源码不进入 Markdown。

- [ ] **Step 2: 写畸形 schema 测试**

缺 commands、命令缺 name、inputSchema/outputSchema 或重复 name 时非零退出并输出 `INVALID_ARGUMENT`，不生成半截成功文本。

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test .claude/skills/camera-studio-agent/tests/schema-to-markdown.test.mjs`  
Expected: FAIL，转换器不存在。

- [ ] **Step 4: 实现转换器**

脚本从 stdin 读取完整 JSON，逐命令输出：

````md
## `objects.update`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object"}
```

### Output

```json
{"type":"object"}
```

### Errors

`INVALID_ARGUMENT`, `OBJECT_NOT_FOUND`, `REVISION_CONFLICT`
````

文件头固定写明“由 schema-to-markdown.mjs 生成，请勿手改”和生成所用 apiVersion；不插入当前时间，保证同 schema 输出可重复。命令带 `jobResultSchema` 时，在 Output 后追加同级 `### Job result` 和对应 JSON Schema。

- [ ] **Step 5: 生成参考并验证**

在 demo/bridge 运行时执行：

```bash
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs schema \
  | node .claude/skills/camera-studio-agent/scripts/schema-to-markdown.mjs \
  > .claude/skills/camera-studio-agent/references/commands.md
```

Run: `node --test .claude/skills/camera-studio-agent/tests/schema-to-markdown.test.mjs`  
Expected: PASS。  
Run: 重复上述生成命令并 `git diff --exit-code -- .claude/skills/camera-studio-agent/references/commands.md`  
Expected: 无差异。

```bash
git add .claude/skills/camera-studio-agent
git commit -m "docs(camera-studio): generate agent command reference"
```

---

### Task 3: 编写 SKILL、工作流和错误指南

**Files:**
- Create: `.claude/skills/camera-studio-agent/SKILL.md`
- Create: `.claude/skills/camera-studio-agent/references/workflows.md`
- Create: `.claude/skills/camera-studio-agent/references/errors.md`
- Test: `.claude/skills/camera-studio-agent/tests/skill-docs.test.mjs`

**Interfaces:**
- Consumes: Task 1 CLI 和 Task 2 命令参考。
- Produces: Agent 可直接加载的 `SKILL.md`，name 为 `camera-studio-agent`。

- [ ] **Step 1: 编写前加载技能编写规范**

执行者必须先使用 `superpowers:writing-skills`，按其中的触发描述、渐进披露和验证要求编写；不另造与 Agent Skills 不兼容的目录结构。

- [ ] **Step 2: 写文档结构失败测试**

`skill-docs.test.mjs` 断言：SKILL frontmatter 只含合法 name/description；description 明确“操作 camera-studio 场景、模型、相机、路径、姿势、动画和 HTTP API”的触发意图；所有相对 Markdown 链接文件存在；所有 `scene-api.mjs` 子命令在 Task 1 CLI 帮助中存在；`objects.update` 的静态/关键帧决策段位于第一个 `keyframes.set` 示例之前；不出现 `Bearer ` 后真实 token、`eval(` 或 `TODO`。

- [ ] **Step 3: 运行文档测试确认失败**

Run: `node --test .claude/skills/camera-studio-agent/tests/skill-docs.test.mjs`  
Expected: FAIL，SKILL.md 不存在。

- [ ] **Step 4: 编写 SKILL.md**

正文保持短小并采用以下实际操作顺序：

```md
---
name: camera-studio-agent
description: Use when an agent needs to inspect or operate a camera-studio scene through its HTTP API, including models, assets, poses, gestures, animations, cameras, anchors, paths, sequence keyframes, and video export.
---

# Camera Studio Agent

Use `scripts/scene-api.mjs` for every scene operation. Do not click Studio DOM controls or guess object IDs.

## Setup

Require `CAMERA_STUDIO_API_URL` and `CAMERA_STUDIO_TOKEN` from the deployer. Never print the token.

1. Run `health`.
2. Run `schema` and read `references/commands.md` for detailed DTOs.
3. Run `call scene.getSnapshot '{}'` and use the returned typed IDs.

## Decide before writing

- Change a static object: `objects.update`.
- Animate a property: `keyframes.set`.
- Import an asset: upload, `assets.importModel`, then `wait`.
- Place a model: `models.create` after import resolves successfully.
- Retry a write after transport failure: reuse the original requestId.
- Read after writing. A job acceptance or resource loading state is not final success.

## Recipes and failures

Read `references/workflows.md` for end-to-end recipes and `references/errors.md` for recovery rules.
```

补充 CLI 路径解析规则：所有示例均从仓库根目录执行；如果 Agent 当前目录不同，先解析 SKILL 自身目录再使用绝对脚本路径。

- [ ] **Step 5: 编写完整工作流**

`workflows.md` 至少包含以下独立示例，每个示例都写明前置读取、命令、结果验证和失败停止条件：

1. 上传 GLB → `assets.importModel` → `wait` → `models.create` → `objects.get`。
2. `poses.apply` 与 `poses.setGesture` → `animations.apply` → `animations.getStatus`。
3. `cameras.create` → `paths.createPreset` → `cameras.bindPath` → `paths.sample`。
4. `sequence.setLength` → `keyframes.set` → `sequence.seek` → `keyframes.list`。
5. `exports.startVideo` → `wait` → 从 result.fileId `download`。
6. 使用 `expectedRevision` 的更新冲突后重新读取，以及使用同一 requestId 的安全重试。

`errors.md` 按错误码给出 Agent 下一步：未就绪先 health/重连，不存在先重新 list，revision 冲突重新读取，资产错误不可依赖 undo，任务失败读取 error 后停止，CORS/鉴权交给部署者配置而不是尝试绕过。

- [ ] **Step 6: 运行文档检查并提交**

Run: `node --test .claude/skills/camera-studio-agent/tests/*.test.mjs`  
Expected: PASS。

```bash
git add .claude/skills/camera-studio-agent
git commit -m "docs(camera-studio): add agent skill workflows"
```

---

### Task 4: 在真实 demo 上验证 SKILL 和最终验收

**Files:**
- Create: `examples/camera-host-demo/src/agent-skill.e2e.ts`
- Modify: `examples/camera-host-demo/package.json`
- Modify: `docs/guides/camera-studio-agent-http.md`

**Interfaces:**
- Consumes: 第二段真实 demo/bridge 和 Task 1 CLI。
- Produces: 直接执行 SKILL 客户端的端到端验证，而非在测试中重写一套 HTTP helper。

- [ ] **Step 1: 写真实 SKILL 冒烟测试**

Playwright 启动 demo 后，用 `execFile(process.execPath,[skillScript,...])` 依次执行：health、schema、scene.getSnapshot、models.create（使用已通过 SKILL upload/import 工作流得到的资产）、objects.update、objects.get、cameras.create、paths.createPreset、keyframes.set、project.exportState。断言每一步只依据上一步 JSON 输出构造参数，测试代码不直接读取 SheetObject 来替代 API 验证。

- [ ] **Step 2: 加入 revision 与重试验收**

第一次 snapshot 取得 revision 后，通过页面内 JS API 修改一次模型位置，再用旧 expectedRevision 调 HTTP objects.update，断言 `REVISION_CONFLICT`。对同一 models.create 使用相同 requestId 重试，场景只新增一个模型。Asset delete 后调用 history.undo，文档级测试确认 SKILL 明确提示资产不因此恢复。

- [ ] **Step 3: 运行真实验收**

Run: `yarn workspace camera-host-demo test:e2e -- --grep "agent skill"`  
Expected: PASS；若视频导出在前一段被环境 skip，本任务不得借此宣称视频成功。

- [ ] **Step 4: 补充宿主发现 SKILL 的说明**

在 HTTP 指南中加入 SKILL 路径、Node >=18、环境变量、从仓库根调用方式，以及“运行时 schema 是命令事实源”的说明。不复制完整命令表到宿主指南。

- [ ] **Step 5: 执行三段总验证**

Run: `node --test .claude/skills/camera-studio-agent/tests/*.test.mjs`  
Expected: PASS。  
Run: `yarn test packages/camera-studio/src/agent packages/camera-studio-bridge/src --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:api && yarn workspace @dreamerbird/camera-studio-bridge build:ts && yarn workspace camera-host-demo build`  
Expected: PASS。  
Run: `yarn workspace camera-host-demo test:e2e`  
Expected: PASS，并明确记录任何环境性 skip。

- [ ] **Step 6: 更新 graft 并提交**

Run: `graft build`  
Expected: PASS。

```bash
git add .claude/skills/camera-studio-agent examples/camera-host-demo docs/guides graft
git commit -m "test(camera-studio): verify agent skill end to end"
```

**第三段完成判据:** Agent 仅阅读 SKILL 并使用随附客户端即可完成规格中的常见场景工作流；命令参考与运行时 schema 一致，Token、重试、任务和文件安全规则均有测试。
