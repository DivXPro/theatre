import {
  AnimationClip,
  Bone,
  Group,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three'
import type {AnimationTrackState} from './model'
import {applyAnimationStripFrame, createStripSampler} from './sampler'

test('samples an absolute frame after an earlier frame, a later frame and a pose override', () => {
  const model = new Group()
  const hip = new Bone()
  hip.name = 'Hip'
  hip.position.set(3, 3, 3)
  model.add(hip)
  const movement = new AnimationClip('Walk', 4, [
    new VectorKeyframeTrack('Hip.position', [0, 4], [0, 0, 0, 4, 8, 12]),
    new QuaternionKeyframeTrack(
      'Hip.quaternion',
      [0, 4],
      [0, 0, 0, 1, 0, 1, 0, 0],
    ),
  ])
  const sampler = createStripSampler(model)
  sampler.apply(movement, 2.5)
  const expected = [...hip.position.toArray(), ...hip.quaternion.toArray()]
  expect(hip.position.toArray()).toEqual([2.5, 5, 7.5])
  sampler.apply(movement, 0)
  sampler.apply(movement, 3)
  hip.position.set(9, 9, 9)
  sampler.apply(movement, 2.5)
  expect([...hip.position.toArray(), ...hip.quaternion.toArray()]).toEqual(
    expected,
  )
  hip.scale.setScalar(5)
  sampler.resetBase()
  expect(hip.position.toArray()).toEqual([3, 3, 3])
  expect(hip.scale.toArray()).toEqual([1, 1, 1])
  sampler.dispose()
})

test('samples without writing the model and applies the returned pose explicitly', () => {
  const model = new Group()
  const hip = new Bone()
  hip.name = 'Hip'
  hip.position.set(3, 3, 3)
  model.add(hip)
  const movement = new AnimationClip('Walk', 4, [
    new VectorKeyframeTrack('Hip.position', [0, 4], [0, 0, 0, 4, 8, 12]),
  ])
  const sampler = createStripSampler(model)

  const pose = sampler.sample(movement, 2.5)
  expect(hip.position.toArray()).toEqual([3, 3, 3])

  sampler.applyPose(pose)
  expect(hip.position.toArray()).toEqual([2.5, 5, 7.5])
  sampler.dispose()
})

test('keeps base channels when a single strip only drives position', () => {
  const model = new Group()
  const hip = new Bone()
  hip.name = 'Hip'
  hip.position.set(3, 3, 3)
  model.add(hip)
  const movement = new AnimationClip('Walk', 4, [
    new VectorKeyframeTrack('Hip.position', [0, 4], [0, 0, 0, 4, 8, 12]),
  ])
  const state: AnimationTrackState = {
    kind: 'tracks',
    document: {
      version: 1,
      tracks: [
        {
          id: 'track',
          strips: [
            {
              id: 'walk',
              assetId: 'walk-asset',
              startMs: 1000,
              sourceInMs: 500,
              sourceOutMs: 3500,
            },
          ],
        },
      ],
    },
  }
  const sampler = createStripSampler(model)
  const baseQuaternion = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI / 2,
  )

  applyAnimationStripFrame(
    sampler,
    state,
    (assetId) => (assetId === 'walk-asset' ? movement : undefined),
    2500,
    () => {
      hip.quaternion.copy(baseQuaternion)
    },
  )

  expect(hip.position.toArray()).toEqual([2, 4, 6])
  expect(hip.quaternion.toArray()).toEqual(baseQuaternion.toArray())
  sampler.dispose()
})
