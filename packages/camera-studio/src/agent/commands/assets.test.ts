/**
 * assets.* 与 jobs.*(2026-10-17,Task 8):资产库查询/写入与任务命令。
 *
 * 布景:真实 Library + 内存数据源(importModelFile.test.ts 同款),
 * importModelFile 走 doMock 晚绑定假实现(jest-esbuild 不提升 jest.mock)。
 * 契约要点:
 *  - list/get 透传 Library 真实条目;rename/delete 直等 Library 完成;
 *  - 无 writable 源 / 只读源条目 → INVALID_STATE,不静默成功;
 *  - importModel 是 job/asset/completion:loaded,validator 只收 hydrated
 *    File(原始 fileRef 不许绕过传输适配),任务完成返回 ModelEntry,
 *    订阅者能看到 loaded 阶段;
 *  - 管线部分写入后失败 → PARTIAL_FAILURE,details 含 createdAssetIds 与
 *    失败项;Library 的 quota/network 错误分别保留为 STORAGE_ERROR /
 *    NETWORK_ERROR,不统一吞成 unknown。
 */
import type {CommandContext, JobSnapshot} from '../types'

/** 晚绑定:doMock 工厂只登记一次,各用例在 setup 里换实现 */
let activeImportModelFile: jest.Mock | undefined

jest.doMock('../../assetLibrary/importModelFile', () => ({
  __esModule: true,
  importModelFile: (...args: unknown[]) =>
    activeImportModelFile!(...(args as [never, never])),
}))

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  activeImportModelFile = undefined
})

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

let projectSeq = 0

type AssetsModules = {
  core: typeof import('@dreamerbird/core')
  Library: typeof import('../../assetLibrary/library').Library
  LibraryError: typeof import('../../assetLibrary/source').LibraryError
  AgentCommandRegistry: typeof import('../registry').AgentCommandRegistry
  createAgentRuntime: typeof import('../runtime').createAgentRuntime
  registerAssetCommands: typeof import('./assets').registerAssetCommands
  registerJobCommands: typeof import('./jobs').registerJobCommands
}

function loadModules(): AssetsModules {
  return {
    core: require('@dreamerbird/core'),
    Library: require('../../assetLibrary/library').Library,
    LibraryError: require('../../assetLibrary/source').LibraryError,
    AgentCommandRegistry: require('../registry').AgentCommandRegistry,
    createAgentRuntime: require('../runtime').createAgentRuntime,
    registerAssetCommands: require('./assets').registerAssetCommands,
    registerJobCommands: require('./jobs').registerJobCommands,
  }
}

type EntryKind = import('../../assetLibrary/types').EntryKind
type LibraryEntry = import('../../assetLibrary/types').LibraryEntry
type ModelEntry = import('../../assetLibrary/types').ModelEntry
type PoseEntry = import('../../assetLibrary/types').PoseEntry
type Library = import('../../assetLibrary/library').Library

const modelEntry = (id: string, name = id): ModelEntry => ({
  id,
  kind: 'model',
  name,
  rig: 'mixamo',
  blobId: `blob-${id}`,
  contentHash: `hash-${id}`,
  boneCount: 65,
  vertexCount: 1000,
  createdAt: 1,
})

const poseEntry = (id: string): PoseEntry => ({
  id,
  kind: 'pose',
  name: id,
  rig: 'mixamo',
  bones: {},
  createdAt: 1,
})

/** 内存可写源(importModelFile.test.ts 同款形状) */
function memoryBackend(existing: LibraryEntry[]) {
  const entries = new Map(existing.map((e) => [e.id, e]))
  return {
    id: 'mock-writable',
    listEntries: async (kind?: EntryKind) =>
      [...entries.values()].filter((e) => !kind || e.kind === kind),
    getEntry: async (id: string) => entries.get(id),
    putEntry: async (e: LibraryEntry) => void entries.set(e.id, e),
    deleteEntry: async (id: string) => void entries.delete(id),
    putBlob: async () => 'blob-' + Math.random().toString(36).slice(2),
    getBlobUrl: async () => 'blob:x',
    deleteBlob: async () => {},
    listBlobIds: async () => [] as string[],
    getRigAliases: async () => [],
    putRigAlias: async () => {},
  }
}

/** 内存只读源(内置目录角色):没有 putEntry,isWritableSource 判 false */
function readOnlySource(existing: LibraryEntry[]) {
  const entries = new Map(existing.map((e) => [e.id, e]))
  return {
    id: 'mock-catalog',
    listEntries: async (kind?: EntryKind) =>
      [...entries.values()].filter((e) => !kind || e.kind === kind),
    getEntry: async (id: string) => entries.get(id),
    getBlobUrl: async () => 'blob:catalog',
  }
}

type SetupOptions = {
  /** 可写源里的既有条目 */
  entries?: LibraryEntry[]
  /** 只读目录源里的条目 */
  catalogEntries?: LibraryEntry[]
  /** false = 纯查看器模式(无可写源) */
  writable?: boolean
}

function setup(options: SetupOptions = {}) {
  const m = loadModules()
  const sources =
    options.writable === false
      ? [readOnlySource(options.catalogEntries ?? [])]
      : [
          memoryBackend(options.entries ?? []),
          readOnlySource(options.catalogEntries ?? []),
        ]
  const library = new m.Library({sources: sources as never})
  const project = m.core.getProject(`agent-assets-${++projectSeq}`)
  const sheet = project.sheet('Scene')
  const runtime = m.createAgentRuntime({
    project,
    sheet,
    library,
    getStudio: () => undefined,
    subscribeHistoric: () => () => {},
  })
  const registry = new m.AgentCommandRegistry()
  m.registerAssetCommands(registry, runtime)
  m.registerJobCommands(registry, runtime)
  activeImportModelFile = jest.fn()
  return {...m, library, runtime, registry}
}

/** 轮询任务到终态(job manager 的 done 不经命令暴露,测试读快照) */
async function settleJob(
  runtime: ReturnType<typeof setup>['runtime'],
  jobId: string,
): Promise<JobSnapshot> {
  for (let i = 0; i < 50; i++) {
    const snapshot = runtime.jobs.get(jobId)
    if (['succeeded', 'failed', 'cancelled'].includes(snapshot.state)) {
      return snapshot
    }
    await tick()
  }
  return runtime.jobs.get(jobId)
}

describe('注册与元数据', () => {
  test('assets.* 五个命令与 jobs.* 两个命令全部注册', () => {
    const {registry} = setup()
    for (const name of [
      'assets.list',
      'assets.get',
      'assets.importModel',
      'assets.rename',
      'assets.delete',
      'jobs.get',
      'jobs.cancel',
    ]) {
      expect(registry.has(name)).toBe(true)
    }
  })

  test('元数据:查询/写/任务三种形态,资产命令全部不接受 expectedRevision', () => {
    const {registry} = setup()
    const described = new Map(
      registry.describe().commands.map((c) => [c.name, c]),
    )
    for (const name of ['assets.list', 'assets.get']) {
      expect(described.get(name)).toMatchObject({
        kind: 'query',
        stateDomain: 'asset',
        undoable: 'none',
        acceptsExpectedRevision: false,
      })
    }
    for (const name of ['assets.rename', 'assets.delete']) {
      expect(described.get(name)).toMatchObject({
        kind: 'mutation',
        stateDomain: 'asset',
        undoable: 'none',
        acceptsExpectedRevision: false,
      })
    }
    expect(described.get('assets.importModel')).toMatchObject({
      kind: 'job',
      stateDomain: 'asset',
      undoable: 'none',
      completion: 'loaded',
      cancelable: false,
      acceptsExpectedRevision: false,
    })
    expect(described.get('jobs.get')).toMatchObject({
      kind: 'query',
      stateDomain: 'session',
      acceptsExpectedRevision: false,
    })
    expect(described.get('jobs.cancel')).toMatchObject({
      kind: 'mutation',
      stateDomain: 'session',
      acceptsExpectedRevision: false,
    })
  })

  test('二进制契约:inputSchema 描述 HTTP fileRef,jobResultSchema 描述 ModelEntry', () => {
    const {registry} = setup()
    const described = new Map(
      registry.describe().commands.map((c) => [c.name, c]),
    )
    const importModel = described.get('assets.importModel')!
    const file = importModel.inputSchema.properties!.file
    expect(file.properties!.fileId).toEqual(
      expect.objectContaining({type: 'string'}),
    )
    expect(file.required).toEqual(['fileId'])
    const jobResult = importModel.jobResultSchema!
    expect(jobResult.required).toEqual(
      expect.arrayContaining(['id', 'kind', 'blobId', 'contentHash']),
    )
  })
})

describe('assets.list / assets.get', () => {
  test('透传 Library 真实条目;kind 过滤生效', async () => {
    const {registry} = setup({
      entries: [modelEntry('m1'), poseEntry('p1')],
      catalogEntries: [modelEntry('seed-model-x')],
    })
    const all = (await registry.execute(
      'assets.list',
      {},
      ctx(),
    )) as LibraryEntry[]
    expect(all.map((e) => e.id).sort()).toEqual(['m1', 'p1', 'seed-model-x'])
    const models = (await registry.execute(
      'assets.list',
      {kind: 'model'},
      ctx(),
    )) as LibraryEntry[]
    expect(models.map((e) => e.id).sort()).toEqual(['m1', 'seed-model-x'])
    // 透传的是同内容条目
    expect(models.find((e) => e.id === 'm1')).toEqual(modelEntry('m1'))
  })

  test('get 返回条目;不存在 → ASSET_NOT_FOUND(details 含 assetId)', async () => {
    const {registry} = setup({entries: [modelEntry('m1')]})
    const got = await registry.execute('assets.get', {assetId: 'm1'}, ctx())
    expect(got).toEqual(modelEntry('m1'))
    await expect(
      registry.execute('assets.get', {assetId: 'nope'}, ctx()),
    ).rejects.toMatchObject({
      code: 'ASSET_NOT_FOUND',
      details: {assetId: 'nope'},
    })
  })

  test('list 的 kind 非法 → INVALID_ARGUMENT', async () => {
    const {registry} = setup()
    await expect(
      registry.execute('assets.list', {kind: 'video'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  })
})

describe('assets.rename', () => {
  test('成功:直等 Library 完成并返回更新后的条目', async () => {
    const {registry, library} = setup({entries: [modelEntry('m1')]})
    const renamed = (await registry.execute(
      'assets.rename',
      {assetId: 'm1', name: '机器人'},
      ctx(),
    )) as ModelEntry
    expect(renamed).toMatchObject({id: 'm1', name: '机器人'})
    expect((await library.getEntry('m1'))?.name).toBe('机器人')
  })

  test('空名称拒绝:INVALID_ARGUMENT,Library 未被触碰', async () => {
    const {registry, library} = setup({entries: [modelEntry('m1')]})
    const spy = jest.spyOn(library, 'renameEntry')
    await expect(
      registry.execute('assets.rename', {assetId: 'm1', name: ''}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(spy).not.toHaveBeenCalled()
  })

  test('资产不存在 → ASSET_NOT_FOUND', async () => {
    const {registry} = setup()
    await expect(
      registry.execute('assets.rename', {assetId: 'nope', name: 'x'}, ctx()),
    ).rejects.toMatchObject({code: 'ASSET_NOT_FOUND'})
  })

  test('无 writable 源 → INVALID_STATE,不静默成功', async () => {
    const {registry} = setup({
      writable: false,
      catalogEntries: [modelEntry('seed-model-x')],
    })
    await expect(
      registry.execute(
        'assets.rename',
        {assetId: 'seed-model-x', name: 'x'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })

  test('只读目录源条目(有 writable 源)→ INVALID_STATE', async () => {
    const {registry} = setup({
      entries: [],
      catalogEntries: [modelEntry('seed-model-x')],
    })
    await expect(
      registry.execute(
        'assets.rename',
        {assetId: 'seed-model-x', name: 'x'},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })
})

describe('assets.delete', () => {
  test('使用 deleteEntryDeep,返回 {deleted:true}', async () => {
    const {registry, library} = setup({entries: [modelEntry('m1')]})
    const spy = jest.spyOn(library, 'deleteEntryDeep')
    const result = await registry.execute(
      'assets.delete',
      {assetId: 'm1'},
      ctx(),
    )
    expect(result).toEqual({deleted: true})
    expect(spy).toHaveBeenCalledWith('m1')
    expect(await library.getEntry('m1')).toBeUndefined()
  })

  test('资产不存在 → ASSET_NOT_FOUND', async () => {
    const {registry} = setup()
    await expect(
      registry.execute('assets.delete', {assetId: 'nope'}, ctx()),
    ).rejects.toMatchObject({code: 'ASSET_NOT_FOUND'})
  })

  test('无 writable 源 → INVALID_STATE', async () => {
    const {registry} = setup({
      writable: false,
      catalogEntries: [modelEntry('seed-model-x')],
    })
    await expect(
      registry.execute('assets.delete', {assetId: 'seed-model-x'}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })
})

describe('assets.importModel', () => {
  test('经 runtime.jobs.start 调用 importModelFile(file, library);完成返回 ModelEntry,订阅者看到 loaded 阶段', async () => {
    const {registry, runtime, library} = setup()
    const imported = modelEntry('lib-new', 'robot')
    activeImportModelFile = jest.fn(async () => imported)

    const seen: Array<{state: string; phase: string}> = []
    const unsub = runtime.jobs.subscribe((snapshot) => {
      if (snapshot.kind === 'assets.importModel') {
        seen.push({state: snapshot.state, phase: snapshot.phase})
      }
    })
    cleanups.push(unsub)

    const file = new File(['x'], 'robot.fbx')
    const result = (await registry.execute(
      'assets.importModel',
      {file},
      ctx(),
    )) as {jobId: string}
    expect(result.jobId).toEqual(expect.any(String))

    const done = await settleJob(runtime, result.jobId)
    // 任务体确实以 (file, 当前 library) 调用了既有导入管线
    expect(activeImportModelFile).toHaveBeenCalledWith(file, library)
    expect(done).toMatchObject({
      state: 'succeeded',
      phase: 'loaded',
      progress: 1,
      result: imported,
    })
    // 订阅者按序看到:running/accepted → running/loaded → succeeded/loaded
    expect(seen).toEqual([
      {state: 'running', phase: 'accepted'},
      {state: 'running', phase: 'loaded'},
      {state: 'succeeded', phase: 'loaded'},
    ])
  })

  test('validator 只收 hydrated File:原始 fileRef 拒绝(桥接负责 fileId→File)', async () => {
    const {registry} = setup()
    activeImportModelFile = jest.fn()
    await expect(
      registry.execute('assets.importModel', {file: {fileId: 'f-123'}}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(activeImportModelFile).not.toHaveBeenCalled()
  })

  test('无 writable 源 → INVALID_STATE,不起任务', async () => {
    const {registry} = setup({writable: false})
    activeImportModelFile = jest.fn()
    await expect(
      registry.execute(
        'assets.importModel',
        {file: new File(['x'], 'a.fbx')},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    expect(activeImportModelFile).not.toHaveBeenCalled()
  })

  test('管线部分写入后失败 → PARTIAL_FAILURE,details 含 createdAssetIds 与失败项', async () => {
    const {registry, runtime} = setup()
    const partial = modelEntry('lib-partial', 'half-written')
    activeImportModelFile = jest.fn(async (_file: File, library: Library) => {
      // 模拟导入管线:模型条目已落库,后续动作条目写入失败
      await library.putEntry(partial)
      throw new Error('动作条目写入失败: 磁盘配额')
    })

    const file = new File(['x'], 'robot.fbx')
    const {jobId} = (await registry.execute(
      'assets.importModel',
      {file},
      ctx(),
    )) as {jobId: string}
    const done = await settleJob(runtime, jobId)
    expect(done.state).toBe('failed')
    expect(done.error).toMatchObject({
      code: 'PARTIAL_FAILURE',
      retryable: false,
      details: {
        createdAssetIds: ['lib-partial'],
        failedItems: [
          {file: 'robot.fbx', message: '动作条目写入失败: 磁盘配额'},
        ],
      },
    })
  })

  test('Library quota/network 错误分别保留为 STORAGE_ERROR / NETWORK_ERROR', async () => {
    const {registry, runtime, LibraryError} = setup()

    activeImportModelFile = jest.fn(async () => {
      throw new LibraryError('quota', 'IndexedDB 配额不足')
    })
    const quotaJob = (await registry.execute(
      'assets.importModel',
      {file: new File(['x'], 'a.fbx')},
      ctx(),
    )) as {jobId: string}
    const quotaDone = await settleJob(runtime, quotaJob.jobId)
    expect(quotaDone.state).toBe('failed')
    expect(quotaDone.error).toMatchObject({
      code: 'STORAGE_ERROR',
      retryable: false,
    })
    // 可读 details:保留原始信息,不吞成 unknown
    expect(quotaDone.error?.details).toEqual({cause: 'IndexedDB 配额不足'})

    activeImportModelFile = jest.fn(async () => {
      throw new LibraryError('network', '上传中断')
    })
    const networkJob = (await registry.execute(
      'assets.importModel',
      {file: new File(['x'], 'b.fbx')},
      ctx(),
    )) as {jobId: string}
    const networkDone = await settleJob(runtime, networkJob.jobId)
    expect(networkDone.error).toMatchObject({
      code: 'NETWORK_ERROR',
      retryable: true,
    })
    expect(networkDone.error?.details).toEqual({cause: '上传中断'})
  })

  test('非结构化异常归一为 INTERNAL_ERROR', async () => {
    const {registry, runtime} = setup()
    activeImportModelFile = jest.fn(async () => {
      throw new Error('boom')
    })
    const {jobId} = (await registry.execute(
      'assets.importModel',
      {file: new File(['x'], 'a.fbx')},
      ctx(),
    )) as {jobId: string}
    const done = await settleJob(runtime, jobId)
    expect(done.state).toBe('failed')
    expect(done.error?.code).toBe('INTERNAL_ERROR')
  })
})

describe('jobs.get / jobs.cancel', () => {
  test('jobs.get 返回任务快照;未知任务 → JOB_NOT_FOUND', async () => {
    const {registry, runtime} = setup()
    activeImportModelFile = jest.fn(async () => modelEntry('lib-x'))
    const {jobId} = (await registry.execute(
      'assets.importModel',
      {file: new File(['x'], 'a.fbx')},
      ctx(),
    )) as {jobId: string}
    await settleJob(runtime, jobId)

    const snapshot = (await registry.execute(
      'jobs.get',
      {jobId},
      ctx(),
    )) as JobSnapshot
    expect(snapshot).toMatchObject({
      jobId,
      kind: 'assets.importModel',
      state: 'succeeded',
      phase: 'loaded',
    })
    await expect(
      registry.execute('jobs.get', {jobId: 'nope'}, ctx()),
    ).rejects.toMatchObject({code: 'JOB_NOT_FOUND'})
  })

  test('不可取消任务(assets.importModel)→ JOB_NOT_CANCELABLE', async () => {
    const {registry, runtime} = setup()
    // 永不 settle 的导入:任务停在 running
    activeImportModelFile = jest.fn(() => new Promise(() => {}))
    const {jobId} = (await registry.execute(
      'assets.importModel',
      {file: new File(['x'], 'a.fbx')},
      ctx(),
    )) as {jobId: string}
    await tick()
    expect(runtime.jobs.get(jobId).state).toBe('running')
    await expect(
      registry.execute('jobs.cancel', {jobId}, ctx()),
    ).rejects.toMatchObject({code: 'JOB_NOT_CANCELABLE'})
  })

  test('取消可取消任务:返回 cancelled 快照;重复取消 → INVALID_STATE', async () => {
    const {registry, runtime} = setup()
    const {jobId} = runtime.jobs.start({
      kind: 'test.long',
      cancelable: true,
      execute: () => new Promise(() => {}),
    })
    const snapshot = (await registry.execute(
      'jobs.cancel',
      {jobId},
      ctx(),
    )) as JobSnapshot
    expect(snapshot.state).toBe('cancelled')
    await expect(
      registry.execute('jobs.cancel', {jobId}, ctx()),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })

  test('jobs.cancel 未知任务 → JOB_NOT_FOUND', async () => {
    const {registry} = setup()
    await expect(
      registry.execute('jobs.cancel', {jobId: 'nope'}, ctx()),
    ).rejects.toMatchObject({code: 'JOB_NOT_FOUND'})
  })
})

describe('会话生命周期', () => {
  test('dispose 后资产查询与任务命令 → API_DISPOSED', async () => {
    const {registry, runtime} = setup()
    runtime.dispose()
    await expect(
      registry.execute('assets.list', {}, ctx()),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
    await expect(
      registry.execute('jobs.get', {jobId: 'x'}, ctx()),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
  })
})
