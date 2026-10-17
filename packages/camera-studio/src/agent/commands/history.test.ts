/**
 * history 命令(Task 6):undo/redo。
 *
 * 命令只调用 Studio 真实 undo()/redo() 并返回当前 historic 驱动的
 * revision;不伪造 canUndo/canRedo(结果只有 revision 一个字段,
 * toEqual 精确匹配兜底)。测试的 fakeStudio.undo/redo 内同步触发
 * historic 通知,模拟生产里 studio.undo() 同步改写 historic 指针、
 * onChange 同步递增 revision 的时序。
 */
import type {CommandContext} from '../types'

let projectSeq = 0

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

function setup() {
  const core =
    require('@dreamerbird/core') as typeof import('@dreamerbird/core')
  const {globals} =
    require('@dreamerbird/core/globals') as typeof import('@dreamerbird/core/globals')
  const {AgentCommandRegistry} =
    require('../registry') as typeof import('../registry')
  const {createAgentRuntime} =
    require('../runtime') as typeof import('../runtime')
  const {registerHistoryCommands} =
    require('./history') as typeof import('./history')

  const project = core.getProject(`agent-history-${++projectSeq}`, {
    state: {
      definitionVersion: globals.currentProjectStateDefinitionVersion,
      sheetsById: {},
    } as never,
  })
  const sheet = project.sheet('Scene')
  let notifyHistoric: () => void = () => {}
  // undo/redo 内同步触发 historic 通知:与生产通知时序一致
  const undoRedoStudio = {
    undo: jest.fn(() => notifyHistoric()),
    redo: jest.fn(() => notifyHistoric()),
  }
  let studioAvailable = true
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => (studioAvailable ? (undoRedoStudio as never) : undefined),
    subscribeHistoric: (listener) => {
      notifyHistoric = listener
      return () => {}
    },
  })
  const registry = new AgentCommandRegistry()
  registerHistoryCommands(registry, runtime)

  return {
    registry,
    runtime,
    undoRedoStudio,
    setStudioAvailable: (available: boolean) => {
      studioAvailable = available
    },
  }
}

describe('history.undo', () => {
  test('调用 studio.undo 并返回当前 revision', async () => {
    const {registry, undoRedoStudio} = setup()

    const result = await registry.execute('history.undo', {}, ctx())

    expect(undoRedoStudio.undo).toHaveBeenCalledTimes(1)
    expect(undoRedoStudio.redo).not.toHaveBeenCalled()
    // 通知同步递增后返回实时 revision(1 → 2),不手工加一也不伪造
    expect(result).toEqual({revision: 2})
  })
})

describe('history.redo', () => {
  test('调用 studio.redo 并返回当前 revision', async () => {
    const {registry, undoRedoStudio} = setup()

    const result = await registry.execute('history.redo', {}, ctx())

    expect(undoRedoStudio.redo).toHaveBeenCalledTimes(1)
    expect(undoRedoStudio.undo).not.toHaveBeenCalled()
    expect(result).toEqual({revision: 2})
  })
})

describe('history 可用性', () => {
  test('结果不携带 canUndo/canRedo', async () => {
    const {registry} = setup()

    const undoResult = await registry.execute('history.undo', {}, ctx())
    const redoResult = await registry.execute('history.redo', {}, ctx())

    expect(Object.keys(undoResult as object)).toEqual(['revision'])
    expect(Object.keys(redoResult as object)).toEqual(['revision'])
  })

  test('Studio 不可用返回 SCENE_UNAVAILABLE', async () => {
    const {registry, setStudioAvailable} = setup()
    setStudioAvailable(false)

    await expect(
      registry.execute('history.undo', {}, ctx()),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
    await expect(
      registry.execute('history.redo', {}, ctx()),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })

  test('dispose 后命令拒绝 API_DISPOSED', async () => {
    const {registry, runtime} = setup()
    runtime.dispose()

    await expect(
      registry.execute('history.undo', {}, ctx()),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
  })

  test('命令注册且元数据为项目命令', () => {
    const {registry} = setup()

    for (const name of ['history.undo', 'history.redo']) {
      expect(registry.has(name)).toBe(true)
      const described = registry
        .describe()
        .commands.find((c) => c.name === name)
      expect(described).toMatchObject({
        kind: 'mutation',
        stateDomain: 'project',
        undoable: 'none',
        completion: 'committed',
      })
    }
  })
})
