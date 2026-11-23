// packages/camera-studio/src/placementPoseProps.test.ts
/**
 * PlacementManager 姿势注册改造的可测纯件:
 * - countLibraryEntryUsage 的姿势计数对旧裸 id 与新 {kind:'lib'} 都算使用
 * - 注册形态:pose = hidden + 自定义插值器;poseOverride 保留但 hidden(迁移过渡)
 */
import {readFileSync} from 'fs'
import {resolve} from 'path'
import {Bone, Group, Quaternion, Vector3} from 'three'
import {GLTFLoader} from 'three-stdlib'
import {applyPose} from './assetLibrary/pose'
import {
  isPoseEntryUsed,
  posePropConfigShape,
  shouldApplyPoseDuringPlayback,
  shouldApplyPoseWhenIdle,
} from './placementPoseProps'
import {poseInterpolate} from './poseMode/poseInterpolate'
import {__primeLibPoseCache} from './poseMode/poseLibResolve'
import {
  parsePoseValue,
  serializeCustomPose,
  serializeLibPose,
} from './poseMode/poseValue'
import {getBuiltinPose} from './poses'

test('isPoseEntryUsed:旧裸 id 与新格式 lib 引用都算使用;custom 不算', () => {
  expect(isPoseEntryUsed('entry_a', 'entry_a')).toBe(true)
  expect(isPoseEntryUsed('{"kind":"lib","id":"entry_a"}', 'entry_a')).toBe(true)
  expect(isPoseEntryUsed('{"kind":"custom","bones":{}}', 'entry_a')).toBe(false)
  expect(isPoseEntryUsed('', 'entry_a')).toBe(false)
})

test('posePropConfigShape:editor=pose + poseInterpolate + 空默认(属性行化)', () => {
  const shape = posePropConfigShape()
  expect(shape.defaultValue).toBe('')
  expect(shape.opts.hidden).toBe(true)
  expect(shape.opts.editor).toBe('pose')
  expect(shape.opts.interpolate).toBe(poseInterpolate)
  expect(typeof shape.opts.label).toBe('function')
})

test.each(['X Bot', 'Y Bot'])('%s 套用内置站立姿势后保持直立', async (name) => {
  const bytes = readFileSync(resolve(__dirname, `../assets/models/${name}.glb`))
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
  const placement = new Group()
  placement.rotation.set(0.4, 0.8, 0.2)
  placement.add(model)

  const preset = getBuiltinPose('seed-pose-stand-relaxed')!
  __primeLibPoseCache(preset.id, preset.bones)
  const {resolveBones} = posePropConfigShape(model)
  applyPose(model, resolveBones(parsePoseValue(serializeLibPose(preset.id)))!)

  const hips = model.getObjectByName('mixamorigHips')!
  const head = model.getObjectByName('mixamorigHead')!
  const torsoUp = head
    .getWorldPosition(new Vector3())
    .sub(hips.getWorldPosition(new Vector3()))
    .normalize()
  const placementUp = new Vector3(0, 1, 0).applyQuaternion(placement.quaternion)
  expect(torsoUp.dot(placementUp)).toBeGreaterThan(0.98)
})

test('内置姿势与自定义帧在目标髋骨坐标系内插值', () => {
  const armature = new Group()
  armature.rotation.x = Math.PI / 2
  const hips = new Bone()
  hips.name = 'mixamorigHips'
  armature.add(hips)
  const {opts, resolveBones} = posePropConfigShape(armature)

  const preset = getBuiltinPose('seed-pose-stand-relaxed')!
  __primeLibPoseCache(preset.id, preset.bones)
  const custom = serializeCustomPose({
    mixamorigHips: {rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]},
  })
  const mixed = opts.interpolate(serializeLibPose(preset.id), custom, 0.5)
  applyPose(armature, resolveBones(parsePoseValue(mixed))!)

  const worldRotation = hips.getWorldQuaternion(new Quaternion())
  expect(worldRotation.angleTo(new Quaternion())).toBeCloseTo(0.126, 3)
})

test('播放中只在有姿势轨道时逐帧应用姿势(spec §7.1)', () => {
  expect(shouldApplyPoseDuringPlayback(true)).toBe(true)
  expect(shouldApplyPoseDuringPlayback(false)).toBe(false)
})

test('空闲应用门禁:播放中不应用;姿势会话中不抢骨骼(退出后由依赖重跑补刷)', () => {
  // 空闲且非姿势模式 = 应用(值切换/撤销重做/会话退出补刷都走这里)
  expect(shouldApplyPoseWhenIdle(false, false)).toBe(true)
  // 播放中 = 不应用(mixer/播放求值独占)
  expect(shouldApplyPoseWhenIdle(true, false)).toBe(false)
  // 姿势模式会话中 = 不应用(IK 骨架每帧重解算,applyPose 会被压回;
  // 会话期间值被弹框/撤销/同步改掉时靠退出后的重跑补刷,不在会话里抢)
  expect(shouldApplyPoseWhenIdle(false, true)).toBe(false)
  expect(shouldApplyPoseWhenIdle(true, true)).toBe(false)
})
