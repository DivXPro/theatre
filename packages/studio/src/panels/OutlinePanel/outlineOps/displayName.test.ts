import {objectDisplayNameOf, projectDisplayNameOf} from './displayName'
import type {SheetObjectAddress} from '@dreamerbird/core/types/public'

const address = {
  projectId: 'p1' as SheetObjectAddress['projectId'],
  sheetId: 's1' as SheetObjectAddress['sheetId'],
  sheetInstanceId: 'i1' as SheetObjectAddress['sheetInstanceId'],
  objectKey: 'Camera' as SheetObjectAddress['objectKey'],
}

describe('objectDisplayNameOf', () => {
  it('无覆盖名时回退 objectKey', () => {
    expect(objectDisplayNameOf(undefined, address)).toBe('Camera')
    expect(objectDisplayNameOf({}, address)).toBe('Camera')
  })

  it('有覆盖名时用覆盖名', () => {
    const key = JSON.stringify({
      projectId: 'p1',
      sheetId: 's1',
      sheetInstanceId: 'i1',
      objectKey: 'Camera',
    })
    expect(objectDisplayNameOf({[key]: '主机位'}, address)).toBe('主机位')
  })

  it('同名不同地址的对象互不影响', () => {
    const keyA = JSON.stringify({
      projectId: 'p1',
      sheetId: 's1',
      sheetInstanceId: 'i1',
      objectKey: 'Camera',
    })
    const otherInstance = {
      ...address,
      sheetInstanceId: 'i2' as SheetObjectAddress['sheetInstanceId'],
    }
    expect(objectDisplayNameOf({[keyA]: '主机位'}, otherInstance)).toBe(
      'Camera',
    )
  })
})

describe('projectDisplayNameOf', () => {
  it('uses the project display name without changing its ID', () => {
    expect(
      projectDisplayNameOf({
        config: {name: '我的 3D 场景'},
        address: {projectId: 'stage:scene_1' as never},
      }),
    ).toBe('我的 3D 场景')
  })

  it('falls back to the project ID when no display name is configured', () => {
    expect(
      projectDisplayNameOf({
        config: {},
        address: {projectId: 'stage:scene_1' as never},
      }),
    ).toBe('stage:scene_1')
  })
})
