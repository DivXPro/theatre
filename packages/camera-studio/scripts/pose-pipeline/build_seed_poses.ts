// packages/camera-studio/scripts/pose-pipeline/build_seed_poses.ts
/**
 * 内置姿势管线第二步:骨向 JSON → 最终 PoseBones → seedPoses.ts
 *
 * 用法(仓库根或 camera-studio 目录):
 *   npx tsx packages/camera-studio/scripts/pose-pipeline/build_seed_poses.ts [输入.json] [输出.ts] [导出名]
 * 默认(无参):poses_directions.json → seedPoses.ts(export seedPoses)
 * DPL 批:poses_directions_dpl.json → seedPosesDpl.ts(export seedPosesDpl)
 * QBX 批:poses_directions_qbx.json → seedPosesQbx.ts(export seedPosesQbx)
 *   追加 --only-dirs:产物只保留 dirs 覆盖的骨。retargetPose 默认给未覆盖骨
 *   写「随父(rest)」旋转——全身姿势要这个(末端骨归位),叠加片段(纯手势)
 *   要裁掉,否则应用时把身体刷回 rest
 *
 * 输入:
 *   - packages/camera-studio/scripts/pose-pipeline/*.json(blender_dump*.py 产物,
 *     每姿势映射骨的世界 Y 目标方向,three 系)
 *   - packages/camera-studio/src/assetLibrary/seedModels/Y Bot.fbx(族代表骨架,
 *     提 rest 基准:主套骨层级 + rest local/world 四元数)
 * 输出:
 *   - packages/camera-studio/src/assetLibrary/seedPoses*.ts(内嵌姿势的
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
import {Quaternion, Vector3} from 'three'
import {retargetPose} from '../../src/poseMode/poseRetarget'
import type {RestBone} from '../../src/poseMode/poseRetarget'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '../..')
const fbxPath = path.join(
  pkgRoot,
  'src/assetLibrary/seedModels/Y Bot.fbx',
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
const outPath = path.join(pkgRoot, 'src/assetLibrary', outName)

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
  /** v2(QBX 手势):方向在源手腕骨系,须先换算到目标世界系;
   *  缺省(v1,全身姿势):方向已是世界系,直接用 */
  space?: 'wrist'
  poses: {
    key: string
    name: string
    dirs: Record<string, [number, number, number]>
  }[]
}

// 手腕相对 → 目标世界:源/目标手腕的局部轴定义不同(实测差 90°),
// 且两边 rest 手臂姿态也不同(源 A 姿势 vs Y Bot T 姿势),都不能当桥。
// 用「手指伸直」的姿势(stop/spread/five)做解剖标定:伸直手 ≈ T 姿势
// 的手,把源手腕系下的各指骨方向与 Y Bot 手腕系下的 rest 方向做
// Horn-Kabsch 对齐(四指 × 3 节 × 多姿势;拇指在伸直手里是外展的,
// 与 T 姿势放松拇指对应关系不同,不参与标定),得常旋转 T,再
// d' = A'(目标手腕 rest 世界旋转) @ T @ u。
let sideRot: Record<'Left' | 'Right', Quaternion> | null = null
/** Horn 法求最优旋转四元数:pairs = (源向量, 目标向量),返回 R 使 R·src ≈ tgt */
function kabschQuaternion(pairs: [Vector3, Vector3][]): Quaternion {
  // 交叉协方差 M = Σ src·tgtᵀ
  let sxx = 0,
    sxy = 0,
    sxz = 0,
    syx = 0,
    syy = 0,
    syz = 0,
    szx = 0,
    szy = 0,
    szz = 0
  for (const [a, b] of pairs) {
    sxx += a.x * b.x
    sxy += a.x * b.y
    sxz += a.x * b.z
    syx += a.y * b.x
    syy += a.y * b.y
    syz += a.y * b.z
    szx += a.z * b.x
    szy += a.z * b.y
    szz += a.z * b.z
  }
  // Horn 4x4 对称阵,最大特征值对应的特征向量 = 最优四元数 (w,x,y,z)
  const N = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ]
  // Jacobi 特征分解(4x4 对称,扫 20 轮充分收敛;幂迭代会收敛到
  // |λ| 最大的特征向量,负特征值幅值更大时给出错误旋转——踩过)
  const V = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ]
  for (let sweep = 0; sweep < 20; sweep++) {
    let p = 0,
      q = 1,
      max = 0
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++)
        if (Math.abs(N[i][j]) > max) {
          max = Math.abs(N[i][j])
          p = i
          q = j
        }
    if (max < 1e-12) break
    const theta = 0.5 * Math.atan2(2 * N[p][q], N[q][q] - N[p][p])
    const c = Math.cos(theta),
      s = Math.sin(theta)
    for (let k = 0; k < 4; k++) {
      const npk = c * N[k][p] - s * N[k][q]
      const nqk = s * N[k][p] + c * N[k][q]
      N[k][p] = npk
      N[k][q] = nqk
    }
    for (let k = 0; k < 4; k++) {
      const npk = c * N[p][k] - s * N[q][k]
      const nqk = s * N[p][k] + c * N[q][k]
      N[p][k] = npk
      N[q][k] = nqk
    }
    for (let k = 0; k < 4; k++) {
      const vkp = c * V[k][p] - s * V[k][q]
      const vkq = s * V[k][p] + c * V[k][q]
      V[k][p] = vkp
      V[k][q] = vkq
    }
  }
  let best = 0
  for (let i = 1; i < 4; i++) if (N[i][i] > N[best][best]) best = i
  const q = new Quaternion(V[1][best], V[2][best], V[3][best], V[0][best])
  // 协方差转置方向决定 q 是 src→tgt 还是其逆,用残差实测挑选
  const residual = (r: Quaternion) =>
    pairs.reduce(
      (acc, [a, b]) => acc + a.clone().applyQuaternion(r).distanceTo(b),
      0,
    )
  return residual(q) <= residual(q.clone().invert()) ? q : q.invert()
}
function wristSpaceToWorld(
  p: (typeof dirsDoc.poses)[number],
): Record<string, [number, number, number]> {
  if (!sideRot) {
    sideRot = {} as Record<'Left' | 'Right', Quaternion>
    for (const side of ['Left', 'Right'] as const) {
      const suffix = side === 'Left' ? '-l' : '-r'
      // 手指伸直的标定姿势(存在才用,stop 必需)
      const calib = ['stop', 'spread', 'five']
        .map((name) =>
          dirsDoc.poses.find((s) => s.key.endsWith(`-${name}${suffix}`)),
        )
        .filter((s): s is (typeof dirsDoc.poses)[number] => Boolean(s))
      if (!calib.length)
        throw new Error(`手腕系数据需要伸直手姿势做标定,未找到 *-stop${suffix}`)
      const restWristQ = new Quaternion(
        ...(restBones.find((b) => b.name === `mixamorig${side}Hand`)!
          .worldQuat as [number, number, number, number]),
      )
      const pairs: [Vector3, Vector3][] = []
      for (const pose of calib) {
        for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
          for (const i of [1, 2, 3]) {
            const bone = `mixamorig${side}Hand${f}${i}`
            const src = pose.dirs[bone] as [number, number, number] | undefined
            const restBone = restBones.find((b) => b.name === bone)
            if (!src || !restBone) continue
            const tgt = new Vector3(0, 1, 0)
              .applyQuaternion(
                new Quaternion(
                  ...(restBone.worldQuat as [number, number, number, number]),
                ),
              )
              .applyQuaternion(restWristQ.clone().invert())
              .normalize()
            pairs.push([new Vector3(...src).normalize(), tgt])
          }
        }
      }
      const T = kabschQuaternion(pairs)
      // A' @ T 预先合成:逐姿势逐骨一次旋转
      sideRot[side] = restWristQ.clone().multiply(T)
    }
  }
  const out: Record<string, [number, number, number]> = {}
  for (const [bone, u] of Object.entries(p.dirs)) {
    const side = bone.startsWith(`mixamorigLeft`) ? 'Left' : 'Right'
    const v = new Vector3(...u).applyQuaternion(sideRot[side]).normalize()
    out[bone] = [+v.x.toFixed(5), +v.y.toFixed(5), +v.z.toFixed(5)]
  }
  return out
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
  const dirs = dirsDoc.space === 'wrist' ? wristSpaceToWorld(p) : p.dirs
  const bones = retargetPose(restBones, dirs)
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
const body = `// 本文件由 packages/camera-studio/scripts/pose-pipeline/build_seed_poses.ts 生成,勿手改。
// 重新生成:npx tsx packages/camera-studio/scripts/pose-pipeline/build_seed_poses.ts ${inName} ${outName} ${exportName}${
  onlyDirs ? ' --only-dirs' : ''
}
// 骨向来源:${dirsDoc.source ?? inName}
import type {PoseBones} from '../poseMode/poseOverride'

export type SeedPose = {key: string; name: string; bones: PoseBones}

export const ${exportName}: SeedPose[] = ${JSON.stringify(seedPoses, null, 1)}
`
fs.writeFileSync(outPath, body)
console.log(`已写出 ${path.relative(pkgRoot, outPath)}(${exportName})`)
