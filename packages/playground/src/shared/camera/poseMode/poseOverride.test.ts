import {
  effectivePoseBones,
  parsePoseOverride,
  stringifyPoseOverride,
} from './poseOverride'
import type {PoseEntry} from '../assetLibrary/types'

const bonesA: PoseEntry['bones'] = {
  Hips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]},
}
const bonesB: PoseEntry['bones'] = {
  Head: {rotation: [0, 0, 0, 1], position: [0, 1.6, 0]},
}
const bind: PoseEntry['bones'] = {
  Root: {rotation: [0, 0, 0, 1], position: [0, 0, 0]},
}

test('stringify/parse 往返一致', () => {
  expect(parsePoseOverride(stringifyPoseOverride(bonesA))).toEqual(bonesA)
})

test('空串与坏 JSON 都返回 null', () => {
  expect(parsePoseOverride('')).toBeNull()
  expect(parsePoseOverride('{oops')).toBeNull()
  expect(parsePoseOverride('123')).toBeNull()
})

test('优先级:poseOverride > 库姿势 > 绑定姿势', () => {
  expect(effectivePoseBones('', null, bind)).toBe(bind)
  expect(effectivePoseBones('', bonesB, bind)).toBe(bonesB)
  expect(
    effectivePoseBones(stringifyPoseOverride(bonesA), bonesB, bind),
  ).toEqual(bonesA)
})
