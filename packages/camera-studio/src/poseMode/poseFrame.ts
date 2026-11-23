// packages/camera-studio/src/poseMode/poseFrame.ts
/**
 * 摆姿势进入的帧模式判定(spec §8.1):底姿 = 播放头处时间轴求值(画面
 * 即求值,编辑态与画面一张皮);帧上进入 = 编辑该帧(保存覆盖),帧间
 * 进入 = 新建帧(保存插入)。位置一律贴网格(theatre 写帧也会贴)。
 */
export type PoseFrameMode = {mode: 'edit' | 'new'; position: number}

export type ScenePoseCoverage =
  | 'none'
  | 'key'
  | 'between'
  | 'hold-before'
  | 'hold-after'

function getKeyframeRange(
  positions: readonly number[],
): [number, number] | null {
  if (positions.length === 0) return null
  let first = positions[0]
  let last = first
  for (const position of positions) {
    first = Math.min(first, position)
    last = Math.max(last, position)
  }
  return [first, last]
}

export function getScenePoseCoverage(
  keyframePositions: readonly number[],
  position: number,
): ScenePoseCoverage {
  if (keyframePositions.includes(position)) return 'key'
  const range = getKeyframeRange(keyframePositions)
  if (!range) return 'none'
  if (position < range[0]) return 'hold-before'
  if (position > range[1]) return 'hold-after'
  return 'between'
}

export function getScenePoseCoverageSpans(
  positions: readonly number[],
  length: number,
): Array<{start: number; end: number; held: boolean}> {
  const range = getKeyframeRange(positions)
  if (!range) return []
  const first = Math.max(0, Math.min(range[0], length))
  const last = Math.max(0, Math.min(range[1], length))
  return [
    {start: 0, end: first, held: true},
    {start: first, end: last, held: false},
    {start: last, end: length, held: true},
  ].filter(({start, end}) => end > start)
}

export function determinePoseFrameMode(
  keyframePositions: number[],
  position: number,
  snap: (t: number) => number,
): PoseFrameMode {
  const snapped = snap(position)
  return {
    mode: keyframePositions.includes(snapped) ? 'edit' : 'new',
    position: snapped,
  }
}
