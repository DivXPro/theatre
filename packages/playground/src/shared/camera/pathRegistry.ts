// packages/playground/src/shared/camera/pathRegistry.ts
/**
 * 路径注册表:场景里有几条路径 = 注册表清单里有几行,每条路径是一个
 * theatre 对象(变换 + 控制点 + 行进进度)。照搬相机注册表模式;
 * P1 上限一条(工具条置灰),结构天然支持多条。
 *
 * 生命周期:添加 = 注册表加一行(App 按清单渲染 CameraPath,组件挂载
 * 即创建对象、大纲行出现);删除 = forgetObject 清持久数据 + detachObject
 * 显式脱离(路径对象不是 editable,卸载不会自动脱离)+ 注册表移除。
 * 两步事务,撤销也是两步,都能完整回滚。
 *
 * "没点就不出现":新路径落地即播第一个点;删掉最后一个点 = 删除整条
 * 路径(走 removePathFromRegistry);启动自检清掉"对象在但清单没有"的
 * 孤儿(老场景残留的空路径对象)。
 */
import {getStudioSync, types as t, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {useEffect, useMemo, useState} from 'react'
import {getPathMeta} from './CameraPath'

/** 注册表对象的 theatre key(大纲顶层 "Paths" 行,和 Cameras 同款) */
export const PATHS_REGISTRY_KEY = 'Paths'

/** 一条路径 = 一个 theatre 对象;清单里只存 key */
export type PathEntry = {pathKey: string}

/** 第一条沿用既有 key:老场景的路径数据就是这个名字 */
const FIRST_PATH: PathEntry = {pathKey: 'Pos Path'}

export function getPathsRegistry(sheet: ISheet) {
  return sheet.object(PATHS_REGISTRY_KEY, {list: t.string('[]')})
}

/** 解析清单 JSON;坏数据一律回退空(注册表是底账,勿手改) */
export function parsePathEntries(json: string): PathEntry[] {
  try {
    const list = JSON.parse(json)
    if (!Array.isArray(list)) return []
    return list.filter(
      (item): item is PathEntry =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.pathKey === 'string' &&
        item.pathKey.length > 0,
    )
  } catch {
    return []
  }
}

export function readPathEntries(registry: ISheetObject<any>): PathEntry[] {
  return parsePathEntries(val(registry.props.list) as string)
}

/** 多条路径(P2)的命名:第一条 Pos Path,之后 Pos Path 2 / 3… */
export function nextPathEntry(existing: readonly PathEntry[]): PathEntry {
  if (existing.length === 0) return FIRST_PATH
  const used = new Set(existing.map((e) => e.pathKey))
  for (let n = 2; ; n++) {
    const pathKey = `Pos Path ${n}`
    if (!used.has(pathKey)) return {pathKey}
  }
}

/** 响应式读路径清单:scrub 提交/撤销/同步都会触发 onValuesChange */
export function usePathsList(sheet: ISheet): PathEntry[] {
  const registry = useMemo(() => getPathsRegistry(sheet), [sheet])
  const [list, setList] = useState<PathEntry[]>(() => readPathEntries(registry))
  useEffect(() => {
    setList(readPathEntries(registry))
    return registry.onValuesChange(() => setList(readPathEntries(registry)))
  }, [registry])
  return list
}

/** 添加路径:注册表加一行(App 按清单渲染,组件挂载即创建对象) */
export function addPathToRegistry(sheet: ISheet, entry: PathEntry) {
  const studio = getStudioSync()
  if (!studio) return
  const registry = getPathsRegistry(sheet)
  const list = readPathEntries(registry)
  // 连击/重入防护:同一 pathKey 已存在就不重复提交
  if (list.some((e) => e.pathKey === entry.pathKey)) return
  const scrub = studio.scrub()
  scrub.capture(({set}) =>
    set(registry.props.list, JSON.stringify([...list, entry])),
  )
  scrub.commit()
}

/**
 * 删除路径:先清持久数据(forgetObject:静态覆盖 + 时间轴轨道)
 * 并显式脱离(detachObject:路径对象不是 editable,卸载不会自动脱离),
 * 再从注册表移除(组件卸载 → 大纲行消失)。撤销两步都能完整回滚。
 *
 * boundCameras:删除前由调用方收集的"绑定了这条路径的相机"(App 有
 * 相机对象 refs)。它们的回退(定格机位 + 回手动 + 清绑定)折进清单
 * 移除的同一个 scrub——撤销删除会把清单行、绑定、机位一起还原,全程
 * 不留"绑定还在但路径没了"的中间态。若不折进来,ShotCamera 的失效
 * 看护会在本地删除后再补一笔回退:撤销删除时绑定先被还原成失效态,
 * 看护立刻再打回手动,新事务把撤销游标归零并截断重做历史,撤销永远
 * 原地打转(实测确认的撤销陷阱)
 */

/** 删除路径时一并回退的绑定相机;freeze 为 null 表示路径没点、没被驱动过,机位不动 */
export type BoundCameraReset = {
  obj: ISheetObject<any>
  freeze: {x: number; y: number; z: number} | null
}

export function removePathFromRegistry(
  sheet: ISheet,
  entry: PathEntry,
  boundCameras: BoundCameraReset[] = [],
) {
  const studio = getStudioSync()
  if (!studio) return
  // getPathMeta 对已存在的对象直接返回句柄(配置走缓存,同一引用)
  const meta = getPathMeta(sheet, entry.pathKey)
  try {
    studio.transaction(({forgetObject}) => forgetObject(meta as any))
  } catch (err) {
    // forgetObject 对"没写过任何覆盖/轨道"的对象会触发 saaz draft 的
    // 老坑(TypeError);这类对象本来就没在持久态留痕,刷新即没,跳过
    console.warn('[path] forgetObject 跳过(对象无持久数据)', err)
  }
  sheet.detachObject(entry.pathKey)
  const registry = getPathsRegistry(sheet)
  const list = readPathEntries(registry)
  const scrub = studio.scrub()
  scrub.capture(({set}) => {
    for (const {obj, freeze} of boundCameras) {
      if (freeze)
        set(obj.props.position, {x: freeze.x, y: freeze.y, z: freeze.z})
      set(obj.props.moveMode, 'manual')
      set(obj.props.pathKey, '')
    }
    set(
      registry.props.list,
      JSON.stringify(list.filter((e) => e.pathKey !== entry.pathKey)),
    )
  })
  scrub.commit()
}
