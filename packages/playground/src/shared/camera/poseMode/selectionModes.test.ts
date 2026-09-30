/**
 * 选中目标 → 支持的操纵器模式(浮条禁用 + 自动切换的数据源):
 * - bone(胸口):纯旋转
 * - chain(脊柱):纯移动
 * - lookAt:有 rotateShare 双通道,无则纯移动
 * - limb 子选中:root(肩/髋环)纯旋转;elbow(肘/pole)双通道
 * - 其余(root/limb 主体)与无选中:双通道
 */
import {
  supportedModesForSelection,
  resolvePoseModeSwitch,
} from './selectionModes'
import type {ControlPointSpec} from '@dreamerbird/threeik/controls'

const specs = [
  {kind: 'root', name: 'hips', bone: 'Hips', rotation: true},
  {
    kind: 'limb',
    name: 'armL',
    rootBone: 'LU',
    middleBone: 'LL',
    endBone: 'LH',
    endRotation: true,
    rootRotation: true,
  },
  {kind: 'chain', name: 'spine', rootBone: 'S', endBone: 'N'},
  {kind: 'bone', name: 'chest', bone: 'C'},
  {
    kind: 'lookAt',
    name: 'head',
    rootBone: 'N',
    endBone: 'H',
    rotateShare: 0.4,
  },
  {kind: 'lookAt', name: 'gaze', rootBone: 'N', endBone: 'H'},
] as ControlPointSpec[]

test('无选中:两模式都可用', () => {
  expect(supportedModesForSelection(specs, null)).toEqual({
    move: true,
    rotate: true,
  })
})

test('bone(胸口):纯旋转', () => {
  expect(supportedModesForSelection(specs, 'chest')).toEqual({
    move: false,
    rotate: true,
  })
})

test('chain(脊柱):纯移动', () => {
  expect(supportedModesForSelection(specs, 'spine')).toEqual({
    move: true,
    rotate: false,
  })
})

test('lookAt 带 rotateShare:双通道;不带:纯移动', () => {
  expect(supportedModesForSelection(specs, 'head')).toEqual({
    move: true,
    rotate: true,
  })
  expect(supportedModesForSelection(specs, 'gaze')).toEqual({
    move: true,
    rotate: false,
  })
})

test('limb 主体与 root 点:双通道', () => {
  expect(supportedModesForSelection(specs, 'armL')).toEqual({
    move: true,
    rotate: true,
  })
  expect(supportedModesForSelection(specs, 'hips')).toEqual({
    move: true,
    rotate: true,
  })
})

test('limb 子选中:root(肩/髋环)纯旋转;elbow 双通道', () => {
  expect(supportedModesForSelection(specs, 'armL:root')).toEqual({
    move: false,
    rotate: true,
  })
  expect(supportedModesForSelection(specs, 'armL:elbow')).toEqual({
    move: true,
    rotate: true,
  })
})

test('未知选中名:不限(双通道)', () => {
  expect(supportedModesForSelection(specs, 'ghost')).toEqual({
    move: true,
    rotate: true,
  })
})

test('resolvePoseModeSwitch:当前模式不可用时给可用模式,否则 null', () => {
  expect(resolvePoseModeSwitch({move: false, rotate: true}, 'move')).toBe(
    'rotate',
  )
  expect(resolvePoseModeSwitch({move: true, rotate: false}, 'rotate')).toBe(
    'move',
  )
  expect(resolvePoseModeSwitch({move: true, rotate: true}, 'move')).toBeNull()
  expect(
    resolvePoseModeSwitch({move: false, rotate: true}, 'rotate'),
  ).toBeNull()
})
