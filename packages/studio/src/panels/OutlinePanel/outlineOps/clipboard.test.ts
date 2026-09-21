import {Atom} from '@dreamerbird/dataverse'
import {
  canPasteSnapshot,
  copySheetObject,
  pasteSnapshot,
  readObjectClipboard,
  snapshotSheetObject,
} from './clipboard'
import type {SheetObjectPropTypeConfig} from '@dreamerbird/core/types/public'

const staticConfig = {
  type: 'compound',
  props: {
    fov: {type: 'number'},
    pos: {
      type: 'compound',
      props: {
        x: {type: 'number'},
        y: {type: 'number'},
        z: {type: 'number'},
      },
    },
  },
} as unknown as SheetObjectPropTypeConfig

function makeObject(values: {
  fov: number
  pos: {x: number; y: number; z: number}
}) {
  const atom = new Atom(values)
  return {
    props: atom.pointer,
    template: {staticConfig},
  } as unknown as import('@dreamerbird/core/sheetObjects/SheetObject').default
}

describe('对象剪贴板', () => {
  it('snapshotSheetObject 快照顶层静态值 + 指纹', () => {
    const snap = snapshotSheetObject(
      makeObject({fov: 50, pos: {x: 1, y: 2, z: 3}}),
    )
    expect(snap.values).toEqual({fov: 50, pos: {x: 1, y: 2, z: 3}})
    expect(typeof snap.fingerprint).toBe('string')
  })

  it('copySheetObject 写入模块剪贴板,readObjectClipboard 读回', () => {
    const obj = makeObject({fov: 70, pos: {x: 0, y: 0, z: 0}})
    copySheetObject(obj)
    expect(readObjectClipboard()?.values.fov).toBe(70)
  })

  it('canPasteSnapshot:剪贴板空或指纹不匹配则禁粘', () => {
    const target = makeObject({fov: 1, pos: {x: 0, y: 0, z: 0}})
    expect(canPasteSnapshot(target, undefined)).toBe(false)
    const otherConfig = {
      type: 'compound',
      props: {other: {type: 'number'}},
    } as unknown as SheetObjectPropTypeConfig
    const otherAtom = new Atom({other: 1})
    const foreign = {
      props: otherAtom.pointer,
      template: {staticConfig: otherConfig},
    } as any
    const snap = snapshotSheetObject(foreign)
    expect(canPasteSnapshot(target, snap)).toBe(false)
    expect(canPasteSnapshot(target, snapshotSheetObject(target))).toBe(true)
  })

  it('pasteSnapshot 逐个顶层键写入(setProp 收集调用)', () => {
    const target = makeObject({fov: 1, pos: {x: 0, y: 0, z: 0}})
    const snap = snapshotSheetObject(
      makeObject({fov: 90, pos: {x: 4, y: 5, z: 6}}),
    )
    const calls: Array<[unknown, unknown]> = []
    pasteSnapshot((p, v) => calls.push([p, v]), target, snap)
    expect(calls).toHaveLength(2)
    expect(calls[0]![1]).toEqual(90)
    expect(calls[1]![1]).toEqual({x: 4, y: 5, z: 6})
  })
})
