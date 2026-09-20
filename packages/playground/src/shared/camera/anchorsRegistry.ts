/**
 * 独立锚点注册表:场景里有几个空物体锚点 = 清单里有几行。
 * 模式照搬 cameraRegistry(隐藏注册表对象存 key 数组 JSON;
 * 增删都是可撤销事务;种子暂存-挂载消费)。锚点与相机平级独立,
 * 可被相机瞄准、可绑定父级。
 */
import {getStudioSync, types as t, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
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

/** 删除锚点:真删(forgetObject 清持久数据 + 注册表移除),两步事务 */
export function removeAnchor(
  sheet: ISheet,
  key: string,
  object?: ISheetObject<any>,
): void {
  const studio = getStudioSync()
  if (!studio) return
  pendingSeeds.delete(key)
  if (object) {
    try {
      studio.transaction(({forgetObject}) => forgetObject(object as any))
    } catch (err) {
      console.warn('[anchors] forgetObject 跳过(对象无持久数据)', err)
    }
  }
  const registry = getAnchorsRegistry(sheet)
  const list = readAnchorKeys(registry)
  const scrub = studio.scrub()
  scrub.capture(({set}) =>
    set(registry.props.list, JSON.stringify(list.filter((k) => k !== key))),
  )
  scrub.commit()
}
