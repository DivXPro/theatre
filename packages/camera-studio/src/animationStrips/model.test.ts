import {
  addStrip,
  editStrip,
  evaluateStrips,
  parseAnimationTracks,
  stripEndMs,
} from './model'

const walking = {
  id: 'walk',
  assetId: 'walking',
  startMs: 1000,
  sourceInMs: 200,
  sourceOutMs: 3200,
}

test('active strips use the source offset, with a half-open interval', () => {
  const tracks = addStrip({kind: 'legacy'}, walking, 'track', 5000, 8000)
  const waving = {...walking, id: 'wave', assetId: 'waving', startMs: 4000}
  const adjacent = addStrip(
    {kind: 'tracks', document: tracks},
    waving,
    'track',
    5000,
    8000,
  )
  expect(evaluateStrips(adjacent, 999)).toEqual([])
  expect(evaluateStrips(adjacent, 2500)).toEqual([
    {
      trackId: 'track',
      stripId: 'walk',
      assetId: 'walking',
      sourceTimeMs: 1700,
      weight: 1,
    },
  ])
  expect(evaluateStrips(adjacent, 4000)[0]?.stripId).toBe('wave')
  expect(evaluateStrips(adjacent, 7000)).toEqual([])
})

test('moving preserves length and trimming preserves the opposite edge', () => {
  const document = addStrip({kind: 'legacy'}, walking, 'track', 5000, 8000)
  const moved = editStrip(document, walking, 'move', 2000, 5000, 8000)
  expect(moved.startMs).toBe(2000)
  expect(stripEndMs(moved)).toBe(5000)
  const left = editStrip(document, walking, 'start', 1500, 5000, 8000)
  expect(left.sourceInMs).toBe(700)
  expect(stripEndMs(left)).toBe(4000)
  const right = editStrip(document, walking, 'end', 3500, 5000, 8000)
  expect(right.sourceOutMs).toBe(2700)
  expect(right.startMs).toBe(1000)
})

test('rejects overlap, invalid trim, and bounds, allowing fractional-grid joins', () => {
  const first = {
    ...walking,
    startMs: 1000 / 24,
    sourceInMs: 0,
    sourceOutMs: 1000 / 24,
  }
  const second = {...first, id: 'second', startMs: 2000 / 24}
  let document = addStrip({kind: 'legacy'}, first, 'track', 100, 1000)
  document = addStrip({kind: 'tracks', document}, second, 'track', 100, 1000)
  expect(evaluateStrips(document, second.startMs)[0]?.stripId).toBe('second')
  expect(() => editStrip(document, first, 'move', 60, 100, 1000)).toThrow()
  expect(() =>
    editStrip(document, first, 'end', first.startMs, 100, 1000),
  ).toThrow()
  expect(() => editStrip(document, first, 'end', 1200, 100, 1000)).toThrow()
})

test('reads old and empty projects, round trips stable IDs, and protects unknown versions', () => {
  const document = addStrip({kind: 'legacy'}, walking, 'track', 5000, 8000)
  expect(parseAnimationTracks('')).toEqual({kind: 'legacy'})
  expect(parseAnimationTracks('{"version":1,"tracks":[]}')).toEqual({
    kind: 'legacy',
  })
  expect(parseAnimationTracks(JSON.stringify(document))).toEqual({
    kind: 'tracks',
    document,
  })
  expect(
    parseAnimationTracks('{"version":1,"tracks":[{"id":"track","strips":[]}]}')
      .kind,
  ).toBe('tracks')
  expect(parseAnimationTracks('{"version":2,"tracks":[]}').kind).toBe('invalid')
  expect(parseAnimationTracks('{').kind).toBe('invalid')
})
