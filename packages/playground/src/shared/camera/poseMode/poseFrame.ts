// packages/playground/src/shared/camera/poseMode/poseFrame.ts
/**
 * 摆姿势进入的帧模式判定(spec §8.1):底姿 = 播放头处时间轴求值(画面
 * 即求值,编辑态与画面一张皮);帧上进入 = 编辑该帧(保存覆盖),帧间
 * 进入 = 新建帧(保存插入)。位置一律贴网格(theatre 写帧也会贴)。
 */
export type PoseFrameMode = {mode: 'edit' | 'new'; position: number}

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
