/**
 * exports.*(2026-10-17,Task 13):视频导出任务。
 *
 * `exports.startVideo` 从指定或当前活动相机导出镜头视频,返回任务 ID
 * (kind:job、stateDomain:session、undoable:none、cancelable:true、
 * completion:loaded;会话操作不进 Theatre undo,也不用项目 revision
 * 伪装并发保护,spec 8.5/8.6.4/9)。
 *
 * 流程:命令先做前置校验(控制器未注册 SCENE_UNAVAILABLE、cameraId
 * 类型 INVALID_ID_KIND、相机不存在 OBJECT_NOT_FOUND、无活动相机/正在
 * 导出 INVALID_STATE),再经 runtime.jobs.start 起任务;录制本身由场景
 * 导出控制器(agent/runtime/exportRuntime,CameraScene 挂载时登记)
 * 执行——与 UI 导出菜单同一流程。handle.done 是任务成功的唯一权威;
 * jobs.cancel 触发 signal → handle.abort + sink.abort,任务置 cancelled。
 *
 * 二进制契约(preflight ruling,同 assets.importModel):JS 任务结果是
 * VideoExportResult(blob/fileName/mimeType/size),Blob 绝不 JSON 序列化;
 * jobResultSchema 描述 HTTP FileDescriptor(fileId/fileName/mimeType/size),
 * Blob → fileId 的适配是桥接职责(POST 临时文件,GET /v1/files/:id 下载)。
 */
import {AgentApiError} from '../errors'
import {parseSceneObjectId} from '../objectIds'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {getSceneExportController} from '../runtime/exportRuntime'
import type {VideoExportResult} from '../runtime/exportRuntime'
import type {JsonSchema} from '../types'
import {requireObject} from '../validation'

/** 导出门面(Task 15 由同名命令转发实现) */
export type ExportsApi = {
  startVideo(args?: {cameraId?: string}): Promise<{jobId: string}>
}

const startVideoInput: JsonSchema = {
  type: 'object',
  properties: {
    cameraId: {
      type: 'string',
      description: '相机对象 ID(camera:<key>);缺省 = 当前活动相机',
    },
  },
  additionalProperties: false,
}

const jobIdOutput: JsonSchema = {
  type: 'object',
  properties: {jobId: {type: 'string'}},
  required: ['jobId'],
}

/**
 * HTTP 任务结果形状:桥接把导出 Blob 写入临时文件后下发文件描述;
 * JS 侧任务结果是 VideoExportResult(blob 不序列化)。
 */
const fileDescriptorSchema: JsonSchema = {
  type: 'object',
  description:
    'HTTP:导出文件描述(经 GET /v1/files/:id 下载);JS 结果为 VideoExportResult(blob/fileName/mimeType/size)',
  properties: {
    fileId: {type: 'string', description: '桥接临时文件 id'},
    fileName: {type: 'string'},
    mimeType: {type: 'string'},
    size: {type: 'number', description: '字节数'},
  },
  required: ['fileId', 'fileName', 'mimeType', 'size'],
}

export function registerExportCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<{cameraId?: string}, {jobId: string}>({
    name: 'exports.startVideo',
    kind: 'job',
    stateDomain: 'session',
    undoable: 'none',
    completion: 'loaded',
    cancelable: true,
    inputSchema: startVideoInput,
    outputSchema: jobIdOutput,
    jobResultSchema: fileDescriptorSchema,
    errorCodes: [
      'API_DISPOSED',
      'SCENE_UNAVAILABLE',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'CAPABILITY_UNAVAILABLE',
      'JOB_CANCELLED',
      'INTERNAL_ERROR',
    ],
    validate: (value) => {
      const args =
        value === undefined || value === null ? {} : requireObject(value)
      if (args.cameraId === undefined) return {}
      if (typeof args.cameraId !== 'string' || !args.cameraId) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          'cameraId 必须是非空字符串(camera:<key>)',
        )
      }
      return {cameraId: args.cameraId}
    },
    execute: async (args) => {
      runtime.assertActive()
      const controller = getSceneExportController()
      if (!controller) {
        throw new AgentApiError(
          'SCENE_UNAVAILABLE',
          '场景导出控制器未注册(场景尚未挂载)',
        )
      }
      // 前置校验在起任务前完成,直接拒绝命令(任务内的失败才走任务终态)
      let cameraKey: string | undefined
      if (args.cameraId !== undefined) {
        const id = parseSceneObjectId(args.cameraId)
        if (id.kind !== 'camera') {
          throw new AgentApiError(
            'INVALID_ID_KIND',
            `exports.startVideo 只接受相机对象 ID: ${args.cameraId}`,
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
      const resolvedCameraKey = cameraKey ?? controller.getActiveCameraKey()
      if (!resolvedCameraKey) {
        throw new AgentApiError(
          'INVALID_STATE',
          '没有活动相机,无法导出视频(先创建相机或指定 cameraId)',
        )
      }
      if (controller.isExporting()) {
        throw new AgentApiError(
          'INVALID_STATE',
          '已有视频导出进行中,请先等待完成或取消(jobs.cancel)',
        )
      }
      const {jobId} = runtime.jobs.start<VideoExportResult>({
        kind: 'exports.startVideo',
        cancelable: true,
        execute: async (controls) => {
          const result = await controller.startVideo({
            cameraKey: resolvedCameraKey,
            signal: controls.signal,
            onProgress: (progress) => controls.update({progress}),
          })
          if (!result) {
            // 内存收集路径必然有结果;undefined 只出现在 UI sink
            throw new AgentApiError('INTERNAL_ERROR', '导出结束但未产出文件')
          }
          // 文件已交付(Blob 在手):声明的完成阶段
          controls.update({phase: 'loaded', progress: 1})
          return result
        },
      })
      return {jobId}
    },
  })
}
