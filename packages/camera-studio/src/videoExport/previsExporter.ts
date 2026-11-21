/**
 * Previs Capture 导出核心(2026-11-14)。
 *
 * UI 菜单与 Agent 命令共用本模块:
 *  - still:定位 sequence 精确时间 → render target 渲染 → PNG;
 *  - video:按 fps 生成帧时间 → 逐帧定位/渲染 → WebCodecs H.264 →
 *    MP4;平台缺 WebCodecs/H.264 时才显式降级 MediaRecorder。
 *
 * 整个任务用一个幂等 restore 包住:成功、异常、jobs.cancel、场景 dispose
 * 都走同一清理路径,不写 undo、不 bump revision。
 */
import {getCoreTicker} from '@dreamerbird/core/coreTicker'
import {val} from '@dreamerbird/core'
import type {ISequence} from '@dreamerbird/core'
import type {PerspectiveCamera} from 'three'
import {AgentApiError} from '../agent/errors'
import {prepareAnimationStripExport} from '../animationStrips/exportSession'
import type {ExportSink} from './sinks'
import {setExportAnimationTime} from './exportAnimationClock'
import type {ExportRenderContext} from './exportRenderContext'
import {
  beginExportSceneState,
  encodePng,
  ExportFrameRenderer,
} from './sceneCapture'
import {
  clampStillTime,
  planVideoFrames,
  type ResolvedRenderOptions,
  type StillExportResult,
  type VideoExportResult,
} from './previsTypes'
import {MediaRecorderVideoWriter, WebCodecsH264Writer} from './videoEncoding'

export type PrevisExportHandle<T> = {
  done: Promise<T>
  abort(): void
  finishEarly(): void
  /** dispose 时同步恢复临时状态;异步任务随后会自行收尾 */
  restoreNow(): void
}

type BaseArgs = {
  context: ExportRenderContext
  sequence: ISequence
  camera: PerspectiveCamera
  options: ResolvedRenderOptions
  signal?: AbortSignal
}

export type StillExportArgs = BaseArgs & {
  timeMs: number
  onProgress?: (progress: number) => void
}

export type VideoExportArgs = BaseArgs & {
  range: {startMs: number; endMs: number}
  fps: number
  sink?: ExportSink
  onProgress?: (progress: number) => void
  onFallback?: (message: string) => void
}

function cancelled(): AgentApiError {
  return new AgentApiError('JOB_CANCELLED', '预演导出已取消')
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw cancelled()
}

function filenameStem(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')
  return `镜头-${stamp}`
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as {name?: unknown}).name === 'AbortError'
  )
}

/**
 * sequence 临时状态:保存播放头/播放态,pause 后逐帧 seek;
 * 结束时先恢复位置,再按原状态决定是否继续播放。
 */
function beginSequenceSession(sequence: ISequence): () => void {
  const prevPosition = sequence.position
  const wasPlaying = val(sequence.pointer.playing)
  sequence.pause()
  let restored = false
  return () => {
    if (restored) return
    restored = true
    sequence.pause()
    sequence.position = prevPosition
    if (wasPlaying) {
      void sequence.play().catch(() => {})
    }
  }
}

/**
 * 导出期间关闭 R3F 自动帧循环,避免编辑器帧和逐帧导出互相覆盖。
 * advance() 在 frameloop='never' 下由导出核心显式调用;恢复时重新
 * invalidate 一次,让 demand 模式立即画出恢复后的编辑视图。
 */
function beginFrameloopSession(context: ExportRenderContext): () => void {
  const prev = context.getFrameloop()
  if (prev !== 'never') context.setFrameloop('never')
  let restored = false
  return () => {
    if (restored) return
    restored = true
    if (prev !== 'never') context.setFrameloop(prev)
    context.invalidate()
  }
}

async function seekFrame(
  context: ExportRenderContext,
  sequence: ISequence,
  timeMs: number,
  advanceTimestampMs: number,
): Promise<void> {
  sequence.pause()
  sequence.position = timeMs / 1000

  // sequence.position 的求值产物经 core ticker 传播;连续两脚确保
  // onThisOrNextTick 中排队的 prism 订阅都已执行。
  getCoreTicker().tick(advanceTimestampMs)
  await Promise.resolve()
  getCoreTicker().tick(advanceTimestampMs)

  setExportAnimationTime(timeMs / 1000)
  // 手动推进 R3F:执行 CameraPath / ShotCamera / PlacementManager 的
  // useFrame,但 frameloop 已切到 never,不会和编辑器自动帧互相覆盖。
  context.advance(advanceTimestampMs)
  await Promise.resolve()
}

function makeCombinedSignal(external?: AbortSignal): {
  signal: AbortSignal
  abort: () => void
  dispose: () => void
} {
  const controller = new AbortController()
  if (!external) {
    return {
      signal: controller.signal,
      abort: () => controller.abort(),
      dispose: () => {},
    }
  }
  const abort = () => controller.abort()
  if (external.aborted) abort()
  else external.addEventListener('abort', abort, {once: true})
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    dispose: () => external.removeEventListener('abort', abort),
  }
}

export function startStillExport(
  args: StillExportArgs,
): PrevisExportHandle<StillExportResult> {
  const combined = makeCombinedSignal(args.signal)
  let restoreNow = () => {}
  let restoreSequence: (() => void) | null = null
  let restoreFrameloop: (() => void) | null = null
  let restoreScene: (() => void) | null = null
  let restoreStrips: (() => void) | null = null
  let frameRenderer: ExportFrameRenderer | null = null
  let restored = false
  restoreNow = () => {
    if (restored) return
    restored = true
    frameRenderer?.dispose()
    frameRenderer = null
    setExportAnimationTime(null)
    restoreStrips?.()
    restoreScene?.()
    restoreFrameloop?.()
    restoreSequence?.()
  }

  // jobs.cancel / 场景 dispose 触发 abort 时同步恢复场景状态;异步任务
  // 在下一次信号检查处终止,不会把部分结果交给调用方。
  const onAbort = () => restoreNow()
  combined.signal.addEventListener('abort', onAbort, {once: true})

  const done = (async (): Promise<StillExportResult> => {
    assertNotAborted(combined.signal)
    const lengthMs = Math.max(0, val(args.sequence.pointer.length) * 1000)
    const timeMs = clampStillTime(args.timeMs, lengthMs)
    try {
      const activateStrips = await prepareAnimationStripExport(
        args.sequence,
        timeMs,
        timeMs,
        combined.signal,
      )
      assertNotAborted(combined.signal)
      restoreStrips = activateStrips()
      restoreSequence = beginSequenceSession(args.sequence)
      restoreFrameloop = beginFrameloopSession(args.context)
      restoreScene = beginExportSceneState(
        args.context.renderer,
        args.context.scene,
        args.camera,
        args.options,
      )
    } catch (error) {
      restoreNow()
      combined.dispose()
      combined.signal.removeEventListener('abort', onAbort)
      throw error
    }
    try {
      frameRenderer = new ExportFrameRenderer(
        args.context.renderer,
        args.options.width,
        args.options.height,
      )
      args.onProgress?.(0)
      await seekFrame(args.context, args.sequence, timeMs, 0)
      assertNotAborted(combined.signal)
      const pixels = frameRenderer.render(args.context.scene, args.camera)
      args.onProgress?.(0.5)
      const blob = await encodePng(
        pixels,
        args.options.width,
        args.options.height,
      )
      assertNotAborted(combined.signal)
      args.onProgress?.(1)
      return {
        blob,
        fileName: `${filenameStem()}.png`,
        mimeType: 'image/png',
        size: blob.size,
        width: args.options.width,
        height: args.options.height,
        renderMode: args.options.renderMode,
        timeMs,
      }
    } finally {
      combined.dispose()
      combined.signal.removeEventListener('abort', onAbort)
      restoreNow()
    }
  })()
  void done.catch(() => {})

  return {
    done,
    abort: () => combined.abort(),
    finishEarly: () => {},
    restoreNow: () => restoreNow(),
  }
}

type AnyVideoWriter =
  | {kind: 'webcodecs'; writer: WebCodecsH264Writer}
  | {kind: 'mediarecorder'; writer: MediaRecorderVideoWriter}

export function startVideoExport(
  args: VideoExportArgs,
): PrevisExportHandle<VideoExportResult> {
  const combined = makeCombinedSignal(args.signal)
  let finishRequested = false
  let restoreNow = () => {}
  let restoreSequence: (() => void) | null = null
  let restoreFrameloop: (() => void) | null = null
  let restoreScene: (() => void) | null = null
  let restoreStrips: (() => void) | null = null
  let frameRenderer: ExportFrameRenderer | null = null
  let activeWriter: AnyVideoWriter | null = null
  let activeSink: ExportSink | undefined
  let restored = false
  restoreNow = () => {
    if (restored) return
    restored = true
    activeWriter?.writer.abort()
    activeWriter = null
    frameRenderer?.dispose()
    frameRenderer = null
    const sink = activeSink
    activeSink = undefined
    // 仅在取消/异常路径丢弃半成品;正常 finish 后 activeSink 已清空。
    void sink?.abort().catch(() => {})
    setExportAnimationTime(null)
    restoreStrips?.()
    restoreScene?.()
    restoreFrameloop?.()
    restoreSequence?.()
  }

  // 取消要立即丢弃半成品并恢复材质/灯光/背景/播放头,不能等当前
  // await(编码 flush、sink 写盘)自然返回。
  const onAbort = () => restoreNow()
  combined.signal.addEventListener('abort', onAbort, {once: true})

  const done = (async (): Promise<VideoExportResult> => {
    assertNotAborted(combined.signal)
    const plan = planVideoFrames(args.range, args.fps)

    try {
      frameRenderer = new ExportFrameRenderer(
        args.context.renderer,
        args.options.width,
        args.options.height,
      )

      const webWriter = await WebCodecsH264Writer.create({
        width: args.options.width,
        height: args.options.height,
        fps: args.fps,
      })
      if (webWriter) {
        activeWriter = {kind: 'webcodecs', writer: webWriter}
      } else {
        const message =
          'WebCodecs H.264 不可用,显式降级到 MediaRecorder(实际容器以结果 mimeType 为准)'
        console.warn(`[exports.startVideo] ${message}`)
        args.onFallback?.(message)
        const mediaWriter = await MediaRecorderVideoWriter.create({
          width: args.options.width,
          height: args.options.height,
          fps: args.fps,
        })
        if (!mediaWriter) {
          throw new AgentApiError(
            'CAPABILITY_UNAVAILABLE',
            '当前浏览器既不支持 WebCodecs H.264,也不支持 MediaRecorder 视频录制',
          )
        }
        activeWriter = {kind: 'mediarecorder', writer: mediaWriter}
      }
      assertNotAborted(combined.signal)

      const mimeType =
        activeWriter.kind === 'webcodecs'
          ? 'video/mp4'
          : activeWriter.writer.mimeType
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm'
      const fileName = `${filenameStem()}.${extension}`

      // 另存为的系统文件选择器必须在用户点击的激活窗口内弹;此时
      // 尚未切 frameloop / clay,取消选择不会冻结或污染编辑视图。
      activeSink = args.sink
      if (activeSink) {
        try {
          await activeSink.start({mimeType, suggestedName: fileName})
        } catch (error) {
          if (isAbortError(error)) throw cancelled()
          throw error
        }
      }
      assertNotAborted(combined.signal)

      const activateStrips = await prepareAnimationStripExport(
        args.sequence,
        plan.timesMs[0]!,
        plan.timesMs[plan.frameCount - 1]!,
        combined.signal,
      )
      assertNotAborted(combined.signal)
      restoreStrips = activateStrips()
      restoreSequence = beginSequenceSession(args.sequence)
      restoreFrameloop = beginFrameloopSession(args.context)
      restoreScene = beginExportSceneState(
        args.context.renderer,
        args.context.scene,
        args.camera,
        args.options,
      )

      args.onProgress?.(0)
      let encodedFrames = 0
      for (let frameIndex = 0; frameIndex < plan.frameCount; frameIndex++) {
        assertNotAborted(combined.signal)
        if (finishRequested && frameIndex > 0) break
        const timeMs = plan.timesMs[frameIndex]!
        await seekFrame(
          args.context,
          args.sequence,
          timeMs,
          frameIndex * (1000 / args.fps),
        )
        assertNotAborted(combined.signal)
        const pixels = frameRenderer.render(args.context.scene, args.camera)
        if (activeWriter.kind === 'webcodecs') {
          await activeWriter.writer.addFrame(
            pixels,
            plan.timestampsUs[frameIndex]!,
            plan.frameDurationUs,
            frameIndex % args.fps === 0,
          )
        } else {
          await activeWriter.writer.addFrame(
            pixels,
            args.options.width,
            args.options.height,
          )
        }
        encodedFrames += 1
        args.onProgress?.(encodedFrames / plan.frameCount)
      }
      assertNotAborted(combined.signal)
      if (encodedFrames === 0) {
        throw new AgentApiError('INTERNAL_ERROR', '视频导出没有产出任何帧')
      }

      const encoded = await activeWriter.writer.finish()
      activeWriter = null
      assertNotAborted(combined.signal)
      if (activeSink) {
        await activeSink.write(encoded.data)
        assertNotAborted(combined.signal)
        await activeSink.finish()
        activeSink = undefined
      }
      const blob = new Blob([encoded.data as BlobPart], {
        type: encoded.mimeType,
      })
      args.onProgress?.(1)
      return {
        blob,
        fileName,
        mimeType: encoded.mimeType,
        size: blob.size,
        width: args.options.width,
        height: args.options.height,
        fps: args.fps,
        // 用户提前停止时如实报告已编码帧的时长,而不是请求的完整 range
        durationMs: Math.round((encodedFrames * plan.frameDurationUs) / 1000),
        codec: encoded.codec,
        encoding: encoded.encoding,
        renderMode: args.options.renderMode,
        range: {...args.range},
      }
    } catch (error) {
      activeWriter?.writer.abort()
      activeWriter = null
      const sink = activeSink
      activeSink = undefined
      if (sink) await sink.abort().catch(() => {})
      throw combined.signal.aborted ? cancelled() : error
    } finally {
      combined.dispose()
      combined.signal.removeEventListener('abort', onAbort)
      restoreNow()
    }
  })()
  void done.catch(() => {})

  return {
    done,
    abort: () => {
      combined.abort()
    },
    finishEarly: () => {
      finishRequested = true
    },
    restoreNow: () => restoreNow(),
  }
}
