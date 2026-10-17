/**
 * history 命令(2026-10-17,Task 6):undo/redo。
 *
 * 直接调用 Studio 真实 undo()/redo();revision 取当前 historic 驱动值
 * (生产中 studio.undo() 同步改写 historic 指针、onChange 同步递增
 * revision),绝不伪造 canUndo/canRedo,也不把它们塞进结果。
 * 历史恢复的是项目状态,但 undo 本身不再产生可撤销步骤:undoable:none。
 */
import {AgentApiError} from '../errors'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {JsonSchema} from '../types'
import {requireObject} from '../validation'

/** 历史门面(Task 15 由同名命令转发实现) */
export type HistoryApi = {
  undo(): Promise<{revision: number}>
  redo(): Promise<{revision: number}>
}

const emptyInput: JsonSchema = {type: 'object', additionalProperties: false}

const revisionOutput: JsonSchema = {
  type: 'object',
  properties: {revision: {type: 'number'}},
  required: ['revision'],
}

/** 无参命令的运行时校验:允许省略参数或空对象 */
function noArgs(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  return requireObject(value)
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
  registry.register<Record<string, unknown>, {revision: number}>({
    name: 'history.undo',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'none',
    completion: 'committed',
    inputSchema: emptyInput,
    outputSchema: revisionOutput,
    errorCodes: ['API_DISPOSED', 'SCENE_UNAVAILABLE'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      requireStudio(runtime).undo()
      // 生产里 undo 的 historic 通知已同步递增 revision;返回当前值
      return {revision: runtime.revision}
    },
  })

  registry.register<Record<string, unknown>, {revision: number}>({
    name: 'history.redo',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'none',
    completion: 'committed',
    inputSchema: emptyInput,
    outputSchema: revisionOutput,
    errorCodes: ['API_DISPOSED', 'SCENE_UNAVAILABLE'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      requireStudio(runtime).redo()
      return {revision: runtime.revision}
    },
  })
}
