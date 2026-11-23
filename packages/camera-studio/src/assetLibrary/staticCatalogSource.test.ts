/**
 * StaticCatalogSource(内置资产目录源)契约:
 * - 条目来自入库清单 + 姿势数据模块,数量一律数据驱动(不写死);
 * - 新内置模型 id = seed-model-<contentHash>,替换时保持原 id。动画 id =
 *   seed-animation-<contentHash>,姿势 id 保持 seed-pose-*;
 * - blobId 全部带 catalog: 前缀,聚合器按前缀路由回本源;
 * - 静态文件(models/animations/poseThumbs)纯拼接 baseUrl 不探测;
 * - 运行时缩略图(模型/身体姿势)走注入渲染器,内存缓存,缺注入抛 not-found;
 * - 清单 rig 与运行时 FBX 解析同一判定(parity 兜底)。
 */
import fs from 'fs'
import path from 'path'
import {FBXLoader, GLTFLoader} from 'three-stdlib'
import {AnimationMixer, LoopOnce, Vector3} from 'three'
import {WebIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import draco3dgltf from 'draco3dgltf'
import {LibraryError} from './source'
import {StaticCatalogSource} from './staticCatalogSource'
import {buildBuiltinPoseEntries} from './seedBuiltinPoses'
import {seedAssetsManifest} from './seedAssetsManifest'
import {seedPoses} from './seedPoses'
import {seedPosesDpl} from './seedPosesDpl'
import {seedPosesQbx} from './seedPosesQbx'
import {collectBoneNames, rigIdOf} from './rig'
import {hashBytes} from './hash'
import {animationClipForModel} from './animationClipForModel'
import {Library} from './library'
import {loadLibraryModel} from '../PlacementManager'
import type {AnimationEntry, ModelEntry, PoseEntry} from './types'

const BASE = 'https://cdn.example.com/a/'

describe('StaticCatalogSource', () => {
  test('目录源:条目齐全,id 前缀与 blobId 路由正确', async () => {
    const src = new StaticCatalogSource({baseUrl: BASE})
    const models = (await src.listEntries('model')) as ModelEntry[]
    const poses = (await src.listEntries('pose')) as PoseEntry[]
    const animations = (await src.listEntries('animation')) as AnimationEntry[]
    // 数据驱动计数:清单与姿势数据模块是唯一事实源
    expect(models).toHaveLength(seedAssetsManifest.models.length)
    expect(animations).toHaveLength(seedAssetsManifest.animations.length)
    expect(poses).toHaveLength(buildBuiltinPoseEntries().length)
    expect(poses).toHaveLength(
      seedPoses.length + seedPosesDpl.length + seedPosesQbx.length,
    )
    expect(models.every((m) => m.id.startsWith('seed-model-'))).toBe(true)
    expect(animations.every((a) => a.id.startsWith('seed-animation-'))).toBe(
      true,
    )
    expect(poses.every((p) => p.id.startsWith('seed-pose-'))).toBe(true)
    // 模型 blobId 带 catalog: 前缀,聚合器按前缀路由;URL 纯拼接
    expect(models.every((m) => m.blobId.startsWith('catalog:models/'))).toBe(
      true,
    )
    expect(
      animations.every((a) => a.blobId.startsWith('catalog:animations/')),
    ).toBe(true)
    const url = await src.getBlobUrl(models[0].blobId)
    expect(url.startsWith(`${BASE}models/`)).toBe(true)
    // getEntry 按 id 直查
    expect(await src.getEntry(models[0].id)).toMatchObject({id: models[0].id})
    expect(await src.getEntry('seed-pose-nope')).toBeUndefined()
    // 不分 kind 时全量返回
    expect(await src.listEntries()).toHaveLength(
      models.length + poses.length + animations.length,
    )
    // 只读目录:不可写,URL 长效可跨挂载缓存
    expect(src.capabilities).toMatchObject({
      writable: false,
      permanentUrls: true,
    })
  })

  test('重复动作只出现在列表一次，旧 id 仍可解析且保留原动作包', async () => {
    const src = new StaticCatalogSource({baseUrl: BASE})
    const animations = await src.listEntries('animation')
    const walking = animations.find(
      (entry) => entry.name === 'Mixamo Locomotion - Walking',
    )
    expect(walking).toMatchObject({
      id: 'seed-animation-596a643bff763552',
      packs: expect.arrayContaining(['Locomotion', 'Basic Locomotion']),
    })
    expect(
      animations.some(
        (entry) => entry.id === 'seed-animation-a2fe5381c78cfd7c',
      ),
    ).toBe(false)
    expect(await src.getEntry('seed-animation-a2fe5381c78cfd7c')).toEqual(
      walking,
    )
  })

  test('替换后的模型继续使用已有场景保存的条目 id', async () => {
    const renderModelThumb = jest.fn(async () => 'blob:guide-line')
    const src = new StaticCatalogSource({baseUrl: BASE, renderModelThumb})
    const entry = (await src.getEntry(
      'seed-model-7fb79917fb779026',
    )) as ModelEntry

    expect(entry.name).toBe('MangaKa Building blocks - Guide_line')
    expect(entry.contentHash).not.toBe('7fb79917fb779026')
    expect(
      (await src.listEntries('model')).find(
        (model) => model.name === entry.name,
      ),
    ).toEqual(entry)
    expect(await src.getBlobUrl(entry.thumbnailId!)).toBe('blob:guide-line')
    expect(renderModelThumb).toHaveBeenCalledWith(entry)
  })

  test('内置动画:清单 id/hash/时长与 GLB 一致,可直接解析 URL', async () => {
    const src = new StaticCatalogSource({baseUrl: BASE})
    const animations = (await src.listEntries('animation')) as AnimationEntry[]
    const walk = animations.find((a) => a.name === 'Mixamo Walk In Place')!
    expect(walk).toMatchObject({
      id: `seed-animation-${walk.contentHash}`,
      rig: seedAssetsManifest.models.find((m) => m.name === 'Y Bot')!.rig,
    })
    expect(await src.getBlobUrl(walk.blobId)).toBe(
      `${BASE}animations/Mixamo%20Walk%20In%20Place.glb`,
    )
    expect(await src.getEntry('seed-animation-ab4087fbd0abb244')).toEqual(walk)

    const glb = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../assets/animations/Mixamo Walk In Place.glb',
      ),
    )
    expect(walk.contentHash).toBe(hashBytes(new Uint8Array(glb)))
    const io = new WebIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        'draco3d.decoder': await draco3dgltf.createDecoderModule(),
      })
    const doc = await io.readBinary(new Uint8Array(glb))
    expect(
      doc
        .getRoot()
        .listNodes()
        .find((node) => node.getName() === 'AnimationRig')
        ?.getExtras().animationMetersPerUnit,
    ).toBe(0.01)
    const duration = Math.max(
      ...doc
        .getRoot()
        .listAnimations()
        .flatMap((animation) =>
          animation
            .listSamplers()
            .map((sampler) => sampler.getInput()?.getArray()?.at(-1) ?? 0),
        ),
    )
    expect(walk.duration).toBeCloseTo(duration, 6)
    expect(duration).toBeCloseTo(32 / 30, 6)

    const hipsTracks = doc
      .getRoot()
      .listAnimations()[0]
      .listChannels()
      .filter(
        (channel) => channel.getTargetNode()?.getName() === 'mixamorigHips',
      )
    const hipsTranslation = hipsTracks
      .find((channel) => channel.getTargetPath() === 'translation')!
      .getSampler()!
      .getOutput()!
      .getArray()!
    const hipsRotation = hipsTracks
      .find((channel) => channel.getTargetPath() === 'rotation')!
      .getSampler()!
      .getOutput()!
      .getArray()!
    for (let frame = 0; frame < 33; frame++) {
      expect(hipsTranslation[frame * 3 + 1]).toBeGreaterThan(90)
      expect(hipsTranslation[frame * 3]).toBeCloseTo(0, 6)
      expect(hipsTranslation[frame * 3 + 2]).toBeCloseTo(0, 6)
      expect(Math.abs(hipsRotation[frame * 4])).toBeLessThan(0.03)
    }
  })

  test('Mixamo 起身动作在 X Bot 和 Y Bot 上保留相同的髋部位移', async () => {
    const src = new StaticCatalogSource({baseUrl: BASE})
    const animations = await src.listEntries('animation')
    const standUp = animations.find(
      (entry) => entry.name === 'Mixamo Zombie Stand Up',
    )
    expect(standUp).toMatchObject({
      kind: 'animation',
      duration: expect.any(Number),
    })
    const animationBytes = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../assets/animations/Mixamo Zombie Stand Up.glb',
      ),
    )
    const gltf = await new GLTFLoader().parseAsync(
      Uint8Array.from(animationBytes).buffer,
      '',
    )
    const models = await src.listEntries('model')
    const heights = await Promise.all(
      ['X Bot', 'Y Bot'].map(async (name) => {
        const entry = models.find((model) => model.name === name)
        expect(entry).toMatchObject({rig: (standUp as AnimationEntry).rig})
        const bytes = fs.readFileSync(
          path.resolve(__dirname, `../../assets/models/${name}.glb`),
        )
        const json = JSON.parse(
          bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)),
        )
        const {scene: model} = await new GLTFLoader().parseAsync(
          JSON.stringify({
            asset: json.asset,
            nodes: json.nodes.map(
              ({mesh, skin, ...node}: Record<string, unknown>) => node,
            ),
            skins: json.skins,
            scenes: json.scenes,
            scene: json.scene,
          }),
          '',
        )
        const clip = animationClipForModel(gltf, model)!
        const hips = model.getObjectByName('mixamorigHips')!
        const mixer = new AnimationMixer(model)
        mixer.clipAction(clip).setLoop(LoopOnce, 1).play()
        mixer.setTime(0)
        const start = hips.getWorldPosition(new Vector3()).y
        mixer.setTime(3)
        return hips.getWorldPosition(new Vector3()).y - start
      }),
    )
    expect(heights[0]).toBeGreaterThan(0.5)
    expect(heights[0]).toBeCloseTo(heights[1], 5)
  })

  test('QBX 预览图走静态文件;身体姿势缩略图走注入渲染器(内存缓存,不落地)', async () => {
    const renderPoseThumb = jest.fn(async () => 'data:image/png;base64,x')
    const src = new StaticCatalogSource({
      baseUrl: BASE,
      renderPoseThumb,
    })
    const poses = (await src.listEntries('pose')) as PoseEntry[]
    // QBX 子集 = 手势数据模块全量,且每个 key 都命中清单预览图
    const qbx = poses.filter((p) => p.id.startsWith('seed-pose-qbx-'))
    expect(qbx).toHaveLength(seedPosesQbx.length)
    expect(
      qbx.every((p) => p.thumbnailId?.startsWith('catalog:poseThumbs/')),
    ).toBe(true)
    const qbx0 = poses.find(
      (p) => p.id === 'seed-pose-qbx-hands-01-base-base-l',
    )!
    expect(await src.getBlobUrl(qbx0.thumbnailId!)).toContain(
      `${BASE}poseThumbs/`,
    )
    // 非 QBX(身体姿势):thumbnailId 走运行时渲染,渲染结果内存缓存
    const dpl = poses.find((p) => !p.id.startsWith('seed-pose-qbx-'))!
    expect(dpl.thumbnailId).toBe(`catalog:runtime/pose/${dpl.id}`)
    const t1 = await src.getBlobUrl(dpl.thumbnailId!)
    const t2 = await src.getBlobUrl(dpl.thumbnailId!)
    expect(t1).toBe('data:image/png;base64,x')
    expect(renderPoseThumb).toHaveBeenCalledTimes(1) // 内存缓存
    expect(t2).toBe(t1)
  })

  test('模型缩略图走 renderModelThumb 注入;缺注入抛 LibraryError(not-found)', async () => {
    const renderModelThumb = jest.fn(async () => 'blob:model-thumb')
    const src = new StaticCatalogSource({baseUrl: BASE, renderModelThumb})
    const [model] = (await src.listEntries('model')) as ModelEntry[]
    // thumbnailId = catalog:runtime/model/<key>,key 来自清单
    const key = seedAssetsManifest.models[0].key
    expect(model.thumbnailId).toBe(`catalog:runtime/model/${key}`)
    expect(await src.getBlobUrl(model.thumbnailId!)).toBe('blob:model-thumb')
    expect(renderModelThumb).toHaveBeenCalledTimes(1)

    const bare = new StaticCatalogSource({baseUrl: BASE})
    await expect(bare.getBlobUrl(model.thumbnailId!)).rejects.toThrow(
      LibraryError,
    )
    await expect(bare.getBlobUrl(model.thumbnailId!)).rejects.toMatchObject({
      code: 'not-found',
    })
    // 未知 blobId / 非本目录前缀同样 not-found
    await expect(bare.getBlobUrl('catalog:bogus/x')).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  test('清单 rig 与运行时解析一致(FBXLoader + rigIdOf 同一函数)', async () => {
    // 清单 rig 来自生成脚本对 FBX 的 rigIdOf;这里独立重算一遍兜底
    const fbxPath = path.resolve(
      __dirname,
      '../../scripts/pose-pipeline/models/Y Bot.fbx',
    )
    const buf = fs.readFileSync(fbxPath)
    const root = new FBXLoader().parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      '',
    )
    const manifestModel = seedAssetsManifest.models.find(
      (m) => m.name === 'Y Bot',
    )!
    expect(manifestModel.rig).toBe(rigIdOf(root))
    expect(manifestModel.boneCount).toBe(collectBoneNames(root).length)

    // GLB 产物完整性:skins joints 名是 FBX 骨名子集(转换丢骨/改名回归)。
    // WebIO.readBinary 在 jest 可用(draco.test.ts 先例);NodeIO 的
    // 动态 import fs 会被 jest 拦,不用
    const glb = fs.readFileSync(
      path.resolve(__dirname, '../../assets/models', manifestModel.file),
    )
    const io = new WebIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        'draco3d.decoder': await draco3dgltf.createDecoderModule(),
      })
    const doc = await io.readBinary(new Uint8Array(glb))
    const fbxNames = new Set(collectBoneNames(root))
    const joints = new Set<string>()
    for (const skin of doc.getRoot().listSkins()) {
      for (const j of skin.listJoints()) joints.add(j.getName())
    }
    expect(joints.size).toBeGreaterThan(0)
    expect([...joints].every((n) => fbxNames.has(n))).toBe(true)
  })

  test('姿势条目 rig 与清单族代表模型一致(用户导入同款模型才能匹配)', async () => {
    const src = new StaticCatalogSource({baseUrl: BASE})
    const rig = seedAssetsManifest.models.find((m) => m.name === 'Y Bot')!.rig
    const poses = await src.listEntries('pose')
    expect(poses.every((p) => p.rig === rig)).toBe(true)
  })

  test('baseUrl 配错:GLB 加载失败走 LibraryError(network),选择框数据照常', async () => {
    const src = new StaticCatalogSource({baseUrl: 'https://bad.example/'})
    // getBlobUrl 纯拼接不探测:
    expect(await src.getBlobUrl('catalog:models/x.glb')).toContain(
      'bad.example',
    )
    // 选择框数据照常:条目列表与 baseUrl 可达性无关
    const errors: LibraryError[] = []
    const lib = new Library({
      sources: [src],
      onError: (e) => errors.push(e),
    })
    const models = await lib.listEntries('model')
    expect(models).toHaveLength(seedAssetsManifest.models.length)
    // PlacementManager 加载失败 → LibraryError network(fetcher stub 驱动)
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('ENOTFOUND bad.example')
    }) as never
    try {
      await expect(loadLibraryModel(models[0].id, lib)).rejects.toMatchObject({
        code: 'network',
      })
    } finally {
      globalThis.fetch = origFetch
    }
    expect(errors.some((e) => e.code === 'network')).toBe(true)
  })
})
