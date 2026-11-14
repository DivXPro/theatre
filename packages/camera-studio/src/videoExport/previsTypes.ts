/**
 * Previs 导出共享契约(2026-11-14):参数、尺寸/时间规划与结果类型。
 *
 * 这些函数只做纯计算,不触碰 Three 场景。命令层先做同步参数校验,
 * 场景导出控制器再用同一条 resolves 路径补齐 canvas 尺寸、sequence
 * 边界与默认值,保证 Agent / UI 两个入口语义一致。
 */
import {AgentApiError} from '../agent/errors'

/** styled 保留工程材质;clay 使用导出期临时白模覆盖 */
export type ExportRenderMode = 'styled' | 'clay'
/** scene 使用工程背景;neutral 中性灰;transparent 仅静帧支持 */
export type ExportBackground = 'scene' | 'neutral' | 'transparent'
/** output 未提供时的便捷画幅 */
export type ExportAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4'

/** captureStill / startVideo 的共享渲染参数 */
export type ExportRenderArgs = {
  /** camera:<key>;缺省使用当前活动相机 */
  cameraId?: string
  /** 缺省 styled */
  renderMode?: ExportRenderMode
  /** 精确输出尺寸;与 aspectRatio 同时提供时 output 优先 */
  output?: {width: number; height: number}
  /** output 未提供时的便捷画幅 */
  aspectRatio?: ExportAspectRatio
  /** 白模颜色,缺省 #D8D8D8 */
  clayColor?: string
  /** 缺省 styled=scene、clay=neutral */
  background?: ExportBackground
}

/** exports.captureStill 参数 */
export type StillExportArgs = ExportRenderArgs & {
  /** 毫秒;缺省当前播放头,越界由导出核心 clamp */
  timeMs?: number
}

/** exports.startVideo 参数 */
export type VideoExportArgs = ExportRenderArgs & {
  /** 毫秒;缺省完整 sequence */
  range?: {startMs: number; endMs: number}
  /** 1..60,缺省 30 */
  fps?: number
}

/** 静帧导出结果(JS 侧带 Blob;HTTP 桥接投影为 FileDescriptor) */
export type StillExportResult = {
  blob: Blob
  fileName: string
  mimeType: 'image/png'
  size: number
  width: number
  height: number
  renderMode: ExportRenderMode
  timeMs: number
}

/** 视频导出结果(JS 侧带 Blob;HTTP 桥接投影为 FileDescriptor) */
export type VideoExportResult = {
  blob: Blob
  fileName: string
  mimeType: string
  size: number
  width: number
  height: number
  fps: number
  durationMs: number
  codec: string
  /** 主路径 webcodecs;mediarecorder 仅平台能力缺失时显式降级 */
  encoding: 'webcodecs' | 'mediarecorder'
  renderMode: ExportRenderMode
  range: {startMs: number; endMs: number}
}

export type ResolvedRenderOptions = {
  width: number
  height: number
  renderMode: ExportRenderMode
  clayColor: string
  background: ExportBackground
}

export const DEFAULT_CLAY_COLOR = '#D8D8D8'
export const DEFAULT_NEUTRAL_BACKGROUND = '#F2F2F2'
export const DEFAULT_VIDEO_FPS = 30
export const MAX_EXPORT_DIMENSION = 16_384

const ASPECT_RATIOS: Record<ExportAspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function invalid(message: string, details?: unknown): never {
  throw new AgentApiError('INVALID_ARGUMENT', message, {details})
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  command: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    invalid(`${command} 不接受未知参数: ${unknown.join(', ')}`, {unknown})
  }
}

function parseDimension(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(`${name} 必须是有限数字`)
  }
  const rounded = Math.round(value)
  if (rounded !== value || rounded < 1 || rounded > MAX_EXPORT_DIMENSION) {
    invalid(`${name} 必须是 1..${MAX_EXPORT_DIMENSION} 的整数`, {value})
  }
  return rounded
}

function parseRenderArgs(
  value: Record<string, unknown>,
  command: string,
): ExportRenderArgs {
  const args: ExportRenderArgs = {}
  if (value.cameraId !== undefined) {
    if (typeof value.cameraId !== 'string' || value.cameraId.length === 0) {
      invalid('cameraId 必须是非空字符串(camera:<key>)')
    }
    args.cameraId = value.cameraId
  }
  if (value.renderMode !== undefined) {
    if (value.renderMode !== 'styled' && value.renderMode !== 'clay') {
      invalid("renderMode 必须是 'styled' 或 'clay'")
    }
    args.renderMode = value.renderMode
  }
  if (value.output !== undefined) {
    if (!isRecord(value.output)) invalid('output 必须是 {width,height}')
    const output = value.output
    assertKnownKeys(output, ['width', 'height'], `${command}.output`)
    args.output = {
      width: parseDimension(output.width, 'output.width'),
      height: parseDimension(output.height, 'output.height'),
    }
  }
  if (value.aspectRatio !== undefined) {
    if (
      typeof value.aspectRatio !== 'string' ||
      !(value.aspectRatio in ASPECT_RATIOS)
    ) {
      invalid("aspectRatio 必须是 '16:9' | '9:16' | '1:1' | '4:3' | '3:4'")
    }
    args.aspectRatio = value.aspectRatio as ExportAspectRatio
  }
  if (value.clayColor !== undefined) {
    if (
      typeof value.clayColor !== 'string' ||
      !HEX_COLOR.test(value.clayColor)
    ) {
      invalid('clayColor 必须是 #RGB 或 #RRGGBB 十六进制颜色')
    }
    args.clayColor = value.clayColor
  }
  if (value.background !== undefined) {
    if (
      value.background !== 'scene' &&
      value.background !== 'neutral' &&
      value.background !== 'transparent'
    ) {
      invalid("background 必须是 'scene' | 'neutral' | 'transparent'")
    }
    args.background = value.background
  }
  return args
}

export function validateStillExportArgs(value: unknown): StillExportArgs {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) invalid('参数必须是对象')
  assertKnownKeys(
    value,
    [
      'cameraId',
      'renderMode',
      'output',
      'aspectRatio',
      'clayColor',
      'background',
      'timeMs',
    ],
    'exports.captureStill',
  )
  const args: StillExportArgs = parseRenderArgs(value, 'exports.captureStill')
  if (value.timeMs !== undefined) {
    if (typeof value.timeMs !== 'number' || !Number.isFinite(value.timeMs)) {
      invalid('timeMs 必须是有限数字')
    }
    args.timeMs = value.timeMs
  }
  return args
}

export function validateVideoExportArgs(value: unknown): VideoExportArgs {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) invalid('参数必须是对象')
  assertKnownKeys(
    value,
    [
      'cameraId',
      'renderMode',
      'output',
      'aspectRatio',
      'clayColor',
      'background',
      'range',
      'fps',
    ],
    'exports.startVideo',
  )
  const args: VideoExportArgs = parseRenderArgs(value, 'exports.startVideo')
  if (args.background === 'transparent') {
    invalid('background: transparent 仅支持 exports.captureStill')
  }
  if (value.range !== undefined) {
    if (!isRecord(value.range)) invalid('range 必须是 {startMs,endMs}')
    assertKnownKeys(
      value.range,
      ['startMs', 'endMs'],
      'exports.startVideo.range',
    )
    const {startMs, endMs} = value.range
    if (
      typeof startMs !== 'number' ||
      !Number.isFinite(startMs) ||
      typeof endMs !== 'number' ||
      !Number.isFinite(endMs)
    ) {
      invalid('range.startMs/endMs 必须是有限数字')
    }
    if (startMs < 0 || endMs <= startMs) {
      invalid('range 必须满足 0 <= startMs < endMs', {range: value.range})
    }
    args.range = {startMs, endMs}
  }
  if (value.fps !== undefined) {
    if (
      typeof value.fps !== 'number' ||
      !Number.isInteger(value.fps) ||
      value.fps < 1 ||
      value.fps > 60
    ) {
      invalid('fps 必须是 1..60 的整数')
    }
    args.fps = value.fps
  }
  return args
}

export function normalizeClayColor(color: string): string {
  if (color.length === 4) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toUpperCase()
  }
  return color.toUpperCase()
}

/** 便捷画幅按“完整装进当前 canvas”计算,不放大画布外尺寸 */
export function resolveOutputSize(
  args: Pick<ExportRenderArgs, 'output' | 'aspectRatio'>,
  canvasSize: {width: number; height: number},
): {width: number; height: number} {
  if (args.output) return {...args.output}
  const canvasWidth = Math.max(1, Math.round(canvasSize.width))
  const canvasHeight = Math.max(1, Math.round(canvasSize.height))
  if (!args.aspectRatio) return {width: canvasWidth, height: canvasHeight}

  const target = ASPECT_RATIOS[args.aspectRatio]
  const canvasAspect = canvasWidth / canvasHeight
  if (target >= canvasAspect) {
    return {
      width: canvasWidth,
      height: Math.max(1, Math.round(canvasWidth / target)),
    }
  }
  return {
    width: Math.max(1, Math.round(canvasHeight * target)),
    height: canvasHeight,
  }
}

export function resolveRenderOptions(
  args: ExportRenderArgs,
  canvasSize: {width: number; height: number},
): ResolvedRenderOptions {
  const renderMode = args.renderMode ?? 'styled'
  const background =
    args.background ?? (renderMode === 'clay' ? 'neutral' : 'scene')
  return {
    ...resolveOutputSize(args, canvasSize),
    renderMode,
    clayColor: normalizeClayColor(args.clayColor ?? DEFAULT_CLAY_COLOR),
    background,
  }
}

export type VideoFramePlan = {
  frameCount: number
  timesMs: number[]
  timestampsUs: number[]
  frameDurationUs: number
  durationMs: number
}

/**
 * 帧数 = round(durationMs / 1000 * fps),至少 1 帧。
 * 时间戳以整数微秒表示;按 i/fps 累积后四舍五入,非整除 fps 的误差
 * 不会随帧数累积。
 */
export function planVideoFrames(
  range: {startMs: number; endMs: number},
  fps: number,
): VideoFramePlan {
  if (!(range.endMs > range.startMs)) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      'range 必须满足 startMs < endMs',
    )
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) {
    throw new AgentApiError('INVALID_ARGUMENT', 'fps 必须是 1..60 的整数')
  }
  const durationMs = range.endMs - range.startMs
  const frameCount = Math.max(1, Math.round((durationMs / 1000) * fps))
  const timesMs: number[] = []
  const timestampsUs: number[] = []
  for (let i = 0; i < frameCount; i++) {
    const offsetMs = (i * 1000) / fps
    timesMs.push(Math.min(range.endMs, range.startMs + offsetMs))
    timestampsUs.push(Math.round((i * 1_000_000) / fps))
  }
  return {
    frameCount,
    timesMs,
    timestampsUs,
    frameDurationUs: Math.max(1, Math.round(1_000_000 / fps)),
    durationMs,
  }
}

export function clampStillTime(timeMs: number, lengthMs: number): number {
  const max = Math.max(0, lengthMs)
  if (!Number.isFinite(timeMs)) return 0
  return Math.min(max, Math.max(0, timeMs))
}
