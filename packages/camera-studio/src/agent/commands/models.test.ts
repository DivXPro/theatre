/**
 * models.create(2026-10-17,Task 8):从模型资产直接创建到指定位置。
 *
 * Scene Runtime 的 createModel handler 用假实现(返回 key + deferred
 * persisted,形状与接线后的 placeLibraryEntryAt 一致);挂载完成由测试
 * 手动模拟:注册表写条目 + objectRuntime 登记 SheetObject,然后 resolve
 * persisted。命令 promise 在 persisted settle 前必须保持 pending;资产
 * 缺失 / 资产类型不符 / 挂载失败 / 挂载期间 dispose 分别映射
 * ASSET_NOT_FOUND / INVALID_ARGUMENT / RESOURCE_LOAD_FAILED /
 * API_DISPOSED,任何失败路径都不得返回成功。
 */
import {getProject, types as t} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {globals} from '@dreamerbird/core/globals'
import {PLACEMENTS_REGISTRY_KEY} from '../../PlacementManager'
import type {ModelEntry} from '../../assetLibrary/types'
import {formatSceneObjectId} from '../objectIds'
import {AgentCommandRegistry} from '../registry'
import {createAgentRuntime} from '../runtime'
import type {AgentRuntime} from '../runtime'
import {
  registerSceneSheetObject,
  unregisterSceneSheetObject,
} from '../runtime/objectRuntime'
import type {CommandContext, Vec3} from '../types'
import {registerModelCommands} from './models'

let projectSeq = 0

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

/** 真实 macrotask 冲刷:project.ready 经 setTimeout(0) 兑现 */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const modelEntry: ModelEntry = {
  id: 'asset-1',
  kind: 'model',
  name: 'Y Bot',
  rig: 'mixamo',
  blobId: 'blob-1',
  contentHash: 'hash-1',
  boneCount: 65,
  vertexCount: 1000,
  createdAt: 1,
}

const POSITION: Vec3 = {x: 1, y: 0, z: -2}

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {promise, resolve, reject}
}

type FakeCreateModel = jest.Mock<
  {key: string; persisted: Promise<void>},
  [{entry: ModelEntry; position: Vec3}]
>

function setup() {
  // config.state 必须提供:无 state 且无 window 时 project.ready 永不兑现
  const project = getProject(`agent-models-${++projectSeq}`, {
    state: {
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
    } as never,
  })
  const sheet = project.sheet('Scene')
  const library = {
    getEntry: jest.fn(async (id: string) =>
      id === modelEntry.id ? modelEntry : undefined,
    ),
  }
  let notifyHistoric: () => void = () => {}
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: library as never,
    getStudio: () => undefined,
    subscribeHistoric: (listener) => {
      notifyHistoric = listener
      return () => {}
    },
  })
  const registry = new AgentCommandRegistry()
  registerModelCommands(registry, runtime)
  const createModel: FakeCreateModel = jest.fn()
  return {
    project,
    sheet,
    runtime,
    registry,
    library,
    createModel,
    notifyHistoric: () => notifyHistoric(),
  }
}

/** 绑定假 createModel handler,返回 {key, persisted} 句柄 */
function bindCreateModel(
  runtime: AgentRuntime,
  createModel: FakeCreateModel,
  key: string,
  persisted: Promise<void>,
) {
  createModel.mockReturnValue({key, persisted})
  const unbind = runtime.bindHandlers({
    createModel: (args: {entry: ModelEntry; position: Vec3}) =>
      createModel(args),
  })
  cleanups.push(unbind)
}

/** 模拟挂载完成:注册表写条目 + objectRuntime 登记 SheetObject */
function mountModel(sheet: ISheet, key: string) {
  const registryObj = sheet.object(
    PLACEMENTS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
  registryObj.initialValue = {
    list: JSON.stringify([
      {key, libraryEntryId: modelEntry.id, position: POSITION},
    ]),
  }
  const obj = sheet.object(key, {
    position: t.compound({x: t.number(1), y: t.number(0), z: t.number(-2)}),
  }) as ISheetObject<any>
  const id = formatSceneObjectId('model', key)
  registerSceneSheetObject(id, obj)
  cleanups.push(() => unregisterSceneSheetObject(id, obj))
  return obj
}

/** 等命令推进到 createModel 已调用(即已 parked 在 persisted 上) */
async function untilCreateModelCalled(createModel: FakeCreateModel) {
  for (let i = 0; i < 50 && createModel.mock.calls.length === 0; i++) {
    await tick()
  }
  expect(createModel).toHaveBeenCalled()
}

describe('models.create 注册与元数据', () => {
  test('注册为项目单步 mutation,completion:mounted,接受 expectedRevision', () => {
    const {registry} = setup()
    expect(registry.has('models.create')).toBe(true)
    const described = new Map(
      registry.describe().commands.map((c) => [c.name, c]),
    )
    expect(described.get('models.create')).toMatchObject({
      kind: 'mutation',
      stateDomain: 'project',
      undoable: 'single-step',
      completion: 'mounted',
      acceptsExpectedRevision: true,
    })
  })
})

describe('models.create 完成语义', () => {
  test('persisted resolve 前保持 pending;挂载完成后返回 model:<key> 与当前 revision', async () => {
    const {registry, sheet, runtime, createModel, notifyHistoric} = setup()
    const mount = deferred()
    bindCreateModel(runtime, createModel, 'Y Bot', mount.promise)

    let resolved = false
    const promise = registry
      .execute(
        'models.create',
        {assetId: modelEntry.id, position: POSITION},
        ctx(),
      )
      .then((result) => {
        resolved = true
        return result
      })

    await untilCreateModelCalled(createModel)
    // handler 收到的就是库真实条目与命令位置
    expect(createModel).toHaveBeenCalledWith({
      entry: modelEntry,
      position: POSITION,
    })
    await tick()
    // persisted 未 settle:命令必须保持 pending
    expect(resolved).toBe(false)

    // 模拟挂载:注册表条目 + SheetObject 登记,然后 persisted 兑现;
    // notifyHistoric 模拟 scrub.commit 的 historic 通知(revision 递增)
    mountModel(sheet, 'Y Bot')
    notifyHistoric()
    mount.resolve()

    await expect(promise).resolves.toEqual({
      objectId: 'model:Y Bot',
      revision: 2,
    })
  })

  test('资产不存在 → ASSET_NOT_FOUND(details 含 assetId),不调用 handler', async () => {
    const {registry, createModel} = setup()
    await expect(
      registry.execute(
        'models.create',
        {assetId: 'missing', position: POSITION},
        ctx(),
      ),
    ).rejects.toMatchObject({
      code: 'ASSET_NOT_FOUND',
      details: {assetId: 'missing'},
    })
    expect(createModel).not.toHaveBeenCalled()
  })

  test('资产 kind 不是 model → INVALID_ARGUMENT,不调用 handler', async () => {
    const {registry, library, runtime, createModel} = setup()
    library.getEntry.mockResolvedValueOnce({
      id: 'asset-1',
      kind: 'pose',
      name: 'Pose',
      rig: 'mixamo',
      bones: {},
      createdAt: 1,
    } as never)
    const mount = deferred()
    bindCreateModel(runtime, createModel, 'Y Bot', mount.promise)

    await expect(
      registry.execute(
        'models.create',
        {assetId: modelEntry.id, position: POSITION},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(createModel).not.toHaveBeenCalled()
  })

  test('Scene Runtime 未绑定 createModel → SCENE_UNAVAILABLE', async () => {
    const {registry} = setup()
    await expect(
      registry.execute(
        'models.create',
        {assetId: modelEntry.id, position: POSITION},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })

  test('挂载失败(persisted reject)→ RESOURCE_LOAD_FAILED,不返回成功', async () => {
    const {registry, runtime, createModel} = setup()
    const mount = deferred()
    bindCreateModel(runtime, createModel, 'Y Bot', mount.promise)

    const promise = registry.execute(
      'models.create',
      {assetId: modelEntry.id, position: POSITION},
      ctx(),
    )
    await untilCreateModelCalled(createModel)
    mount.reject(new Error('GLTF 解析失败'))

    await expect(promise).rejects.toMatchObject({
      code: 'RESOURCE_LOAD_FAILED',
      details: {assetId: modelEntry.id, cause: 'GLTF 解析失败'},
    })
  })

  test('挂载期间 API dispose → API_DISPOSED,不返回成功', async () => {
    const {registry, runtime, createModel} = setup()
    const mount = deferred()
    bindCreateModel(runtime, createModel, 'Y Bot', mount.promise)

    const promise = registry.execute(
      'models.create',
      {assetId: modelEntry.id, position: POSITION},
      ctx(),
    )
    await untilCreateModelCalled(createModel)
    runtime.dispose()
    // dispose 后挂载链路以失败收场(生产:场景卸载 reject waiter);
    // 命令必须把 dispose 语义置于挂载失败之上
    mount.reject(new Error('组件已卸载'))

    await expect(promise).rejects.toMatchObject({code: 'API_DISPOSED'})
  })

  test('persisted 已兑现但 SheetObject 未登记 → INTERNAL_ERROR(不静默成功)', async () => {
    const {registry, sheet, runtime, createModel} = setup()
    const mount = deferred()
    bindCreateModel(runtime, createModel, 'Y Bot', mount.promise)

    const promise = registry.execute(
      'models.create',
      {assetId: modelEntry.id, position: POSITION},
      ctx(),
    )
    await untilCreateModelCalled(createModel)
    // 只写注册表条目,不登记运行时 SheetObject —— resolver 报 mounted:false
    const registryObj = sheet.object(
      PLACEMENTS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify([
        {key: 'Y Bot', libraryEntryId: modelEntry.id, position: POSITION},
      ]),
    }
    mount.resolve()

    await expect(promise).rejects.toMatchObject({code: 'INTERNAL_ERROR'})
  })

  test('expectedRevision 冲突 → REVISION_CONFLICT,不调用 handler', async () => {
    const {registry, runtime, createModel, notifyHistoric} = setup()
    const mount = deferred()
    bindCreateModel(runtime, createModel, 'Y Bot', mount.promise)
    notifyHistoric()

    await expect(
      registry.execute(
        'models.create',
        {assetId: modelEntry.id, position: POSITION, expectedRevision: 1},
        ctx(),
      ),
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      details: {expectedRevision: 1, actualRevision: 2},
    })
    expect(createModel).not.toHaveBeenCalled()
  })

  test('参数校验:缺 assetId / 坏 position / 坏 expectedRevision → INVALID_ARGUMENT', async () => {
    const {registry} = setup()
    await expect(
      registry.execute('models.create', {position: POSITION}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute(
        'models.create',
        {assetId: modelEntry.id, position: {x: 1, y: 0}},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      registry.execute(
        'models.create',
        {
          assetId: modelEntry.id,
          position: POSITION,
          expectedRevision: 'one',
        },
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  })

  test('会话销毁后调用 → API_DISPOSED', async () => {
    const {registry, runtime} = setup()
    runtime.dispose()
    await expect(
      registry.execute(
        'models.create',
        {assetId: modelEntry.id, position: POSITION},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
  })
})
