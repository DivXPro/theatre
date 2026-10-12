// packages/camera-studio/src/cameraRegistry.test.ts
import {setPrivateAPI} from '@dreamerbird/core/privateAPIs'
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
    // 旧格式宽容解析:targetKey 被忽略
    expect(parseCameraEntries(JSON.stringify(one))).toEqual([
      {cameraKey: 'Shot Camera / Camera'},
    ])
    expect(parseCameraEntries('not json')).toEqual([])
    expect(parseCameraEntries('{"a":1}')).toEqual([])
  })
  test('过滤畸形项', () => {
    expect(
      parseCameraEntries(
        '[{"cameraKey":"A","targetKey":"B"},{"foo":"bar"},{"cameraKey":1,"targetKey":"T"}]',
      ),
    ).toEqual([{cameraKey: 'A'}])
  })
})

describe('cameraDisplayName', () => {
  test('旧格式(套文件夹时期)的 key 去掉 " / Camera" 后缀', () => {
    expect(cameraDisplayName('Shot Camera / Camera')).toBe('Shot Camera')
    expect(cameraDisplayName('Shot Camera 3 / Camera')).toBe('Shot Camera 3')
  })
  test('扁平化后的新 key 无后缀,原样即显示名', () => {
    expect(cameraDisplayName('Shot Camera')).toBe('Shot Camera')
    expect(cameraDisplayName('Shot Camera 2')).toBe('Shot Camera 2')
    expect(cameraDisplayName('')).toBe('')
  })
})

describe('nextCameraEntry', () => {
  // 顶层扁平化后的命名:第一台 Shot Camera,之后 Shot Camera 2/3…;
  // 编号同时避开注册表已用 key 与全场景已占用路径(sheetObjectExists 探测)
  test('空清单给第一台', () => {
    expect(nextCameraEntry({} as any, [])).toEqual({cameraKey: 'Shot Camera'})
  })
  test('占用后递增编号,跳过已用的', () => {
    const existing = [{cameraKey: 'Shot Camera'}, {cameraKey: 'Shot Camera 3'}]
    expect(nextCameraEntry({} as any, existing)).toEqual({
      cameraKey: 'Shot Camera 2',
    })
  })
  test('旧格式(套文件夹)key 不占新名:新旧路径不同,第一台仍给 Shot Camera', () => {
    expect(
      nextCameraEntry({} as any, [{cameraKey: 'Shot Camera / Camera'}]),
    ).toEqual({
      cameraKey: 'Shot Camera',
    })
  })
  test('全场景路径被占(如模型叫了 Shot Camera.fbx)时跳过', () => {
    const sheet = {type: 'Sheet'} as any
    setPrivateAPI(sheet, {
      getObject: (key: string) => (key === 'Shot Camera' ? {} : undefined),
    } as any)
    expect(nextCameraEntry(sheet, [])).toEqual({cameraKey: 'Shot Camera 2'})
  })
})

describe('相机取景种子', () => {
  test('consume 一次性:取走就没', () => {
    const seed = {
      position: {x: 1, y: 2, z: 3},
      rotation: {x: 0, y: 0, z: 0},
    }
    stashCameraSeed('Shot Camera / Camera', seed)
    expect(consumeCameraSeed('Shot Camera / Camera')).toEqual(seed)
    expect(consumeCameraSeed('Shot Camera / Camera')).toBeUndefined()
    expect(consumeCameraSeed('没存过的')).toBeUndefined()
  })
})
