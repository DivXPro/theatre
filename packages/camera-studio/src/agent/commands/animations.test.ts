/**
 * animations 命令(2026-10-17,Task 9):apply / clear / getStatus。
 *
 * apply/clear 只写 props.animation 静态值(已建轨 INVALID_STATE,打帧走
 * keyframes.*);apply 先验证 AnimationEntry 存在且与模型骨架族兼容
 * (库模型条目 rig 优先,回退实例 rigIdOf;静态骨架拒绝)。
 *
 * getStatus 的 loaded/error 只读 PlacementManager 的运行时登记
 * (agent/runtime/animationStatus),绝不从 props 猜测——本套件直接调
 * setAnimationLoadStatus 模拟登记/清理。
 *
 * 布景同 poses.test.ts:真实 core project/sheet/object + 假 Studio
 * (getStudioSync 通道) + 假 Library + 假 getModelPlacement handler。
 */
import type {ISheetObject} from '@dreamerbird/core'
import type {Group} from 'three'
import type {PlacementEntry} from '../../PlacementManager'
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
  /** 预建轨:animation 一条轨 */
  tracks?: boolean
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
  const animationStatus =
    require('../runtime/animationStatus') as typeof import('../runtime/animationStatus')
  const {registerAnimationCommands} =
    require('./animations') as typeof import('./animations')
  const {PLACEMENTS_REGISTRY_KEY} =
    require('../../PlacementManager') as typeof import('../../PlacementManager')
  const {rigIdOf} =
    require('../../assetLibrary/rig') as typeof import('../../assetLibrary/rig')
  const three = require('three') as typeof import('three')

  const calls: Array<Record<string, unknown>> = []
  const fakeStudio = {
    transaction: jest.fn(
      (
        fn: (tools: {set: (pointer: unknown, value: unknown) => void}) => void,
      ) =>
        fn({
          set: (pointer: unknown, value: unknown) => {
            const {path} = getPointerParts(pointer as never)
            calls.push({op: 'set', path: path.join('.'), value})
          },
        }),
    ),
  }
  activeFakeStudio = fakeStudio
  cleanups.push(() => {
    activeFakeStudio = undefined
  })

  const state = {
    definitionVersion: globals.currentProjectStateDefinitionVersion,
    sheetsById: {
      Scene: {
        staticOverrides: {byObject: {}},
        sequence: {
          type: 'PositionalSequence',
          length: 10,
          subUnitsPerUnit: 30,
          tracksByObject: options.tracks
            ? {
                Foo: {
                  trackIdByPropPath: {'["animation"]': 'track-anim'},
                  trackData: {
                    'track-anim': {
                      type: 'BasicKeyframedTrack',
                      keyframes: {
                        byId: {
                          kf1: {
                            id: 'kf1',
                            position: 0,
                            connectedRight: true,
                            handles: [0.5, 0.5, 0.5, 0.5],
                            value: '',
                          },
                        },
                        allIds: {kf1: true},
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
  const project = core.getProject(`agent-anims-${++projectSeq}`, {
    state: state as never,
  })
  const sheet = project.sheet('Scene')

  const animEntry = {
    id: 'anim-1',
    kind: 'animation' as const,
    name: '走路',
    rig: 'mixamo',
    blobId: 'blob-a1',
    contentHash: 'hash-a1',
    duration: 1.5,
    createdAt: 10,
  }
  const animOtherRig = {...animEntry, id: 'anim-2', name: '异族', rig: 'other'}
  const modelEntry = {
    id: 'model-1',
    kind: 'model' as const,
    name: 'Y Bot',
    rig: 'mixamo',
    blobId: 'blob-1',
    contentHash: 'hash-1',
    boneCount: 65,
    vertexCount: 1000,
    createdAt: 0,
  }
  const poseEntry = {
    id: 'pose-1',
    kind: 'pose' as const,
    name: '坐姿',
    rig: 'mixamo',
    bones: {},
    createdAt: 1,
  }
  const entries = new Map<string, Record<string, unknown>>(
    [animEntry, animOtherRig, modelEntry, poseEntry].map((entry) => [
      entry.id,
      entry,
    ]),
  )
  const library = {
    getEntry: jest.fn(async (id: string) => entries.get(id)),
  }

  let notifyHistoric: () => void = () => {}
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: library as never,
    getStudio: () => fakeStudio as never,
    subscribeHistoric: (listener) => {
      notifyHistoric = listener
      return () => {}
    },
  })
  const registry = new AgentCommandRegistry()
  registerAnimationCommands(registry, runtime)

  /** Scene Runtime handler:当前 Foo 的放置条目 + Three 实例(逐用例可换) */
  let placementForFoo: {entry: PlacementEntry; instance: Group} | undefined
  const getModelPlacement = jest.fn(({key}: {key: string}) =>
    key === 'Foo' ? placementForFoo : undefined,
  )
  cleanups.push(runtime.bindHandlers({getModelPlacement}))

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
      list: JSON.stringify([
        {key: 'Foo', libraryEntryId: 'model-1', position: {x: 0, y: 0, z: 0}},
      ]),
    }
    const obj = sheet.object('Foo', {
      position: t.compound({
        x: t.number(0),
        y: t.number(0),
        z: t.number(0),
      }),
      pose: t.string(''),
      animation: t.string(''),
    })
    registerMounted('model:Foo', obj as ISheetObject<any>)
    return obj
  }

  /** 带骨骼的 Three 实例(rigIdOf 回退路径用) */
  function boneInstance(): Group {
    const group = new three.Group()
    const hips = new three.Bone()
    hips.name = 'mixamorigHips'
    group.add(hips)
    return group as Group
  }

  return {
    core,
    project,
    sheet,
    registry,
    runtime,
    fakeStudio,
    calls,
    library,
    mountFoo,
    boneInstance,
    rigIdOf,
    animationStatus,
    setPlacementForFoo: (p: typeof placementForFoo) => {
      placementForFoo = p
    },
    getModelPlacement,
    notifyHistoric: () => notifyHistoric(),
  }
}

const COMMAND_NAMES = [
  'animations.apply',
  'animations.clear',
  'animations.getStatus',
] as const

describe('animations 命令注册', () => {
  test('三个命令全部注册', () => {
    const {registry} = setup()
    for (const name of COMMAND_NAMES) {
      expect(registry.has(name)).toBe(true)
    }
  })

  test('元数据:apply/clear 为项目单步命令且接受 expectedRevision;getStatus 为会话域查询', () => {
    const {registry} = setup()
    const described = new Map(
      registry.describe().commands.map((c) => [c.name, c]),
    )
    for (const name of ['animations.apply', 'animations.clear']) {
      expect(described.get(name)).toMatchObject({
        kind: 'mutation',
        stateDomain: 'project',
        undoable: 'single-step',
        completion: 'committed',
        acceptsExpectedRevision: true,
      })
    }
    expect(described.get('animations.getStatus')).toMatchObject({
      kind: 'query',
      acceptsExpectedRevision: false,
    })
  })
})

describe('animations.apply', () => {
  test('动画条目与模型兼容:单事务写 props.animation 静态值', async () => {
    const {
      registry,
      fakeStudio,
      calls,
      mountFoo,
      boneInstance,
      setPlacementForFoo,
    } = setup()
    mountFoo()
    setPlacementForFoo({
      entry: {
        key: 'Foo',
        libraryEntryId: 'model-1',
        position: {x: 0, y: 0, z: 0},
      },
      instance: boneInstance(),
    })

    const result = await registry.execute(
      'animations.apply',
      {objectId: 'model:Foo', assetId: 'anim-1'},
      ctx(),
    )

    expect(fakeStudio.transaction).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([{op: 'set', path: 'animation', value: 'anim-1'}])
    expect(result).toEqual({revision: 1})
  })

  test('资产不存在 ASSET_NOT_FOUND;非动画条目 INVALID_ARGUMENT', async () => {
    const {registry, fakeStudio, mountFoo, boneInstance, setPlacementForFoo} =
      setup()
    mountFoo()
    setPlacementForFoo({
      entry: {
        key: 'Foo',
        libraryEntryId: 'model-1',
        position: {x: 0, y: 0, z: 0},
      },
      instance: boneInstance(),
    })

    await expect(
      registry.execute(
        'animations.apply',
        {objectId: 'model:Foo', assetId: 'nope'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'ASSET_NOT_FOUND'})
    await expect(
      registry.execute(
        'animations.apply',
        {objectId: 'model:Foo', assetId: 'pose-1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('骨架族不符 INVALID_ARGUMENT,不写', async () => {
    const {registry, fakeStudio, mountFoo, boneInstance, setPlacementForFoo} =
      setup()
    mountFoo()
    setPlacementForFoo({
      entry: {
        key: 'Foo',
        libraryEntryId: 'model-1',
        position: {x: 0, y: 0, z: 0},
      },
      instance: boneInstance(),
    })

    await expect(
      registry.execute(
        'animations.apply',
        {objectId: 'model:Foo', assetId: 'anim-2'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('无库条目时回退实例 rigIdOf;静态骨架 INVALID_STATE', async () => {
    // 回退路径:放置条目无 libraryEntryId,模型 rig 由实例骨骼计算
    const s2 = setup()
    s2.mountFoo()
    const instance2 = s2.boneInstance()
    s2.setPlacementForFoo({
      entry: {key: 'Foo', position: {x: 0, y: 0, z: 0}},
      instance: instance2,
    })
    const fallbackEntry = {
      id: 'anim-rig',
      kind: 'animation' as const,
      name: '实例族',
      rig: s2.rigIdOf(instance2),
      blobId: 'b',
      contentHash: 'h',
      duration: 1,
      createdAt: 11,
    }
    s2.library.getEntry.mockImplementation(async (id: string) =>
      id === 'anim-rig' ? fallbackEntry : undefined,
    )
    await s2.registry.execute(
      'animations.apply',
      {objectId: 'model:Foo', assetId: 'anim-rig'},
      ctx(),
    )
    expect(s2.calls).toEqual([
      {op: 'set', path: 'animation', value: 'anim-rig'},
    ])

    // 静态骨架:无骨骼实例且无库 rig → INVALID_STATE
    const s3 = setup()
    s3.mountFoo()
    s3.setPlacementForFoo({
      entry: {key: 'Foo', position: {x: 0, y: 0, z: 0}},
      instance: new (require('three').Group)() as Group,
    })
    s3.library.getEntry.mockImplementation(async (id: string) =>
      id === 'anim-1'
        ? {
            id: 'anim-1',
            kind: 'animation' as const,
            name: '走路',
            rig: 'mixamo',
            blobId: 'blob-a1',
            contentHash: 'hash-a1',
            duration: 1.5,
            createdAt: 10,
          }
        : undefined,
    )
    await expect(
      s3.registry.execute(
        'animations.apply',
        {objectId: 'model:Foo', assetId: 'anim-1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })

  test('animation 已建轨返回 INVALID_STATE,不写', async () => {
    const {registry, fakeStudio, mountFoo, boneInstance, setPlacementForFoo} =
      setup({tracks: true})
    mountFoo()
    setPlacementForFoo({
      entry: {
        key: 'Foo',
        libraryEntryId: 'model-1',
        position: {x: 0, y: 0, z: 0},
      },
      instance: boneInstance(),
    })

    await expect(
      registry.execute(
        'animations.apply',
        {objectId: 'model:Foo', assetId: 'anim-1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('expectedRevision 冲突 REVISION_CONFLICT;Scene Runtime 未绑定 SCENE_UNAVAILABLE', async () => {
    const {
      registry,
      fakeStudio,
      mountFoo,
      boneInstance,
      setPlacementForFoo,
      notifyHistoric,
    } = setup()
    mountFoo()
    setPlacementForFoo({
      entry: {
        key: 'Foo',
        libraryEntryId: 'model-1',
        position: {x: 0, y: 0, z: 0},
      },
      instance: boneInstance(),
    })
    notifyHistoric()

    await expect(
      registry.execute(
        'animations.apply',
        {objectId: 'model:Foo', assetId: 'anim-1', expectedRevision: 1},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })
})

describe('animations.clear', () => {
  test('写空值(单事务),返回 revision', async () => {
    const {registry, calls, mountFoo} = setup()
    mountFoo()

    const result = await registry.execute(
      'animations.clear',
      {objectId: 'model:Foo'},
      ctx(),
    )
    expect(calls).toEqual([{op: 'set', path: 'animation', value: ''}])
    expect(result).toEqual({revision: 1})
  })

  test('已建轨 INVALID_STATE;expectedRevision 冲突 REVISION_CONFLICT', async () => {
    const {registry, fakeStudio, mountFoo} = setup({tracks: true})
    mountFoo()

    await expect(
      registry.execute('animations.clear', {objectId: 'model:Foo'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })
})

describe('animations.getStatus', () => {
  test('未设置动画:{loaded:false} 且无 assetId', async () => {
    const {registry, mountFoo} = setup()
    mountFoo()

    await expect(
      registry.execute('animations.getStatus', {objectId: 'model:Foo'}, ctx()),
    ).resolves.toEqual({loaded: false})
  })

  test('已设置但未登记:加载中 {assetId, loaded:false}', async () => {
    const {registry, mountFoo} = setup()
    const obj = mountFoo()
    obj.initialValue = {animation: 'anim-1'}

    await expect(
      registry.execute('animations.getStatus', {objectId: 'model:Foo'}, ctx()),
    ).resolves.toEqual({assetId: 'anim-1', loaded: false})
  })

  test('运行时登记 loaded:true → 已加载;登记 error → 加载失败', async () => {
    const {registry, mountFoo, animationStatus} = setup()
    const obj = mountFoo()
    obj.initialValue = {animation: 'anim-1'}

    animationStatus.setAnimationLoadStatus('Foo', {
      assetId: 'anim-1',
      loaded: true,
    })
    cleanups.push(() => animationStatus.clearAnimationLoadStatus('Foo'))
    await expect(
      registry.execute('animations.getStatus', {objectId: 'model:Foo'}, ctx()),
    ).resolves.toEqual({assetId: 'anim-1', loaded: true})

    animationStatus.setAnimationLoadStatus('Foo', {
      assetId: 'anim-1',
      loaded: false,
      error: {
        code: 'RESOURCE_LOAD_FAILED',
        message: 'GLB 解析失败',
        retryable: true,
      },
    })
    await expect(
      registry.execute('animations.getStatus', {objectId: 'model:Foo'}, ctx()),
    ).resolves.toEqual({
      assetId: 'anim-1',
      loaded: false,
      error: {
        code: 'RESOURCE_LOAD_FAILED',
        message: 'GLB 解析失败',
        retryable: true,
      },
    })
  })

  test('登记的是旧 assetId(props 已换):按加载中报,不读陈旧 loaded', async () => {
    const {registry, mountFoo, animationStatus} = setup()
    const obj = mountFoo()
    obj.initialValue = {animation: 'anim-2'}
    animationStatus.setAnimationLoadStatus('Foo', {
      assetId: 'anim-1',
      loaded: true,
    })
    cleanups.push(() => animationStatus.clearAnimationLoadStatus('Foo'))

    await expect(
      registry.execute('animations.getStatus', {objectId: 'model:Foo'}, ctx()),
    ).resolves.toEqual({assetId: 'anim-2', loaded: false})
  })

  test('对象不存在 OBJECT_NOT_FOUND;未挂载 INVALID_STATE', async () => {
    const {registry, mountFoo} = setup()

    await expect(
      registry.execute('animations.getStatus', {objectId: 'model:Nope'}, ctx()),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})

    const obj = mountFoo()
    const objectRuntime =
      require('../runtime/objectRuntime') as typeof import('../runtime/objectRuntime')
    objectRuntime.unregisterSceneSheetObject('model:Foo', obj)
    await expect(
      registry.execute('animations.getStatus', {objectId: 'model:Foo'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })
})

describe('会话生命周期', () => {
  test('dispose 后命令拒绝 API_DISPOSED', async () => {
    const {registry, runtime, mountFoo} = setup()
    mountFoo()
    runtime.dispose()

    await expect(
      registry.execute('animations.getStatus', {objectId: 'model:Foo'}, ctx()),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
    await expect(
      registry.execute(
        'animations.apply',
        {objectId: 'model:Foo', assetId: 'anim-1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
  })
})
