/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-restricted-syntax */
/**
 * Tests for `studio.createContentOfSaveFile(projectId)` — the persistence
 * entry point that serializes a project's current on-disk state (sheets,
 * keyframes, revisionHistory) into a value that can be re-imported via
 * `getProject(id, {state})`.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import {__private, getProject, val} from '@dreamerbird/core'
import {shallowValidateOnDiskState} from '@dreamerbird/core/projects/Project'
import {globals} from '@dreamerbird/core/globals'
import {setupTestSheet} from '@dreamerbird/studio/integration-tests/testUtils'
import getStudio from '@dreamerbird/studio/getStudio'
import {encodePathToProp} from '@dreamerbird/utils/pathToProp'
import * as t from '@dreamerbird/core/propTypes'
import type {
  ObjectAddressKey,
  OnDiskState,
  ProjectId,
  SequenceTrackId,
} from '@dreamerbird/core/types/public'

const {keyframeUtils} = __private
const {asKeyframeId, asSequenceTrackId} = __private.ids

// The committed 0.7-shape fixture (see
// packages/core/src/utils/state/stateMigration.test.ts for the import/validate
// half of the compatibility regression; the export round-trip lives here
// because `createContentOfSaveFile` is studio-only).
const representativeFixture = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      '../../../core/src/utils/state/__fixtures__/0.7/representative.json',
    ),
    'utf8',
  ),
) as unknown as OnDiskState

const fixtureObjProps = {
  position: {x: 0, y: 0, z: 0},
  color: t.rgba(),
  label: t.stringLiteral('r', {r: 'Red', g: 'Green'}),
  asset: t.file('model.glb'),
  deeply: {nested: {checkbox: false}},
}

const fixtureBoxProps = {
  opacity: 1,
  scale: 1,
}

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

  test('0.7 fixture export round-trips through createContentOfSaveFile', async () => {
    const projectId = '0.7-fixture-roundtrip' as ProjectId
    const project = getProject(projectId, {state: representativeFixture})
    await project.ready

    // export the imported 0.7-shape state
    const studio = getStudio()!
    const exported = studio.createContentOfSaveFile(projectId)

    // the export is itself valid on-disk state
    expect(() => shallowValidateOnDiskState(projectId, exported)).not.toThrow()

    // re-import the export and verify sheets + keyframes + static values survive
    const reimported = getProject(`RoundTrip ${projectId}`, {state: exported})
    await reimported.ready

    const sheetA = reimported.sheet('SheetA')
    const obj = sheetA.object('obj', fixtureObjProps)
    const keyframes = sheetA.sequence.getKeyframes(obj.props.position.y)
    expect(keyframes).toHaveLength(3)
    expect(keyframes.map((k) => k.value)).toEqual([0, 5, 5])
    expect(keyframes.map((k) => k.type)).toEqual(['bezier', 'bezier', 'hold'])
    expect(val(obj.props.label)).toBe('r')
    expect(val(obj.props.asset)).toEqual({type: 'file', id: 'model.glb'})

    const sheetB = reimported.sheet('SheetB')
    const box = sheetB.object('box', fixtureBoxProps)
    expect(val(box.props.scale)).toBe(3)
    expect(sheetB.sequence.getKeyframes(box.props.opacity)).toHaveLength(2)
  })
})
