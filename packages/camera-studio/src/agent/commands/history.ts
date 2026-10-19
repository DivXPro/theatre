/**
 * history 命令(2026-10-17,Task 6):undo/redo。
 *
 * 直接调用 Studio 真实 undo()/redo();revision 等一个 core tick 再读
 * (F2 修复:historic 指针通知经 prism.onChange 排到 ticker 下一 tick,
 * undo/redo 后同步读拿到的是操作前的值),绝不伪造 canUndo/canRedo,
 * 也不把它们塞进结果。
 * 历史恢复的是项目状态,但 undo 本身不再产生可撤销步骤:undoable:none。
 * 写命令的 expectedRevision 乐观并发对 undo/redo 一致生效:revision 匹配
 * 检查先于 Studio 调用,冲突时不产生任何副作用。
 */
import {AgentApiError} from '../errors'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {JsonSchema} from '../types'
import {requireFiniteNumber, requireObject} from '../validation'

/** 历史门面(Task 15 由同名命令转发实现) */
export type HistoryApi = {
  undo(args?: {expectedRevision?: number}): Promise<{revision: number}>
  redo(args?: {expectedRevision?: number}): Promise<{revision: number}>
}

type HistoryArgs = {expectedRevision?: number}

const historyInput: JsonSchema = {
  type: 'object',
  properties: {
    expectedRevision: {
      type: 'number',
      description: '乐观并发:读取场景时的 revision',
    },
  },
  additionalProperties: false,
}

const revisionOutput: JsonSchema = {
  type: 'object',
  properties: {revision: {type: 'number'}},
  required: ['revision'],
}

/** 无参/可选 expectedRevision 命令的运行时校验:允许省略参数或空对象 */
function validateHistoryArgs(value: unknown): HistoryArgs {
  const args = value === undefined || value === null ? {} : requireObject(value)
  let expectedRevision: number | undefined
  if (args.expectedRevision !== undefined) {
    expectedRevision = requireFiniteNumber(
      args.expectedRevision,
      'expectedRevision',
    )
  }
  return {expectedRevision}
}

function requireStudio(runtime: AgentRuntime) {
  const studio = runtime.getStudio()
  if (!studio) {
    throw new AgentApiError('SCENE_UNAVAILABLE', 'Studio 不可用')
  }
  return studio
}

export function registerHistoryCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<HistoryArgs, {revision: number}>({
    name: 'history.undo',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'none',
    completion: 'committed',
    inputSchema: historyInput,
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: validateHistoryArgs,
    execute: async (args) => {
      runtime.assertActive()
      // 乐观并发先于 Studio 调用;冲突时不产生任何副作用
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      requireStudio(runtime).undo()
      // historic 通知 tick 调度:等一个 tick,返回 undo 后的真实 revision
      return {revision: await runtime.nextRevision()}
    },
  })

  registry.register<HistoryArgs, {revision: number}>({
    name: 'history.redo',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'none',
    completion: 'committed',
    inputSchema: historyInput,
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: validateHistoryArgs,
    execute: async (args) => {
      runtime.assertActive()
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      requireStudio(runtime).redo()
      return {revision: await runtime.nextRevision()}
    },
  })
}
