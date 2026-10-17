/**
 * keyframes 命令(Task 7):list/set/move/delete。
 *
 * 布景同 objects.test.ts:真实 core project/sheet/object + 预建轨初始
 * state(trackIdByPropPath 键为 encodePathToProp 结果);Studio 用假事务
 * 捕获调用顺序与参数。轨道写入经内部 Studio(`@dreamerbird/studio/getStudio`,
 * 与 TransportBar/CameraPath 同路径),jest-esbuild 不提升 jest.mock:
 * doMock 挂模块顶层 + 晚绑定 activeFakeStudio。
 *
 * 网格:subUnitsPerUnit=30,closestGridPosition(0.51)=0.5、
 * (2.01)=2、(4.01)=4。
 */
import type {ISheetObject} from '@dreamerbird/core'
import type {CommandContext} from '../types'

let projectSeq = 0

/** 晚绑定:doMock 工厂只跑一次,getStudio 读取当前 setup 的 studio */
let activeFakeStudio: {transaction: unknown} | undefined

jest.doMock('@dreamerbird/studio/getStudio', () => ({
  __esModule: true,
  default: () => activeFakeStudio,
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
  /** 预建轨:position.x 两帧(0→5、2→10),position.y 一帧(1→7) */
  tracks?: boolean
}

/** 带 Scene sheet 的初始 project state;tracks 时附 position.x/y 轨道 */
function projectState(definitionVersion: string, tracks: boolean) {
  const keyframe = (id: string, position: number, value: number) => ({
    id,
    position,
    connectedRight: true,
    handles: [0.5, 0.5, 0.5, 0.5],
    value,
  })
  return {
    definitionVersion,
    sheetsById: {
      Scene: {
        staticOverrides: {byObject: {}},
        sequence: {
          type: 'PositionalSequence',
          length: 10,
          subUnitsPerUnit: 30,
          tracksByObject: tracks
            ? {
                Foo: {
                  trackIdByPropPath: {
                    '["position","x"]': 'track-x',
                    '["position","y"]': 'track-y',
                  },
                  trackData: {
                    'track-x': {
                      type: 'BasicKeyframedTrack',
                      keyframes: {
                        byId: {
                          kf1: keyframe('kf1', 0, 5),
                          kf2: keyframe('kf2', 2, 10),
                        },
                        allIds: {kf1: true, kf2: true},
                      },
                    },
                    'track-y': {
                      type: 'BasicKeyframedTrack',
                      keyframes: {
                        byId: {kf3: keyframe('kf3', 1, 7)},
                        allIds: {kf3: true},
                      },
                    },
                  },
                },
              }
            : {},
        },
      },
    },
  }
}

function setup(options: SetupOptions = {}) {
  const {getPointerParts} =
    require('@dreamerbird/dataverse') as typeof import('@dreamerbird/dataverse')
  const core =
    require('@dreamerbird/core') as typeof import('@dreamerbird/core')
  const {globals} =
    require('@dreamerbird/core/globals') as typeof import('@dreamerbird/core/globals')
  const {AgentCommandRegistry} =
    require('../registry') as typeof import('../registry')
  const {createAgentRuntime} =
    require('../runtime') as typeof import('../runtime')
  const objectRuntime =
    require('../runtime/objectRuntime') as typeof import('../runtime/objectRuntime')
  const {registerKeyframeCommands} =
    require('./keyframes') as typeof import('./keyframes')
  const {registerObjectCommands} =
    require('./objects') as typeof import('./objects')
  const {PLACEMENTS_REGISTRY_KEY} =
    require('../../PlacementManager') as typeof import('../../PlacementManager')

  /** 事务调用记录(op 顺序 + 关键参数) */
  const calls: Array<Record<string, unknown>> = []
  const sequenceEditor = {
    setPrimitivePropAsSequenced: jest.fn((args: Record<string, unknown>) => {
      calls.push({
        op: 'sequenceProp',
        objectKey: args.objectKey,
        sheetId: args.sheetId,
        pathToProp: args.pathToProp,
      })
    }),
    transformKeyframes: jest.fn((args: Record<string, unknown>) => {
      calls.push({op: 'transformKeyframes', args})
    }),
    setPrimitivePropAsStatic: jest.fn((args: Record<string, unknown>) => {
      calls.push({op: 'unsequenceProp', args})
    }),
  }
  const fakeStudio = {
    transaction: jest.fn(
      (
        fn: (tools: {
          set: (pointer: unknown, value: unknown) => void
          unset: (pointer: unknown) => void
          stateEditors: unknown
        }) => void,
      ) =>
        fn({
          set: (pointer: unknown, value: unknown) => {
            const {path} = getPointerParts(pointer as never)
            calls.push({op: 'set', path: path.join('.'), value})
          },
          unset: (pointer: unknown) => {
            const {path} = getPointerParts(pointer as never)
            calls.push({op: 'unset', path: path.join('.')})
          },
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

  const project = core.getProject(`agent-kf-${++projectSeq}`, {
    state: projectState(
      globals.currentProjectStateDefinitionVersion,
      options.tracks === true,
    ) as never,
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
  registerKeyframeCommands(registry, runtime)

  /** 登记后的清理(模块级登记表跨用例存活,必须逐用例清) */
  function registerMounted(id: 'model:Foo', obj: ISheetObject<any>) {
    objectRuntime.registerSceneSheetObject(id, obj)
    cleanups.push(() => objectRuntime.unregisterSceneSheetObject(id, obj))
  }

  /** 布景:注册表写 'Foo' 条目并把 SheetObject 登记为 model:Foo */
  function mountFoo() {
    const t = core.types
    const registryObj = sheet.object(
      PLACEMENTS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify([{key: 'Foo', position: {x: 0, y: 0, z: 0}}]),
    }
    const obj = sheet.object('Foo', {
      position: t.compound({
        x: t.number(0),
        y: t.number(0),
        z: t.number(0),
      }),
      label: t.string('hello'),
      visible: t.boolean(true),
    })
    registerMounted('model:Foo', obj as ISheetObject<any>)
    return obj
  }

  return {
    core,
    project,
    sheet,
    registry,
    runtime,
    fakeStudio,
    calls,
    sequenceEditor,
    mountFoo,
    registerObjectCommands: () => registerObjectCommands(registry, runtime),
    PLACEMENTS_REGISTRY_KEY,
    notifyHistoric: () => notifyHistoric(),
  }
}

const COMMAND_NAMES = [
  'keyframes.list',
  'keyframes.set',
  'keyframes.move',
  'keyframes.delete',
] as const

describe('keyframes 命令注册', () => {
  test('四个命令全部注册', () => {
    const {registry} = setup()
    for (const name of COMMAND_NAMES) {
      expect(registry.has(name)).toBe(true)
    }
  })

  test('元数据:list 为 query/project;set/move/delete 为项目单步命令且接受 expectedRevision', () => {
    const {registry} = setup()
    const described = new Map(
      registry.describe().commands.map((c) => [c.name, c]),
    )
    expect(described.get('keyframes.list')).toMatchObject({
      kind: 'query',
      stateDomain: 'project',
      undoable: 'none',
      acceptsExpectedRevision: false,
    })
    for (const name of [
      'keyframes.set',
      'keyframes.move',
      'keyframes.delete',
    ]) {
      expect(described.get(name)).toMatchObject({
        kind: 'mutation',
        stateDomain: 'project',
        undoable: 'single-step',
        completion: 'committed',
        acceptsExpectedRevision: true,
      })
    }
  })
})

describe('keyframes.set', () => {
  test('未建轨 position.x:同一事务内先 sequenceProp 再 set,播放头定位到吸附后的 at', async () => {
    const {registry, sheet, fakeStudio, calls, mountFoo} = setup()
    mountFoo()

    const result = await registry.execute(
      'keyframes.set',
      {
        objectId: 'model:Foo',
        propPath: ['position', 'x'],
        at: 0.51,
        value: 7,
        snap: true,
      },
      ctx(),
    )

    expect(fakeStudio.transaction).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      {
        op: 'sequenceProp',
        objectKey: 'Foo',
        sheetId: 'Scene',
        pathToProp: ['position', 'x'],
      },
      {op: 'set', path: 'position.x', value: 7},
    ])
    // 30 subUnitsPerUnit:0.51 吸附到 0.5
    expect(sheet.sequence.position).toBe(0.5)
    expect(result).toEqual({revision: 1})
  })

  test('已建轨属性不再调用 sequenceProp,直接 set', async () => {
    const {registry, sheet, fakeStudio, calls, mountFoo} = setup({tracks: true})
    mountFoo()

    await registry.execute(
      'keyframes.set',
      {
        objectId: 'model:Foo',
        propPath: ['position', 'x'],
        at: 4.01,
        value: 9,
        snap: true,
      },
      ctx(),
    )

    expect(fakeStudio.transaction).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([{op: 'set', path: 'position.x', value: 9}])
    expect(sheet.sequence.position).toBe(4)
  })

  test('snap 默认 false:播放头按原始 at 定位,不吸附', async () => {
    const {registry, sheet, mountFoo} = setup({tracks: true})
    mountFoo()

    await registry.execute(
      'keyframes.set',
      {objectId: 'model:Foo', propPath: ['position', 'x'], at: 1.234, value: 9},
      ctx(),
    )

    expect(sheet.sequence.position).toBe(1.234)
  })

  test('值形状校验:数字叶子拒绝字符串与 NaN,事务不执行', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    for (const bad of ['7', NaN, Infinity, true]) {
      await expect(
        registry.execute(
          'keyframes.set',
          {
            objectId: 'model:Foo',
            propPath: ['position', 'x'],
            at: 1,
            value: bad,
          },
          ctx(),
        ),
      ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    }
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('propPath 必须指向简单叶子:compound 与未知路径拒绝', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    for (const propPath of [['position'], ['position', 'w'], ['nope']]) {
      await expect(
        registry.execute(
          'keyframes.set',
          {objectId: 'model:Foo', propPath, at: 1, value: 7},
          ctx(),
        ),
      ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    }
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('propPath 形状:非数组/空数组/空段拒绝', async () => {
    const {registry, mountFoo} = setup()
    mountFoo()

    for (const bad of ['position.x', [], [''], [1]]) {
      await expect(
        registry.execute(
          'keyframes.set',
          {objectId: 'model:Foo', propPath: bad, at: 1, value: 7},
          ctx(),
        ),
      ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    }
  })

  test('对象不存在/类型不符/未挂载分别返回 OBJECT_NOT_FOUND/INVALID_ID_KIND/INVALID_STATE', async () => {
    const {core, sheet, registry, mountFoo, PLACEMENTS_REGISTRY_KEY} = setup()
    mountFoo()

    await expect(
      registry.execute(
        'keyframes.set',
        {objectId: 'model:Nope', propPath: ['position', 'x'], at: 1, value: 7},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    await expect(
      registry.execute(
        'keyframes.set',
        {objectId: 'thing:Foo', propPath: ['position', 'x'], at: 1, value: 7},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})

    // 注册表有条目但运行时未挂载
    const registryObj = sheet.object(
      PLACEMENTS_REGISTRY_KEY,
      {list: core.types.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify([
        {key: 'Foo', position: {x: 0, y: 0, z: 0}},
        {key: 'Ghost', position: {x: 0, y: 0, z: 0}},
      ]),
    }
    await expect(
      registry.execute(
        'keyframes.set',
        {objectId: 'model:Ghost', propPath: ['position', 'x'], at: 1, value: 7},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })

  test('expectedRevision 冲突返回 REVISION_CONFLICT 且不进入事务', async () => {
    const {registry, fakeStudio, mountFoo, notifyHistoric} = setup()
    mountFoo()
    notifyHistoric()

    await expect(
      registry.execute(
        'keyframes.set',
        {
          objectId: 'model:Foo',
          propPath: ['position', 'x'],
          at: 1,
          value: 7,
          expectedRevision: 1,
        },
        ctx(),
      ),
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      details: {expectedRevision: 1, actualRevision: 2},
    })
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('Studio 不可用返回 SCENE_UNAVAILABLE', async () => {
    const {registry, mountFoo} = setup()
    mountFoo()
    activeFakeStudio = undefined

    await expect(
      registry.execute(
        'keyframes.set',
        {objectId: 'model:Foo', propPath: ['position', 'x'], at: 1, value: 7},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })
})

describe('keyframes.list', () => {
  test('只返回指定简单叶子的 {position,value},按位置升序,不含其他属性', async () => {
    const {registry, mountFoo} = setup({tracks: true})
    mountFoo()

    const xs = await registry.execute(
      'keyframes.list',
      {objectId: 'model:Foo', propPath: ['position', 'x']},
      ctx(),
    )
    expect(xs).toEqual([
      {position: 0, value: 5},
      {position: 2, value: 10},
    ])

    const ys = await registry.execute(
      'keyframes.list',
      {objectId: 'model:Foo', propPath: ['position', 'y']},
      ctx(),
    )
    expect(ys).toEqual([{position: 1, value: 7}])
  })

  test('未建轨叶子返回空数组', async () => {
    const {registry, mountFoo} = setup({tracks: true})
    mountFoo()

    const result = await registry.execute(
      'keyframes.list',
      {objectId: 'model:Foo', propPath: ['visible']},
      ctx(),
    )
    expect(result).toEqual([])
  })

  test('compound 路径拒绝 INVALID_ARGUMENT', async () => {
    const {registry, mountFoo} = setup({tracks: true})
    mountFoo()

    await expect(
      registry.execute(
        'keyframes.list',
        {objectId: 'model:Foo', propPath: ['position']},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  })
})

describe('keyframes.move', () => {
  test('from/to 按网格规则计算后经 transformKeyframes 适配移动源关键帧', async () => {
    const {registry, sheet, fakeStudio, calls, mountFoo} = setup({
      tracks: true,
    })
    mountFoo()

    const result = await registry.execute(
      'keyframes.move',
      {
        objectId: 'model:Foo',
        propPath: ['position', 'x'],
        from: 2.01,
        to: 4.01,
        snap: true,
      },
      ctx(),
    )

    expect(fakeStudio.transaction).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(1)
    const call = calls[0] as {
      op: string
      args: Record<string, unknown> & {snappingFunction: (n: number) => number}
    }
    expect(call.op).toBe('transformKeyframes')
    expect(call.args).toMatchObject({
      objectKey: 'Foo',
      sheetId: 'Scene',
      trackId: 'track-x',
      keyframeIds: ['kf2'],
      translate: 2,
      scale: 1,
      origin: 0,
    })
    // 与 AggregateKeyframeConnector 相同的吸附函数
    expect(call.args.snappingFunction).toBe(sheet.sequence.closestGridPosition)
    expect(result).toEqual({revision: 1})
  })

  test('源位置无关键帧返回 KEYFRAME_NOT_FOUND,不进入事务', async () => {
    const {registry, fakeStudio, mountFoo} = setup({tracks: true})
    mountFoo()

    await expect(
      registry.execute(
        'keyframes.move',
        {objectId: 'model:Foo', propPath: ['position', 'x'], from: 5, to: 6},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'KEYFRAME_NOT_FOUND'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('未建轨叶子返回 KEYFRAME_NOT_FOUND', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    await expect(
      registry.execute(
        'keyframes.move',
        {objectId: 'model:Foo', propPath: ['position', 'x'], from: 0, to: 1},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'KEYFRAME_NOT_FOUND'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('expectedRevision 冲突返回 REVISION_CONFLICT', async () => {
    const {registry, fakeStudio, mountFoo, notifyHistoric} = setup({
      tracks: true,
    })
    mountFoo()
    notifyHistoric()

    await expect(
      registry.execute(
        'keyframes.move',
        {
          objectId: 'model:Foo',
          propPath: ['position', 'x'],
          from: 2,
          to: 4,
          expectedRevision: 1,
        },
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })
})

describe('keyframes.delete', () => {
  test('在指定位置 unset(pointer),不擅自 unsequenceProp', async () => {
    const {registry, sheet, fakeStudio, calls, sequenceEditor, mountFoo} =
      setup({tracks: true})
    mountFoo()

    const result = await registry.execute(
      'keyframes.delete',
      {objectId: 'model:Foo', propPath: ['position', 'x'], at: 2},
      ctx(),
    )

    expect(fakeStudio.transaction).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([{op: 'unset', path: 'position.x'}])
    expect(sequenceEditor.setPrimitivePropAsStatic).not.toHaveBeenCalled()
    expect(sheet.sequence.position).toBe(2)
    expect(result).toEqual({revision: 1})
  })

  test('snap:true 时播放头定位到吸附后的 at', async () => {
    const {registry, sheet, mountFoo} = setup({tracks: true})
    mountFoo()

    await registry.execute(
      'keyframes.delete',
      {
        objectId: 'model:Foo',
        propPath: ['position', 'x'],
        at: 2.01,
        snap: true,
      },
      ctx(),
    )

    expect(sheet.sequence.position).toBe(2)
  })

  test('指定位置无关键帧返回 KEYFRAME_NOT_FOUND,不进入事务', async () => {
    const {registry, fakeStudio, mountFoo} = setup({tracks: true})
    mountFoo()

    await expect(
      registry.execute(
        'keyframes.delete',
        {objectId: 'model:Foo', propPath: ['position', 'x'], at: 5},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'KEYFRAME_NOT_FOUND'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('expectedRevision 冲突返回 REVISION_CONFLICT', async () => {
    const {registry, fakeStudio, mountFoo, notifyHistoric} = setup({
      tracks: true,
    })
    mountFoo()
    notifyHistoric()

    await expect(
      registry.execute(
        'keyframes.delete',
        {
          objectId: 'model:Foo',
          propPath: ['position', 'x'],
          at: 2,
          expectedRevision: 1,
        },
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })
})

describe('与 objects.update 的边界', () => {
  test('已建轨叶子所在属性:objects.update 仍返回 INVALID_STATE', async () => {
    const {registry, fakeStudio, mountFoo, registerObjectCommands} = setup({
      tracks: true,
    })
    registerObjectCommands()
    mountFoo()

    await expect(
      registry.execute(
        'objects.update',
        {objectId: 'model:Foo', props: {position: {x: 1, y: 2, z: 3}}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })
})

describe('会话生命周期', () => {
  test('dispose 后命令拒绝 API_DISPOSED', async () => {
    const {registry, runtime, mountFoo} = setup()
    mountFoo()
    runtime.dispose()

    await expect(
      registry.execute(
        'keyframes.list',
        {objectId: 'model:Foo', propPath: ['position', 'x']},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
    await expect(
      registry.execute(
        'keyframes.set',
        {objectId: 'model:Foo', propPath: ['position', 'x'], at: 1, value: 7},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
  })
})
