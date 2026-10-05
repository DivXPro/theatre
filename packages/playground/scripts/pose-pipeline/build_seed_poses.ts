// packages/playground/scripts/pose-pipeline/build_seed_poses.ts
/**
 * 内置姿势管线第二步:骨向 JSON → 最终 PoseBones → seedPoses.ts
 *
 * 用法(仓库根或 playground 目录):
 *   npx tsx scripts/pose-pipeline/build_seed_poses.ts [输入.json] [输出.ts] [导出名]
 * 默认(无参):poses_directions.json → seedPoses.ts(export seedPoses)
 * DPL 批:poses_directions_dpl.json → seedPosesDpl.ts(export seedPosesDpl)
 * QBX 批:poses_directions_qbx.json → seedPosesQbx.ts(export seedPosesQbx)
 *   追加 --only-dirs:产物只保留 dirs 覆盖的骨。retargetPose 默认给未覆盖骨
 *   写「随父(rest)」旋转——全身姿势要这个(末端骨归位),叠加片段(纯手势)
 *   要裁掉,否则应用时把身体刷回 rest
 *
 * 输入:
 *   - scripts/pose-pipeline/*.json(blender_dump*.py 产物,
 *     每姿势映射骨的世界 Y 目标方向,three 系)
 *   - src/shared/camera/assetLibrary/seedModels/Y Bot.fbx(族代表骨架,
 *     提 rest 基准:主套骨层级 + rest local/world 四元数)
 * 输出:
 *   - src/shared/camera/assetLibrary/seedPoses*.ts(内嵌姿势的
 *     PoseBones,随包播种;运行时不做换算)
 *
 * 重名骨处理:Y Bot.fbx 有两套同名骨骼(蒙皮分两层),traverse 先序
 * 每名取首次=主套(副套是主骨的子叶,应用时随父同步,见 spike 验证)。
 * rest 基准含主套全部骨(含 GLB 转换会被剥的 13 根末端骨)——产物写入
 * 无害,applyPose 对缺失骨记 missed 不报错。
 */
import fs from 'fs'
import path from 'path'
import {fileURLToPath} from 'url'
import {FBXLoader} from 'three-stdlib'
import {retargetPose} from '../../src/shared/camera/poseMode/poseRetarget'
import type {RestBone} from '../../src/shared/camera/poseMode/poseRetarget'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '../..')
const fbxPath = path.join(
  pkgRoot,
  'src/shared/camera/assetLibrary/seedModels/Y Bot.fbx',
)
// 可选参数:输入 JSON / 输出 ts / 导出名 / --only-dirs(只保留 dirs 覆盖骨)
const argv = process.argv.slice(2)
const onlyDirs = argv.includes('--only-dirs')
const [
  inName = 'poses_directions.json',
  outName = 'seedPoses.ts',
  exportName = 'seedPoses',
] = argv.filter((a) => a !== '--only-dirs')
const dirsPath = path.join(here, inName)
const outPath = path.join(pkgRoot, 'src/shared/camera/assetLibrary', outName)

// ---------- 1. rest 基准(主套,每骨名取首次) ----------
const buf = fs.readFileSync(fbxPath)
const root = new FBXLoader().parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  '',
)
root.updateMatrixWorld(true)
const restBones: RestBone[] = []
const seen = new Set<string>()
root.traverse((o) => {
  if (!(o as {isBone?: boolean}).isBone) return
  if (seen.has(o.name)) return // 副套同名子叶,跳过
  seen.add(o.name)
  const parentBone =
    o.parent &&
    (o.parent as {isBone?: boolean}).isBone &&
    seen.has(o.parent.name)
      ? o.parent.name
      : null
  const w = o.getWorldQuaternion(new (o.quaternion.constructor as any)())
  restBones.push({
    name: o.name,
    parent: parentBone,
    localQuat: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w],
    worldQuat: [w.x, w.y, w.z, w.w],
  })
})
console.log(`rest 基准: ${restBones.length} 根主套骨`)

// ---------- 2. 逐姿势换算 ----------
const dirsDoc = JSON.parse(fs.readFileSync(dirsPath, 'utf-8')) as {
  source?: string
  poses: {
    key: string
    name: string
    dirs: Record<string, [number, number, number]>
  }[]
}
// 四元数 5 位小数足够(角度误差 <0.01°),内嵌体积减半
const roundBones = (
  bones: ReturnType<typeof retargetPose>,
): ReturnType<typeof retargetPose> =>
  Object.fromEntries(
    Object.entries(bones).map(([k, v]) => [
      k,
      {
        rotation: v.rotation!.map((n) => +n.toFixed(5)) as [
          number,
          number,
          number,
          number,
        ],
      },
    ]),
  )
const seedPoses = dirsDoc.poses.map((p) => {
  const bones = retargetPose(restBones, p.dirs)
  return {
    key: p.key,
    name: p.name,
    bones: roundBones(
      onlyDirs
        ? Object.fromEntries(Object.entries(bones).filter(([k]) => k in p.dirs))
        : bones,
    ),
  }
})
console.log(`换算姿势: ${seedPoses.map((p) => p.key).join(', ')}`)

// ---------- 3. 写产物 ts ----------
const body = `// 本文件由 scripts/pose-pipeline/build_seed_poses.ts 生成,勿手改。
// 重新生成:npx tsx scripts/pose-pipeline/build_seed_poses.ts ${inName} ${outName} ${exportName}${
  onlyDirs ? ' --only-dirs' : ''
}
// 骨向来源:${dirsDoc.source ?? inName}
import type {PoseBones} from '../poseMode/poseOverride'

export type SeedPose = {key: string; name: string; bones: PoseBones}

export const ${exportName}: SeedPose[] = ${JSON.stringify(seedPoses, null, 1)}
`
fs.writeFileSync(outPath, body)
console.log(`已写出 ${path.relative(pkgRoot, outPath)}(${exportName})`)
