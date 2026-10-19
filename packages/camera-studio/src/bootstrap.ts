/**
 * 装配入口(spec §4/§7):theatre.init 检测复用、词典显式注册、
 * 数据源聚合接线、编辑器注册、状态通道、sync 透传。
 * init 挂共享 promise——StrictMode 双跑/重复触发只复用,不重复执行。
 *
 * 生命周期分层(R14):
 * - boot 级(一次性,initPromise 保留):Library 单例、IDB 连接、词典、
 *   theatre.init、project 解析、节流机械。重挂幂等复用,dispose 不拆。
 * - 会话级(每次挂载 acquire,dispose 拆解):3 个自定义属性编辑器注册、
 *   state 通道订阅、studio.ui 显隐。picker 注册表与宿主句柄由各自模块
 *   自管(CameraScene 组件挂载时接线),这里不碰。
 */
import theatre, {
  getProject,
  getStudio,
  getStudioSync,
  onChange,
} from '@dreamerbird/core'
import type {IProject, IStudioUI, InitOpts} from '@dreamerbird/core'
// studio 根模块加载即向 core 自注册(new Studio() + setStudio + 挂 window
// bundle):theatre.init({studio: true}) 要求这步已完成,缺了它 init 报
// "@dreamerbird/studio has not loaded" 且 studio UI 整体缺失(T10 fix
// round 1 冒烟实证)。模块求值序天然先于本模块任何语句,放最顶部。
import '@dreamerbird/studio'
import {initState} from '@dreamerbird/core/initState'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import {
  registerCustomPropEditor,
  unregisterCustomPropEditor,
} from '@dreamerbird/studio/propEditors/customPropEditors'
import type {CameraSceneProps, CameraStudioConfig} from './config'
import {cameraErrorFromLibrary, cameraErrorFromUnknown} from './errors'
import {registerCameraMessages} from './i18n'
import {configureLibrary} from './assetLibrary/library'
import {ensureBuiltinRigAlias} from './assetLibrary/library'
import type {Library} from './assetLibrary/library'
import {IndexedDBBackend} from './assetLibrary/indexedDBBackend'
import {StaticCatalogSource} from './assetLibrary/staticCatalogSource'
import {isWritableSource} from './assetLibrary/source'
import type {LibrarySource} from './assetLibrary/source'
import {cleanupLegacySeeds} from './assetLibrary/legacySeedCleanup'
import {setUiConfig} from './uiConfig'
import PosePropEditor from './poseMode/PosePropEditor'
import {
  GesturePropEditorLeft,
  GesturePropEditorRight,
} from './gesturePropsEditor'
import {createAgentRuntime} from './agent/runtime'
import {
  activateCameraStudioApi,
  disposeCameraStudioApi,
  getActiveAgentRegistry,
  getCameraStudioApi,
} from './agent/api'
import type {CameraStudioApi} from './agent/api'
import {createAgentBridgeClient} from './agent/bridgeClient'
import type {AgentBridgeClient} from './agent/bridgeClient'

/** 内置 IDB 缺省库名(与现状一字不差,硬约束:老用户浏览器里的库零迁移) */
const DEFAULT_IDB_NAME = 'toybox-asset-library'

export interface BootCtx {
  config: CameraStudioConfig
  library: Library
  unregisterEditors: () => void
  /** 节流通道手动 flush:dispose 时调用,尾部变更不丢 */
  flushState: () => void
  /**
   * 状态通道入口:生产由 project 历史指针订阅喂入,测试可直接调。
   * 尾部节流(缺省 1000ms)后转给 config.state.onStateChange。
   */
  notifyStateChange: (content: unknown) => void
  sceneProps: CameraSceneProps
  /** Agent JS API 门面(模块级单例,与 useCameraStudio 返回的同一对象) */
  api: CameraStudioApi
}

let initPromise: Promise<BootCtx> | undefined
/** 首次 boot 使用的 config;重挂漂移告警与 hook 占位解析的依据 */
let bootConfig: CameraStudioConfig | undefined
/** 漂移告警只发一次(同页多次重挂不同 config 不刷屏) */
let warnedConfigDrift = false
/** 会话拆解函数;undefined = 当前无活跃会话(acquire 幂等守卫) */
let sessionTeardown: (() => Promise<void>) | undefined
/** 消费者计数由 hook 管(acquire/release 成对);dispose 据此做末位守卫 */
let activeConsumers = 0

/**
 * 消费者占位/还位(hook 与 StrictMode 双跑对称用;不经 index.ts 公开)。
 * 返回占位后的计数:大于 1 即同页第二实例,调用方应报错且不碰 init。
 */
export function acquireCameraStudioConsumer(): number {
  return ++activeConsumers
}
export function releaseCameraStudioConsumer(): number {
  return --activeConsumers
}

/** project 解析:字符串 → getProject(initialState 透传);IProject 实例 → 直接用 */
function resolveProject(config: CameraStudioConfig): IProject {
  if (config.project && typeof config.project !== 'string') {
    if (config.state?.initialState !== undefined) {
      console.warn(
        '[camera-studio] config.project 传了 IProject 实例,' +
          'state.initialState 被忽略(实例的状态由创建方负责)',
      )
    }
    return config.project
  }
  const name = config.project ?? 'Space'
  const initialState = config.state?.initialState
  return getProject(
    name,
    initialState === undefined ? {} : {state: initialState},
  )
}

/** sceneProps 同步解析(hook 首帧就要返回;getProject 渲染期调用安全,App 既有先例) */
export function resolveSceneProps(
  config: CameraStudioConfig,
): CameraSceneProps {
  return {
    project: resolveProject(config),
    onFlows: config.flows?.onFlows,
    onError: config.onError,
  }
}

/** 参与漂移比对的顶层配置键(flows 回调引用每次渲染都新,不比) */
const DRIFT_KEYS = [
  'project',
  'storage',
  'state',
  'sync',
  'ui',
  'assets',
  'agent',
] as const

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  ) {
    return false
  }
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    Object.is(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  )
}

/** 本次 config 与首 boot config 的差异键(浅比较;无差异返回空数组) */
function diffConfigKeys(
  booted: CameraStudioConfig,
  incoming: CameraStudioConfig,
): string[] {
  return DRIFT_KEYS.filter((k) => !shallowEqual(booted[k], incoming[k]))
}

/**
 * 已 boot 且本次 config 与首 boot 不一致(hook 据此跳过占位解析,
 * 不为新 config 调 getProject 造闲置 IProject——终审 I-1(b)③)
 */
export function isBootedWithDifferentConfig(
  config: CameraStudioConfig,
): boolean {
  return (
    bootConfig !== undefined && diffConfigKeys(bootConfig, config).length > 0
  )
}

/** 首 boot 的 config;未 boot 时 undefined(hook 占位解析沿用首次配置) */
export function getBootConfig(): CameraStudioConfig | undefined {
  return bootConfig
}

/** config → theatre.init 期望 opts:键缺省就不带(不覆盖 theatre 自身缺省) */
function desiredInitOpts(config: CameraStudioConfig): InitOpts {
  const opts: InitOpts = {studio: true}
  if (config.sync) opts.serverUrl = config.sync.serverUrl
  // state 通道传了 = 宿主接管状态持久化,关掉 theatre 本地持久化
  if (config.state) opts.usePersistentStorage = false
  return opts
}

function summarizeInitOpts(opts: InitOpts | undefined) {
  return {
    studio: opts?.studio === true,
    serverUrl: opts?.serverUrl ?? undefined,
    usePersistentStorage: opts?.usePersistentStorage ?? undefined,
  }
}

function initOptsConsistent(
  host: InitOpts | undefined,
  desired: InitOpts,
): boolean {
  const a = summarizeInitOpts(host)
  const b = summarizeInitOpts(desired)
  return (
    a.studio === b.studio &&
    a.serverUrl === b.serverUrl &&
    a.usePersistentStorage === b.usePersistentStorage
  )
}

/**
 * theatre.init 冲突矩阵(spec §7):宿主未 init → 模块按 config init;
 * 已 init 且一致 → 静默复用;不一致 → 告警以先到为准,绝不悄悄重连。
 * 探测走 core 的 initState(精确拿到先到者的 opts;getStudio 探活在
 * studio 未挂载时会挂起,不可用)。
 */
async function ensureTheatreInit(config: CameraStudioConfig): Promise<void> {
  const desired = desiredInitOpts(config)
  if (initState.called) {
    const hostOpts = await initState.optsDeferred.promise
    if (!initOptsConsistent(hostOpts, desired)) {
      console.warn(
        '[camera-studio] 检测到宿主已调用 theatre.init 且配置与 ' +
          'CameraStudioConfig 不一致:以先到的初始化为准(模块不再重复 init)。' +
          `宿主:${JSON.stringify(summarizeInitOpts(hostOpts))};` +
          `模块期望:${JSON.stringify(summarizeInitOpts(desired))}。`,
      )
    }
    return
  }
  await theatre.init(desired)
}

/** storage 三分支:实例直接用 / 「namespace」或缺省 → 内置 IDB / false → 纯查看器 */
function resolveSources(config: CameraStudioConfig): {
  sources: LibrarySource[]
  /** 解析出的内置 IDB 库名;非内置 IDB 分支为 undefined */
  idbName: string | undefined
} {
  const storage = config.storage
  if (storage === false) return {sources: [], idbName: undefined}
  if (storage) {
    // 可写源实例(putEntry 等方法签名判别) vs 「namespace」简写
    const asSource = storage as LibrarySource
    if (isWritableSource(asSource)) {
      return {sources: [asSource], idbName: undefined}
    }
  }
  const namespace = (storage as {namespace?: string} | undefined)?.namespace
  const dbName = namespace
    ? `${DEFAULT_IDB_NAME}-${namespace}`
    : DEFAULT_IDB_NAME
  return {sources: [new IndexedDBBackend({dbName})], idbName: dbName}
}

async function boot(config: CameraStudioConfig): Promise<BootCtx> {
  // 0. UI 装配可配(T9:portal 容器 / z-index 基准 / 语言):boot 级一次
  // 写入,dispose 不复位——与 R14 boot 级保留语义一致,重挂幂等复用
  setUiConfig(config.ui ?? {})
  // 左上角 logo 条显隐(boot 级):经 studio.ui 公共口写 ephemeral 槽
  if (config.ui?.hideLeftStrip) {
    withStudioUi((ui) => ui.setLeftStripHidden(true))
  }

  // 1. 数据源:可写源(若有) + 内置目录,聚合进 Library 单例
  const {sources, idbName} = resolveSources(config)
  const catalog = new StaticCatalogSource({
    baseUrl: config.assets?.baseUrl,
    // 运行时缩略图渲染器:动态 import 保持模块图轻(避免 library ⇄
    // poseThumbnail 环),jest 下只有真实渲染路径才求值——与 getLibrary
    // 缺省接线同款
    renderPoseThumb: (entry): Promise<string | undefined> =>
      import('./assetLibrary/catalogThumbs').then((m) =>
        m.renderCatalogPoseThumb(catalog, entry),
      ),
    renderModelThumb: (entry): Promise<string | undefined> =>
      import('./assetLibrary/catalogThumbs').then((m) =>
        m.renderCatalogModelThumb(catalog, entry),
      ),
  })
  const writable = sources.find(isWritableSource)
  const library = configureLibrary({
    sources: writable ? [writable, catalog] : [catalog],
    writable,
    // 宿主错误提示接口:库错误转成 CameraStudioError;不传则保持库层
    // 现有语义(未配置 onError 时静默/调用方自行 console.warn)
    onError: config.onError
      ? (err) => config.onError?.(cameraErrorFromLibrary(err))
      : undefined,
  })
  const reportStartupError = (message: string, err: unknown): void => {
    if (config.onError) {
      config.onError(cameraErrorFromUnknown('library', message, err))
    } else {
      console.warn(`[camera-studio] ${message}`, err)
    }
  }
  // 旧播种条目启动清理(一次性迁移):只在缺省库名的内置 IDB 上跑——
  // 历史播种只写过缺省库,带 namespace 的库从未有种子;纯查看器无可写源
  if (idbName === DEFAULT_IDB_NAME) {
    void cleanupLegacySeeds(library).catch((err) => {
      reportStartupError('旧播种条目清理失败', err)
    })
    // 两个启动清理(T8 评审遗留)并列进缺省分支,失败不阻断 boot。
    // 时序:清扫调度在 cleanupLegacySeeds 之后——旧种子条目先被删,
    // 它们的孤儿 blob 本轮即可被收走(并发竞态下留待下次启动,无害)
    void library.sweepOrphanBlobs().catch((err) => {
      reportStartupError('孤儿 blob 清扫失败', err)
    })
    void ensureBuiltinRigAlias(library).catch((err) => {
      reportStartupError('内置骨架族别名保底失败', err)
    })
  }

  // 2. 词典显式注册(模块加载副作用已注册一次;registerMessages 合并语义,重复安全)
  registerCameraMessages()

  // 3. theatre.init 冲突矩阵
  await ensureTheatreInit(config)

  // 4. state 通道:尾部节流(缺省 1000ms),dispose 时 flush
  const throttleMs = config.state?.throttleMs ?? 1000
  let pendingContent: unknown
  let hasPending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const flushState = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    if (!hasPending) return
    hasPending = false
    const content = pendingContent
    pendingContent = undefined
    config.state?.onStateChange?.(content)
  }
  const notifyStateChange = (content: unknown): void => {
    if (!config.state?.onStateChange) return
    pendingContent = content
    hasPending = true
    // 已在等待尾部触发:只更新待发内容,不重置计时
    if (timer === undefined) timer = setTimeout(flushState, throttleMs)
  }

  // 5. project 解析(initialState 透传)与对外 sceneProps
  const sceneProps = resolveSceneProps(config)

  return {
    config,
    library,
    unregisterEditors: () => {
      unregisterCustomPropEditor('pose')
      unregisterCustomPropEditor('gestureL')
      unregisterCustomPropEditor('gestureR')
    },
    flushState,
    notifyStateChange,
    sceneProps,
    api: getCameraStudioApi(),
  }
}

/** studio.ui 显隐操作:studio 未挂载(宿主以 studio:false init 等)时静默降级 */
function withStudioUi(fn: (ui: IStudioUI) => void): void {
  Promise.resolve()
    .then(() => getStudio())
    .then(async (studio) => {
      // 必须等 studio 初始化收尾(持久化/同步状态恢复落库)再读写显隐:
      // 读早一步拿到的是恢复前快照——曾致 restore-check 漏判 hidden,
      // 上次 dispose 隐去的 UI 经同步服务播到每个后续加载且永不恢复
      await studio.initialized
      fn(studio.ui)
    })
    .catch(() => {
      /* studio 不存在时显隐无从谈起,静默 */
    })
}

/** 会话级装配(幂等:已有活跃会话时直接复用) */
function acquireSession(ctx: BootCtx): void {
  if (sessionTeardown) return
  // 姿势/手势属性编辑器注册(自 App.tsx 挪来,与库生命周期对齐)
  registerCustomPropEditor('pose', PosePropEditor)
  registerCustomPropEditor('gestureL', GesturePropEditorLeft)
  registerCustomPropEditor('gestureR', GesturePropEditorRight)
  // Agent JS API 会话(Task 15,spec §7):每次挂载新建 runtime——
  // historic 订阅随 dispose 断开,revision 从 1 重计(新会话不复用旧
  // revision,spec 8.4);激活模块级门面后,CameraScene 挂载绑定完整
  // handlers 才让 api.ready 兑现。exposeGlobal 只在显式开启时挂
  // window.__cameraStudioApi(浏览器默认不挂全局、不连桥接)
  const project = ctx.sceneProps.project
  const agentRuntime = createAgentRuntime({
    project,
    sheet: project.sheet('Scene'),
    library: ctx.library,
    getStudio: () => getStudioSync(),
    subscribeHistoric: (listener) =>
      onChange(privateAPI(project).pointers.historic, () => listener()),
  })
  activateCameraStudioApi(agentRuntime, {
    exposeGlobal: ctx.config.agent?.exposeGlobal === true,
  })
  // 桥接客户端(Task 6,spec §10.3):浏览器默认不连桥接,宿主显式配置
  // agent.bridge 才启动。在 API/runtime 激活之后启动,命令经会话自身
  // 注册表执行(与门面同一注册表,不重复注册);拆解时先关客户端
  // (停重连/退订任务/拒绝新执行)再 dispose runtime
  let bridgeClient: AgentBridgeClient | undefined
  const bridgeConfig = ctx.config.agent?.bridge
  const bridgeRegistry = bridgeConfig ? getActiveAgentRegistry() : undefined
  if (bridgeConfig && bridgeRegistry) {
    bridgeClient = createAgentBridgeClient({
      registry: bridgeRegistry,
      runtime: agentRuntime,
      config: bridgeConfig,
    })
  }
  // state 通道订阅:project 历史状态变更 → 节流转给宿主
  let unsubState: (() => void) | undefined
  if (ctx.config.state?.onStateChange) {
    const historic = privateAPI(ctx.sceneProps.project).pointers.historic
    unsubState = onChange(historic, (content: unknown) =>
      ctx.notifyStateChange(content),
    )
  }
  // 上次 dispose 隐去的 studio UI 随重挂恢复;仅在确实隐去时调 restore——
  // restore 带一次 render + 事务,首挂(本就可见)不白跑
  withStudioUi((ui) => {
    if (ui.isHidden) ui.restore()
  })

  sessionTeardown = async () => {
    sessionTeardown = undefined
    // 先关桥接客户端(停止重连、退订任务事件、拒绝新执行),再拆 API
    // 代次——顺序不可换:dispose 硬取消在途任务会发 job 事件,客户端
    // 必须先退订,否则往已关闭的连接发报文
    bridgeClient?.close()
    // 先拆 API 代次(拒绝 pending ready/挂载 waiter、硬取消在途任务、
    // 摘除 window 全局),再执行既有清理
    disposeCameraStudioApi()
    ctx.unregisterEditors()
    unsubState?.()
    // 先断订阅再 flush:尾部变更带给宿主,不丢
    ctx.flushState()
    withStudioUi((ui) => ui.hide())
  }
}

export function initCameraStudio(config: CameraStudioConfig): Promise<BootCtx> {
  if (!initPromise) {
    bootConfig = config
    const p = boot(config)
    initPromise = p
    // 启动失败允许下次重试;成功则永久保留(重挂幂等复用)
    p.catch(() => {
      if (initPromise === p) {
        initPromise = undefined
        bootConfig = undefined
      }
    })
  } else if (bootConfig && !warnedConfigDrift) {
    // 重挂换配置(R14 boot 级资源按首 boot 复用,不一致也不热更):
    // 告警一次并点名差异键,提示整页刷新——不静默沿用(终审 I-1(b))
    const drifted = diffConfigKeys(bootConfig, config)
    if (drifted.length > 0) {
      warnedConfigDrift = true
      console.warn(
        `[camera-studio] config 与首次 boot 不一致(${drifted.join(', ')}),` +
          '沿用首次配置;换配置需整页刷新(React 重挂不生效)',
      )
    }
  }
  return initPromise.then((ctx) => {
    acquireSession(ctx)
    return ctx
  })
}

export async function disposeCameraStudio(ctx?: BootCtx): Promise<void> {
  // ctx 仅为 API 形态对称(调用方持有 BootCtx);拆解对象由模块级会话槽持有
  void ctx
  // 末位消费者守卫:还有消费者在挂(StrictMode 双跑/并发挂载)时不拆会话
  if (activeConsumers > 0) return
  await sessionTeardown?.()
}
