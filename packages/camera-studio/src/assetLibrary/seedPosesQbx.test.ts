// packages/playground/src/shared/camera/assetLibrary/seedPosesQbx.test.ts
/**
 * QBX 手势种子数据的不变量(2026-10-05 拇指偏差根治):
 * 手势方向必须是「手腕相对」的——源包(QBX)的模型手臂下垂,若按世界方向
 * 提取,会把手臂姿态烤进手势,应用到 T 姿势骨架上时手指相对手腕错位
 * (拇指最显眼)。本测试把 seedPosesQbx 应用到 Y Bot rest,量每根手指骨
 * 方向(用手腕世界四元数换算回手腕系),与管线 JSON 逐骨比对。
 * JSON 必须是 v2(space='wrist');v1(世界方向)数据会在这里红。
 */
import fs from 'fs'
import path from 'path'
import {FBXLoader} from 'three-stdlib'
import {Quaternion, Vector3} from 'three'
import {seedPosesQbx} from './seedPosesQbx'

const pkgRoot = path.resolve(__dirname, '../..')
const DOC_PATH = path.join(
  pkgRoot,
  'scripts/pose-pipeline/poses_directions_qbx.json',
)
const FBX_PATH = path.join(
  pkgRoot,
  'src/assetLibrary/seedModels/Y Bot.fbx',
)

type RestInfo = {
  parent: string | null
  localQuat: [number, number, number, number]
}

function loadRest(): Map<string, RestInfo> {
  const buf = fs.readFileSync(FBX_PATH)
  const root = new FBXLoader().parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    '',
  )
  const rest = new Map<string, RestInfo>()
  root.traverse((o) => {
    const bone = o as {isBone?: boolean; name: string; parent: unknown}
    if (!bone.isBone || rest.has(bone.name)) return
    const p = bone.parent as {isBone?: boolean; name?: string} | null
    rest.set(bone.name, {
      parent: p && p.isBone && p.name && rest.has(p.name) ? p.name : null,
      localQuat: [
        o.quaternion.x,
        o.quaternion.y,
        o.quaternion.z,
        o.quaternion.w,
      ],
    })
  })
  return rest
}

const doc = JSON.parse(fs.readFileSync(DOC_PATH, 'utf-8')) as {
  format: string
  space?: string
  poses: {key: string; dirs: Record<string, [number, number, number]>}[]
}

test('管线 JSON 是 v2 手腕相对格式(v1 世界方向会把手臂姿态烤进手势)', () => {
  expect(doc.format).toBe('pose-directions-v2')
  expect(doc.space).toBe('wrist')
})

test('条目按侧裁骨:名字带侧的只含本侧骨(挂错侧「没效果」的回归)', () => {
  // 2026-10-05 用户报告:右手选择框里有两个「反手 V」,一个没效果。
  // 根因:源包 Peace Flipped 的 action 名没带侧(实际是左手姿势),提取
  // 时双手骨都收,运行时「无侧后缀=双手手势」两侧都列,挂到右手只写
  // 了 rest 骨。修复=提取按侧裁骨+补侧名。这里兜底:名单侧 ⇔ 骨单侧
  for (const e of seedPosesQbx) {
    const sides = new Set(
      Object.keys(e.bones).map((b) =>
        b.startsWith('mixamorigLeft') ? 'left' : 'right',
      ),
    )
    if (e.name.endsWith('· 左手')) {
      expect([...sides]).toEqual(['left'])
    } else if (e.name.endsWith('· 右手')) {
      expect([...sides]).toEqual(['right'])
    }
  }
  // 当事条目:裸 key 的反手 V 实为左手,名字与骨都必须标左
  const bare = seedPosesQbx.find(
    (e) => e.key === 'qbx-hands-03-signs-peace-flipped',
  )!
  expect(bare.name).toContain('左手')
  expect(
    Object.keys(bare.bones).every((b) => b.startsWith('mixamorigLeft')),
  ).toBe(true)
  // 侧标在名字中间的 Gun 03 也要各归各侧
  for (const [key, side] of [
    ['qbx-hands-04-weapons-gun-03-l-cock-the-hammer', '左手'],
    ['qbx-hands-04-weapons-gun-03-r-cock-the-hammer', '右手'],
  ] as const) {
    expect(seedPosesQbx.find((e) => e.key === key)!.name).toContain(side)
  }
})

test('左右成对手势的手指弯曲度互为镜像(源包漏帧/左右搞混的回归)', () => {
  // 2026-10-05 三轮:FU R / Peace Flipped R 源 action 的右小指三节没 key
  // (恒等于 rest),提取时已按左手镜像补齐。判镜像用「骨节链夹角」
  // (相邻两节方向的夹角):标量、镜像不变,不受手腕朝向/滚转影响。
  // 成对姿势若同源,各指链夹角必须相等;index 对有 8.4° 自然手绘误差,
  // 阈值放 15°
  const chain = (
    dirs: Record<string, [number, number, number]>,
    side: 'Left' | 'Right',
    f: string,
    seg: number,
  ) => {
    const a = dirs[`mixamorig${side}Hand${f}${seg}`]
    const b = dirs[`mixamorig${side}Hand${f}${seg + 1}`]
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI
  }
  const pairBase = (key: string) =>
    key === 'qbx-hands-03-signs-peace-flipped'
      ? key
      : key.replace(/-[lr]$/, '').replace(/-[lr]-/, '-?-')
  const lefts = new Map<string, (typeof doc.poses)[number]>()
  const rights = new Map<string, (typeof doc.poses)[number]>()
  for (const p of doc.poses) {
    const isLeft = Object.keys(p.dirs)[0]?.startsWith('mixamorigLeft')
    ;(isLeft ? lefts : rights).set(pairBase(p.key), p)
  }
  let pairs = 0
  for (const [base, l] of lefts) {
    const r = rights.get(base)
    if (!r) throw new Error(`${l.key} 没有右手对子`)
    pairs++
    for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      for (const seg of [1, 2]) {
        const d = Math.abs(
          chain(l.dirs, 'Left', f, seg) - chain(r.dirs, 'Right', f, seg),
        )
        if (d > 15)
          throw new Error(
            `${base} ${f}${seg}↔${seg + 1} 左右弯曲度差 ${d.toFixed(1)}°`,
          )
      }
    }
  }
  expect(pairs).toBe(55)
})

test('手势应用后与源姿势解剖关系一致(平掌≈T 手,握拳蜷曲)', () => {
  const rest = loadRest()
  // rest 世界四元数(插入序即先序,父先于子)
  const restWorldQ = new Map<string, Quaternion>()
  for (const [name, info] of rest) {
    const local = new Quaternion(...info.localQuat)
    const parentQ = info.parent
      ? restWorldQ.get(info.parent)!
      : new Quaternion()
    restWorldQ.set(name, parentQ.clone().multiply(local))
  }
  const restDir = (bone: string) =>
    new Vector3(0, 1, 0).applyQuaternion(restWorldQ.get(bone)!).normalize()

  const angleOf = (key: string, bone: string) => {
    const entry = seedPosesQbx.find((e) => e.key === key)
    if (!entry) throw new Error(`种子缺 ${key}`)
    const worldQ = new Map<string, Quaternion>()
    for (const [name, info] of rest) {
      const local = new Quaternion(
        ...(entry.bones[name]?.rotation ?? info.localQuat),
      )
      const parentQ = info.parent ? worldQ.get(info.parent)! : new Quaternion()
      worldQ.set(name, parentQ.clone().multiply(local))
    }
    const applied = new Vector3(0, 1, 0)
      .applyQuaternion(worldQ.get(bone)!)
      .normalize()
    return (
      (Math.acos(Math.min(1, Math.max(-1, applied.dot(restDir(bone))))) * 180) /
      Math.PI
    )
  }

  const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) =>
    [1, 2, 3].map((i) => `${f}${i}`),
  )
  // 平掌(stop):四指全伸 ≈ T 姿势,应与 rest 方向齐平(v1 世界方向数据
  // 这里偏 50°+,naive 手腕系差 90°);拇指在 stop 里是侧向伸出的,与
  // T 姿势放松拇指本就不同(源预览图可见),不应对齐——断言外展 >40°
  for (const [side, s] of [
    ['Left', 'l'],
    ['Right', 'r'],
  ] as const) {
    for (const f of FINGERS) {
      if (f.startsWith('Thumb')) continue
      const a = angleOf(
        `qbx-hands-03-signs-stop-${s}`,
        `mixamorig${side}Hand${f}`,
      )
      if (a > 12)
        throw new Error(`stop ${side} ${f} 与 rest 差 ${a.toFixed(1)}°`)
    }
    const thumb = angleOf(
      `qbx-hands-03-signs-stop-${s}`,
      `mixamorig${side}HandThumb1`,
    )
    if (thumb < 40)
      throw new Error(`stop ${side} Thumb1 应外展,实测仅 ${thumb.toFixed(1)}°`)
  }
  // 放松(base):四指自然微蜷,相对 rest 小角度;绝不是 50° 级错位
  for (const [side, s] of [
    ['Left', 'l'],
    ['Right', 'r'],
  ] as const) {
    for (const f of FINGERS) {
      if (f.startsWith('Thumb')) continue
      const a = angleOf(
        `qbx-hands-01-base-base-${s}`,
        `mixamorig${side}Hand${f}`,
      )
      if (a > 25)
        throw new Error(`base ${side} ${f} 与 rest 差 ${a.toFixed(1)}°`)
    }
  }
  // 握拳(fist):四指近节蜷 ≥40°、中末节 ≥100°
  for (const [side, s] of [
    ['Left', 'l'],
    ['Right', 'r'],
  ] as const) {
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
      const a1 = angleOf(
        `qbx-hands-02-other-fist-${s}`,
        `mixamorig${side}Hand${f}1`,
      )
      if (a1 < 40)
        throw new Error(`fist ${side} ${f}1 只蜷了 ${a1.toFixed(1)}°`)
      const a2 = angleOf(
        `qbx-hands-02-other-fist-${s}`,
        `mixamorig${side}Hand${f}2`,
      )
      if (a2 < 100)
        throw new Error(`fist ${side} ${f}2 只蜷了 ${a2.toFixed(1)}°`)
    }
  }
})
