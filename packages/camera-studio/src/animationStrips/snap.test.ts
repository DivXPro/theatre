import {resolveStripDrag} from './snap'
import {editStrip, stripEndMs} from './model'
import type {AnimationStrip, AnimationStripEdit, AnimationTracks} from './model'

const strip: AnimationStrip = {
  id: 'walk',
  assetId: 'action',
  startMs: 1000,
  sourceInMs: 200,
  sourceOutMs: 1000,
}
const next = {...strip, id: 'wave', startMs: 2425}
const document: AnimationTracks = {
  version: 1,
  tracks: [{id: 'actions', strips: [strip, next]}],
}
const grid = (timeMs: number) => Math.round(timeMs / 50) * 50

function drag(edit: AnimationStripEdit, timeMs: number, radiusMs = 35) {
  return resolveStripDrag({
    edit,
    strip,
    positionMs: timeMs,
    radiusMs,
    targetsMs: [0, 1600, 2205, next.startMs, stripEndMs(next), 4000],
    grid,
    preview: (position) =>
      editStrip(document, strip, edit, position, 1400, 4000),
  })
}

test('snaps the trailing edge of a moved strip to an off-grid neighbor', () => {
  const result = drag('move', 1620)
  expect(result.snapMs).toBe(2425)
  expect(result.strip).toEqual({...strip, startMs: 1625})
})

test('snaps a trim to the playhead and tries the grid when a closer target is invalid', () => {
  expect(drag('end', 1620)).toMatchObject({
    snapMs: 1600,
    strip: {...strip, sourceOutMs: 800},
  })
  expect(drag('end', 2190)).toMatchObject({
    snapMs: null,
    strip: {...strip, sourceOutMs: 1400},
  })
})
