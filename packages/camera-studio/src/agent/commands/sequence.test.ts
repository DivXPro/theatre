/**
 * sequence 命令(Task 6):getState/play/pause/seek/setLength。
 *
 * 播放/定位走真实 core sequence(position 的 clamp/先 pause 都是 core
 * 语义,seek 只写 position 不额外包装);setLength 走与 TransportBar
 * 完全相同的 stateEditors 路径,经 getStudioSync 的 doMock 捕获调用。
 * play 用 spy 替换 sequence.play 返回可控 promise,验证命令确实
 * 「先等 project.ready、再调用并等待 sequence.play()」,同时避开真实
 * ticker 的时序不确定。
 *
 * jest-esbuild 不提升 jest.mock:doMock 挂模块顶层 + 晚绑定
 * activeFakeStudio(与 objects.test.ts 同先例)。
 */
import type {CommandContext} from '../types'

let projectSeq = 0

/** 晚绑定:doMock 工厂只跑一次,getStudioSync 读取当前 setup 的 studio */
let activeFakeStudio: {transaction: unknown} | undefined

jest.doMock('@dreamerbird/core', () => ({
  ...jest.requireActual('@dreamerbird/core'),
  getStudioSync: () => activeFakeStudio,
}))

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

type SetupOptions = {
  /** setLength 的 stateEditors 回调内同步触发 historic 通知(模拟生产通知时序) */
  notifyOnSetLength?: boolean
}

/** 带 Scene sheet(时长 10、30 subUnits)的初始 project state */
function projectState(definitionVersion: string) {
  return {
    definitionVersion,
    sheetsById: {
      Scene: {
        staticOverrides: {byObject: {}},
        sequence: {
          type: 'PositionalSequence',
          length: 10,
          subUnitsPerUnit: 30,
          tracksByObject: {},
        },
      },
    },
  }
}

function setup(options: SetupOptions = {}) {
  const core =
    require('@dreamerbird/core') as typeof import('@dreamerbird/core')
  const {globals} =
    require('@dreamerbird/core/globals') as typeof import('@dreamerbird/core/globals')
  const {AgentCommandRegistry} =
    require('../registry') as typeof import('../registry')
  const {createAgentRuntime} =
    require('../runtime') as typeof import('../runtime')
  const {registerSequenceCommands} =
    require('./sequence') as typeof import('./sequence')

  const setLengthCalls: unknown[] = []
  const sequenceEditor = {
    setLength: jest.fn((args: unknown) => {
      setLengthCalls.push(args)
      if (options.notifyOnSetLength) notifyHistoric()
    }),
  }
  const fakeStudio = {
    transaction: jest.fn((fn: (tools: {stateEditors: unknown}) => void) =>
      fn({
        stateEditors: {
          coreByProject: {
            historic: {sheetsById: {sequence: sequenceEditor}},
          },
        },
      }),
    ),
  }
  activeFakeStudio = fakeStudio
  cleanups.push(() => {
    activeFakeStudio = undefined
  })

  const project = core.getProject(`agent-seq-${++projectSeq}`, {
    state: projectState(globals.currentProjectStateDefinitionVersion) as never,
  })
  const sheet = project.sheet('Scene')
  let notifyHistoric: () => void = () => {}
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => fakeStudio as never,
    subscribeHistoric: (listener) => {
      notifyHistoric = listener
      return () => {}
    },
  })
  const registry = new AgentCommandRegistry()
  registerSequenceCommands(registry, runtime)

  return {
    core,
    project,
    sheet,
    registry,
    runtime,
    fakeStudio,
    sequenceEditor,
    setLengthCalls,
    notifyHistoric: () => notifyHistoric(),
  }
}

const COMMAND_NAMES = [
  'sequence.getState',
  'sequence.play',
  'sequence.pause',
  'sequence.seek',
  'sequence.setLength',
] as const

describe('sequence 命令注册', () => {
  test('五个命令全部注册', () => {
    const {registry} = setup()
    for (const name of COMMAND_NAMES) {
      expect(registry.has(name)).toBe(true)
    }
  })

  test('元数据:play/pause/seek 为 mutation/session、undoable:none;setLength 为项目单步命令', () => {
    const {registry} = setup()
    const described = new Map(
      registry.describe().commands.map((c) => [c.name, c]),
    )
    expect(described.get('sequence.getState')).toMatchObject({
      kind: 'query',
      stateDomain: 'session',
      undoable: 'none',
    })
    for (const name of ['sequence.play', 'sequence.pause', 'sequence.seek']) {
      expect(described.get(name)).toMatchObject({
        kind: 'mutation',
        stateDomain: 'session',
        undoable: 'none',
      })
    }
    expect(described.get('sequence.setLength')).toMatchObject({
      kind: 'mutation',
      stateDomain: 'project',
      undoable: 'single-step',
      completion: 'committed',
      acceptsExpectedRevision: true,
    })
  })
})

describe('sequence.getState', () => {
  test('返回 playing/position/length 快照', async () => {
    const {registry, sheet} = setup()
    sheet.sequence.position = 2.5

    const result = await registry.execute('sequence.getState', {}, ctx())

    expect(result).toEqual({playing: false, position: 2.5, length: 10})
  })
})

describe('sequence.play', () => {
  test('project.ready 完成后调用并等待 sequence.play() 的返回', async () => {
    const {registry, project, sheet} = setup()
    let readyResolved = false
    void project.ready.then(() => {
      readyResolved = true
    })
    let readyAtPlayCall = false
    let resolvePlay!: (value: boolean) => void
    const playSpy = jest
      .spyOn(sheet.sequence, 'play')
      .mockImplementation(() => {
        readyAtPlayCall = readyResolved
        return new Promise<boolean>((resolve) => {
          resolvePlay = resolve
        })
      })
    let settled = false
    const pending = registry
      .execute('sequence.play', {}, ctx())
      .then((result) => {
        settled = true
        return result
      })

    // 命令内部先 await project.ready,轮询到 sequence.play 被调用
    for (let i = 0; i < 200 && playSpy.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(playSpy).toHaveBeenCalledTimes(1)
    expect(readyAtPlayCall).toBe(true)
    // 真正等待 play 的 promise:resolve 前命令不返回
    expect(settled).toBe(false)

    resolvePlay(true)
    const result = await pending

    expect(result).toEqual({playing: false, position: 0, length: 10})
  })
})

describe('sequence.pause', () => {
  test('调用 sequence.pause', async () => {
    const {registry, sheet} = setup()
    const pauseSpy = jest.spyOn(sheet.sequence, 'pause')

    const result = await registry.execute('sequence.pause', {}, ctx())

    expect(pauseSpy).toHaveBeenCalledTimes(1)
    expect(result).toEqual({playing: false, position: 0, length: 10})
  })
})

describe('sequence.seek', () => {
  test('默认 snap:false 直接写 position,不触碰 closestGridPosition', async () => {
    const {registry, sheet} = setup()
    const snapSpy = jest.spyOn(sheet.sequence, 'closestGridPosition')

    const result = await registry.execute(
      'sequence.seek',
      {position: 1.234},
      ctx(),
    )

    expect(snapSpy).not.toHaveBeenCalled()
    expect(result).toEqual({playing: false, position: 1.234, length: 10})
  })

  test('snap:true 先 closestGridPosition 吸附再写 position', async () => {
    const {registry, sheet} = setup()
    const snapSpy = jest.spyOn(sheet.sequence, 'closestGridPosition')

    const result = (await registry.execute(
      'sequence.seek',
      {position: 0.51, snap: true},
      ctx(),
    )) as {position: number}

    expect(snapSpy).toHaveBeenCalledWith(0.51)
    // 30 subUnitsPerUnit:0.51 吸附到 0.5
    expect(result.position).toBe(0.5)
  })

  test('负数按 core clamp 语义落到 0 并返回实际 position', async () => {
    const {registry} = setup()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const result = (await registry.execute(
      'sequence.seek',
      {position: -3},
      ctx(),
    )) as {position: number}

    expect(result.position).toBe(0)
    errorSpy.mockRestore()
  })

  test('超过 length 按 core clamp 语义落到 length 并返回实际 position', async () => {
    const {registry} = setup()

    const result = (await registry.execute(
      'sequence.seek',
      {position: 99},
      ctx(),
    )) as {position: number}

    expect(result.position).toBe(10)
  })

  test('非有限 position 返回 INVALID_ARGUMENT', async () => {
    const {registry} = setup()

    for (const bad of [NaN, Infinity, -Infinity, '1.5', undefined]) {
      await expect(
        registry.execute('sequence.seek', {position: bad}, ctx()),
      ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    }
  })

  test('snap 非布尔值返回 INVALID_ARGUMENT', async () => {
    const {registry} = setup()

    await expect(
      registry.execute('sequence.seek', {position: 1, snap: 'yes'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  })
})

describe('sequence.setLength', () => {
  test('走 stateEditors 路径且只开一个事务,返回当前 revision', async () => {
    const {registry, sheet, fakeStudio, setLengthCalls, sequenceEditor} = setup(
      {notifyOnSetLength: true},
    )

    const result = await registry.execute(
      'sequence.setLength',
      {length: 12.5},
      ctx(),
    )

    expect(fakeStudio.transaction).toHaveBeenCalledTimes(1)
    expect(setLengthCalls).toEqual([{...sheet.address, length: 12.5}])
    expect(sequenceEditor.setLength).toHaveBeenCalledTimes(1)
    // historic 通知同步递增后返回实时 revision,不手工加一
    expect(result).toEqual({revision: 2})
  })

  test('length 为 0/负数/非有限数在事务前拒绝', async () => {
    const {registry, fakeStudio} = setup()

    for (const bad of [0, -1, NaN, Infinity]) {
      await expect(
        registry.execute('sequence.setLength', {length: bad}, ctx()),
      ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    }
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('expectedRevision 冲突返回 REVISION_CONFLICT 且不进入事务', async () => {
    const {registry, fakeStudio} = setup()

    await expect(
      registry.execute(
        'sequence.setLength',
        {length: 12.5, expectedRevision: 99},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('expectedRevision 匹配时正常写入', async () => {
    const {registry, fakeStudio, setLengthCalls} = setup()

    const result = await registry.execute(
      'sequence.setLength',
      {length: 12.5, expectedRevision: 1},
      ctx(),
    )

    expect(fakeStudio.transaction).toHaveBeenCalledTimes(1)
    expect(setLengthCalls).toHaveLength(1)
    expect(result).toEqual({revision: 1})
  })

  test('Studio 不可用返回 SCENE_UNAVAILABLE', async () => {
    const {registry} = setup()
    activeFakeStudio = undefined

    await expect(
      registry.execute('sequence.setLength', {length: 12.5}, ctx()),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })
})

describe('会话生命周期', () => {
  test('dispose 后命令拒绝 API_DISPOSED', async () => {
    const {registry, runtime} = setup()
    runtime.dispose()

    await expect(
      registry.execute('sequence.getState', {}, ctx()),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
    await expect(
      registry.execute('sequence.seek', {position: 1}, ctx()),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
  })
})
