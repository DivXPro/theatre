/**
 * 路径采样运行时(2026-10-17,Task 11):CameraPath 挂载时把当前曲线的
 * 采样函数登记到这里,`paths.sample` 经此取世界坐标——与 ShotCamera
 * 每帧采样(CameraPath 模块级登记表 + samplePathPoint)读同一份
 * 名单/曲线/进度锚点/整体变换矩阵。
 *
 * 卸载只解绑自己的 pathKey:同一函数引用校验,防过期组件的 cleanup
 * 抹掉新代次的登记(同 unregisterSceneSheetObject 的 obj 校验)。
 * 模块级表与 objectRuntime/poseSessionRuntime 同模式:单页单场景。
 */
import type {Vector3} from 'three'

/**
 * 按进度(0~1)在路径上取世界坐标点。返回 false = 路径没有控制点
 * (调用方回退手动驱动 / Agent 映射 INVALID_STATE)。
 */
export type PathSampler = (u: number, out: Vector3) => boolean

const samplers = new Map<string, PathSampler>()

/** CameraPath 挂载 effect 调用;返回解绑函数(仅当登记的还是同一函数才删) */
export function registerPathSampler(
  pathKey: string,
  sampler: PathSampler,
): () => void {
  samplers.set(pathKey, sampler)
  return () => {
    if (samplers.get(pathKey) === sampler) samplers.delete(pathKey)
  }
}

/** 当前登记的采样器;路径未挂载为 undefined(paths.sample 映射 INVALID_STATE) */
export function getPathSampler(pathKey: string): PathSampler | undefined {
  return samplers.get(pathKey)
}
