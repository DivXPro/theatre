# Camera Studio Browser Agent API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@dreamerbird/camera-studio` 内交付完整、可发现、可验证的浏览器端 `CameraStudioApi`，覆盖规格中的全部场景领域命令。

**Architecture:** 用命令注册表统一参数校验、schema、错误和执行；查询、领域写入与 React/Three Scene Runtime 分离。JS 命名空间只是同一注册表的类型化入口，现有 UI 与 `CameraFlows` 逐步复用同一领域实现。

**Tech Stack:** TypeScript 5.6、React 19、Theatre core/studio、Three、Jest/jest-esbuild、现有 `camera-studio` 资产与路径模块。

**Spec:** `docs/superpowers/specs/2026-10-17-camera-studio-agent-api-design.md`

**依赖顺序:** 本计划是三段交付的第一段；HTTP 桥接计划和 SKILL 计划依赖本计划公开的命令契约。

## Global Constraints

- 查询不得创建 SheetObject；对象解析使用注册表和无副作用探测。
- 所有场景对象 ID 使用 `model|camera|anchor|path:<key>`，资产 ID 不可混用。
- 项目写命令使用同步 Theatre 事务，事务回调不得跨 `await`。
- `objects.update` 和普通姿势/动画命令只写未建轨静态属性；已建轨时返回 `INVALID_STATE`，调用者改用 `keyframes.*`。
- 一个高层项目命令只产生一个撤销步骤；资产和会话命令标记 `undoable: none`。
- JS 方法返回结果对象并抛出 `AgentApiError`；HTTP 计划在传输层包装为 `{ok,result,revision}`。
- `expectedRevision` 统一放在各写命令的 `args` 中；`CommandContext` 只承载 requestId 和 AbortSignal，HTTP 不另设顶层 revision 字段。
- `revision` 订阅 project historic pointer，必须同时捕获 UI、人类和其他 Agent 的修改。
- 不在浏览器包中引入 Node 内置模块或桥接依赖。
- 保留 `CameraFlows / onFlows`，不破坏现有宿主。

## Review Focus

- 空场景执行 `scene.getSnapshot`：不得创建 `Placements/Cameras/Anchors/Paths` 或路径 meta 对象；由 Task 4 的无副作用测试锁定。
- 人类在 Agent 读取后通过 UI 改属性：下一次带旧 `expectedRevision` 的写入必须冲突；由 Task 3 和 Task 5 测试锁定。
- 已建轨属性调用 `objects.update`：不得悄悄新增关键帧；由 Task 5 测试锁定。
- React 卸载与重新挂载之间的调用：旧执行代次的等待命令必须失败，不得写入新场景；由 Task 15 测试锁定。
- 删除仍被相机绑定的路径：相机回退、选择、编辑态和项目历史必须一致；由 Task 14 测试锁定。

## File Structure

- `packages/camera-studio/src/agent/types.ts`：命令、schema、任务、revision 和通用 DTO。
- `packages/camera-studio/src/agent/errors.ts`：稳定错误码和 `AgentApiError`。
- `packages/camera-studio/src/agent/objectIds.ts`：带类型 ID 格式化与解析。
- `packages/camera-studio/src/agent/registry.ts`：命令注册、校验、describe 和执行。
- `packages/camera-studio/src/agent/runtime.ts`：historic revision、执行代次、Scene Runtime handler 和任务管理。
- `packages/camera-studio/src/agent/commands/`：按领域划分的查询与命令模块。
- `packages/camera-studio/src/agent/runtime/`：挂载等待、姿势会话、导演视角和导出等 React/Three 适配。
- `packages/camera-studio/src/agent/api.ts`：公开 JS 命名空间和生命周期门面。
- `packages/camera-studio/src/agent/registerCommands.ts`：一次性注册全部领域命令。
- `packages/camera-studio/src/config.ts`、`bootstrap.ts`、`useCameraStudio.ts`、`index.ts`：宿主接入和公开导出。
- `packages/camera-studio/src/CameraScene.tsx` 及现有领域组件：绑定真实 Scene Runtime，不复制领域规则。

---

### Task 1: 通用契约、错误和带类型 ID

**Files:**
- Create: `packages/camera-studio/src/agent/types.ts`
- Create: `packages/camera-studio/src/agent/errors.ts`
- Create: `packages/camera-studio/src/agent/objectIds.ts`
- Test: `packages/camera-studio/src/agent/objectIds.test.ts`
- Test: `packages/camera-studio/src/agent/errors.test.ts`

**Interfaces:**
- Produces: `Vec3`、`SceneObjectKind`、`SceneObjectId`、`JsonSchema`、`JobState`、`JobSnapshot<T>`、`CommandDefinition<A,R>`、`CommandContext`。
- Produces: `parseSceneObjectId(id: string): {kind: SceneObjectKind; key: string}`、`formatSceneObjectId(kind, key): SceneObjectId`。
- Produces: `AgentApiError extends Error {code; retryable; details?}`、规格第 12 节全部错误码以及 `KEYFRAME_NOT_FOUND` 的联合类型。

- [ ] **Step 1: 写失败的 ID 与错误测试**

```ts
import {formatSceneObjectId, parseSceneObjectId} from './objectIds'
import {AgentApiError} from './errors'

test('round trips typed ids and preserves additional colons in keys', () => {
  const id = formatSceneObjectId('model', 'Rig:Left')
  expect(id).toBe('model:Rig:Left')
  expect(parseSceneObjectId(id)).toEqual({kind: 'model', key: 'Rig:Left'})
})

test.each(['unknown:x', 'model:', 'model'])('rejects %s', (value) => {
  expect(() => parseSceneObjectId(value)).toThrow(AgentApiError)
})

test('errors expose stable machine fields', () => {
  const error = new AgentApiError('REVISION_CONFLICT', 'stale', {
    retryable: false,
    details: {actualRevision: 2},
  })
  expect(error).toMatchObject({
    code: 'REVISION_CONFLICT',
    retryable: false,
    details: {actualRevision: 2},
  })
})
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `yarn test packages/camera-studio/src/agent/objectIds.test.ts packages/camera-studio/src/agent/errors.test.ts --runInBand`  
Expected: FAIL，提示找不到 `./objectIds` 或 `./errors`。

- [ ] **Step 3: 实现通用类型和错误**

`types.ts` 至少定义：

```ts
export type Vec3 = {x: number; y: number; z: number}
export type SceneObjectKind = 'model' | 'camera' | 'anchor' | 'path'
export type SceneObjectId = `${SceneObjectKind}:${string}`
export type JobState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type CompletionPhase = 'committed' | 'mounted' | 'loaded'
export type JsonSchema = {
  type?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: readonly (string | number | boolean | null)[]
  additionalProperties?: boolean | JsonSchema
}
export type JobSnapshot<T = unknown> = {
  jobId: string
  kind: string
  state: JobState
  progress: number
  phase: 'accepted' | CompletionPhase
  result?: T
  error?: {code: string; message: string; retryable: boolean; details?: unknown}
  cancelable: boolean
}
export type CommandContext = {
  requestId: string
  signal: AbortSignal
}
export type CommandDefinition<A, R> = {
  name: string
  kind: 'query' | 'mutation' | 'job'
  stateDomain: 'project' | 'asset' | 'session' | 'transport'
  undoable: 'single-step' | 'none'
  completion?: CompletionPhase
  cancelable?: boolean
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  jobResultSchema?: JsonSchema
  errorCodes: readonly string[]
  validate: (value: unknown) => A
  execute: (args: A, context: CommandContext) => Promise<R>
}
```

`AgentApiError` 的构造参数为 `(code, message, {retryable = false, details} = {})`；`errors.ts` 导出规格第 12 节全部错误码以及 `KEYFRAME_NOT_FOUND` 的联合类型，并用 `asAgentApiError` 保留已有结构化错误、包装未知异常为 `INTERNAL_ERROR`。

- [ ] **Step 4: 实现只按第一个冒号分隔的 ID 解析**

```ts
import {AgentApiError} from './errors'
import type {SceneObjectId, SceneObjectKind} from './types'

const kinds = new Set<SceneObjectKind>(['model', 'camera', 'anchor', 'path'])

export function formatSceneObjectId(
  kind: SceneObjectKind,
  key: string,
): SceneObjectId {
  if (!key) throw new AgentApiError('INVALID_ARGUMENT', '对象 key 不能为空')
  return `${kind}:${key}`
}

export function parseSceneObjectId(id: string) {
  const separator = id.indexOf(':')
  const kind = separator > 0 ? id.slice(0, separator) : ''
  const key = separator > 0 ? id.slice(separator + 1) : ''
  if (!kinds.has(kind as SceneObjectKind) || !key) {
    throw new AgentApiError('INVALID_ID_KIND', `无效场景对象 ID: ${id}`)
  }
  return {kind: kind as SceneObjectKind, key}
}
```

- [ ] **Step 5: 运行测试和类型检查**

Run: `yarn test packages/camera-studio/src/agent/objectIds.test.ts packages/camera-studio/src/agent/errors.test.ts --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/camera-studio/src/agent
git commit -m "feat(camera-studio): add agent command primitives"
```

---

### Task 2: 命令注册表、运行时校验与 schema

**Files:**
- Create: `packages/camera-studio/src/agent/registry.ts`
- Create: `packages/camera-studio/src/agent/validation.ts`
- Test: `packages/camera-studio/src/agent/registry.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `CommandDefinition`、`CommandContext`、`JsonSchema` 和 `AgentApiError`。
- Produces: `AgentCommandRegistry.register(def)`、`execute(name,args,context)`、`describe()`、`has(name)`。
- Produces: `describe()` 返回 `{apiVersion: 1, commands: CommandDescription[]}`；`CommandDescription` 在 registry.ts 导出，包含除 validate/execute 外的命令元数据、schema 和 `acceptsExpectedRevision`，后续 SKILL 和 HTTP schema 使用该对象。

- [ ] **Step 1: 写注册、校验和 schema 测试**

```ts
import {AgentCommandRegistry} from './registry'
import {AgentApiError} from './errors'

const context = {requestId: 'r1', signal: new AbortController().signal}

test('validates args and returns the domain result', async () => {
  const registry = new AgentCommandRegistry()
  registry.register({
    name: 'test.double', kind: 'query', stateDomain: 'transport', undoable: 'none',
    inputSchema: {type: 'object'}, outputSchema: {type: 'number'}, errorCodes: [],
    validate: (value) => {
      if (typeof value !== 'number') {
        throw new AgentApiError('INVALID_ARGUMENT', 'number expected')
      }
      return value
    },
    execute: async (value) => value * 2,
  })
  await expect(registry.execute('test.double', 3, context)).resolves.toBe(6)
  await expect(registry.execute('test.double', '3', context)).rejects.toMatchObject({
    code: 'INVALID_ARGUMENT',
  })
  const description = registry.describe()
  expect(description.apiVersion).toBe(1)
  expect(description.commands[0]).toMatchObject({name: 'test.double'})
  expect(description.commands[0]).not.toHaveProperty('execute')
  expect(description.commands[0]).not.toHaveProperty('validate')
})

test('rejects duplicate and unknown commands', async () => {
  const registry = new AgentCommandRegistry()
  await expect(registry.execute('missing', {}, context)).rejects.toMatchObject({
    code: 'COMMAND_NOT_FOUND',
  })
})
```

再注册同一个 `test.double` 两次，断言第二次同步抛出 `INVALID_STATE`。`describe()` 断言返回顶层 `apiVersion: 1`，命令按 `name` 排序，且不包含 `validate` 或 `execute` 函数。

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/registry.test.ts --runInBand`  
Expected: FAIL，找不到 `./registry`。

- [ ] **Step 3: 实现注册表**

注册表用 `Map<string, CommandDefinition<unknown, unknown>>` 保存定义。`execute` 的顺序固定为：查命令 → `validate(args)` → 调用 `execute` → 用 `asAgentApiError` 包装异常。`describe()` 只复制元数据和 schema，并附加 `acceptsExpectedRevision: definition.stateDomain === 'project' && definition.kind !== 'query'`。

`validation.ts` 提供后续命令复用的实际校验器：

```ts
export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentApiError('INVALID_ARGUMENT', '参数必须是对象')
  }
  return value as Record<string, unknown>
}

export function requireString(
  object: Record<string, unknown>,
  key: string,
): string {
  const value = object[key]
  if (typeof value !== 'string' || !value) {
    throw new AgentApiError('INVALID_ARGUMENT', `${key} 必须是非空字符串`)
  }
  return value
}

export function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AgentApiError('INVALID_ARGUMENT', `${label} 必须是有限数字`)
  }
  return value
}

export function requireVec3(value: unknown, label = 'position'): Vec3 {
  const object = requireObject(value)
  return {
    x: requireFiniteNumber(object.x, `${label}.x`),
    y: requireFiniteNumber(object.y, `${label}.y`),
    z: requireFiniteNumber(object.z, `${label}.z`),
  }
}
```

- [ ] **Step 4: 运行测试、类型检查并提交**

Run: `yarn test packages/camera-studio/src/agent/registry.test.ts --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent/registry.ts packages/camera-studio/src/agent/validation.ts packages/camera-studio/src/agent/registry.test.ts
git commit -m "feat(camera-studio): add agent command registry"
```

---

### Task 3: Historic revision、执行代次和任务管理器

**Files:**
- Create: `packages/camera-studio/src/agent/runtime.ts`
- Create: `packages/camera-studio/src/agent/jobs.ts`
- Test: `packages/camera-studio/src/agent/runtime.test.ts`
- Test: `packages/camera-studio/src/agent/jobs.test.ts`

**Interfaces:**
- Produces: `AgentRuntime {project; sheet; library; getStudio; jobs; revision; assertRevision; assertActive; assertCurrent; bindHandlers; handlers; activate; markReady; dispose}`。
- Produces: `AgentJobManager.start({kind,cancelable,execute})`、`get(jobId)`、`cancel(jobId)`、`subscribe(listener)`。
- `bindHandlers` 接收 `Partial<AgentSceneRuntimeHandlers>` 并返回解绑函数；Task 3 先导出空接口，各领域任务通过 TypeScript declaration merging 增加自己的 handler 签名。

- [ ] **Step 1: 写 revision 和 disposed 测试**

```ts
function expectErrorCode(fn: () => void, code: string) {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({code})
    return
  }
  throw new Error(`Expected ${code}`)
}

test('tracks every historic change and rejects stale writes', () => {
  let notify: (() => void) | undefined
  const runtime = createAgentRuntime({
    project: {ready: Promise.resolve()} as never,
    sheet: {} as never,
    library: {} as never,
    getStudio: () => ({}) as never,
    subscribeHistoric: (listener) => {
      notify = listener
      return () => { notify = undefined }
    },
  })
  expect(runtime.revision).toBe(1)
  expect(() => runtime.assertRevision(1)).not.toThrow()
  notify?.()
  expect(runtime.revision).toBe(2)
  expectErrorCode(() => runtime.assertRevision(1), 'REVISION_CONFLICT')
  runtime.dispose()
  expectErrorCode(() => runtime.assertActive(), 'API_DISPOSED')
})
```

另测 `activate()` 创建新执行代次后，旧代次 `assertCurrent()` 仍由 `expectErrorCode` 验证为 `API_DISPOSED`。

- [ ] **Step 2: 写任务终态、进度和取消测试**

使用可控 deferred：`start` 后立即得到 `pending/running` 快照；调用 `update({progress: .5, phase: 'committed'})` 后订阅者收到更新；resolve 后结果为 `succeeded` 且 `progress === 1`。取消时调用 `AbortController.abort()`，任务映射为 `cancelled`；不可取消任务抛 `JOB_NOT_CANCELABLE`；未知 ID 抛 `JOB_NOT_FOUND`。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/runtime.test.ts packages/camera-studio/src/agent/jobs.test.ts --runInBand`  
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现 runtime 和 job manager**

`createAgentRuntime` 的 `subscribeHistoric` 在生产环境由 bootstrap 传入：

```ts
(listener) => onChange(privateAPI(project).pointers.historic, () => listener())
```

revision 从 1 开始，任何 historic 通知都递增。`assertRevision(expected)` 先检查活动代次，再比较 expected；冲突 details 必须含 `expectedRevision` 和 `actualRevision`。

`AgentJobManager.start` 的签名为：

```ts
start<T>(args: {
  kind: string
  cancelable: boolean
  execute: (controls: {
    signal: AbortSignal
    update: (patch: {progress?: number; phase?: JobSnapshot['phase']}) => void
  }) => Promise<T>
}): {jobId: string; done: Promise<JobSnapshot<T>>}
```

任务 ID 使用 `crypto.randomUUID()`；jsdom 缺失时使用带计数器的 `job-${Date.now()}-${counter}` 回退。管理器保存最后一个快照并向订阅者发送不可变副本。

- [ ] **Step 5: 运行测试、类型检查并提交**

Run: `yarn test packages/camera-studio/src/agent/runtime.test.ts packages/camera-studio/src/agent/jobs.test.ts --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent/runtime.ts packages/camera-studio/src/agent/jobs.ts packages/camera-studio/src/agent/runtime.test.ts packages/camera-studio/src/agent/jobs.test.ts
git commit -m "feat(camera-studio): add agent runtime revisions and jobs"
```

---

### Task 4: 无副作用场景查询与选择

**Files:**
- Create: `packages/camera-studio/src/agent/objectResolver.ts`
- Create: `packages/camera-studio/src/agent/runtime/objectRuntime.ts`
- Create: `packages/camera-studio/src/agent/commands/scene.ts`
- Create: `packages/camera-studio/src/agent/commands/selection.ts`
- Modify: `packages/camera-studio/src/PlacementManager.tsx:119`
- Modify: `packages/camera-studio/src/PlacementManager.tsx:404-449`
- Test: `packages/camera-studio/src/agent/commands/scene.test.ts`
- Test: `packages/camera-studio/src/agent/commands/selection.test.ts`

**Interfaces:**
- Produces: `SceneObjectSummary {id; kind; key; props: Record<string,unknown> | null; mounted}`、`SceneSnapshot {revision; objects}`。
- Produces: `SceneApi {getSnapshot(): Promise<SceneSnapshot>}` 和完整 `ObjectsApi` 类型：`list/get`、 `update({objectId,props,expectedRevision?}): Promise<{revision:number}>`、`delete({objectId,expectedRevision?}): Promise<{deleted:SceneObjectId;revision:number}>`；本任务只实现 list/get，后续任务实现同一接口的 update/delete。
- Produces: `SelectionApi {get(): Promise<{objectIds: SceneObjectId[]}>; selectObject({objectId}): Promise<void>; clear(): Promise<void>}`。
- Produces: `registerSceneCommands(registry,runtime)`、`registerSelectionCommands(registry,runtime)`。

- [ ] **Step 1: 写空场景无副作用测试**

用真实 `getProject` 创建测试 project，记录 `privateAPI(sheet).getObject('Placements')`、`Cameras`、`Anchors`、`Paths` 在调用前后都为 `undefined`。调用 `scene.getSnapshot` 和 `objects.list` 后结果为空且四个注册表仍未创建。再调用不存在的 `path:missing` 的 `objects.get`，断言 `OBJECT_NOT_FOUND` 且 `pathExists` 不变。另构造一条有注册表记录但没有运行时 SheetObject 的模型，断言 `objects.get` 返回 `props:null,mounted:false`。

- [ ] **Step 2: 写选择解析测试**

伪造 `model:A` 对应 SheetObject，`selection.selectObject` 后断言 `studio.setSelection([obj])`；`selection.get` 只把能解析为四种业务对象的 selection 返回为 ID；`selection.clear` 调用空数组并通知 Scene Runtime 清理路径点选择。`camera:A` 被当作 model 使用时返回 `INVALID_ID_KIND`。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/commands/scene.test.ts packages/camera-studio/src/agent/commands/selection.test.ts --runInBand`  
Expected: FAIL，查询命令尚未注册。

- [ ] **Step 4: 实现无副作用 resolver**

把 `REGISTRY_KEY = 'Placements'` 改为导出的 `PLACEMENTS_REGISTRY_KEY`，保留原内部引用。resolver 只用：

```ts
privateAPI(sheet).getObject(registryKey)
```

读取注册表；存在时才用 `val(registry.props.list)` 和现有 `parseCameraEntries`、`parseAnchorKeys`、`parsePathEntries`、导出的 `readRegistry` 解析。业务 ID 的 key 分别来自 placement key、cameraKey、anchorKey 和 pathKey，但**不假定这些 key 一定能绕过运行时直接构造 SheetObject**。

`objectRuntime.ts` 提供 `registerSceneSheetObject(id,obj)`、`getSceneSheetObject(id)` 和按 id 清理。各领域组件在 objRef 填充/清空时登记。resolver 先验证 ID 在业务注册表中，再读运行时 SheetObject；需要删除未挂载对象时才用 `privateAPI(sheet).getObject(key)` 做无副作用的持久对象兜底。注册表有条目但对象未挂载时，`objects.get` 返回 `props:null,mounted:false`，而不是误报 `OBJECT_NOT_FOUND`；后续写命令对此返回 `INVALID_STATE`。任何查询都不得调用 `sheet.object`、`getPathMeta` 或 `readPathPoints`。

`mounted` 由 `getSceneSheetObject(id)` 和 Scene Runtime 资源状态共同决定。`props` 只在 SheetObject 存在时使用 `obj.value` 的深拷贝；路径点由 `paths.*` 查询单独返回。

- [ ] **Step 5: 注册查询和选择命令**

`scene.getSnapshot`、`objects.list`、`objects.get` 标记 `query/project`；选择命令标记 `mutation/session` 和 `undoable:none`。所有命令 execute 前调用 `runtime.assertActive()`。`objects.get` 不存在时抛 `OBJECT_NOT_FOUND`，details 含 `objectId` 和 `kind`。

- [ ] **Step 6: 运行测试、类型检查并提交**

Run: `yarn test packages/camera-studio/src/agent/commands/scene.test.ts packages/camera-studio/src/agent/commands/selection.test.ts --runInBand`  
Expected: PASS，且 historic 状态前后序列化一致。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent packages/camera-studio/src/PlacementManager.tsx
git commit -m "feat(camera-studio): add side-effect-free agent scene queries"
```

---

### Task 5: 静态属性更新与 revision 冲突保护

**Files:**
- Create: `packages/camera-studio/src/agent/propAccess.ts`
- Create: `packages/camera-studio/src/agent/commands/objects.ts`
- Test: `packages/camera-studio/src/agent/commands/objects.test.ts`

**Interfaces:**
- Consumes: Task 4 resolver 和 Task 3 `runtime.assertRevision`。
- Consumes: Task 4 的完整 `ObjectsApi` 类型；本任务实现其中的 `update` 方法。
- Produces: `setStaticProps(sheetObject, props): void`，供姿势、相机和路径命令复用。
- Produces: `getSimplePropPointer(obj, propPath)` 和 `isPropSequenced(obj, propPath)`，供 Task 7 使用。

- [ ] **Step 1: 写静态更新测试**

覆盖：合法 position 一次性更新；未知属性返回 `INVALID_ARGUMENT`；只传 `{position:{x:1}}` 返回 compound 不完整错误；NaN/Infinity 拒绝；`points`、`pose`、`gestureL/R`、`animation`、`aimTarget`、`pathKey`、`parent` 等专用属性被 `objects.update` 拒绝；任一属性已建轨时整个命令在事务前返回 `INVALID_STATE`。

- [ ] **Step 2: 写 revision 和单事务测试**

先让 historic listener 将 revision 从 1 改为 2，再以 `expectedRevision:1` 调用，断言没有任何 `set` 被调用。合法调用中捕获 studio.transaction 回调次数为 1，多个属性在同一个回调内设置；回调抛错时不增加 revision，revision 只由真实 historic 通知增加。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/commands/objects.test.ts --runInBand`  
Expected: FAIL，`objects.update` 未注册。

- [ ] **Step 4: 实现 propAccess 和 update**

`propAccess.ts` 根据 `obj.value` 检查属性存在性和运行时值形状。compound 值必须与当前对象的键集合一致且递归类型匹配；专用属性集合显式定义为：

```ts
const domainOwnedProps = new Set([
  'points', 'pose', 'poseOverride', 'gestureL', 'gestureR',
  'animation', 'aimTarget', 'pathKey', 'parent', 'source',
])
```

`isPropSequenced` 使用现有 `getTrackIdForProp` 对顶层属性检测；简单叶子路径通过 `privateAPI(obj).sheet.getSequence().getKeyframesOfSimpleProp` 所在内部 track map 适配检测。检测逻辑集中在 `propAccess.ts`，不散落到各命令。

`objects.update` 先校验全部值和建轨状态，再执行：

```ts
runtime.assertRevision(args.expectedRevision)
runtime.getStudio().transaction(({set}) => {
  for (const [key, value] of Object.entries(args.props)) {
    set(sheetObject.props[key], value)
  }
})
return {revision: runtime.revision}
```

返回时若 historic 通知尚在相同调用栈未触发，返回 `runtime.revision` 当前值；测试以真实通知为准，不手工加一。

- [ ] **Step 5: 运行测试、类型检查并提交**

Run: `yarn test packages/camera-studio/src/agent/commands/objects.test.ts --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent/propAccess.ts packages/camera-studio/src/agent/commands/objects.ts packages/camera-studio/src/agent/commands/objects.test.ts
git commit -m "feat(camera-studio): add guarded static agent updates"
```

---

### Task 6: Sequence 播放、定位、时长与历史

**Files:**
- Create: `packages/camera-studio/src/agent/commands/sequence.ts`
- Create: `packages/camera-studio/src/agent/commands/history.ts`
- Create: `packages/camera-studio/src/agent/sequenceLength.ts`
- Test: `packages/camera-studio/src/agent/commands/sequence.test.ts`
- Test: `packages/camera-studio/src/agent/commands/history.test.ts`

**Interfaces:**
- Produces: `SequenceApi {getState; play; pause; seek; setLength}`；`SequenceState {playing; position; length}`。
- Produces: `HistoryApi {undo(): Promise<{revision:number}>; redo(): Promise<{revision:number}>}`。
- Produces: `setSequenceLength(sheet,length)`，隔离 Studio `stateEditors` 适配。

- [ ] **Step 1: 写 sequence 行为测试**

`play()` 在 `project.ready` 完成后调用并等待 `sheet.sequence.play()`；`pause()` 调用 pause；`seek({position,snap:true})` 使用 `closestGridPosition` 后再写 position，默认 `snap:false`；负数和超过 length 的 position 依据 core 当前 clamp 语义返回实际 position；`setLength({length:0})` 和非有限数在事务前拒绝。

- [ ] **Step 2: 写时长与历史测试**

`setLength({length:12.5})` 调用 `stateEditors.coreByProject.historic.sheetsById.sequence.setLength({...sheet.address,length:12.5})` 且只调用一次 transaction。`history.undo/redo` 分别调用对应 Studio 方法并返回当前 revision，不伪造 `canUndo/canRedo`。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/commands/sequence.test.ts packages/camera-studio/src/agent/commands/history.test.ts --runInBand`  
Expected: FAIL，命令未注册。

- [ ] **Step 4: 实现命令和内部时长适配**

`sequenceLength.ts` 使用与 `TransportBar.tsx:152-157` 完全相同的 stateEditors 路径。`seek` 先 pause 的 core 语义保持不额外包装；`play` 和 `pause` 标记 `mutation/session`、`undoable:none`。`setLength` 标记 `mutation/project`、`undoable:single-step` 并接受 `expectedRevision`。

- [ ] **Step 5: 运行测试、类型检查并提交**

Run: `yarn test packages/camera-studio/src/agent/commands/sequence.test.ts packages/camera-studio/src/agent/commands/history.test.ts --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent
git commit -m "feat(camera-studio): expose sequence and history agent commands"
```

---

### Task 7: 显式关键帧读取、创建、移动和删除

**Files:**
- Create: `packages/camera-studio/src/agent/commands/keyframes.ts`
- Create: `packages/camera-studio/src/agent/keyframeTracks.ts`
- Test: `packages/camera-studio/src/agent/commands/keyframes.test.ts`

**Interfaces:**
- Consumes: Task 5 `getSimplePropPointer`、建轨检测和 Task 6 sequence。
- Produces: `KeyframesApi {list; set; move; delete}`。
- 参数统一为 `{objectId, propPath: string[]}`；`set` 额外接收 `{at,value,snap?}`，`move` 额外接收 `{from,to,snap?}`，`delete` 额外接收 `{at,snap?}`。

- [ ] **Step 1: 写首次建轨与显式位置测试**

对未建轨 `position.x` 调用 `keyframes.set`，断言同一个 transaction 中先 `sequenceProp(pointer)` 再 `set(pointer,value)`，播放头被定位到吸附后的 `at`。对已建轨属性不再调用 `sequenceProp`。`objects.update` 在该属性上仍返回 `INVALID_STATE`。

- [ ] **Step 2: 写 list/move/delete 测试**

`list` 只返回指定简单叶子的 `{position,value}`，不返回其他属性。`move` 使用现有 `transformKeyframes` 适配，把 from/to 先按相同网格规则计算；缺少源关键帧返回 `KEYFRAME_NOT_FOUND`。`delete` 在指定位置调用 `unset(pointer)`，不擅自 `unsequenceProp`。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/commands/keyframes.test.ts --runInBand`  
Expected: FAIL，命令未注册。

- [ ] **Step 4: 实现轨道适配和命令**

`keyframeTracks.ts` 集中使用 `privateAPI`、track map 和从 `AggregateKeyframeConnector.tsx:114-207` 抽出的 `transformKeyframes` 调用。禁止在各命令直接访问 Studio state。

`set` 的实现顺序：解析对象和叶子 pointer → 校验值与当前简单值类型 → 计算吸附位置 → 保存并设置 `sequence.position` → 在一个 transaction 内按需 `sequenceProp` 并 `set`。`move/delete/set` 都标记项目命令并接受 `expectedRevision`。

- [ ] **Step 5: 运行测试、类型检查并提交**

Run: `yarn test packages/camera-studio/src/agent/commands/keyframes.test.ts --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent/commands/keyframes.ts packages/camera-studio/src/agent/keyframeTracks.ts packages/camera-studio/src/agent/commands/keyframes.test.ts
git commit -m "feat(camera-studio): add explicit agent keyframe commands"
```

---

### Task 8: 模型创建、资产管理和挂载完成等待

**Files:**
- Create: `packages/camera-studio/src/agent/commands/models.ts`
- Create: `packages/camera-studio/src/agent/commands/assets.ts`
- Create: `packages/camera-studio/src/agent/runtime/placementLifecycle.ts`
- Modify: `packages/camera-studio/src/PlacementManager.tsx:524-628`
- Modify: `packages/camera-studio/src/PlacementManager.tsx:1469-1498`
- Modify: `packages/camera-studio/src/CameraScene.tsx:987-1008`
- Test: `packages/camera-studio/src/agent/commands/models.test.ts`
- Test: `packages/camera-studio/src/agent/commands/assets.test.ts`
- Test: `packages/camera-studio/src/agent/runtime/placementLifecycle.test.ts`

**Interfaces:**
- Produces: `ModelsApi {create({assetId,position,expectedRevision?}): Promise<{objectId;revision}>}`。
- Produces: `AssetsApi {list({kind?}); get({assetId}); importModel({file}): Promise<{jobId}>; rename({assetId,name}); delete({assetId})}`。
- Produces: `JobsApi {get({jobId}): Promise<JobSnapshot>; cancel({jobId}): Promise<JobSnapshot>}`。
- Produces: `placeLibraryEntryAt(entry,point): {key:string; persisted:Promise<void>}`，现有 `CameraFlows.placeModelAt` 忽略返回的 `persisted` 以保持兼容。

- [ ] **Step 1: 写模型创建完成语义测试**

模拟 `placeLibraryEntryAt` 返回 key 和 deferred persisted。`models.create` 的 promise 在 persisted resolve 前保持 pending；resolve 后返回 `model:<key>`。资产不存在、资产 kind 不是 model、挂载失败通知和挂载期间 API dispose 分别映射 `ASSET_NOT_FOUND`、`INVALID_ARGUMENT`、`RESOURCE_LOAD_FAILED` 和 `API_DISPOSED`，不能返回成功。

- [ ] **Step 2: 写资产命令测试**

`assets.list/get` 透传 Library 的真实条目；rename 空名称拒绝；delete 使用 `deleteEntryDeep`；无 writable source 返回 `INVALID_STATE` 而不是静默成功。`importModel` 通过 `runtime.jobs.start` 调用 `importModelFile(file,library)`，任务完成返回 `ModelEntry`，job 订阅者能看到 `loaded` 阶段。另模拟导入管线部分写入后失败：任务返回 `PARTIAL_FAILURE`，details 明确 `createdAssetIds` 和失败项；Library 的存储、网络、配额错误分别保留为 `STORAGE_ERROR`、`NETWORK_ERROR` 和可读 details，不统一吞成 unknown。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/commands/models.test.ts packages/camera-studio/src/agent/commands/assets.test.ts packages/camera-studio/src/agent/runtime/placementLifecycle.test.ts --runInBand`  
Expected: FAIL，模型和资产命令未注册。

- [ ] **Step 4: 实现挂载等待和真实放置接线**

`placementLifecycle.ts` 维护 key → deferred waiter，并提供 `createPlacementWaiter(key)`、`resolvePlacementPersisted(key)`、`rejectPlacement(key,error)`。waiter 在 `setPendingEntry` 前创建。`PlacedModelCore` 在注册表提交和 `onPersisted()` 后 resolve；`PlacedModelErrorBoundary` 在失败时 reject；等待器 settle 后从 Map 删除。`setObjRef` 同步调用 Task 4 的 `registerSceneSheetObject('model:'+entry.key,obj)`，卸载时清理同一 ID。

`placeLibraryEntryAt` 先生成 key、创建 waiter，再设置 pending，返回 `{key,persisted}`。`models.create` 等待 persisted 后再读 resolver，确认注册表和 SheetObject 均可见。

- [ ] **Step 5: 实现模型与资产命令**

`models.create` 先 `await runtime.project.ready` 和 `library.getEntry(assetId)`，再调用 Scene Runtime 的 `createModel`。`assets.importModel` 是 `job/asset`、`undoable:none`、`completion:loaded`；其他资产写命令直接等待 Library 完成并返回更新后的条目或 `{deleted:true}`。注册 `jobs.get` 和 `jobs.cancel`，供本任务和后续视频导出共用。

二进制契约显式区分：`AssetsApi.importModel` 的 JS 参数是 `{file:File}`；命令 inputSchema 描述 HTTP 的 `{file:{fileId,fileName?,mimeType?}}`，`jobResultSchema` 描述 `ModelEntry`。registry validator 只接收已 hydrate 的 File，桥接客户端负责 fileId → File，不允许原始 fileRef 绕过传输适配直接进入 Library。

- [ ] **Step 6: 运行测试、既有放置回归和类型检查**

Run: `yarn test packages/camera-studio/src/agent/commands/models.test.ts packages/camera-studio/src/agent/commands/assets.test.ts packages/camera-studio/src/agent/runtime/placementLifecycle.test.ts packages/camera-studio/src/CameraScene.test.tsx --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent packages/camera-studio/src/PlacementManager.tsx packages/camera-studio/src/CameraScene.tsx
git commit -m "feat(camera-studio): expose model and asset agent commands"
```

---

### Task 9: 姿势、自定义骨骼、手势和动画

**Files:**
- Create: `packages/camera-studio/src/agent/commands/poses.ts`
- Create: `packages/camera-studio/src/agent/commands/animations.ts`
- Create: `packages/camera-studio/src/agent/runtime/poseSessionRuntime.ts`
- Modify: `packages/camera-studio/src/CameraScene.tsx:1457-1597`
- Modify: `packages/camera-studio/src/poseMode/PoseModeRig.tsx:78-239`
- Test: `packages/camera-studio/src/agent/commands/poses.test.ts`
- Test: `packages/camera-studio/src/agent/commands/animations.test.ts`

**Interfaces:**
- Produces: `PosesApi {apply; applyCustom; clear; saveCurrent; setGesture}` 和 `PosesSessionApi {start; commit; cancel}`。
- Produces: `AnimationsApi {apply; clear; getStatus}`；状态为 `{assetId?:string; loaded:boolean; error?:AgentErrorDto}`。
- `apply/applyCustom/setGesture/animations.apply` 只写未建轨静态值；`poses.clear` 显式移除姿势轨并清值，保持一个项目撤销步骤。

- [ ] **Step 1: 写姿势和手势静态语义测试**

库姿势先验证 `PoseEntry` 存在，再以 `serializeLibPose` 写值；自定义姿势用 `serializeCustomPose`；左右手势分别写 `gestureL/R` 并验证手势侧别。已建轨 pose/gesture 返回 `INVALID_STATE` 且不写关键帧。`poses.clear` 在一个 transaction 中调用 `unsequenceProp` 和 `unset`，空姿势也返回明确结果而非静默 no-op。

- [ ] **Step 2: 写保存姿势和会话测试**

`saveCurrent` 从 Scene Runtime 取得已挂载 Three 实例，调用现有 `capturePose`、Library 写入和缩略图流程；未挂载返回 `INVALID_STATE`。`poses.session.start` 要求模型 Rig 已挂载；commit/cancel 分别调用 PoseModeRig 注册的提交和取消 handler；会话不存在时返回 `INVALID_STATE`。

- [ ] **Step 3: 写动画状态测试**

`animations.apply` 验证 AnimationEntry 与模型兼容后写 `props.animation`；clear 写空值；`getStatus` 区分“未设置”“资源加载中”“已加载”“加载失败”，状态来自 PlacementManager 的运行时注册，不从 props 猜测 loaded。

- [ ] **Step 4: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/commands/poses.test.ts packages/camera-studio/src/agent/commands/animations.test.ts --runInBand`  
Expected: FAIL，命令未注册。

- [ ] **Step 5: 抽离现有流程并实现命令**

将 `CameraScene.tsx:1485-1538` 的 applyPose/saveCurrentPose 和 `:1574-1597` 的姿势轨流程抽为可注入函数，UI 与 Agent 共用。将 `PoseModeRig.tsx:78-239` 的播放头锁定、提交和退出逻辑接入 `poseSessionRuntime.ts`，保留现有 Esc/退出 UI 行为。

在 PlacementManager 的动画 `load` 成功、失败和清理分支登记 `animations.getStatus` 所需状态；React cleanup 必须删除对应 key，避免卸载后读到陈旧 loaded。

- [ ] **Step 6: 运行测试、姿势回归和类型检查**

Run: `yarn test packages/camera-studio/src/agent/commands/poses.test.ts packages/camera-studio/src/agent/commands/animations.test.ts packages/camera-studio/src/poseMode --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent packages/camera-studio/src/CameraScene.tsx packages/camera-studio/src/PlacementManager.tsx packages/camera-studio/src/poseMode
git commit -m "feat(camera-studio): expose pose gesture and animation agent commands"
```

---

### Task 10: 相机、活动镜头、瞄准和锚点绑定

**Files:**
- Create: `packages/camera-studio/src/agent/commands/cameras.ts`
- Create: `packages/camera-studio/src/agent/commands/anchors.ts`
- Create: `packages/camera-studio/src/agent/runtime/cameraLifecycle.ts`
- Modify: `packages/camera-studio/src/CameraScene.tsx:753-805`
- Modify: `packages/camera-studio/src/ShotCamera.tsx:327-343`
- Modify: `packages/camera-studio/src/Anchors.tsx:157-184`
- Test: `packages/camera-studio/src/agent/commands/cameras.test.ts`
- Test: `packages/camera-studio/src/agent/commands/anchors.test.ts`

**Interfaces:**
- Produces: `CamerasApi {create; setActive; setAimTarget; bindPath; unbindPath}`。
- Produces: `AnchorsApi {create; setParent; clearParent}`。
- `create` 返回对应带类型 ID，并等待 seed 被挂载 effect 消费后返回；`setActive` 只改会话状态。

- [ ] **Step 1: 写相机创建和目标校验测试**

`cameras.create({fromCurrentView:true})` 使用当前导演相机 position/rotation seed；显式 transform 时使用传入值。等待 `notifyCameraReady(cameraKey)` 后才返回。无效 aim target、被绑定 path 不存在、目标 ID 类型错误分别返回 `OBJECT_NOT_FOUND` 或 `INVALID_ID_KIND`，不得写 props。

- [ ] **Step 2: 写锚点创建和父级测试**

`anchors.create` 默认使用现有导演前方 5 单位定位，也可显式传 position；等待 mount seed 消费。`setParent` 验证父对象支持类型和世界/局部换算输入；`clearParent` 写空父级并由现有 Three effect 挂回 home。父对象形成自身循环时返回 `INVALID_ARGUMENT`。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/commands/cameras.test.ts packages/camera-studio/src/agent/commands/anchors.test.ts --runInBand`  
Expected: FAIL，命令未注册。

- [ ] **Step 4: 实现生命周期通知和领域命令**

把 `CameraScene.tsx:753-795` 的 addCamera/addAnchor 默认取景计算抽成 `captureCameraSeed` 和 `captureAnchorSeed` 纯函数。`ShotCamera` 和 `AnchorObject` 在 seed layout effect 完成后通知 lifecycle；没有 seed 的恢复对象也通知 mounted，不重复写值。两者的 objRef 填充/清空同时调用 `registerSceneSheetObject` 登记 `camera:<key>` 和 `anchor:<key>`。

`setAimTarget/bindPath/unbindPath/setParent/clearParent` 使用 Task 5 的静态写入守卫和一个 transaction；`setActive` 通过 Scene Runtime 调用 `setActiveCameraKey`，并校验 key 仍存在。

- [ ] **Step 5: 运行测试、相机回归和类型检查**

Run: `yarn test packages/camera-studio/src/agent/commands/cameras.test.ts packages/camera-studio/src/agent/commands/anchors.test.ts packages/camera-studio/src/CameraScene.test.tsx --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent packages/camera-studio/src/CameraScene.tsx packages/camera-studio/src/ShotCamera.tsx packages/camera-studio/src/Anchors.tsx
git commit -m "feat(camera-studio): expose camera and anchor agent commands"
```

---

### Task 11: 路径预设、控制点、时间锚点和编辑会话

**Files:**
- Create: `packages/camera-studio/src/agent/commands/paths.ts`
- Create: `packages/camera-studio/src/agent/pathCommands.ts`
- Create: `packages/camera-studio/src/agent/runtime/pathRuntime.ts`
- Modify: `packages/camera-studio/src/CameraScene.tsx:1071-1226`
- Modify: `packages/camera-studio/src/CameraPath.tsx:328-380`
- Test: `packages/camera-studio/src/agent/commands/paths.test.ts`

**Interfaces:**
- Produces: `PathsApi {listPresets; createPreset; addPoint; updatePoint; deletePoint; setPointTiming; sample}`。
- Produces: `PathsSessionApi {startEditing; exitEditing; selectPoint}`。
- `updatePoint` 接收 `{pathId,pointKey,position?,handles?}`；`setPointTiming` 接收 `{pathId,pointKey,u:number|null}`，null 表示恢复自动 u。

- [ ] **Step 1: 写路径创建和点编辑测试**

`listPresets` 返回现有 11 个预设。`createPreset` 使用 `presetPlacement` 和 `findFreeSpot`，在一个项目事务中写 points 与注册表；结果包含 pathId 和 pointKeys。`addPoint` 使用 `nextPointKey/extendPathPoint`；`updatePoint` 使用 `withMovedPoint/withDraggedHandle`；非法 handle 侧别、NaN、u 超出 0–1 均在写入前拒绝。首尾点保持固定 0/1，显式设置其 u 返回 `INVALID_ARGUMENT`；内部点传 `u:null` 才表示恢复自动。

- [ ] **Step 2: 写最后一点删除和采样测试**

删除非最后一点只更新 points；删除最后一点调用 Task 11 导出的 `deletePathDomain`，包含相机回退和注册表清理。`sample` 对 0、0.5、1 使用与当前渲染相同的曲线实现；路径未挂载时返回 `INVALID_STATE`，不调用会创建 meta 的读取函数。

- [ ] **Step 3: 写路径会话测试**

`startEditing` 只接受存在的 pathId；`selectPoint` 要求点存在且路径正在编辑；`exitEditing` 清空编辑态和点选择。`selection.clear` 调用同一 runtime 清理函数。

- [ ] **Step 4: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/commands/paths.test.ts --runInBand`  
Expected: FAIL，路径命令未注册。

- [ ] **Step 5: 抽离路径领域命令并接 Scene Runtime**

`pathCommands.ts` 以 `parsePathPoints/serializePathPoints` 和现有纯函数实现读改写，所有写入使用一个 transaction。`createPreset` 在事务外创建/解析必要对象，在事务内同时写 meta points 和 Paths registry。

把 `CameraScene.tsx:1198-1226` 的删除流程抽为 `deletePathDomain` 导出，供最后一点删除和 Task 14 共用。`CameraPath` 将当前曲线采样函数注册到 `pathRuntime.ts`，并在 meta SheetObject 填充/清空时登记 `path:<key>`；卸载时只解绑自己的 pathKey。

- [ ] **Step 6: 运行测试、路径回归和类型检查**

Run: `yarn test packages/camera-studio/src/agent/commands/paths.test.ts packages/camera-studio/src/CameraScene.test.tsx --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent packages/camera-studio/src/CameraScene.tsx packages/camera-studio/src/CameraPath.tsx
git commit -m "feat(camera-studio): expose path agent commands"
```

---

### Task 12: 视图、UI 和项目状态导出

**Files:**
- Create: `packages/camera-studio/src/agent/commands/view.ts`
- Create: `packages/camera-studio/src/agent/commands/ui.ts`
- Create: `packages/camera-studio/src/agent/commands/project.ts`
- Create: `packages/camera-studio/src/agent/runtime/directorView.ts`
- Modify: `packages/camera-studio/src/CameraScene.tsx:243-536`
- Modify: `packages/camera-studio/src/CameraScene.tsx:1645-1661`
- Test: `packages/camera-studio/src/agent/commands/view.test.ts`
- Test: `packages/camera-studio/src/agent/commands/project.test.ts`

**Interfaces:**
- Produces: `ViewApi {getState; setShotView; setPipVisible; orbit; pan; dolly; reset}`。
- Produces: `UiApi {hide; restore; setLeftStripHidden; openPanel; closePanel; setGizmoMode}`。
- Produces: `ProjectApi {exportState(): Promise<{projectId:string;content:unknown}>}`。

- [ ] **Step 1: 写视图和 UI 转发测试**

`getState` 返回 activeCameraKey、shotView、pipVisible、editingPath、gizmoMode 和 studio hidden 状态。orbit/pan/dolly 使用有限数字并转发到已注册导演控制器；未注册时返回 `API_NOT_READY`。`openPanel/closePanel` 只接受 `model|pose|animation|path`，`setGizmoMode` 只接受 `select|translate|rotate|scale`。

- [ ] **Step 2: 写项目导出测试**

`project.exportState` 调用 `studio.createContentOfSaveFile(project.address.projectId)`，返回深拷贝内容；断言不包含 Library 条目、activeCamera、PIP 或任务状态。Studio 未初始化返回 `API_NOT_READY`。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/commands/view.test.ts packages/camera-studio/src/agent/commands/project.test.ts --runInBand`  
Expected: FAIL，命令未注册。

- [ ] **Step 4: 实现 runtime 注册和命令**

`MainOrbitControls` 把 orbit/pan/dolly/reset 的稳定函数注册到 `directorView.ts`，cleanup 只清自己的函数。CameraScene 提供 view/panel/gizmo handler；Studio UI 使用公开 `studio.ui` 方法。所有 view/ui 命令标记 `session` 和 `undoable:none`，`project.exportState` 标记 `query/project`。

- [ ] **Step 5: 运行测试、类型检查并提交**

Run: `yarn test packages/camera-studio/src/agent/commands/view.test.ts packages/camera-studio/src/agent/commands/project.test.ts packages/camera-studio/src/CameraScene.test.tsx --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent packages/camera-studio/src/CameraScene.tsx
git commit -m "feat(camera-studio): expose view ui and project agent commands"
```

---

### Task 13: 视频导出任务、进度、取消和 Blob 结果

**Files:**
- Create: `packages/camera-studio/src/agent/commands/exports.ts`
- Create: `packages/camera-studio/src/agent/runtime/exportRuntime.ts`
- Create: `packages/camera-studio/src/videoExport/BlobCollectSink.ts`
- Modify: `packages/camera-studio/src/CameraScene.tsx:1335-1380`
- Test: `packages/camera-studio/src/agent/commands/exports.test.ts`
- Test: `packages/camera-studio/src/videoExport/BlobCollectSink.test.ts`

**Interfaces:**
- Produces: `ExportsApi {startVideo({cameraId?}): Promise<{jobId:string}>}`。
- Produces: `VideoExportResult {blob:Blob;fileName:string;mimeType:string;size:number}`，HTTP 计划再将 Blob 适配为 fileId。

- [ ] **Step 1: 写 BlobCollectSink 测试**

start 后按顺序 write 两个 Uint8Array，finish 后 `blob()` 返回正确 MIME、大小和字节；abort 后 `blob()` 抛 `INVALID_STATE` 且后续 write 拒绝；重复 start 清空旧块。

- [ ] **Step 2: 写导出任务测试**

模拟 `startShotExport` 返回 `{done,abort,finishEarly}`。`exports.startVideo` 返回 jobId；进度随 sequence position 更新；done resolve 后任务结果为 BlobCollectSink 的文件；abort 将任务置为 cancelled 并恢复 shotView；无活动相机、正在导出和 MediaRecorder 不可用分别返回 `INVALID_STATE` 或 `CAPABILITY_UNAVAILABLE`。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/commands/exports.test.ts packages/camera-studio/src/videoExport/BlobCollectSink.test.ts --runInBand`  
Expected: FAIL，命令和 sink 不存在。

- [ ] **Step 4: 实现 sink 和导出 runtime**

`BlobCollectSink` 实现现有 `ExportSink` 全部方法，不触发浏览器下载。把 CameraScene 导出前的活动相机校验、ShotView 切换、canvas 获取和异常恢复抽入 `exportRuntime.ts`，UI 菜单和 Agent 共用。`handle.done` 决定任务成功，不能以 `startShotExport` 返回句柄作为成功。

- [ ] **Step 5: 注册导出命令并验证**

`exports.startVideo` 标记 `job/session`、`undoable:none`、`cancelable:true`、`completion:loaded`。任务取消调用 handle.abort 和 sink.abort；React 卸载时先 abort，再恢复视图并拒绝旧任务。JS 任务结果是 `VideoExportResult`；`jobResultSchema` 描述 HTTP `FileDescriptor`，桥接客户端负责 Blob → fileId，不允许把 Blob 当作 JSON 序列化。

Run: `yarn test packages/camera-studio/src/agent/commands/exports.test.ts packages/camera-studio/src/videoExport/BlobCollectSink.test.ts packages/camera-studio/src/CameraScene.test.tsx --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent packages/camera-studio/src/videoExport packages/camera-studio/src/CameraScene.tsx
git commit -m "feat(camera-studio): add agent video export jobs"
```

---

### Task 14: 统一对象删除与完整清理

**Files:**
- Create: `packages/camera-studio/src/agent/deleteHandlers.ts`
- Modify: `packages/camera-studio/src/agent/commands/objects.ts`
- Modify: `packages/camera-studio/src/CameraScene.tsx:799-872`
- Test: `packages/camera-studio/src/agent/commands/delete.test.ts`

**Interfaces:**
- Consumes: `deletePlacement`、`removeCamera`、`removeAnchor`、Task 11 `deletePathDomain` 和各对象 resolver。
- Consumes: Task 4 的完整 `ObjectsApi` 类型；本任务实现其中的 `delete` 方法。
- Produces: `deleteSceneObject(runtime,id)`，最后一点路径删除复用同一 path handler。

- [ ] **Step 1: 写四种对象删除测试**

逐类验证：模型清单和对象被清理；相机 forgetObject 与注册表在同一个项目撤销步骤；锚点删除同时清父级运行时关系；路径删除重置绑定相机 pathKey 并保留其当前世界变换 freeze。缺少已挂载 ref 时使用 resolver 的 SheetObject，不允许静默 return。

- [ ] **Step 2: 写会话清理和 undo 测试**

删除活动相机后按现有规则回退到下一台或 null；删除正在编辑的路径后清 editingPath/selectedPathPoint；删除选中对象后 selection 为空。一次 `history.undo` 恢复项目对象和注册表，路径/相机绑定一致；会话状态不错误恢复到已失效 ID。

- [ ] **Step 3: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/commands/delete.test.ts --runInBand`  
Expected: FAIL，`objects.delete` 未注册。

- [ ] **Step 4: 实现按类型 delete handler**

`deleteHandlers.ts` 定义 `{[K in SceneObjectKind]: DeleteHandler<K>}`。把 `CameraScene.tsx:799-872` 的外围清理抽为 `afterSceneObjectDeleted(id)`；领域删除先完成项目事务，再清会话。任一领域校验失败时不得调用会话清理或返回 deleted。

相机和路径的 forgetObject/registry/bound reset 写入合并到一个 transaction；`sheet.detachObject` 等非 historic 清理放在事务后。所有删除命令接受 `expectedRevision`。

- [ ] **Step 5: 运行删除、相机和路径回归**

Run: `yarn test packages/camera-studio/src/agent/commands/delete.test.ts packages/camera-studio/src/agent/commands/paths.test.ts packages/camera-studio/src/CameraScene.test.tsx --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:ts`  
Expected: PASS。

```bash
git add packages/camera-studio/src/agent packages/camera-studio/src/CameraScene.tsx
git commit -m "feat(camera-studio): add complete agent object deletion"
```

---

### Task 15: 公开 JS API、启动生命周期和兼容接线

**Files:**
- Create: `packages/camera-studio/src/agent/api.ts`
- Create: `packages/camera-studio/src/agent/registerCommands.ts`
- Modify: `packages/camera-studio/src/config.ts:12-52`
- Modify: `packages/camera-studio/src/bootstrap.ts:47-59`
- Modify: `packages/camera-studio/src/bootstrap.ts:243-394`
- Modify: `packages/camera-studio/src/useCameraStudio.ts:33-102`
- Modify: `packages/camera-studio/src/CameraScene.tsx:2165-2189`
- Modify: `packages/camera-studio/src/index.ts:4-41`
- Test: `packages/camera-studio/src/agent/api.test.tsx`

**Interfaces:**
- Produces: `CameraStudioApi {ready:Promise<void>; describe; scene; selection; objects; models; assets; poses; animations; cameras; anchors; paths; sequence; keyframes; history; view; ui; project; exports; jobs}`，其中 `poses.session` 和 `paths.session` 为嵌套命名空间。
- Produces: `CameraStudioHandle.api`、`BootCtx.api`、`CameraStudioConfig.agent.exposeGlobal`。
- Produces: `createCameraStudioApi()` 和 `registerAllAgentCommands(registry,runtime)`。

- [ ] **Step 1: 写完整命名空间和结果测试**

用 fake runtime 注册全部命令，遍历规格命令清单并调用每个 JS namespace 方法，断言转发到同名命令、返回原始结果而非 `{ok,result}` 包装。参数错误和领域错误以同一个 `AgentApiError` 抛出。

- [ ] **Step 2: 写 ready/dispose/remount 测试**

API 在 project/studio 就绪但 CameraScene handlers 未绑定时仍不 ready；绑定完整 handlers 后 ready resolve。dispose 时拒绝 pending mounted 等待，后续调用返回 `API_DISPOSED`。模拟现有 initPromise 复用的 remount：新执行代次可以重新 ready，旧代次已捕获的 promise 不得写入新 runtime。

- [ ] **Step 3: 写公开导出和全局暴露测试**

`useCameraStudio` 首帧和后续 render 返回同一个 api 对象；`window.__cameraStudioApi` 仅在 `agent.exposeGlobal:true` 且场景 ready 后出现，dispose 时删除。未传 exposeGlobal 时 window 上没有该属性。既有 `CameraFlows` 八方法仍可用。

- [ ] **Step 4: 运行测试确认失败**

Run: `yarn test packages/camera-studio/src/agent/api.test.tsx --runInBand`  
Expected: FAIL，`api` 尚未接入 handle。

- [ ] **Step 5: 实现 API 门面和启动接线**

`api.ts` 用执行代次持有 runtime、ready deferred 和 disposed 标记。每个方法调用时捕获当前代次，创建新的 requestId 和 AbortController，等待其 ready 后再次确认代次未被替换，再以 `{requestId,signal}` 调用 registry。`expectedRevision` 保留在该方法的 args 中。`ready` 通过 getter 返回当前代次 promise，保证 remount 不复用已 settle 的旧 promise。

`registerCommands.ts` 按 Task 4–14 顺序调用所有 register 函数，并在最后断言没有重复命令。bootstrap 创建 runtime 时传入 historic 订阅；`acquireSession` 激活 API，`sessionTeardown` 先 dispose 代次再执行现有清理。`useCameraStudio` 用模块级单例保持首帧 api 稳定，符合单页单实例约束。

`CameraScene` 使用与 `HostFlowsWiring` 相同的 effect 生命周期绑定完整 Scene Runtime，并在解绑时标记 API_NOT_READY/disposed。`index.ts` 公开 `CameraStudioApi`、DTO、错误和 `agent` 配置类型，不公开内部 resolver。

- [ ] **Step 6: 让 CameraFlows 复用领域入口**

`createHostFlows` 的签名和八方法保持不变。`placeModelAt/addPresetPath/addCamera/addAnchor` 内部调用相同领域函数；原有点击放置和取消放置仍保留 UI 语义。补充断言：原有 `onFlows` 回调只触发一次，卸载不错误调用新 host。

- [ ] **Step 7: 运行全部 Agent 测试、既有测试和 API 构建**

Run: `yarn test packages/camera-studio/src/agent packages/camera-studio/src/CameraScene.test.tsx --runInBand`  
Expected: PASS。  
Run: `yarn workspace @dreamerbird/camera-studio build:api`  
Expected: PASS，API Extractor 无未声明导出或 forgotten export。

```bash
git add packages/camera-studio/src
git commit -m "feat(camera-studio): expose complete browser agent api"
```

---

### Task 16: 契约覆盖、JS 宿主文档和整体验收

**Files:**
- Create: `packages/camera-studio/src/agent/contractCoverage.test.ts`
- Create: `packages/camera-studio/src/agent/expectedCommands.ts`
- Modify: `docs/guides/camera-studio-embedding.md`
- Create: `docs/guides/camera-studio-agent-js-api.md`

**Interfaces:**
- Produces: `EXPECTED_AGENT_COMMANDS`，与规格第 9 节完全一致，供后续 HTTP 与 SKILL 计划复用做覆盖校验。

- [ ] **Step 1: 写命令覆盖失败测试**

`expectedCommands.ts` 使用以下完整常量，后续如需变更必须先改规格：

```ts
export const EXPECTED_AGENT_COMMANDS = [
  'scene.getSnapshot',
  'selection.get', 'selection.selectObject', 'selection.clear',
  'objects.list', 'objects.get', 'objects.update', 'objects.delete',
  'models.create',
  'assets.list', 'assets.get', 'assets.importModel', 'assets.rename', 'assets.delete',
  'poses.apply', 'poses.applyCustom', 'poses.clear', 'poses.saveCurrent', 'poses.setGesture',
  'poses.session.start', 'poses.session.commit', 'poses.session.cancel',
  'animations.apply', 'animations.clear', 'animations.getStatus',
  'cameras.create', 'cameras.setActive', 'cameras.setAimTarget',
  'cameras.bindPath', 'cameras.unbindPath',
  'anchors.create', 'anchors.setParent', 'anchors.clearParent',
  'paths.listPresets', 'paths.createPreset', 'paths.addPoint', 'paths.updatePoint',
  'paths.deletePoint', 'paths.setPointTiming', 'paths.sample',
  'paths.session.startEditing', 'paths.session.exitEditing', 'paths.session.selectPoint',
  'sequence.getState', 'sequence.play', 'sequence.pause', 'sequence.seek', 'sequence.setLength',
  'keyframes.list', 'keyframes.set', 'keyframes.move', 'keyframes.delete',
  'history.undo', 'history.redo',
  'view.getState', 'view.setShotView', 'view.setPipVisible',
  'view.orbit', 'view.pan', 'view.dolly', 'view.reset',
  'ui.hide', 'ui.restore', 'ui.setLeftStripHidden',
  'ui.openPanel', 'ui.closePanel', 'ui.setGizmoMode',
  'project.exportState',
  'exports.startVideo',
  'jobs.get', 'jobs.cancel',
] as const
```

测试比较 `registry.describe().commands.map(c=>c.name)` 与预期集合，缺少和多出都失败；每个项目 mutation 都有 undoable/completion/errorCodes，每个 job 都有 cancelable、completion 和 jobResultSchema，每个命令都有非空 input/output schema。

- [ ] **Step 2: 运行覆盖测试并修正所有缺口**

Run: `yarn test packages/camera-studio/src/agent/contractCoverage.test.ts --runInBand`  
Expected: 初次 FAIL 时必须指出具体缺失命令或元数据；补齐后 PASS，不得通过删除预期命令让测试变绿。

- [ ] **Step 3: 编写 JS 宿主文档**

文档包含：首帧稳定 api、`await api.ready`、查询快照、静态更新与关键帧区别、revision 冲突、模型挂载等待、资产不可 undo、任务查询、dispose/remount、全局暴露和完整命名空间链接。示例必须使用该计划定义的签名，不使用 `any` 绕过类型。

- [ ] **Step 4: 执行完整验证**

Run: `yarn test packages/camera-studio/src --runInBand`  
Expected: PASS；若存在与本改动无关的既有失败，记录原失败输出并逐项对照 main，不得宣称全绿。  
Run: `yarn workspace @dreamerbird/camera-studio build:api`  
Expected: PASS。  
Run: `yarn eslint packages/camera-studio/src/agent packages/camera-studio/src/CameraScene.tsx packages/camera-studio/src/PlacementManager.tsx --rulesdir ./devEnv/eslint/rules`  
Expected: PASS。

- [ ] **Step 5: 更新 graft 图并提交**

Run: `graft build`  
Expected: 图刷新成功。

```bash
git add packages/camera-studio/src/agent docs/guides/camera-studio-embedding.md docs/guides/camera-studio-agent-js-api.md graft
git commit -m "docs(camera-studio): document browser agent api"
```

**第一段完成判据:** 浏览器 JS API 覆盖规格第 9 节全部命令，契约覆盖测试和真实领域测试通过，现有宿主与 UI 保持可用。下一段才能开始 HTTP 桥接。
