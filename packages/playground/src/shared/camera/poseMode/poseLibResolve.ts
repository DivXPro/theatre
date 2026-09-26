/**
 * 库姿势解析缓存(spec §5)。约束:插值器/求值是同步热路径,库条目读取
 * (IndexedDB)是异步——同步 Map 缓存 + 异步 prefetch 填充,填充完成由
 * 调用方 invalidate() 触发重求值;未命中期间回 null(渲染回绑定、
 * 插值阶跃),每个 id 只告警一次。库姿势条目视为不可变(抽帧存姿势
 * 总是新建条目),缓存不失效。
 */
import {getLibrary} from '../assetLibrary/library'
import type {PoseBones} from './poseOverride'
import type {PosePropValue} from './poseValue'

const cache = new Map<string, PoseBones>()
const warned = new Set<string>()

export function resolveLibPoseBones(id: string): PoseBones | null {
  const bones = cache.get(id)
  if (bones) return bones
  if (!warned.has(id)) {
    warned.add(id)
    console.warn(`[pose] 库姿势 ${id} 未解析(缺失或加载中),回退绑定姿势`)
  }
  return null
}

export function resolvePoseBones(
  value: PosePropValue | null,
): PoseBones | null {
  if (!value) return null
  return value.kind === 'custom' ? value.bones : resolveLibPoseBones(value.id)
}

export async function prefetchLibPoses(
  ids: Iterable<string>,
  onReady: () => void,
): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => !cache.has(id))
  if (missing.length === 0) return
  await Promise.all(
    missing.map(async (id) => {
      try {
        const entry = await getLibrary().backend.getEntry(id)
        if (entry?.kind === 'pose') cache.set(id, entry.bones)
      } catch (err) {
        console.warn('[pose] 库姿势加载失败', id, err)
      }
    }),
  )
  onReady()
}

/** 测试与已知好数据(如刚解析过的库面板列表)直填缓存 */
export function __primeLibPoseCache(id: string, bones: PoseBones): void {
  cache.set(id, bones)
}

export function __resetLibPoseCache(): void {
  cache.clear()
  warned.clear()
}
