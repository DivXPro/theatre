// packages/playground/src/shared/camera/poseMode/poseMigration.test.ts
/**
 * 旧两字段 → 新 pose 值的迁移合成(spec §9):覆盖优先;已是新格式不动;
 * 双空不迁移。旧值原样搬——读取侧容错(parsePoseValue)完成格式升级。
 */
import {computeLegacyPoseMigration} from './poseMigration'

const legacyBones = JSON.stringify({
  Hips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]},
})

test('已是新格式:不迁移(返回 null)', () => {
  expect(
    computeLegacyPoseMigration({
      pose: '{"kind":"lib","id":"p1"}',
      poseOverride: legacyBones,
    }),
  ).toBe(null)
})

test('覆盖优先:poseOverride 非空时搬 override(旧骨骼 JSON 原样)', () => {
  expect(
    computeLegacyPoseMigration({pose: 'entry_a', poseOverride: legacyBones}),
  ).toBe(legacyBones)
})

test('仅库姿势:搬旧裸 id 原样', () => {
  expect(computeLegacyPoseMigration({pose: 'entry_a', poseOverride: ''})).toBe(
    'entry_a',
  )
})

test('双空:不迁移', () => {
  expect(computeLegacyPoseMigration({pose: '', poseOverride: ''})).toBe(null)
  expect(computeLegacyPoseMigration({pose: '  ', poseOverride: '  '})).toBe(
    null,
  )
})
