/**
 * 内置资产清单生成器(2026-10-10 内置资产目录化):
 * 扫 scripts/pose-pipeline/models/ 下的模型源文件(FBX/GLB),逐个转换为
 * 运行时消费的 GLB 写进 assets/models/;再扫 assets/animations/ 的
 * 纯骨骼动作 GLB,并连同 assets/poseThumbs/ 的姿势预览图一起生成清单
 * src/assetLibrary/seedAssetsManifest.ts。
 *
 * 用法(仓库根):npx tsx packages/camera-studio/scripts/pose-pipeline/build_seed_assets_manifest.ts
 *
 * 要点:
 * - FBX/GLB→GLB 转换走运行时同一条管线(FBXLoader/GLTFLoader 解析 → exportModelGLB:
 *   剥无效贴图 + GLTFExporter + Draco 压缩),产物即旧播种流程写入 IDB
 *   的同构内容,只是改为随包静态文件;GLB 是构建产物,照常提交入库。
 * - contentHash = GLB 字节的 FNV-1a(src/assetLibrary/hash.ts 同一实现,
 *   与浏览器逐字节一致,有测试钉算法);同文件更新时沿用原条目 id。
 * - rig 用运行时同一判定:FBXLoader 解析出的骨骼树喂 rig.ts 的 rigIdOf
 *   (importPipeline 判定骨架族用的就是它),禁止另写一套。注意不能用
 *   转换后 GLB 的 joints 算:GLB 转换会剥 13 根末端骨且双套同名骨按
 *   节点计,与用户导入同款 FBX 算出的 rig 不一致,姿势族匹配会断。
 * - 生成后自动校验:GLB 经 gltf-transform 读回,skins joints 名必须是
 *   FBX 骨名子集(转换丢骨/改名的回归兜底)。
 * - 已有 GLB(清单里有同 key、文件存在且哈希对得上)默认原样沿用,
 *   只转换新增或缺少有效产物的模型。确需全量重建加 --force。
 */
import fs from 'fs'
import path from 'path'
import {execSync} from 'child_process'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'url'
import {Texture, TextureLoader} from 'three'
import {FBXLoader, GLTFLoader} from 'three-stdlib'
import {NodeIO, type Root} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import draco3dgltf from 'draco3dgltf'
import {collectBoneNames, meshStats, rigIdOf} from '../../src/assetLibrary/rig'
import {hashBytes} from '../../src/assetLibrary/hash'
import {exportModelGLB} from '../../src/assetLibrary/exportGLB'
import {dedupeAnimations} from '../../src/assetLibrary/animationDedupe'
import {seedAssetsManifest as previousManifest} from '../../src/assetLibrary/seedAssetsManifest'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '../..')
const MODELS_SRC = path.join(here, 'models')
const MODELS_OUT = path.join(pkgRoot, 'assets/models')
const ANIMATIONS_DIR = path.join(pkgRoot, 'assets/animations')
const THUMBS_DIR = path.join(pkgRoot, 'assets/poseThumbs')
const OUT_TS = path.join(pkgRoot, 'src/assetLibrary/seedAssetsManifest.ts')
const CALIBRATIONS_FILE = path.join(here, 'model-calibrations.json')
const FORCE = process.argv.includes('--force')
const reusedOutputs = new Set<string>()

type ScaleTriple = readonly [number, number, number]
type ModelCalibration = {scale: number | ScaleTriple}
type CalibrationFile = {
  version: number
  models: Record<string, ModelCalibration>
}

function assertScale(
  modelName: string,
  scale: unknown,
): asserts scale is number | ScaleTriple {
  if (typeof scale === 'number') {
    if (!(Number.isFinite(scale) && scale > 0)) {
      throw new Error(
        `${CALIBRATIONS_FILE} 中 ${modelName} 的 scale 必须是有限正数:${scale}`,
      )
    }
    return
  }
  if (!Array.isArray(scale) || scale.length !== 3) {
    throw new Error(
      `${CALIBRATIONS_FILE} 中 ${modelName} 的 scale 必须是数字或 [x,y,z] 三元组`,
    )
  }
  for (const value of scale) {
    if (typeof value !== 'number' || !(Number.isFinite(value) && value > 0)) {
      throw new Error(
        `${CALIBRATIONS_FILE} 中 ${modelName} 的 scale 分量必须是有限正数:${value}`,
      )
    }
  }
}

function loadCalibrationFile(): CalibrationFile {
  const parsed = JSON.parse(
    fs.readFileSync(CALIBRATIONS_FILE, 'utf8'),
  ) as Partial<CalibrationFile>
  if (parsed.version !== 1) {
    throw new Error(`${CALIBRATIONS_FILE} 的 version 必须是 1`)
  }
  if (!parsed.models || typeof parsed.models !== 'object') {
    throw new Error(`${CALIBRATIONS_FILE} 缺少 models 对象`)
  }
  for (const [modelName, entry] of Object.entries(parsed.models)) {
    assertScale(modelName, entry?.scale)
  }
  return parsed as CalibrationFile
}

const MODEL_CALIBRATIONS = new Map(
  Object.entries(loadCalibrationFile().models).map(([name, {scale}]) => [
    name,
    {scale},
  ]),
)

function sameScale(
  a: ModelCalibration['scale'] | undefined,
  b: ModelCalibration['scale'] | undefined,
): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  if (typeof a === 'number' || typeof b === 'number') return a === b
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

/**
 * Node 构建环境没有 DOM:FBXLoader 解析外部贴图时会走 TextureLoader →
 * document.createElement('img'),直接抛 "document is not defined"。
 * 换成空贴图占位让解析继续,exportModelGLB 的 stripInvalidTextures
 * 会按既定「贴图缺失 → 灰模/部分贴图」路径剥掉。贴图不参与 rig、
 * 骨骼数或顶点数计算,不影响清单正确性。
 */
TextureLoader.prototype.load = function () {
  return new Texture()
}

/**
 * FBX 内嵌贴图是二进制 Video.Content,FBXLoader 用 window.URL 转 blob URL。
 * 只在同步解析期间垫一个最小 window,解析完立刻撤掉——draco.ts 靠
 * `typeof window` 区分浏览器/Node,不能让它看到这个垫片。
 */
function parseFbxModel(buffer: ArrayBuffer) {
  const globals = globalThis as {window?: {URL: typeof URL}}
  const hadWindow = globals.window !== undefined
  if (!hadWindow) globals.window = {URL}
  try {
    return new FBXLoader().parse(buffer, '')
  } finally {
    if (!hadWindow) delete globals.window
  }
}

/** GLB 源直接读成 three 场景,再走同一套 exportModelGLB 清洗/压缩 */
async function parseGlbModel(buffer: ArrayBuffer) {
  const gltf = await new GLTFLoader().parseAsync(buffer, '')
  return gltf.scene
}

/** 动作 GLB 本身不含骨架族元数据,显式记录可绑定它的源模型 */
const ANIMATION_SOURCE_MODEL: Record<string, string> = {
  'Mixamo Action Adventure - Cover To Stand.glb': 'Y Bot',
  'Mixamo Action Adventure - Cover To Stand 2.glb': 'Y Bot',
  'Mixamo Action Adventure - Crouched Sneaking Left.glb': 'Y Bot',
  'Mixamo Action Adventure - Crouched Sneaking Right.glb': 'Y Bot',
  'Mixamo Action Adventure - Falling Idle.glb': 'Y Bot',
  'Mixamo Action Adventure - Falling To Roll.glb': 'Y Bot',
  'Mixamo Action Adventure - Hard Landing.glb': 'Y Bot',
  'Mixamo Action Adventure - Idle.glb': 'Y Bot',
  'Mixamo Action Adventure - Idle 2.glb': 'Y Bot',
  'Mixamo Action Adventure - Idle 3.glb': 'Y Bot',
  'Mixamo Action Adventure - Idle 4.glb': 'Y Bot',
  'Mixamo Action Adventure - Idle 5.glb': 'Y Bot',
  'Mixamo Action Adventure - Jumping Up.glb': 'Y Bot',
  'Mixamo Action Adventure - Left Cover Sneak.glb': 'Y Bot',
  'Mixamo Action Adventure - Left Turn.glb': 'Y Bot',
  'Mixamo Action Adventure - Right Cover Sneak.glb': 'Y Bot',
  'Mixamo Action Adventure - Right Turn.glb': 'Y Bot',
  'Mixamo Action Adventure - Run To Stop.glb': 'Y Bot',
  'Mixamo Action Adventure - Running.glb': 'Y Bot',
  'Mixamo Action Adventure - Stand To Cover.glb': 'Y Bot',
  'Mixamo Action Adventure - Stand To Cover 2.glb': 'Y Bot',
  'Mixamo Action Adventure - Walking.glb': 'Y Bot',
  'Mixamo Climbing To Top.glb': 'Y Bot',
  'Mixamo Jump.glb': 'Y Bot',
  'Mixamo Left Turn 45.glb': 'Y Bot',
  'Mixamo Opening Door Inwards.glb': 'Y Bot',
  'Mixamo Start Walking.glb': 'Y Bot',
  'Mixamo Talking On Phone.glb': 'Y Bot',
  'Mixamo Walk In Place.glb': 'Y Bot',
  'Mixamo Zombie Stand Up.glb': 'Y Bot',
}

/**
 * 批量导入的官方动作包共用同一骨架。按包名前缀声明来源，
 * 新包只需补前缀，不必为每个片段重复写一条映射。
 */
const ANIMATION_SOURCE_MODEL_BY_PREFIX: Record<string, string> = {
  'Mixamo Locomotion - ': 'Y Bot',
  'Mixamo Basic Locomotion - ': 'Y Bot',
  'Mixamo Magic Locomotion - ': 'Y Bot',
  'Mixamo Scary Zombie - ': 'Y Bot',
  'Mixamo Breakdance - ': 'Y Bot',
  'Mixamo Capoeira - ': 'Y Bot',
  'Mixamo Pro Magic - ': 'Y Bot',
  'Mixamo Pro Melee Axe - ': 'Y Bot',
  'Mixamo Action Adventure - ': 'Y Bot',
  'Mixamo Basic Shooter - ': 'Y Bot',
  'Mixamo Not So Scary Zombie - ': 'Y Bot',
  'Mixamo Pro Rifle - ': 'Y Bot',
  'Mixamo Pro Longbow - ': 'Y Bot',
  'Mixamo Pro Sword And Shield - ': 'Y Bot',
  'Mixamo Rifle 8-Way - ': 'Y Bot',
  'Mixamo Pistol Handgun - ': 'Y Bot',
  'Mixamo Sword And Shield - ': 'Y Bot',
  'Mixamo Lite Sword And Shield - ': 'Y Bot',
  'Mixamo Great Sword - ': 'Y Bot',
  'Mixamo Longbow Locomotion - ': 'Y Bot',
  'Mixamo Longbow Aiming - ': 'Y Bot',
  'Mixamo Lite Longbow - ': 'Y Bot',
  'Mixamo Shooter - ': 'Y Bot',
  'Mixamo Slim Shooter - ': 'Y Bot',
  'Mixamo Lite Rifle - ': 'Y Bot',
  'Mixamo Lite Magic - ': 'Y Bot',
  'Mixamo Magic Spell - ': 'Y Bot',
  'Mixamo Soccer Game - ': 'Y Bot',
  'Mixamo Farming - ': 'Y Bot',
  'Mixamo Creature - ': 'Y Bot',
  'Mixamo Creature NPC - ': 'Y Bot',
  'Mixamo Male Locomotion - ': 'Y Bot',
  'Mixamo Female Locomotion - ': 'Y Bot',
  'Mixamo Female Basic Locomotion - ': 'Y Bot',
  'Mixamo Male Injured - ': 'Y Bot',
  'Mixamo Male Drunk - ': 'Y Bot',
  'Mixamo Gestures Basic - ': 'Y Bot',
  'Mixamo Free Test - ': 'Y Bot',
}

function animationSourceModel(file: string): string | undefined {
  const exact = ANIMATION_SOURCE_MODEL[file]
  if (exact) return exact
  const prefix = Object.keys(ANIMATION_SOURCE_MODEL_BY_PREFIX).find((value) =>
    file.startsWith(value),
  )
  return prefix ? ANIMATION_SOURCE_MODEL_BY_PREFIX[prefix] : undefined
}

/**
 * 同一套 Mixamo 骨架的源文件可能带重复骨架节点(Y Bot 的 FBX 就是双套),
 * 唯一骨名集合相同就归为同一骨架族，让 X Bot 共享 Y Bot 的姿势/动作。
 */
const MODEL_RIG_ALIASES: Record<string, string> = {
  'X Bot': 'Y Bot',
}

type ModelRow = {
  key: string
  file: string
  contentHash: string
  entryId?: string
  calibration?: ModelCalibration
  name: string
  rig: string
  boneCount: number
  vertexCount: number
}

type AnimationRow = {
  key: string
  file: string
  contentHash: string
  name: string
  rig: string
  duration: number
  pack?: string
  aliases?: Array<Pick<AnimationRow, 'contentHash' | 'name' | 'pack'>>
}

function animationPack(file: string): string | undefined {
  const delimiter = file.indexOf(' - ')
  return delimiter < 0
    ? undefined
    : file.slice(0, delimiter).replace(/^Mixamo /, '')
}

function animationFingerprint(root: Root, rig: string): string {
  const units = root
    .listNodes()
    .find((node) => node.getName() === 'AnimationRig')
    ?.getExtras().animationMetersPerUnit
  const digest = createHash('sha256')
  digest.update(JSON.stringify([rig, units ?? null]))
  for (const clip of root.listAnimations()) {
    const channels = clip
      .listChannels()
      .map((channel) => ({
        key: JSON.stringify([
          channel.getTargetNode()?.getName(),
          channel.getTargetPath(),
        ]),
        sampler: channel.getSampler()!,
      }))
      .sort((left, right) => left.key.localeCompare(right.key))
    digest.update(JSON.stringify(channels.length))
    for (const {key, sampler} of channels) {
      digest.update(JSON.stringify([key, sampler.getInterpolation()]))
      for (const accessor of [sampler.getInput()!, sampler.getOutput()!]) {
        const values = accessor.getArray()!
        digest.update(
          JSON.stringify([
            accessor.getType(),
            accessor.getComponentType(),
            accessor.getNormalized(),
            values.length,
          ]),
        )
        digest.update(
          new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
        )
      }
    }
  }
  return digest.digest('hex')
}

/**
 * 条目运行时 id 用的稳定 key:小写,非字母数字(下划线除外)折叠成
 * 单个连字符('Y Bot' → 'y-bot','MangaKa Props - A_R_Books_08' →
 * 'mangaka-props-a_r_books_08')
 */
function keyOf(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function buildModel(file: string): Promise<ModelRow> {
  const name = file.replace(/\.[^.]+$/, '')
  const key = keyOf(name)
  const calibration = MODEL_CALIBRATIONS.get(name)
  const outFile = `${name}.glb`
  const outPath = path.join(MODELS_OUT, outFile)
  const previous = previousManifest.models.find(
    (model) => model.key === key && model.file === outFile,
  )

  if (
    !FORCE &&
    previous &&
    sameScale(previous.calibration?.scale, calibration?.scale) &&
    fs.existsSync(outPath) &&
    hashBytes(fs.readFileSync(outPath)) === previous.contentHash
  ) {
    reusedOutputs.add(outFile)
    return previous
  }

  const buf = fs.readFileSync(path.join(MODELS_SRC, file))
  const source = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  )
  const root = file.toLowerCase().endsWith('.glb')
    ? await parseGlbModel(source)
    : parseFbxModel(source)
  const rig = rigIdOf(root)
  const boneNames = collectBoneNames(root)
  const stats = meshStats(root)
  let skinnedMeshCount = 0
  root.traverse((object) => {
    if ((object as {isSkinnedMesh?: boolean}).isSkinnedMesh) {
      skinnedMeshCount++
    }
  })
  const sourceUnit = name.startsWith('MangaKa ') ? 'meters' : 'auto'
  const glb = await exportModelGLB(root, sourceUnit, calibration?.scale)

  fs.mkdirSync(MODELS_OUT, {recursive: true})
  fs.writeFileSync(outPath, new Uint8Array(glb))

  // 校验:有蒙皮的模型,GLB skins joints 名必须是 FBX 骨名子集
  // (转换丢骨/改名回归兜底)。静态道具没有 skin,跳过。
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
  if (skinnedMeshCount > 0 && (joints.size === 0 || unknown.length > 0)) {
    throw new Error(
      `${file} 转换后骨名异常:joints=${
        joints.size
      },FBX 中不存在:[${unknown.join(', ')}]`,
    )
  }

  const contentHash = hashBytes(new Uint8Array(glb))
  const entryId =
    previous && (previous.entryId ?? `seed-model-${previous.contentHash}`)
  return {
    key,
    file: outFile,
    contentHash,
    ...(entryId && entryId !== `seed-model-${contentHash}` ? {entryId} : {}),
    ...(calibration ? {calibration} : {}),
    name,
    rig,
    boneCount: boneNames.length,
    vertexCount: stats.vertexCount,
  }
}

async function main() {
  const modelFiles = fs
    .readdirSync(MODELS_SRC)
    .filter((f) => /\.(fbx|glb)$/i.test(f))
    .sort()
  if (modelFiles.length === 0)
    throw new Error(`${MODELS_SRC} 下没有 .fbx / .glb 模型源文件`)
  const modelNames = new Set(
    modelFiles.map((file) => file.replace(/\.[^.]+$/, '')),
  )
  for (const name of MODEL_CALIBRATIONS.keys()) {
    if (!modelNames.has(name)) {
      throw new Error(
        `${CALIBRATIONS_FILE} 中的模型不存在于 ${MODELS_SRC}:${name}`,
      )
    }
  }
  const models: ModelRow[] = []
  for (const f of modelFiles) {
    const row = await buildModel(f)
    models.push(row)
    const action = reusedOutputs.has(row.file) ? '沿用' : '转换'
    console.log(`${action} ${f} → assets/models/${row.file}(rig=${row.rig})`)
  }
  for (const [modelName, aliasName] of Object.entries(MODEL_RIG_ALIASES)) {
    const model = models.find((m) => m.name === modelName)
    const alias = models.find((m) => m.name === aliasName)
    if (!model || !alias) {
      throw new Error(`骨架族别名无效:${modelName} → ${aliasName}(模型缺失)`)
    }
    model.rig = alias.rig
  }

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3dgltf.createDecoderModule(),
    })
  const animationFiles = fs.existsSync(ANIMATIONS_DIR)
    ? fs
        .readdirSync(ANIMATIONS_DIR)
        .filter((f) => f.toLowerCase().endsWith('.glb'))
        .sort()
    : []
  const packSizes = new Map<string, number>()
  for (const file of animationFiles) {
    const pack = animationPack(file)
    if (pack) packSizes.set(pack, (packSizes.get(pack) ?? 0) + 1)
  }
  const candidates: Array<{
    animation: AnimationRow
    name: string
    packSize: number
    fingerprint: string
  }> = []
  for (const f of animationFiles) {
    const sourceModelName = animationSourceModel(f)
    const sourceModel = models.find((m) => m.name === sourceModelName)
    if (!sourceModel) {
      throw new Error(
        `${f} 未配置有效的 ANIMATION_SOURCE_MODEL(当前:${
          sourceModelName ?? '缺失'
        })`,
      )
    }
    const bytes = fs.readFileSync(path.join(ANIMATIONS_DIR, f))
    const doc = await io.readBinary(new Uint8Array(bytes))
    const animationsInFile = doc.getRoot().listAnimations()
    if (animationsInFile.length === 0) {
      throw new Error(`${f} 不含动画片段`)
    }
    const duration = Math.max(
      ...animationsInFile.flatMap((animation) =>
        animation
          .listSamplers()
          .map((sampler) => sampler.getInput()?.getArray()?.at(-1) ?? 0),
      ),
    )
    if (!(Number.isFinite(duration) && duration > 0)) {
      throw new Error(`${f} 动画时长无效:${duration}`)
    }
    const name = f.replace(/\.glb$/i, '')
    const pack = animationPack(f)
    const row: AnimationRow = {
      key: keyOf(name),
      file: f,
      contentHash: hashBytes(new Uint8Array(bytes)),
      name,
      rig: sourceModel.rig,
      duration,
      ...(pack && {pack}),
    }
    candidates.push({
      animation: row,
      name,
      packSize: pack ? packSizes.get(pack)! : 0,
      fingerprint: animationFingerprint(doc.getRoot(), sourceModel.rig),
    })
    console.log(`动作 ${f} → rig=${row.rig},duration=${row.duration}s`)
  }
  const {kept, duplicates} = dedupeAnimations(candidates)
  for (const {row, canonical} of duplicates) {
    const {contentHash, name, pack} = row.animation
    const aliases = (canonical.animation.aliases ??= [])
    aliases.push({contentHash, name, ...(pack && {pack})})
  }
  const animations = kept.map(({animation}) => animation)

  const poseThumbs = fs
    .readdirSync(THUMBS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort()
    .map((f) => ({key: f.replace(/\.png$/i, ''), file: f}))

  const lines = [
    '// 本文件由 build_seed_assets_manifest.ts 生成,勿手改。',
    '// 重新生成:npx tsx packages/camera-studio/scripts/pose-pipeline/build_seed_assets_manifest.ts',
    '// 模型 GLB 由 scripts/pose-pipeline/models/*.fbx|*.glb 经运行时导入管线(FBXLoader/GLTFLoader+exportModelGLB)',
    '// 转换产出,提交在 assets/models/;rig 与 contentHash 的算法见脚本头注释。',
    'export type SeedModelAsset = {',
    '  /** 运行时 id 用稳定 key(小写连字符),如 catalog:runtime/model/<key> */',
    '  key: string',
    '  /** assets/models/ 下的文件名( served 相对路径 models/<file> ) */',
    '  file: string',
    '  /** GLB 字节 FNV-1a */',
    '  contentHash: string',
    '  /** 替换前的条目 id;新模型默认使用 seed-model-<contentHash> */',
    '  entryId?: string',
    '  /** 生成器使用的尺寸校准，供重建判断 */',
    '  calibration?: {scale: number | [number, number, number]}',
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
    'export type SeedAnimationAsset = {',
    '  /** 运行时 id 用稳定 key(小写连字符),如 catalog:runtime/model/<key> */',
    '  key: string',
    '  /** assets/animations/ 下的文件名( served 相对路径 animations/<file> ) */',
    '  file: string',
    '  /** GLB 字节 FNV-1a;条目 id = seed-animation-<contentHash> */',
    '  contentHash: string',
    '  name: string',
    '  /** 可绑定该动作的模型骨架族 id;动作按骨骼名匹配通道 */',
    '  rig: string',
    '  /** 单次循环时长(秒),包含回环末帧到首帧的一个采样间隔 */',
    '  duration: number',
    '  pack?: string',
    '  aliases?: Array<{contentHash: string; name: string; pack?: string}>',
    '}',
    '',
    'export type SeedAssetsManifest = {',
    '  models: SeedModelAsset[]',
    '  animations: SeedAnimationAsset[]',
    '  poseThumbs: SeedPoseThumbAsset[]',
    '}',
    '',
    'export const seedAssetsManifest: SeedAssetsManifest = {',
    '  models: [',
    ...models.map((m) => {
      const entryId = m.entryId ? ` entryId: '${m.entryId}',` : ''
      const calibration = m.calibration
        ? ` calibration: ${JSON.stringify(m.calibration)},`
        : ''
      return `    {key: '${m.key}', file: '${m.file}', contentHash: '${m.contentHash}',${entryId}${calibration} name: '${m.name}', rig: '${m.rig}', boneCount: ${m.boneCount}, vertexCount: ${m.vertexCount}},`
    }),
    '  ],',
    '  animations: [',
    ...animations.map((a) => `    ${JSON.stringify(a)},`),
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
    } 姿势预览图 + ${animations.length} 动作 (${duplicates.length} 条重复)`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
