# camera-studio Agent JS API(浏览器命令面)

> 面向宿主应用与页内自动化(Agent)开发者。`@dreamerbird/camera-studio` 除了嵌入
> 编辑器 UI(见 [camera-studio-embedding.md](./camera-studio-embedding.md)),还暴露
> 一个稳定的浏览器 JS 命令面:`scene / selection / objects / models / assets /
> poses / animations / cameras / anchors / paths / sequence / keyframes /
> history / view / ui / project / exports / jobs` 共 18 个命名空间、71 条命令
> (与设计规格 §9 一致,`poses.session` 与 `paths.session` 为嵌套命名空间)。
>
> 设计规格:`docs/superpowers/specs/2026-10-17-camera-studio-agent-api-design.md`
> (§7 JS 句柄、§8 语义、§9 操作清单)。命令面有契约覆盖测试
> (`packages/camera-studio/src/agent/contractCoverage.test.ts`)兜底,缺少或多出
> 命令都会失败。

## 1. 拿到 api:首帧稳定的门面

`useCameraStudio` 返回的句柄上带 `api` 字段:

```tsx
import {useCameraStudio, CameraScene} from '@dreamerbird/camera-studio'

export function CameraPage() {
  const {ready, error, sceneProps, api} = useCameraStudio({project: 'Space'})
  if (error) return <div>加载失败:{error.message}</div>
  if (!ready) return null
  return <CameraScene {...sceneProps} />
}
```

`api` 是**模块级单例,首帧即稳定**:hook 首帧与后续每次 render 返回的都是同一个
对象,可以安全地放进 `useEffect` 依赖、存进 ref 或模块级变量,不存在「换了一个
api 对象」的订阅漂移。它的内部会话会随场景挂载/卸载换代(见 §9),但门面身份不变。

## 2. 就绪:await api.ready

`api.ready` 是一个 promise,在 **project + studio + Scene Runtime**(CameraScene
绑定完整 handlers)全部就位后兑现。命令调用内部也会先等 ready,所以两种写法都行:

```ts
// 显式等待:适合在调用前做一次性初始化
await api.ready

// 直接调用:场景未就绪时调用自动挂起,ready 后继续执行
const snapshot = await api.scene.getSnapshot()
```

场景还没挂载时调用会挂起而不是报错;组件卸载(会话拆解)后,挂起与在途的调用统一
以 `API_DISPOSED` 拒绝;重挂过程中的竞态窗口会收到 `retryable: true` 的
`API_NOT_READY`,直接重试即可(见 §9)。

## 3. 查询快照:scene.getSnapshot 与 revision

```ts
import type {SceneSnapshot} from '@dreamerbird/camera-studio'

const snapshot: SceneSnapshot = await api.scene.getSnapshot()
// snapshot.revision —— 当前会话内单调递增的项目版本
// snapshot.objects  —— 带类型对象清单:[{id, kind, key, props, mounted}, ...]
for (const object of snapshot.objects) {
  console.log(object.id, object.mounted ? object.props : '(未挂载)')
}
```

场景对象使用带类型稳定 ID:`model:<key>` / `camera:<key>` / `anchor:<key>` /
`path:<key>`(类型不匹配返回 `INVALID_ID_KIND`,不存在返回 `OBJECT_NOT_FOUND`)。
逐对象读取用 `api.objects.list()` / `api.objects.get({objectId})`,选择状态用
`api.selection.get()`。

`revision` 只在**当前浏览器场景会话**内有效:页面重载或场景重挂后从 1 重计,不得
复用旧会话的 revision。

## 4. 静态更新与关键帧的区别

这是命令面最容易踩的一条分界线:

- `objects.update` 只修改**静态属性**——对象当前求值属性的基线值,不产生动画轨道:

```ts
await api.objects.update({
  objectId: 'model:Y Bot',
  props: {position: {x: 2, y: 0, z: -1}},
})
```

  `props` 是顶层属性 patch;compound 属性(如 `position`)必须提供完整有效值,不做
  任意深层合并。**如果该属性已经建轨(有序列轨道),静态更新返回 `INVALID_STATE`**
  ——此时值由时间轴驱动,改静态值没有意义。

- 要做动画,必须显式走 `keyframes.*` 建轨/写帧:

```ts
// 首次建轨与写值合并为一步(历史里也只呈现一步)
await api.keyframes.set({
  objectId: 'model:Y Bot',
  propPath: ['position'],
  at: 0,
  value: {x: 2, y: 0, z: -1},
  snap: true, // 可选:吸附到网格
})
```

姿势、手势、动画和路径绑定的普通命令(`poses.apply`、`animations.apply`、
`cameras.bindPath` 等)同样默认写静态值;它们的可动画属性要动画化,也是显式调
`keyframes.set`。

## 5. 乐观并发:expectedRevision 与 REVISION_CONFLICT

所有项目写命令(`objects.update`、`objects.delete`、`models.create`、
`keyframes.set` 等)都可选接受 `expectedRevision`——你读取场景时的 revision。
不匹配时**不执行写入**,返回 `REVISION_CONFLICT`:

```ts
import {AgentApiError} from '@dreamerbird/camera-studio'

const snapshot = await api.scene.getSnapshot()
try {
  await api.objects.update({
    objectId: 'model:Y Bot',
    props: {position: {x: 3, y: 0, z: 0}},
    expectedRevision: snapshot.revision,
  })
} catch (error) {
  if (error instanceof AgentApiError && error.code === 'REVISION_CONFLICT') {
    // 场景在你读取后已被改动:重新取快照,基于新 revision 再试
  } else {
    throw error
  }
}
```

资产和会话命令不使用项目 revision 伪装并发保护(资产的并发一致性是存储层的职责)。

## 6. 完成阶段:模型挂载等待

写命令声明自己的完成阶段(`completion`),**到达该阶段后才返回成功**:

| 阶段        | 含义                               | 例子                                          |
| ----------- | ---------------------------------- | --------------------------------------------- |
| `committed` | 项目数据已提交(Theatre 事务落盘)   | `objects.update`、`keyframes.set`             |
| `mounted`   | React/Three 对象已挂载             | `models.create`、`cameras.create`、`anchors.create` |
| `loaded`    | 资源(动画/姿势/模型文件)已加载     | `assets.importModel`(任务)                    |

实际意义:`models.create` 返回时对象**真的挂上了**,可以立刻对它调
`cameras.setActive`、`poses.apply` 等后续命令,不需要自己轮询「出现了没」:

```ts
const {objectId} = await api.models.create({
  assetId: entry.id, // 来自 api.assets.list() 的模型条目
  position: {x: 0, y: 0, z: 0},
})
// 此处模型已挂载完成(completion: mounted)
await api.poses.apply({objectId, assetId: poseEntry.id})
```

`api.describe()` 返回的每条命令元数据里都带 `completion` 字段,自动化代码可以按
它判断「这条命令返回到哪一步」。

## 7. 资产操作不可撤销

`history.undo` / `history.redo` 只覆盖 **Theatre 项目状态**(对象、属性、关键帧、
路径、相机绑定等)。资产条目(`assets.importModel` / `rename` / `delete`)和
`poses.saveCurrent` 不属于 undo 体系,`undoable: 'none'`:

```ts
// 项目内操作:可撤销
await api.objects.delete({objectId: 'model:Y Bot'})
await api.history.undo()

// 资产操作:不可撤销,删了就是删了
await api.assets.delete({assetId: 'asset-1'})
```

同理,`project.exportState()` 只导出 Theatre 项目存档,**不含**资产、活动相机、
PIP、编辑会话或导出任务;需要完整工作区恢复时,项目存档与资产一致性要分别处理。

## 8. 长任务:jobs.get / jobs.cancel

无法在请求周期内完成的操作返回任务句柄,`{jobId}` 不等于成功:

```ts
import type {JobSnapshot} from '@dreamerbird/camera-studio'
import type {VideoExportResult} from '@dreamerbird/camera-studio'

const {jobId} = await api.exports.startVideo() // 缺省用当前活动相机

let job: JobSnapshot = await api.jobs.get({jobId})
while (job.state === 'pending' || job.state === 'running') {
  await new Promise((resolve) => setTimeout(resolve, 500))
  job = await api.jobs.get({jobId})
}
if (job.state === 'succeeded') {
  const result = job.result as VideoExportResult | undefined
  console.log(result?.fileName, result?.size) // JS 侧结果带 blob
} else if (job.state === 'failed') {
  console.error(job.error?.code, job.error?.message)
}
```

任务状态机:`pending | running | succeeded | failed | cancelled`。`jobs.cancel`
只接受元数据标记 `cancelable` 的任务(`assets.importModel`、`exports.startVideo`),
其余返回 `JOB_NOT_CANCELABLE`。用户中止的导出映射为 `cancelled`,不算失败。

模型导入同理:

```ts
async function importPicked(file: File): Promise<void> {
  const {jobId} = await api.assets.importModel({file})
  // 轮询 api.jobs.get({jobId});succeeded 后 job.result 是入库的模型条目
}
```

## 9. dispose / remount:会话生命周期

- **卸载宿主组件**(路由切走)= 会话拆解:挂起的 `ready`、在途命令、挂载等待与
  在途任务全部以 `API_DISPOSED` 结束;`window.__cameraStudioApi`(若开启)被摘除。
- **重挂**(路由切回)= 自动激活新会话:`api` 门面是同一个对象,`api.ready` 返回新
  的 promise 并重新兑现;revision 从 1 重计,**不要复用旧会话的 revision**。
- **重挂间隙**(React StrictMode 双跑、handlers 换绑的竞态窗口):旧代次的调用以
  `retryable: true` 的 `API_NOT_READY` 拒绝——这是可重试信号,不是会话死亡;
  永久性终结只有 `API_DISPOSED`。

```ts
import {AgentApiError} from '@dreamerbird/camera-studio'

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (
      error instanceof AgentApiError &&
      error.code === 'API_NOT_READY' &&
      error.retryable
    ) {
      await api.ready // 等新代次就绪
      return fn()
    }
    throw error
  }
}
```

## 10. 全局暴露:agent.exposeGlobal

浏览器默认**不挂**任何 window 全局。显式开启后,场景首次 ready 时把门面挂到
`window.__cameraStudioApi`,会话拆解时删除:

```tsx
const {api} = useCameraStudio({
  project: 'Space',
  agent: {exposeGlobal: true},
})
// 场景 ready 后:window.__cameraStudioApi === api(同一对象)
```

适合 DevTools 手搓调试与页内脚本桥接;生产宿主建议直接用 hook 返回的 `api`,
类型完整且不依赖全局:

```ts
import type {CameraStudioApi} from '@dreamerbird/camera-studio'

const globalApi = (window as unknown as {__cameraStudioApi?: CameraStudioApi})
  .__cameraStudioApi
```

## 11. 命令清单与元数据:api.describe()

```ts
import type {RegistryDescription} from '@dreamerbird/camera-studio'

const schema: RegistryDescription = api.describe()
// schema.apiVersion === 1
// schema.commands:每条命令的 name / kind(query|mutation|job) / stateDomain /
//   undoable / completion / cancelable / errorCodes / inputSchema / outputSchema /
//   jobResultSchema / acceptsExpectedRevision
```

`describe()` 只发布真实可用的命令(不发布空壳),input/output schema 是 JSON
Schema 子集,供客户端校验与工具发现。未激活时抛 `API_NOT_READY`,会话拆解后抛
`API_DISPOSED`。

## 12. 错误族

所有失败以 `AgentApiError` 抛出(JS 侧直接 throw,不包装 `{ok, result}` 信封):
`{code, message, retryable, details?}`。`code` 是稳定的分支依据,完整码表从包根
导出(`AGENT_API_ERROR_CODES` / `AgentApiErrorCode`),常用:

| code                | 场景                                         |
| ------------------- | -------------------------------------------- |
| `API_NOT_READY`     | 场景未就绪/重挂间隙;`retryable: true` 可重试 |
| `API_DISPOSED`      | 会话已拆解,永久                              |
| `INVALID_ARGUMENT`  | 参数校验失败(validate 阶段,无副作用)       |
| `INVALID_ID_KIND`   | 带类型 ID 的类型前缀不匹配                   |
| `OBJECT_NOT_FOUND` / `ASSET_NOT_FOUND` | 目标不存在                |
| `INVALID_STATE`     | 静态属性已建轨、无可写存储源等状态冲突       |
| `REVISION_CONFLICT` | `expectedRevision` 不匹配,未执行写入       |
| `JOB_NOT_FOUND` / `JOB_NOT_CANCELABLE` | 任务不存在/不可取消      |
| `STORAGE_ERROR` / `NETWORK_ERROR` | 资产库存储/网络失败(可重试)  |
| `INTERNAL_ERROR`    | 未归一的内部错误                             |

## 13. 命名空间总览(71 条命令)

与设计规格 §9 一一对应;带 ✅ 细节锚点的条目见上文对应小节。

| 命名空间      | 方法                                                                                          | 语义 |
| ------------- | --------------------------------------------------------------------------------------------- | ---- |
| `scene`       | `getSnapshot`                                                                                  | 项目 revision、带类型对象清单、求值属性、挂载状态(§3) |
| `selection`   | `get` / `selectObject` / `clear`                                                               | Theatre 对象选择;清空时同时清理会话选择 |
| `objects`     | `list` / `get` / `update` / `delete`                                                           | 读取、静态属性更新(§4)、按类型完整删除 |
| `models`      | `create`                                                                                       | 从模型资产创建到指定位置,等挂载完成(§6) |
| `assets`      | `list` / `get` / `importModel` / `rename` / `delete`                                           | 资产库管理;不可 undo(§7);导入是任务(§8) |
| `poses`       | `apply` / `applyCustom` / `clear` / `saveCurrent` / `setGesture`                               | 库姿势、自定义骨骼姿势、清除、保存、左右手势 |
| `poses.session` | `start` / `commit` / `cancel`                                                                | 需要已挂载 Rig 的 IK 姿势会话 |
| `animations`  | `apply` / `clear` / `getStatus`                                                                | 设置/清除动画资产,独立查询资源加载状态 |
| `cameras`     | `create` / `setActive` / `setAimTarget` / `bindPath` / `unbindPath`                            | 相机创建、活动镜头、瞄准目标、路径绑定 |
| `anchors`     | `create` / `setParent` / `clearParent`                                                         | 锚点创建、父级/骨骼绑定及坐标换算 |
| `paths`       | `listPresets` / `createPreset` / `addPoint` / `updatePoint` / `deletePoint` / `setPointTiming` / `sample` | 路径预设、控制点、手柄、自动/固定 u、运行时采样 |
| `paths.session` | `startEditing` / `exitEditing` / `selectPoint`                                               | 路径编辑态与控制点选择 |
| `sequence`    | `getState` / `play` / `pause` / `seek` / `setLength`                                           | 播放、暂停、定位(可选网格吸附)、时长 |
| `keyframes`   | `list` / `set` / `move` / `delete`                                                             | 显式关键帧(§4) |
| `history`     | `undo` / `redo`                                                                                | 只管 Theatre 项目历史(§7) |
| `view`        | `getState` / `setShotView` / `setPipVisible` / `orbit` / `pan` / `dolly` / `reset`             | 活动镜头视图、PIP、导演视角 |
| `ui`          | `hide` / `restore` / `setLeftStripHidden` / `openPanel` / `closePanel` / `setGizmoMode`        | Studio 与 CameraScene UI 操作 |
| `project`     | `exportState`                                                                                  | 导出 Theatre 项目存档(不含资产与会话,§7) |
| `exports`     | `startVideo`                                                                                   | 从指定或活动相机导出视频,返回任务 ID(§8) |
| `jobs`        | `get` / `cancel`                                                                               | 查询或取消长任务(§8) |
