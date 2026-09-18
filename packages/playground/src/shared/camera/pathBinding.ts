/**
 * 相机→路径的绑定解析(纯函数,单测直接断言)。
 *
 * 绑定存在相机对象的 pathKey 属性上:值为在册路径 key 即生效,空 =
 * 手动。pathKey 非空但解析不到在册路径(路径被删/对端同步删)= 绑定
 * 失效,调用方(ShotCamera 的看护 effect)负责清绑定并定格机位。
 *
 * 旧版是 moveMode+pathKey 双属性,还带 'Pos Path' 空 key 回退;绑定
 * 改面板下拉(单属性写)后 moveMode 只作隐藏的历史属性保留(已存状态
 * 兼容,不再读写),回退随旧状态一并退役。
 */
/** 解析当前生效的绑定路径 key;不生效返回 null */
export function resolveBoundPathKey(
  pathKey: string,
  registeredKeys: readonly string[],
): string | null {
  return pathKey && registeredKeys.includes(pathKey) ? pathKey : null
}

/** 绑定是否失效:pathKey 非空(有绑定意图)但已解析不到在册路径 */
export function isBindingStale(
  pathKey: string,
  registeredKeys: readonly string[],
): boolean {
  return pathKey !== '' && resolveBoundPathKey(pathKey, registeredKeys) === null
}
