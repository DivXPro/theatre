// packages/playground/src/shared/camera/gestureProps.test.ts
/**
 * 手势属性纯件:条目判定/侧过滤/选项构建/显示文本/注册形态。
 * QBX 手势条目左右手骨都带(未动侧 rest),侧过滤是叠加语义的关键。
 */
import {
  buildGestureOptions,
  filterGestureBonesBySide,
  gestureDisplayText,
  gestureEntryNameSide,
  gesturePropConfigShape,
  isHandPoseEntry,
  resolveGestureBones,
} from './gestureProps'
import {poseInterpolate} from './poseMode/poseInterpolate'
import {serializeLibPose} from './poseMode/poseValue'
import {__primeLibPoseCache} from './poseMode/poseLibResolve'
import type {PoseBones} from './poseMode/poseOverride'

const rot = [0, 0, 0, 1] as [number, number, number, number]
const L_FINGERS: PoseBones = Object.fromEntries(
  ['Thumb1', 'Index1', 'Middle1', 'Ring1', 'Pinky1'].map((s) => [
    `mixamorigLeftHand${s}`,
    {rotation: rot},
  ]),
)
const R_FINGERS: PoseBones = Object.fromEntries(
  ['Thumb1', 'Index1', 'Middle1', 'Ring1', 'Pinky1'].map((s) => [
    `mixamorigRightHand${s}`,
    {rotation: rot},
  ]),
)
const BOTH_HANDS: PoseBones = {...L_FINGERS, ...R_FINGERS}

test('isHandPoseEntry:全手指骨才算;含躯干/手腕/空 bones 都不算', () => {
  expect(isHandPoseEntry({bones: BOTH_HANDS})).toBe(true)
  expect(isHandPoseEntry({bones: L_FINGERS})).toBe(true)
  // 全身姿势(带 Hips)不是手势
  expect(
    isHandPoseEntry({bones: {...BOTH_HANDS, mixamorigHips: {rotation: rot}}}),
  ).toBe(false)
  // 手腕(裸 …Hand)不算手指骨
  expect(
    isHandPoseEntry({
      bones: {...L_FINGERS, mixamorigLeftHand: {rotation: rot}},
    }),
  ).toBe(false)
  expect(isHandPoseEntry({bones: {}})).toBe(false)
  expect(isHandPoseEntry({})).toBe(false)
})

test('filterGestureBonesBySide:只留本侧手指骨', () => {
  const left = filterGestureBonesBySide(BOTH_HANDS, 'left')
  expect(Object.keys(left)).toHaveLength(5)
  expect(Object.keys(left).every((k) => k.includes('LeftHand'))).toBe(true)
  const right = filterGestureBonesBySide(BOTH_HANDS, 'right')
  expect(Object.keys(right).every((k) => k.includes('RightHand'))).toBe(true)
})

test('gestureEntryNameSide:名字后缀判侧,无后缀 = 双手', () => {
  expect(gestureEntryNameSide('其他 · Fist · 左手')).toBe('left')
  expect(gestureEntryNameSide('手势 · Thumbs Up · 右手')).toBe('right')
  expect(gestureEntryNameSide('手势 · Peace Flipped')).toBe(null)
})

test('resolveGestureBones:lib 引用解析后裁到本侧;空值/无本侧骨回 null', () => {
  __primeLibPoseCache('gest_both', BOTH_HANDS)
  __primeLibPoseCache('gest_right_only', R_FINGERS)
  const left = resolveGestureBones(serializeLibPose('gest_both'), 'left')
  expect(Object.keys(left ?? {})).toHaveLength(5)
  expect(Object.keys(left ?? {})[0]).toContain('LeftHand')
  expect(resolveGestureBones('', 'left')).toBe(null)
  // 条目只有右手骨:左手势应用回 null(跳过,不碰左手)
  expect(resolveGestureBones(serializeLibPose('gest_right_only'), 'left')).toBe(
    null,
  )
})

const t = ((k: string) => k) as (k: string) => string
const LIB = [
  {id: 'g_fist_l', name: '其他 · Fist · 左手', rig: 'rig-a', bones: BOTH_HANDS},
  {id: 'g_fist_r', name: '其他 · Fist · 右手', rig: 'rig-a', bones: BOTH_HANDS},
  {
    id: 'g_peace',
    name: '手势 · Peace Flipped',
    rig: 'rig-a',
    bones: BOTH_HANDS,
  },
  {
    id: 'p_body',
    name: '超级英雄 · Fist F',
    rig: 'rig-a',
    bones: {...BOTH_HANDS, mixamorigHips: {rotation: rot}},
  },
  {id: 'g_alien', name: '手势 · OK · 左手', rig: 'rig-b', bones: BOTH_HANDS},
]

test('buildGestureOptions:左手框 = 无手势 + 左手条目 + 双手条目;身体姿势不进框', () => {
  const {options, current} = buildGestureOptions({
    gestureJson: '',
    libEntries: LIB,
    side: 'left',
    selectedRig: 'rig-a',
    t,
  })
  expect(current).toBe('none')
  expect(options.map((o) => o.key)).toEqual([
    'none',
    'lib:g_fist_l',
    'lib:g_peace',
    'lib:g_alien',
  ])
  // 异族置灰
  expect(options.find((o) => o.key === 'lib:g_alien')?.disabled).toBe(true)
  expect(
    options.find((o) => o.key === 'lib:g_fist_l')?.disabled,
  ).toBeUndefined()
})

test('buildGestureOptions:右手框对称(左手条目不进);缺省 rig 不过滤全可点', () => {
  const {options} = buildGestureOptions({
    gestureJson: '',
    libEntries: LIB,
    side: 'right',
    t,
  })
  expect(options.map((o) => o.key)).toEqual([
    'none',
    'lib:g_fist_r',
    'lib:g_peace',
  ])
  expect(options.every((o) => !o.disabled)).toBe(true)
})

test('buildGestureOptions:当前值引用的条目不在本侧列表(含已删)追加置灰缺失项', () => {
  const {options, current} = buildGestureOptions({
    gestureJson: serializeLibPose('g_fist_r'), // 右手术条目出现在左手框:缺失项
    libEntries: LIB,
    side: 'left',
    t,
  })
  expect(current).toBe('lib:g_fist_r')
  const missing = options[options.length - 1]
  expect(missing.key).toBe('lib:g_fist_r')
  expect(missing.disabled).toBe(true)
})

test('buildGestureOptions:thumbUrlOf 注入时透传缩略图;无图条目不带 thumbUrl 字段', () => {
  const withThumb = LIB.map((e) =>
    e.id === 'g_fist_l' ? {...e, thumbnailId: 'blob-x'} : e,
  )
  const {options} = buildGestureOptions({
    gestureJson: '',
    libEntries: withThumb,
    side: 'left',
    thumbUrlOf: (e) => (e.thumbnailId ? `url:${e.thumbnailId}` : undefined),
    t,
  })
  expect(options.find((o) => o.key === 'lib:g_fist_l')?.thumbUrl).toBe(
    'url:blob-x',
  )
  const peace = options.find((o) => o.key === 'lib:g_peace')
  expect(peace && 'thumbUrl' in peace).toBe(false)
  // 不注入 thumbUrlOf:一律无图
  const plain = buildGestureOptions({
    gestureJson: '',
    libEntries: withThumb,
    side: 'left',
    t,
  })
  expect(plain.options.every((o) => !('thumbUrl' in o))).toBe(true)
})

test('buildGestureOptions:「无手势」项挂 noneThumbUrl(放松手预览);不传则无图', () => {
  const withThumb = buildGestureOptions({
    gestureJson: '',
    libEntries: LIB,
    side: 'left',
    noneThumbUrl: 'url:base-l',
    t,
  })
  expect(withThumb.options[0]).toMatchObject({
    key: 'none',
    thumbUrl: 'url:base-l',
  })
  const plain = buildGestureOptions({
    gestureJson: '',
    libEntries: LIB,
    side: 'left',
    t,
  })
  expect(plain.options[0]!.thumbUrl).toBeUndefined()
})

test('gestureDisplayText:空值无手势;库引用显名;缺失带标记;custom 报自定义', () => {
  expect(gestureDisplayText({gestureJson: '', libEntries: LIB, t})).toBe(
    'pg.gesture.none',
  )
  expect(
    gestureDisplayText({
      gestureJson: serializeLibPose('g_fist_l'),
      libEntries: LIB,
      t,
    }),
  ).toBe('其他 · Fist · 左手')
  expect(
    gestureDisplayText({
      gestureJson: serializeLibPose('gone'),
      libEntries: LIB,
      t,
    }),
  ).toBe('gonepg.pose.libMissing')
  expect(
    gestureDisplayText({
      gestureJson: '{"kind":"custom","bones":{}}',
      libEntries: LIB,
      t,
    }),
  ).toBe('pg.pose.statusCustom')
})

test('gesturePropConfigShape:editor 按侧分 key + 复用姿势插值器', () => {
  expect(gesturePropConfigShape('left').opts.editor).toBe('gestureL')
  expect(gesturePropConfigShape('right').opts.editor).toBe('gestureR')
  expect(gesturePropConfigShape('left').opts.interpolate).toBe(poseInterpolate)
  expect(gesturePropConfigShape('right').defaultValue).toBe('')
  expect(typeof gesturePropConfigShape('left').opts.label).toBe('function')
})
