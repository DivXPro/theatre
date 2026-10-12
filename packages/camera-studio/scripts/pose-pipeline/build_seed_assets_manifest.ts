/**
 * 内置资产清单生成器(2026-10-10 内置资产目录化):
 * 扫 scripts/pose-pipeline/models/ 下的模型源文件(FBX),逐个转换为
 * 运行时消费的 GLB 写进 assets/models/,并连同 assets/poseThumbs/ 的
 * 姿势预览图一起生成清单 src/assetLibrary/seedAssetsManifest.ts。
 *
 * 用法(仓库根):npx tsx packages/camera-studio/scripts/pose-pipeline/build_seed_assets_manifest.ts
 *
 * 要点:
 * - FBX→GLB 转换走运行时同一条管线(FBXLoader 解析 → exportModelGLB:
 *   剥无效贴图 + GLTFExporter + Draco 压缩),产物即旧播种流程写入 IDB
 *   的同构内容,只是改为随包静态文件;GLB 是构建产物,照常提交入库。
 * - contentHash = GLB 字节的 FNV-1a(src/assetLibrary/hash.ts 同一实现,
 *   与浏览器逐字节一致,有测试钉算法);条目 id = seed-model-<contentHash>,
 *   清单稳定 → id 稳定。
 * - rig 用运行时同一判定:FBXLoader 解析出的骨骼树喂 rig.ts 的 rigIdOf
 *   (importPipeline 判定骨架族用的就是它),禁止另写一套。注意不能用
 *   转换后 GLB 的 joints 算:GLB 转换会剥 13 根末端骨且双套同名骨按
 *   节点计,与用户导入同款 FBX 算出的 rig 不一致,姿势族匹配会断。
 * - 生成后自动校验:GLB 经 gltf-transform 读回,skins joints 名必须是
 *   FBX 骨名子集(转换丢骨/改名的回归兜底)。
 */
import fs from 'fs'
import path from 'path'
import {execSync} from 'child_process'
import {fileURLToPath} from 'url'
import {FBXLoader} from 'three-stdlib'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import draco3dgltf from 'draco3dgltf'
import {collectBoneNames, meshStats, rigIdOf} from '../../src/assetLibrary/rig'
import {hashBytes} from '../../src/assetLibrary/hash'
import {exportModelGLB} from '../../src/assetLibrary/exportGLB'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '../..')
const MODELS_SRC = path.join(here, 'models')
const MODELS_OUT = path.join(pkgRoot, 'assets/models')
const THUMBS_DIR = path.join(pkgRoot, 'assets/poseThumbs')
const OUT_TS = path.join(pkgRoot, 'src/assetLibrary/seedAssetsManifest.ts')

type ModelRow = {
  key: string
  file: string
  contentHash: string
  name: string
  rig: string
  boneCount: number
  vertexCount: number
}

/** 条目运行时 id 用的稳定 key:小写、空白转连字符('Y Bot' → 'y-bot') */
function keyOf(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}

async function buildModel(file: string): Promise<ModelRow> {
  const buf = fs.readFileSync(path.join(MODELS_SRC, file))
  const root = new FBXLoader().parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    '',
  )
  const name = file.replace(/\.[^.]+$/, '')
  const rig = rigIdOf(root)
  const boneNames = collectBoneNames(root)
  const stats = meshStats(root)
  const glb = await exportModelGLB(root)

  const outFile = `${name}.glb`
  fs.mkdirSync(MODELS_OUT, {recursive: true})
  fs.writeFileSync(path.join(MODELS_OUT, outFile), new Uint8Array(glb))

  // 校验:GLB skins joints 名 ⊆ FBX 骨名(转换丢骨/改名回归兜底)
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3dgltf.createDecoderModule(),
    })
  const doc = await io.readBinary(new Uint8Array(glb))
  const fbxNameSet = new Set(boneNames)
  const joints = new Set<string>()
  for (const skin of doc.getRoot().listSkins()) {
    for (const j of skin.listJoints()) joints.add(j.getName())
  }
  const unknown = [...joints].filter((n) => !fbxNameSet.has(n))
  if (joints.size === 0 || unknown.length > 0) {
    throw new Error(
      `${file} 转换后骨名异常:joints=${
        joints.size
      },FBX 中不存在:[${unknown.join(', ')}]`,
    )
  }

  return {
    key: keyOf(name),
    file: outFile,
    contentHash: hashBytes(new Uint8Array(glb)),
    name,
    rig,
    boneCount: boneNames.length,
    vertexCount: stats.vertexCount,
  }
}

async function main() {
  const modelFiles = fs
    .readdirSync(MODELS_SRC)
    .filter((f) => f.toLowerCase().endsWith('.fbx'))
    .sort()
  if (modelFiles.length === 0)
    throw new Error(`${MODELS_SRC} 下没有 .fbx 模型源文件`)
  const models: ModelRow[] = []
  for (const f of modelFiles) {
    const row = await buildModel(f)
    models.push(row)
    console.log(`模型 ${f} → assets/models/${row.file}(rig=${row.rig})`)
  }

  const poseThumbs = fs
    .readdirSync(THUMBS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort()
    .map((f) => ({key: f.replace(/\.png$/i, ''), file: f}))

  const lines = [
    '// 本文件由 build_seed_assets_manifest.ts 生成,勿手改。',
    '// 重新生成:npx tsx packages/camera-studio/scripts/pose-pipeline/build_seed_assets_manifest.ts',
    '// 模型 GLB 由 scripts/pose-pipeline/models/*.fbx 经运行时导入管线(FBXLoader+exportModelGLB)',
    '// 转换产出,提交在 assets/models/;rig 与 contentHash 的算法见脚本头注释。',
    'export type SeedModelAsset = {',
    '  /** 运行时 id 用稳定 key(小写连字符),如 catalog:runtime/model/<key> */',
    '  key: string',
    '  /** assets/models/ 下的文件名( served 相对路径 models/<file> ) */',
    '  file: string',
    '  /** GLB 字节 FNV-1a;条目 id = seed-model-<contentHash> */',
    '  contentHash: string',
    '  name: string',
    '  /** 运行时 FBX 解析同一判定(rigIdOf);勿用 GLB joints 重算(剥骨/双套差异) */',
    '  rig: string',
    '  boneCount: number',
    '  vertexCount: number',
    '}',
    '',
    'export type SeedPoseThumbAsset = {',
    '  /** 姿势种子 key(qbx-hands-*),与姿势条目 id 后缀一致 */',
    '  key: string',
    '  file: string',
    '}',
    '',
    'export type SeedAssetsManifest = {',
    '  models: SeedModelAsset[]',
    '  poseThumbs: SeedPoseThumbAsset[]',
    '}',
    '',
    'export const seedAssetsManifest: SeedAssetsManifest = {',
    '  models: [',
    ...models.map(
      (m) =>
        `    {key: '${m.key}', file: '${m.file}', contentHash: '${m.contentHash}', name: '${m.name}', rig: '${m.rig}', boneCount: ${m.boneCount}, vertexCount: ${m.vertexCount}},`,
    ),
    '  ],',
    '  poseThumbs: [',
    ...poseThumbs.map((t) => `    {key: '${t.key}', file: '${t.file}'},`),
    '  ],',
    '}',
    '',
  ]
  fs.writeFileSync(OUT_TS, lines.join('\n'))
  // 过一遍 prettier,保持与 lint-staged 提交钩子同款排版,避免提交时
  // 钩子重写生成物造成抖动
  execSync(`npx prettier --write ${JSON.stringify(OUT_TS)}`, {
    cwd: pkgRoot,
    stdio: 'inherit',
  })
  console.log(
    `已写出 ${path.relative(pkgRoot, OUT_TS)}:${models.length} 模型 + ${
      poseThumbs.length
    } 姿势预览图`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
