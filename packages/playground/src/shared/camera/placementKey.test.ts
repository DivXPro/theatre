// packages/playground/src/shared/camera/placementKey.test.ts
/**
 * 放置模型取名(顶层扁平化,不再套 "Models /" 文件夹):
 * 文件名净化、撞名追加序号、与全场景顶层路径防撞(相机/灯光/
 * 演示模型,如 "Camera.fbx"、"Thingy.fbx"——sheetObjectExists 只查不建)。
 */
import {setPrivateAPI} from '@dreamerbird/core/privateAPIs'
import {uniquePlacedModelKey} from './PlacementManager'

/** 假 sheet:注册表读不了(uniquePlacedModelKey 按空清单处理),
 *  getObject 按占用表只查不建 */
function fakeSheet(occupied: string[] = []) {
  const sheet = {type: 'Sheet'} as any
  const taken = new Set(occupied)
  setPrivateAPI(sheet, {
    getObject: (key: string) => (taken.has(key) ? {key} : undefined),
  } as any)
  return sheet
}

describe('uniquePlacedModelKey', () => {
  test('文件名去扩展名,不安全字符换下划线', () => {
    expect(uniquePlacedModelKey(fakeSheet(), 'Robot.fbx')).toBe('Robot')
    expect(uniquePlacedModelKey(fakeSheet(), 'a b.fbx')).toBe('a_b')
    expect(uniquePlacedModelKey(fakeSheet(), '.fbx')).toBe('model')
  })
  test('顶层路径被占(相机/灯光/演示模型同名)时追加序号', () => {
    expect(uniquePlacedModelKey(fakeSheet(['Robot']), 'Robot.fbx')).toBe(
      'Robot-2',
    )
    expect(
      uniquePlacedModelKey(fakeSheet(['Robot', 'Robot-2']), 'Robot.fbx'),
    ).toBe('Robot-3')
  })
  test('裸 sheet(探测落空、注册表读不了):原名直出', () => {
    expect(uniquePlacedModelKey({} as any, 'Robot.fbx')).toBe('Robot')
  })
})
