/**
 * 场景视频导出运行时(2026-10-17,Task 13):CameraScene 导出流程的共享
 * 核心——活动相机校验、ShotView 切换与恢复、canvas 获取、录制
 * (startShotExport)和异常恢复,从 CameraScene 抽出,UI 导出菜单与
 * Agent exports.startVideo 共用(保留既有 UI 行为:开录时机仍是
 * ShotView 生效后的场景副作用,经 notifySceneReady 回调)。
 *
 * CameraScene 挂载时 createSceneExportController 建控制器并
 * registerSceneExportController 登记(模块级表单页单场景,同
 * directorView/animationStatus 模式);Agent 命令经
 * getSceneExportController 取用,未登记 = 场景未挂载(SCENE_UNAVAILABLE)。
 *
 * 关键不变量:
 *  - handle.done 是导出终态的唯一权威;拿到 startShotExport 句柄 ≠ 成功;
 *  - 取消 = handle.abort + sink.abort(sink.abort 幂等,exporter 收尾也会调);
 *  - 场景 dispose:先 abort 在录任务,再恢复视图,最后拒绝未完成 Promise;
 *  - JS 结果是 VideoExportResult(含 Blob);Blob 绝不 JSON 序列化,HTTP
 *    侧由桥接适配为 fileId(jobResultSchema 描述 FileDescriptor)。
 */
import type {ISheet} from '@dreamerbird/core'
import {onChange, val} from '@dreamerbird/core'
import {AgentApiError} from '../errors'
import {BlobCollectSink} from '../../videoExport/BlobCollectSink'
import {startShotExport} from '../../videoExport/exporter'
import type {ShotExportHandle} from '../../videoExport/exporter'
import type {ExportSink} from '../../videoExport/sinks'

/**
 * Agent 侧导出结果(JS API)。HTTP 桥接把 blob 写入临时文件后改发
 * FileDescriptor(fileId/fileName/mimeType/size);blob 本身不进 JSON。
 */
export type VideoExportResult = {
  blob: Blob
  fileName: string
  mimeType: string
  size: number
}

/** UI/Agent 共用的导出请求;UI 只传用户所选 sink 与 onError 提示通道 */
export type ShotExportRequest = {
  /** 导出目标;缺省 = BlobCollectSink(Agent 路径:内存收集,不触发下载) */
  sink?: ExportSink
  /** 指定相机 key;缺省 = 当前活动相机(不存在则先激活再切视角) */
  cameraKey?: string
  /** 取消信号(jobs.cancel 触发);abort = handle.abort + sink.abort */
  signal?: AbortSignal
  /** 进度回调 0..1(随 sequence 播放头) */
  onProgress?: (progress: number) => void
  /**
   * 出错提示通道:UI 传(对齐既有 onError 行为,录制失败由它提示);
   * Agent 不传——失败走 Promise 拒绝,不双通道重复报告。
   */
  onError?: (message: string) => void
}

/**
 * 场景导出控制器。startVideo 返回的 Promise 以录制终态为准:
 * 正常完成 resolve(UI sink / 用户取消系统对话框时为 undefined,内存
 * 收集时为 VideoExportResult);失败/取消/dispose reject。
 */
export type SceneExportController = {
  /** 正在导出(含挂起等待视角生效的请求与 UI 发起的导出) */
  isExporting(): boolean
  getActiveCameraKey(): string | null
  hasCamera(cameraKey: string): boolean
  startVideo(request: ShotExportRequest): Promise<VideoExportResult | undefined>
  /**
   * 场景副作用在 ShotView/活动相机切换生效后调用(对齐既有
   * "切到镜头视角再开录"的时序);无挂起请求时静默 no-op。
   */
  notifySceneReady(): void
  /** 场景卸载:先 abort 在录任务,再恢复视图,最后拒绝未完成任务 */
  dispose(): void
}

let controller: SceneExportController | undefined

/**
 * CameraScene 挂载 effect 调用;返回解绑函数(仅当登记的还是同一
 * 控制器才删,防过期 cleanup 抹掉新代次的登记,同 registerDirectorView)。
 */
export function registerSceneExportController(
  next: SceneExportController,
): () => void {
  controller = next
  return () => {
    if (controller === next) controller = undefined
  }
}

/** 当前登记的场景导出控制器;未挂载为 undefined(命令映射 SCENE_UNAVAILABLE) */
export function getSceneExportController(): SceneExportController | undefined {
  return controller
}

/** 内存收集 sink 的结构判定:有 blob() 即可交付 VideoExportResult */
type CollectingSink = ExportSink & {
  blob(): Blob
  readonly fileName: string | undefined
  readonly mimeType: string | undefined
}

function isCollectingSink(sink: ExportSink): sink is CollectingSink {
  return typeof (sink as Partial<CollectingSink>).blob === 'function'
}

/**
 * 录制核心:canvas + sink + sheet → startShotExport,外挂进度订阅
 * (sequence 播放头 → 0..1)与 signal 取消;done 映射为导出结果。
 * 返回 undefined = 编码器不可用(MediaRecorder 无可用格式)。
 */
function recordShot(args: {
  sheet: ISheet
  canvas: HTMLCanvasElement
  sink: ExportSink
  signal?: AbortSignal
  onProgress?: (progress: number) => void
  onError?: (message: string) => void
}):
  | {handle: ShotExportHandle; done: Promise<VideoExportResult | undefined>}
  | undefined {
  const {sheet, canvas, sink, signal, onProgress, onError} = args
  const handle = startShotExport({canvas, sheet, sink, onError})
  if (!handle) return undefined

  // 进度随序列播放头更新:录制 = 序列从头播到尾,position/length 即进度
  const sequence = sheet.sequence
  const length = val(sequence.pointer.length)
  const offProgress = onChange(sequence.pointer.position, (position) => {
    onProgress?.(length > 0 ? Math.min(1, Math.max(0, position / length)) : 0)
  })

  const onAbort = () => {
    handle.abort()
    // exporter 的 abort 收尾也会调 sink.abort;这里显式再调(幂等),
    // 保证取消语义不依赖 exporter 内部顺序
    sink.abort().catch(() => {})
  }
  if (signal?.aborted) {
    onAbort()
  } else {
    signal?.addEventListener('abort', onAbort, {once: true})
  }

  const done = (async (): Promise<VideoExportResult | undefined> => {
    try {
      // handle.done 是唯一权威:resolve = 录制收尾完成(含 abort 的安静收尾)
      await handle.done
    } finally {
      offProgress()
      signal?.removeEventListener('abort', onAbort)
    }
    if (signal?.aborted) {
      throw new AgentApiError('JOB_CANCELLED', '视频导出已取消')
    }
    if (isCollectingSink(sink)) {
      const blob = sink.blob()
      return {
        blob,
        fileName: sink.fileName ?? 'video.webm',
        mimeType: blob.type || sink.mimeType || '',
        size: blob.size,
      }
    }
    // UI sink(另存为/直接下载):结果落浏览器,无内存产出
    return undefined
  })()
  return {handle, done}
}

/** CameraScene 提供给控制器的会话态读写(getter 须经 ref 读最新值) */
export type SceneExportDeps = {
  sheet: ISheet
  getActiveCameraKey(): string | null
  hasCamera(cameraKey: string): boolean
  /** 激活指定相机(转发 setActiveCameraKey 会话态) */
  setActiveCamera(cameraKey: string): void
  isExporting(): boolean
  getShotView(): boolean
  /** 请求切换镜头视角;生效时机由场景副作用经 notifySceneReady 回调 */
  setShotView(on: boolean): void
  /** 页面上只有一个 canvas(快照编辑器的在 shadow DOM 里,查不到) */
  getCanvas(): HTMLCanvasElement | null
  setExporting(on: boolean): void
  /** 同步在录句柄给场景(Esc 取消/相机删除中止/停止按钮共用) */
  setActiveHandle(handle: ShotExportHandle | null): void
  /** 锁定开录时的相机:中途被删(本地/对端)由场景中止录制 */
  lockExportCamera(cameraKey: string | null): void
}

export function createSceneExportController(
  deps: SceneExportDeps,
): SceneExportController {
  type Pending = {
    request: ShotExportRequest & {sink: ExportSink}
    cameraKey: string
    prevShotView: boolean
    resolve: (result: VideoExportResult | undefined) => void
    reject: (error: unknown) => void
  }
  type Active = {
    handle: ShotExportHandle
    sink: ExportSink
    prevShotView: boolean
    reject: (error: unknown) => void
  }
  let disposed = false
  let pending: Pending | undefined
  let active: Active | undefined

  /** 视角/相机已生效:取 canvas 开录;失败恢复视图并拒绝 */
  function startPending(p: Pending): void {
    const canvas = deps.getCanvas()
    if (!canvas) {
      deps.setShotView(p.prevShotView)
      p.reject(
        new AgentApiError('INVALID_STATE', '找不到场景画布(canvas),无法导出'),
      )
      return
    }
    deps.lockExportCamera(p.cameraKey)
    const record = recordShot({
      sheet: deps.sheet,
      canvas,
      sink: p.request.sink,
      signal: p.request.signal,
      onProgress: p.request.onProgress,
      onError: p.request.onError,
    })
    if (!record) {
      // 编码器不可用:onError 已由 startShotExport 提示(UI 通道),
      // 这里拒绝 Promise(Agent 通道),两者不重复
      deps.lockExportCamera(null)
      deps.setShotView(p.prevShotView)
      p.reject(
        new AgentApiError(
          'CAPABILITY_UNAVAILABLE',
          '当前浏览器不支持视频录制(MediaRecorder 无可用格式)',
        ),
      )
      return
    }
    active = {
      handle: record.handle,
      sink: p.request.sink,
      prevShotView: p.prevShotView,
      reject: p.reject,
    }
    deps.setActiveHandle(record.handle)
    deps.setExporting(true)
    // 收尾(成功/失败/取消共用):清句柄与导出态、恢复导出前视角
    const settle = () => {
      if (active?.handle !== record.handle) return
      active = undefined
      deps.setActiveHandle(null)
      deps.setExporting(false)
      deps.setShotView(p.prevShotView)
      deps.lockExportCamera(null)
    }
    record.done.then(
      (result) => {
        settle()
        p.resolve(result)
      },
      (error) => {
        settle()
        p.reject(error)
      },
    )
  }

  return {
    isExporting: () =>
      deps.isExporting() || pending !== undefined || active !== undefined,
    getActiveCameraKey: () => deps.getActiveCameraKey(),
    hasCamera: (key) => deps.hasCamera(key),
    startVideo(request) {
      if (disposed) {
        throw new AgentApiError('API_DISPOSED', '场景已卸载,无法导出')
      }
      if (pending || active || deps.isExporting()) {
        throw new AgentApiError('INVALID_STATE', '已有视频导出进行中')
      }
      const cameraKey = request.cameraKey ?? deps.getActiveCameraKey()
      if (!cameraKey) {
        throw new AgentApiError('INVALID_STATE', '没有活动相机,无法导出视频')
      }
      if (!deps.hasCamera(cameraKey)) {
        throw new AgentApiError(
          'OBJECT_NOT_FOUND',
          `相机不存在: ${cameraKey}`,
          {details: {cameraKey}},
        )
      }
      const sink = request.sink ?? new BlobCollectSink()
      const prevShotView = deps.getShotView()
      return new Promise<VideoExportResult | undefined>((resolve, reject) => {
        const p: Pending = {
          request: {...request, sink},
          cameraKey,
          prevShotView,
          resolve,
          reject,
        }
        // 需要先切换(指定了非活动相机/不在镜头视角)就挂起,等场景副作用
        // 在切换生效后 notifySceneReady 开录——对齐既有 UI 的开录时序;
        // 无需切换则立即开录
        const switchCamera = cameraKey !== deps.getActiveCameraKey()
        const switchView = !deps.getShotView()
        if (!switchCamera && !switchView) {
          startPending(p)
          return
        }
        pending = p
        if (switchCamera) deps.setActiveCamera(cameraKey)
        if (switchView) deps.setShotView(true)
      })
    },
    notifySceneReady() {
      if (disposed || !pending) return
      const p = pending
      pending = undefined
      startPending(p)
    },
    dispose() {
      if (disposed) return
      disposed = true
      const p = pending
      pending = undefined
      const a = active
      active = undefined
      // 先 abort 在录任务(handle.abort + sink.abort)
      if (a) {
        a.handle.abort()
        a.sink.abort().catch(() => {})
        deps.setActiveHandle(null)
        deps.setExporting(false)
        deps.lockExportCamera(null)
      }
      // 再恢复视图
      const prevShotView = p?.prevShotView ?? a?.prevShotView
      if (prevShotView !== undefined && deps.getShotView() !== prevShotView) {
        deps.setShotView(prevShotView)
      }
      // 最后拒绝未完成任务(录制的 done 随后 settle 时 Promise 已拒绝,
      // 先到的 API_DISPOSED 胜出)
      const error = new AgentApiError('API_DISPOSED', '场景已卸载,导出终止')
      p?.reject(error)
      a?.reject(error)
    },
  }
}
