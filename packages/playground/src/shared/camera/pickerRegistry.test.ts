// packages/playground/src/shared/camera/pickerRegistry.test.ts
/**
 * 选择框体注册表:宿主注册/注销/缺省回退,pose 与 model 两槽位互不干扰。
 */
import type React from 'react'
import {
  getRegisteredPicker,
  registerModelPicker,
  registerPosePicker,
  unregisterModelPicker,
  unregisterPosePicker,
} from './pickerRegistry'

const DummyA: React.FC<any> = () => null
const DummyB: React.FC<any> = () => null

afterEach(() => {
  unregisterPosePicker()
  unregisterModelPicker()
})

test('缺省未注册 = undefined(调用方回退内置框体)', () => {
  expect(getRegisteredPicker('pose')).toBeUndefined()
  expect(getRegisteredPicker('model')).toBeUndefined()
})

test('注册后可读回;注销后回退 undefined', () => {
  registerPosePicker(DummyA)
  expect(getRegisteredPicker('pose')).toBe(DummyA)
  unregisterPosePicker()
  expect(getRegisteredPicker('pose')).toBeUndefined()
})

test('pose 与 model 两个槽位互不干扰', () => {
  registerPosePicker(DummyA)
  registerModelPicker(DummyB)
  expect(getRegisteredPicker('pose')).toBe(DummyA)
  expect(getRegisteredPicker('model')).toBe(DummyB)
  unregisterPosePicker()
  expect(getRegisteredPicker('pose')).toBeUndefined()
  expect(getRegisteredPicker('model')).toBe(DummyB)
})

test('重复注册后者覆盖前者', () => {
  registerPosePicker(DummyA)
  registerPosePicker(DummyB)
  expect(getRegisteredPicker('pose')).toBe(DummyB)
})
