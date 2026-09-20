// packages/playground/src/shared/camera/cameraRegistry.test.ts
import {
  nextCameraEntry,
  parseCameraEntries,
  cameraDisplayName,
  stashCameraSeed,
  consumeCameraSeed,
} from './cameraRegistry'

describe('parseCameraEntries', () => {
  test('解析合法清单;坏 JSON/非数组回退空', () => {
    expect(parseCameraEntries('[]')).toEqual([])
    const one = [
      {cameraKey: 'Shot Camera / Camera', targetKey: 'Shot Camera / Target'},
    ]
    expect(parseCameraEntries(JSON.stringify(one))).toEqual(one)
    expect(parseCameraEntries('not json')).toEqual([])
    expect(parseCameraEntries('{"a":1}')).toEqual([])
  })
  test('过滤畸形项', () => {
    expect(
      parseCameraEntries(
        '[{"cameraKey":"A","targetKey":"B"},{"foo":"bar"},{"cameraKey":1,"targetKey":"T"}]',
      ),
    ).toEqual([{cameraKey: 'A', targetKey: 'B'}])
  })
})

describe('cameraDisplayName', () => {
  test('去掉 " / Camera" 后缀', () => {
    expect(cameraDisplayName('Shot Camera / Camera')).toBe('Shot Camera')
    expect(cameraDisplayName('Shot Camera 3 / Camera')).toBe('Shot Camera 3')
  })
  test('无后缀/异常 key 原样返回', () => {
    expect(cameraDisplayName('Shot Camera')).toBe('Shot Camera')
    expect(cameraDisplayName('')).toBe('')
  })
})

describe('nextCameraEntry', () => {
  test('空清单给第一台(兼容既有状态的 key)', () => {
    expect(nextCameraEntry([])).toEqual({
      cameraKey: 'Shot Camera / Camera',
      targetKey: 'Shot Camera / Target',
    })
  })
  test('占用后递增编号,跳过已用的', () => {
    const existing = [
      {cameraKey: 'Shot Camera / Camera', targetKey: 'Shot Camera / Target'},
      {
        cameraKey: 'Shot Camera 3 / Camera',
        targetKey: 'Shot Camera 3 / Target',
      },
    ]
    expect(nextCameraEntry(existing)).toEqual({
      cameraKey: 'Shot Camera 2 / Camera',
      targetKey: 'Shot Camera 2 / Target',
    })
  })
})

describe('相机取景种子', () => {
  test('consume 一次性:取走就没', () => {
    const seed = {
      position: {x: 1, y: 2, z: 3},
      rotation: {x: 0, y: 0, z: 0},
      targetPosition: {x: 0, y: 1, z: 0},
    }
    stashCameraSeed('Shot Camera / Camera', seed)
    expect(consumeCameraSeed('Shot Camera / Camera')).toEqual(seed)
    expect(consumeCameraSeed('Shot Camera / Camera')).toBeUndefined()
    expect(consumeCameraSeed('没存过的')).toBeUndefined()
  })
})
