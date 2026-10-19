/**
 * poses 命令(2026-10-17,Task 9):apply / applyCustom / clear / saveCurrent /
 * setGesture / session.start / session.commit / session.cancel。
 *
 * 布景同 objects.test.ts / keyframes.test.ts:真实 core project/sheet/object,
 * jest-esbuild 不提升 jest.mock —— doMock 挂模块顶层 + 晚绑定
 * activeFakeStudio:
 *   - `@dreamerbird/core` 的 getStudioSync(静态写入通道,setStaticProps);
 *   - `@dreamerbird/studio/getStudio`(poses.clear 的 stateEditors 通道,
 *     与 keyframeTracks 同路径)。
 * 两者指向同一个假 Studio;transaction 同时提供 set 与 stateEditors 工具并
 * 记录调用顺序。
 *
 * 模型实例经 Scene Runtime 的 getModelPlacement handler 注入(假 handler,
 * 形状与生产绑定一致);姿势会话经 poseSession 真模块 + poseSessionRuntime
 * 手工登记 Rig 句柄模拟 PoseModeRig 挂载。
 */
import type {ISheetObject} from '@dreamerbird/core'
import type {Group} from 'three'
import type {PlacementEntry} from '../../PlacementManager'
import type {CommandContext} from '../types'

let projectSeq = 0

/** 晚绑定:doMock 工厂只跑一次,两个 Studio 通道都读当前 setup 的 studio */
let activeFakeStudio: {transaction: unknown} | undefined

jest.doMock('@dreamerbird/core', () => ({
  ...jest.requireActual('@dreamerbird/core'),
  getStudioSync: () => activeFakeStudio,
}))

jest.doMock('@dreamerbird/studio/getStudio', () => ({
  __esModule: true,
  default: () => activeFakeStudio,
}))

/** 缩略图补图是后台旁路:本套件只验证它被触发,不跑真实离屏渲染 */
const backfillPoseThumbnails = jest.fn(
  async (_lib?: unknown, _opts?: unknown) => {},
)
jest.doMock('../../assetLibrary/poseThumbnail', () => ({
  __esModule: true,
  backfillPoseThumbnails: (lib: unknown, opts?: unknown) =>
    backfillPoseThumbnails(lib, opts),
}))

const cleanups: Array<() => void> = []
afterEach(() => {
  backfillPoseThumbnails.mockClear()
  while (cleanups.length) cleanups.pop()!()
})

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

type SetupOptions = {
  /** 预建轨:trackIdByPropPath(encodePathToProp 键 → trackId)+ 帧值 */
  tracks?: {trackIdByPropPath: Record<string, string>; keyframeValue: unknown}
  /** 默认 true;false 时不绑 getModelPlacement(测 SCENE_UNAVAILABLE) */
  bindPlacementHandler?: boolean
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
  const poseSessionRuntime =
    require('../runtime/poseSessionRuntime') as typeof import('../runtime/poseSessionRuntime')
  const poseSession =
    require('../../poseMode/poseSession') as typeof import('../../poseMode/poseSession')
  const {registerPoseCommands} = require('./poses') as typeof import('./poses')
  const {PLACEMENTS_REGISTRY_KEY} =
    require('../../PlacementManager') as typeof import('../../PlacementManager')
  const {LibraryError} =
    require('../../assetLibrary/source') as typeof import('../../assetLibrary/source')
  const three = require('three') as typeof import('three')

  /** 事务调用记录(op 顺序 + 关键参数) */
  const calls: Array<Record<string, unknown>> = []
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
              historic: {
                sheetsById: {
                  sequence: {
                    setPrimitivePropAsStatic: jest.fn(
                      (args: Record<string, unknown>) => {
                        calls.push({op: 'setPrimitivePropAsStatic', args})
                      },
                    ),
                  },
                  staticOverrides: {
                    byObject: {
                      unsetValueOfPrimitiveProp: jest.fn(
                        (args: Record<string, unknown>) => {
                          calls.push({op: 'unsetStatic', args})
                        },
                      ),
                    },
                  },
                },
              },
            },
          },
        }),
    ),
  }
  activeFakeStudio = fakeStudio
  cleanups.push(() => {
    activeFakeStudio = undefined
  })

  const keyframe = (id: string, position: number, value: unknown) => ({
    id,
    position,
    connectedRight: true,
    handles: [0.5, 0.5, 0.5, 0.5],
    value,
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
                  trackIdByPropPath: options.tracks.trackIdByPropPath,
                  trackData: Object.fromEntries(
                    Object.values(options.tracks.trackIdByPropPath).map(
                      (trackId) => [
                        trackId,
                        {
                          type: 'BasicKeyframedTrack',
                          keyframes: {
                            byId: {
                              kf1: keyframe(
                                'kf1',
                                0,
                                options.tracks!.keyframeValue,
                              ),
                            },
                            allIds: {kf1: true},
                          },
                        },
                      ],
                    ),
                  ),
                },
              }
            : {},
        },
      },
    },
  }
  const project = core.getProject(`agent-poses-${++projectSeq}`, {
    state: state as never,
  })
  const sheet = project.sheet('Scene')

  // —— 资产库假:姿势/手势/模型/动画条目 ——
  const poseEntry = {
    id: 'pose-1',
    kind: 'pose' as const,
    name: '坐姿',
    rig: 'mixamo',
    bones: {Hips: {rotation: [0, 0, 0, 1] as [number, number, number, number]}},
    createdAt: 1,
  }
  const gestureLeft = {
    id: 'gest-l',
    kind: 'pose' as const,
    name: 'Fu · 左手',
    rig: 'mixamo',
    bones: {
      LeftHandIndex1: {
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
    },
    createdAt: 2,
  }
  const gestureRight = {
    id: 'gest-r',
    kind: 'pose' as const,
    name: 'Fu · 右手',
    rig: 'mixamo',
    bones: {
      RightHandIndex1: {
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
    },
    createdAt: 3,
  }
  const gestureDual = {
    id: 'gest-dual',
    kind: 'pose' as const,
    name: '放松',
    rig: 'mixamo',
    bones: {
      LeftHandThumb1: {},
      RightHandThumb1: {},
    },
    createdAt: 4,
  }
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
  const entries = new Map<string, Record<string, unknown>>(
    [poseEntry, gestureLeft, gestureRight, gestureDual, modelEntry].map(
      (entry) => [entry.id, entry],
    ),
  )
  const library = {
    getEntry: jest.fn(async (id: string) => entries.get(id)),
    listEntries: jest.fn(async (kind?: string) =>
      [...entries.values()].filter((entry) => !kind || entry.kind === kind),
    ),
    putEntry: jest.fn(async (entry: Record<string, unknown> & {id: string}) => {
      entries.set(entry.id, entry)
    }),
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
  registerPoseCommands(registry, runtime)

  /** Scene Runtime handler:当前 Foo 的放置条目 + Three 实例(逐用例可换) */
  let placementForFoo: {entry: PlacementEntry; instance: Group} | undefined
  const getModelPlacement = jest.fn(({key}: {key: string}) =>
    key === 'Foo' ? placementForFoo : undefined,
  )
  if (options.bindPlacementHandler !== false) {
    cleanups.push(runtime.bindHandlers({getModelPlacement}))
  }

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
      gestureL: t.string(''),
      gestureR: t.string(''),
      animation: t.string(''),
    })
    registerMounted('model:Foo', obj as ISheetObject<any>)
    return obj
  }

  /** 带骨骼的 Three 实例(capturePose / rigIdOf 用) */
  function boneInstance(): Group {
    const group = new three.Group()
    const hips = new three.Bone()
    hips.name = 'mixamorigHips'
    group.add(hips)
    return group as Group
  }

  /** 登记 Rig 句柄并随用例清理(模拟 PoseModeRig 挂载/卸载) */
  function registerRig(
    key: string,
    handlers: {commit: () => void; cancel: () => void},
  ) {
    const unregister = poseSessionRuntime.registerPoseSessionRig(key, handlers)
    cleanups.push(unregister)
    return handlers
  }

  cleanups.push(() => poseSession.clearPoseSession())

  return {
    core,
    project,
    sheet,
    registry,
    runtime,
    fakeStudio,
    calls,
    library,
    entries,
    LibraryError,
    mountFoo,
    boneInstance,
    registerRig,
    poseSession,
    poseSessionRuntime,
    setPlacementForFoo: (p: typeof placementForFoo) => {
      placementForFoo = p
    },
    getModelPlacement,
    notifyHistoric: () => notifyHistoric(),
  }
}

const COMMAND_NAMES = [
  'poses.apply',
  'poses.applyCustom',
  'poses.clear',
  'poses.saveCurrent',
  'poses.setGesture',
  'poses.session.start',
  'poses.session.commit',
  'poses.session.cancel',
] as const

describe('poses 命令注册', () => {
  test('八个命令全部注册', () => {
    const {registry} = setup()
    for (const name of COMMAND_NAMES) {
      expect(registry.has(name)).toBe(true)
    }
  })

  test('元数据:写姿势/手势为项目单步命令并接受 expectedRevision;saveCurrent 属资产域;会话命令属会话域', () => {
    const {registry} = setup()
    const described = new Map(
      registry.describe().commands.map((c) => [c.name, c]),
    )
    for (const name of [
      'poses.apply',
      'poses.applyCustom',
      'poses.clear',
      'poses.setGesture',
    ]) {
      expect(described.get(name)).toMatchObject({
        kind: 'mutation',
        stateDomain: 'project',
        undoable: 'single-step',
        completion: 'committed',
        acceptsExpectedRevision: true,
      })
    }
    expect(described.get('poses.saveCurrent')).toMatchObject({
      kind: 'mutation',
      stateDomain: 'asset',
      undoable: 'none',
      acceptsExpectedRevision: false,
    })
    for (const name of [
      'poses.session.start',
      'poses.session.commit',
      'poses.session.cancel',
    ]) {
      expect(described.get(name)).toMatchObject({
        kind: 'mutation',
        stateDomain: 'session',
        acceptsExpectedRevision: false,
      })
    }
  })
})

describe('poses.apply', () => {
  test('库姿势存在:单个事务以 serializeLibPose 写 props.pose 静态值', async () => {
    const {registry, fakeStudio, calls, mountFoo} = setup()
    mountFoo()

    const result = await registry.execute(
      'poses.apply',
      {objectId: 'model:Foo', assetId: 'pose-1'},
      ctx(),
    )

    expect(fakeStudio.transaction).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      {
        op: 'set',
        path: 'pose',
        value: JSON.stringify({kind: 'lib', id: 'pose-1'}),
      },
    ])
    expect(result).toEqual({revision: 1})
  })

  test('资产不存在 ASSET_NOT_FOUND;非姿势条目 INVALID_ARGUMENT;均不写', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    await expect(
      registry.execute(
        'poses.apply',
        {objectId: 'model:Foo', assetId: 'nope'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'ASSET_NOT_FOUND'})
    await expect(
      registry.execute(
        'poses.apply',
        {objectId: 'model:Foo', assetId: 'model-1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('pose 已建轨返回 INVALID_STATE,不写关键帧', async () => {
    const {registry, fakeStudio, mountFoo} = setup({
      tracks: {
        trackIdByPropPath: {'["pose"]': 'track-pose'},
        keyframeValue: JSON.stringify({kind: 'lib', id: 'pose-1'}),
      },
    })
    mountFoo()

    await expect(
      registry.execute(
        'poses.apply',
        {objectId: 'model:Foo', assetId: 'pose-1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('expectedRevision 冲突返回 REVISION_CONFLICT 且不进入事务', async () => {
    const {registry, fakeStudio, mountFoo, notifyHistoric} = setup()
    mountFoo()
    notifyHistoric()

    await expect(
      registry.execute(
        'poses.apply',
        {objectId: 'model:Foo', assetId: 'pose-1', expectedRevision: 1},
        ctx(),
      ),
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      details: {expectedRevision: 1, actualRevision: 2},
    })
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('对象不存在/类型不符/未挂载分别 OBJECT_NOT_FOUND/INVALID_ID_KIND/INVALID_STATE', async () => {
    const {registry, mountFoo} = setup()

    await expect(
      registry.execute(
        'poses.apply',
        {objectId: 'model:Nope', assetId: 'pose-1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    await expect(
      registry.execute(
        'poses.apply',
        {objectId: 'camera:Foo', assetId: 'pose-1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    // 注册表有条目但运行时未挂载
    const obj = mountFoo()
    const objectRuntime =
      require('../runtime/objectRuntime') as typeof import('../runtime/objectRuntime')
    objectRuntime.unregisterSceneSheetObject('model:Foo', obj)
    await expect(
      registry.execute(
        'poses.apply',
        {objectId: 'model:Foo', assetId: 'pose-1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })

  test('Studio 不可用返回 SCENE_UNAVAILABLE', async () => {
    const {registry, mountFoo} = setup()
    mountFoo()
    activeFakeStudio = undefined

    await expect(
      registry.execute(
        'poses.apply',
        {objectId: 'model:Foo', assetId: 'pose-1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })
})

describe('poses.applyCustom', () => {
  const bones = {
    mixamorigHips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]},
    mixamorigSpine: {rotation: [0.1, 0, 0, 0.99]},
  }

  test('合法骨骼快照以 serializeCustomPose 写 props.pose', async () => {
    const {registry, calls, mountFoo} = setup()
    mountFoo()

    const result = await registry.execute(
      'poses.applyCustom',
      {objectId: 'model:Foo', bones},
      ctx(),
    )

    expect(calls).toEqual([
      {
        op: 'set',
        path: 'pose',
        value: JSON.stringify({kind: 'custom', bones}),
      },
    ])
    expect(result).toEqual({revision: 1})
  })

  test('骨骼形状校验:空表/非对象/缺字段/坏数组/NaN 一律 INVALID_ARGUMENT', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    const bads: unknown[] = [
      {},
      'bones',
      {Hips: {}},
      {Hips: {rotation: [0, 0, 0]}},
      {Hips: {rotation: [0, 0, 0, NaN]}},
      {Hips: {position: [0, 1]}},
      {Hips: {rotation: [0, 0, 0, 1], scale: 1}},
    ]
    for (const bad of bads) {
      await expect(
        registry.execute(
          'poses.applyCustom',
          {objectId: 'model:Foo', bones: bad},
          ctx(),
        ),
      ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    }
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('pose 已建轨返回 INVALID_STATE', async () => {
    const {registry, fakeStudio, mountFoo} = setup({
      tracks: {
        trackIdByPropPath: {'["pose"]': 'track-pose'},
        keyframeValue: '',
      },
    })
    mountFoo()

    await expect(
      registry.execute(
        'poses.applyCustom',
        {objectId: 'model:Foo', bones},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })
})

describe('poses.setGesture', () => {
  test('左/右侧分别写 gestureL/gestureR(serializeLibPose)', async () => {
    const {registry, calls, mountFoo} = setup()
    mountFoo()

    await registry.execute(
      'poses.setGesture',
      {objectId: 'model:Foo', side: 'left', assetId: 'gest-l'},
      ctx(),
    )
    await registry.execute(
      'poses.setGesture',
      {objectId: 'model:Foo', side: 'right', assetId: 'gest-r'},
      ctx(),
    )

    expect(calls).toEqual([
      {
        op: 'set',
        path: 'gestureL',
        value: JSON.stringify({kind: 'lib', id: 'gest-l'}),
      },
      {
        op: 'set',
        path: 'gestureR',
        value: JSON.stringify({kind: 'lib', id: 'gest-r'}),
      },
    ])
  })

  test('无侧后缀的双手手势两侧都可用', async () => {
    const {registry, calls, mountFoo} = setup()
    mountFoo()

    await registry.execute(
      'poses.setGesture',
      {objectId: 'model:Foo', side: 'right', assetId: 'gest-dual'},
      ctx(),
    )
    expect(calls[0]).toMatchObject({op: 'set', path: 'gestureR'})
  })

  test('侧别不符 INVALID_ARGUMENT(左手势写到右侧)', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    await expect(
      registry.execute(
        'poses.setGesture',
        {objectId: 'model:Foo', side: 'right', assetId: 'gest-l'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('非手势条目(全身姿势)INVALID_ARGUMENT;assetId null 清空本侧', async () => {
    const {registry, calls, mountFoo} = setup()
    mountFoo()

    await expect(
      registry.execute(
        'poses.setGesture',
        {objectId: 'model:Foo', side: 'left', assetId: 'pose-1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})

    await registry.execute(
      'poses.setGesture',
      {objectId: 'model:Foo', side: 'left', assetId: null},
      ctx(),
    )
    expect(calls).toEqual([{op: 'set', path: 'gestureL', value: ''}])
  })

  test('资产不存在 ASSET_NOT_FOUND;side 非法 INVALID_ARGUMENT;gestureL 已建轨 INVALID_STATE', async () => {
    const {registry, fakeStudio, mountFoo} = setup({
      tracks: {
        trackIdByPropPath: {'["gestureL"]': 'track-gl'},
        keyframeValue: '',
      },
    })
    mountFoo()

    await expect(
      registry.execute(
        'poses.setGesture',
        {objectId: 'model:Foo', side: 'left', assetId: 'nope'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'ASSET_NOT_FOUND'})
    await expect(
      registry.execute(
        'poses.setGesture',
        {objectId: 'model:Foo', side: 'middle', assetId: 'gest-l'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute(
        'poses.setGesture',
        {objectId: 'model:Foo', side: 'left', assetId: 'gest-l'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })
})

describe('poses.clear', () => {
  test('无轨有静态:单事务只调 unsetValueOfPrimitiveProp,返回 cleared:true', async () => {
    const {registry, fakeStudio, calls, mountFoo} = setup()
    const obj = mountFoo()
    obj.initialValue = {pose: JSON.stringify({kind: 'lib', id: 'pose-1'})}

    const result = await registry.execute(
      'poses.clear',
      {objectId: 'model:Foo'},
      ctx(),
    )

    expect(fakeStudio.transaction).toHaveBeenCalledTimes(1)
    // 假 Studio 不落库,真实状态变化由 poses.realStudio.test.ts 验证
    expect(calls).toEqual([
      {
        op: 'unsetStatic',
        args: expect.objectContaining({
          objectKey: 'Foo',
          sheetId: 'Scene',
          pathToProp: ['pose'],
        }),
      },
    ])
    expect(result).toEqual({cleared: true, revision: 1})
  })

  test('已建轨:单个事务内先 setPrimitivePropAsStatic 再 unsetValueOfPrimitiveProp(一个撤销步骤)', async () => {
    const poseJson = JSON.stringify({kind: 'lib', id: 'pose-1'})
    const {registry, fakeStudio, calls, mountFoo} = setup({
      tracks: {
        trackIdByPropPath: {'["pose"]': 'track-pose'},
        keyframeValue: poseJson,
      },
    })
    mountFoo()

    const result = await registry.execute(
      'poses.clear',
      {objectId: 'model:Foo'},
      ctx(),
    )

    expect(fakeStudio.transaction).toHaveBeenCalledTimes(1)
    // value 是删轨时落下的当前求值(假 Studio 布景的初始态轨道不经求值
    // 器跑出帧值,这里只验调用形状;落值正确性由 realStudio 测试覆盖)
    expect(calls).toEqual([
      {
        op: 'setPrimitivePropAsStatic',
        args: expect.objectContaining({
          objectKey: 'Foo',
          pathToProp: ['pose'],
          value: expect.any(String),
        }),
      },
      {
        op: 'unsetStatic',
        args: expect.objectContaining({objectKey: 'Foo', pathToProp: ['pose']}),
      },
    ])
    expect(result).toEqual({cleared: true, revision: 1})
  })

  test('空姿势:不进事务,返回明确的 cleared:false 而非静默 no-op', async () => {
    const {registry, fakeStudio, mountFoo} = setup()
    mountFoo()

    const result = await registry.execute(
      'poses.clear',
      {objectId: 'model:Foo'},
      ctx(),
    )

    expect(result).toEqual({cleared: false, revision: 1})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('expectedRevision 冲突返回 REVISION_CONFLICT 且不进入事务', async () => {
    const {registry, fakeStudio, mountFoo, notifyHistoric} = setup()
    mountFoo()
    notifyHistoric()

    await expect(
      registry.execute(
        'poses.clear',
        {objectId: 'model:Foo', expectedRevision: 1},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('Studio 不可用返回 SCENE_UNAVAILABLE', async () => {
    const {registry, mountFoo} = setup()
    const obj = mountFoo()
    obj.initialValue = {pose: JSON.stringify({kind: 'lib', id: 'pose-1'})}
    activeFakeStudio = undefined

    await expect(
      registry.execute('poses.clear', {objectId: 'model:Foo'}, ctx()),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })
})

describe('poses.saveCurrent', () => {
  test('从 Scene Runtime 取得已挂载实例:capturePose 入库,返回新姿势条目', async () => {
    const {registry, library, mountFoo, boneInstance, setPlacementForFoo} =
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

    const result = (await registry.execute(
      'poses.saveCurrent',
      {objectId: 'model:Foo', name: '我的姿势'},
      ctx(),
    )) as {id: string; kind: string; name: string; rig: string; bones: unknown}

    expect(result).toMatchObject({
      kind: 'pose',
      name: '我的姿势',
      // rig 取库模型条目(GLB 洗骨骼名,实例重算可能不一致)
      rig: 'mixamo',
    })
    expect(result.bones).toHaveProperty('mixamorigHips')
    expect(library.putEntry).toHaveBeenCalledTimes(1)
    expect(backfillPoseThumbnails).toHaveBeenCalled()
  })

  test('省略名称时默认 姿势-N(库姿势数 + 1)', async () => {
    const {registry, mountFoo, boneInstance, setPlacementForFoo} = setup()
    mountFoo()
    setPlacementForFoo({
      entry: {
        key: 'Foo',
        libraryEntryId: 'model-1',
        position: {x: 0, y: 0, z: 0},
      },
      instance: boneInstance(),
    })

    // 库里已有 pose-1/gest-l/gest-r/gest-dual 四个姿势条目
    const result = (await registry.execute(
      'poses.saveCurrent',
      {objectId: 'model:Foo'},
      ctx(),
    )) as {name: string}
    expect(result.name).toBe('姿势-5')
  })

  test('实例未挂载 INVALID_STATE;Scene Runtime 未绑定 SCENE_UNAVAILABLE', async () => {
    const {registry, mountFoo} = setup()
    mountFoo()

    // handler 已绑定但返回 undefined(模型未挂载)
    await expect(
      registry.execute('poses.saveCurrent', {objectId: 'model:Foo'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})

    // handler 未绑定
    const bare = setup({bindPlacementHandler: false})
    bare.mountFoo()
    await expect(
      bare.registry.execute(
        'poses.saveCurrent',
        {objectId: 'model:Foo'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })

  test('静态骨架(无骨骼实例且无库 rig)INVALID_STATE,不入库', async () => {
    const {registry, library, mountFoo, setPlacementForFoo, core} = setup()
    mountFoo()
    const empty = new (require('three').Group)() as Group
    setPlacementForFoo({
      entry: {key: 'Foo', position: {x: 0, y: 0, z: 0}},
      instance: empty,
    })

    await expect(
      registry.execute('poses.saveCurrent', {objectId: 'model:Foo'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(library.putEntry).not.toHaveBeenCalled()
    void core
  })

  test('Library 配额错误映射 STORAGE_ERROR,不静默成功', async () => {
    const {
      registry,
      library,
      mountFoo,
      boneInstance,
      setPlacementForFoo,
      LibraryError,
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
    library.putEntry.mockRejectedValueOnce(
      new LibraryError('quota', '存储配额已满'),
    )

    await expect(
      registry.execute('poses.saveCurrent', {objectId: 'model:Foo'}, ctx()),
    ).rejects.toMatchObject({code: 'STORAGE_ERROR'})
  })
})

describe('poses.session', () => {
  test('start:进入会话并等 Rig 挂载兑现;期间 promise 保持 pending', async () => {
    const {
      registry,
      mountFoo,
      boneInstance,
      setPlacementForFoo,
      poseSession,
      registerRig,
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

    let settled = false
    const promise = registry
      .execute('poses.session.start', {objectId: 'model:Foo'}, ctx())
      .then((r) => {
        settled = true
        return r
      })

    // 同步段已进会话;Rig 未登记前不兑现
    expect(poseSession.getPoseSession()).toEqual({key: 'Foo'})
    await Promise.resolve()
    expect(settled).toBe(false)

    registerRig('Foo', {commit: () => {}, cancel: () => {}})
    await expect(promise).resolves.toMatchObject({objectId: 'model:Foo'})
  })

  test('start:Rig 未能挂载(会话被清)拒绝 INVALID_STATE,不悬挂', async () => {
    const {registry, mountFoo, boneInstance, setPlacementForFoo, poseSession} =
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

    const promise = registry.execute(
      'poses.session.start',
      {objectId: 'model:Foo'},
      ctx(),
    )
    expect(poseSession.getPoseSession()).toEqual({key: 'Foo'})
    // 模拟 PoseModeRig 防御路径(无根骨/无装配表):直接清会话
    poseSession.clearPoseSession()
    await expect(promise).rejects.toMatchObject({code: 'INVALID_STATE'})
  })

  test('start:模型实例未挂载 INVALID_STATE;handler 未绑定 SCENE_UNAVAILABLE;类型不符 INVALID_ID_KIND', async () => {
    const {registry, mountFoo, boneInstance, setPlacementForFoo} = setup()
    mountFoo()

    await expect(
      registry.execute('poses.session.start', {objectId: 'model:Foo'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})

    setPlacementForFoo({
      entry: {
        key: 'Foo',
        libraryEntryId: 'model-1',
        position: {x: 0, y: 0, z: 0},
      },
      instance: boneInstance(),
    })
    await expect(
      registry.execute('poses.session.start', {objectId: 'camera:Foo'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})

    // handler 未绑定
    const bare = setup({bindPlacementHandler: false})
    bare.mountFoo()
    await expect(
      bare.registry.execute(
        'poses.session.start',
        {objectId: 'model:Foo'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })

  test('start:同键会话已激活且 Rig 已登记时立即兑现(幂等)', async () => {
    const {
      registry,
      mountFoo,
      boneInstance,
      setPlacementForFoo,
      poseSession,
      registerRig,
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
    poseSession.enterPoseSession('Foo')
    registerRig('Foo', {commit: () => {}, cancel: () => {}})

    await expect(
      registry.execute('poses.session.start', {objectId: 'model:Foo'}, ctx()),
    ).resolves.toMatchObject({objectId: 'model:Foo'})
  })

  test('commit/cancel:调用 PoseModeRig 登记的句柄;返回会话对象 ID', async () => {
    const {registry, poseSession, registerRig} = setup()
    poseSession.enterPoseSession('Foo')
    const commit = jest.fn(() => poseSession.clearPoseSession())
    const cancel = jest.fn(() => poseSession.clearPoseSession())
    registerRig('Foo', {commit, cancel})

    await expect(
      registry.execute('poses.session.commit', {}, ctx()),
    ).resolves.toEqual({objectId: 'model:Foo'})
    expect(commit).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()

    poseSession.enterPoseSession('Foo')
    await expect(
      registry.execute('poses.session.cancel', {}, ctx()),
    ).resolves.toEqual({objectId: 'model:Foo'})
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  test('commit/cancel:无会话 INVALID_STATE;会话在但 Rig 未登记 INVALID_STATE', async () => {
    const {registry, poseSession} = setup()

    await expect(
      registry.execute('poses.session.commit', {}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    await expect(
      registry.execute('poses.session.cancel', {}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})

    poseSession.enterPoseSession('Foo')
    await expect(
      registry.execute('poses.session.commit', {}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    await expect(
      registry.execute('poses.session.cancel', {}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })
})

describe('会话生命周期', () => {
  test('dispose 后命令拒绝 API_DISPOSED', async () => {
    const {registry, runtime, mountFoo} = setup()
    mountFoo()
    runtime.dispose()

    await expect(
      registry.execute(
        'poses.apply',
        {objectId: 'model:Foo', assetId: 'pose-1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
    await expect(
      registry.execute('poses.session.commit', {}, ctx()),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
  })
})
