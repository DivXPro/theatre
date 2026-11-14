/**
 * exports.captureStill / exports.startVideo 命令 + 场景控制器契约。
 *
 * 真实使用 core project/sheet、真实 exportRuntime 控制器与参数解析;
 * 只把真正的像素/编码核心替换成可控句柄,以便验证任务状态、错误映射、
 * 取消/dispose 和参数透传。
 */
import {getProject, val} from '@dreamerbird/core'
import {AgentApiError} from '../errors'
import type {CommandContext, JobSnapshot} from '../types'
import type {ExportSink} from '../../videoExport/sinks'
import type {PrevisExportHandle} from '../../videoExport/previsExporter'
import type {
  StillExportResult,
  VideoExportResult,
} from '../../videoExport/previsTypes'
import type {ExportRenderContext} from '../../videoExport/exportRenderContext'

type FakeTask = {
  kind: 'still' | 'video'
  args: Record<string, unknown>
  handle: PrevisExportHandle<StillExportResult | VideoExportResult>
  resolve: (result: StillExportResult | VideoExportResult) => void
  reject: (error: unknown) => void
  restoreCalls: number
  finishEarlyCalls: number
  abortCalls: number
}

let tasks: FakeTask[] = []

jest.doMock('../../videoExport/previsExporter', () => {
  const __esModule = true
  function makeTask(kind: 'still' | 'video', args: Record<string, unknown>) {
    let resolve!: (result: StillExportResult | VideoExportResult) => void
    let reject!: (error: unknown) => void
    const done = new Promise<StillExportResult | VideoExportResult>(
      (res, rej) => {
        resolve = res
        reject = rej
      },
    )
    const task = {
      kind,
      args,
      restoreCalls: 0,
      finishEarlyCalls: 0,
      abortCalls: 0,
    } as FakeTask
    const restore = () => {
      task.restoreCalls += 1
    }
    const abort = () => {
      task.abortCalls += 1
      reject(new AgentApiError('JOB_CANCELLED', '导出已取消'))
      restore()
    }
    task.handle = {
      done,
      abort,
      finishEarly: () => {
        task.finishEarlyCalls += 1
      },
      restoreNow: restore,
    }
    task.resolve = (result) => {
      resolve(result)
    }
    task.reject = (error) => {
      reject(error)
    }
    ;(args.signal as AbortSignal | undefined)?.addEventListener(
      'abort',
      abort,
      {once: true},
    )
    tasks.push(task)
    return task.handle
  }
  return {
    __esModule,
    startStillExport: (args: Record<string, unknown>) =>
      makeTask('still', args),
    startVideoExport: (args: Record<string, unknown>) =>
      makeTask('video', args),
  }
})

const {AgentCommandRegistry} =
  require('../registry') as typeof import('../registry')
const {createAgentRuntime} =
  require('../runtime') as typeof import('../runtime')
const {registerExportCommands} =
  require('./exports') as typeof import('./exports')
const {registerJobCommands} = require('./jobs') as typeof import('./jobs')
const {createSceneExportController, registerSceneExportController} =
  require('../runtime/exportRuntime') as typeof import('../runtime/exportRuntime')
const {registerExportRenderContext} =
  require('../../videoExport/exportRenderContext') as typeof import('../../videoExport/exportRenderContext')
const {AgentApiError: RuntimeAgentApiError} =
  require('../errors') as typeof import('../errors')

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  tasks = []
})

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
let projectSeq = 0

function fakeVideoResult(): VideoExportResult {
  const blob = new Blob(['video-bytes'], {type: 'video/mp4'})
  return {
    blob,
    fileName: '镜头-test.mp4',
    mimeType: 'video/mp4',
    size: blob.size,
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 1000,
    codec: 'avc1.640028',
    encoding: 'webcodecs',
    renderMode: 'clay',
    range: {startMs: 0, endMs: 1000},
  }
}

function fakeStillResult(): StillExportResult {
  const blob = new Blob(['png-bytes'], {type: 'image/png'})
  return {
    blob,
    fileName: '镜头-test.png',
    mimeType: 'image/png',
    size: blob.size,
    width: 800,
    height: 600,
    renderMode: 'clay',
    timeMs: 500,
  }
}

function makeFakeRenderContext(canvas = {width: 1920, height: 1080}) {
  const context: ExportRenderContext = {
    renderer: {} as never,
    scene: {} as never,
    getCamera: () => ({}) as never,
    getCanvasSize: () => canvas,
    getFrameloop: () => 'demand' as const,
    setFrameloop: () => {},
    advance: () => {},
    invalidate: () => {},
  }
  return context
}

function makeScene({
  withController = true,
  withContext = true,
}: {withController?: boolean; withContext?: boolean} = {}) {
  const project = getProject(`previs-exports-${++projectSeq}`)
  const sheet = project.sheet('Scene')
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => undefined,
    subscribeHistoric: () => () => {},
  })
  const registry = new AgentCommandRegistry()
  registerExportCommands(registry, runtime)
  registerJobCommands(registry, runtime)

  if (withContext) {
    cleanups.push(registerExportRenderContext(makeFakeRenderContext()))
  }

  const scene = {
    cameras: ['Cam 1', 'Cam 2'],
    activeCameraKey: 'Cam 1' as string | null,
    shotView: false,
    exporting: false,
    handle: null as unknown,
    lockedCamera: null as string | null,
  }
  const controller = createSceneExportController({
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
    cleanups.push(registerSceneExportController(controller))
  }
  cleanups.push(
    () => controller.dispose(),
    () => runtime.dispose(),
  )
  return {registry, runtime, controller, scene, sheet}
}

async function settleJob(
  runtime: ReturnType<typeof makeScene>['runtime'],
  jobId: string,
): Promise<JobSnapshot> {
  for (let i = 0; i < 80; i++) {
    const snapshot = runtime.jobs.get(jobId)
    if (['succeeded', 'failed', 'cancelled'].includes(snapshot.state)) {
      return snapshot
    }
    await tick()
  }
  return runtime.jobs.get(jobId)
}

async function startCommand(
  registry: ReturnType<typeof makeScene>['registry'],
  name: 'exports.captureStill' | 'exports.startVideo',
  args: unknown = {},
): Promise<string> {
  const result = (await registry.execute(
    name,
    {...(args as object)},
    ctx(),
  )) as {
    jobId: string
  }
  return result.jobId
}

describe('注册元数据与命令面', () => {
  test('两条导出命令都是 job/session/undoable:none/cancelable', () => {
    const {registry} = makeScene()
    const described = new Map(
      registry.describe().commands.map((command) => [command.name, command]),
    )
    for (const name of ['exports.captureStill', 'exports.startVideo']) {
      expect(described.get(name)).toMatchObject({
        kind: 'job',
        stateDomain: 'session',
        undoable: 'none',
        completion: 'loaded',
        cancelable: true,
        acceptsExpectedRevision: false,
      })
      expect(described.get(name)!.jobResultSchema!.required).toEqual(
        expect.arrayContaining(['fileId', 'fileName', 'mimeType', 'size']),
      )
    }
  })

  test('参数校验在起任务前拒绝 fps/output/transparent', async () => {
    const {registry} = makeScene()
    await expect(
      startCommand(registry, 'exports.startVideo', {fps: 0}),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      startCommand(registry, 'exports.captureStill', {
        output: {width: -1, height: 10},
      }),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    await expect(
      startCommand(registry, 'exports.startVideo', {
        background: 'transparent',
      }),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(tasks).toHaveLength(0)
  })
})

describe('静帧导出', () => {
  test('返回 jobId;精确 timeMs/output 透传;结果保持 PNG 元数据', async () => {
    const {registry, runtime, controller, scene} = makeScene()
    const jobId = await startCommand(registry, 'exports.captureStill', {
      cameraId: 'camera:Cam 2',
      renderMode: 'clay',
      output: {width: 800, height: 600},
      clayColor: '#ABC',
      timeMs: 500,
    })
    expect(runtime.jobs.get(jobId)).toMatchObject({
      kind: 'exports.captureStill',
      state: 'running',
      progress: 0,
      phase: 'accepted',
      cancelable: true,
    })
    expect(scene.activeCameraKey).toBe('Cam 2')
    expect(scene.shotView).toBe(true)
    controller.notifySceneReady()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.args).toMatchObject({
      timeMs: 500,
      options: {
        width: 800,
        height: 600,
        renderMode: 'clay',
        clayColor: '#AABBCC',
        background: 'neutral',
      },
    })
    tasks[0]!.resolve(fakeStillResult())
    const snapshot = await settleJob(runtime, jobId)
    expect(snapshot.state).toBe('succeeded')
    expect(snapshot.phase).toBe('loaded')
    expect(snapshot.progress).toBe(1)
    expect(snapshot.result).toMatchObject({
      mimeType: 'image/png',
      width: 800,
      height: 600,
      renderMode: 'clay',
      timeMs: 500,
    })
    expect(scene.shotView).toBe(false)
    expect(scene.exporting).toBe(false)
    expect(scene.lockedCamera).toBe(null)
  })
})

describe('视频导出', () => {
  test('缺省使用当前相机/完整 sequence/当前 canvas/30fps', async () => {
    const {registry, runtime, controller, sheet} = makeScene()
    const lengthMs = val(sheet.sequence.pointer.length) * 1000
    const jobId = await startCommand(registry, 'exports.startVideo')
    controller.notifySceneReady()
    expect(tasks[0]!.args).toMatchObject({
      range: {startMs: 0, endMs: lengthMs},
      fps: 30,
      options: {width: 1920, height: 1080, renderMode: 'styled'},
    })
    tasks[0]!.resolve(fakeVideoResult())
    expect((await settleJob(runtime, jobId)).state).toBe('succeeded')
  })

  test('range/fps/aspect/output/renderMode 透传;进度写入 job', async () => {
    const {registry, runtime, controller} = makeScene()
    const jobId = await startCommand(registry, 'exports.startVideo', {
      range: {startMs: 100, endMs: 1100},
      fps: 24,
      aspectRatio: '9:16',
      renderMode: 'clay',
      background: 'scene',
    })
    controller.notifySceneReady()
    expect(tasks[0]!.args).toMatchObject({
      range: {startMs: 100, endMs: 1100},
      fps: 24,
      options: {
        width: 608,
        height: 1080,
        renderMode: 'clay',
        background: 'scene',
      },
    })
    ;(tasks[0]!.args.onProgress as (p: number) => void)(0.5)
    expect(runtime.jobs.get(jobId).progress).toBe(0.5)
    tasks[0]!.resolve(fakeVideoResult())
    expect((await settleJob(runtime, jobId)).state).toBe('succeeded')
  })

  test('range 超出 sequence 长度在起任务前拒绝', async () => {
    const {registry, sheet} = makeScene()
    const lengthMs = val(sheet.sequence.pointer.length) * 1000
    await expect(
      startCommand(registry, 'exports.startVideo', {
        range: {startMs: 0, endMs: lengthMs + 1},
      }),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
    expect(tasks).toHaveLength(0)
  })

  test('UI sink 路径保持旧 Promise 语义(resolve undefined)', async () => {
    const {controller, scene} = makeScene()
    scene.shotView = true
    const sink: ExportSink = {
      id: 'fake',
      label: 'fake',
      description: 'fake',
      available: () => true,
      start: async () => {},
      write: async () => {},
      finish: async () => {},
      abort: async () => {},
    }
    const promise = controller.startVideo({sink})
    tasks[0]!.resolve(fakeVideoResult())
    await expect(promise).resolves.toBeUndefined()
  })
})

describe('结构化错误与并发', () => {
  test('无活动相机 → INVALID_STATE', async () => {
    const {registry, scene} = makeScene()
    scene.cameras = []
    scene.activeCameraKey = null
    await expect(
      startCommand(registry, 'exports.captureStill'),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
  })

  test('cameraId 类型/不存在 → INVALID_ID_KIND / OBJECT_NOT_FOUND', async () => {
    const {registry} = makeScene()
    await expect(
      startCommand(registry, 'exports.startVideo', {cameraId: 'model:X'}),
    ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
    await expect(
      startCommand(registry, 'exports.startVideo', {cameraId: 'camera:Nope'}),
    ).rejects.toMatchObject({code: 'OBJECT_NOT_FOUND'})
  })

  test('控制器未注册 → SCENE_UNAVAILABLE', async () => {
    const {registry} = makeScene({withController: false})
    await expect(
      startCommand(registry, 'exports.captureStill'),
    ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
  })

  test('场景 controller 在但 render context 缺失 → 任务 INVALID_STATE', async () => {
    const {registry, runtime, controller} = makeScene({withContext: false})
    const jobId = await startCommand(registry, 'exports.captureStill')
    controller.notifySceneReady()
    const snapshot = await settleJob(runtime, jobId)
    expect(snapshot.state).toBe('failed')
    expect(snapshot.error!.code).toBe('INVALID_STATE')
  })

  test('已有导出进行中 → INVALID_STATE', async () => {
    const {registry, controller} = makeScene()
    await startCommand(registry, 'exports.captureStill')
    await expect(
      startCommand(registry, 'exports.startVideo'),
    ).rejects.toMatchObject({code: 'INVALID_STATE'})
    controller.notifySceneReady()
    tasks[0]!.resolve(fakeStillResult())
  })

  test('编码能力缺失 → failed/CAPABILITY_UNAVAILABLE', async () => {
    const {registry, runtime, controller} = makeScene()
    const jobId = await startCommand(registry, 'exports.startVideo')
    controller.notifySceneReady()
    tasks[0]!.reject(
      new RuntimeAgentApiError('CAPABILITY_UNAVAILABLE', '不支持的编码'),
    )
    const snapshot = await settleJob(runtime, jobId)
    expect(snapshot.state).toBe('failed')
    expect(snapshot.error!.code).toBe('CAPABILITY_UNAVAILABLE')
  })
})

describe('取消与 dispose', () => {
  test('jobs.cancel 中止句柄并进入 cancelled', async () => {
    const {registry, runtime, controller, scene} = makeScene()
    const jobId = await startCommand(registry, 'exports.startVideo')
    controller.notifySceneReady()
    await registry.execute('jobs.cancel', {jobId}, ctx())
    expect(tasks[0]!.abortCalls).toBe(1)
    const snapshot = await settleJob(runtime, jobId)
    expect(snapshot.state).toBe('cancelled')
    expect(scene.exporting).toBe(false)
    expect(scene.shotView).toBe(false)
  })

  test('dispose 先 abort + restoreNow,任务以 API_DISPOSED 结束', async () => {
    const {registry, runtime, controller, scene} = makeScene()
    const jobId = await startCommand(registry, 'exports.startVideo')
    controller.notifySceneReady()
    expect(runtime.jobs.get(jobId).state).toBe('running')
    controller.dispose()
    expect(tasks.at(-1)!.abortCalls).toBe(1)
    expect(tasks.at(-1)!.restoreCalls).toBeGreaterThanOrEqual(1)
    expect(scene.exporting).toBe(false)
    const snapshot = await settleJob(runtime, jobId)
    expect(snapshot.state).toBe('failed')
    expect(snapshot.error!.code).toBe('API_DISPOSED')
  })
})
