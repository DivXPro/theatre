/**
 * anchors 命令(2026-10-17,Task 10):create / setParent / clearParent。
 *
 * 布景同 cameras.test.ts:真实 core project/sheet + doMock 晚绑定假
 * Studio(setStaticProps 写入通道,transaction 记录 set 调用)。
 * create 的 Scene Runtime createAnchor handler 用假实现(同步写 Anchors
 * 注册表条目并返回 key);挂载完成由测试手动模拟(登记 SheetObject +
 * notifyAnchorReady)。
 *
 * 父级目标校验:自身/成环 → INVALID_ARGUMENT;无类型前缀 →
 * INVALID_ID_KIND;目标不存在 → OBJECT_NOT_FOUND;世界/局部换算由
 * AnchorObject 的既有 effect 在 parent 属性变化后完成(命令只写属性)。
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

const ANCHOR_KEY = 'Anchor 1'
const POSITION: Vec3 = {x: 4, y: 1, z: -2}

type SetupOptions = {
  /** 预建轨:trackIdByPropPath(encodePathToProp 键 → trackId)+ 帧值 */
  tracks?: {trackIdByPropPath: Record<string, string>; keyframeValue: unknown}
  /** 建轨归属的对象 key(默认 Anchor 1) */
  trackObjectKey?: string
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
  const {registerAnchorCommands} =
    require('./anchors') as typeof import('./anchors')
  const {ANCHORS_REGISTRY_KEY} =
    require('../../anchorsRegistry') as typeof import('../../anchorsRegistry')
  const {CAMERAS_REGISTRY_KEY} =
    require('../../cameraRegistry') as typeof import('../../cameraRegistry')
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
  const trackObjectKey = options.trackObjectKey ?? ANCHOR_KEY
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
                [trackObjectKey]: {
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
  const project = core.getProject(`agent-anchors-${++projectSeq}`, {
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
  registerAnchorCommands(registry, runtime)

  const t = core.types

  /** 写 Anchors 注册表清单(模拟 addAnchorToRegistry) */
  function writeAnchorsRegistry(keys: string[]) {
    const registryObj = sheet.object(
      ANCHORS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {list: JSON.stringify(keys)}
  }

  /** 布景:锚点 SheetObject(position/parent)并登记 anchor:<key> */
  function mountAnchor(key: string = ANCHOR_KEY, parent = '') {
    const obj = sheet.object(key, {
      position: t.compound({x: t.number(0), y: t.number(1), z: t.number(0)}),
      parent: t.string(''),
    }) as ISheetObject<any>
    if (parent) obj.initialValue = {parent}
    const id = `anchor:${key}` as const
    objectRuntime.registerSceneSheetObject(id, obj)
    cleanups.push(() => objectRuntime.unregisterSceneSheetObject(id, obj))
    return obj
  }

  /** 布景:Cameras 注册表写一台相机(父级目标存在性底账) */
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

  /** 布景:Placements 注册表写一个模型(model:/bone: 目标存在性底账) */
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

  /** 假 createAnchor handler:同步写注册表条目并返回 key(同生产绑定形状) */
  function bindCreateAnchor(key: string = ANCHOR_KEY) {
    const createAnchor = jest.fn((_args: {position?: Vec3}) => {
      writeAnchorsRegistry([key])
      return {key}
    })
    cleanups.push(runtime.bindHandlers({createAnchor}))
    return createAnchor
  }

  return {
    sheet,
    runtime,
    registry,
    fakeStudio,
    setCalls,
    cameraLifecycle,
    mountAnchor,
    writeAnchorsRegistry,
    writeCamerasRegistry,
    writePlacementsRegistry,
    bindCreateAnchor,
    notifyHistoric: () => notifyHistoric(),
  }
}

/** 等命令推进到 createAnchor 已调用(即已 parked 在挂载 waiter 上) */
async function untilCalled(mock: jest.Mock) {
  for (let i = 0; i < 50 && mock.mock.calls.length === 0; i++) {
    await tick()
  }
  expect(mock).toHaveBeenCalled()
}

describe('anchors 注册与元数据', () => {
  test('三条命令全部注册;create 是项目单步 mutation(completion:mounted)', () => {
    const {registry} = setup()
    for (const name of [
      'anchors.create',
      'anchors.setParent',
      'anchors.clearParent',
    ]) {
      expect(registry.has(name)).toBe(true)
    }
    const described = new Map(
      registry.describe().commands.map((c) => [c.name, c]),
    )
    expect(described.get('anchors.create')).toMatchObject({
      kind: 'mutation',
      stateDomain: 'project',
      undoable: 'single-step',
      completion: 'mounted',
      acceptsExpectedRevision: true,
    })
    for (const name of ['anchors.setParent', 'anchors.clearParent']) {
      expect(described.get(name)).toMatchObject({
        stateDomain: 'project',
        undoable: 'single-step',
        acceptsExpectedRevision: true,
      })
    }
  })
})

describe('anchors.create 完成语义', () => {
  test('默认定位:handler 收不到 position;notify 前 pending,挂载后返回 anchor:<key>', async () => {
    const {
      registry,
      cameraLifecycle,
      mountAnchor,
      notifyHistoric,
      bindCreateAnchor,
    } = setup()
    const createAnchor = bindCreateAnchor()

    let resolved = false
    const promise = registry
      .execute('anchors.create', {}, ctx())
      .then((result) => {
        resolved = true
        return result
      })

    await untilCalled(createAnchor)
    // 缺省位置由 Scene Runtime 侧按导演前方 5 单位计算,命令不传
    expect(createAnchor).toHaveBeenCalledWith({})
    expect(cameraLifecycle.hasAnchorWaiter(ANCHOR_KEY)).toBe(true)
    await tick()
    expect(resolved).toBe(false)

    mountAnchor()
    notifyHistoric()
    cameraLifecycle.notifyAnchorReady(ANCHOR_KEY)

    await expect(promise).resolves.toEqual({
      objectId: `anchor:${ANCHOR_KEY}`,
      revision: 2,
    })
  })

  test('显式 position:原样交给 handler', async () => {
    const {registry, cameraLifecycle, mountAnchor, bindCreateAnchor} = setup()
    const createAnchor = bindCreateAnchor()

    const promise = registry.execute(
      'anchors.create',
      {position: POSITION},
      ctx(),
    )
    await untilCalled(createAnchor)
    expect(createAnchor).toHaveBeenCalledWith({position: POSITION})
    mountAnchor()
    cameraLifecycle.notifyAnchorReady(ANCHOR_KEY)
    await expect(promise).resolves.toMatchObject({
      objectId: `anchor:${ANCHOR_KEY}`,
    })
  })

  test('非法 position(NaN/缺维度)→ INVALID_ARGUMENT,不调用 handler', async () => {
    const {registry, bindCreateAnchor} = setup()
    const createAnchor = bindCreateAnchor()
    await expect(
      registry.execute(
        'anchors.create',
        {position: {x: Number.NaN, y: 0, z: 0}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute('anchors.create', {position: {x: 1, y: 2}}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(createAnchor).not.toHaveBeenCalled()
  })

  test('Scene Runtime 未绑定 createAnchor → SCENE_UNAVAILABLE', async () => {
    const {registry} = setup()
    await expect(
      registry.execute('anchors.create', {}, ctx()),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })

  test('expectedRevision 冲突 → REVISION_CONFLICT,先于任何副作用', async () => {
    const {registry, notifyHistoric, bindCreateAnchor} = setup()
    const createAnchor = bindCreateAnchor()
    notifyHistoric()

    await expect(
      registry.execute('anchors.create', {expectedRevision: 1}, ctx()),
    ).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
    expect(createAnchor).not.toHaveBeenCalled()
  })

  test('挂载通知已到但 SheetObject 未登记 → INTERNAL_ERROR(不静默成功)', async () => {
    const {registry, cameraLifecycle, bindCreateAnchor} = setup()
    const createAnchor = bindCreateAnchor()

    const promise = registry.execute('anchors.create', {}, ctx())
    await untilCalled(createAnchor)
    cameraLifecycle.notifyAnchorReady(ANCHOR_KEY)

    await expect(promise).rejects.toMatchObject({code: 'INTERNAL_ERROR'})
  })

  test('会话销毁后调用 → API_DISPOSED', async () => {
    const {registry, runtime} = setup()
    runtime.dispose()
    await expect(
      registry.execute('anchors.create', {}, ctx()),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
  })
})

describe('anchors.setParent', () => {
  test('绑定另一锚点:单事务写 parent,返回 revision', async () => {
    const {
      registry,
      mountAnchor,
      writeAnchorsRegistry,
      setCalls,
      notifyHistoric,
    } = setup()
    writeAnchorsRegistry([ANCHOR_KEY, 'Anchor 2'])
    mountAnchor()
    notifyHistoric()

    await expect(
      registry.execute(
        'anchors.setParent',
        {objectId: `anchor:${ANCHOR_KEY}`, parent: 'anchor:Anchor 2'},
        ctx(),
      ),
    ).resolves.toEqual({revision: 2})
    expect(setCalls).toEqual([{path: 'parent', value: 'anchor:Anchor 2'}])
  })

  test('支持的目标类型:model / camera / bone(骨骼锚点要求放置模型存在)', async () => {
    const {
      registry,
      mountAnchor,
      writeAnchorsRegistry,
      writeCamerasRegistry,
      writePlacementsRegistry,
      setCalls,
    } = setup()
    writeAnchorsRegistry([ANCHOR_KEY])
    writeCamerasRegistry(['Shot Camera'])
    writePlacementsRegistry(['Y Bot'])
    mountAnchor()

    for (const parent of [
      'model:Y Bot',
      'camera:Shot Camera',
      'bone:Y Bot#chest',
    ]) {
      await expect(
        registry.execute(
          'anchors.setParent',
          {objectId: `anchor:${ANCHOR_KEY}`, parent},
          ctx(),
        ),
      ).resolves.toEqual({revision: 1})
    }
    expect(setCalls.map((c) => c.value)).toEqual([
      'model:Y Bot',
      'camera:Shot Camera',
      'bone:Y Bot#chest',
    ])
  })

  test('自身为父 → INVALID_ARGUMENT;父链成环 → INVALID_ARGUMENT;均不写 props', async () => {
    const {registry, mountAnchor, writeAnchorsRegistry, fakeStudio} = setup()
    writeAnchorsRegistry([ANCHOR_KEY, 'Anchor 2'])
    mountAnchor()
    // Anchor 2 已挂在 Anchor 1 下:再把 Anchor 1 挂到 Anchor 2 即成环
    mountAnchor('Anchor 2', `anchor:${ANCHOR_KEY}`)

    await expect(
      registry.execute(
        'anchors.setParent',
        {objectId: `anchor:${ANCHOR_KEY}`, parent: `anchor:${ANCHOR_KEY}`},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute(
        'anchors.setParent',
        {objectId: `anchor:${ANCHOR_KEY}`, parent: 'anchor:Anchor 2'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('无效父目标:空前串/无前缀/坏骨骼部位 → 校验错误;目标不存在 → OBJECT_NOT_FOUND', async () => {
    const {registry, mountAnchor, writeAnchorsRegistry, fakeStudio} = setup()
    writeAnchorsRegistry([ANCHOR_KEY])
    mountAnchor()

    // 空父级归 clearParent
    await expect(
      registry.execute(
        'anchors.setParent',
        {objectId: `anchor:${ANCHOR_KEY}`, parent: ''},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute(
        'anchors.setParent',
        {objectId: `anchor:${ANCHOR_KEY}`, parent: 'Anchor 2'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    await expect(
      registry.execute(
        'anchors.setParent',
        {objectId: `anchor:${ANCHOR_KEY}`, parent: 'bone:Y Bot#pinky'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    for (const parent of [
      'anchor:Ghost',
      'model:Ghost',
      'camera:Ghost',
      'bone:Ghost#head',
    ]) {
      await expect(
        registry.execute(
          'anchors.setParent',
          {objectId: `anchor:${ANCHOR_KEY}`, parent},
          ctx(),
        ),
      ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    }
    expect(fakeStudio.transaction).not.toHaveBeenCalled()
  })

  test('objectId 类型不符 → INVALID_ID_KIND;锚点未挂载 → INVALID_STATE', async () => {
    const {registry, writeAnchorsRegistry, writePlacementsRegistry} = setup()
    writeAnchorsRegistry([ANCHOR_KEY])
    writePlacementsRegistry(['Y Bot'])

    await expect(
      registry.execute(
        'anchors.setParent',
        {objectId: 'model:Y Bot', parent: 'model:Y Bot'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    // 注册表有条目但未挂载
    await expect(
      registry.execute(
        'anchors.setParent',
        {objectId: `anchor:${ANCHOR_KEY}`, parent: 'model:Y Bot'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })

  test('parent 已建轨 → INVALID_STATE;expectedRevision 冲突 → REVISION_CONFLICT,不写 props', async () => {
    const sequenced = setup({
      tracks: {
        trackIdByPropPath: {'["parent"]': 'track-parent'},
        keyframeValue: '',
      },
    })
    sequenced.writeAnchorsRegistry([ANCHOR_KEY])
    sequenced.writePlacementsRegistry(['Y Bot'])
    sequenced.mountAnchor()

    await expect(
      sequenced.registry.execute(
        'anchors.setParent',
        {objectId: `anchor:${ANCHOR_KEY}`, parent: 'model:Y Bot'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(sequenced.fakeStudio.transaction).not.toHaveBeenCalled()

    const conflicted = setup()
    conflicted.writeAnchorsRegistry([ANCHOR_KEY])
    conflicted.writePlacementsRegistry(['Y Bot'])
    conflicted.mountAnchor()
    conflicted.notifyHistoric()
    await expect(
      conflicted.registry.execute(
        'anchors.setParent',
        {
          objectId: `anchor:${ANCHOR_KEY}`,
          parent: 'model:Y Bot',
          expectedRevision: 1,
        },
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
    expect(conflicted.fakeStudio.transaction).not.toHaveBeenCalled()
  })
})

describe('anchors.clearParent', () => {
  test('写空父级(既有 Three effect 负责挂回 home 并定格世界坐标)', async () => {
    const {registry, mountAnchor, writeAnchorsRegistry, setCalls} = setup()
    writeAnchorsRegistry([ANCHOR_KEY, 'Anchor 2'])
    mountAnchor(ANCHOR_KEY, 'anchor:Anchor 2')

    await expect(
      registry.execute(
        'anchors.clearParent',
        {objectId: `anchor:${ANCHOR_KEY}`},
        ctx(),
      ),
    ).resolves.toEqual({revision: 1})
    expect(setCalls).toEqual([{path: 'parent', value: ''}])
  })

  test('锚点不存在 → OBJECT_NOT_FOUND;未挂载 → INVALID_STATE;类型不符 → INVALID_ID_KIND', async () => {
    const {registry, writeAnchorsRegistry, writePlacementsRegistry} = setup()
    writeAnchorsRegistry([ANCHOR_KEY])
    writePlacementsRegistry(['Y Bot'])

    await expect(
      registry.execute(
        'anchors.clearParent',
        {objectId: 'anchor:Ghost'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    await expect(
      registry.execute(
        'anchors.clearParent',
        {objectId: `anchor:${ANCHOR_KEY}`},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    await expect(
      registry.execute('anchors.clearParent', {objectId: 'model:Y Bot'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
  })
})
