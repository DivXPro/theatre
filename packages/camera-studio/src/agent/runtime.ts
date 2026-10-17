/**
 * Agent 运行时(2026-10-17,spec 第 8 节):historic revision 乐观并发、
 * 执行代次(session 内 remount 隔离)和 scene handler 绑定。
 * revision 从 1 开始,只随 historic 指针通知递增;每个执行代次持有
 * 自己的 handlers 与 readiness,会话 dispose 使全部代次失效。
 */
import type {IProject, ISheet, IStudio} from '@dreamerbird/core'
import {AgentApiError} from './errors'
import {AgentJobManager} from './jobs'
import type {Library} from '../assetLibrary/library'

/**
 * 场景运行时 handler 宿主接口:Task 3 先导出空接口,
 * 各领域任务(模型/相机/路径/姿势/导出…)通过 TypeScript
 * declaration merging 往这个接口上增加自己的 handler 签名。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AgentSceneRuntimeHandlers {}

type Handlers = Partial<AgentSceneRuntimeHandlers>

export type AgentRuntimeDeps = {
  project: IProject
  sheet: ISheet
  library: Library
  getStudio: () => IStudio | undefined
  /** 生产由 bootstrap 传入:
   * `(listener) => onChange(privateAPI(project).pointers.historic, () => listener())` */
  subscribeHistoric: (listener: () => void) => () => void
}

export type AgentRuntime = {
  readonly project: IProject
  readonly sheet: ISheet
  readonly library: Library
  readonly getStudio: () => IStudio | undefined
  readonly jobs: AgentJobManager
  /** 当前会话的 historic revision,从 1 开始 */
  readonly revision: number
  /** 本代次的 readiness:CameraScene 绑定完整 handlers 后 markReady resolve,dispose reject */
  readonly ready: Promise<void>
  /** 本代次当前绑定的 handlers(live 视图) */
  readonly handlers: Readonly<Handlers>
  /** 乐观并发:先检查活动代次,再比较 revision;冲突 details 含 expected/actual */
  assertRevision(expected: number): void
  /** 会话未被 dispose */
  assertActive(): void
  /** 会话未 dispose 且本代次未被 activate() 替换 */
  assertCurrent(): void
  /** 合并绑定 handlers,返回解绑函数;代次失效后绑定抛 API_DISPOSED,解绑静默失效 */
  bindHandlers(handlers: Handlers): () => void
  /** 创建新执行代次;旧代次的 assertCurrent/markReady 从此抛 API_DISPOSED */
  activate(): AgentRuntime
  /** 标记本代次 ready(通常由 CameraScene 绑定完整 handlers 后调用) */
  markReady(): void
  /** 会话拆解:取消 historic 订阅、失效全部代次并拒绝未 settle 的 ready */
  dispose(): void
}

/** 会话级共享状态:跨执行代次存活 */
type RuntimeCore = {
  readonly project: IProject
  readonly sheet: ISheet
  readonly library: Library
  readonly getStudio: () => IStudio | undefined
  readonly jobs: AgentJobManager
  disposed: boolean
  revision: number
  currentGeneration: Generation
  readonly generations: Set<Generation>
  unsubscribeHistoric: () => void
}

/** 单个执行代次:handlers 绑定与 readiness 的归属单元 */
type Generation = {
  readonly index: number
  superseded: boolean
  readySettled: boolean
  readonly readyPromise: Promise<void>
  resolveReady: () => void
  rejectReady: (error: unknown) => void
  handlers: Handlers
}

function makeGeneration(index: number): Generation {
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // 内部兜底:没有消费者 await 本代 ready 时,dispose 的拒绝
  // 不至于触发 unhandledRejection(Node 会直接崩掉测试进程);
  // 真正 await 的消费者仍然收到拒绝。
  readyPromise.catch(() => {})
  return {
    index,
    superseded: false,
    readySettled: false,
    readyPromise,
    resolveReady,
    rejectReady,
    handlers: {},
  }
}

function assertGenerationUsable(core: RuntimeCore, generation: Generation) {
  if (core.disposed) {
    throw new AgentApiError('API_DISPOSED', 'Camera Studio API 已销毁')
  }
  if (generation.superseded) {
    throw new AgentApiError(
      'API_DISPOSED',
      `执行代次 ${generation.index} 已被替换`,
    )
  }
}

function makeRuntime(core: RuntimeCore, generation: Generation): AgentRuntime {
  return {
    project: core.project,
    sheet: core.sheet,
    library: core.library,
    getStudio: core.getStudio,
    jobs: core.jobs,
    get revision() {
      return core.revision
    },
    get ready() {
      return generation.readyPromise
    },
    get handlers() {
      return generation.handlers
    },
    assertRevision(expected: number) {
      assertGenerationUsable(core, generation)
      if (expected !== core.revision) {
        throw new AgentApiError(
          'REVISION_CONFLICT',
          `revision 冲突: expected ${expected}, actual ${core.revision}`,
          {
            details: {
              expectedRevision: expected,
              actualRevision: core.revision,
            },
          },
        )
      }
    },
    assertActive() {
      if (core.disposed) {
        throw new AgentApiError('API_DISPOSED', 'Camera Studio API 已销毁')
      }
    },
    assertCurrent() {
      assertGenerationUsable(core, generation)
    },
    bindHandlers(handlers: Handlers) {
      // 与其余代次操作一致:代次被替换或会话销毁后拒绝绑定,
      // 避免 remount 场景"绑了却无效"的静默失败
      assertGenerationUsable(core, generation)
      const keys = Object.keys(handlers)
      generation.handlers = {...generation.handlers, ...handlers}
      return () => {
        if (generation.superseded || core.disposed) return
        const rest = {...generation.handlers}
        for (const key of keys) delete rest[key]
        generation.handlers = rest
      }
    },
    activate() {
      if (core.disposed) {
        throw new AgentApiError('API_DISPOSED', 'Camera Studio API 已销毁')
      }
      generation.superseded = true
      const next = makeGeneration(generation.index + 1)
      core.generations.add(next)
      core.currentGeneration = next
      return makeRuntime(core, next)
    },
    markReady() {
      assertGenerationUsable(core, generation)
      if (!generation.readySettled) {
        generation.readySettled = true
        generation.resolveReady()
      }
    },
    dispose() {
      if (core.disposed) return
      core.disposed = true
      core.unsubscribeHistoric()
      for (const gen of core.generations) {
        gen.superseded = true
        if (!gen.readySettled) {
          gen.readySettled = true
          gen.rejectReady(
            new AgentApiError('API_DISPOSED', 'Camera Studio API 已销毁'),
          )
        }
      }
    },
  }
}

export function createAgentRuntime(deps: AgentRuntimeDeps): AgentRuntime {
  const first = makeGeneration(1)
  const core: RuntimeCore = {
    project: deps.project,
    sheet: deps.sheet,
    library: deps.library,
    getStudio: deps.getStudio,
    jobs: new AgentJobManager(),
    disposed: false,
    revision: 1,
    currentGeneration: first,
    generations: new Set([first]),
    unsubscribeHistoric: deps.subscribeHistoric(() => {
      core.revision += 1
    }),
  }
  return makeRuntime(core, first)
}
