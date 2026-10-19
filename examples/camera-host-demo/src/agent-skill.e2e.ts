/**
 * Agent SKILL 端到端验收(2026-10-19,SKILL Task 4,spec §13.4 末条):
 * 真实 demo + 真实桥接,外部 Agent 的每一步都经随仓库 SKILL 客户端
 * (.claude/skills/camera-studio-agent/scripts/scene-api.mjs)以 execFile
 * 子进程执行——与 Agent 实际使用路径一字不差,本文件不重写任何
 * HTTP helper(那是 agent.e2e.ts 的传输层验收,两者互补)。
 *
 * 参数纪律:每一步的参数只由前面步骤的 JSON 输出构造——不读
 * SheetObject、不访问页面内部状态来代替 API 验证。唯一例外:revision
 * 冲突验收里,「别人先改了」这一动作用页面内 window.__cameraStudioApi
 * (demo 在桥接模式下显式 exposeGlobal)扮演竞争写入者——它是冲突的
 * 制造者,不是被验收的 Agent 路径。
 *
 * 桥接地址与 token 由 devEnv/playwright.config.ts 经环境变量注入;
 * token 只作子进程环境变量传递(CLI 也只从环境变量读取),绝不打印。
 */
import {expect, test} from '@playwright/test'
import type {Page} from '@playwright/test'
import {execFile} from 'child_process'
import path from 'path'

const BRIDGE_HTTP = process.env.CAMERA_STUDIO_E2E_BRIDGE_HTTP
const TOKEN = process.env.CAMERA_STUDIO_E2E_TOKEN
if (!BRIDGE_HTTP || !TOKEN) {
  throw new Error(
    '缺少 CAMERA_STUDIO_E2E_* 环境变量:本测试必须由 devEnv/playwright.config.ts 启动',
  )
}

/** 被测物:随仓库 SKILL 客户端本身(Agent 照 SKILL.md 执行的就是它) */
const SKILL_SCRIPT = path.resolve(
  __dirname,
  '../../../.claude/skills/camera-studio-agent/scripts/scene-api.mjs',
)
/** 内置模型文件(SKILL upload 子命令的输入;文件名含空格,走 CLI 参数) */
const MODEL_PATH = path.resolve(
  __dirname,
  '../../../packages/camera-studio/assets/models/Y Bot.glb',
)
const MODEL_MIME = 'model/gltf-binary'
/** SKILL 文档承诺「从仓库根调用」——子进程 cwd 就钉在仓库根 */
const REPO_ROOT = path.resolve(__dirname, '../../..')

/**
 * 以 Agent 的真实方式执行 SKILL CLI:execFile 子进程 +
 * CAMERA_STUDIO_API_URL / CAMERA_STUDIO_TOKEN 环境变量注入。
 * token 不出现在命令行参数里(进程列表不可见),失败时也不打印。
 */
function runSkill(args: string[]): Promise<{stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [SKILL_SCRIPT, ...args],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          CAMERA_STUDIO_API_URL: BRIDGE_HTTP!,
          CAMERA_STUDIO_TOKEN: TOKEN!,
        },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 180_000,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, {stdout, stderr}))
        } else {
          resolve({stdout, stderr})
        }
      },
    )
  })
}

/** 子命令必须成功;返回 stdout 解析出的 JSON(stdout 只出机器可读 JSON) */
async function skillJson(args: string[]): Promise<any> {
  const {stdout} = await runSkill(args)
  return JSON.parse(stdout)
}

/** 子命令必须失败:非零退出 + stderr 上的 {ok:false,error} 信封 */
async function skillError(args: string[]): Promise<{
  code: string
  message: string
  retryable: boolean
}> {
  let failure: (Error & {code?: unknown; stderr?: string}) | undefined
  try {
    await runSkill(args)
  } catch (error) {
    failure = error as typeof failure
  }
  expect(
    failure,
    `CLI 应以非零退出失败: scene-api.mjs ${args.join(' ')}`,
  ).toBeTruthy()
  expect(typeof failure!.code).toBe('number')
  expect(failure!.code as number).toBeGreaterThan(0)
  const envelope = JSON.parse(failure!.stderr ?? '')
  expect(envelope.ok).toBe(false)
  expect(typeof envelope.error?.code).toBe('string')
  return envelope.error
}

/** 等浏览器场景连上桥接——发现路径同样只走 SKILL health,不用裸 fetch */
async function waitSceneConnected(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const health = await skillJson(['health'])
      if (health.bridge === 'running' && health.scene === 'connected') return
    } catch {
      /* 桥接/场景未就绪,继续轮询 */
    }
    if (Date.now() > deadline) {
      throw new Error('浏览器场景未在时限内连接桥接(SKILL health 轮询超时)')
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/** 打开 demo 页面并等到桥接侧看到场景连接;之后纯 SKILL CLI 驱动 */
async function bootScene(page: Page): Promise<void> {
  await page.goto('/')
  await waitSceneConnected()
}

test.describe('agent skill e2e', () => {
  test.describe.configure({mode: 'serial'})

  test('agent skill: 冒烟——SKILL 示例命令逐条真实执行', async ({page}) => {
    await bootScene(page)

    // ── 1. health / schema:能力发现先于一切写操作 ──────────
    const health = await skillJson(['health'])
    expect(health.bridge).toBe('running')
    expect(health.scene).toBe('connected')

    const schema = await skillJson(['schema'])
    const commandNames = schema.commands.map(
      (command: {name: string}) => command.name,
    )
    for (const expected of [
      'scene.getSnapshot',
      'assets.importModel',
      'assets.list',
      'models.create',
      'objects.update',
      'objects.get',
      'keyframes.set',
      'cameras.create',
      'paths.listPresets',
      'paths.createPreset',
      'cameras.bindPath',
      'project.exportState',
      'objects.delete',
      'assets.delete',
      'history.undo',
    ]) {
      expect(commandNames).toContain(expected)
    }

    // ── 2. scene.getSnapshot:revision 是 expectedRevision 链的起点 ──
    const snapshot0 = await skillJson(['call', 'scene.getSnapshot', '{}'])
    expect(typeof snapshot0.revision).toBe('number')
    expect(Array.isArray(snapshot0.objects)).toBe(true)

    // ── 3. upload → assets.importModel → wait(SKILL 上传/导入工作流) ──
    const uploaded = await skillJson([
      'upload',
      MODEL_PATH,
      '--mime',
      MODEL_MIME,
    ])
    expect(uploaded.fileId).toBeTruthy()
    expect(uploaded.fileName).toBe('Y Bot.glb')
    expect(uploaded.mimeType).toBe(MODEL_MIME)

    const importStart = await skillJson([
      'call',
      'assets.importModel',
      JSON.stringify({
        file: {
          fileId: uploaded.fileId,
          fileName: uploaded.fileName,
          mimeType: uploaded.mimeType,
        },
      }),
    ])
    expect(importStart.jobId).toBeTruthy()
    // accepted 不是成功:wait 到终态再取 result
    const importFinal = await skillJson([
      'wait',
      importStart.jobId,
      '--timeout-ms',
      '120000',
    ])
    expect(importFinal.state).toBe('succeeded')
    expect(importFinal.result.kind).toBe('model')
    const assetId = importFinal.result.id as string

    // ── 4. models.create(参数全部由上几步输出构造) ──────────
    const created = await skillJson([
      'call',
      'models.create',
      JSON.stringify({
        assetId,
        position: {x: 0, y: 0, z: 0},
        expectedRevision: snapshot0.revision,
      }),
    ])
    const modelId = created.objectId as string
    expect(modelId.startsWith('model:')).toBe(true)
    expect(typeof created.revision).toBe('number')

    // ── 5. 快照读回验证:挂载完成且仅一份 ─────────────────
    const snapshot1 = await skillJson(['call', 'scene.getSnapshot', '{}'])
    const placed = snapshot1.objects.filter(
      (object: {id: string}) => object.id === modelId,
    )
    expect(placed).toHaveLength(1)
    expect(placed[0].kind).toBe('model')
    expect(placed[0].mounted).toBe(true)

    // ── 6. objects.update(沿 revision 链)+ objects.get 读回 ──
    const updated = await skillJson([
      'call',
      'objects.update',
      JSON.stringify({
        objectId: modelId,
        props: {position: {x: 2, y: 0, z: -1}},
        expectedRevision: created.revision,
      }),
    ])
    expect(typeof updated.revision).toBe('number')
    const moved = await skillJson([
      'call',
      'objects.get',
      JSON.stringify({objectId: modelId}),
    ])
    expect(moved.props.position).toMatchObject({x: 2, y: 0, z: -1})

    // ── 7. cameras.create / paths.createPreset / cameras.bindPath ──
    // 预设 id 从 paths.listPresets 实时拿,绝不猜
    const camera = await skillJson([
      'call',
      'cameras.create',
      JSON.stringify({fromCurrentView: true}),
    ])
    expect((camera.objectId as string).startsWith('camera:')).toBe(true)
    const presets = await skillJson(['call', 'paths.listPresets', '{}'])
    const preset =
      presets.find((entry: {id: string}) => entry.id === 'circle') ?? presets[0]
    expect(preset, 'paths.listPresets 应返回至少一个预设').toBeTruthy()
    const pathResult = await skillJson([
      'call',
      'paths.createPreset',
      JSON.stringify({preset: preset.id}),
    ])
    expect((pathResult.pathId as string).startsWith('path:')).toBe(true)
    await skillJson([
      'call',
      'cameras.bindPath',
      JSON.stringify({objectId: camera.objectId, pathId: pathResult.pathId}),
    ])
    const bound = await skillJson([
      'call',
      'objects.get',
      JSON.stringify({objectId: camera.objectId}),
    ])
    expect(bound.props.pathKey).toBe(pathResult.pathId.slice('path:'.length))

    // ── 8. sequence.setLength / keyframes.set / sequence.seek ──
    await skillJson(['call', 'sequence.setLength', JSON.stringify({length: 4})])
    await skillJson([
      'call',
      'keyframes.set',
      JSON.stringify({
        objectId: modelId,
        propPath: ['position', 'x'],
        at: 2,
        value: 4,
      }),
    ])
    const keyframes = await skillJson([
      'call',
      'keyframes.list',
      JSON.stringify({objectId: modelId, propPath: ['position', 'x']}),
    ])
    expect(
      keyframes.some(
        (keyframe: {position: number; value: number}) =>
          Math.abs(keyframe.position - 2) < 1e-6 && keyframe.value === 4,
      ),
    ).toBe(true)
    const seeked = await skillJson([
      'call',
      'sequence.seek',
      JSON.stringify({position: 1}),
    ])
    expect(seeked.length).toBe(4)
    expect(seeked.position).toBeCloseTo(1, 6)

    // ── 9. project.exportState ──────────────────────────
    const exported = await skillJson(['call', 'project.exportState', '{}'])
    expect(exported.projectId).toBe('Space')
    expect(typeof exported.content).toBe('object')

    // ── 10. objects.delete 并验证清理 ───────────────────
    const deleted = await skillJson([
      'call',
      'objects.delete',
      JSON.stringify({objectId: modelId}),
    ])
    expect(deleted.deleted).toBe(modelId)
    const snapshot2 = await skillJson(['call', 'scene.getSnapshot', '{}'])
    expect(
      snapshot2.objects.some((object: {id: string}) => object.id === modelId),
    ).toBe(false)
  })

  test('agent skill: revision 冲突 / requestId 去重 / 资产删除不可撤销', async ({
    page,
  }) => {
    await bootScene(page)

    // 资产就位:upload → import → wait(全 SKILL 路径)
    const uploaded = await skillJson([
      'upload',
      MODEL_PATH,
      '--mime',
      MODEL_MIME,
    ])
    const importStart = await skillJson([
      'call',
      'assets.importModel',
      JSON.stringify({
        file: {
          fileId: uploaded.fileId,
          fileName: uploaded.fileName,
          mimeType: uploaded.mimeType,
        },
      }),
    ])
    const importFinal = await skillJson([
      'wait',
      importStart.jobId,
      '--timeout-ms',
      '120000',
    ])
    expect(importFinal.state).toBe('succeeded')
    const assetId = importFinal.result.id as string

    // ── requestId 去重:同 requestId 重放 models.create ──
    // 场景只新增一个模型,重放返回首次结果(workflows.md 配方 6b)
    const snapshot0 = await skillJson(['call', 'scene.getSnapshot', '{}'])
    const createArgs = JSON.stringify({
      assetId,
      position: {x: 0, y: 0, z: 0},
      expectedRevision: snapshot0.revision,
    })
    const requestId = `skill-e2e-dedup-${Date.now()}`
    const first = await skillJson([
      'call',
      'models.create',
      createArgs,
      '--request-id',
      requestId,
    ])
    const replay = await skillJson([
      'call',
      'models.create',
      createArgs,
      '--request-id',
      requestId,
    ])
    expect(replay.objectId).toBe(first.objectId)
    const modelId = first.objectId as string
    const snapshot1 = await skillJson(['call', 'scene.getSnapshot', '{}'])
    expect(
      snapshot1.objects.filter((object: {id: string}) => object.id === modelId),
    ).toHaveLength(1)
    expect(snapshot1.objects.length).toBe(snapshot0.objects.length + 1)

    // ── revision 冲突:「别人」在页面内先改,旧 expectedRevision 必冲突 ──
    const beforeRace = await skillJson(['call', 'scene.getSnapshot', '{}'])
    // demo 在桥接模式下 exposeGlobal:window.__cameraStudioApi 是宿主页内
    // JS API——此处只用它扮演「别人改了场景」的竞争写入者,不是 Agent 路径
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            (window as unknown as Record<string, unknown>).__cameraStudioApi,
          ),
        ),
      )
      .toBe(true)
    await page.evaluate(async (id) => {
      const api = (window as unknown as Record<string, any>).__cameraStudioApi
      await api.objects.update({
        objectId: id,
        props: {position: {x: 9, y: 0, z: 9}},
      })
    }, modelId)
    // revision 翻转经 core tick 生效:轮询快照确认竞争写入已落地,
    // 否则旧 expectedRevision 可能尚未失效(假冲突测试)
    await expect
      .poll(
        async () => {
          const snap = await skillJson(['call', 'scene.getSnapshot', '{}'])
          return snap.revision
        },
        {timeout: 15_000, intervals: [250, 500]},
      )
      .not.toBe(beforeRace.revision)

    const conflict = await skillError([
      'call',
      'objects.update',
      JSON.stringify({
        objectId: modelId,
        props: {position: {x: 1, y: 1, z: 1}},
        expectedRevision: beforeRace.revision,
      }),
    ])
    expect(conflict.code).toBe('REVISION_CONFLICT')

    // 按 errors.md / workflows.md 配方 6a 恢复:重读 → 新 revision → 重试成功
    const fresh = await skillJson(['call', 'scene.getSnapshot', '{}'])
    await skillJson([
      'call',
      'objects.update',
      JSON.stringify({
        objectId: modelId,
        props: {position: {x: 1, y: 1, z: 1}},
        expectedRevision: fresh.revision,
      }),
    ])
    const reread = await skillJson([
      'call',
      'objects.get',
      JSON.stringify({objectId: modelId}),
    ])
    expect(reread.props.position).toMatchObject({x: 1, y: 1, z: 1})

    // ── assets.delete + history.undo:资产不因撤销恢复 ──
    // errors.md「Asset operations do not undo」的行为级对照:删除先真实
    // 生效(否则后面的断言是空的),undo 后资产列表仍不含该条目
    const beforeDelete = await skillJson([
      'call',
      'assets.list',
      JSON.stringify({kind: 'model'}),
    ])
    expect(
      beforeDelete.some((entry: {id: string}) => entry.id === assetId),
    ).toBe(true)
    const deleteResult = await skillJson([
      'call',
      'assets.delete',
      JSON.stringify({assetId}),
    ])
    expect(deleteResult.deleted).toBe(true)
    const afterDelete = await skillJson([
      'call',
      'assets.list',
      JSON.stringify({kind: 'model'}),
    ])
    expect(
      afterDelete.some((entry: {id: string}) => entry.id === assetId),
    ).toBe(false)
    // history.undo 恢复的是项目状态;资产操作 Undoable:none,不进历史
    const undoBase = await skillJson(['call', 'scene.getSnapshot', '{}'])
    await skillJson([
      'call',
      'history.undo',
      JSON.stringify({expectedRevision: undoBase.revision}),
    ])
    const afterUndo = await skillJson([
      'call',
      'assets.list',
      JSON.stringify({kind: 'model'}),
    ])
    expect(afterUndo.some((entry: {id: string}) => entry.id === assetId)).toBe(
      false,
    )
  })
})
