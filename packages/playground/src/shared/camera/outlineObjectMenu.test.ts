import {
  cameraOutlineMenuItems,
  cameraOutlineObjectMenu,
  setCameraOutlineMenuCtx,
  type CameraOutlineMenuCtx,
} from './outlineObjectMenu'
import {makeDictT, en} from './i18n'
import type {ISheetObject} from '@dreamerbird/core'

const t = makeDictT(en)

function makeCtx(
  overrides: Partial<CameraOutlineMenuCtx> = {},
): CameraOutlineMenuCtx {
  return {
    sheet: {} as any,
    cameras: [],
    anchors: [],
    placements: [],
    paths: [],
    handlers: {
      removeCamera: () => {},
      removeAnchor: () => {},
      removePlacement: () => {},
      removePath: () => {},
    },
    ...overrides,
  }
}

const asObject = (objectKey: string): ISheetObject<any> =>
  ({address: {objectKey}}) as unknown as ISheetObject<any>

describe('cameraOutlineMenuItems', () => {
  it('命中相机:delete 项接管内置删除(role)', () => {
    const calls: string[] = []
    const ctx = makeCtx({
      cameras: [{cameraKey: 'Shot Camera'}],
      handlers: {
        removeCamera: (e) => calls.push(`camera:${e.cameraKey}`),
        removeAnchor: () => {},
        removePlacement: () => {},
        removePath: () => {},
      },
    })
    const contribution = cameraOutlineMenuItems(asObject('Shot Camera'), ctx, t)
    expect(contribution).toBeDefined()
    expect(contribution!.items).toHaveLength(1)
    expect(contribution!.items[0]!.label).toBe('Delete')
    expect(contribution!.items[0]!.role).toBe('delete')
    contribution!.items[0]!.onSelect()
    expect(calls).toEqual(['camera:Shot Camera'])
  })

  it('命中锚点:传 key 和对象本身', () => {
    const calls: string[] = []
    const ctx = makeCtx({
      anchors: ['Anchor 1'],
      handlers: {
        removeCamera: () => {},
        removeAnchor: (key, obj) =>
          calls.push(`anchor:${key}:${obj ? 'obj' : 'noobj'}`),
        removePlacement: () => {},
        removePath: () => {},
      },
    })
    const obj = asObject('Anchor 1')
    const contribution = cameraOutlineMenuItems(obj, ctx, t)
    contribution!.items[0]!.onSelect()
    expect(calls).toEqual(['anchor:Anchor 1:obj'])
  })

  it('命中放置模型与路径', () => {
    const calls: string[] = []
    const ctx = makeCtx({
      placements: [{key: 'Model A', position: {x: 0, y: 0, z: 0}}],
      paths: [{pathKey: 'Path 1'}],
      handlers: {
        removeCamera: () => {},
        removeAnchor: () => {},
        removePlacement: (key) => calls.push(`placement:${key}`),
        removePath: (key) => calls.push(`path:${key}`),
      },
    })
    cameraOutlineMenuItems(asObject('Model A'), ctx, t)!.items[0]!.onSelect()
    cameraOutlineMenuItems(asObject('Path 1'), ctx, t)!.items[0]!.onSelect()
    expect(calls).toEqual(['placement:Model A', 'path:Path 1'])
  })

  it('未命中(Thingy/注册表等)返回 undefined,走 studio 默认菜单', () => {
    const ctx = makeCtx({cameras: [{cameraKey: 'Shot Camera'}]})
    expect(cameraOutlineMenuItems(asObject('Thingy'), ctx, t)).toBeUndefined()
  })
})

describe('cameraOutlineObjectMenu(注册扩展用)', () => {
  it('ctx 未设置时返回 undefined', () => {
    setCameraOutlineMenuCtx(undefined)
    expect(cameraOutlineObjectMenu(asObject('Shot Camera'))).toBeUndefined()
  })
})
