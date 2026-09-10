/**
 * 相机→路径的绑定解析(纯函数,单测直接断言)。
 *
 * 绑定存在相机对象的 pathKey 属性上(moveMode=path 时生效);
 * pathKey 为空 + legacy 'Pos Path' 在册 = 旧状态,读侧回退视为绑定
 * legacy,不做写迁移。解析不到 = 绑定失效(路径被删/对端同步删),
 * 调用方(ShotCamera 的看护 effect)负责回退手动并清绑定。
 */
import {POS_PATH_KEY} from './CameraPath'

/** 解析当前生效的绑定路径 key;不生效返回 null */
export function resolveBoundPathKey(
  moveMode: string,
  pathKey: string,
  registeredKeys: readonly string[],
): string | null {
  if (moveMode !== 'path') return null
  if (pathKey && registeredKeys.includes(pathKey)) return pathKey
  if (!pathKey && registeredKeys.includes(POS_PATH_KEY)) return POS_PATH_KEY
  return null
}

/** 绑定是否失效:处于 path 模式但已解析不到生效路径 */
export function isBindingStale(
  moveMode: string,
  pathKey: string,
  registeredKeys: readonly string[],
): boolean {
  return (
    moveMode === 'path' &&
    resolveBoundPathKey(moveMode, pathKey, registeredKeys) === null
  )
}
