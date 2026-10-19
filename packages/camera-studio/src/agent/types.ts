/**
 * Agent 命令通用契约(2026-10-17):命令元数据、JSON Schema 子集、
 * 任务快照和带类型 ID。纯类型模块,无运行时依赖,后续注册表、
 * 运行时和领域命令都建立在这些契约上(见 spec 第 8 节)。
 */

/** 三维向量 DTO(JS 与 HTTP 共用同一形状) */
export type Vec3 = {x: number; y: number; z: number}

/** 场景对象稳定 ID 的类型部分(spec 8.4) */
export type SceneObjectKind = 'model' | 'camera' | 'anchor' | 'path'

/** 带类型场景对象 ID,如 `model:Y Bot` */
export type SceneObjectId = `${SceneObjectKind}:${string}`

export type JobState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/** 写命令/任务声明的完成阶段(spec 8.7) */
export type CompletionPhase = 'committed' | 'mounted' | 'loaded'

/** 结构化错误 DTO(任务快照与资源加载状态共用;HTTP 桥接原样透传) */
export type AgentErrorDto = {
  code: string
  message: string
  retryable: boolean
  details?: unknown
}

/**
 * JSON Schema 子集:只覆盖命令参数/结果声明需要的结构,
 * 桥接层原样透传给 Agent 做客户端校验。
 */
export type JsonSchema = {
  type?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: readonly (string | number | boolean | null)[]
  additionalProperties?: boolean | JsonSchema
}

/** 任务句柄快照(spec 8.7);`accepted` 不等于最终成功 */
export type JobSnapshot<T = unknown> = {
  jobId: string
  kind: string
  state: JobState
  progress: number
  phase: 'accepted' | CompletionPhase
  result?: T
  error?: AgentErrorDto
  cancelable: boolean
}

/** 每次命令调用携带的执行上下文 */
export type CommandContext = {
  requestId: string
  signal: AbortSignal
}

/** 命令定义:元数据 + 运行时校验 + 执行体(spec 8.1) */
export type CommandDefinition<A, R> = {
  name: string
  kind: 'query' | 'mutation' | 'job'
  stateDomain: 'project' | 'asset' | 'session' | 'transport'
  undoable: 'single-step' | 'none'
  completion?: CompletionPhase
  cancelable?: boolean
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  jobResultSchema?: JsonSchema
  errorCodes: readonly string[]
  validate: (value: unknown) => A
  execute: (args: A, context: CommandContext) => Promise<R>
}
