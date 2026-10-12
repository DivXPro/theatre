// packages/camera-studio/src/poseMode/dragState.ts
/**
 * 姿势会话脏检查:退出前判定用户是否真拖过控制点。
 * 空进空出不提交(threeIK 首解有微小漂移,写回会产生幻影撤销步);
 * 语义对齐 modalGrab 的 `commit && moved`。
 */
/** 各 kind 句柄上可拖的操纵器面:target 已在 ctl.targets 里,这里只补环与 pole */
type Draggable = {readonly isDragging: boolean}
type HandleSurfaces = {
  readonly pole?: Draggable
  readonly rings?: Draggable
  readonly elbowRings?: Draggable
  readonly shoulderRings?: Draggable
}

/** names = 控制点装配表的 name 列表(resolveControlSpec 产物的 c.name) */
export function anyControlDragging(
  ctl: {
    readonly targets: readonly Draggable[]
    get(name: string): unknown
  },
  names: readonly string[],
): boolean {
  for (const t of ctl.targets) if (t.isDragging) return true
  for (const name of names) {
    const h = ctl.get(name) as HandleSurfaces | undefined
    if (
      h?.pole?.isDragging ||
      h?.rings?.isDragging ||
      h?.elbowRings?.isDragging ||
      h?.shoulderRings?.isDragging
    )
      return true
  }
  return false
}
