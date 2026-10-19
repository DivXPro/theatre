/**
 * Agent 命令注册表(2026-10-17):命令的登记、按名分发和自描述。
 * `describe()` 只复制元数据与 schema,供 SKILL 和 HTTP schema 使用,
 * 不携带 validate/execute 函数(spec 第 8 节)。
 */
import {AgentApiError, asAgentApiError} from './errors'
import type {CommandContext, CommandDefinition} from './types'

/** 命令的可发布元数据:`describe()` 与后续 SKILL/HTTP schema 共用 */
export type CommandDescription = {
  name: string
  kind: CommandDefinition<unknown, unknown>['kind']
  stateDomain: CommandDefinition<unknown, unknown>['stateDomain']
  undoable: CommandDefinition<unknown, unknown>['undoable']
  completion?: CommandDefinition<unknown, unknown>['completion']
  cancelable?: boolean
  inputSchema: CommandDefinition<unknown, unknown>['inputSchema']
  outputSchema: CommandDefinition<unknown, unknown>['outputSchema']
  jobResultSchema?: CommandDefinition<unknown, unknown>['jobResultSchema']
  errorCodes: readonly string[]
  /** 命令是否接受 `expectedRevision` 做乐观并发控制(spec 8.7) */
  acceptsExpectedRevision: boolean
}

/** 注册表自描述快照 */
export type RegistryDescription = {
  apiVersion: 1
  commands: CommandDescription[]
}

export class AgentCommandRegistry {
  private readonly definitions = new Map<
    string,
    CommandDefinition<unknown, unknown>
  >()

  register<A, R>(definition: CommandDefinition<A, R>): void {
    if (this.definitions.has(definition.name)) {
      throw new AgentApiError('INVALID_STATE', `命令已注册: ${definition.name}`)
    }
    this.definitions.set(
      definition.name,
      definition as CommandDefinition<unknown, unknown>,
    )
  }

  has(name: string): boolean {
    return this.definitions.has(name)
  }

  /**
   * 分发顺序固定:查命令 → validate(args) → execute → asAgentApiError 归一。
   */
  async execute(
    name: string,
    args: unknown,
    context: CommandContext,
  ): Promise<unknown> {
    const definition = this.definitions.get(name)
    if (!definition) {
      throw new AgentApiError('COMMAND_NOT_FOUND', `未知命令: ${name}`)
    }
    try {
      const validated = definition.validate(args)
      return await definition.execute(validated, context)
    } catch (error) {
      throw asAgentApiError(error)
    }
  }

  /** 返回按 name 排序的元数据快照;不含 validate/execute 函数 */
  describe(): RegistryDescription {
    const commands = [...this.definitions.values()]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(
        (definition): CommandDescription => ({
          name: definition.name,
          kind: definition.kind,
          stateDomain: definition.stateDomain,
          undoable: definition.undoable,
          completion: definition.completion,
          cancelable: definition.cancelable,
          inputSchema: definition.inputSchema,
          outputSchema: definition.outputSchema,
          jobResultSchema: definition.jobResultSchema,
          errorCodes: definition.errorCodes,
          acceptsExpectedRevision:
            definition.stateDomain === 'project' && definition.kind !== 'query',
        }),
      )
    return {apiVersion: 1, commands}
  }
}
