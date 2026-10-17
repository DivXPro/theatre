/* eslint-disable import/no-extraneous-dependencies */
/**
 * paths / paths.session 命令(2026-10-17,Task 11):listPresets /
 * createPreset / addPoint / updatePoint / deletePoint / setPointTiming /
 * sample + startEditing / exitEditing / selectPoint。
 *
 * 真实 Studio 行为测试(同 keyframes.realStudio.test.ts 的引导方式,
 * node 环境:jsdom 会把 studio 依赖链上的 jose 解析成 ESM browser 构建,
 * jest 转不了):领域写入经真事务落库,meta.value / 注册表清单 / 撤销栈
 * 直接断言。revision 用捕获的 subscribeHistoric listener 手工推进(同
 * cameras.test.ts 约定);Scene Runtime 会话 handler 与路径采样器用假
 * 实现经 bindHandlers / pathRuntime 登记,形状与接线后的 CameraScene /
 * CameraPath 绑定一致。
 */
// getPathMeta 的调试挂钩写 window.__cameraPathMeta;node 环境补一个
// 全局壳(模块顶层只定义不触碰,测试期调用才写)
;(globalThis as any).window ??= globalThis
import '@dreamerbird/studio'
import theatre, {getProject, types as t, val} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import {globals} from '@dreamerbird/core/globals'
import type {ISheetObject} from '@dreamerbird/core'
import getStudio from '@dreamerbird/studio/getStudio'
import {getCoreTicker} from '@dreamerbird/core/coreTicker'
import {AgentCommandRegistry} from '../registry'
import {createAgentRuntime} from '../runtime'
import * as objectRuntime from '../runtime/objectRuntime'
import * as pathRuntime from '../runtime/pathRuntime'
import {registerPathCommands} from './paths'
import {getPathMeta, pathExists} from '../../CameraPath'
import {
  getPathsRegistry,
  PATHS_REGISTRY_KEY,
  readPathEntries,
} from '../../pathRegistry'
import {
  parsePathPoints,
  sampleEntries,
  withDraggedHandle,
} from '../../pathModel'
import type {Vec3Like} from '../../pathModel'
import {PATH_PRESETS} from '../../pathPresets'
import {CAMERAS_REGISTRY_KEY} from '../../cameraRegistry'
import {PLACEMENTS_REGISTRY_KEY} from '../../PlacementManager'
import type {CommandContext} from '../types'

const studio = getStudio()!
void theatre.init({studio: true, usePersistentStorage: false})

let projectSeq = 0
const PATH_KEY = 'Pos Path'

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

/** 探 saaz 撤销栈(私有路径,同 studio undoHistory.test.ts 的取证方式) */
const undoStackOf = (): unknown[] => {
  const s = studio as unknown as {_store?: {_saaz?: unknown}; _saaz?: unknown}
  const saaz = (s._store?._saaz ?? s._saaz) as
    | {_atom?: {get?: () => {undoRedo?: {stack?: unknown[]}}}}
    | undefined
  return saaz?._atom?.get?.()?.undoRedo?.stack ?? []
}

type SeedEntry = {key: string; points: Vec3Like[]}

type SetupOptions = {
  /** 预建轨:points 属性带一条 BasicKeyframedTrack(首帧值 = 一个点的名单) */
  sequencedPoints?: boolean
}

async function setup(options: SetupOptions = {}) {
  const state = {
    definitionVersion: globals.currentProjectStateDefinitionVersion,
    sheetsById: {
      Scene: {
        staticOverrides: {byObject: {}},
        sequence: {
          type: 'PositionalSequence',
          length: 10,
          subUnitsPerUnit: 30,
          tracksByObject: options.sequencedPoints
            ? {
                [PATH_KEY]: {
                  trackIdByPropPath: {'["points"]': 'track-points'},
                  trackData: {
                    'track-points': {
                      type: 'BasicKeyframedTrack',
                      keyframes: {
                        byId: {
                          kf1: {
                            id: 'kf1',
                            position: 0,
                            connectedRight: true,
                            handles: [0.5, 0.5, 0.5, 0.5],
                            value: JSON.stringify([
                              {key: 'P1', position: {x: 0, y: 0, z: 0}},
                            ]),
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
  const project = getProject(`agent-paths-${++projectSeq}`, {
    state: state as never,
  })
  getCoreTicker().tick()
  await project.ready
  const sheet = project.sheet('Scene')

  let notifyHistoric: () => void = () => {}
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => studio as never,
    subscribeHistoric: (listener) => {
      notifyHistoric = listener
      return () => {}
    },
  })
  const registry = new AgentCommandRegistry()
  registerPathCommands(registry, runtime)

  /** 读路径当前控制点名单(测试断言用;meta 已由布景/命令创建) */
  const pointsOf = (key: string) =>
    parsePathPoints(getPathMeta(sheet, key).value.points)
  /** 注册表清单里的 pathKey(布景/断言用;注册表对象此时已存在) */
  const registeredPaths = () =>
    readPathEntries(getPathsRegistry(sheet)).map((e) => e.pathKey)
  /** 注册表对象是否已被创建(无副作用断言:只探测,不创建) */
  const registryCreated = () =>
    (privateAPI(sheet) as any).getObject(PATHS_REGISTRY_KEY) != null

  /**
   * 布景:注册表加行 + meta 播点(全走 initialValue,不产生历史/撤销步)。
   * 每个测试只调用一次(initialValue 只在没有覆盖时生效)。
   */
  const seedPaths = (entries: SeedEntry[]) => {
    for (const {key, points} of entries) {
      if (points.length === 0) continue
      const meta = getPathMeta(sheet, key)
      meta.initialValue = {
        points: JSON.stringify(
          points.map((p, i) => ({key: `P${i + 1}`, position: p})),
        ),
      }
    }
    const registryObj = sheet.object(
      PATHS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify(entries.map(({key}) => ({pathKey: key}))),
    }
  }

  /** 布景:占住一个放置位(findFreeSpot 的避让输入) */
  const seedPlacementAt = (position: Vec3Like) => {
    const registryObj = sheet.object(
      PLACEMENTS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify([{key: 'Y Bot', position}]),
    }
  }

  /** 布景:一台绑定指定路径的相机(登记 objectRuntime,同 ShotCamera 接线) */
  const seedBoundCamera = (cameraKey: string, pathKey: string) => {
    const obj = sheet.object(cameraKey, {
      position: t.compound({x: t.number(9), y: t.number(9), z: t.number(9)}),
      pathKey: t.string(''),
    }) as ISheetObject<any>
    obj.initialValue = {pathKey, position: {x: 9, y: 9, z: 9}}
    const id = `camera:${cameraKey}` as const
    objectRuntime.registerSceneSheetObject(id, obj)
    cleanups.push(() => objectRuntime.unregisterSceneSheetObject(id, obj))
    const registryObj = sheet.object(
      CAMERAS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify([{cameraKey}]),
    }
    return obj
  }

  return {
    sheet,
    runtime,
    registry,
    notifyHistoric: () => notifyHistoric(),
    pointsOf,
    registeredPaths,
    registryCreated,
    seedPaths,
    seedPlacementAt,
    seedBoundCamera,
  }
}

describe('paths 注册与元数据', () => {
  test('十条命令全部注册;写命令单步可撤销,查询/会话不进历史', async () => {
    const {registry} = await setup()
    for (const name of [
      'paths.listPresets',
      'paths.createPreset',
      'paths.addPoint',
      'paths.updatePoint',
      'paths.deletePoint',
      'paths.setPointTiming',
      'paths.sample',
      'paths.session.startEditing',
      'paths.session.exitEditing',
      'paths.session.selectPoint',
    ]) {
      expect(registry.has(name)).toBe(true)
    }
    const described = new Map(
      registry.describe().commands.map((c) => [c.name, c]),
    )
    expect(described.get('paths.listPresets')).toMatchObject({
      kind: 'query',
      undoable: 'none',
      acceptsExpectedRevision: false,
    })
    expect(described.get('paths.sample')).toMatchObject({
      kind: 'query',
      acceptsExpectedRevision: false,
    })
    for (const name of [
      'paths.createPreset',
      'paths.addPoint',
      'paths.updatePoint',
      'paths.deletePoint',
      'paths.setPointTiming',
    ]) {
      expect(described.get(name)).toMatchObject({
        kind: 'mutation',
        stateDomain: 'project',
        undoable: 'single-step',
        completion: 'committed',
        acceptsExpectedRevision: true,
      })
    }
    for (const name of [
      'paths.session.startEditing',
      'paths.session.exitEditing',
      'paths.session.selectPoint',
    ]) {
      expect(described.get(name)).toMatchObject({
        kind: 'mutation',
        stateDomain: 'session',
        undoable: 'none',
        acceptsExpectedRevision: false,
      })
    }
  })

  test('会话销毁后调用 → API_DISPOSED', async () => {
    const {registry, runtime} = await setup()
    runtime.dispose()
    await expect(
      registry.execute('paths.listPresets', {}, ctx()),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
  })
})

describe('paths.listPresets', () => {
  test('返回 11 个内置预设;无副作用(不创建注册表对象)', async () => {
    const {registry, registryCreated} = await setup()
    const presets = (await registry.execute(
      'paths.listPresets',
      {},
      ctx(),
    )) as Array<{id: string; name: string; en: string}>
    expect(presets).toHaveLength(11)
    expect(presets.map((p) => p.id)).toEqual(PATH_PRESETS.map((p) => p.id))
    expect(presets[0]).toMatchObject({id: 'circle', name: '环绕圆'})
    expect(registryCreated()).toBe(false)
  })
})

describe('paths.createPreset', () => {
  test('空场景落在原点:一个事务同时写 meta points/position 和注册表,一步撤销完整回滚', async () => {
    const {registry, sheet, pointsOf, registeredPaths} = await setup()
    const stackBefore = undoStackOf().length

    await expect(
      registry.execute('paths.createPreset', {preset: 'line'}, ctx()),
    ).resolves.toEqual({
      pathId: `path:${PATH_KEY}`,
      pointKeys: ['P1', 'P2'],
      revision: 1,
    })
    expect(registeredPaths()).toEqual([PATH_KEY])
    // 预设点 = 相对落点的局部坐标(presetPlacement),落点写进位置变换
    expect(pointsOf(PATH_KEY)).toEqual([
      {key: 'P1', position: {x: -5, y: 0, z: 0}},
      {key: 'P2', position: {x: 5, y: 0, z: 0}},
    ])
    expect(val(getPathMeta(sheet, PATH_KEY).props.position)).toEqual({
      x: 0,
      y: 0,
      z: 0,
    })
    // 一个命令一个撤销步骤(spec 8.6)
    expect(undoStackOf().length).toBe(stackBefore + 1)
    studio.undo()
    expect(registeredPaths()).toEqual([])
    expect(getPathMeta(sheet, PATH_KEY).value.points).toBe('[]')
  })

  test('显式 at 为落点;原点被占用时 findFreeSpot 沿 +X 错开', async () => {
    const explicit = await setup()
    await explicit.registry.execute(
      'paths.createPreset',
      {preset: 'line', at: {x: 10, y: 3, z: -2}},
      ctx(),
    )
    expect(val(getPathMeta(explicit.sheet, PATH_KEY).props.position)).toEqual({
      x: 10,
      y: 3,
      z: -2,
    })
    // 落点只进位置变换,控制点仍是局部坐标
    expect(explicit.pointsOf(PATH_KEY)).toEqual([
      {key: 'P1', position: {x: -5, y: 0, z: 0}},
      {key: 'P2', position: {x: 5, y: 0, z: 0}},
    ])

    const occupied = await setup()
    occupied.seedPlacementAt({x: 0, y: 0, z: 0})
    await occupied.registry.execute(
      'paths.createPreset',
      {preset: 'line'},
      ctx(),
    )
    expect(val(getPathMeta(occupied.sheet, PATH_KEY).props.position)).toEqual({
      x: 2,
      y: 0,
      z: 0,
    })
  })

  test('第二条路径取下一个可用 key,并避开已有路径的落点', async () => {
    const {registry, sheet, registeredPaths, pointsOf} = await setup()
    await registry.execute('paths.createPreset', {preset: 'line'}, ctx())
    await expect(
      registry.execute('paths.createPreset', {preset: 'circle'}, ctx()),
    ).resolves.toMatchObject({
      pathId: 'path:Pos Path 2',
      pointKeys: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'],
    })
    expect(registeredPaths()).toEqual([PATH_KEY, 'Pos Path 2'])
    expect(val(getPathMeta(sheet, 'Pos Path 2').props.position)).toEqual({
      x: 2,
      y: 0,
      z: 0,
    })
    expect(pointsOf('Pos Path 2')).toHaveLength(8)
  })

  test('未知预设 → INVALID_ARGUMENT,无任何写入(注册表对象都不创建)', async () => {
    const {registry, registryCreated} = await setup()
    await expect(
      registry.execute('paths.createPreset', {preset: 'nope'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(registryCreated()).toBe(false)
  })

  test('expectedRevision 冲突 → REVISION_CONFLICT,先于任何写入', async () => {
    const {registry, notifyHistoric, registeredPaths} = await setup()
    notifyHistoric()
    await expect(
      registry.execute(
        'paths.createPreset',
        {preset: 'line', expectedRevision: 1},
        ctx(),
      ),
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      details: {expectedRevision: 1, actualRevision: 2},
    })
    expect(registeredPaths()).toEqual([])
  })

  test('同名孤儿(注册表空但对象带旧点)先真删再播种,不把新预设接在旧点上', async () => {
    const {registry, sheet, pointsOf, registeredPaths} = await setup()
    // 孤儿:对象在、注册表没有(撤销只退登记没退播种的残留)
    const orphan = getPathMeta(sheet, PATH_KEY)
    orphan.initialValue = {
      points: JSON.stringify([
        {key: 'P1', position: {x: 100, y: 0, z: 0}},
        {key: 'P2', position: {x: 200, y: 0, z: 0}},
        {key: 'P3', position: {x: 300, y: 0, z: 0}},
      ]),
    }

    await expect(
      registry.execute('paths.createPreset', {preset: 'line'}, ctx()),
    ).resolves.toMatchObject({pathId: `path:${PATH_KEY}`})
    expect(registeredPaths()).toEqual([PATH_KEY])
    // 孤儿旧点被清掉,名单 = 新预设的两个点(不是 3+2 延伸)
    expect(pointsOf(PATH_KEY)).toEqual([
      {key: 'P1', position: {x: -5, y: 0, z: 0}},
      {key: 'P2', position: {x: 5, y: 0, z: 0}},
    ])
  })
})

describe('paths.addPoint', () => {
  test('沿最后一段方向延伸等长一段;一次事务 = 一步撤销', async () => {
    const {registry, pointsOf, seedPaths} = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 4, y: 0, z: 0},
        ],
      },
    ])
    const stackBefore = undoStackOf().length

    await expect(
      registry.execute('paths.addPoint', {pathId: `path:${PATH_KEY}`}, ctx()),
    ).resolves.toEqual({pointKey: 'P3', revision: 1})
    expect(pointsOf(PATH_KEY)).toEqual([
      {key: 'P1', position: {x: 0, y: 0, z: 0}},
      {key: 'P2', position: {x: 4, y: 0, z: 0}},
      {key: 'P3', position: {x: 8, y: 0, z: 0}},
    ])
    expect(undoStackOf().length).toBe(stackBefore + 1)
    studio.undo()
    expect(pointsOf(PATH_KEY)).toHaveLength(2)
  })

  test('点命名不复用删过的号:删掉 P2 后新点仍是 P3', async () => {
    const {registry, pointsOf, seedPaths} = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 2, y: 0, z: 0},
          {x: 4, y: 0, z: 0},
        ],
      },
    ])
    await registry.execute(
      'paths.deletePoint',
      {pathId: `path:${PATH_KEY}`, pointKey: 'P2'},
      ctx(),
    )
    await expect(
      registry.execute('paths.addPoint', {pathId: `path:${PATH_KEY}`}, ctx()),
    ).resolves.toMatchObject({pointKey: 'P4'})
    expect(pointsOf(PATH_KEY).map((e) => e.key)).toEqual(['P1', 'P3', 'P4'])
  })

  test('路径未登记 → OBJECT_NOT_FOUND;类型不符 → INVALID_ID_KIND;不写点', async () => {
    const {registry, seedPaths, registryCreated} = await setup()
    await expect(
      registry.execute('paths.addPoint', {pathId: 'path:Ghost'}, ctx()),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    expect(registryCreated()).toBe(false)

    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 4, y: 0, z: 0},
        ],
      },
    ])
    await expect(
      registry.execute('paths.addPoint', {pathId: `model:${PATH_KEY}`}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    await expect(
      registry.execute('paths.addPoint', {pathId: PATH_KEY}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
  })

  test('已登记但名单为空 → INVALID_STATE(没点就不出现,不给空路径续点)', async () => {
    const {registry, seedPaths} = await setup()
    seedPaths([{key: PATH_KEY, points: []}])
    await expect(
      registry.execute('paths.addPoint', {pathId: `path:${PATH_KEY}`}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })

  test('points 已建轨 → INVALID_STATE;expectedRevision 冲突 → REVISION_CONFLICT;都不写点', async () => {
    const sequenced = await setup({sequencedPoints: true})
    sequenced.seedPaths([{key: PATH_KEY, points: []}])
    await expect(
      sequenced.registry.execute(
        'paths.addPoint',
        {pathId: `path:${PATH_KEY}`},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})

    const conflicted = await setup()
    conflicted.seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 4, y: 0, z: 0},
        ],
      },
    ])
    conflicted.notifyHistoric()
    await expect(
      conflicted.registry.execute(
        'paths.addPoint',
        {pathId: `path:${PATH_KEY}`, expectedRevision: 1},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
    expect(conflicted.pointsOf(PATH_KEY)).toHaveLength(2)
  })
})

describe('paths.updatePoint', () => {
  test('移动控制点:只写目标点,其余原样;一次事务', async () => {
    const {registry, pointsOf, seedPaths} = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 4, y: 0, z: 0},
          {x: 8, y: 0, z: 0},
        ],
      },
    ])
    await expect(
      registry.execute(
        'paths.updatePoint',
        {
          pathId: `path:${PATH_KEY}`,
          pointKey: 'P2',
          position: {x: 4, y: 2, z: -1},
        },
        ctx(),
      ),
    ).resolves.toEqual({revision: 1})
    expect(pointsOf(PATH_KEY)).toEqual([
      {key: 'P1', position: {x: 0, y: 0, z: 0}},
      {key: 'P2', position: {x: 4, y: 2, z: -1}},
      {key: 'P3', position: {x: 8, y: 0, z: 0}},
    ])
  })

  test('拖手柄:与 UI 同一 withDraggedHandle 对齐规则(被拖侧取新偏移,另一侧共线镜像)', async () => {
    const {registry, pointsOf, seedPaths} = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 10, y: 0, z: 0},
        ],
      },
    ])
    const before = pointsOf(PATH_KEY)
    await registry.execute(
      'paths.updatePoint',
      {
        pathId: `path:${PATH_KEY}`,
        pointKey: 'P1',
        handles: {side: 'right', offset: {x: 2, y: 2, z: 0}},
      },
      ctx(),
    )
    expect(pointsOf(PATH_KEY)).toEqual(
      withDraggedHandle(before, 'P1', 'right', {x: 2, y: 2, z: 0}),
    )
  })

  test('非法手柄侧别 / NaN / 空 patch → INVALID_ARGUMENT;未知点 → PATH_POINT_NOT_FOUND;均不写', async () => {
    const {registry, pointsOf, seedPaths} = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 10, y: 0, z: 0},
        ],
      },
    ])
    const before = pointsOf(PATH_KEY)

    await expect(
      registry.execute(
        'paths.updatePoint',
        {
          pathId: `path:${PATH_KEY}`,
          pointKey: 'P1',
          handles: {side: 'up', offset: {x: 1, y: 0, z: 0}},
        },
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute(
        'paths.updatePoint',
        {
          pathId: `path:${PATH_KEY}`,
          pointKey: 'P1',
          position: {x: NaN, y: 0, z: 0},
        },
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute(
        'paths.updatePoint',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute(
        'paths.updatePoint',
        {
          pathId: `path:${PATH_KEY}`,
          pointKey: 'P9',
          position: {x: 1, y: 0, z: 0},
        },
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'PATH_POINT_NOT_FOUND'})
    expect(pointsOf(PATH_KEY)).toEqual(before)
  })

  test('points 已建轨 → INVALID_STATE;expectedRevision 冲突 → REVISION_CONFLICT', async () => {
    const sequenced = await setup({sequencedPoints: true})
    sequenced.seedPaths([{key: PATH_KEY, points: []}])
    await expect(
      sequenced.registry.execute(
        'paths.updatePoint',
        {
          pathId: `path:${PATH_KEY}`,
          pointKey: 'P1',
          position: {x: 1, y: 0, z: 0},
        },
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})

    const conflicted = await setup()
    conflicted.seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 10, y: 0, z: 0},
        ],
      },
    ])
    conflicted.notifyHistoric()
    await expect(
      conflicted.registry.execute(
        'paths.updatePoint',
        {
          pathId: `path:${PATH_KEY}`,
          pointKey: 'P1',
          position: {x: 1, y: 0, z: 0},
          expectedRevision: 1,
        },
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
    expect(conflicted.pointsOf(PATH_KEY)[0]?.position).toEqual({
      x: 0,
      y: 0,
      z: 0,
    })
  })
})

describe('paths.setPointTiming', () => {
  const threePoints: SeedEntry[] = [
    {
      key: PATH_KEY,
      points: [
        {x: 0, y: 0, z: 0},
        {x: 5, y: 0, z: 0},
        {x: 10, y: 0, z: 0},
      ],
    },
  ]

  test('内部点钉锚点:写入显式 u;u:null 恢复自动(回到弧长等比)', async () => {
    const {registry, pointsOf, seedPaths} = await setup()
    seedPaths(threePoints)

    await expect(
      registry.execute(
        'paths.setPointTiming',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P2', u: 0.9},
        ctx(),
      ),
    ).resolves.toEqual({revision: 1})
    expect(pointsOf(PATH_KEY)[1]).toMatchObject({key: 'P2', u: 0.9})

    await expect(
      registry.execute(
        'paths.setPointTiming',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P2', u: null},
        ctx(),
      ),
    ).resolves.toEqual({revision: 1})
    expect(pointsOf(PATH_KEY)[1]?.u).toBeUndefined()
  })

  test('首尾点 u 固定 0/1:显式设置与恢复都拒绝(INVALID_ARGUMENT)', async () => {
    const {registry, pointsOf, seedPaths} = await setup()
    seedPaths(threePoints)
    const before = pointsOf(PATH_KEY)

    await expect(
      registry.execute(
        'paths.setPointTiming',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P1', u: 0.2},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute(
        'paths.setPointTiming',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P3', u: 0.8},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute(
        'paths.setPointTiming',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P1', u: null},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(pointsOf(PATH_KEY)).toEqual(before)
  })

  test('u 超出 0–1 / NaN / 缺 u → INVALID_ARGUMENT;未知点 → PATH_POINT_NOT_FOUND;均不写', async () => {
    const {registry, pointsOf, seedPaths} = await setup()
    seedPaths(threePoints)
    const before = pointsOf(PATH_KEY)

    for (const u of [1.5, -0.2, NaN]) {
      await expect(
        registry.execute(
          'paths.setPointTiming',
          {pathId: `path:${PATH_KEY}`, pointKey: 'P2', u},
          ctx(),
        ),
      ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    }
    await expect(
      registry.execute(
        'paths.setPointTiming',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P2'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute(
        'paths.setPointTiming',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P9', u: 0.5},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'PATH_POINT_NOT_FOUND'})
    expect(pointsOf(PATH_KEY)).toEqual(before)
  })
})

describe('paths.deletePoint', () => {
  test('删非最后一点:只更新 points,注册表行保留', async () => {
    const {registry, pointsOf, registeredPaths, seedPaths} = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 5, y: 0, z: 0},
          {x: 10, y: 0, z: 0},
        ],
      },
    ])
    await expect(
      registry.execute(
        'paths.deletePoint',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P2'},
        ctx(),
      ),
    ).resolves.toEqual({revision: 1, pathDeleted: false})
    expect(pointsOf(PATH_KEY).map((e) => e.key)).toEqual(['P1', 'P3'])
    expect(registeredPaths()).toEqual([PATH_KEY])
  })

  test('删最后一点 = 删除整条路径(deletePathDomain):注册表清理、对象脱离、绑定相机定格回退', async () => {
    const {registry, sheet, registeredPaths, seedPaths, seedBoundCamera} =
      await setup()
    seedPaths([{key: PATH_KEY, points: [{x: 3, y: 4, z: 5}]}])
    const camera = seedBoundCamera('Shot Camera', PATH_KEY)
    // 挂载采样器(生产由 CameraPath 登记):采样到 (1,2,3) 作为定格机位
    cleanups.push(
      pathRuntime.registerPathSampler(PATH_KEY, (_u, out) => {
        out.set(1, 2, 3)
        return true
      }),
    )

    await expect(
      registry.execute(
        'paths.deletePoint',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P1'},
        ctx(),
      ),
    ).resolves.toMatchObject({pathDeleted: true})
    expect(registeredPaths()).toEqual([])
    expect(pathExists(sheet, PATH_KEY)).toBe(false)
    // 绑定相机:pathKey 清空 + 机位定格在删除前的采样位置
    expect(val(camera.props.pathKey)).toBe('')
    expect(val(camera.props.position)).toEqual({x: 1, y: 2, z: 3})
  })

  test('删最后一点但路径未挂载(无采样器):相机只清绑定,不定格机位', async () => {
    const {registry, registeredPaths, seedPaths, seedBoundCamera} =
      await setup()
    seedPaths([{key: PATH_KEY, points: [{x: 3, y: 4, z: 5}]}])
    const camera = seedBoundCamera('Shot Camera', PATH_KEY)

    await expect(
      registry.execute(
        'paths.deletePoint',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P1'},
        ctx(),
      ),
    ).resolves.toMatchObject({pathDeleted: true})
    expect(registeredPaths()).toEqual([])
    expect(val(camera.props.pathKey)).toBe('')
    expect(val(camera.props.position)).toEqual({x: 9, y: 9, z: 9})
  })

  test('未知点 → PATH_POINT_NOT_FOUND;路径未登记 → OBJECT_NOT_FOUND', async () => {
    const {registry, pointsOf, seedPaths} = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 4, y: 0, z: 0},
        ],
      },
    ])
    await expect(
      registry.execute(
        'paths.deletePoint',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P9'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'PATH_POINT_NOT_FOUND'})
    await expect(
      registry.execute(
        'paths.deletePoint',
        {pathId: 'path:Ghost', pointKey: 'P1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    expect(pointsOf(PATH_KEY)).toHaveLength(2)
  })
})

describe('paths.sample', () => {
  test('0 / 0.5 / 1 与当前渲染同一曲线实现(sampleEntries)取世界坐标', async () => {
    const {registry, pointsOf, seedPaths} = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 10, y: 0, z: 0},
        ],
      },
    ])
    // 挂载采样器(生产由 CameraPath 登记;这里直接复用渲染同款曲线实现)
    cleanups.push(
      pathRuntime.registerPathSampler(PATH_KEY, (u, out) =>
        sampleEntries(pointsOf(PATH_KEY), u, out),
      ),
    )

    const at = async (u: number) =>
      (await registry.execute(
        'paths.sample',
        {pathId: `path:${PATH_KEY}`, u},
        ctx(),
      )) as {position: Vec3Like}
    expect(await at(0)).toEqual({position: {x: 0, y: 0, z: 0}})
    expect(await at(1)).toEqual({position: {x: 10, y: 0, z: 0}})
    const mid = await at(0.5)
    expect(mid.position.x).toBeCloseTo(5, 6)
    expect(mid.position.y).toBeCloseTo(0, 6)
  })

  test('路径已登记但未挂载(无采样器)→ INVALID_STATE;不创建 meta 对象', async () => {
    const {registry, sheet, seedPaths} = await setup()
    // 只写注册表行:meta 对象不存在 = 组件未挂载
    seedPaths([{key: PATH_KEY, points: []}])
    expect(pathExists(sheet, PATH_KEY)).toBe(false)

    await expect(
      registry.execute(
        'paths.sample',
        {pathId: `path:${PATH_KEY}`, u: 0.5},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    // 查询无副作用:不调用会创建 meta 的读取函数
    expect(pathExists(sheet, PATH_KEY)).toBe(false)
  })

  test('路径未登记 → OBJECT_NOT_FOUND(注册表对象都不创建);类型不符 → INVALID_ID_KIND', async () => {
    const {registry, registryCreated} = await setup()
    await expect(
      registry.execute('paths.sample', {pathId: 'path:Ghost', u: 0}, ctx()),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    expect(registryCreated()).toBe(false)
    await expect(
      registry.execute('paths.sample', {pathId: 'model:Foo', u: 0}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
  })
})

describe('paths.session', () => {
  test('startEditing 只接受已登记路径;经 Scene Runtime handler 进入编辑', async () => {
    const {registry, runtime, seedPaths} = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 4, y: 0, z: 0},
        ],
      },
    ])
    const startPathEditing = jest.fn()
    cleanups.push(runtime.bindHandlers({startPathEditing}))

    await expect(
      registry.execute(
        'paths.session.startEditing',
        {pathId: `path:${PATH_KEY}`},
        ctx(),
      ),
    ).resolves.toBeUndefined()
    expect(startPathEditing).toHaveBeenCalledWith({pathKey: PATH_KEY})

    await expect(
      registry.execute(
        'paths.session.startEditing',
        {pathId: 'path:Ghost'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    expect(startPathEditing).toHaveBeenCalledTimes(1)
  })

  test('Scene Runtime 未绑定 handler → SCENE_UNAVAILABLE', async () => {
    const {registry, seedPaths} = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 4, y: 0, z: 0},
        ],
      },
    ])
    await expect(
      registry.execute(
        'paths.session.startEditing',
        {pathId: `path:${PATH_KEY}`},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
    await expect(
      registry.execute('paths.session.exitEditing', {}, ctx()),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
    await expect(
      registry.execute(
        'paths.session.selectPoint',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })

  test('selectPoint:点存在且路径正在编辑 → 经 handler 选中', async () => {
    const {registry, runtime, seedPaths} = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 4, y: 0, z: 0},
        ],
      },
    ])
    const selectPathPoint = jest.fn()
    cleanups.push(
      runtime.bindHandlers({
        getPathEditingState: () => ({pathKey: PATH_KEY, pointKey: null}),
        selectPathPoint,
      }),
    )

    await expect(
      registry.execute(
        'paths.session.selectPoint',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P2'},
        ctx(),
      ),
    ).resolves.toBeUndefined()
    expect(selectPathPoint).toHaveBeenCalledWith({
      pathKey: PATH_KEY,
      pointKey: 'P2',
    })
  })

  test('selectPoint:路径未在编辑 → INVALID_STATE;点不存在 → PATH_POINT_NOT_FOUND;handler 不被调用', async () => {
    const {registry, runtime, seedPaths} = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 4, y: 0, z: 0},
        ],
      },
    ])
    const selectPathPoint = jest.fn()
    const state = {pathKey: null as string | null, pointKey: null}
    cleanups.push(
      runtime.bindHandlers({
        getPathEditingState: () => state,
        selectPathPoint,
      }),
    )

    // 没有在编辑任何路径
    await expect(
      registry.execute(
        'paths.session.selectPoint',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    // 在编辑别的路径
    state.pathKey = 'Pos Path 2'
    await expect(
      registry.execute(
        'paths.session.selectPoint',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P1'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    // 正在编辑但点不存在
    state.pathKey = PATH_KEY
    await expect(
      registry.execute(
        'paths.session.selectPoint',
        {pathId: `path:${PATH_KEY}`, pointKey: 'P9'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'PATH_POINT_NOT_FOUND'})
    expect(selectPathPoint).not.toHaveBeenCalled()
  })

  test('exitEditing 清空编辑态和点选择:与 selection.clear 共用同一 runtime 清理函数', async () => {
    const {registry, runtime} = await setup()
    const exitPathEditing = jest.fn()
    const clearPathPointSelection = jest.fn()
    cleanups.push(
      runtime.bindHandlers({exitPathEditing, clearPathPointSelection}),
    )

    await expect(
      registry.execute('paths.session.exitEditing', {}, ctx()),
    ).resolves.toBeUndefined()
    expect(exitPathEditing).toHaveBeenCalledTimes(1)
    // 与 selection.clear 相同的点选择清理(handler 同签名同语义)
    expect(clearPathPointSelection).toHaveBeenCalledTimes(1)
  })
})
