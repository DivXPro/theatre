/*
 * @jest-environment jsdom
 */
// packages/playground/src/shared/camera/poseMode/poseExitGuard.test.ts
/**
 * 姿势退出 Enter 守卫(spec §8.1 终审 F3):Enter 在交互元素(输入框/
 * 按钮/链接/下拉/contentEditable)里是控件自身语义(按钮 Enter=click,
 * 会在保存帧之后误触按钮处理器),不能触发退出保存。
 */
import {isPoseExitGuardedTarget} from './poseExitGuard'

test('普通容器/画布目标不守卫', () => {
  const div = document.createElement('div')
  expect(isPoseExitGuardedTarget(div)).toBe(false)
  const canvas = document.createElement('canvas')
  expect(isPoseExitGuardedTarget(canvas)).toBe(false)
})

test('输入框/文本域/contentEditable 守卫', () => {
  expect(isPoseExitGuardedTarget(document.createElement('input'))).toBe(true)
  expect(isPoseExitGuardedTarget(document.createElement('textarea'))).toBe(true)
  const editable = document.createElement('div')
  editable.setAttribute('contenteditable', 'true')
  expect(isPoseExitGuardedTarget(editable)).toBe(true)
})

test('按钮守卫(含按钮内嵌套子元素——span 命中最近的 button)', () => {
  const button = document.createElement('button')
  expect(isPoseExitGuardedTarget(button)).toBe(true)
  const span = document.createElement('span')
  button.appendChild(span)
  expect(isPoseExitGuardedTarget(span)).toBe(true)
})

test('链接/下拉/role=button 守卫', () => {
  expect(isPoseExitGuardedTarget(document.createElement('a'))).toBe(true)
  expect(isPoseExitGuardedTarget(document.createElement('select'))).toBe(true)
  const roleButton = document.createElement('div')
  roleButton.setAttribute('role', 'button')
  expect(isPoseExitGuardedTarget(roleButton)).toBe(true)
})

test('非元素目标(null/window 等)不守卫', () => {
  expect(isPoseExitGuardedTarget(null)).toBe(false)
  expect(isPoseExitGuardedTarget({} as EventTarget)).toBe(false)
})
