/**
 * objects.update(Task 5):静态属性更新与 revision 冲突保护。
 *
 * 校验全部发生在事务之前:参数形状 → 对象存在/挂载 → 领域专用属性拒绝 →
 * 值形状(compound 必须完整/拒绝 NaN、Infinity) → 建轨(INVALID_STATE) →
 * expectedRevision(REVISION_CONFLICT)。合法更新在单个 studio.transaction
 * 回调内写完整个 patch;回调抛错时 revision 不增加 —— revision 只随真实
 * historic 通知递增(测试手动触发捕获的 listener 模拟通知)。
 *
 * 建轨布景:真实 studio 进 jest 太重,直接以带 tracksByObject 的初始
 * state 建 project(trackIdByPropPath 键为 encodePathToProp 结果)。
 * jest-esbuild 不提升 jest.mock:doMock 挂模块顶层 + 晚绑定 fakeStudio;
 * 不能 resetModules 后再 requireActual core(会重复注册 window 核心包
 * 而崩),所以对象登记用 afterEach 逐个清理。
 */
import type {ISheetObject} from '@dreamerbird/core'
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
  /** 事务回调内抛错(验证 revision 不增加) */
  throwInTransaction?: boolean
  /** 预建轨:trackIdByPropPath(encodePathToProp 键 → trackId)与帧值 */
  tracks?: {trackIdByPropPath: Record<string, string>; keyframeValue: unknown}
}

function setup(options: SetupOptions = {}) {
  const {getPointerParts} =
    require('@dreamerbird/dataverse') as typeof import('@dreamerbird/dataverse')
  const setCalls: Array<{path: string; value: unknown}> = []
  const fakeStudio = {
    transaction: jest.fn(
      (
        fn: (tools: {set: (pointer: unknown, value: unknown) => void}) => void,
      ) =>
        fn({
          set: (pointer: unknown, value: unknown) => {
            if (options.throwInTransaction) throw new Error('boom')
            const {path} = getPointerParts(pointer as never)
            setCalls.push({path: path.join('.'), value})
          },
        }),
    ),
  }
  activeFakeStudio = fakeStudio
  cleanups.push(() => {
    activeFakeStudio = undefined
  })

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
  const {registerObjectCommands} =
    require('./objects') as typeof import('./objects')
  const {PLACEMENTS_REGISTRY_KEY} =
    require('../../PlacementManager') as typeof import('../../PlacementManager')

  const state = options.tracks
    ? stateWithTracks(
        globals.currentProjectStateDefinitionVersion,
        options.tracks.trackIdByPropPath,
        options.tracks.keyframeValue,
      )
    : undefined
  const project = core.getProject(
    `agent-objects-${++projectSeq}`,
    state ? {state: state as never} : {},
  )
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
  registerObjectCommands(registry, runtime)

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
    sheet,
    registry,
    runtime,
    fakeStudio,
    setCalls,
    mountFoo,
    notifyHistoric: () => notifyHistoric(),
    objectRuntime,
    PLACEMENTS_REGISTRY_KEY,
  }
}

/** 带轨道的初始 project state(与 theatre 存档同构) */
function stateWithTracks(
  definitionVersion: string,
  trackIdByPropPath: Record<string, string>,
  keyframeValue: unknown,
) {
  const trackData: Record<string, unknown> = {}
  for (const trackId of Object.values(trackIdByPropPath)) {
    trackData[trackId] = {
      type: 'BasicKeyframedTrack',
      keyframes: {
        byId: {
          kf1: {
            id: 'kf1',
            position: 0,
            connectedRight: true,
            handles: [0.5, 0.5, 0.5, 0.5],
            value: keyframeValue,
          },
        },
        allIds: {kf1: true},
      },
    }
  }
  return {
    definitionVersion,
    sheetsById: {
      Scene: {
        staticOverrides: {byObject: {}},
        sequence: {
          type: 'PositionalSequence',
          length: 10,
          subUnitsPerUnit: 30,
          tracksByObject: {Foo: {trackIdByPropPath, trackData}},
        },
      },
    },
  }
}

describe('objects.update 静态更新', () => {
  test('合法 position 一次性更新:单事务写完整个 patch,返回当前 revision', async () => {
    const {registry, fakeStudio, setCalls, mountFoo} = setup()
    mountFoo()

    const result = await registry.execute(
      'objects.update',
      {
        objectId: 'model:Foo',
        props: {position: {x: 1, y: 2, z: 3}, visible: false},
      },
      ctx(),
    )

    expect(result).toEqual({revision: 1})
    expect(fakeStudio.transaction).toHaveBeenCalledTimes(1)
    expect(setCalls).toEqual([
      {path: 'position', value: {x: 1, y: 2, z: 3}},
      {path: 'visible', value: false},
    ])
  })

  test('未知属性返回 INVALID_ARGUMENT,不进入事务', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    await expect(
      registry.execute(
        'objects.update',
        {objectId: 'model:Foo', props: {nope: 1}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('compound 不完整(只传 position.x)返回 INVALID_ARGUMENT', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    await expect(
      registry.execute(
        'objects.update',
        {objectId: 'model:Foo', props: {position: {x: 1}}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('compound 多余键返回 INVALID_ARGUMENT', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    await expect(
      registry.execute(
        'objects.update',
        {objectId: 'model:Foo', props: {position: {x: 1, y: 2, z: 3, w: 4}}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('NaN 与 Infinity 被拒绝', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    for (const bad of [NaN, Infinity, -Infinity]) {
      await expect(
        registry.execute(
          'objects.update',
          {objectId: 'model:Foo', props: {position: {x: bad, y: 0, z: 0}}},
          ctx(),
        ),
      ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    }
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('运行时类型不匹配(字符串写给 number)返回 INVALID_ARGUMENT', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    await expect(
      registry.execute(
        'objects.update',
        {objectId: 'model:Foo', props: {position: {x: 'a', y: 0, z: 0}}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute(
        'objects.update',
        {objectId: 'model:Foo', props: {visible: 'yes'}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('领域专用属性被 objects.update 拒绝(INVALID_ARGUMENT)', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    const owned = [
      'points',
      'pose',
      'poseOverride',
      'gestureL',
      'gestureR',
      'animation',
      'aimTarget',
      'pathKey',
      'parent',
      'source',
    ]
    for (const prop of owned) {
      await expect(
        registry.execute(
          'objects.update',
          {objectId: 'model:Foo', props: {[prop]: 'x'}},
          ctx(),
        ),
      ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    }
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('注册表有条目但未挂载:INVALID_STATE', async () => {
    const {core, sheet, registry, fakeStudio, PLACEMENTS_REGISTRY_KEY} = setup()
    const registryObj = sheet.object(
      PLACEMENTS_REGISTRY_KEY,
      {list: core.types.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify([{key: 'Ghost', position: {x: 0, y: 0, z: 0}}]),
    }

    await expect(
      registry.execute(
        'objects.update',
        {objectId: 'model:Ghost', props: {label: 'x'}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('不存在的对象:OBJECT_NOT_FOUND', async () => {
    const {registry} = setup()
    await expect(
      registry.execute(
        'objects.update',
        {objectId: 'model:Nope', props: {label: 'x'}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
  })
})

describe('objects.update 建轨保护', () => {
  test('compound 任一叶子已建轨:整个更新在事务前返回 INVALID_STATE', async () => {
    const {registry, fakeStudio, mountFoo} = setup({
      tracks: {
        trackIdByPropPath: {'["position","x"]': 'track-x'},
        keyframeValue: 5,
      },
    })
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

  test('简单属性已建轨:INVALID_STATE,同事务其他属性也不写', async () => {
    const {registry, fakeStudio, mountFoo} = setup({
      tracks: {
        trackIdByPropPath: {'["label"]': 'track-label'},
        keyframeValue: 'a',
      },
    })
    mountFoo()

    await expect(
      registry.execute(
        'objects.update',
        {objectId: 'model:Foo', props: {visible: false, label: 'b'}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })
})

describe('objects.update revision 与事务', () => {
  test('historic 通知后 expectedRevision 过期:REVISION_CONFLICT,没有任何 set', async () => {
    const {registry, runtime, fakeStudio, setCalls, mountFoo, notifyHistoric} =
      setup()
    mountFoo()
    notifyHistoric()
    expect(runtime.revision).toBe(2)

    await expect(
      registry.execute(
        'objects.update',
        {
          objectId: 'model:Foo',
          props: {position: {x: 1, y: 2, z: 3}},
          expectedRevision: 1,
        },
        ctx(),
      ),
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      details: {expectedRevision: 1, actualRevision: 2},
    })
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
    expect(setCalls).toEqual([])
  })

  test('expectedRevision 匹配当前 revision 时正常执行', async () => {
    const {registry, setCalls, mountFoo} = setup()
    mountFoo()

    const result = await registry.execute(
      'objects.update',
      {objectId: 'model:Foo', props: {label: 'renamed'}, expectedRevision: 1},
      ctx(),
    )
    expect(result).toEqual({revision: 1})
    expect(setCalls).toEqual([{path: 'label', value: 'renamed'}])
  })

  test('事务回调抛错:命令失败且 revision 不增加', async () => {
    const {registry, runtime, mountFoo} = setup({throwInTransaction: true})
    mountFoo()

    await expect(
      registry.execute(
        'objects.update',
        {objectId: 'model:Foo', props: {label: 'x'}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INTERNAL_ERROR'})
    // revision 只随真实 historic 通知递增,不由命令手工加一
    expect(runtime.revision).toBe(1)
  })

  test('会话销毁后更新返回 API_DISPOSED', async () => {
    const {registry, runtime, mountFoo} = setup()
    mountFoo()
    runtime.dispose()

    await expect(
      registry.execute(
        'objects.update',
        {objectId: 'model:Foo', props: {label: 'x'}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
  })

  test('describe() 元数据:mutation/project/single-step 且接受 expectedRevision', () => {
    const {registry} = setup()
    const command = registry
      .describe()
      .commands.find((c) => c.name === 'objects.update')
    expect(command).toBeDefined()
    expect(command).toMatchObject({
      kind: 'mutation',
      stateDomain: 'project',
      undoable: 'single-step',
      completion: 'committed',
      acceptsExpectedRevision: true,
    })
  })
})

describe('propAccess 建轨检测(Task 7 前置)', () => {
  test('isPropSequenced:顶层 compound/叶子路径/未建轨三分支', () => {
    const {mountFoo, objectRuntime} = setup({
      tracks: {
        trackIdByPropPath: {'["position","x"]': 'track-x'},
        keyframeValue: 5,
      },
    })
    mountFoo()
    const {isPropSequenced} =
      require('../propAccess') as typeof import('../propAccess')
    const obj = objectRuntime.getSceneSheetObject('model:Foo')!

    expect(isPropSequenced(obj, 'position')).toBe(true)
    expect(isPropSequenced(obj, 'position.x')).toBe(true)
    expect(isPropSequenced(obj, 'position.y')).toBe(false)
    expect(isPropSequenced(obj, 'visible')).toBe(false)
    expect(isPropSequenced(obj, 'label')).toBe(false)
  })

  test('getSimplePropPointer 按点路径导航到叶子指针', () => {
    const {mountFoo, objectRuntime} = setup()
    mountFoo()
    const {getSimplePropPointer} =
      require('../propAccess') as typeof import('../propAccess')
    const {getPointerParts} =
      require('@dreamerbird/dataverse') as typeof import('@dreamerbird/dataverse')
    const obj = objectRuntime.getSceneSheetObject('model:Foo')!

    const pointer = getSimplePropPointer(obj, 'position.x')
    expect(getPointerParts(pointer as never).path).toEqual(['position', 'x'])
  })
})
