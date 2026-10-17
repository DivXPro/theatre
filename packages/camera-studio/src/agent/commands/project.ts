/**
 * project 命令(2026-10-17,Task 12):project.exportState。
 *
 * query/project、undoable:none:调用 studio.createContentOfSaveFile(
 * project.address.projectId) 导出 Theatre 项目存档,返回深拷贝
 * (JSON round-trip;theatre 值层保证可序列化,同 objectResolver 约定)
 * ——调用方改返回值不得污染 studio 内部状态。存档只表示 Theatre 项目
 * 状态:不含 Library 资产条目、活动相机、PIP、placing、路径编辑态、
 * 姿势会话或导出任务(spec 9.3)。Studio 未初始化返回 API_NOT_READY,
 * 不静默成功。
 */
import type {IStudio} from '@dreamerbird/core'
import {AgentApiError} from '../errors'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {JsonSchema} from '../types'
import {requireObject} from '../validation'

/** 项目门面(Task 15 由同名命令转发实现) */
export type ProjectApi = {
  /** 导出 Theatre 项目存档(深拷贝;不含资产与会话状态) */
  exportState(): Promise<{projectId: string; content: unknown}>
}

const emptyInput: JsonSchema = {type: 'object', additionalProperties: false}

const exportStateOutput: JsonSchema = {
  type: 'object',
  properties: {
    projectId: {type: 'string'},
    content: {type: 'object', description: 'Theatre 项目存档(深拷贝)'},
  },
  required: ['projectId', 'content'],
}

function requireInitializedStudio(runtime: AgentRuntime): IStudio {
  const studio = runtime.getStudio()
  if (!studio) {
    throw new AgentApiError('API_NOT_READY', 'Studio 未初始化,无法导出项目状态')
  }
  return studio
}

export function registerProjectCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<
    Record<string, unknown>,
    {projectId: string; content: unknown}
  >({
    name: 'project.exportState',
    kind: 'query',
    stateDomain: 'project',
    undoable: 'none',
    inputSchema: emptyInput,
    outputSchema: exportStateOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'API_NOT_READY'],
    validate: (value) => {
      if (value === undefined || value === null) return {}
      return requireObject(value)
    },
    execute: async () => {
      runtime.assertActive()
      const studio = requireInitializedStudio(runtime)
      const projectId = runtime.project.address.projectId
      const content = studio.createContentOfSaveFile(projectId)
      // 深拷贝:返回值必须与 studio 持有的存档对象完全脱钩
      return {projectId, content: JSON.parse(JSON.stringify(content))}
    },
  })
}
