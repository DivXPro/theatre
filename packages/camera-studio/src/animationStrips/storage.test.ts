import '@dreamerbird/studio'
import theatre, {getProject, onChange, types as t, val} from '@dreamerbird/core'
import {globals} from '@dreamerbird/core/globals'
import {getCoreTicker} from '@dreamerbird/core/coreTicker'
import getStudio from '@dreamerbird/studio/getStudio'
import {
  animationTracksProp,
  appendAnimationStrip,
  commitAnimationStripEdit,
  commitAnimationStripTiming,
} from './storage'
import {parseAnimationTracks} from './model'

void theatre.init({studio: true, usePersistentStorage: false})

test('adding and trimming are one undo each and saved strips reopen with their IDs', async () => {
  const project = getProject('animation-strips-save', {
    state: {
      definitionVersion: globals.currentProjectStateDefinitionVersion,
      revisionHistory: [],
      sheetsById: {
        Scene: {
          staticOverrides: {byObject: {}},
          sequence: {
            type: 'PositionalSequence',
            length: 10,
            subUnitsPerUnit: 24,
            tracksByObject: {},
          },
        },
      },
    },
  })
  await project.ready
  const sheet = project.sheet('Scene')
  const actor = sheet.object('Actor', {
    animationTracks: animationTracksProp,
    label: t.string('Actor'),
  })
  const stop = onChange(actor.props.animationTracks, () => {})
  const read = () => val(actor.props.animationTracks)
  appendAnimationStrip(actor, 'walking', 1200, 1000)
  getCoreTicker().tick()
  const added = read()
  const result = parseAnimationTracks(added)
  if (result.kind !== 'tracks') throw new Error('Expected saved strip')
  const strip = result.document.tracks[0]!.strips[0]!
  commitAnimationStripEdit(actor, strip, 'move', 2000, 1200)
  getCoreTicker().tick()
  const moved = read()
  const movedResult = parseAnimationTracks(moved)
  if (movedResult.kind !== 'tracks') throw new Error('Expected moved strip')
  const movedStrip = movedResult.document.tracks[0]!.strips[0]!
  expect(movedStrip).toMatchObject({
    id: strip.id,
    startMs: 2000,
    sourceOutMs: 1200,
  })
  expect(() =>
    commitAnimationStripEdit(actor, strip, 'end', 1800, 1200),
  ).toThrow('changed during the edit')
  expect(read()).toBe(moved)
  commitAnimationStripEdit(actor, movedStrip, 'end', 2800, 1200)
  getCoreTicker().tick()
  const trimmed = read()
  expect(trimmed).not.toBe(moved)
  const studio = getStudio()
  studio.undo()
  getCoreTicker().tick()
  expect(read()).toBe(moved)
  studio.undo()
  getCoreTicker().tick()
  expect(read()).toBe(added)
  studio.undo()
  getCoreTicker().tick()
  expect(read()).toBe('')
  for (const expected of [added, moved, trimmed]) {
    studio.redo()
    getCoreTicker().tick()
    expect(read()).toBe(expected)
  }
  const current = {...movedStrip, sourceOutMs: 800}
  expect(() =>
    commitAnimationStripTiming(
      actor,
      current,
      {startMs: 9500, sourceInMs: 100, sourceOutMs: 900},
      1200,
    ),
  ).toThrow('Invalid animation strip range')
  expect(read()).toBe(trimmed)
  commitAnimationStripTiming(
    actor,
    current,
    {startMs: 3000, sourceInMs: 100, sourceOutMs: 900},
    1200,
  )
  getCoreTicker().tick()
  const edited = parseAnimationTracks(read())
  expect(edited).toMatchObject({
    document: {
      tracks: [
        {
          strips: [
            {...current, startMs: 3000, sourceInMs: 100, sourceOutMs: 900},
          ],
        },
      ],
    },
  })
  studio.undo()
  getCoreTicker().tick()
  expect(read()).toBe(trimmed)
  const save = studio.publicApi.createContentOfSaveFile(
    project.address.projectId,
  )
  const reopened = getProject('animation-strips-reopened', {state: save})
  await reopened.ready
  const reopenedActor = reopened.sheet('Scene').object('Actor', {
    animationTracks: animationTracksProp,
    label: t.string('Actor'),
  })
  const stopReopened = onChange(reopenedActor.props.animationTracks, () => {})
  expect(val(reopenedActor.props.animationTracks)).toBe(trimmed)
  stopReopened()
  stop()
})
