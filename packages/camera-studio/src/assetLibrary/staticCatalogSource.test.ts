/**
 * StaticCatalogSource(内置资产目录源)契约:
 * - 条目来自入库清单 + 姿势数据模块,数量一律数据驱动(不写死);
 * - 内置模型 id = seed-model-<contentHash>,姿势 id 保持 seed-pose-*;
 * - blobId 全部带 catalog: 前缀,聚合器按前缀路由回本源;
 * - 静态文件(models/poseThumbs)纯拼接 baseUrl 不探测;
 * - 运行时缩略图(模型/身体姿势)走注入渲染器,内存缓存,缺注入抛 not-found;
 * - 清单 rig 与运行时 FBX 解析同一判定(parity 兜底)。
 */
import fs from 'fs'
import path from 'path'
import {FBXLoader} from 'three-stdlib'
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
import {Library} from './library'
import {loadLibraryModel} from '../PlacementManager'
import type {ModelEntry, PoseEntry} from './types'

const BASE = 'https://cdn.example.com/a/'

describe('StaticCatalogSource', () => {
  test('目录源:条目齐全,id 前缀与 blobId 路由正确', async () => {
    const src = new StaticCatalogSource({baseUrl: BASE})
    const models = (await src.listEntries('model')) as ModelEntry[]
    const poses = (await src.listEntries('pose')) as PoseEntry[]
    // 数据驱动计数:清单与姿势数据模块是唯一事实源
    expect(models).toHaveLength(seedAssetsManifest.models.length)
    expect(poses).toHaveLength(buildBuiltinPoseEntries().length)
    expect(poses).toHaveLength(
      seedPoses.length + seedPosesDpl.length + seedPosesQbx.length,
    )
    expect(models.every((m) => m.id.startsWith('seed-model-'))).toBe(true)
    expect(poses.every((p) => p.id.startsWith('seed-pose-'))).toBe(true)
    // 模型 blobId 带 catalog: 前缀,聚合器按前缀路由;URL 纯拼接
    expect(models.every((m) => m.blobId.startsWith('catalog:models/'))).toBe(
      true,
    )
    const url = await src.getBlobUrl(models[0].blobId)
    expect(url.startsWith(`${BASE}models/`)).toBe(true)
    // getEntry 按 id 直查
    expect(await src.getEntry(models[0].id)).toMatchObject({id: models[0].id})
    expect(await src.getEntry('seed-pose-nope')).toBeUndefined()
    // 不分 kind 时全量返回
    expect(await src.listEntries()).toHaveLength(models.length + poses.length)
    // 只读目录:不可写,URL 长效可跨挂载缓存
    expect(src.capabilities).toMatchObject({
      writable: false,
      permanentUrls: true,
    })
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
