import {
  createActionEditorSession,
  isActionEditorChannels,
  mapActionEditorTime,
  sampleActionEditorChannels,
  type ActionEditorChannel,
  type ActionEditorOptions,
} from './session'

const xyz = (x: number, y = 0, z = 0) => ({x, y, z})
const bone = (x: number) => ({
  position: xyz(x),
  quaternion: {x: 0, y: 0, z: 0, w: 1},
  scale: xyz(1, 1, 1),
})
const frameMs = 1000 / 30
const strip = {
  id: 'walk',
  startMs: frameMs,
  sourceInMs: 0,
  sourceOutMs: 32 * frameMs,
  repeat: 5,
}

function open(overrides: Partial<ActionEditorOptions> = {}) {
  const onApply = jest.fn()
  const onClose = jest.fn()
  const sourceTimeAt = jest.fn((sceneMs: number) => sceneMs - strip.startMs)
  const session = createActionEditorSession({
    strip,
    durationMs: 1200,
    sceneTimeMs: 9 * frameMs,
    sourceTimeAt,
    channels: [
      {kind: 'position', keys: [{id: 'start', timeMs: 0, value: xyz(2)}]},
      {kind: 'scale', keys: [{id: 'size', timeMs: 0, value: xyz(1, 1, 1)}]},
    ],
    boneNames: ['Hand'],
    sample: (timeMs) => ({object: {}, bones: {Hand: bone(timeMs / 100)}}),
    referenceCount: 2,
    onApply,
    onClose,
    ...overrides,
  })
  return {session, onApply, onClose, sourceTimeAt}
}

it('records changed bones together at the local frame without selecting or saving', () => {
  const {session, onApply} = open({
    channels: [],
    sample: () => ({
      object: {},
      bones: {Arm: bone(1), Hand: bone(2), Head: bone(3)},
    }),
    seedBoneKeys: () =>
      [0, 300, 600].map((timeMs) => ({timeMs, value: bone(0)})),
  })
  session.seek(300)
  const listener = jest.fn()
  session.subscribe(listener)
  const sameHead = {...bone(3), quaternion: {x: 0, y: 0, z: 0, w: -1}}
  expect(
    session.recordBonePose({Arm: bone(4), Hand: bone(5), Head: sameHead}),
  ).toBe(2)
  expect(listener).toHaveBeenCalledTimes(1)
  expect(session.getSnapshot().selectedBone).toBeNull()
  const channels = session.getSnapshot().channels
  expect(channels).toMatchObject([
    {
      boneName: 'Arm',
      keys: [{timeMs: 0}, {timeMs: 300, value: bone(4)}, {timeMs: 600}],
    },
    {
      boneName: 'Hand',
      keys: [{timeMs: 0}, {timeMs: 300, value: bone(5)}, {timeMs: 600}],
    },
  ])
  expect(session.recordBonePose({Arm: bone(4), Head: sameHead})).toBe(0)
  session.seek(400)
  expect(session.recordBonePose({Arm: bone(6)})).toBe(1)
  expect(
    session.getSnapshot().channels[0]!.keys.map((key) => key.timeMs),
  ).toEqual([0, 300, 400, 600])
  expect(onApply).not.toHaveBeenCalled()
  session.apply()
  expect(onApply).toHaveBeenCalledTimes(1)
})

it('records bones that were not present in the seeded action', () => {
  const {session, onApply} = open({
    channels: [],
    sample: () => ({object: {}, bones: {}}),
    boneNames: ['RightArm'],
  })
  expect(session.recordBonePose({RightArm: bone(9)})).toBe(1)
  expect(session.getSnapshot().channels).toMatchObject([
    {
      kind: 'bone',
      boneName: 'RightArm',
      keys: [{timeMs: 8 * frameMs, value: bone(9)}],
    },
  ])
  expect(onApply).not.toHaveBeenCalled()
})

it('enters the matching loop and clamps scene times outside the strip', () => {
  for (const frame of [9, 41, 73, 105, 137]) {
    const position = mapActionEditorTime(strip, frame * frameMs)
    expect(position.localTimeMs).toBeCloseTo(8 * frameMs)
    expect(position.iteration).toBe((frame - 9) / 32 + 1)
  }
  expect(mapActionEditorTime(strip, 0)).toMatchObject({
    localTimeMs: 0,
    iteration: 1,
    phase: 'before',
  })
  expect(mapActionEditorTime(strip, 32 * frameMs).localTimeMs).toBeCloseTo(
    31 * frameMs,
  )
  expect(mapActionEditorTime(strip, 33 * frameMs)).toMatchObject({
    localTimeMs: 0,
    iteration: 2,
    phase: 'inside',
  })
  for (const frame of [161, 162]) {
    expect(mapActionEditorTime(strip, frame * frameMs)).toMatchObject({
      localTimeMs: strip.sourceOutMs,
      iteration: 5,
      phase: 'after',
    })
  }
  const sourceTimeAt = jest.fn(() => 8 * frameMs)
  const {session} = open({sceneTimeMs: 73 * frameMs, sourceTimeAt})
  expect(sourceTimeAt).toHaveBeenCalledWith(73 * frameMs)
  const snapshot = session.getSnapshot()
  expect(snapshot.localTimeMs).toBeCloseTo(8 * frameMs)
  expect(snapshot.entry).toMatchObject({iteration: 3, repeat: 5})
})

it('accepts a source out point rounded just past the float32 clip duration', () => {
  const {session} = open({
    strip: {...strip, startMs: 0, repeat: 5},
    durationMs: Math.fround(strip.sourceOutMs / 1000) * 1000,
    sceneTimeMs: 72 * frameMs,
    sourceTimeAt: undefined,
  })

  const snapshot = session.getSnapshot()
  expect(snapshot.localTimeMs).toBeCloseTo(8 * frameMs)
  expect(snapshot.entry).toMatchObject({iteration: 3, repeat: 5})
})

it('stages edits, records one channel, and updates a key without changing its ID', () => {
  const {session, onApply, onClose} = open()
  session.seek(300)
  session.setObjectPreview('position', xyz(5))
  session.setObjectPreview('scale', xyz(3, 3, 3))
  expect(session.getSnapshot().values.object.position).toEqual(xyz(5))
  expect(session.getSnapshot().channels[0].keys).toHaveLength(1)

  session.recordKey({kind: 'position'})
  const original = session.getSnapshot().channels[0].keys[1]
  session.setObjectPreview('position', xyz(6))
  session.recordKey({kind: 'position'})
  expect(session.getSnapshot().channels[0].keys[1]).toEqual({
    id: original.id,
    timeMs: 300,
    value: xyz(6),
  })

  session.seek(0)
  expect(session.getSnapshot()).toMatchObject({
    discardedPreview: true,
    values: {object: {position: xyz(2), scale: xyz(1, 1, 1)}},
  })
  session.apply()
  session.apply()
  expect(onApply).toHaveBeenCalledTimes(1)
  expect(onApply).toHaveBeenCalledWith({
    stripId: 'walk',
    scope: 'strip',
    channels: session.getSnapshot().channels,
  })
  expect(onClose).toHaveBeenCalledWith('applied')
  expect(session.getSnapshot().entry.sceneTimeMs).toBe(9 * frameMs)
})

it('selects exact key time, rejects collisions, moves and deletes keys', () => {
  const {session} = open()
  session.seek(450)
  session.setObjectPreview('position', xyz(5))
  session.recordKey({kind: 'position'})
  const ref = session.getSnapshot().selectedKey!
  session.seek(900)
  session.selectKey(ref)
  expect(session.getSnapshot().localTimeMs).toBe(450)
  expect(session.moveKey(ref, 0)).toBe(false)
  expect(session.moveKey(ref, 1500)).toBe(false)
  expect(session.moveKey(ref, 750)).toBe(true)
  expect(session.getSnapshot().localTimeMs).toBe(750)
  expect(session.deleteKey(ref)).toBe(true)
  expect(session.deleteKey({kind: 'position', keyId: 'start'})).toBe(false)
  expect(session.getSnapshot().selectedKey).toBeNull()
})

it('records only the selected bone and preserves seeded motion and other bones', () => {
  const {session, onApply} = open({
    seedBoneKeys: () => [
      {timeMs: 0, value: bone(0)},
      {timeMs: 600, value: bone(6)},
    ],
    sample: (timeMs) => ({
      object: {},
      bones: {Hand: bone(timeMs / 100), Foot: bone(10)},
    }),
  })
  session.seek(300)
  session.selectBone('Hand')
  session.setBonePreview('Hand', bone(9))
  expect(session.getSnapshot().values.bones).toMatchObject({
    Hand: bone(9),
    Foot: bone(10),
  })
  session.recordKey({kind: 'bone', boneName: 'Hand'})
  session.seek(450)
  expect(session.getSnapshot().values.bones.Hand).toEqual(bone(7.5))
  session.apply('all')
  expect(onApply).toHaveBeenCalledTimes(1)
  expect(onApply.mock.calls[0][0]).toMatchObject({
    scope: 'all',
    channels: expect.arrayContaining([
      {
        kind: 'bone',
        boneName: 'Hand',
        keys: [0, 300, 600].map((timeMs) => expect.objectContaining({timeMs})),
      },
    ]),
  })
})

it('cancels without saving and keeps a failed apply open for retry', () => {
  const rejected = new Error('Conflict')
  const onApply = jest.fn().mockImplementationOnce(() => {
    throw rejected
  })
  const {session, onClose} = open({onApply})
  session.setObjectPreview('position', xyz(10))
  session.recordKey({kind: 'position'})
  expect(() => session.apply()).toThrow(rejected)
  expect(session.getSnapshot().status).toBe('open')
  session.apply()
  expect(onClose).toHaveBeenCalledWith('applied')

  const cancelled = open()
  cancelled.session.recordKey({kind: 'position'})
  cancelled.session.cancel()
  expect(cancelled.onApply).not.toHaveBeenCalled()
  expect(cancelled.onClose).toHaveBeenCalledWith('cancelled')
})

it('leaves persistence alone after recording and then removing a new key', () => {
  const {session, onApply} = open()
  session.setObjectPreview('position', xyz(8))
  session.recordKey({kind: 'position'})
  session.deleteKey(session.getSnapshot().selectedKey!)
  expect(session.getSnapshot().isDirty).toBe(false)
  session.apply()
  expect(onApply).not.toHaveBeenCalled()
})

it('allows the first key of an enabled object channel and restores the recorded value on selection', () => {
  const {session} = open({
    channels: [],
    objectChannels: ['position'],
    sample: () => ({object: {position: xyz(2)}, bones: {}}),
  })
  expect(session.setObjectPreview('scale', xyz(1, 1, 1))).toBe(false)
  expect(session.setObjectPreview('position', xyz(4))).toBe(true)
  expect(session.recordKey({kind: 'position'})).toBe(true)
  const ref = session.getSnapshot().selectedKey!
  session.setObjectPreview('position', xyz(8))
  session.selectKey(ref)
  expect(session.getSnapshot().values.object.position).toEqual(xyz(4))
  expect(session.getSnapshot().discardedPreview).toBe(true)
})

it('validates serializable channels and interpolates shuffled keys without mutation', () => {
  const channels: ActionEditorChannel[] = [
    {
      kind: 'position',
      keys: [
        {id: 'end', timeMs: 200, value: xyz(4)},
        {id: 'start', timeMs: 0, value: xyz(0)},
      ],
    },
    {
      kind: 'quaternion',
      keys: [
        {id: 'a', timeMs: 0, value: {x: 0, y: 0, z: 0, w: 1}},
        {id: 'b', timeMs: 200, value: {x: 0, y: 0, z: -1, w: 0}},
      ],
    },
  ]
  expect(
    isActionEditorChannels(JSON.parse(JSON.stringify(channels)), 200),
  ).toBe(true)
  expect(isActionEditorChannels(channels, 199)).toBe(false)
  expect(isActionEditorChannels([...channels, channels[0]])).toBe(false)
  expect(isActionEditorChannels([{kind: 'scale', keys: []}])).toBe(false)
  expect(
    isActionEditorChannels([
      {kind: 'position', keys: [{id: 'bad', timeMs: 0, value: xyz(Infinity)}]},
    ]),
  ).toBe(false)
  const {position, quaternion} = sampleActionEditorChannels(
    channels,
    100,
  ).object
  expect(position).toEqual(xyz(2))
  expect(quaternion?.z).toBeCloseTo(-Math.SQRT1_2)
  expect(quaternion?.w).toBeCloseTo(Math.SQRT1_2)
  expect(sampleActionEditorChannels(channels, 300).object.position).toEqual(
    xyz(4),
  )
  expect(channels[0].keys[0].id).toBe('end')
})
