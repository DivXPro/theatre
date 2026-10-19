/**
 * 导演视角控制器(2026-10-17,Task 12):MainOrbitControls 挂载时把
 * orbit/pan/dolly/reset 一组函数登记到这里,`view.*` 导演视角命令
 * 经此转发到活着的 OrbitControls 实例(写回 theatre 的 scrub 事件流
 * 由 MainOrbitControls 内部复用)。未注册 = 场景尚未挂载轨道控制器,
 * 命令返回 API_NOT_READY,不静默成功。
 *
 * 卸载只解绑自己的控制器:同一对象引用校验,防过期组件的 cleanup
 * 抹掉新代次的登记(同 registerPathSampler 模式)。模块级表与
 * objectRuntime/pathRuntime 同模式:单页单场景。
 */

/**
 * 导演视角操作集。增量语义(与 UI 手势速度系数无关,纯世界量):
 * - orbit:deltaTheta 方位角增量(弧度,正值绕瞄准点逆时针,俯视);
 *   deltaPhi 极角增量(弧度,正值向水平方向下压,受轨道极角范围夹取)
 * - pan:deltaX/deltaY 世界单位,沿相机右/上方向平移机位与瞄准点
 * - dolly:delta 沿视线的距离增量(正值 = 靠近瞄准点,负值 = 拉远;
 *   结果距离不小于轨道最小距离)
 * - reset:恢复初始机位与瞄准点(与场景 JSX 的 position 同源常量)
 */
export type DirectorViewController = {
  orbit(args: {deltaTheta: number; deltaPhi: number}): void
  pan(args: {deltaX: number; deltaY: number}): void
  dolly(args: {delta: number}): void
  reset(): void
}

let controller: DirectorViewController | undefined

/**
 * MainOrbitControls 挂载 effect 调用;返回解绑函数
 * (仅当登记的还是同一控制器才删,防过期 cleanup 抹掉新代次)。
 */
export function registerDirectorView(next: DirectorViewController): () => void {
  controller = next
  return () => {
    if (controller === next) controller = undefined
  }
}

/** 当前登记的导演控制器;未挂载为 undefined(view.* 映射 API_NOT_READY) */
export function getDirectorView(): DirectorViewController | undefined {
  return controller
}
