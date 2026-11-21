import {Quaternion, Vector3} from 'three'
import {composePose} from './composer'
import type {BonePose, BonePoseTransform} from './composer'

function transform(
  position: [number, number, number],
  quaternion: Quaternion = new Quaternion(),
  scale: [number, number, number] = [1, 1, 1],
): BonePoseTransform {
  return {
    position: new Vector3(...position),
    quaternion,
    scale: new Vector3(...scale),
  }
}

test('returns a copy of the base pose when there are no samples', () => {
  const base: BonePose = new Map([['Hip', transform([3, 3, 3])]])

  const result = composePose(base, [])

  expect(result.get('Hip')?.position?.toArray()).toEqual([3, 3, 3])
  expect(result.get('Hip')).not.toBe(base.get('Hip'))
})

test('applies a single full-weight replace sample without mutating its pose', () => {
  const base: BonePose = new Map([['Hip', transform([3, 3, 3])]])
  const samplePose: BonePose = new Map([['Hip', transform([6, 6, 6])]])

  const result = composePose(base, [{pose: samplePose, weight: 1}])

  expect(result.get('Hip')?.position?.toArray()).toEqual([6, 6, 6])
  expect(samplePose.get('Hip')?.position?.toArray()).toEqual([6, 6, 6])
  expect(base.get('Hip')?.position?.toArray()).toEqual([3, 3, 3])
})

test('blends position, quaternion and scale by weight', () => {
  const base: BonePose = new Map([['Hip', transform([0, 0, 0])]])
  const sample: BonePose = new Map([
    [
      'Hip',
      transform(
        [10, 10, 10],
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI),
        [3, 3, 3],
      ),
    ],
  ])

  const result = composePose(base, [{pose: sample, weight: 0.5}])
  const hip = result.get('Hip')!

  expect(hip.position?.toArray()).toEqual([5, 5, 5])
  expect(hip.quaternion?.y).toBeCloseTo(Math.SQRT1_2)
  expect(hip.quaternion?.w).toBeCloseTo(Math.SQRT1_2)
  expect(hip.scale?.toArray()).toEqual([2, 2, 2])
})

test('composes samples in order and preserves channels a sample does not drive', () => {
  const base: BonePose = new Map([['Hip', transform([0, 0, 0])]])
  const first: BonePose = new Map([['Hip', {position: new Vector3(4, 4, 4)}]])
  const second: BonePose = new Map([['Hip', {position: new Vector3(8, 8, 8)}]])

  const result = composePose(base, [
    {pose: first, weight: 1},
    {pose: second, weight: 0.5},
  ])
  const hip = result.get('Hip')!

  expect(hip.position?.toArray()).toEqual([6, 6, 6])
  expect(hip.quaternion?.toArray()).toEqual([0, 0, 0, 1])
  expect(hip.scale?.toArray()).toEqual([1, 1, 1])
})
