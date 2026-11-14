/**
 * 导出期确定性动画时钟。
 *
 * PlacementManager 的 AnimationMixer 正常只在 sequence 播放时按 delta
 * 推进;离线导出不实时播放,而是由导出核心逐帧写入绝对 sequence 时间。
 * useFrame 读到非 null 时直接 mixer.setTime(秒),因此相同输入重复导出
 * 得到相同骨骼姿势,与机器性能无关。
 */
let exportTimeSeconds: number | null = null

export function setExportAnimationTime(seconds: number | null): void {
  exportTimeSeconds = seconds
}

export function getExportAnimationTime(): number | null {
  return exportTimeSeconds
}
