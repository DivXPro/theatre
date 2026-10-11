// packages/playground/src/shared/camera/poseMode/poseValue.test.ts
import {
  isMigratedPoseValue,
  parsePoseValue,
  serializeCustomPose,
  serializeLibPose,
  serializePoseValue,
} from './poseValue'
import type {PoseBones} from './poseOverride'

const bones: PoseBones = {
  Hips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]},
}

describe('parsePoseValue', () => {
  test('空串与坏 JSON 回 null', () => {
    expect(parsePoseValue('')).toBe(null)
    expect(parsePoseValue('   ')).toBe(null)
    expect(parsePoseValue('{oops')).toBe(null)
  })

  test('新格式:lib 引用', () => {
    expect(parsePoseValue('{"kind":"lib","id":"p1"}')).toEqual({
      kind: 'lib',
      id: 'p1',
    })
  })

  test('新格式:custom 快照', () => {
    const json = serializeCustomPose(bones)
    expect(parsePoseValue(json)).toEqual({kind: 'custom', bones})
  })

  test('旧格式:不以 { 开头的一律按裸库 id 容错', () => {
    expect(parsePoseValue('entry_abc123')).toEqual({
      kind: 'lib',
      id: 'entry_abc123',
    })
    expect(parsePoseValue('42')).toEqual({kind: 'lib', id: '42'})
    expect(parsePoseValue('[1,2]')).toEqual({kind: 'lib', id: '[1,2]'})
  })

  test('旧格式:无 kind 的骨骼 JSON 容错为 custom', () => {
    expect(parsePoseValue(JSON.stringify(bones))).toEqual({
      kind: 'custom',
      bones,
    })
  })

  test('kind 无法识别回 null(有 kind 但不合法)', () => {
    expect(parsePoseValue('{"kind":"weird"}')).toBe(null)
    expect(parsePoseValue('{"kind":"lib"}')).toBe(null) // 缺 id
    expect(parsePoseValue('{"kind":"custom"}')).toBe(null) // 缺 bones
  })
})

describe('serializePoseValue / isMigratedPoseValue', () => {
  test('serialize 往返', () => {
    for (const v of [
      {kind: 'lib', id: 'x'} as const,
      {kind: 'custom', bones} as const,
    ]) {
      expect(parsePoseValue(serializePoseValue(v))).toEqual(v)
    }
    expect(serializeLibPose('x')).toBe('{"kind":"lib","id":"x"}')
  })

  test('isMigratedPoseValue 只认新格式', () => {
    expect(isMigratedPoseValue('{"kind":"lib","id":"x"}')).toBe(true)
    expect(isMigratedPoseValue('{"kind":"custom","bones":{}}')).toBe(true)
    expect(isMigratedPoseValue('entry_abc')).toBe(false)
    expect(isMigratedPoseValue(JSON.stringify(bones))).toBe(false)
    expect(isMigratedPoseValue('')).toBe(false)
    expect(isMigratedPoseValue('{oops')).toBe(false)
    expect(isMigratedPoseValue('{"kind":"lib"}')).toBe(false) // 缺 id
    expect(isMigratedPoseValue('{"kind":"custom"}')).toBe(false) // 缺 bones
  })
})
