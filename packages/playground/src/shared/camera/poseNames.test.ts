// packages/playground/src/shared/camera/poseNames.test.ts
/**
 * 姿势显示名:词典完整性(种子条目全覆盖,管线新增姿势会红这里提醒
 * 补词条)+ poseEntryName 解析(种子查词典,未命中/用户姿势回退原文)。
 */
import {poseEntryName} from './poseNames'
import {poseNameEn, poseNameZhCN} from './poseNameMessages'
import {seedPoses} from './assetLibrary/seedPoses'
import {seedPosesDpl} from './assetLibrary/seedPosesDpl'
import {seedPosesQbx} from './assetLibrary/seedPosesQbx'

const ALL_SEEDS = [...seedPoses, ...seedPosesDpl, ...seedPosesQbx]

test('词典覆盖全部内置姿势(en + zh-CN)', () => {
  expect(ALL_SEEDS.length).toBeGreaterThan(0)
  for (const p of ALL_SEEDS) {
    const key = 'pg.poseName.' + p.key
    expect(poseNameEn[key]).toBeTruthy()
    expect(poseNameZhCN[key]).toBeTruthy()
  }
})

test('poseEntryName:种子条目命中词典;未命中回退条目名原文', () => {
  // 词典 stub:只认一条
  const t = (k: string) => (k === 'pg.poseName.stand-relaxed' ? '站立放松' : k)
  expect(
    poseEntryName({id: 'seed-pose-stand-relaxed', name: '站立放松'}, t),
  ).toBe('站立放松')
  // 词典缺词条的种子条目 → 回退原文(不拆解)
  expect(
    poseEntryName({id: 'seed-pose-no-such', name: '基础 · Base · 左手'}, t),
  ).toBe('基础 · Base · 左手')
  // 用户自存姿势(非 seed-pose- 前缀)→ 原文
  expect(poseEntryName({id: 'pose-user-1', name: '我的姿势'}, t)).toBe(
    '我的姿势',
  )
})

test('poseEntryName:真实词典双语可取(抽样)', () => {
  const tEn = (k: string) => poseNameEn[k] ?? k
  const tZh = (k: string) => poseNameZhCN[k] ?? k
  const entry = {
    id: 'seed-pose-qbx-hands-02-other-fist-l',
    name: '其他 · Fist · 左手',
  }
  expect(poseEntryName(entry, tEn)).toBe('Fist')
  expect(poseEntryName(entry, tZh)).toBe('握拳')
  const dpl = {id: 'seed-pose-dpl-yoga-001', name: '瑜伽 · 001'}
  expect(poseEntryName(dpl, tEn)).toBe('Yoga 001')
  expect(poseEntryName(dpl, tZh)).toBe('瑜伽 1')
})
