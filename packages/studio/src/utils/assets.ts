import type {Asset} from '@dreamerbird/core/types/public'
import type Project from '@dreamerbird/core/projects/Project'
import {val} from '@dreamerbird/dataverse'
import type {$IntentionalAny} from '@dreamerbird/core/types/public'
import {__private} from '@dreamerbird/core'
const {forEachPropDeep} = __private.propTypeUtils
const {keyframeUtils} = __private

/** 递归收集值里所有 {type: string, id: string} 形状的对象(资产引用) */
function collectAssetShapedDeep(value: unknown, out: Array<unknown>): void {
  if (!value || typeof value !== 'object') return
  const maybeAsset = value as {type?: unknown; id?: unknown}
  if (
    typeof maybeAsset.type === 'string' &&
    typeof maybeAsset.id === 'string'
  ) {
    out.push(value)
    return
  }
  for (const child of Object.values(value)) {
    collectAssetShapedDeep(child, out)
  }
}

export function getAllPossibleAssetIDs(project: Project, type?: string) {
  const sheets = Object.values(val(project.pointers.historic.sheetsById) ?? {})
  const staticValues = sheets
    .flatMap((sheet) => Object.values(sheet?.staticOverrides.byObject ?? {}))
    .flatMap((overrides) => Object.values(overrides ?? {}))

  const keyframeValues = sheets
    .flatMap((sheet) => Object.values(sheet?.sequence?.tracksByObject ?? {}))
    .flatMap((tracks) => Object.values(tracks?.trackData ?? {}))
    .flatMap((track) =>
      keyframeUtils.getSortedKeyframesCached(
        track?.keyframes ?? {byId: {}, allIds: {}},
      ),
    )
    .map((keyframe) => keyframe?.value)

  const allValues = [...keyframeValues]
  staticValues.forEach((value) => {
    // forEachPropDeep 只对原始值回调,{type, id} 形状的资产引用对象本身
    // 永远进不了 allValues——只被静态覆盖引用的资产会在启动清理时被误删。
    // 这里把各层资产形状的对象补充收集进来(去重/类型过滤沿用下面的 filter)。
    collectAssetShapedDeep(value, allValues)
    forEachPropDeep(
      value,
      (v) => {
        allValues.push(v as $IntentionalAny)
      },
      [],
    )
  })

  const allAssets = allValues
    // value is Asset of the type provided
    .filter((value) => {
      return (
        (value as Asset | undefined)?.type &&
        (type
          ? (value as Asset | undefined)?.type == type
          : typeof (value as Asset | undefined)?.type === 'string')
      )
    })
    // map assets to their ids
    .map((value) => (value as Asset).id)
    // ensure ids are unique and not null and not empty
    .filter(
      (id, index, self) =>
        id !== null && id !== '' && self.indexOf(id) === index,
    ) as string[]

  return allAssets
}
