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
 *   自管(App 组件 :2175/:2177),这里不碰。
 */
import theatre, {getProject, getStudio, onChange} from '@dreamerbird/core'
import type {IProject, IStudioUI, InitOpts} from '@dreamerbird/core'
import {initState} from '@dreamerbird/core/initState'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import {
  registerCustomPropEditor,
  unregisterCustomPropEditor,
} from '@dreamerbird/studio/propEditors/customPropEditors'
import type {CameraSceneProps, CameraStudioConfig} from './config'
import {registerCameraMessages} from './i18n'
import {configureLibrary} from './assetLibrary/library'
import type {Library} from './assetLibrary/library'
import {IndexedDBBackend} from './assetLibrary/indexedDBBackend'
import {StaticCatalogSource} from './assetLibrary/staticCatalogSource'
import {isWritableSource} from './assetLibrary/source'
import type {LibrarySource} from './assetLibrary/source'
import {cleanupLegacySeeds} from './assetLibrary/legacySeedCleanup'
import PosePropEditor from './poseMode/PosePropEditor'
import {
  GesturePropEditorLeft,
  GesturePropEditorRight,
} from './gesturePropsEditor'

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
}

let initPromise: Promise<BootCtx> | undefined
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
  return {project: resolveProject(config), onFlows: config.flows?.onFlows}
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
  })
  // 旧播种条目启动清理(一次性迁移):只在缺省库名的内置 IDB 上跑——
  // 历史播种只写过缺省库,带 namespace 的库从未有种子;纯查看器无可写源
  if (idbName === DEFAULT_IDB_NAME) {
    void cleanupLegacySeeds(library).catch((err) => {
      console.warn('[camera-studio] 旧播种条目清理失败', err)
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
  }
}

/** studio.ui 显隐操作:studio 未挂载(宿主以 studio:false init 等)时静默降级 */
function withStudioUi(fn: (ui: IStudioUI) => void): void {
  Promise.resolve()
    .then(() => getStudio())
    .then((studio) => fn(studio.ui))
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
    ctx.unregisterEditors()
    unsubState?.()
    // 先断订阅再 flush:尾部变更带给宿主,不丢
    ctx.flushState()
    withStudioUi((ui) => ui.hide())
  }
}

export function initCameraStudio(config: CameraStudioConfig): Promise<BootCtx> {
  if (!initPromise) {
    const p = boot(config)
    initPromise = p
    // 启动失败允许下次重试;成功则永久保留(重挂幂等复用)
    p.catch(() => {
      if (initPromise === p) initPromise = undefined
    })
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
