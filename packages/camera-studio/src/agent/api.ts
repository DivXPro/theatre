/**
 * 公开浏览器 JS API 门面(2026-10-19,Task 15,spec §7):
 *
 * - 命名空间方法直接返回领域结果并以 AgentApiError 抛错,绝不包装
 *   `{ok,result}` 信封(信封是 HTTP 桥接层的传输形态,spec 8.3)。
 * - 每次调用捕获当前执行代次({runtime, registry} 对),生成新 requestId
 *   与 AbortController,等待该代次 ready 后复核代次未被替换,再以
 *   `{requestId, signal}` 调注册表;`expectedRevision` 保留在 args 内透传。
 * - `ready` getter 返回当前代次的 promise:handlers 解绑使代次失效
 *   (旧代次未 settle 的 ready 以 API_NOT_READY 拒绝,不悬挂——预检裁定),
 *   remount 绑定新代次后返回新 promise,绝不复用已 settle 的旧 promise;
 *   旧代次已捕获的 promise 不写入新 runtime。
 * - 会话拆解(dispose)是永久终结:pending 的激活/就绪/挂载等待全部以
 *   API_DISPOSED 拒绝,在途任务硬取消;之后重挂(acquireSession)激活新
 *   会话,API 恢复可用。
 * - 浏览器默认不挂 window 全局:仅 activate 携带 exposeGlobal:true 时,
 *   场景首次 ready 后挂载 window.__cameraStudioApi,dispose 时删除。
 *
 * 模块级单例(getCameraStudioApi)服务生产单页单实例;createCameraStudioApi
 * 每次返回独立控制器,供测试隔离。activate/dispose/bindSceneHandlers/
 * getActiveAgentRuntime 是内部接线口,不随 index.ts 公开。
 */
import {AgentApiError} from './errors'
import {AgentCommandRegistry} from './registry'
import type {RegistryDescription} from './registry'
import type {AgentRuntime, AgentSceneRuntimeHandlers} from './runtime'
import {isGenerationSupersededError} from './runtime'
import {registerAllAgentCommands} from './registerCommands'
import type {SceneApi, ObjectsApi} from './commands/scene'
import type {SelectionApi} from './commands/selection'
import type {ModelsApi} from './commands/models'
import type {AssetsApi} from './commands/assets'
import type {PosesApi, PosesSessionApi} from './commands/poses'
import type {AnimationsApi} from './commands/animations'
import type {CamerasApi} from './commands/cameras'
import type {AnchorsApi} from './commands/anchors'
import type {PathsApi, PathsSessionApi} from './commands/paths'
import type {SequenceApi} from './commands/sequence'
import type {KeyframesApi} from './commands/keyframes'
import type {HistoryApi} from './commands/history'
import type {ViewApi} from './commands/view'
import type {UiApi} from './commands/ui'
import type {ProjectApi} from './commands/project'
import type {ExportsApi} from './commands/exports'
import type {JobsApi} from './commands/jobs'

/** 宿主可见的完整 JS API(spec §7 句柄 + §9 命令面) */
export type CameraStudioApi = {
  /**
   * 当前执行代次的就绪 promise:project、studio 与 Scene Runtime
   * (CameraScene 绑定完整 handlers)就位后兑现;代次失效(解绑)以
   * API_NOT_READY 拒绝,会话拆解以 API_DISPOSED 拒绝。
   */
  readonly ready: Promise<void>
  /** 当前会话的命令清单与元数据(spec 8.1);未激活 API_NOT_READY,已拆解 API_DISPOSED */
  describe(): RegistryDescription
  readonly scene: SceneApi
  readonly selection: SelectionApi
  readonly objects: ObjectsApi
  readonly models: ModelsApi
  readonly assets: AssetsApi
  readonly poses: PosesApi & {readonly session: PosesSessionApi}
  readonly animations: AnimationsApi
  readonly cameras: CamerasApi
  readonly anchors: AnchorsApi
  readonly paths: PathsApi & {readonly session: PathsSessionApi}
  readonly sequence: SequenceApi
  readonly keyframes: KeyframesApi
  readonly history: HistoryApi
  readonly view: ViewApi
  readonly ui: UiApi
  readonly project: ProjectApi
  readonly exports: ExportsApi
  readonly jobs: JobsApi
}

/** 会话槽:runtime 是当前代次 facade,handler 解绑换代时整体替换 */
type Session = {
  runtime: AgentRuntime
  registry: AgentCommandRegistry
  /** 会话令牌:exposeGlobal 延迟挂载据此识别会话更替 */
  readonly token: object
}

type RegistryFactory = (runtime: AgentRuntime) => AgentCommandRegistry

const defaultRegistryFactory: RegistryFactory = (runtime) => {
  const registry = new AgentCommandRegistry()
  registerAllAgentCommands(registry, runtime)
  return registry
}

/** 测试隔离口:替换注册表构造(默认 registerAllAgentCommands 全量注册) */
export type CameraStudioApiOptions = {
  buildRegistry?: RegistryFactory
}

/** activate 的会话级选项 */
export type CameraStudioApiActivateOptions = {
  /** 场景首次 ready 后挂载 window.__cameraStudioApi;dispose 时删除 */
  exposeGlobal?: boolean
}

export type CameraStudioApiController = {
  readonly api: CameraStudioApi
  /** 激活新会话(首 boot 或重挂);防御性先 dispose 未拆解的旧会话 */
  activate(
    runtime: AgentRuntime,
    options?: CameraStudioApiActivateOptions,
  ): void
  /** 会话拆解:拒绝全部 pending 等待,摘除 window 全局,永久失效到下次 activate */
  dispose(): void
  /**
   * CameraScene 绑定完整 Scene Runtime handlers 并 markReady;
   * 返回解绑函数:解绑使本代次就绪失效并换代(后续调用挂起到重绑)。
   * 无活跃会话(CameraScene 直连宿主、未走 bootstrap)时静默降级为 no-op。
   */
  bindSceneHandlers(
    handlers: Partial<AgentSceneRuntimeHandlers>,
  ): (() => void) | undefined
  /** 内部:当前会话的 runtime(测试与页内桥接调试用) */
  currentRuntime(): AgentRuntime | undefined
}

let requestIdFallbackCounter = 0

/** requestId:优先 crypto.randomUUID;缺失时回退进程内计数器(与 jobs 同模式) */
function newRequestId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  requestIdFallbackCounter += 1
  return `req-${Date.now()}-${requestIdFallbackCounter}`
}

const API_DISPOSED_MESSAGE = 'Camera Studio API 已销毁'

/** 已拒绝 promise 的兜底:无人 await 也不触发 unhandledRejection */
function rejectedWith(error: AgentApiError): Promise<never> {
  const promise = Promise.reject(error)
  promise.catch(() => {})
  return promise
}

export function createCameraStudioApi(
  options?: CameraStudioApiOptions,
): CameraStudioApiController {
  const buildRegistry = options?.buildRegistry ?? defaultRegistryFactory
  let session: Session | undefined
  /** 最近一次状态转移是 dispose(初态 false:从未激活 = 等待首激活,不是已销毁) */
  let sessionDisposed = false
  /** 首激活/重激活的等待者(ready 与命令调用在会话缺席时挂起于此) */
  const activationWaiters = new Set<{
    resolve: () => void
    reject: (error: unknown) => void
  }>()

  function waitForActivation(): Promise<void> {
    return new Promise((resolve, reject) => {
      activationWaiters.add({resolve, reject})
    })
  }

  async function invoke<R>(name: string, args: unknown): Promise<R> {
    // 捕获当前代次:调用钉在捕获时的 {runtime, registry} 对上
    let captured = session
    if (!captured) {
      if (sessionDisposed) {
        throw new AgentApiError('API_DISPOSED', API_DISPOSED_MESSAGE)
      }
      // 首 boot 进行中:挂起到首次激活再重新捕获
      await waitForActivation()
      captured = session
      if (!captured) {
        // activate 与 dispose 竞态(单线程下即 dispose 先行):按已销毁处理
        throw new AgentApiError('API_DISPOSED', API_DISPOSED_MESSAGE)
      }
    }
    const requestId = newRequestId()
    const controller = new AbortController()
    // 等待本代次 ready;解绑换代 → API_NOT_READY,会话拆解 → API_DISPOSED
    await captured.runtime.ready
    // ready 兑现后再次被替换的竞态复核:解绑换代间隙(StrictMode 双跑/
    // remount)命中 superseded 代次 ≠ 会话销毁,映射为可重试的 API_NOT_READY;
    // 永久 API_DISPOSED 只属 dispose()/会话拆解(Fix round 1)
    try {
      captured.runtime.assertCurrent()
    } catch (error) {
      if (isGenerationSupersededError(error)) {
        throw new AgentApiError(
          'API_NOT_READY',
          '执行代次已被替换(Scene Runtime 重绑中),可重试',
          {retryable: true},
        )
      }
      throw error
    }
    return captured.registry.execute(name, args, {
      requestId,
      signal: controller.signal,
    }) as Promise<R>
  }

  const api: CameraStudioApi = {
    get ready(): Promise<void> {
      if (session) return session.runtime.ready
      if (sessionDisposed) {
        return rejectedWith(
          new AgentApiError('API_DISPOSED', API_DISPOSED_MESSAGE),
        )
      }
      // 首 boot 进行中:挂起到首次激活,再沿用该代次的 ready
      const promise = waitForActivation().then(() => {
        const s = session
        if (!s) {
          throw new AgentApiError('API_DISPOSED', API_DISPOSED_MESSAGE)
        }
        return s.runtime.ready
      })
      promise.catch(() => {})
      return promise
    },
    describe(): RegistryDescription {
      if (session) return session.registry.describe()
      if (sessionDisposed) {
        throw new AgentApiError('API_DISPOSED', API_DISPOSED_MESSAGE)
      }
      throw new AgentApiError(
        'API_NOT_READY',
        'Camera Studio API 尚未激活(场景未挂载)',
      )
    },
    scene: {
      getSnapshot: () => invoke('scene.getSnapshot', undefined),
    },
    selection: {
      get: () => invoke('selection.get', undefined),
      selectObject: (args) => invoke('selection.selectObject', args),
      clear: () => invoke('selection.clear', undefined),
    },
    objects: {
      list: () => invoke('objects.list', undefined),
      get: (args) => invoke('objects.get', args),
      update: (args) => invoke('objects.update', args),
      delete: (args) => invoke('objects.delete', args),
    },
    models: {
      create: (args) => invoke('models.create', args),
    },
    assets: {
      list: (args) => invoke('assets.list', args),
      get: (args) => invoke('assets.get', args),
      importModel: (args) => invoke('assets.importModel', args),
      rename: (args) => invoke('assets.rename', args),
      delete: (args) => invoke('assets.delete', args),
    },
    poses: {
      apply: (args) => invoke('poses.apply', args),
      applyCustom: (args) => invoke('poses.applyCustom', args),
      clear: (args) => invoke('poses.clear', args),
      saveCurrent: (args) => invoke('poses.saveCurrent', args),
      setGesture: (args) => invoke('poses.setGesture', args),
      session: {
        start: (args) => invoke('poses.session.start', args),
        commit: () => invoke('poses.session.commit', undefined),
        cancel: () => invoke('poses.session.cancel', undefined),
      },
    },
    animations: {
      apply: (args) => invoke('animations.apply', args),
      clear: (args) => invoke('animations.clear', args),
      getStatus: (args) => invoke('animations.getStatus', args),
    },
    cameras: {
      create: (args) => invoke('cameras.create', args),
      setActive: (args) => invoke('cameras.setActive', args),
      setAimTarget: (args) => invoke('cameras.setAimTarget', args),
      bindPath: (args) => invoke('cameras.bindPath', args),
      unbindPath: (args) => invoke('cameras.unbindPath', args),
    },
    anchors: {
      create: (args) => invoke('anchors.create', args),
      setParent: (args) => invoke('anchors.setParent', args),
      clearParent: (args) => invoke('anchors.clearParent', args),
    },
    paths: {
      listPresets: () => invoke('paths.listPresets', undefined),
      createPreset: (args) => invoke('paths.createPreset', args),
      addPoint: (args) => invoke('paths.addPoint', args),
      updatePoint: (args) => invoke('paths.updatePoint', args),
      deletePoint: (args) => invoke('paths.deletePoint', args),
      setPointTiming: (args) => invoke('paths.setPointTiming', args),
      sample: (args) => invoke('paths.sample', args),
      session: {
        startEditing: (args) => invoke('paths.session.startEditing', args),
        exitEditing: () => invoke('paths.session.exitEditing', undefined),
        selectPoint: (args) => invoke('paths.session.selectPoint', args),
      },
    },
    sequence: {
      getState: () => invoke('sequence.getState', undefined),
      play: () => invoke('sequence.play', undefined),
      pause: () => invoke('sequence.pause', undefined),
      seek: (args) => invoke('sequence.seek', args),
      setLength: (args) => invoke('sequence.setLength', args),
    },
    keyframes: {
      list: (args) => invoke('keyframes.list', args),
      set: (args) => invoke('keyframes.set', args),
      move: (args) => invoke('keyframes.move', args),
      delete: (args) => invoke('keyframes.delete', args),
    },
    history: {
      undo: (args) => invoke('history.undo', args),
      redo: (args) => invoke('history.redo', args),
    },
    view: {
      getState: () => invoke('view.getState', undefined),
      setShotView: (args) => invoke('view.setShotView', args),
      setPipVisible: (args) => invoke('view.setPipVisible', args),
      orbit: (args) => invoke('view.orbit', args),
      pan: (args) => invoke('view.pan', args),
      dolly: (args) => invoke('view.dolly', args),
      reset: () => invoke('view.reset', undefined),
    },
    ui: {
      hide: () => invoke('ui.hide', undefined),
      restore: () => invoke('ui.restore', undefined),
      setLeftStripHidden: (args) => invoke('ui.setLeftStripHidden', args),
      openPanel: (args) => invoke('ui.openPanel', args),
      closePanel: (args) => invoke('ui.closePanel', args),
      setGizmoMode: (args) => invoke('ui.setGizmoMode', args),
    },
    project: {
      exportState: () => invoke('project.exportState', undefined),
    },
    exports: {
      startVideo: (args) => invoke('exports.startVideo', args),
    },
    jobs: {
      get: (args) => invoke('jobs.get', args),
      cancel: (args) => invoke('jobs.cancel', args),
    },
  }

  function unmountGlobal(): void {
    if (
      typeof window !== 'undefined' &&
      (window as unknown as Record<string, unknown>).__cameraStudioApi === api
    ) {
      delete (window as unknown as Record<string, unknown>).__cameraStudioApi
    }
  }

  function activate(
    runtime: AgentRuntime,
    activateOptions?: CameraStudioApiActivateOptions,
  ): void {
    // 防御:未 dispose 就 activate 属用法异常(bootstrap 的 acquireSession
    // 幂等守卫保证不会发生),按先拆旧会话处理,不留双会话
    if (session) dispose()
    sessionDisposed = false
    const token = {}
    session = {token, runtime, registry: buildRegistry(runtime)}
    // 激活等待者兑现:ready getter 与在途调用各自重新捕获当前代次
    for (const waiter of [...activationWaiters]) {
      activationWaiters.delete(waiter)
      waiter.resolve()
    }
    if (activateOptions?.exposeGlobal && typeof window !== 'undefined') {
      // 场景首次 ready 后才挂全局;会话已更替/拆解(令牌不符)则不挂
      void Promise.resolve(runtime.ready).then(
        () => {
          if (!session || session.token !== token) return
          ;(window as unknown as Record<string, unknown>).__cameraStudioApi =
            api
        },
        () => {},
      )
    }
  }

  function dispose(): void {
    const captured = session
    session = undefined
    sessionDisposed = true
    unmountGlobal()
    if (captured) {
      // runtime.dispose 连锁收尾:historic 退订、在途任务硬取消、
      // placement/camera/anchor 挂载 waiter 与全部代次 ready 拒绝
      captured.runtime.dispose()
    }
    for (const waiter of [...activationWaiters]) {
      activationWaiters.delete(waiter)
      waiter.reject(new AgentApiError('API_DISPOSED', API_DISPOSED_MESSAGE))
    }
  }

  function bindSceneHandlers(
    handlers: Partial<AgentSceneRuntimeHandlers>,
  ): (() => void) | undefined {
    const s = session
    // 无会话(CameraScene 直连宿主未走 bootstrap):静默降级
    if (!s) return undefined
    const generation = s.runtime
    const unbind = generation.bindHandlers(handlers)
    generation.markReady()
    return () => {
      unbind()
      // handler 解绑 = 本代次就绪失效(预检裁定):换代并让旧代次未
      // settle 的 ready 以 API_NOT_READY 拒绝;后续调用挂起到重绑。
      // 永久性 API_DISPOSED 只留给会话拆解(dispose)
      if (session && session.runtime === generation) {
        try {
          const next = generation.activate()
          session = {...session, runtime: next, registry: buildRegistry(next)}
        } catch {
          // 会话已拆解:dispose 已拒绝全部代次,无需换代
        }
      }
    }
  }

  return {
    api,
    activate,
    dispose,
    bindSceneHandlers,
    currentRuntime: () => session?.runtime,
  }
}

// ── 模块级单例(生产唯一实例;单页单实例约束,spec §7) ────────────
const controller = createCameraStudioApi()

/** 宿主门面单例:useCameraStudio 首帧与后续 render 返回同一对象 */
export function getCameraStudioApi(): CameraStudioApi {
  return controller.api
}

/** 内部(bootstrap 会话装配用;不随 index.ts 公开):激活新会话 */
export function activateCameraStudioApi(
  runtime: AgentRuntime,
  options?: CameraStudioApiActivateOptions,
): void {
  controller.activate(runtime, options)
}

/** 内部(bootstrap 会话拆解用):先于此会话其余清理调用 */
export function disposeCameraStudioApi(): void {
  controller.dispose()
}

/** 内部(CameraScene 绑定用):绑定完整 Scene Runtime handlers 并 markReady */
export function bindCameraStudioSceneHandlers(
  handlers: Partial<AgentSceneRuntimeHandlers>,
): (() => void) | undefined {
  return controller.bindSceneHandlers(handlers)
}

/** 内部(测试与页内桥接调试用):当前会话的 runtime;无会话返回 undefined */
export function getActiveAgentRuntime(): AgentRuntime | undefined {
  return controller.currentRuntime()
}
