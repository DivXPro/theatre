/**
 * jobs.get / jobs.cancel(2026-10-17,Task 8):长任务查询与取消,
 * 本任务的 assets.importModel 与后续视频导出(exports.startVideo)共用。
 *
 * 任务状态是会话域(stateDomain:session):不属于项目 undo,也不接受
 * expectedRevision(spec 8.5)。get 透传 job manager 的冻结快照;
 * cancel 先取消再返回取消后的快照(manager 抛 JOB_NOT_FOUND /
 * JOB_NOT_CANCELABLE / INVALID_STATE 原样上抛)。
 */
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {JobSnapshot, JsonSchema} from '../types'
import {requireObject, requireString} from '../validation'

/** 任务门面(Task 15 由同名命令转发实现) */
export type JobsApi = {
  get(args: {jobId: string}): Promise<JobSnapshot>
  cancel(args: {jobId: string}): Promise<JobSnapshot>
}

const jobIdInput: JsonSchema = {
  type: 'object',
  properties: {
    jobId: {type: 'string', description: '任务 id(任务命令的返回值)'},
  },
  required: ['jobId'],
  additionalProperties: false,
}

const jobSnapshotSchema: JsonSchema = {
  type: 'object',
  properties: {
    jobId: {type: 'string'},
    kind: {type: 'string'},
    state: {enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled']},
    progress: {type: 'number', description: '0..1'},
    phase: {enum: ['accepted', 'committed', 'mounted', 'loaded']},
    result: {description: '成功时的任务输出(形状见各命令 jobResultSchema)'},
    error: {
      type: 'object',
      description: '失败时的结构化错误{code,message,retryable,details?}',
    },
    cancelable: {type: 'boolean'},
  },
  required: ['jobId', 'kind', 'state', 'progress', 'phase', 'cancelable'],
}

function validateJobId(value: unknown): {jobId: string} {
  return {jobId: requireString(requireObject(value), 'jobId')}
}

export function registerJobCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<{jobId: string}, JobSnapshot>({
    name: 'jobs.get',
    kind: 'query',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: jobIdInput,
    outputSchema: jobSnapshotSchema,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'JOB_NOT_FOUND'],
    validate: validateJobId,
    execute: async (args) => {
      runtime.assertActive()
      return runtime.jobs.get(args.jobId)
    },
  })

  registry.register<{jobId: string}, JobSnapshot>({
    name: 'jobs.cancel',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: jobIdInput,
    outputSchema: jobSnapshotSchema,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'JOB_NOT_FOUND',
      'JOB_NOT_CANCELABLE',
      'INVALID_STATE',
    ],
    validate: validateJobId,
    execute: async (args) => {
      runtime.assertActive()
      runtime.jobs.cancel(args.jobId)
      return runtime.jobs.get(args.jobId)
    },
  })
}
