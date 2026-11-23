import '@dreamerbird/studio'
import theatre, {getProject, getStudioSync, val} from '@dreamerbird/core'
import type {ISheetObject} from '@dreamerbird/core'
import {globals} from '@dreamerbird/core/globals'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import {getPathMeta} from '../CameraPath'
import {getPathsRegistry, removePathFromRegistry} from '../pathRegistry'
import {IDENTITY_PATH_TRANSFORM} from '../pathModel'
import type {PathPointEntry} from '../pathModel'
import {
  CHARACTER_PATH_EDITOR,
  characterPathPropConfig,
  evaluateCharacterPath,
  getCharacterPathChannels,
  registerCharacterPathBindingValidator,
  setCharacterPathBinding,
  validateCharacterPathForExport,
} from './index'
import {buildCharacterPathSampler} from './sampler'

test('detail panel exposes the path binding row and hides path progress', () => {
  expect(characterPathPropConfig.characterPathId.editor).toBe(
    CHARACTER_PATH_EDITOR,
  )
  expect(characterPathPropConfig.characterPathProgress.hidden).toBe(true)
  expect(characterPathPropConfig.characterPathProgress.editor).toBeUndefined()
})

const corner: PathPointEntry[] = [
  {key: 'A', position: {x: 0, y: 0, z: 0}},
  {
    key: 'B',
    position: {x: 2, y: 0, z: 0},
    handles: {left: {x: -1, y: 0, z: 0}, right: {x: 0, y: 0, z: 1}},
    u: 0.9,
  },
  {key: 'C', position: {x: 2, y: 0, z: 4}},
]

const straight: PathPointEntry[] = [
  {key: 'A', position: {x: 0, y: 0, z: 0}},
  {key: 'B', position: {x: 10, y: 0, z: 0}},
]

test('samples normalized world distance even with local pacing anchors and nonuniform scale', () => {
  const sampler = buildCharacterPathSampler(corner, {
    ...IDENTITY_PATH_TRANSFORM,
    position: {x: 5, y: 1, z: 1},
    scale: {x: 4, y: 1, z: 1},
  })!
  const sample = sampler.sample(50)
  expect(sample.totalLength).toBeCloseTo(12)
  expect(sample.distance).toBeCloseTo(6)
  expect(sample.position.x).toBeCloseTo(11, 3)
  expect(sample.position.y).toBeCloseTo(1)
  expect(sample.position.z).toBeCloseTo(1)
  expect(sampler.sample(-1).position.toArray()).toEqual([5, 1, 1])
  expect(sampler.sample(101).position.toArray()).toEqual([13, 1, 5])
})

test('measures a quarter circle and aligns a model facing negative Z to the tangent', () => {
  const radius = 3.18
  const handle = (radius * 4 * (Math.SQRT2 - 1)) / 3
  const sampler = buildCharacterPathSampler(
    [
      {
        key: 'A',
        position: {x: radius, y: 0, z: 0},
        handles: {left: {x: 0, y: 0, z: 0}, right: {x: 0, y: 0, z: handle}},
      },
      {
        key: 'B',
        position: {x: 0, y: 0, z: radius},
        handles: {left: {x: handle, y: 0, z: 0}, right: {x: 0, y: 0, z: 0}},
      },
    ],
    IDENTITY_PATH_TRANSFORM,
  )!
  for (const progress of [0, 25, 50, 75, 100]) {
    const sample = sampler.sample(progress, {x: 0, z: -1})
    const angle = (progress * Math.PI) / 200
    expect(sample.position.x).toBeCloseTo(radius * Math.cos(angle), 2)
    expect(sample.position.z).toBeCloseTo(radius * Math.sin(angle), 2)
    expect(sample.distance).toBeCloseTo(radius * angle, 2)
    expect(Math.sin(sample.yaw!)).toBeCloseTo(Math.sin(angle), 2)
    expect(Math.cos(sample.yaw!)).toBeCloseTo(-Math.cos(angle), 2)
  }
})

test('uses the transformed horizontal tangent and preserves base yaw on vertical paths', () => {
  const sampler = buildCharacterPathSampler(straight, {
    ...IDENTITY_PATH_TRANSFORM,
    rotation: {x: 0, y: Math.PI / 2, z: 0},
  })!
  expect(Math.cos(sampler.sample(100, {x: 0, z: 1}).yaw!)).toBeCloseTo(-1)
  const vertical = buildCharacterPathSampler(straight, {
    ...IDENTITY_PATH_TRANSFORM,
    rotation: {x: 0, y: 0, z: Math.PI / 2},
  })!
  expect(vertical.sample(50, {x: 0, z: 1}).yaw).toBeUndefined()
  expect(
    buildCharacterPathSampler(straight, {
      ...IDENTITY_PATH_TRANSFORM,
      scale: {x: 0, y: 1, z: 1},
    }),
  ).toBeNull()
})

let projectNumber = 0
beforeAll(() => theatre.init({studio: true, usePersistentStorage: false}))

async function setup() {
  const project = getProject(`character-paths-${++projectNumber}`, {
    state: {
      definitionVersion: globals.currentProjectStateDefinitionVersion,
      revisionHistory: [],
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
  await project.ready
  const sheet = project.sheet('Scene')
  const studio = getStudioSync()!
  const character = sheet.object('Character', characterPathPropConfig)
  const second = sheet.object('Second Character', characterPathPropConfig)
  const paths = [{pathKey: 'Pos Path'}, {pathKey: 'Pos Path 2'}]
  studio.transaction(({set}) => {
    set(getPathsRegistry(sheet).props.list, JSON.stringify(paths))
    for (const {pathKey} of paths) {
      set(getPathMeta(sheet, pathKey).props.points, JSON.stringify(straight))
    }
  })
  return {project, sheet, studio, character, second, paths}
}

function progressTrack(
  character: ISheetObject<typeof characterPathPropConfig>,
) {
  return privateAPI(character)
    .template.getMapOfValidSequenceTracks_forStudio()
    .getValue().characterPathProgress
}

test('shares geometry across characters with independent progress and channel ownership', async () => {
  const {sheet, studio, character, second} = await setup()
  expect(
    setCharacterPathBinding(character, {pathKey: 'Pos Path', orient: true}),
  ).toEqual({ok: true})
  expect(
    setCharacterPathBinding(second, {pathKey: 'Pos Path', orient: false}),
  ).toEqual({ok: true})
  studio.transaction(({set}) => {
    set(character.props.characterPathProgress, 25)
    set(second.props.characterPathProgress, 75)
  })
  expect(character.value.characterPathId).toBe(second.value.characterPathId)
  expect(getCharacterPathChannels(character.value)).toEqual({
    position: true,
    rotation: true,
  })
  expect(getCharacterPathChannels(second.value)).toEqual({
    position: true,
    rotation: false,
  })
  const firstSample = evaluateCharacterPath(sheet, character.value)
  const secondSample = evaluateCharacterPath(sheet, second.value)
  expect(firstSample).toMatchObject({
    status: 'active',
    distance: 2.5,
    yaw: Math.PI / 2,
  })
  expect(secondSample).toMatchObject({
    status: 'active',
    distance: 7.5,
    yaw: undefined,
  })
  if (firstSample.status !== 'active' || secondSample.status !== 'active') {
    throw new Error('Expected two active character paths')
  }
  expect(firstSample.position.x).toBeCloseTo(2.5, 3)
  expect(secondSample.position.x).toBeCloseTo(7.5, 3)
})

test('accepts legacy object values without character path properties', async () => {
  const {sheet} = await setup()
  const values = {animationTracks: ''}
  expect(getCharacterPathChannels(values)).toEqual({
    position: false,
    rotation: false,
  })
  expect(evaluateCharacterPath(sheet, values)).toEqual({status: 'unbound'})
  expect(validateCharacterPathForExport(sheet, values)).toBeUndefined()
})

test('blocks a conflicting binding and preserves the previous values', async () => {
  const {sheet, character} = await setup()
  setCharacterPathBinding(character, {pathKey: 'Pos Path', orient: false})
  const before = character.value
  const pathsBefore = getPathsRegistry(sheet).value.list
  const unregister = registerCharacterPathBindingValidator(
    character,
    ({rotation}) =>
      rotation ? 'Turn strip owns rotation from 1s to 2s' : undefined,
  )
  expect(
    setCharacterPathBinding(character, {pathKey: 'Pos Path 2', orient: true}),
  ).toEqual({
    ok: false,
    message: 'Turn strip owns rotation from 1s to 2s',
  })
  expect(character.value).toEqual(before)
  expect(getPathsRegistry(sheet).value.list).toBe(pathsBefore)
  expect(evaluateCharacterPath(sheet, character.value)).toMatchObject({
    status: 'active',
    pathKey: 'Pos Path',
  })
  unregister()
  expect(
    setCharacterPathBinding(character, {pathKey: 'Pos Path 2', orient: true}),
  ).toEqual({ok: true})
})

test('preserves progress keys across unbind and rebind, including endpoint holds', async () => {
  const {sheet, studio, character} = await setup()
  expect(progressTrack(character)).toBeUndefined()
  setCharacterPathBinding(character, {pathKey: 'Pos Path', orient: true})
  expect(typeof progressTrack(character)).toBe('string')
  sheet.sequence.position = 2
  studio.transaction(({set}) => set(character.props.characterPathProgress, 20))
  sheet.sequence.position = 4
  studio.transaction(({set}) => set(character.props.characterPathProgress, 80))
  expect(
    privateAPI(character)
      .sheet.getSequence()
      .getKeyframesOfSimpleProp(character.props.characterPathProgress),
  ).toHaveLength(2)
  expect(
    setCharacterPathBinding(character, {pathKey: '', orient: true}),
  ).toEqual({ok: true})
  expect(evaluateCharacterPath(sheet, character.value)).toEqual({
    status: 'unbound',
  })
  setCharacterPathBinding(character, {pathKey: 'Pos Path 2', orient: true})
  sheet.sequence.position = 0
  expect(evaluateCharacterPath(sheet, character.value)).toMatchObject({
    status: 'active',
    distance: 2,
  })
  sheet.sequence.position = 6
  expect(evaluateCharacterPath(sheet, character.value)).toMatchObject({
    status: 'active',
    distance: 8,
  })
})

test('reports a deleted path during export even if its name has been reused', async () => {
  const {sheet, studio, character, paths} = await setup()
  setCharacterPathBinding(character, {pathKey: paths[0]!.pathKey, orient: true})
  removePathFromRegistry(sheet, paths[0]!)
  expect(evaluateCharacterPath(sheet, character.value)).toMatchObject({
    status: 'missing',
  })
  studio.transaction(({set}) => {
    set(getPathsRegistry(sheet).props.list, JSON.stringify(paths))
    set(
      getPathMeta(sheet, paths[0]!.pathKey).props.points,
      JSON.stringify(straight),
    )
  })
  expect(validateCharacterPathForExport(sheet, character.value)).toMatchObject({
    code: 'RESOURCE_LOAD_FAILED',
    pathId: val(character.props.characterPathId),
  })
  expect(
    setCharacterPathBinding(character, {
      pathKey: paths[0]!.pathKey,
      orient: true,
    }),
  ).toEqual({ok: true})
  expect(validateCharacterPathForExport(sheet, character.value)).toBeUndefined()
})

test('undo restores the binding and the saved scene resolves it before viewport mount', async () => {
  const {project, sheet, studio, character} = await setup()
  setCharacterPathBinding(character, {pathKey: 'Pos Path', orient: false})
  const pathId = character.value.characterPathId
  studio.transaction(({set}) => set(character.props.characterPathProgress, 65))
  setCharacterPathBinding(character, {pathKey: '', orient: false})
  studio.undo()
  expect(character.value.characterPathId).toBe(pathId)
  expect(evaluateCharacterPath(sheet, character.value)).toMatchObject({
    status: 'active',
    distance: 6.5,
  })

  const reopened = getProject(`character-paths-reopen-${++projectNumber}`, {
    state: JSON.parse(
      JSON.stringify(studio.createContentOfSaveFile(project.address.projectId)),
    ),
  })
  await reopened.ready
  const reopenedSheet = reopened.sheet('Scene')
  const reopenedCharacter = reopenedSheet.object(
    'Character',
    characterPathPropConfig,
  )
  expect(
    evaluateCharacterPath(reopenedSheet, reopenedCharacter.value),
  ).toMatchObject({
    status: 'active',
    pathId,
    yaw: undefined,
    distance: 6.5,
  })
})
