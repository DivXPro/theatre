/**
 * cameras 命令(2026-10-17,Task 10):create / setActive / setAimTarget /
 * bindPath / unbindPath。
 *
 * 布景同 poses.test.ts / objects.test.ts:真实 core project/sheet,
 * jest-esbuild 不提升 jest.mock —— doMock 挂模块顶层 + 晚绑定
 * activeFakeStudio(`@dreamerbird/core` 的 getStudioSync,setStaticProps
 * 静态写入通道),transaction 记录 set 调用。
 *
 * create 的 Scene Runtime createCamera handler 用假实现(同步写 Cameras
 * 注册表条目并返回 key,形状与接线后的 CameraScene 绑定一致);挂载完成由
 * 测试手动模拟:登记 SheetObject 到 objectRuntime,然后
 * notifyCameraReady(key)。命令 promise 在 notify 前必须保持 pending;
 * 挂载登记缺失(注册表有、运行时无)不得静默成功(INTERNAL_ERROR)。
 */
import type {ISheetObject} from '@dreamerbird/core'
import type {CommandContext, Vec3} from '../types'

let projectSeq = 0

/** 晚绑定:doMock 工厂只跑一次,setStaticProps 读当前 setup 的 studio */
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

/** 真实 macrotask 冲刷 */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const CAMERA_KEY = 'Shot Camera'
const POSITION: Vec3 = {x: 1, y: 2, z: 3}
const ROTATION: Vec3 = {x: 0.1, y: 0.2, z: 0}

type SetupOptions = {
  /** 预建轨:trackIdByPropPath(encodePathToProp 键 → trackId)+ 帧值 */
  tracks?: {trackIdByPropPath: Record<string, string>; keyframeValue: unknown}
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
  const cameraLifecycle =
    require('../runtime/cameraLifecycle') as typeof import('../runtime/cameraLifecycle')
  const {registerCameraCommands} =
    require('./cameras') as typeof import('./cameras')
  const {CAMERAS_REGISTRY_KEY} =
    require('../../cameraRegistry') as typeof import('../../cameraRegistry')
  const {PATHS_REGISTRY_KEY} =
    require('../../pathRegistry') as typeof import('../../pathRegistry')
  const {ANCHORS_REGISTRY_KEY} =
    require('../../anchorsRegistry') as typeof import('../../anchorsRegistry')
  const {PLACEMENTS_REGISTRY_KEY} =
    require('../../PlacementManager') as typeof import('../../PlacementManager')

  /** 事务 set 调用记录(path + value) */
  const setCalls: Array<{path: string; value: unknown}> = []
  const fakeStudio = {
    transaction: jest.fn(
      (
        fn: (tools: {set: (pointer: unknown, value: unknown) => void}) => void,
      ) =>
        fn({
          set: (pointer: unknown, value: unknown) => {
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
                [CAMERA_KEY]: {
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
  const project = core.getProject(`agent-cameras-${++projectSeq}`, {
    state: state as never,
  })
  const sheet = project.sheet('Scene')
  const library = {getEntry: jest.fn(async () => undefined)}

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
  registerCameraCommands(registry, runtime)

  const t = core.types

  /** 写 Cameras 注册表清单(每个 sheet 只写一次;模拟 addCameraToRegistry) */
  function writeCamerasRegistry(keys: string[]) {
    const registryObj = sheet.object(
      CAMERAS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify(keys.map((cameraKey) => ({cameraKey}))),
    }
  }

  /** 布景:相机 SheetObject(含 aimTarget/pathKey 属性)并登记 camera:<key> */
  function mountCamera(key: string = CAMERA_KEY) {
    const obj = sheet.object(key, {
      position: t.compound({x: t.number(1), y: t.number(2), z: t.number(3)}),
      rotation: t.compound({x: t.number(0), y: t.number(0), z: t.number(0)}),
      fov: t.number(50),
      aimTarget: t.string(''),
      pathKey: t.string(''),
    }) as ISheetObject<any>
    const id = `camera:${key}` as const
    objectRuntime.registerSceneSheetObject(id, obj)
    cleanups.push(() => objectRuntime.unregisterSceneSheetObject(id, obj))
    return obj
  }

  /** 布景:Paths 注册表写一条路径条目(bindPath 的存在性底账) */
  function writePathsRegistry(keys: string[]) {
    const registryObj = sheet.object(
      PATHS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify(keys.map((pathKey) => ({pathKey}))),
    }
  }

  /** 布景:Anchors 注册表写一个锚点(aim target 的存在性底账) */
  function writeAnchorsRegistry(keys: string[]) {
    const registryObj = sheet.object(
      ANCHORS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {list: JSON.stringify(keys)}
  }

  /** 布景:Placements 注册表写一个模型(bone: 目标的放置存在性底账) */
  function writePlacementsRegistry(keys: string[]) {
    const registryObj = sheet.object(
      PLACEMENTS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify(
        keys.map((key) => ({key, position: {x: 0, y: 0, z: 0}})),
      ),
    }
  }

  /** 假 createCamera handler:同步写注册表条目并返回 key(同生产绑定形状) */
  function bindCreateCamera(key: string = CAMERA_KEY) {
    const createCamera = jest.fn((_args: {seed?: unknown}) => {
      writeCamerasRegistry([key])
      return {key}
    })
    cleanups.push(runtime.bindHandlers({createCamera}))
    return createCamera
  }

  return {
    core,
    sheet,
    runtime,
    registry,
    fakeStudio,
    setCalls,
    cameraLifecycle,
    mountCamera,
    writeCamerasRegistry,
    writePathsRegistry,
    writeAnchorsRegistry,
    writePlacementsRegistry,
    bindCreateCamera,
    notifyHistoric: () => notifyHistoric(),
  }
}

/** 等命令推进到 createCamera 已调用(即已 parked 在挂载 waiter 上) */
async function untilCalled(mock: jest.Mock) {
  for (let i = 0; i < 50 && mock.mock.calls.length === 0; i++) {
    await tick()
  }
  expect(mock).toHaveBeenCalled()
}

describe('cameras 注册与元数据', () => {
  test('五条命令全部注册;create 是项目单步 mutation(completion:mounted)', () => {
    const {registry} = setup()
    for (const name of [
      'cameras.create',
      'cameras.setActive',
      'cameras.setAimTarget',
      'cameras.bindPath',
      'cameras.unbindPath',
    ]) {
      expect(registry.has(name)).toBe(true)
    }
    const described = new Map(
      registry.describe().commands.map((c) => [c.name, c]),
    )
    expect(described.get('cameras.create')).toMatchObject({
      kind: 'mutation',
      stateDomain: 'project',
      undoable: 'single-step',
      completion: 'mounted',
      acceptsExpectedRevision: true,
    })
    // setActive 是会话命令:不用项目 revision 伪装并发(spec 8.5)
    expect(described.get('cameras.setActive')).toMatchObject({
      kind: 'mutation',
      stateDomain: 'session',
      undoable: 'none',
      acceptsExpectedRevision: false,
    })
    for (const name of [
      'cameras.setAimTarget',
      'cameras.bindPath',
      'cameras.unbindPath',
    ]) {
      expect(described.get(name)).toMatchObject({
        stateDomain: 'project',
        undoable: 'single-step',
        acceptsExpectedRevision: true,
      })
    }
  })
})

describe('cameras.create 完成语义', () => {
  test('fromCurrentView:handler 收不到 seed;notify 前 pending,挂载完成后返回 camera:<key>', async () => {
    const {
      registry,
      runtime,
      cameraLifecycle,
      mountCamera,
      notifyHistoric,
      bindCreateCamera,
    } = setup()
    const createCamera = bindCreateCamera()

    let resolved = false
    const promise = registry
      .execute('cameras.create', {fromCurrentView: true}, ctx())
      .then((result) => {
        resolved = true
        return result
      })

    await untilCalled(createCamera)
    // fromCurrentView:种子由 Scene Runtime 侧从导演视角捕获,命令不传
    expect(createCamera).toHaveBeenCalledWith({})
    expect(cameraLifecycle.hasCameraWaiter(CAMERA_KEY)).toBe(true)
    await tick()
    expect(resolved).toBe(false)

    // 模拟挂载:SheetObject 登记 + seed layout effect 结束通知
    mountCamera()
    notifyHistoric()
    cameraLifecycle.notifyCameraReady(CAMERA_KEY)

    await expect(promise).resolves.toEqual({
      objectId: `camera:${CAMERA_KEY}`,
      revision: 2,
    })
  })

  test('显式 transform:传入值作为种子交给 handler', async () => {
    const {registry, cameraLifecycle, mountCamera, bindCreateCamera} = setup()
    const createCamera = bindCreateCamera()

    const promise = registry.execute(
      'cameras.create',
      {transform: {position: POSITION, rotation: ROTATION}},
      ctx(),
    )
    await untilCalled(createCamera)
    expect(createCamera).toHaveBeenCalledWith({
      seed: {position: POSITION, rotation: ROTATION},
    })
    mountCamera()
    cameraLifecycle.notifyCameraReady(CAMERA_KEY)
    await expect(promise).resolves.toMatchObject({
      objectId: `camera:${CAMERA_KEY}`,
    })
  })

  test('fromCurrentView 与 transform 互斥;两者都缺 → INVALID_ARGUMENT,不调用 handler', async () => {
    const {registry, bindCreateCamera} = setup()
    const createCamera = bindCreateCamera()
    await expect(
      registry.execute(
        'cameras.create',
        {
          fromCurrentView: true,
          transform: {position: POSITION, rotation: ROTATION},
        },
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute('cameras.create', {}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(createCamera).not.toHaveBeenCalled()
  })

  test('Scene Runtime 未绑定 createCamera → SCENE_UNAVAILABLE', async () => {
    const {registry} = setup()
    await expect(
      registry.execute('cameras.create', {fromCurrentView: true}, ctx()),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })

  test('expectedRevision 冲突 → REVISION_CONFLICT,先于任何副作用', async () => {
    const {registry, notifyHistoric, bindCreateCamera} = setup()
    const createCamera = bindCreateCamera()
    notifyHistoric()

    await expect(
      registry.execute(
        'cameras.create',
        {fromCurrentView: true, expectedRevision: 1},
        ctx(),
      ),
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      details: {expectedRevision: 1, actualRevision: 2},
    })
    expect(createCamera).not.toHaveBeenCalled()
  })

  test('挂载通知已到但 SheetObject 未登记 → INTERNAL_ERROR(不静默成功)', async () => {
    const {registry, cameraLifecycle, bindCreateCamera} = setup()
    const createCamera = bindCreateCamera()

    const promise = registry.execute(
      'cameras.create',
      {fromCurrentView: true},
      ctx(),
    )
    await untilCalled(createCamera)
    // 只通知,不登记运行时 SheetObject —— resolver 报 mounted:false
    cameraLifecycle.notifyCameraReady(CAMERA_KEY)

    await expect(promise).rejects.toMatchObject({code: 'INTERNAL_ERROR'})
  })

  test('挂载 waiter 被拒绝(组件未就绪即卸载)→ INTERNAL_ERROR', async () => {
    const {registry, cameraLifecycle, bindCreateCamera} = setup()
    const createCamera = bindCreateCamera()

    const promise = registry.execute(
      'cameras.create',
      {fromCurrentView: true},
      ctx(),
    )
    await untilCalled(createCamera)
    cameraLifecycle.rejectCameraMount(CAMERA_KEY, new Error('组件未就绪即卸载'))
    await expect(promise).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      details: expect.objectContaining({cause: '组件未就绪即卸载'}),
    })
  })

  test('挂载期间 API dispose → API_DISPOSED(dispose 优先于挂载失败)', async () => {
    const {registry, runtime, cameraLifecycle, bindCreateCamera} = setup()
    const createCamera = bindCreateCamera()

    const promise = registry.execute(
      'cameras.create',
      {fromCurrentView: true},
      ctx(),
    )
    await untilCalled(createCamera)
    runtime.dispose()
    cameraLifecycle.rejectCameraMount(CAMERA_KEY, new Error('场景已卸载'))
    await expect(promise).rejects.toMatchObject({code: 'API_DISPOSED'})
  })

  test('会话销毁后调用 → API_DISPOSED', async () => {
    const {registry, runtime} = setup()
    runtime.dispose()
    await expect(
      registry.execute('cameras.create', {fromCurrentView: true}, ctx()),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
  })
})

describe('cameras.setActive', () => {
  test('已登记相机:经 Scene Runtime setActiveCamera 设为活动', async () => {
    const {registry, runtime, writeCamerasRegistry} = setup()
    writeCamerasRegistry([CAMERA_KEY])
    const setActiveCamera = jest.fn()
    cleanups.push(runtime.bindHandlers({setActiveCamera}))

    await expect(
      registry.execute(
        'cameras.setActive',
        {objectId: `camera:${CAMERA_KEY}`},
        ctx(),
      ),
    ).resolves.toBeUndefined()
    expect(setActiveCamera).toHaveBeenCalledWith({cameraKey: CAMERA_KEY})
  })

  test('相机不存在 → OBJECT_NOT_FOUND;类型不符 → INVALID_ID_KIND', async () => {
    const {registry, runtime, writeCamerasRegistry} = setup()
    writeCamerasRegistry([CAMERA_KEY])
    const setActiveCamera = jest.fn()
    cleanups.push(runtime.bindHandlers({setActiveCamera}))

    await expect(
      registry.execute('cameras.setActive', {objectId: 'camera:Nope'}, ctx()),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    await expect(
      registry.execute('cameras.setActive', {objectId: 'model:Foo'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    expect(setActiveCamera).not.toHaveBeenCalled()
  })

  test('Scene Runtime 未绑定 setActiveCamera → SCENE_UNAVAILABLE', async () => {
    const {registry, writeCamerasRegistry} = setup()
    writeCamerasRegistry([CAMERA_KEY])
    await expect(
      registry.execute(
        'cameras.setActive',
        {objectId: `camera:${CAMERA_KEY}`},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })
})

describe('cameras.setAimTarget', () => {
  test('绑定锚点目标:单事务写 aimTarget,返回 revision', async () => {
    const {
      registry,
      mountCamera,
      writeCamerasRegistry,
      writeAnchorsRegistry,
      setCalls,
      notifyHistoric,
    } = setup()
    writeCamerasRegistry([CAMERA_KEY])
    writeAnchorsRegistry(['Anchor 1'])
    mountCamera()
    notifyHistoric()

    await expect(
      registry.execute(
        'cameras.setAimTarget',
        {objectId: `camera:${CAMERA_KEY}`, target: 'anchor:Anchor 1'},
        ctx(),
      ),
    ).resolves.toEqual({revision: 2})
    expect(setCalls).toEqual([{path: 'aimTarget', value: 'anchor:Anchor 1'}])
  })

  test('target 为空串 = 解除瞄准;骨骼锚点目标要求放置模型存在', async () => {
    const {
      registry,
      mountCamera,
      writeCamerasRegistry,
      writePlacementsRegistry,
      setCalls,
    } = setup()
    writeCamerasRegistry([CAMERA_KEY])
    writePlacementsRegistry(['Y Bot'])
    mountCamera()

    await expect(
      registry.execute(
        'cameras.setAimTarget',
        {objectId: `camera:${CAMERA_KEY}`, target: 'bone:Y Bot#head'},
        ctx(),
      ),
    ).resolves.toEqual({revision: 1})
    await expect(
      registry.execute(
        'cameras.setAimTarget',
        {objectId: `camera:${CAMERA_KEY}`, target: ''},
        ctx(),
      ),
    ).resolves.toEqual({revision: 1})
    expect(setCalls.map((c) => c.value)).toEqual(['bone:Y Bot#head', ''])
  })

  test('无效目标:无类型前缀 → INVALID_ID_KIND;锚点/骨骼放置不存在 → OBJECT_NOT_FOUND;均不写 props', async () => {
    const {registry, mountCamera, writeCamerasRegistry, fakeStudio} = setup()
    writeCamerasRegistry([CAMERA_KEY])
    mountCamera()

    await expect(
      registry.execute(
        'cameras.setAimTarget',
        {objectId: `camera:${CAMERA_KEY}`, target: 'Anchor 1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    await expect(
      registry.execute(
        'cameras.setAimTarget',
        {objectId: `camera:${CAMERA_KEY}`, target: 'anchor:Ghost'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    await expect(
      registry.execute(
        'cameras.setAimTarget',
        {objectId: `camera:${CAMERA_KEY}`, target: 'bone:Ghost#head'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('骨骼 id 部位非法 → INVALID_ID_KIND;模型/相机目标不在瞄准支持集 → INVALID_ARGUMENT', async () => {
    const {
      registry,
      mountCamera,
      writeCamerasRegistry,
      writePlacementsRegistry,
      fakeStudio,
    } = setup()
    writeCamerasRegistry([CAMERA_KEY])
    writePlacementsRegistry(['Y Bot'])
    mountCamera()

    await expect(
      registry.execute(
        'cameras.setAimTarget',
        {objectId: `camera:${CAMERA_KEY}`, target: 'bone:Y Bot#pinky'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    // UI 的瞄准选项只有锚点/骨骼锚点(stringLiteral 字面量集),其余类型拒绝
    await expect(
      registry.execute(
        'cameras.setAimTarget',
        {objectId: `camera:${CAMERA_KEY}`, target: 'model:Y Bot'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('objectId 类型不符 → INVALID_ID_KIND;相机未挂载 → INVALID_STATE', async () => {
    const {registry, writeCamerasRegistry, writeAnchorsRegistry} = setup()
    writeCamerasRegistry([CAMERA_KEY])
    writeAnchorsRegistry(['Anchor 1'])

    await expect(
      registry.execute(
        'cameras.setAimTarget',
        {objectId: 'anchor:Anchor 1', target: 'anchor:Anchor 1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    // 注册表有条目但未挂载
    await expect(
      registry.execute(
        'cameras.setAimTarget',
        {objectId: `camera:${CAMERA_KEY}`, target: 'anchor:Anchor 1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })

  test('aimTarget 已建轨 → INVALID_STATE,不写 props', async () => {
    const {
      registry,
      mountCamera,
      writeCamerasRegistry,
      writeAnchorsRegistry,
      fakeStudio,
    } = setup({
      tracks: {
        trackIdByPropPath: {'["aimTarget"]': 'track-aim'},
        keyframeValue: '',
      },
    })
    writeCamerasRegistry([CAMERA_KEY])
    writeAnchorsRegistry(['Anchor 1'])
    mountCamera()

    await expect(
      registry.execute(
        'cameras.setAimTarget',
        {objectId: `camera:${CAMERA_KEY}`, target: 'anchor:Anchor 1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('expectedRevision 冲突 → REVISION_CONFLICT,不写 props', async () => {
    const {
      registry,
      mountCamera,
      writeCamerasRegistry,
      writeAnchorsRegistry,
      fakeStudio,
      notifyHistoric,
    } = setup()
    writeCamerasRegistry([CAMERA_KEY])
    writeAnchorsRegistry(['Anchor 1'])
    mountCamera()
    notifyHistoric()

    await expect(
      registry.execute(
        'cameras.setAimTarget',
        {
          objectId: `camera:${CAMERA_KEY}`,
          target: 'anchor:Anchor 1',
          expectedRevision: 1,
        },
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })
})

describe('cameras.bindPath / unbindPath', () => {
  test('bindPath:路径存在 → 单事务写 pathKey;unbindPath 写空串', async () => {
    const {
      registry,
      mountCamera,
      writeCamerasRegistry,
      writePathsRegistry,
      setCalls,
    } = setup()
    writeCamerasRegistry([CAMERA_KEY])
    writePathsRegistry(['Path 1'])
    mountCamera()

    await expect(
      registry.execute(
        'cameras.bindPath',
        {objectId: `camera:${CAMERA_KEY}`, pathId: 'path:Path 1'},
        ctx(),
      ),
    ).resolves.toEqual({revision: 1})
    await expect(
      registry.execute(
        'cameras.unbindPath',
        {objectId: `camera:${CAMERA_KEY}`},
        ctx(),
      ),
    ).resolves.toEqual({revision: 1})
    expect(setCalls).toEqual([
      {path: 'pathKey', value: 'Path 1'},
      {path: 'pathKey', value: ''},
    ])
  })

  test('被绑定路径不存在 → OBJECT_NOT_FOUND;pathId 类型错误 → INVALID_ID_KIND;不写 props', async () => {
    const {registry, mountCamera, writeCamerasRegistry, fakeStudio} = setup()
    writeCamerasRegistry([CAMERA_KEY])
    mountCamera()

    await expect(
      registry.execute(
        'cameras.bindPath',
        {objectId: `camera:${CAMERA_KEY}`, pathId: 'path:Ghost'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    await expect(
      registry.execute(
        'cameras.bindPath',
        {objectId: `camera:${CAMERA_KEY}`, pathId: 'model:Foo'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    await expect(
      registry.execute(
        'cameras.bindPath',
        {objectId: `camera:${CAMERA_KEY}`, pathId: 'Path 1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('objectId 不是相机 → INVALID_ID_KIND;相机未挂载 → INVALID_STATE', async () => {
    const {registry, writeCamerasRegistry, writePathsRegistry} = setup()
    writeCamerasRegistry([CAMERA_KEY])
    writePathsRegistry(['Path 1'])

    await expect(
      registry.execute(
        'cameras.bindPath',
        {objectId: 'path:Path 1', pathId: 'path:Path 1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    await expect(
      registry.execute(
        'cameras.bindPath',
        {objectId: `camera:${CAMERA_KEY}`, pathId: 'path:Path 1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    await expect(
      registry.execute(
        'cameras.unbindPath',
        {objectId: `camera:${CAMERA_KEY}`},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })

  test('pathKey 已建轨 → INVALID_STATE;expectedRevision 冲突 → REVISION_CONFLICT', async () => {
    const sequenced = setup({
      tracks: {
        trackIdByPropPath: {'["pathKey"]': 'track-path'},
        keyframeValue: '',
      },
    })
    sequenced.writeCamerasRegistry([CAMERA_KEY])
    sequenced.writePathsRegistry(['Path 1'])
    sequenced.mountCamera()

    await expect(
      sequenced.registry.execute(
        'cameras.bindPath',
        {objectId: `camera:${CAMERA_KEY}`, pathId: 'path:Path 1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(sequenced.fakeStudio.transaction).not.toHaveBeenCalled()

    const conflicted = setup()
    conflicted.writeCamerasRegistry([CAMERA_KEY])
    conflicted.writePathsRegistry(['Path 1'])
    conflicted.mountCamera()
    conflicted.notifyHistoric()
    await expect(
      conflicted.registry.execute(
        'cameras.unbindPath',
        {objectId: `camera:${CAMERA_KEY}`, expectedRevision: 1},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
    expect(conflicted.fakeStudio.transaction).not.toHaveBeenCalled()
  })
})
