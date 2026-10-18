/**
 * 独立锚点注册表:场景里有几个空物体锚点 = 清单里有几行。
 * 模式照搬 cameraRegistry(隐藏注册表对象存 key 数组 JSON;
 * 增删都是可撤销事务;种子暂存-挂载消费)。锚点与相机平级独立,
 * 可被相机瞄准、可绑定父级。
 */
import {getStudioSync, types as t, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import type {ObjectAddressKey} from '@dreamerbird/core/types/public'
// 内部 Studio 通道:合并事务需要 stateEditors.forgetObject(按地址清持久
// 数据,不要求对象已挂载)——与 keyframeTracks/poseTrack 同先例
import getStudio from '@dreamerbird/studio/getStudio'
import {useEffect, useMemo, useState} from 'react'

export const ANCHORS_REGISTRY_KEY = 'Anchors'

export type AnchorSeed = {position: {x: number; y: number; z: number}}

export function getAnchorsRegistry(sheet: ISheet): ISheetObject<any> {
  return sheet.object(
    ANCHORS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
}

export function parseAnchorKeys(json: string): string[] {
  try {
    const list = JSON.parse(json)
    if (!Array.isArray(list)) return []
    return list.filter(
      (k): k is string => typeof k === 'string' && k.length > 0,
    )
  } catch {
    return []
  }
}

export function readAnchorKeys(registry: ISheetObject<any>): string[] {
  return parseAnchorKeys(val(registry.props.list) as string)
}

export function nextAnchorKey(existing: readonly string[]): string {
  const used = new Set(existing)
  for (let n = 1; ; n++) {
    const key = `Anchor ${n}`
    if (!used.has(key)) return key
  }
}

export function useAnchorsList(sheet: ISheet): string[] {
  const registry = useMemo(() => getAnchorsRegistry(sheet), [sheet])
  const [list, setList] = useState<string[]>(() => readAnchorKeys(registry))
  useEffect(() => {
    setList(readAnchorKeys(registry))
    return registry.onValuesChange(() => setList(readAnchorKeys(registry)))
  }, [registry])
  return list
}

const pendingSeeds = new Map<string, AnchorSeed>()

export function stashAnchorSeed(key: string, seed: AnchorSeed) {
  pendingSeeds.set(key, seed)
}

export function consumeAnchorSeed(key: string): AnchorSeed | undefined {
  const seed = pendingSeeds.get(key)
  pendingSeeds.delete(key)
  return seed
}

/** 添加锚点:注册表加一行(App 按清单渲染,组件挂载即创建对象) */
export function addAnchorToRegistry(
  sheet: ISheet,
  key: string,
  seed?: AnchorSeed,
): void {
  const studio = getStudioSync()
  if (!studio) return
  const registry = getAnchorsRegistry(sheet)
  const list = readAnchorKeys(registry)
  if (list.includes(key)) return
  const scrub = studio.scrub()
  scrub.capture(({set}) =>
    set(registry.props.list, JSON.stringify([...list, key])),
  )
  scrub.commit()
  if (seed) stashAnchorSeed(key, seed)
}

/**
 * 删除锚点时一并回退的子级锚点(parent 指向被删锚点);
 * 由调用方经 aimTargets.collectAnchorChildResets 收集
 * (同 removePathFromRegistry 的 boundCameras 模式:收集需要运行时
 * 登记表,本模块不反向依赖 aimTargets)。
 */
export type AnchorChildReset = {
  obj: ISheetObject<any>
  /** 子锚点的世界坐标定格(解绑后 position 语义回到世界坐标,画面不跳) */
  freeze: {x: number; y: number; z: number}
}

/**
 * 删除锚点:单个事务完成 forgetObject + 子级解绑/定格 + 注册表移除 =
 * 一步撤销(2026-10-19,Task 14 合并;原先两个事务两步撤销)。
 *
 * forgetObject 走 stateEditors 按地址清持久数据,不要求挂载中的对象
 * 句柄(schema 编辑器对无持久数据的对象先查后删,幂等不抛)。
 * children 必须折进同一事务:不折的话子组件的「父级消失看护」会在
 * 删除后补一笔提交,撤销删除时先看护提交把撤销游标顶掉
 * (同 removePathFromRegistry 注释的撤销陷阱)。
 */
export function removeAnchor(
  sheet: ISheet,
  key: string,
  children: AnchorChildReset[] = [],
): void {
  const studio = getStudio()
  if (!studio) return
  pendingSeeds.delete(key)
  const registry = getAnchorsRegistry(sheet)
  const list = readAnchorKeys(registry)
  studio.transaction(({set, stateEditors}) => {
    stateEditors.coreByProject.historic.sheetsById.forgetObject({
      projectId: sheet.address.projectId,
      sheetId: sheet.address.sheetId,
      // 业务 key 跨适配层按不透明字符串传递,此处回到 core 的名义类型
      objectKey: key as ObjectAddressKey,
    })
    for (const {obj, freeze} of children) {
      set(obj.props.parent, '')
      set(obj.props.position, {x: freeze.x, y: freeze.y, z: freeze.z})
    }
    set(registry.props.list, JSON.stringify(list.filter((k) => k !== key)))
  })
}
