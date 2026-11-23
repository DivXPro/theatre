import {
  addStrip,
  clampStripEditPosition,
  editStrip,
  evaluateStrips,
  parseAnimationTracks,
  sourceTimeAt,
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

test('keeps track and clip IDs when reading a previously saved multi-track document', () => {
  const earlier = {
    ...walking,
    id: 'earlier',
    startMs: 0,
    sourceInMs: 0,
    sourceOutMs: 1000,
  }
  const read = (later = walking) =>
    parseAnimationTracks(
      JSON.stringify({
        version: 1,
        tracks: [
          {id: 'first', strips: [later]},
          {id: 'second', strips: [earlier]},
        ],
      }),
    )
  const state = read()
  expect(state).toEqual({
    kind: 'tracks',
    document: {
      version: 1,
      tracks: [
        {id: 'first', strips: [walking]},
        {id: 'second', strips: [earlier]},
      ],
    },
  })
  if (state.kind !== 'tracks') throw new Error('Expected tracks')
  expect(evaluateStrips(state.document, 1000)[0]).toMatchObject({
    trackId: 'first',
    stripId: walking.id,
  })
  expect(() =>
    editStrip(state.document, walking, 'move', 500, 5000, 10000),
  ).toThrow(/overlap/)
  expect(read({...walking, startMs: 500})).toEqual({kind: 'invalid'})
})

test('plays an object position action in parallel with a skeletal action', () => {
  const state = {
    kind: 'tracks',
    document: {
      version: 2,
      tracks: [
        {id: 'bones', kind: 'bone', strips: [walking]},
        {id: 'object', kind: 'object', strips: []},
      ],
    },
  } as const
  const document = addStrip(
    {
      kind: 'tracks',
      document: {
        version: 2,
        tracks: state.document.tracks.map((track) => ({
          ...track,
          strips: [...track.strips],
        })),
      },
    },
    {...walking, id: 'slide', objectChannels: ['position']},
    'object',
    5000,
    8000,
  )
  expect(evaluateStrips(document, 2500).map(({stripId}) => stripId)).toEqual([
    'walk',
    'slide',
  ])
  expect(parseAnimationTracks(JSON.stringify(document))).toEqual({
    kind: 'tracks',
    document,
  })
})

test('maps all five iterations to the same local action time', () => {
  const repeat = {...walking, sourceOutMs: 1200, repeat: 5}
  const document = addStrip({kind: 'legacy'}, repeat, 'track', 5000, 8000)
  expect(stripEndMs(repeat)).toBe(6000)
  expect(sourceTimeAt(repeat, 250)).toBe(200)
  expect(sourceTimeAt(repeat, 9000)).toBe(1200)
  expect(sourceTimeAt(repeat, 3000)).toBe(200)
  for (const time of [1250, 2250, 3250, 4250, 5250]) {
    expect(evaluateStrips(document, time)[0]?.sourceTimeMs).toBe(450)
  }
  expect(evaluateStrips(document, 6000)).toEqual([])
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
  expect(parseAnimationTracks('{"version":3,"tracks":[]}').kind).toBe('invalid')
  expect(parseAnimationTracks('{').kind).toBe('invalid')
})

test('clamps strip edits to source and sequence boundaries', () => {
  expect(clampStripEditPosition(walking, 'move', -500, 5000, 8000)).toBe(0)
  expect(clampStripEditPosition(walking, 'move', 7000, 5000, 8000)).toBe(5000)
  expect(clampStripEditPosition(walking, 'start', -500, 5000, 8000)).toBe(800)
  expect(clampStripEditPosition(walking, 'start', 9999, 5000, 8000)).toBe(3999)
  expect(clampStripEditPosition(walking, 'end', 1000, 5000, 8000)).toBe(1001)
  expect(clampStripEditPosition(walking, 'end', 9999, 5000, 8000)).toBe(5800)
  expect(clampStripEditPosition(walking, 'end', 9999, 5000, 3500)).toBe(3500)
})
