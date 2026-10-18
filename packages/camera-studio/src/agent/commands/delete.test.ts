/* eslint-disable import/no-extraneous-dependencies */
/**
 * objects.delete(2026-10-19,Task 14):统一对象删除与完整清理。
 *
 * 真实 Studio 行为测试(同 paths.test.ts 的引导方式,node 环境:jsdom
 * 会把 studio 依赖链上的 jose 解析成 ESM browser 构建,jest 转不了):
 * 领域删除经真事务落库,注册表清单 / 持久覆盖 / 撤销栈直接断言。
 * revision 用捕获的 subscribeHistoric listener 手工推进;会话清理
 * handler(afterSceneObjectDeleted)用假实现经 bindHandlers 登记,
 * 形状与接线后的 CameraScene 一致。
 *
 * 关键断言:
 * - 四类对象删除都只有一步撤销(forgetObject/注册表/绑定回退合并到
 *   同一事务),一次 studio.undo() 完整恢复项目对象和注册表;
 * - 相机/路径/锚点的持久数据按地址 forget(未挂载对象同样真删,
 *   不静默 return);
 * - 锚点删除把子级锚点的 parent 解绑 + 世界定格折进同一事务;
 * - 路径删除重置绑定相机 pathKey 并定格当前世界机位;
 * - 会话清理在领域事务提交之后才执行,领域校验失败时不调用;
 * - 删除选中对象后 selection 不再含已失效 ID(Task 4 遗留窗口关闭);
 * - undo 不恢复会话状态(选择保持清空)。
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
import {Group} from 'three'
import {AgentCommandRegistry} from '../registry'
import {createAgentRuntime} from '../runtime'
import type {AgentRuntime} from '../runtime'
import * as objectRuntime from '../runtime/objectRuntime'
import * as pathRuntime from '../runtime/pathRuntime'
import {registerObjectCommands} from './objects'
import {getPathMeta, pathExists} from '../../CameraPath'
import {
  getPathsRegistry,
  PATHS_REGISTRY_KEY,
  readPathEntries,
} from '../../pathRegistry'
import {
  CAMERAS_REGISTRY_KEY,
  readCameraEntries,
  getCamerasRegistry,
} from '../../cameraRegistry'
import {
  ANCHORS_REGISTRY_KEY,
  getAnchorsRegistry,
  readAnchorKeys,
} from '../../anchorsRegistry'
import {
  PLACEMENTS_REGISTRY_KEY,
  readPlacementEntries,
} from '../../PlacementManager'
import { registerAnchorObject} from '../../aimTargets'
import type {Vec3Like} from '../../pathModel'
import type {CommandContext, SceneObjectId} from '../types'

const studio = getStudio()!
// 公开门面(TheatreStudio):selection/setSelection 只在 publicApi 上,
// 内部 Studio 没有——生产经 getStudioSync 拿的就是它
const studioApi = studio.publicApi
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

/** 探 saaz 撤销栈(私有路径,同 paths.test.ts 的取证方式) */
const undoStackOf = (): unknown[] => {
  const s = studio as unknown as {_store?: {_saaz?: unknown}; _saaz?: unknown}
  const saaz = (s._store?._saaz ?? s._saaz) as
    | {_atom?: {get?: () => {undoRedo?: {stack?: unknown[]}}}}
    | undefined
  return saaz?._atom?.get?.()?.undoRedo?.stack ?? []
}

type SeedCamera = {cameraKey: string; pathKey?: string}
type SeedAnchor = {
  key: string
  parent?: string
  position?: Vec3Like
  /** 运行时节点(锚点网格)的挂载位:parentKey = 命令式挂在哪个锚点节点下 */
  node?: {position: Vec3Like; parentKey?: string}
}
type SeedPath = {key: string; points: Vec3Like[]}
type SeedModel = {key: string; position?: Vec3Like}

async function setup() {
  const state = {
    definitionVersion: globals.currentProjectStateDefinitionVersion,
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
  const project = getProject(`agent-delete-${++projectSeq}`, {
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
    getStudio: () => studioApi as never,
    subscribeHistoric: (listener) => {
      notifyHistoric = listener
      return () => {}
    },
  })
  const registry = new AgentCommandRegistry()
  registerObjectCommands(registry, runtime)

  /** 持久覆盖直读(断言 forgetObject 清干净/撤销恢复,不创建对象) */
  const persistedOverrides = (): Record<string, Record<string, unknown>> =>
    (
      val(privateAPI(project).pointers.historic) as unknown as {
        sheetsById: {Scene: {staticOverrides: {byObject: never}}}
      }
    ).sheetsById.Scene.staticOverrides.byObject

  const registerMounted = (id: SceneObjectId, obj: ISheetObject<any>) => {
    objectRuntime.registerSceneSheetObject(id, obj)
    cleanups.push(() => objectRuntime.unregisterSceneSheetObject(id, obj))
  }

  /** 布景:相机注册表清单 + 每台相机一个 SheetObject 并登记 objectRuntime */
  const seedCameras = (entries: SeedCamera[]) => {
    const objs = new Map<string, ISheetObject<any>>()
    for (const {cameraKey, pathKey} of entries) {
      const obj = sheet.object(cameraKey, {
        position: t.compound({
          x: t.number(9),
          y: t.number(9),
          z: t.number(9),
        }),
        pathKey: t.string(''),
      }) as ISheetObject<any>
      obj.initialValue = {pathKey: pathKey ?? '', position: {x: 9, y: 9, z: 9}}
      registerMounted(`camera:${cameraKey}`, obj)
      objs.set(cameraKey, obj)
    }
    const registryObj = sheet.object(
      CAMERAS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify(entries.map(({cameraKey}) => ({cameraKey}))),
    }
    return objs
  }

  /** 布景:锚点注册表清单 + SheetObject 登记;node 在场时登记运行时节点 */
  const seedAnchors = (entries: SeedAnchor[]) => {
    const objs = new Map<string, ISheetObject<any>>()
    const nodes = new Map<string, Group>()
    for (const {key, parent, position, node} of entries) {
      const obj = sheet.object(key, {
        position: t.compound({
          x: t.number(0),
          y: t.number(0),
          z: t.number(0),
        }),
        parent: t.string(''),
      }) as ISheetObject<any>
      obj.initialValue = {
        parent: parent ?? '',
        position: position ?? {x: 0, y: 0, z: 0},
      }
      registerMounted(`anchor:${key}`, obj)
      objs.set(key, obj)
      if (node) {
        const group = new Group()
        group.position.set(node.position.x, node.position.y, node.position.z)
        nodes.set(key, group)
      }
    }
    // 命令式父子:子节点挂在父节点下(对齐 AnchorObject 的 newParentObj.add)
    for (const {key, node} of entries) {
      if (!node) continue
      const group = nodes.get(key)!
      if (node.parentKey && nodes.has(node.parentKey)) {
        nodes.get(node.parentKey)!.add(group)
      }
      registerAnchorObject(key, group)
      cleanups.push(() => registerAnchorObject(key, null))
    }
    const registryObj = sheet.object(
      ANCHORS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify(entries.map(({key}) => key)),
    }
    return {objs, nodes}
  }

  /** 布景:路径注册表清单 + meta 播点(initialValue,不产生历史) */
  const seedPaths = (entries: SeedPath[]) => {
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

  /** 布景:放置清单 + 每个模型一个 SheetObject 并登记 objectRuntime */
  const seedModels = (entries: SeedModel[]) => {
    const objs = new Map<string, ISheetObject<any>>()
    for (const {key, position} of entries) {
      const obj = sheet.object(key, {
        position: t.compound({
          x: t.number(0),
          y: t.number(0),
          z: t.number(0),
        }),
        label: t.string(''),
      }) as ISheetObject<any>
      obj.initialValue = {position: position ?? {x: 0, y: 0, z: 0}}
      registerMounted(`model:${key}`, obj)
      objs.set(key, obj)
    }
    const registryObj = sheet.object(
      PLACEMENTS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify(
        entries.map(({key, position}) => ({
          key,
          position: position ?? {x: 0, y: 0, z: 0},
        })),
      ),
    }
    return objs
  }

  const registeredCameras = () =>
    readCameraEntries(getCamerasRegistry(sheet)).map((e) => e.cameraKey)
  const registeredAnchors = () => readAnchorKeys(getAnchorsRegistry(sheet))
  const registeredPaths = () =>
    readPathEntries(getPathsRegistry(sheet)).map((e) => e.pathKey)
  const registeredModels = () => readPlacementEntries(sheet).map((e) => e.key)

  return {
    project,
    sheet,
    runtime,
    registry,
    notifyHistoric: () => notifyHistoric(),
    persistedOverrides,
    seedCameras,
    seedAnchors,
    seedPaths,
    seedModels,
    registeredCameras,
    registeredAnchors,
    registeredPaths,
    registeredModels,
  }
}

/** 登记假的会话清理 handler,返回调用记录 */
function bindSessionCleanup(runtime: AgentRuntime) {
  const calls: Array<{id: string; kind: string; key: string}> = []
  const unbind = runtime.bindHandlers({
    afterSceneObjectDeleted: (args) => {
      calls.push(args)
    },
  })
  cleanups.push(unbind)
  return calls
}

describe('objects.delete 注册与元数据', () => {
  test('objects.delete 已注册:mutation/project/single-step/committed,接受 expectedRevision', async () => {
    const {registry} = await setup()
    const command = registry
      .describe()
      .commands.find((c) => c.name === 'objects.delete')
    expect(command).toBeDefined()
    expect(command).toMatchObject({
      kind: 'mutation',
      stateDomain: 'project',
      undoable: 'single-step',
      completion: 'committed',
      acceptsExpectedRevision: true,
    })
  })

  test('会话销毁后调用 → API_DISPOSED', async () => {
    const {registry, runtime} = await setup()
    runtime.dispose()
    await expect(
      registry.execute('objects.delete', {objectId: 'model:Foo'}, ctx()),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
  })
})

describe('objects.delete 模型', () => {
  test('清单行与持久覆盖一并清理;一步撤销完整还原(覆盖一起回来)', async () => {
    const {registry, registeredModels, persistedOverrides, seedModels} =
      await setup()
    const objs = seedModels([{key: 'Y Bot', position: {x: 1, y: 0, z: 2}}])
    const obj = objs.get('Y Bot')!
    // 持久覆盖:真实事务写 label(initialValue 是 ahistoric 基线,不算持久数据)
    studio.transaction(({set}) => set(obj.props.label, 'hero'))
    expect(persistedOverrides()['Y Bot']).toMatchObject({label: 'hero'})
    const stackBefore = undoStackOf().length

    await expect(
      registry.execute('objects.delete', {objectId: 'model:Y Bot'}, ctx()),
    ).resolves.toEqual({deleted: 'model:Y Bot', revision: 1})
    expect(registeredModels()).toEqual([])
    // 持久覆盖被 forget:对象求值回默认
    expect(persistedOverrides()['Y Bot']).toBeUndefined()
    expect(obj.value.label).toBe('')
    // 一个删除命令 = 一个撤销步骤
    expect(undoStackOf().length).toBe(stackBefore + 1)

    studio.undo()
    expect(registeredModels()).toEqual(['Y Bot'])
    expect(obj.value.label).toBe('hero')
  })

  test('删除选中的模型后,选择里不再含已失效对象(其余选择保留)', async () => {
    const {registry, seedModels} = await setup()
    const objs = seedModels([{key: 'A'}, {key: 'B'}])
    studioApi.setSelection([objs.get('A')!, objs.get('B')!])

    await registry.execute('objects.delete', {objectId: 'model:A'}, ctx())
    expect(studioApi.selection as unknown[]).toEqual([objs.get('B')!])
  })
})

describe('objects.delete 相机', () => {
  test('forgetObject 与注册表移除在同一个撤销步骤;undo 一次完整还原', async () => {
    const {registry, registeredCameras, persistedOverrides, seedCameras} =
      await setup()
    const objs = seedCameras([{cameraKey: 'Shot Camera'}])
    const obj = objs.get('Shot Camera')!
    studio.transaction(({set}) => set(obj.props.position, {x: 1, y: 2, z: 3}))
    expect(persistedOverrides()['Shot Camera']).toMatchObject({
      position: {x: 1, y: 2, z: 3},
    })
    const stackBefore = undoStackOf().length

    await expect(
      registry.execute(
        'objects.delete',
        {objectId: 'camera:Shot Camera'},
        ctx(),
      ),
    ).resolves.toEqual({deleted: 'camera:Shot Camera', revision: 1})
    expect(registeredCameras()).toEqual([])
    expect(persistedOverrides()['Shot Camera']).toBeUndefined()
    // 持久数据被清,求值回默认(initialValue 基线)
    expect(obj.value.position).toEqual({x: 9, y: 9, z: 9})
    expect(undoStackOf().length).toBe(stackBefore + 1)

    studio.undo()
    expect(registeredCameras()).toEqual(['Shot Camera'])
    expect(obj.value.position).toEqual({x: 1, y: 2, z: 3})
  })

  test('未挂载相机(有持久数据但无运行时登记)同样真删,不静默返回', async () => {
    const {sheet, registry, registeredCameras, persistedOverrides} =
      await setup()
    // 对象创建过、写过持久数据,但从未登记 objectRuntime(未挂载);
    // 随后脱离对象表,模拟"只有持久态残留"的注册表条目
    const obj = sheet.object('Ghost Cam', {
      position: t.compound({x: t.number(0), y: t.number(0), z: t.number(0)}),
    }) as ISheetObject<any>
    studio.transaction(({set}) => set(obj.props.position, {x: 4, y: 5, z: 6}))
    sheet.detachObject('Ghost Cam')
    const registryObj = sheet.object(
      CAMERAS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify([{cameraKey: 'Ghost Cam'}]),
    }
    expect(persistedOverrides()['Ghost Cam']).toBeDefined()

    await expect(
      registry.execute('objects.delete', {objectId: 'camera:Ghost Cam'}, ctx()),
    ).resolves.toMatchObject({deleted: 'camera:Ghost Cam'})
    expect(registeredCameras()).toEqual([])
    expect(persistedOverrides()['Ghost Cam']).toBeUndefined()
  })

  test('活动相机回退规则(resolveActiveCamera):被删顺位清单第一台,空清单为 null', () => {
    // 运行时 require:纯函数抽取属于本任务实现,静态 import 会让 RED
    // 阶段整文件挂在模块加载上
    const {resolveActiveCamera} =
      require('../../cameraRegistry') as typeof import('../../cameraRegistry')
    const list = [{cameraKey: 'A'}, {cameraKey: 'B'}]
    // 活动相机还在清单里:保持不变
    expect(resolveActiveCamera(list, 'A')).toEqual({cameraKey: 'A'})
    // 活动相机 B 已被删(不在清单):顺位第一台
    expect(resolveActiveCamera([{cameraKey: 'A'}], 'B')).toEqual({
      cameraKey: 'A',
    })
    expect(resolveActiveCamera(list, null)).toEqual({cameraKey: 'A'})
    expect(resolveActiveCamera([], 'A')).toBeNull()
  })
})

describe('objects.delete 锚点', () => {
  test('删除父级锚点:子锚点 parent 解绑 + 世界定格折进同一事务,undo 一次还原绑定', async () => {
    const {registry, registeredAnchors, seedAnchors} = await setup()
    // A 在 (10,0,0);B 持久绑定 anchor:A,position 是相对 A 的局部偏移
    // (1,0,0);运行时节点 B 命令式挂在 A 节点下 → 世界坐标 (11,0,0)
    const {objs} = seedAnchors([
      {
        key: 'A',
        position: {x: 10, y: 0, z: 0},
        node: {position: {x: 10, y: 0, z: 0}},
      },
      {
        key: 'B',
        parent: 'anchor:A',
        position: {x: 1, y: 0, z: 0},
        node: {position: {x: 1, y: 0, z: 0}, parentKey: 'A'},
      },
    ])
    const stackBefore = undoStackOf().length

    await expect(
      registry.execute('objects.delete', {objectId: 'anchor:A'}, ctx()),
    ).resolves.toMatchObject({deleted: 'anchor:A'})
    expect(registeredAnchors()).toEqual(['B'])
    // 父级运行时关系清除:parent 解绑 + 世界坐标定格(画面不跳)
    const child = objs.get('B')!
    expect(val(child.props.parent)).toBe('')
    expect(val(child.props.position)).toEqual({x: 11, y: 0, z: 0})
    expect(undoStackOf().length).toBe(stackBefore + 1)

    studio.undo()
    expect(registeredAnchors()).toEqual(['A', 'B'])
    expect(val(child.props.parent)).toBe('anchor:A')
    expect(val(child.props.position)).toEqual({x: 1, y: 0, z: 0})
  })

  test('子锚点无运行时节点(未挂载)时跳过解绑,删除本身照常完成', async () => {
    const {registry, registeredAnchors, seedAnchors} = await setup()
    const {objs} = seedAnchors([
      {key: 'A'},
      {key: 'B', parent: 'anchor:A', position: {x: 1, y: 0, z: 0}},
    ])

    await registry.execute('objects.delete', {objectId: 'anchor:A'}, ctx())
    expect(registeredAnchors()).toEqual(['B'])
    // 没有节点就没有世界定格可写:绑定留给挂载后的重试/看护处理
    expect(val(objs.get('B')!.props.parent)).toBe('anchor:A')
  })

  test('锚点持久覆盖按地址清理;一步撤销', async () => {
    const {registry, persistedOverrides, seedAnchors} = await setup()
    const {objs} = seedAnchors([{key: 'A'}])
    studio.transaction(({set}) =>
      set(objs.get('A')!.props.position, {x: 3, y: 3, z: 3}),
    )
    expect(persistedOverrides()['A']).toBeDefined()
    const stackBefore = undoStackOf().length

    await registry.execute('objects.delete', {objectId: 'anchor:A'}, ctx())
    expect(persistedOverrides()['A']).toBeUndefined()
    expect(undoStackOf().length).toBe(stackBefore + 1)

    studio.undo()
    expect(val(objs.get('A')!.props.position)).toEqual({x: 3, y: 3, z: 3})
  })
})

describe('objects.delete 路径', () => {
  test('注册表清理 + 对象脱离 + 绑定相机 pathKey 重置与世界定格,一步撤销', async () => {
    const {
      sheet,
      registry,
      registeredPaths,
      seedPaths,
      seedCameras,
      persistedOverrides,
    } = await setup()
    seedPaths([
      {
        key: PATH_KEY,
        points: [
          {x: 0, y: 0, z: 0},
          {x: 10, y: 0, z: 0},
        ],
      },
    ])
    const cameras = seedCameras([{cameraKey: 'Shot Camera', pathKey: PATH_KEY}])
    const camera = cameras.get('Shot Camera')!
    // 挂载采样器(生产由 CameraPath 登记):采样到 (1,2,3) 作为定格机位
    cleanups.push(
      pathRuntime.registerPathSampler(PATH_KEY, (_u, out) => {
        out.set(1, 2, 3)
        return true
      }),
    )
    // 把播下的点落成持久覆盖:initialValue 是 ahistoric 基线,
    // forgetObject/undo 只管 historic 层,不先落覆盖 undo 无从恢复
    const meta = getPathMeta(sheet, PATH_KEY)
    studio.transaction(({set}) => set(meta.props.points, meta.value.points))
    const stackBefore = undoStackOf().length

    await expect(
      registry.execute('objects.delete', {objectId: `path:${PATH_KEY}`}, ctx()),
    ).resolves.toEqual({deleted: `path:${PATH_KEY}`, revision: 1})
    expect(registeredPaths()).toEqual([])
    expect(pathExists(sheet, PATH_KEY)).toBe(false)
    // 绑定相机回退:pathKey 清空 + 机位定格在删除前的采样位置
    expect(val(camera.props.pathKey)).toBe('')
    expect(val(camera.props.position)).toEqual({x: 1, y: 2, z: 3})
    expect(undoStackOf().length).toBe(stackBefore + 1)

    // 一次 undo:注册表行/绑定/机位一起还原
    studio.undo()
    expect(registeredPaths()).toEqual([PATH_KEY])
    expect(val(camera.props.pathKey)).toBe(PATH_KEY)
    expect(val(camera.props.position)).toEqual({x: 9, y: 9, z: 9})
    // 路径持久数据恢复(对象表重挂是生产端 React 重挂载的职责,
    // 测试环境直读 historic 底账验证)
    expect(persistedOverrides()[PATH_KEY]).toBeDefined()
  })

  test('已登记但未挂载的路径(无 meta 对象)也真删,不创建对象不静默返回', async () => {
    const {sheet, registry, registeredPaths, seedPaths} = await setup()
    // 只写注册表行,不落实 meta 对象
    seedPaths([{key: PATH_KEY, points: []}])
    expect(pathExists(sheet, PATH_KEY)).toBe(false)

    await expect(
      registry.execute('objects.delete', {objectId: `path:${PATH_KEY}`}, ctx()),
    ).resolves.toMatchObject({deleted: `path:${PATH_KEY}`})
    expect(registeredPaths()).toEqual([])
    expect(pathExists(sheet, PATH_KEY)).toBe(false)
  })

  test('删除正在编辑的路径:会话清理 handler 在项目事务提交后调用', async () => {
    const {registry, runtime, registeredPaths, seedPaths} = await setup()
    seedPaths([{key: PATH_KEY, points: [{x: 0, y: 0, z: 0}]}])
    // 假 handler 复刻 CameraScene 语义:清编辑态与点选择;并记录调用时
    // 注册表已清理(领域事务先于会话清理)
    const session = {
      editingPath: PATH_KEY as string | null,
      selectedPathPoint: {metaKey: PATH_KEY, key: 'P1'} as {
        metaKey: string
        key: string
      } | null,
    }
    const registryStateAtCall: string[][] = []
    cleanups.push(
      runtime.bindHandlers({
        afterSceneObjectDeleted: ({kind, key}) => {
          registryStateAtCall.push(registeredPaths())
          if (kind !== 'path') return
          if (session.editingPath === key) session.editingPath = null
          if (session.selectedPathPoint?.metaKey === key) {
            session.selectedPathPoint = null
          }
        },
      }),
    )

    await registry.execute(
      'objects.delete',
      {objectId: `path:${PATH_KEY}`},
      ctx(),
    )
    expect(session.editingPath).toBeNull()
    expect(session.selectedPathPoint).toBeNull()
    // 调用时项目事务已提交(注册表行已移除)
    expect(registryStateAtCall).toEqual([[]])
  })
})

describe('objects.delete 会话清理与 undo', () => {
  test('删除选中的相机后 selection 清空;undo 恢复项目对象但不恢复会话选择', async () => {
    const {registry, registeredCameras, seedCameras} = await setup()
    const objs = seedCameras([{cameraKey: 'Shot Camera'}])
    studioApi.setSelection([objs.get('Shot Camera')!])

    await registry.execute(
      'objects.delete',
      {objectId: 'camera:Shot Camera'},
      ctx(),
    )
    expect(studioApi.selection).toHaveLength(0)

    studio.undo()
    expect(registeredCameras()).toEqual(['Shot Camera'])
    // 会话状态不进项目历史:undo 不会把选择恢复到任何 ID
    expect(studioApi.selection).toHaveLength(0)
  })

  test('领域校验失败(OBJECT_NOT_FOUND/INVALID_ID_KIND/REVISION_CONFLICT)时不调用会话清理、不返回 deleted', async () => {
    const {registry, runtime, seedCameras, registeredCameras, notifyHistoric} =
      await setup()
    seedCameras([{cameraKey: 'Shot Camera'}])
    const calls = bindSessionCleanup(runtime)

    await expect(
      registry.execute('objects.delete', {objectId: 'camera:Ghost'}, ctx()),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
    await expect(
      registry.execute('objects.delete', {objectId: 'nocolon'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    await expect(
      registry.execute('objects.delete', {}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})

    notifyHistoric()
    await expect(
      registry.execute(
        'objects.delete',
        {objectId: 'camera:Shot Camera', expectedRevision: 1},
        ctx(),
      ),
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      details: {expectedRevision: 1, actualRevision: 2},
    })
    expect(registeredCameras()).toEqual(['Shot Camera'])
    expect(calls).toEqual([])
  })

  test('会话清理 handler 未绑定时删除照常完成(会话态不存在,静默跳过)', async () => {
    const {registry, registeredCameras, seedCameras} = await setup()
    seedCameras([{cameraKey: 'Shot Camera'}])

    await expect(
      registry.execute(
        'objects.delete',
        {objectId: 'camera:Shot Camera'},
        ctx(),
      ),
    ).resolves.toMatchObject({deleted: 'camera:Shot Camera'})
    expect(registeredCameras()).toEqual([])
  })

  test('expectedRevision 匹配时正常删除', async () => {
    const {registry, registeredCameras, seedCameras} = await setup()
    seedCameras([{cameraKey: 'Shot Camera'}])

    await expect(
      registry.execute(
        'objects.delete',
        {objectId: 'camera:Shot Camera', expectedRevision: 1},
        ctx(),
      ),
    ).resolves.toEqual({deleted: 'camera:Shot Camera', revision: 1})
    expect(registeredCameras()).toEqual([])
  })
})
