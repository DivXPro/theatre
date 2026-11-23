/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import theatre, {getProject, types} from '@dreamerbird/core'
import {getCoreTicker} from '@dreamerbird/core/coreTicker'
import {globals} from '@dreamerbird/core/globals'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import {Bone, Group} from 'three'
import {clearPoseSession, getPoseSession} from './poseSession'
import {writePoseKeyframe} from './poseTrack'
import {TextDecoder, TextEncoder} from 'util'

Object.assign(globalThis, {
  TextDecoder,
  TextEncoder,
  IS_REACT_ACT_ENVIRONMENT: true,
})
require('@dreamerbird/studio')
void theatre.init({studio: true, usePersistentStorage: false})

const model = new Group()
for (const name of [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
]) {
  const bone = new Bone()
  bone.name = `mixamorig:${name}`
  model.add(bone)
}

test('scene row opens the scene rig and tracks held coverage separately from the key diamond', async () => {
  jest.doMock('../PlacementManager', () => ({
    getPlacementInstanceForObject: () => ({
      entry: {key: 'Character'},
      instance: model,
    }),
    getPlacementEntryForObject: () => ({key: 'Character'}),
  }))
  const editor =
    require('./PosePropEditor') as typeof import('./PosePropEditor')
  const {ScenePosePropEditor} = editor
  const project = getProject('pose-scene-prop-editor', {
    state: {
      definitionVersion: globals.currentProjectStateDefinitionVersion,
      sheetsById: {
        Scene: {
          staticOverrides: {byObject: {}},
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
    pose: types.string(''),
    defaultPose: types.string(''),
  })
  const container = document.createElement('div')
  const root = createRoot(container)
  const tools = {type: 'Default'} as unknown as React.ComponentProps<
    typeof ScenePosePropEditor
  >['editingTools']
  try {
    act(() =>
      root.render(
        <ScenePosePropEditor
          obj={privateAPI(object)}
          value=""
          propConfig={types.string('')}
          editingTools={tools}
        />,
      ),
    )
    const diamond = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-testid="ScenePoseDiamond"]',
      )
    const coverage = () =>
      container.querySelector('[data-coverage]')?.getAttribute('data-coverage')
    expect(coverage()).toBe('none')
    expect(diamond()?.textContent).toBe('◇')
    act(() => diamond()?.click())
    expect(getPoseSession()).toMatchObject({key: 'Character', target: 'scene'})

    await act(async () => {
      clearPoseSession()
      sheet.sequence.position = 2
      writePoseKeyframe(object, '{"kind":"custom","bones":{}}')
      getCoreTicker().tick()
    })
    expect(coverage()).toBe('key')
    expect(diamond()?.textContent).toBe('◆')

    await act(async () => {
      sheet.sequence.position = 1
      getCoreTicker().tick()
    })
    expect(coverage()).toBe('hold-before')
    expect(diamond()?.textContent).toBe('◇')
  } finally {
    act(() => root.unmount())
    clearPoseSession()
    jest.dontMock('../PlacementManager')
  }
})
