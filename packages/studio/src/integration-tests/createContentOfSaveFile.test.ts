/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-restricted-syntax */
/**
 * Tests for `studio.createContentOfSaveFile(projectId)` — the persistence
 * entry point that serializes a project's current on-disk state (sheets,
 * keyframes, revisionHistory) into a value that can be re-imported via
 * `getProject(id, {state})`.
 */
import {__private, getProject} from '@toy-box/core'
import {shallowValidateOnDiskState} from '@toy-box/core/projects/Project'
import {globals} from '@toy-box/core/globals'
import {setupTestSheet} from '@toy-box/studio/integration-tests/testUtils'
import getStudio from '@toy-box/studio/getStudio'
import {encodePathToProp} from '@toy-box/utils/pathToProp'
import * as t from '@toy-box/core/propTypes'
import type {
  ObjectAddressKey,
  ProjectId,
  SequenceTrackId,
} from '@toy-box/core/types/public'

const {keyframeUtils} = __private
const {asKeyframeId, asSequenceTrackId} = __private.ids

const defaultProps = {
  position: {
    x: 0,
    y: 0,
    z: 0,
  },
  color: t.rgba(),
  deeply: {
    nested: {
      checkbox: true,
    },
  },
}

/**
 * Builds a project whose "obj" has a sequenced `position.y` prop carrying two
 * keyframes (values 3 and 6). Mirrors the fixture in Sequence.test.ts.
 */
async function buildProjectWithKeyframes() {
  return setupTestSheet({
    staticOverrides: {
      byObject: {},
    },
    sequence: {
      type: 'PositionalSequence',
      tracksByObject: {
        ['obj' as ObjectAddressKey]: {
          trackIdByPropPath: {
            [encodePathToProp(['position', 'y'])]: asSequenceTrackId('1'),
          },
          trackData: {
            ['1' as SequenceTrackId]: {
              type: 'BasicKeyframedTrack',
              keyframes: keyframeUtils.fromArray([
                {
                  id: asKeyframeId('0'),
                  position: 10,
                  connectedRight: true,
                  handles: [0.5, 0.5, 0.5, 0.5],
                  type: 'bezier',
                  value: 3,
                },
                {
                  id: asKeyframeId('1'),
                  position: 20,
                  connectedRight: false,
                  handles: [0.5, 0.5, 0.5, 0.5],
                  type: 'bezier',
                  value: 6,
                },
              ]),
            },
          },
        },
      },
    },
  })
}

describe('studio.createContentOfSaveFile', () => {
  test('throws for a project that has not been initialized', () => {
    const studio = getStudio()!
    expect(() =>
      studio.createContentOfSaveFile(
        'project-that-does-not-exist' as ProjectId,
      ),
    ).toThrow(/has not been initialized/)
  })

  test('returns a valid OnDiskState and prepends a fresh revision', async () => {
    const {project} = await buildProjectWithKeyframes()
    const studio = getStudio()!
    const state = studio.createContentOfSaveFile(project.address.projectId)

    expect(state.definitionVersion).toBe(
      globals.currentProjectStateDefinitionVersion,
    )
    expect((state.sheetsById as Record<string, unknown>)['Sheet']).toBeDefined()
    expect(state.revisionHistory.length).toBeGreaterThan(0)
    expect(typeof state.revisionHistory[0]).toBe('string')
    expect(state.revisionHistory[0]!.length).toBeGreaterThan(0)
  })

  test('output passes shallowValidateOnDiskState', async () => {
    const {project} = await buildProjectWithKeyframes()
    const studio = getStudio()!
    const state = studio.createContentOfSaveFile(project.address.projectId)

    expect(() =>
      shallowValidateOnDiskState(project.address.projectId, state),
    ).not.toThrow()
  })

  test('round-trips: re-importing the state restores sheets and keyframes', async () => {
    const {project} = await buildProjectWithKeyframes()
    const studio = getStudio()!
    const state = studio.createContentOfSaveFile(project.address.projectId)

    const reimported = getProject(`RoundTrip ${project.address.projectId}`, {
      state,
    })
    await reimported.ready

    const sheet = reimported.sheet('Sheet')
    const obj = sheet.object('obj', defaultProps)
    const seq = sheet.sequence
    const keyframes = seq.getKeyframes(obj.props.position.y)
    expect(keyframes).toHaveLength(2)
    expect(keyframes[0].value).toEqual(3)
    expect(keyframes[1].value).toEqual(6)
  })
})
