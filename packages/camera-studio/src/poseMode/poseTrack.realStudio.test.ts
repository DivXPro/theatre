import '@dreamerbird/studio'
import theatre, {getProject, types as t} from '@dreamerbird/core'
import {getCoreTicker} from '@dreamerbird/core/coreTicker'
import {globals} from '@dreamerbird/core/globals'
import getStudio from '@dreamerbird/studio/getStudio'
import * as poseTrack from './poseTrack'
import {poseInterpolate} from './poseInterpolate'
import {Bone, Group} from 'three'

const studio = getStudio()!
void theatre.init({studio: true, usePersistentStorage: false})

const legacy = '{"kind":"lib","id":"legacy"}'
const scene = '{"kind":"custom","bones":{"Head":{"q":[0,0,0,1]}}}'
const differentScene = '{"kind":"lib","id":"second"}'
let projectCount = 0

async function setup() {
  const project = getProject(`pose-track-real-${++projectCount}`, {
    state: {
      definitionVersion: globals.currentProjectStateDefinitionVersion,
      sheetsById: {
        Scene: {
          staticOverrides: {byObject: {Character: {pose: legacy}}},
          sequence: {
            type: 'PositionalSequence',
            length: 10,
            subUnitsPerUnit: 30,
            tracksByObject: {},
          },
        },
      },
    } as never,
  })
  getCoreTicker().tick()
  await project.ready
  const sheet = project.sheet('Scene')
  const object = sheet.object('Character', {
    defaultPose: t.string(''),
    pose: t.string('', {interpolate: poseInterpolate}),
    gestureL: t.string(''),
  })
  return {sheet, object}
}

test('first scene key migrates the legacy base and one undo reverses both changes', async () => {
  const {sheet, object} = await setup()
  sheet.sequence.position = 2

  poseTrack.writePoseKeyframe(object, scene)

  expect(object.value.defaultPose).toBe(legacy)
  expect(sheet.sequence.getKeyframes(object.props.pose)).toEqual([
    expect.objectContaining({position: 2, value: scene}),
  ])

  studio.undo()
  expect(poseTrack.getPoseTrackId(object)).toBeUndefined()
  expect(object.value.defaultPose).toBe('')
  expect(object.value.pose).toBe(legacy)

  studio.redo()
  expect(object.value.defaultPose).toBe(legacy)
  expect(poseTrack.getPoseKeyframePositions(object)).toEqual([2])
})

test('an explicit bind default overrides the old pose and is preserved on first key', async () => {
  const {sheet, object} = await setup()
  expect(poseTrack.resolveDefaultPose(object)).toBe(legacy)

  poseTrack.writeDefaultPose(object, '')
  expect(poseTrack.resolveDefaultPose(object)).toBe('')
  expect(poseTrack.getPoseTrackId(object)).toBeUndefined()
  expect(object.value.pose).toBe(legacy)

  sheet.sequence.position = 2
  poseTrack.writePoseKeyframe(object, scene)
  expect(object.value.defaultPose).toBe('')
  expect(poseTrack.resolveDefaultPose(object)).toBe('')
})

test('replacing an existing scene key leaves the default pose and gesture track intact', async () => {
  const {sheet, object} = await setup()
  sheet.sequence.position = 2
  poseTrack.writePoseKeyframe(object, scene)
  studio.transaction(({stateEditors}) => {
    stateEditors.coreByProject.historic.sheetsById.sequence.setPrimitivePropAsSequenced(
      {...object.address, pathToProp: ['gestureL']},
    )
  })
  studio.transaction(({set}) => set(object.props.gestureL, 'gesture'))
  const firstKey = sheet.sequence.getKeyframes(object.props.pose)[0]

  poseTrack.writePoseKeyframe(object, differentScene)

  expect(object.value.defaultPose).toBe(legacy)
  expect(sheet.sequence.getKeyframes(object.props.pose)).toEqual([
    expect.objectContaining({
      id: firstKey.id,
      position: 2,
      value: differentScene,
    }),
  ])
  expect(sheet.sequence.getKeyframes(object.props.gestureL)).toEqual([
    expect.objectContaining({position: 2, value: 'gesture'}),
  ])
})

test('static capture previews the base and commits only to the default field', async () => {
  const {sheet, object} = await setup()
  const model = new Group()
  const bone = new Bone()
  bone.name = 'Head'
  model.add(bone)
  sheet.sequence.position = 2.02
  const session = {key: 'Character', target: 'static'} as const
  const frame = poseTrack.preparePoseSession(
    session,
    model,
    object,
    (target, position) => {
      expect(target).toBe('static')
      expect(position).toBe(2.02)
      bone.position.x = 5
    },
  )
  expect(bone.position.x).toBe(5)
  expect(frame).toBeNull()
  poseTrack.commitPoseSession(session, model, object, frame)
  expect(JSON.parse(object.value.defaultPose)).toMatchObject({
    kind: 'custom',
    bones: {Head: {position: [5, 0, 0]}},
  })
  expect(sheet.sequence.getKeyframes(object.props.pose)).toEqual([])
  expect(sheet.sequence.position).toBe(2.02)
})

test('draft capture samples the draft and stays in the draft callback', async () => {
  const {sheet, object} = await setup()
  const model = new Group()
  const bone = new Bone()
  bone.name = 'Head'
  model.add(bone)
  const onCapture = jest.fn()
  const session = {
    key: 'Character',
    target: 'draft',
    draft: {
      onCapture,
      applyPreview: () => {
        bone.position.x = 3
      },
    },
  } as const
  const frame = poseTrack.preparePoseSession(session, model, object)
  expect(bone.position.x).toBe(3)
  poseTrack.commitPoseSession(session, model, object, frame)
  expect(onCapture).toHaveBeenCalledWith({
    Head: expect.objectContaining({position: [3, 0, 0]}),
  })
  expect(object.value.defaultPose).toBe('')
  expect(sheet.sequence.getKeyframes(object.props.pose)).toEqual([])
})

test('scene capture previews the snapped frame before storing its pose', async () => {
  const {sheet, object} = await setup()
  const model = new Group()
  const bone = new Bone()
  bone.name = 'Head'
  model.add(bone)
  const session = {key: 'Character', target: 'scene'} as const
  sheet.sequence.position = 2.001
  const frame = poseTrack.preparePoseSession(
    session,
    model,
    object,
    (target, position) => {
      expect(target).toBe('scene')
      expect(position).toBe(2)
      bone.position.x = 1
    },
  )
  expect(frame).toEqual({mode: 'new', position: 2})
  poseTrack.commitPoseSession(session, model, object, frame)
  expect(sheet.sequence.getKeyframes(object.props.pose)).toEqual([
    expect.objectContaining({
      position: 2,
      value: expect.stringContaining('"position":[1,0,0]'),
    }),
  ])
})
