/**
 * 场景 Previs 导出运行时(2026-11-14)。
 *
 * CameraScene 挂载时创建控制器并登记;顶部菜单与 Agent
 * exports.captureStill / exports.startVideo 共用同一套控制器与
 * videoExport/previsExporter 核心。
 *
 * 关键不变量:
 *  - 同一场景同一时刻只允许一个导出;
 *  - handle.done 是成功/失败的唯一权威;
 *  - 取消 = signal abort + writer.abort + sink.abort;
 *  - dispose 先 abort,再同步 restoreNow(材质/灯光/背景/播放头),
 *    最后恢复 ShotView;
 *  - Blob 只在 JS 结果里;HTTP 桥接按既有逻辑适配 FileDescriptor。
 */
import type {ISheet} from '@dreamerbird/core'
import {val} from '@dreamerbird/core'
import {AgentApiError} from '../errors'
import {getExportRenderContext} from '../../videoExport/exportRenderContext'
import {
  startStillExport,
  startVideoExport,
  type PrevisExportHandle,
} from '../../videoExport/previsExporter'
import {
  resolveRenderOptions,
  type ExportRenderArgs,
  type StillExportArgs,
  type StillExportResult,
  type VideoExportArgs,
  type VideoExportResult,
} from '../../videoExport/previsTypes'
import type {ExportSink} from '../../videoExport/sinks'

export type {StillExportResult, VideoExportResult}

/** UI/Agent 共用的视频导出请求;旧字段保持兼容 */
export type ShotExportRequest = VideoExportArgs & {
  sink?: ExportSink
  /** 指定相机 key;缺省当前活动相机 */
  cameraKey?: string
  signal?: AbortSignal
  onProgress?: (progress: number) => void
  onError?: (message: string) => void
  onFallback?: (message: string) => void
}

export type StillExportRequest = StillExportArgs & {
  cameraKey?: string
  signal?: AbortSignal
  onProgress?: (progress: number) => void
  onError?: (message: string) => void
}

export type SceneExportController = {
  isExporting(): boolean
  getActiveCameraKey(): string | null
  hasCamera(cameraKey: string): boolean
  startVideo(
    request?: ShotExportRequest,
  ): Promise<VideoExportResult | undefined>
  captureStill(request?: StillExportRequest): Promise<StillExportResult>
  notifySceneReady(): void
  dispose(): void
}

let controller: SceneExportController | undefined

export function registerSceneExportController(
  next: SceneExportController,
): () => void {
  controller = next
  return () => {
    if (controller === next) controller = undefined
  }
}

export function getSceneExportController(): SceneExportController | undefined {
  return controller
}

export type SceneExportDeps = {
  sheet: ISheet
  getActiveCameraKey(): string | null
  hasCamera(cameraKey: string): boolean
  setActiveCamera(cameraKey: string): void
  isExporting(): boolean
  getShotView(): boolean
  setShotView(on: boolean): void
  setExporting(on: boolean): void
  setActiveHandle(handle: PrevisExportHandle<unknown> | null): void
  lockExportCamera(cameraKey: string | null): void
}

type PendingKind = 'still' | 'video'

type Pending = {
  kind: PendingKind
  request: ShotExportRequest | StillExportRequest
  cameraKey: string
  prevShotView: boolean
  resolve: (result: StillExportResult | VideoExportResult | undefined) => void
  reject: (error: unknown) => void
}

type Active = {
  handle: PrevisExportHandle<StillExportResult | VideoExportResult>
  prevShotView: boolean
  request: ShotExportRequest | StillExportRequest
  reject: (error: unknown) => void
}

function resolveVideoRange(
  sheet: ISheet,
  range: VideoExportArgs['range'],
): {startMs: number; endMs: number} {
  const lengthMs = Math.max(0, val(sheet.sequence.pointer.length) * 1000)
  const resolved = range ?? {startMs: 0, endMs: lengthMs}
  if (resolved.startMs < 0 || resolved.endMs <= resolved.startMs) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      'range 必须满足 0 <= startMs < endMs',
      {details: {range: resolved}},
    )
  }
  if (resolved.endMs > lengthMs + 1e-6) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      `range.endMs 超出 sequence 长度 ${lengthMs}ms`,
      {details: {range: resolved, sequenceLengthMs: lengthMs}},
    )
  }
  return {...resolved}
}

function normalizeExportError(error: unknown): AgentApiError {
  if (error instanceof AgentApiError) return error
  return new AgentApiError(
    'INTERNAL_ERROR',
    error instanceof Error ? error.message : String(error),
    {details: {cause: error instanceof Error ? error.message : String(error)}},
  )
}

export function createSceneExportController(
  deps: SceneExportDeps,
): SceneExportController {
  let disposed = false
  let pending: Pending | undefined
  let active: Active | undefined

  function resolveCamera(cameraKey: string) {
    const context = getExportRenderContext()
    if (!context) {
      throw new AgentApiError(
        'INVALID_STATE',
        '场景渲染上下文尚未挂载(renderer/scene 不可用)',
      )
    }
    const camera = context.getCamera(cameraKey)
    if (!camera) {
      throw new AgentApiError(
        'INVALID_STATE',
        `相机尚未挂载到场景: ${cameraKey}`,
        {details: {cameraKey}},
      )
    }
    return {context, camera}
  }

  function resolveOptions(args: ExportRenderArgs, cameraKey: string) {
    const {context, camera} = resolveCamera(cameraKey)
    return {
      context,
      camera,
      options: resolveRenderOptions(args, context.getCanvasSize()),
    }
  }

  function startPending(p: Pending): void {
    try {
      deps.lockExportCamera(p.cameraKey)
      const request = p.request
      if (p.kind === 'video') {
        const videoRequest = request as ShotExportRequest
        const resolved = resolveOptions(videoRequest, p.cameraKey)
        const range = resolveVideoRange(deps.sheet, videoRequest.range)
        const handle = startVideoExport({
          ...resolved,
          sequence: deps.sheet.sequence,
          range,
          fps: videoRequest.fps ?? 30,
          sink: videoRequest.sink,
          signal: videoRequest.signal,
          onProgress: videoRequest.onProgress,
          onFallback: videoRequest.onFallback,
        })
        attachActive(handle, p, videoRequest)
      } else {
        const stillRequest = request as StillExportRequest
        const resolved = resolveOptions(stillRequest, p.cameraKey)
        const handle = startStillExport({
          ...resolved,
          sequence: deps.sheet.sequence,
          timeMs: stillRequest.timeMs ?? deps.sheet.sequence.position * 1000,
          signal: stillRequest.signal,
          onProgress: stillRequest.onProgress,
        })
        attachActive(handle, p, stillRequest)
      }
    } catch (error) {
      deps.lockExportCamera(null)
      deps.setShotView(p.prevShotView)
      p.reject(normalizeExportError(error))
    }
  }

  function attachActive(
    handle: PrevisExportHandle<StillExportResult | VideoExportResult>,
    p: Pending,
    request: ShotExportRequest | StillExportRequest,
  ): void {
    active = {
      handle,
      prevShotView: p.prevShotView,
      request,
      reject: p.reject,
    }
    deps.setActiveHandle(handle)
    deps.setExporting(true)

    const settle = () => {
      if (active?.handle !== handle) return
      active = undefined
      deps.setActiveHandle(null)
      deps.setExporting(false)
      deps.setShotView(p.prevShotView)
      deps.lockExportCamera(null)
    }
    handle.done.then(
      (result) => {
        settle()
        p.resolve(
          p.kind === 'video' && (request as ShotExportRequest).sink
            ? undefined
            : result,
        )
      },
      (error) => {
        settle()
        const normalized = normalizeExportError(error)
        if (
          normalized.code === 'JOB_CANCELLED' &&
          p.kind === 'video' &&
          (request as ShotExportRequest).sink &&
          !(request as ShotExportRequest).signal?.aborted
        ) {
          p.resolve(undefined)
          return
        }
        request.onError?.(normalized.message)
        p.reject(normalized)
      },
    )
  }

  function begin(
    kind: PendingKind,
    request: ShotExportRequest | StillExportRequest,
  ): Promise<StillExportResult | VideoExportResult | undefined> {
    if (disposed) {
      throw new AgentApiError('API_DISPOSED', '场景已卸载,无法导出')
    }
    if (pending || active || deps.isExporting()) {
      throw new AgentApiError('INVALID_STATE', '已有导出任务进行中')
    }
    const cameraKey = request.cameraKey ?? deps.getActiveCameraKey()
    if (!cameraKey) {
      throw new AgentApiError(
        'INVALID_STATE',
        kind === 'still'
          ? '没有活动相机,无法捕获静帧(先创建相机或指定 cameraId)'
          : '没有活动相机,无法导出视频(先创建相机或指定 cameraId)',
      )
    }
    if (!deps.hasCamera(cameraKey)) {
      throw new AgentApiError('OBJECT_NOT_FOUND', `相机不存在: ${cameraKey}`, {
        details: {cameraKey},
      })
    }
    const prevShotView = deps.getShotView()
    return new Promise<StillExportResult | VideoExportResult | undefined>(
      (resolve, reject) => {
        const p: Pending = {
          kind,
          request: {...request, cameraKey},
          cameraKey,
          prevShotView,
          resolve,
          reject,
        }
        const switchCamera = cameraKey !== deps.getActiveCameraKey()
        const switchView = !deps.getShotView()
        if (!switchCamera && !switchView) {
          startPending(p)
          return
        }
        pending = p
        if (switchCamera) deps.setActiveCamera(cameraKey)
        if (switchView) deps.setShotView(true)
      },
    )
  }

  return {
    isExporting: () =>
      deps.isExporting() || pending !== undefined || active !== undefined,
    getActiveCameraKey: () => deps.getActiveCameraKey(),
    hasCamera: (key) => deps.hasCamera(key),
    startVideo(request = {}) {
      return begin('video', request) as Promise<VideoExportResult | undefined>
    },
    captureStill(request = {}) {
      return begin('still', request) as Promise<StillExportResult>
    },
    notifySceneReady() {
      if (!pending) return
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

      if (a) {
        a.handle.abort()
        // 同步恢复临时材质/灯光/背景/相机/播放头,再恢复视图
        a.handle.restoreNow()
        deps.setActiveHandle(null)
        deps.setExporting(false)
        deps.lockExportCamera(null)
      }
      const prevShotView = p?.prevShotView ?? a?.prevShotView
      if (prevShotView !== undefined && deps.getShotView() !== prevShotView) {
        deps.setShotView(prevShotView)
      }
      const error = new AgentApiError('API_DISPOSED', '场景已卸载,导出终止')
      p?.reject(error)
      a?.reject(error)
    },
  }
}
