/**
 * exports.startVideo(2026-10-17,Task 13):视频导出任务命令。
 *
 * 布景:真实 core project/sheet + 真实 exportRuntime 控制器(假 React
 * 会话态 getter/setter),startShotExport 走 doMock 晚绑定假实现
 * (jest-esbuild 不提升 jest.mock);node 环境。
 *
 * 契约要点:
 *  - job/session、undoable:none、cancelable:true、completion:loaded;
 *  - 返回 {jobId};handle.done 是任务成功的唯一权威(句柄返回 ≠ 成功);
 *  - 进度随 sequence position 更新;done resolve 后结果为 BlobCollectSink
 *    收集的 VideoExportResult{blob,fileName,mimeType,size};
 *  - jobs.cancel → handle.abort + sink.abort,任务置 cancelled(终态不被
 *    迟到的 settle 覆盖)并恢复 ShotView;
 *  - 无活动相机/正在导出 → INVALID_STATE;MediaRecorder 不可用(句柄
 *    返回 undefined)→ 任务 failed/CAPABILITY_UNAVAILABLE;
 *  - cameraId 类型不符 → INVALID_ID_KIND;相机不存在 → OBJECT_NOT_FOUND;
 *  - 控制器未注册 → SCENE_UNAVAILABLE;场景 dispose → 先 abort、恢复视图、
 *    拒绝未完成任务(API_DISPOSED);
 *  - jobResultSchema 描述 HTTP FileDescriptor(fileId),JS 结果是 Blob,
 *    不做 JSON 序列化。
 */
import {getProject, val} from '@dreamerbird/core'
import type {CommandContext, JobSnapshot} from '../types'
import type {ExportSink} from '../../videoExport/sinks'
import type {BlobCollectSink} from '../../videoExport/BlobCollectSink'
import type {VideoExportResult} from '../runtime/exportRuntime'

/** 晚绑定:doMock 工厂只登记一次,各用例在 setup 里换实现 */
let activeStartShotExport: jest.Mock | undefined

jest.doMock('../../videoExport/exporter', () => ({
  __esModule: true,
  startShotExport: (...args: unknown[]) =>
    activeStartShotExport!(...(args as [never])),
}))

type FakeRecording = {
  args: {sink: ExportSink; [key: string]: unknown}
  handle: {done: Promise<void>; abort: jest.Mock; finishEarly: jest.Mock}
  resolveDone: () => void
  rejectDone: (error: unknown) => void
  /** 模拟编码器:start sink → 按序写块 → finish */
  recordChunks: (chunks: Uint8Array[]) => Promise<void>
}

let recording: FakeRecording | undefined

/** 假 startShotExport:返回可控 {done,abort,finishEarly};abort 对齐真实行为(sink.abort + done resolve) */
function stubExporterAvailable() {
  activeStartShotExport = jest.fn((args: {sink: ExportSink}) => {
    const {sink} = args
    let resolveDone!: () => void
    let rejectDone!: (error: unknown) => void
    const done = new Promise<void>((res, rej) => {
      resolveDone = res
      rejectDone = rej
    })
    const handle = {
      done,
      abort: jest.fn(() => {
        void sink.abort()
        resolveDone()
      }),
      finishEarly: jest.fn(),
    }
    recording = {
      args: args as FakeRecording['args'],
      handle,
      resolveDone,
      rejectDone,
      recordChunks: async (chunks) => {
        await sink.start({
          mimeType: 'video/webm',
          suggestedName: '镜头-test.webm',
        })
        for (const chunk of chunks) await sink.write(chunk)
        await sink.finish()
      },
    }
    return handle
  })
  return activeStartShotExport
}

/** 编码器不可用:真实 startShotExport 此时返回 undefined 并经 onError 提示 */
function stubExporterUnavailable() {
  activeStartShotExport = jest.fn((args: {onError?: (m: string) => void}) => {
    args.onError?.('当前浏览器不支持视频录制(MediaRecorder 无可用格式)')
    return undefined
  })
  return activeStartShotExport
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  activeStartShotExport = undefined
  recording = undefined
})

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

let projectSeq = 0

type ExportsModules = {
  AgentCommandRegistry: typeof import('../registry').AgentCommandRegistry
  createAgentRuntime: typeof import('../runtime').createAgentRuntime
  registerExportCommands: typeof import('./exports').registerExportCommands
  registerJobCommands: typeof import('./jobs').registerJobCommands
  createSceneExportController: typeof import('../runtime/exportRuntime').createSceneExportController
  registerSceneExportController: typeof import('../runtime/exportRuntime').registerSceneExportController
}

function loadModules(): ExportsModules {
  return {
    AgentCommandRegistry: require('../registry').AgentCommandRegistry,
    createAgentRuntime: require('../runtime').createAgentRuntime,
    registerExportCommands: require('./exports').registerExportCommands,
    registerJobCommands: require('./jobs').registerJobCommands,
    createSceneExportController: require('../runtime/exportRuntime')
      .createSceneExportController,
    registerSceneExportController: require('../runtime/exportRuntime')
      .registerSceneExportController,
  }
}

/** 假 React 会话态:生产是 useState/useRef,测试用普通对象同步读写 */
type FakeSceneState = {
  cameras: string[]
  activeCameraKey: string | null
  shotView: boolean
  exporting: boolean
  handle: unknown
  lockedCamera: string | null
  canvas: HTMLCanvasElement
}

function makeScene({withController = true}: {withController?: boolean} = {}) {
  const m = loadModules()
  const project = getProject(`agent-exports-${++projectSeq}`)
  const sheet = project.sheet('Scene')
  const runtime = m.createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => undefined,
    subscribeHistoric: () => () => {},
  })
  const registry = new m.AgentCommandRegistry()
  m.registerExportCommands(registry, runtime)
  m.registerJobCommands(registry, runtime)
  const scene: FakeSceneState = {
    cameras: ['Cam 1', 'Cam 2'],
    activeCameraKey: 'Cam 1',
    shotView: false,
    exporting: false,
    handle: null,
    lockedCamera: null,
    canvas: {} as HTMLCanvasElement,
  }
  const controller = m.createSceneExportController({
    sheet,
    getActiveCameraKey: () => scene.activeCameraKey,
    hasCamera: (key) => scene.cameras.includes(key),
    setActiveCamera: (key) => {
      scene.activeCameraKey = key
    },
    isExporting: () => scene.exporting,
    getShotView: () => scene.shotView,
    setShotView: (on) => {
      scene.shotView = on
    },
    // 页面上只有一个 canvas(快照编辑器的在 shadow DOM 里)
    getCanvas: () => scene.canvas,
    setExporting: (on) => {
      scene.exporting = on
    },
    setActiveHandle: (handle) => {
      scene.handle = handle
    },
    lockExportCamera: (key) => {
      scene.lockedCamera = key
    },
  })
  if (withController) {
    cleanups.push(m.registerSceneExportController(controller))
  }
  cleanups.push(
    () => controller.dispose(),
    () => runtime.dispose(),
  )
  return {registry, runtime, controller, scene, sheet}
}

/** 轮询任务到终态(job manager 的 done 不经命令暴露,测试读快照) */
async function settleJob(
  runtime: ReturnType<typeof makeScene>['runtime'],
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

async function startVideo(
  registry: ReturnType<typeof makeScene>['registry'],
  args: unknown = {},
): Promise<{jobId: string}> {
  return (await registry.execute('exports.startVideo', args, ctx())) as {
    jobId: string
  }
}

// ── 注册与元数据 ───────────────────────────────────────────────

test('exports.startVideo 元数据:job/session、undoable:none、cancelable、completion:loaded', () => {
  const {registry} = makeScene()
  expect(registry.has('exports.startVideo')).toBe(true)
  const described = new Map(
    registry.describe().commands.map((c) => [c.name, c]),
  )
  const command = described.get('exports.startVideo')!
  expect(command).toMatchObject({
    kind: 'job',
    stateDomain: 'session',
    undoable: 'none',
    completion: 'loaded',
    cancelable: true,
    acceptsExpectedRevision: false,
  })
  // 二进制契约:jobResultSchema 描述 HTTP FileDescriptor;JS 结果是 Blob,不 JSON 序列化
  expect(command.jobResultSchema!.required).toEqual(
    expect.arrayContaining(['fileId', 'fileName', 'mimeType', 'size']),
  )
})

// ── 成功路径 ───────────────────────────────────────────────────

test('导出成功:返回 jobId,done 是唯一权威,结果为 BlobCollectSink 收集的文件,视角恢复', async () => {
  const {registry, runtime, controller, scene} = makeScene()
  const startShotExport = stubExporterAvailable()
  const {jobId} = await startVideo(registry)
  expect(runtime.jobs.get(jobId)).toMatchObject({
    kind: 'exports.startVideo',
    state: 'running',
    progress: 0,
    phase: 'accepted',
    cancelable: true,
  })
  // 视角未生效前不开录;已请求切到镜头视角
  expect(startShotExport).not.toHaveBeenCalled()
  expect(scene.shotView).toBe(true)
  // 模拟 React 副作用:ShotView 生效,开录
  controller.notifySceneReady()
  expect(startShotExport).toHaveBeenCalledTimes(1)
  expect(scene.exporting).toBe(true)
  expect(scene.lockedCamera).toBe('Cam 1')
  // handle.done 是任务成功的唯一权威:句柄已返回 ≠ 成功
  expect(runtime.jobs.get(jobId).state).toBe('running')
  await recording!.recordChunks([
    new Uint8Array([1, 2, 3]),
    new Uint8Array([4, 5]),
  ])
  recording!.resolveDone()
  const snapshot = await settleJob(runtime, jobId)
  expect(snapshot.state).toBe('succeeded')
  expect(snapshot.phase).toBe('loaded')
  expect(snapshot.progress).toBe(1)
  const result = snapshot.result as VideoExportResult
  expect(result.fileName).toBe('镜头-test.webm')
  expect(result.mimeType).toBe('video/webm')
  expect(result.size).toBe(5)
  expect([...new Uint8Array(await result.blob.arrayBuffer())]).toEqual([
    1, 2, 3, 4, 5,
  ])
  // 收尾:恢复导出前视角、清导出态与句柄
  expect(scene.shotView).toBe(false)
  expect(scene.exporting).toBe(false)
  expect(scene.handle).toBe(null)
  expect(scene.lockedCamera).toBe(null)
})

test('进度随 sequence position 更新', async () => {
  const {registry, runtime, controller, sheet} = makeScene()
  stubExporterAvailable()
  const {jobId} = await startVideo(registry)
  controller.notifySceneReady()
  const length = val(sheet.sequence.pointer.length)
  sheet.sequence.position = length / 2
  await tick()
  expect(runtime.jobs.get(jobId).progress).toBeCloseTo(0.5)
  expect(runtime.jobs.get(jobId).state).toBe('running')
  await recording!.recordChunks([new Uint8Array([1])])
  recording!.resolveDone()
  const snapshot = await settleJob(runtime, jobId)
  expect(snapshot.state).toBe('succeeded')
})

test('指定 cameraId:先激活该相机再开录', async () => {
  const {registry, runtime, controller, scene} = makeScene()
  stubExporterAvailable()
  const {jobId} = await startVideo(registry, {cameraId: 'camera:Cam 2'})
  expect(scene.activeCameraKey).toBe('Cam 2')
  controller.notifySceneReady()
  expect(scene.lockedCamera).toBe('Cam 2')
  await recording!.recordChunks([new Uint8Array([1])])
  recording!.resolveDone()
  expect((await settleJob(runtime, jobId)).state).toBe('succeeded')
})

test('shotView 已开启且相机无需切换:立即开录,完成后保持镜头视角', async () => {
  const {registry, runtime, scene} = makeScene()
  const startShotExport = stubExporterAvailable()
  scene.shotView = true
  const {jobId} = await startVideo(registry)
  expect(startShotExport).toHaveBeenCalledTimes(1)
  await recording!.recordChunks([new Uint8Array([1])])
  recording!.resolveDone()
  expect((await settleJob(runtime, jobId)).state).toBe('succeeded')
  // 导出前就在镜头视角:恢复到 true(不退出)
  expect(scene.shotView).toBe(true)
})

// ── 取消 ───────────────────────────────────────────────────────

test('jobs.cancel:handle.abort + sink.abort,任务置 cancelled 且不被迟到 settle 覆盖,视角恢复', async () => {
  const {registry, runtime, controller, scene} = makeScene()
  stubExporterAvailable()
  const {jobId} = await startVideo(registry)
  controller.notifySceneReady()
  await recording!.recordChunks([new Uint8Array([1, 2])])
  const cancelled = (await registry.execute(
    'jobs.cancel',
    {jobId},
    ctx(),
  )) as JobSnapshot
  expect(cancelled.state).toBe('cancelled')
  expect(recording!.handle.abort).toHaveBeenCalledTimes(1)
  // sink 已 abort:blob() 抛 INVALID_STATE
  const sink = recording!.args.sink as BlobCollectSink
  expect(() => sink.blob()).toThrow()
  // abort 后 done resolve 是迟到的 settle:终态 cancelled 不被覆盖
  const snapshot = await settleJob(runtime, jobId)
  expect(snapshot.state).toBe('cancelled')
  expect(scene.shotView).toBe(false)
  expect(scene.exporting).toBe(false)
})

// ── 前置校验失败(任务启动前拒绝命令) ──────────────────────────

test('无活动相机 → INVALID_STATE,不起任务', async () => {
  const {registry, scene} = makeScene()
  stubExporterAvailable()
  scene.cameras = []
  scene.activeCameraKey = null
  await expect(startVideo(registry)).rejects.toMatchObject({
    code: 'INVALID_STATE',
  })
  expect(activeStartShotExport).not.toHaveBeenCalled()
})

test('已有导出进行中 → INVALID_STATE', async () => {
  const {registry, runtime, controller} = makeScene()
  stubExporterAvailable()
  const {jobId} = await startVideo(registry)
  controller.notifySceneReady()
  await expect(startVideo(registry)).rejects.toMatchObject({
    code: 'INVALID_STATE',
  })
  await recording!.recordChunks([new Uint8Array([1])])
  recording!.resolveDone()
  expect((await settleJob(runtime, jobId)).state).toBe('succeeded')
})

test('cameraId 类型不符 → INVALID_ID_KIND;相机不存在 → OBJECT_NOT_FOUND', async () => {
  const {registry} = makeScene()
  stubExporterAvailable()
  await expect(
    startVideo(registry, {cameraId: 'model:Y Bot'}),
  ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
  await expect(
    startVideo(registry, {cameraId: 'camera:Nope'}),
  ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
  expect(activeStartShotExport).not.toHaveBeenCalled()
})

test('cameraId 非法参数 → INVALID_ARGUMENT', async () => {
  const {registry} = makeScene()
  await expect(startVideo(registry, {cameraId: 123})).rejects.toMatchObject({
    code: 'INVALID_ARGUMENT',
  })
  await expect(startVideo(registry, {cameraId: ''})).rejects.toMatchObject({
    code: 'INVALID_ARGUMENT',
  })
})

test('导出控制器未注册 → SCENE_UNAVAILABLE', async () => {
  const {registry} = makeScene({withController: false})
  await expect(startVideo(registry)).rejects.toMatchObject({
    code: 'SCENE_UNAVAILABLE',
  })
})

// ── 运行期失败与场景卸载 ───────────────────────────────────────

test('MediaRecorder 不可用(句柄 undefined)→ 任务 failed/CAPABILITY_UNAVAILABLE,视角恢复', async () => {
  const {registry, runtime, controller, scene} = makeScene()
  stubExporterUnavailable()
  const {jobId} = await startVideo(registry)
  controller.notifySceneReady()
  const snapshot = await settleJob(runtime, jobId)
  expect(snapshot.state).toBe('failed')
  expect(snapshot.error!.code).toBe('CAPABILITY_UNAVAILABLE')
  expect(scene.shotView).toBe(false)
  expect(scene.exporting).toBe(false)
})

test('录制中途失败 → 任务 failed,视角恢复', async () => {
  const {registry, runtime, controller, scene} = makeScene()
  stubExporterAvailable()
  const {jobId} = await startVideo(registry)
  controller.notifySceneReady()
  recording!.rejectDone(new Error('编码器炸了'))
  const snapshot = await settleJob(runtime, jobId)
  expect(snapshot.state).toBe('failed')
  expect(snapshot.error!.message).toContain('编码器炸了')
  expect(scene.shotView).toBe(false)
  expect(scene.exporting).toBe(false)
})

test('场景 dispose:先 abort 在录任务,再恢复视图,最后拒绝未完成任务(API_DISPOSED)', async () => {
  const {registry, runtime, controller, scene} = makeScene()
  stubExporterAvailable()
  const {jobId} = await startVideo(registry)
  controller.notifySceneReady()
  expect(scene.exporting).toBe(true)
  controller.dispose()
  expect(recording!.handle.abort).toHaveBeenCalledTimes(1)
  expect(scene.shotView).toBe(false)
  const snapshot = await settleJob(runtime, jobId)
  expect(snapshot.state).toBe('failed')
  expect(snapshot.error!.code).toBe('API_DISPOSED')
})

test('会话销毁后 exports.startVideo 返回 API_DISPOSED', async () => {
  const {registry, runtime} = makeScene()
  runtime.dispose()
  await expect(startVideo(registry)).rejects.toMatchObject({
    code: 'API_DISPOSED',
  })
})
