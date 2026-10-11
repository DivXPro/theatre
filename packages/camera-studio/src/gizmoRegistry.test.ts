/**
 * 选中 gizmo 登记表的包围盒高亮标记:没有自带选中高亮的对象(放置的
 * 模型)默认画橙色包围盒线框;相机/路径/锚点有自己的变色高亮,登记时
 * 传 boxHighlight:false 不重复画。
 */
import {Object3D} from 'three'
import {
  getGizmoTargetEntry,
  onGizmoRegistryChange,
  registerGizmoTarget,
} from './PlacementManager'
import type {ISheetObject} from '@dreamerbird/core'

const fakeObj = () => ({}) as ISheetObject<any>

test('默认登记:包围盒高亮开', () => {
  const obj = fakeObj()
  const node = new Object3D()
  const unregister = registerGizmoTarget(obj, node)
  const entry = getGizmoTargetEntry(obj)
  expect(entry?.node).toBe(node)
  expect(entry?.boxHighlight).toBe(true)
  unregister()
})

test('boxHighlight:false 登记:不画包围盒(相机/路径/锚点有自己的高亮)', () => {
  const obj = fakeObj()
  const unregister = registerGizmoTarget(obj, new Object3D(), {
    boxHighlight: false,
  })
  expect(getGizmoTargetEntry(obj)?.boxHighlight).toBe(false)
  unregister()
})

test('注销后查不到登记项', () => {
  const obj = fakeObj()
  const unregister = registerGizmoTarget(obj, new Object3D())
  unregister()
  expect(getGizmoTargetEntry(obj)).toBeUndefined()
})

test('登记与注销都广播给监听者(选中态要立刻重算)', () => {
  const listener = jest.fn()
  const off = onGizmoRegistryChange(listener)
  const unregister = registerGizmoTarget(fakeObj(), new Object3D())
  expect(listener).toHaveBeenCalledTimes(1)
  unregister()
  expect(listener).toHaveBeenCalledTimes(2)
  off()
})
