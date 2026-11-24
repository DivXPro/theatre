/**
 * Agent HTTP 桥接真实浏览器端到端验收(2026-10-19,Task 8,spec §13.4)。
 *
 * 外部 Agent 视角:全部场景操作只经 Node fetch 打桥接 HTTP
 * (/v1/health、/v1/schema、/v1/commands、/v1/files、/v1/jobs/:id),
 * 浏览器页面唯一的职责是按 VITE_CAMERA_STUDIO_AGENT_* 配置连上桥接——
 * 不点任何 DOM、不读页面全局对象。
 *
 * 鉴权/去重也在本文件过真实 HTTP 验证(无凭据 401;同 requestId 重放
 * 返回首次结果且不重复创建对象)。桥接地址与 token 由
 * devEnv/playwright.config.ts 经环境变量注入;token 是测试常量,
 * 绝不打印。
 */
import {expect, test} from '@playwright/test'
import type {Page} from '@playwright/test'
import {mkdir, readFile, writeFile} from 'fs/promises'
import path from 'path'

const BRIDGE_HTTP = process.env.CAMERA_STUDIO_E2E_BRIDGE_HTTP
const TOKEN = process.env.CAMERA_STUDIO_E2E_TOKEN
if (!BRIDGE_HTTP || !TOKEN) {
  throw new Error(
    '缺少 CAMERA_STUDIO_E2E_* 环境变量:本测试必须由 devEnv/playwright.config.ts 启动',
  )
}

/** 内置模型文件(随包资产;上传走 POST /v1/files 原始字节) */
const MODEL_PATH = path.resolve(
  __dirname,
  '../../../packages/camera-studio/assets/models/Y Bot.glb',
)
const MODEL_NAME = 'Y Bot.glb'
const MODEL_MIME = 'model/gltf-binary'

const AUTH_HEADERS = {Authorization: `Bearer ${TOKEN}`}
const TERMINAL_JOB_STATES = new Set(['succeeded', 'failed', 'cancelled'])

/** 动画剪辑名:注入 Y Bot GLB 的测试剪辑,导入后以该名入库 */
const ANIM_CLIP_NAME = 'agent-e2e-bob'
const ANIM_MODEL_NAME = 'Y Bot (e2e animated).glb'
/** 手指骨命名规则(与 gestureProps.isFingerBoneName 同):挑身体姿势时排除手势条目 */
const FINGER_BONE = /Hand(?:Thumb|Index|Middle|Ring|Pinky)\d+$/

/**
 * 内置资产目录只有模型与姿势,没有动画;纯 HTTP 路径下唯一的动画来源是
 * 导入管线从 GLB 提取动作剪辑。这里给 Y Bot.glb 注入一条
 * mixamorigHips 平移剪辑(骨骼集合不变 → 骨架族不变),得到
 * 含动作的合法 GLB,上传导入后即产出同族动画条目。
 */
function buildAnimatedGlb(source: Buffer): Buffer {
  const jsonLength = source.readUInt32LE(12)
  const json = JSON.parse(
    source.subarray(20, 20 + jsonLength).toString('utf8'),
  ) as any
  const binLengthOffset = 20 + jsonLength
  const binLength = source.readUInt32LE(binLengthOffset)
  const bin = source.subarray(
    binLengthOffset + 8,
    binLengthOffset + 8 + binLength,
  )

  const pad4 = (n: number) => (n + 3) & ~3
  const timesOffset = pad4(bin.length)
  const times = new Float32Array([0, 0.5])
  const outputOffset = timesOffset + pad4(times.byteLength)
  const output = new Float32Array([0, 0, 0, 0, 0.25, 0])

  const hipsIndex = json.nodes.findIndex(
    (node: {name?: string}) => node.name === 'mixamorigHips',
  )
  if (hipsIndex < 0) throw new Error('Y Bot.glb 缺少 mixamorigHips 节点')

  const timeView = json.bufferViews.length
  json.bufferViews.push({
    buffer: 0,
    byteOffset: timesOffset,
    byteLength: times.byteLength,
  })
  json.bufferViews.push({
    buffer: 0,
    byteOffset: outputOffset,
    byteLength: output.byteLength,
  })
  const timeAccessor = json.accessors.length
  json.accessors.push({
    bufferView: timeView,
    componentType: 5126,
    count: 2,
    type: 'SCALAR',
    min: [0],
    max: [0.5],
  })
  json.accessors.push({
    bufferView: timeView + 1,
    componentType: 5126,
    count: 2,
    type: 'VEC3',
  })
  json.animations = [
    {
      name: ANIM_CLIP_NAME,
      channels: [{sampler: 0, target: {node: hipsIndex, path: 'translation'}}],
      samplers: [
        {
          input: timeAccessor,
          interpolation: 'LINEAR',
          output: timeAccessor + 1,
        },
      ],
    },
  ]
  // 标记节点:场景与首个导入的 Y Bot 完全一致时,导出模型字节相同 →
  // 内容哈希去重命中,模型条目被跳过,importModel 任务以「未找到新建条目」
  // 失败。加一个空节点让导出字节不同(不影响骨骼/顶点/骨架族)
  const markerIndex = json.nodes.length
  json.nodes.push({name: 'agent-e2e-marker'})
  json.scenes[0].nodes.push(markerIndex)
  json.buffers[0].byteLength = outputOffset + output.byteLength

  const newBin = Buffer.alloc(pad4(json.buffers[0].byteLength))
  bin.copy(newBin, 0)
  Buffer.from(times.buffer).copy(newBin, timesOffset)
  Buffer.from(output.buffer).copy(newBin, outputOffset)

  let jsonText = JSON.stringify(json)
  while (Buffer.byteLength(jsonText) % 4 !== 0) jsonText += ' '
  const jsonBuf = Buffer.from(jsonText, 'utf8')

  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + newBin.length, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonBuf.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4) // 'JSON'
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(newBin.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4) // 'BIN\0'
  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, newBin])
}

let requestCounter = 0
/** requestId:测试内自增,显式可复用(去重断言用同一 id 重放) */
function nextRequestId(label: string): string {
  requestCounter += 1
  return `e2e-${process.pid}-${requestCounter}-${label}`
}

async function apiGet(pathname: string): Promise<{status: number; body: any}> {
  const res = await fetch(`${BRIDGE_HTTP}${pathname}`, {
    headers: AUTH_HEADERS,
  })
  return {status: res.status, body: await res.json()}
}

async function callCommand(
  name: string,
  args: unknown,
  requestId = nextRequestId(name),
): Promise<{status: number; body: any}> {
  const res = await fetch(`${BRIDGE_HTTP}/v1/commands`, {
    method: 'POST',
    headers: {...AUTH_HEADERS, 'Content-Type': 'application/json'},
    body: JSON.stringify({requestId, name, args}),
  })
  return {status: res.status, body: await res.json()}
}

/** 命令必须成功;失败时抛出结构化错误码与信息(不含任何凭据) */
async function mustCommand(
  name: string,
  args: unknown,
  requestId?: string,
): Promise<any> {
  const {status, body} = await callCommand(name, args, requestId)
  if (!body?.ok) {
    const code = body?.error?.code ?? 'NO_ERROR_FIELD'
    const message = body?.error?.message ?? '(无 message)'
    throw new Error(`${name} 失败(HTTP ${status}): ${code} — ${message}`)
  }
  return body
}

/** job 命令:202 + accepted 快照;返回 jobId */
async function startJob(name: string, args: unknown): Promise<string> {
  const {status, body} = await callCommand(name, args)
  if (status !== 202 || !body?.ok || typeof body.result?.jobId !== 'string') {
    const code = body?.error?.code ?? 'NO_ERROR_FIELD'
    const message = body?.error?.message ?? '(无 message)'
    throw new Error(
      `${name} 未按 job 应答(HTTP ${status}): ${code} — ${message}`,
    )
  }
  return body.result.jobId
}

/** 轮询任务到终态(succeeded/failed/cancelled) */
async function waitJob(jobId: string, timeoutMs = 120_000): Promise<any> {
  const deadline = Date.now() + timeoutMs
  let lastState = '(未取到)'
  for (;;) {
    const {status, body} = await apiGet(`/v1/jobs/${jobId}`)
    if (status === 200 && body?.ok) {
      lastState = body.result.state
      if (TERMINAL_JOB_STATES.has(body.result.state)) return body.result
    }
    if (Date.now() > deadline) {
      throw new Error(`任务 ${jobId} 轮询超时,最后状态: ${lastState}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/** 等浏览器场景连上桥接(health 的 scene === 'connected') */
async function waitSceneConnected(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const {status, body} = await apiGet('/v1/health')
      if (status === 200 && body?.result?.scene === 'connected') return
    } catch {
      /* 桥接尚未就绪,继续轮询 */
    }
    if (Date.now() > deadline) {
      throw new Error(
        '浏览器场景未在时限内连接桥接——demo 是否注入了 ' +
          'VITE_CAMERA_STUDIO_AGENT_WS/HTTP/TOKEN 三个环境变量?',
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/** 打开 demo 页面并等到桥接侧看到场景连接;之后纯 HTTP 驱动 */
async function bootScene(page: Page): Promise<void> {
  await page.goto('/')
  await waitSceneConnected()
}

test.describe('agent http bridge e2e', () => {
  test.describe.configure({mode: 'serial'})

  test('agent api: 纯 HTTP 完整场景工作流', async ({page}, testInfo) => {
    await bootScene(page)

    // ── 鉴权:无凭据一律 401 ─────────────────────────────
    const noAuth = await fetch(`${BRIDGE_HTTP}/v1/health`)
    expect(noAuth.status).toBe(401)

    // ── 1. health / schema ──────────────────────────────
    const health = await apiGet('/v1/health')
    expect(health.status).toBe(200)
    expect(health.body.result.bridge).toBe('running')
    expect(health.body.result.scene).toBe('connected')

    const schema = await apiGet('/v1/schema')
    expect(schema.status).toBe(200)
    const schemaFile = testInfo.outputPath('agent-schema.json')
    await mkdir(path.dirname(schemaFile), {recursive: true})
    await writeFile(schemaFile, JSON.stringify(schema.body, null, 2))

    const commandNames = schema.body.result.commands.map(
      (command: {name: string}) => command.name,
    )
    for (const expected of [
      'scene.getSnapshot',
      'assets.importModel',
      'assets.list',
      'models.create',
      'objects.update',
      'poses.apply',
      'poses.clear',
      'animations.apply',
      'animations.clear',
      'animations.getStatus',
      'sequence.setLength',
      'keyframes.set',
      'sequence.seek',
      'cameras.create',
      'paths.createPreset',
      'cameras.bindPath',
      'project.exportState',
      'objects.delete',
      'exports.startVideo',
    ]) {
      expect(commandNames).toContain(expected)
    }

    // ── 2. 上传模型文件 → fileId ────────────────────────
    const glb = await readFile(MODEL_PATH)
    const upload = await fetch(`${BRIDGE_HTTP}/v1/files`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'Content-Type': MODEL_MIME,
        'X-File-Name': encodeURIComponent(MODEL_NAME),
      },
      body: glb,
    })
    expect(upload.status).toBe(201)
    const uploaded = (await upload.json()).result
    expect(uploaded.fileId).toBeTruthy()
    expect(uploaded.size).toBe(glb.byteLength)

    // ── 3. assets.importModel(任务)→ 轮询到终态 ────────
    const importJobId = await startJob('assets.importModel', {
      file: {
        fileId: uploaded.fileId,
        fileName: MODEL_NAME,
        mimeType: MODEL_MIME,
      },
    })
    const importFinal = await waitJob(importJobId)
    expect(importFinal.state).toBe('succeeded')
    const assetId = importFinal.result.id
    expect(importFinal.result.kind).toBe('model')
    const modelRig = importFinal.result.rig as string
    expect(modelRig.startsWith('rig-')).toBe(true)

    // ── 4. models.create ────────────────────────────────
    const createRequestId = nextRequestId('models.create')
    const created = await mustCommand(
      'models.create',
      {assetId, position: {x: 0, y: 0, z: 0}},
      createRequestId,
    )
    const modelId = created.result.objectId as string
    expect(modelId.startsWith('model:')).toBe(true)
    expect(typeof created.result.revision).toBe('number')

    // ── 去重:同 requestId 重放返回首次结果,不重复创建 ──
    const replay = await callCommand(
      'models.create',
      {assetId, position: {x: 0, y: 0, z: 0}},
      createRequestId,
    )
    expect(replay.body.ok).toBe(true)
    expect(replay.body.result.objectId).toBe(modelId)

    // ── 5. scene.getSnapshot 验证模型已挂载(且只有一份)─
    const snapshot1 = (await mustCommand('scene.getSnapshot', {})).result
    const placed = snapshot1.objects.filter(
      (object: {id: string}) => object.id === modelId,
    )
    expect(placed).toHaveLength(1)
    expect(placed[0].kind).toBe('model')
    expect(placed[0].mounted).toBe(true)

    // ── 6. objects.update 移动模型并读回验证 ────────────
    await mustCommand('objects.update', {
      objectId: modelId,
      props: {position: {x: 2, y: 0, z: -1}},
    })
    const moved = (await mustCommand('objects.get', {objectId: modelId})).result
    expect(moved.props.position).toMatchObject({x: 2, y: 0, z: -1})

    // ── 6b. 姿势:运行时列出 → 应用 → 读回 → 清除(spec §13.4)─
    // 不硬编码姿势 id:assets.list 实时列出内置目录,挑身体姿势(手势条目
    // 只含手指骨,与全身姿势按同一规则区分)。骨架族优先精确匹配——但
    // GLB 运行时的 rigIdOf 与内置目录的 FBX 判定基准不同(seedAssetsManifest
    // 头注:勿用 GLB joints 重算),GLB 导入的 Y Bot 与内置姿势 rig 哈希
    // 不字面相等;poses.apply 不校验 rig(骨骼按名对齐),故无同族命中时
    // 回退到任一身体姿势,断言仍落在 props.pose 的可观测值上
    const poseEntries = (await mustCommand('assets.list', {kind: 'pose'}))
      .result as Array<{
      id: string
      kind: string
      rig?: string
      bones?: Record<string, unknown>
    }>
    const isBodyPose = (entry: {bones?: Record<string, unknown>}) => {
      const boneNames = Object.keys(entry.bones ?? {})
      return (
        boneNames.length > 0 &&
        !boneNames.every((name) => FINGER_BONE.test(name))
      )
    }
    const bodyPose =
      poseEntries.find(
        (entry) => entry.rig === modelRig && isBodyPose(entry),
      ) ?? poseEntries.find(isBodyPose)
    expect(
      bodyPose,
      `内置目录应含身体姿势(共 ${poseEntries.length} 条姿势,` +
        `rig 集合: ${[...new Set(poseEntries.map((entry) => entry.rig))].join(
          ', ',
        )},` +
        `模型 rig: ${modelRig})`,
    ).toBeTruthy()
    const poseApplied = (
      await mustCommand('poses.apply', {
        objectId: modelId,
        assetId: bodyPose!.id,
      })
    ).result
    expect(typeof poseApplied.revision).toBe('number')
    const withPose = (await mustCommand('objects.get', {objectId: modelId}))
      .result
    expect(JSON.parse(withPose.props.pose)).toEqual({
      kind: 'lib',
      id: bodyPose!.id,
    })
    const poseCleared = (await mustCommand('poses.clear', {objectId: modelId}))
      .result
    expect(poseCleared.cleared).toBe(true)
    const afterPoseClear = (
      await mustCommand('objects.get', {objectId: modelId})
    ).result
    expect(afterPoseClear.props.pose ?? '').toBe('')

    // ── 6c. 动画:上传带剪辑的同骨架 GLB → 导入提取 → 应用 → 状态 → 清除 ──
    // 内置目录无动画资产;给 Y Bot.glb 注入一条剪辑(buildAnimatedGlb)
    // 后经同一 importModel 任务入库,管线自动提取动画条目
    const animatedGlb = buildAnimatedGlb(glb)
    const animUpload = await fetch(`${BRIDGE_HTTP}/v1/files`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'Content-Type': MODEL_MIME,
        'X-File-Name': encodeURIComponent(ANIM_MODEL_NAME),
      },
      body: animatedGlb,
    })
    expect(animUpload.status).toBe(201)
    const animFileId = (await animUpload.json()).result.fileId as string
    const animImportJobId = await startJob('assets.importModel', {
      file: {
        fileId: animFileId,
        fileName: ANIM_MODEL_NAME,
        mimeType: MODEL_MIME,
      },
    })
    const animImportFinal = await waitJob(animImportJobId)
    expect(
      animImportFinal.state,
      `动画 GLB 导入任务失败: ${JSON.stringify(
        animImportFinal.error ?? animImportFinal,
      ).slice(0, 500)}`,
    ).toBe('succeeded')

    const animationEntries = (
      await mustCommand('assets.list', {kind: 'animation'})
    ).result as Array<{id: string; name: string; rig?: string}>
    const clipEntry = animationEntries.find(
      (entry) => entry.rig === modelRig && entry.name === ANIM_CLIP_NAME,
    )
    expect(clipEntry, '导入管线应从注入剪辑的 GLB 提取出动画条目').toBeTruthy()

    const animApplied = (
      await mustCommand('animations.apply', {
        objectId: modelId,
        assetId: clipEntry!.id,
      })
    ).result
    expect(typeof animApplied.revision).toBe('number')
    const withAnimation = (
      await mustCommand('objects.get', {objectId: modelId})
    ).result
    expect(withAnimation.props.animation).toBe(clipEntry!.id)

    // 运行时状态:apply 后加载登记异步完成,轮询到 loaded === true
    // (props 有值但无登记 = 加载中,如实报,绝不伪造)
    await expect
      .poll(
        async () => {
          const status = (
            await mustCommand('animations.getStatus', {objectId: modelId})
          ).result
          return {assetId: status.assetId, loaded: status.loaded}
        },
        {timeout: 30_000, intervals: [250, 500, 1_000]},
      )
      .toEqual({assetId: clipEntry!.id, loaded: true})

    await mustCommand('animations.clear', {objectId: modelId})
    const afterAnimClear = (
      await mustCommand('animations.getStatus', {objectId: modelId})
    ).result
    expect(afterAnimClear.loaded).toBe(false)
    expect(afterAnimClear.assetId).toBeUndefined()
    const animClearedProps = (
      await mustCommand('objects.get', {objectId: modelId})
    ).result
    expect(animClearedProps.props.animation ?? '').toBe('')

    await test.step('edit animation tracks and clips through HTTP', async () => {
      const objectId = modelId
      await mustCommand('sequence.setLength', {length: 4})
      const listed = async () =>
        (await mustCommand('animationStrips.list', {objectId})).result.tracks
      expect(await listed()).toEqual([])
      const first = (
        await mustCommand('animationStrips.createTrack', {
          objectId,
          kind: 'bone',
        })
      ).result
      const second = (
        await mustCommand('animationStrips.createTrack', {
          objectId,
          kind: 'bone',
        })
      ).result
      const timing = {startMs: 100, sourceInMs: 0, sourceOutMs: 300}
      const clip = (
        await mustCommand('animationStrips.insert', {
          objectId,
          trackId: first.trackId,
          assetId: clipEntry!.id,
          ...timing,
          expectedRevision: second.revision,
        })
      ).result
      const stale = await callCommand('animationStrips.remove', {
        objectId,
        stripId: clip.stripId,
        expectedRevision: second.revision,
      })
      expect(stale.body.error.code).toBe('REVISION_CONFLICT')
      const overlap = await callCommand('animationStrips.insert', {
        objectId,
        trackId: second.trackId,
        assetId: clipEntry!.id,
        ...timing,
      })
      expect(overlap.body.error.code).toBe('INVALID_STATE')
      await mustCommand('animationStrips.updateTiming', {
        objectId,
        stripId: clip.stripId,
        startMs: 400,
        sourceInMs: 20,
        sourceOutMs: 150,
        repeat: 2,
      })
      await mustCommand('animationStrips.moveToTrack', {
        objectId,
        stripId: clip.stripId,
        trackId: second.trackId,
      })
      expect(await listed()).toEqual([
        {id: first.trackId, kind: 'bone', strips: []},
        {
          id: second.trackId,
          kind: 'bone',
          strips: [
            expect.objectContaining({
              id: clip.stripId,
              startMs: 400,
              sourceInMs: 20,
              sourceOutMs: 150,
              repeat: 2,
            }),
          ],
        },
      ])
      await mustCommand('history.undo', {})
      expect((await listed())[0].strips[0].id).toBe(clip.stripId)
      await mustCommand('history.redo', {})
      await mustCommand('animationStrips.remove', {
        objectId,
        stripId: clip.stripId,
      })
      await mustCommand('animationStrips.removeTrack', {
        objectId,
        trackId: first.trackId,
      })
      await mustCommand('animationStrips.removeTrack', {
        objectId,
        trackId: second.trackId,
      })

      const {trackId} = (
        await mustCommand('animationStrips.createTrack', {
          objectId,
          kind: 'object',
        })
      ).result
      const objectStrip = (
        await mustCommand('animationStrips.insert', {
          objectId,
          trackId,
          objectChannels: ['position'],
          ...timing,
        })
      ).result
      expect((await listed())[0].strips[0]).toMatchObject({
        id: objectStrip.stripId,
        objectChannels: ['position'],
      })
      await mustCommand('animationStrips.removeTrack', {objectId, trackId})
      expect(await listed()).toEqual([])
    })

    await test.step('discover, preview, cancel and commit Fullbody IK through HTTP', async () => {
      const objectId = modelId
      const getObject = async () =>
        (await mustCommand('objects.get', {objectId})).result
      const before = (await getObject()).props.pose ?? ''
      const outside = await callCommand('poses.session.listIkPoints', {})
      expect(outside.body.error.code).toBe('INVALID_STATE')
      const editHand = async () => {
        await mustCommand('poses.session.start', {objectId})
        const state = (await mustCommand('poses.session.listIkPoints', {}))
          .result
        expect(state.objectId).toBe(objectId)
        const hand = state.points.find(
          (point: {pointId: string}) => point.pointId === 'armL',
        )
        expect(hand).toBeTruthy()
        const invalid = await callCommand('poses.session.setIkTarget', {
          pointId: hand.pointId,
          quaternion: {x: 0, y: 0, z: 0, w: 0},
        })
        expect(invalid.body.error.code).toBe('INVALID_ARGUMENT')
        const response = await mustCommand('poses.session.setIkTarget', {
          pointId: hand.pointId,
          position: {...hand.position, y: hand.position.y + 0.15},
        })
        expect(response.result.point.position.y).toBeGreaterThan(
          hand.position.y + 0.01,
        )
        expect((await getObject()).props.pose ?? '').toBe(before)
      }
      await editHand()
      await mustCommand('poses.session.cancel', {})
      expect((await getObject()).props.pose ?? '').toBe(before)
      await editHand()
      await mustCommand('poses.session.commit', {})
      const poseFrames = (
        await mustCommand('keyframes.list', {objectId, propPath: ['pose']})
      ).result
      expect(poseFrames).toHaveLength(1)
      expect(JSON.parse(poseFrames[0].value)).toMatchObject({
        kind: 'custom',
        bones: expect.any(Object),
      })
      await mustCommand('poses.clear', {objectId})
    })

    // ── 7. sequence.setLength / keyframes.set / sequence.seek ──
    await mustCommand('sequence.setLength', {length: 4})
    await mustCommand('keyframes.set', {
      objectId: modelId,
      propPath: ['position', 'x'],
      at: 2,
      value: 4,
    })
    const keyframes = (
      await mustCommand('keyframes.list', {
        objectId: modelId,
        propPath: ['position', 'x'],
      })
    ).result
    expect(
      keyframes.some(
        (keyframe: {position: number; value: number}) =>
          Math.abs(keyframe.position - 2) < 1e-6 && keyframe.value === 4,
      ),
    ).toBe(true)
    const seeked = (await mustCommand('sequence.seek', {position: 1})).result
    expect(seeked.length).toBe(4)
    expect(seeked.position).toBeCloseTo(1, 6)
    expect(seeked.playing).toBe(false)

    // ── 8. cameras.create / paths.createPreset / cameras.bindPath ──
    const camera = (
      await mustCommand('cameras.create', {fromCurrentView: true})
    ).result
    expect(camera.objectId.startsWith('camera:')).toBe(true)
    const pathResult = (
      await mustCommand('paths.createPreset', {preset: 'circle'})
    ).result
    expect(pathResult.pathId.startsWith('path:')).toBe(true)
    expect(pathResult.pointKeys.length).toBeGreaterThan(1)
    await mustCommand('cameras.bindPath', {
      objectId: camera.objectId,
      pathId: pathResult.pathId,
    })
    const bound = (
      await mustCommand('objects.get', {objectId: camera.objectId})
    ).result
    expect(bound.props.pathKey).toBe(pathResult.pathId.slice('path:'.length))

    await test.step('bind and animate character path progress through HTTP', async () => {
      const objectId = modelId
      const pathId = pathResult.pathId
      const getBinding = async () =>
        (await mustCommand('characterPaths.get', {objectId})).result
      expect((await getBinding()).status).toBe('unbound')
      await mustCommand('characterPaths.bind', {
        objectId,
        pathId,
        orient: false,
      })
      expect(await getBinding()).toMatchObject({
        pathId,
        status: 'active',
        orient: false,
      })
      await mustCommand('keyframes.set', {
        objectId,
        propPath: ['characterPathProgress'],
        at: 1,
        value: 35,
      })
      expect((await getBinding()).progress).toBe(35)
      await mustCommand('characterPaths.unbind', {objectId})
      expect((await getBinding()).status).toBe('unbound')
      await mustCommand('history.undo', {})
      expect(await getBinding()).toMatchObject({
        pathId,
        status: 'active',
        progress: 35,
      })
      await mustCommand('characterPaths.unbind', {objectId})
    })

    await test.step('change manga viewport settings through HTTP', async () => {
      const before = (await mustCommand('view.getRendering', {})).result
      const changed = {
        mode: 'line',
        castShadow: true,
        shadingPreset: 'dark',
        characterNamesVisible: true,
      }
      expect((await mustCommand('view.setRendering', changed)).result).toEqual(
        changed,
      )
      expect((await mustCommand('view.getRendering', {})).result).toEqual(
        changed,
      )
      const invalid = await callCommand('view.setRendering', {
        shadingPreset: 'invalid',
        mode: 'original',
      })
      expect(invalid.body.error.code).toBe('INVALID_ARGUMENT')
      expect((await mustCommand('view.getRendering', {})).result).toEqual(
        changed,
      )
      expect(
        (await mustCommand('view.setRendering', {castShadow: false})).result,
      ).toEqual({...changed, castShadow: false})
      await mustCommand('view.setRendering', before)
    })

    // ── 9. project.exportState ──────────────────────────
    const exported = (await mustCommand('project.exportState', {})).result
    expect(exported.projectId).toBe('Space')
    expect(typeof exported.content).toBe('object')

    // ── 10. objects.delete 并验证清理 ───────────────────
    const deleted = (await mustCommand('objects.delete', {objectId: modelId}))
      .result
    expect(deleted.deleted).toBe(modelId)
    const snapshot2 = (await mustCommand('scene.getSnapshot', {})).result
    expect(
      snapshot2.objects.some((object: {id: string}) => object.id === modelId),
    ).toBe(false)
  })

  test('agent api: 视频导出(任务 + 文件下载)', async ({page}) => {
    await bootScene(page)

    // 能力探测与 exportRuntime 的 pickMimeType 同一候选集;环境无可用
    // 格式时明确 skip——视频路径不算验证过(验收汇报须单列)
    const recorderAvailable = await page.evaluate(() => {
      const candidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4',
      ]
      return (
        typeof MediaRecorder !== 'undefined' &&
        candidates.some((mimeType) => MediaRecorder.isTypeSupported(mimeType))
      )
    })
    test.skip(
      !recorderAvailable,
      '运行环境无 MediaRecorder 可用格式:视频导出路径未验证',
    )

    const camera = (
      await mustCommand('cameras.create', {fromCurrentView: true})
    ).result
    await mustCommand('sequence.setLength', {length: 0.2})

    // 录制发生在 sequence 播放期间(frameloop=demand,只有画面变化才出帧)。
    // 静止场景 0.2s 内可能一帧不出 → MediaRecorder 产出 0 字节(实测偶发)。
    // 给相机位置打两帧动画,播放期画面持续变化;再完整播放一遍热身
    // (冷页面首帧渲染管线就绪慢,热身前实测输出在 0~2KB 间漂移),
    // 热身后的录制输出稳定在数十 KB
    const cameraId = camera.objectId as string
    const baseX = (
      (await mustCommand('objects.get', {objectId: cameraId})).result.props
        .position as {x: number}
    ).x
    await mustCommand('keyframes.set', {
      objectId: cameraId,
      propPath: ['position', 'x'],
      at: 0,
      value: baseX,
    })
    await mustCommand('keyframes.set', {
      objectId: cameraId,
      propPath: ['position', 'x'],
      at: 0.2,
      value: baseX + 1.5,
    })
    await mustCommand('sequence.seek', {position: 0})
    await mustCommand('sequence.play', {})
    await mustCommand('sequence.seek', {position: 0})

    const exportJobId = await startJob('exports.startVideo', {
      cameraId,
    })
    const exportFinal = await waitJob(exportJobId, 120_000)
    expect(
      exportFinal.state,
      JSON.stringify(exportFinal.error ?? exportFinal),
    ).toBe('succeeded')
    const file = exportFinal.result
    expect(typeof file.fileId).toBe('string')
    expect(
      file.size,
      `导出文件应非空(任务快照: ${JSON.stringify(exportFinal).slice(0, 400)})`,
    ).toBeGreaterThan(0)

    const download = await fetch(`${BRIDGE_HTTP}/v1/files/${file.fileId}`, {
      headers: AUTH_HEADERS,
    })
    expect(download.status).toBe(200)
    const bytes = await download.arrayBuffer()
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(bytes.byteLength).toBe(file.size)
  })
})
