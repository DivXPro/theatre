/**
 * exports.*(Previs Capture,2026-11-14):
 *
 *  - exports.captureStill:指定相机/时间/尺寸的 PNG 白模或成片静帧;
 *  - exports.startVideo:指定相机/range/fps/尺寸的确定性 MP4。
 *
 * 两条命令都是 job/session/undoable:none/cancelable:true。命令层做
 * 同步前置校验并返回 jobId;实际渲染由 CameraScene 登记的共享导出
 * 控制器执行。Blob 仅在 JS 任务结果里,HTTP 桥接继续适配为
 * FileDescriptor。
 */
import {val} from '@dreamerbird/core'
import {AgentApiError} from '../errors'
import {parseSceneObjectId} from '../objectIds'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {getSceneExportController} from '../runtime/exportRuntime'
import type {
  StillExportResult,
  VideoExportResult,
} from '../runtime/exportRuntime'
import type {JsonSchema} from '../types'
import {
  validateStillExportArgs,
  validateVideoExportArgs,
  type StillExportArgs,
  type VideoExportArgs,
} from '../../videoExport/previsTypes'

/** Previs Capture 导出命令门面:静帧 PNG 与确定性视频 MP4 */
export type ExportsApi = {
  captureStill(args?: StillExportArgs): Promise<{jobId: string}>
  startVideo(args?: VideoExportArgs): Promise<{jobId: string}>
}

const outputSchemaPart: JsonSchema = {
  type: 'object',
  properties: {
    width: {type: 'number'},
    height: {type: 'number'},
  },
  required: ['width', 'height'],
  additionalProperties: false,
}

const renderProperties: Record<string, JsonSchema> = {
  cameraId: {
    type: 'string',
    description: '相机对象 ID(camera:<key>);缺省 = 当前活动相机',
  },
  renderMode: {
    type: 'string',
    enum: ['styled', 'clay'],
    description: 'styled 保持工程材质;clay 使用临时白模材质覆盖',
  },
  output: {...outputSchemaPart, description: '精确输出像素尺寸'},
  aspectRatio: {
    type: 'string',
    enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    description: 'output 未提供时的便捷画幅',
  },
  clayColor: {
    type: 'string',
    description: '白模颜色,缺省 #D8D8D8',
  },
  background: {
    type: 'string',
    enum: ['scene', 'neutral', 'transparent'],
    description: 'transparent 仅 captureStill 支持',
  },
}

const captureStillInput: JsonSchema = {
  type: 'object',
  properties: {
    ...renderProperties,
    timeMs: {
      type: 'number',
      description: '毫秒;缺省当前播放头,自动 clamp 到 sequence 范围',
    },
  },
  additionalProperties: false,
}

const startVideoInput: JsonSchema = {
  type: 'object',
  properties: {
    ...renderProperties,
    range: {
      type: 'object',
      properties: {
        startMs: {type: 'number'},
        endMs: {type: 'number'},
      },
      required: ['startMs', 'endMs'],
      additionalProperties: false,
    },
    fps: {type: 'number', description: '1..60,缺省 30'},
  },
  additionalProperties: false,
}

const jobIdOutput: JsonSchema = {
  type: 'object',
  properties: {jobId: {type: 'string'}},
  required: ['jobId'],
}

const fileDescriptorSchema: JsonSchema = {
  type: 'object',
  description:
    'HTTP:导出文件描述(经 GET /v1/files/:id 下载);JS 结果为 StillExportResult/VideoExportResult(blob 不序列化)',
  properties: {
    fileId: {type: 'string', description: '桥接临时文件 id'},
    fileName: {type: 'string'},
    mimeType: {type: 'string'},
    size: {type: 'number', description: '字节数'},
    width: {type: 'number'},
    height: {type: 'number'},
    renderMode: {type: 'string', enum: ['styled', 'clay']},
    timeMs: {type: 'number'},
    fps: {type: 'number'},
    durationMs: {type: 'number'},
    codec: {type: 'string'},
    encoding: {type: 'string', enum: ['webcodecs', 'mediarecorder']},
    range: {
      type: 'object',
      properties: {
        startMs: {type: 'number'},
        endMs: {type: 'number'},
      },
      required: ['startMs', 'endMs'],
    },
  },
  required: ['fileId', 'fileName', 'mimeType', 'size'],
}

const COMMON_ERROR_CODES = [
  'API_DISPOSED',
  'SCENE_UNAVAILABLE',
  'INVALID_ARGUMENT',
  'INVALID_ID_KIND',
  'OBJECT_NOT_FOUND',
  'INVALID_STATE',
  'CAPABILITY_UNAVAILABLE',
  'JOB_CANCELLED',
  'INTERNAL_ERROR',
] as const

function resolveCameraKey(
  args: {cameraId?: string},
  controller: ReturnType<typeof getSceneExportController> & {},
  commandName: string,
): string {
  let cameraKey: string | undefined
  if (args.cameraId !== undefined) {
    const id = parseSceneObjectId(args.cameraId)
    if (id.kind !== 'camera') {
      throw new AgentApiError(
        'INVALID_ID_KIND',
        `${commandName} 只接受相机对象 ID: ${args.cameraId}`,
        {details: {cameraId: args.cameraId}},
      )
    }
    if (!controller.hasCamera(id.key)) {
      throw new AgentApiError(
        'OBJECT_NOT_FOUND',
        `相机不存在: ${args.cameraId}`,
        {details: {cameraId: args.cameraId}},
      )
    }
    cameraKey = id.key
  }
  const resolved = cameraKey ?? controller.getActiveCameraKey()
  if (!resolved) {
    throw new AgentApiError(
      'INVALID_STATE',
      `没有活动相机,无法执行 ${commandName}(先创建相机或指定 cameraId)`,
    )
  }
  return resolved
}

function requireController() {
  const controller = getSceneExportController()
  if (!controller) {
    throw new AgentApiError(
      'SCENE_UNAVAILABLE',
      '场景导出控制器未注册(场景尚未挂载)',
    )
  }
  return controller
}

function assertNoRunningExport(
  controller: ReturnType<typeof requireController>,
) {
  if (controller.isExporting()) {
    throw new AgentApiError(
      'INVALID_STATE',
      '已有导出任务进行中,请先等待完成或取消(jobs.cancel)',
    )
  }
}

function assertVideoRangeWithinSequence(
  runtime: AgentRuntime,
  range: VideoExportArgs['range'],
): void {
  if (!range) return
  const lengthMs = Math.max(
    0,
    val(runtime.sheet.sequence.pointer.length) * 1000,
  )
  if (range.endMs > lengthMs + 1e-6) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      `range.endMs 超出 sequence 长度 ${lengthMs}ms`,
      {details: {range, sequenceLengthMs: lengthMs}},
    )
  }
}

export function registerExportCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<StillExportArgs, {jobId: string}>({
    name: 'exports.captureStill',
    kind: 'job',
    stateDomain: 'session',
    undoable: 'none',
    completion: 'loaded',
    cancelable: true,
    inputSchema: captureStillInput,
    outputSchema: jobIdOutput,
    jobResultSchema: fileDescriptorSchema,
    errorCodes: COMMON_ERROR_CODES,
    validate: validateStillExportArgs,
    execute: async (args) => {
      runtime.assertActive()
      const controller = requireController()
      const cameraKey = resolveCameraKey(
        args,
        controller,
        'exports.captureStill',
      )
      assertNoRunningExport(controller)
      const {jobId} = runtime.jobs.start<StillExportResult>({
        kind: 'exports.captureStill',
        cancelable: true,
        execute: async (controls) => {
          const result = await controller.captureStill({
            ...args,
            cameraKey,
            signal: controls.signal,
            onProgress: (progress) => controls.update({progress}),
          })
          controls.update({phase: 'loaded', progress: 1})
          return result
        },
      })
      return {jobId}
    },
  })

  registry.register<VideoExportArgs, {jobId: string}>({
    name: 'exports.startVideo',
    kind: 'job',
    stateDomain: 'session',
    undoable: 'none',
    completion: 'loaded',
    cancelable: true,
    inputSchema: startVideoInput,
    outputSchema: jobIdOutput,
    jobResultSchema: fileDescriptorSchema,
    errorCodes: COMMON_ERROR_CODES,
    validate: validateVideoExportArgs,
    execute: async (args) => {
      runtime.assertActive()
      const controller = requireController()
      const cameraKey = resolveCameraKey(args, controller, 'exports.startVideo')
      assertNoRunningExport(controller)
      assertVideoRangeWithinSequence(runtime, args.range)
      const {jobId} = runtime.jobs.start<VideoExportResult>({
        kind: 'exports.startVideo',
        cancelable: true,
        execute: async (controls) => {
          const result = await controller.startVideo({
            ...args,
            cameraKey,
            signal: controls.signal,
            onProgress: (progress) => controls.update({progress}),
            onFallback: (message) =>
              console.warn(`[exports.startVideo] ${message}`),
          })
          if (!result) {
            throw new AgentApiError('INTERNAL_ERROR', '视频导出未产出文件')
          }
          controls.update({phase: 'loaded', progress: 1})
          return result
        },
      })
      return {jobId}
    },
  })
}
