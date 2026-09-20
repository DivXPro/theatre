// packages/playground/src/shared/camera/anchorsRegistry.ts(本任务最小桩,Task 5/6 充实)
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {types as t} from '@dreamerbird/core'

export const ANCHORS_REGISTRY_KEY = 'Anchors'

export function getAnchorsRegistry(sheet: ISheet): ISheetObject<any> {
  return sheet.object(
    ANCHORS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
}

export function readAnchorKeys(registry: ISheetObject<any>): string[] {
  try {
    const list = JSON.parse(
      registry ? (registry.props.list as unknown as string) : '[]',
    )
    return Array.isArray(list)
      ? list.filter((k) => typeof k === 'string' && k)
      : []
  } catch {
    return []
  }
}
