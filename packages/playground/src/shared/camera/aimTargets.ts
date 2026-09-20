// packages/playground/src/shared/camera/aimTargets.ts
/**
 * 瞄准/父级绑定的目标 id 方案与解析。
 * id 取值:''(无)| anchor:<key>(独立锚点)| bone:<placement>#<part>(骨骼锚点)
 *        | model:<placementKey>(整个放置模型)| camera:<cameraKey>(拍摄相机)。
 * 解析分两层:纯函数 resolveTargetObject(id, lookup) 供测试注入;
 * resolveAimTarget / resolveAnchorParent 读运行时登记表,供帧驱动调用。
 */
import type {Object3D} from 'three'
import {translate} from '@dreamerbird/studio/i18n'
import {
  getBoneAnchorObjects,
  makeBoneAnchorId,
  parseBoneAnchorId,
} from './boneAnchors'
import type {BonePart} from './boneAnchors'
import {getPlacedInstances, readPlacementEntries} from './PlacementManager'
import {getShotCameraObjects} from './cameraRegistry'
import type {ISheet} from '@dreamerbird/core'
import {getAnchorsRegistry, readAnchorKeys} from './anchorsRegistry'

export type TargetKind = 'anchor' | 'bone' | 'model' | 'camera'

const KIND_PREFIXES: TargetKind[] = ['anchor', 'bone', 'model', 'camera']

export function parseTargetId(
  id: string,
):
  | {kind: 'anchor'; key: string}
  | {kind: 'bone'; placementKey: string; part: BonePart}
  | {kind: 'model'; key: string}
  | {kind: 'camera'; key: string}
  | null {
  if (id === '') return null
  const bone = parseBoneAnchorId(id)
  if (bone) return {kind: 'bone', ...bone}
  const colon = id.indexOf(':')
  if (colon <= 0) return null
  const kind = id.slice(0, colon) as TargetKind
  const key = id.slice(colon + 1)
  if (!KIND_PREFIXES.includes(kind) || !key) return null
  if (kind === 'bone') return null // 已被 parseBoneAnchorId 拦截,带 # 校验
  return {kind, key} as
    | {kind: 'anchor'; key: string}
    | {kind: 'model'; key: string}
    | {kind: 'camera'; key: string}
}

export function makeTargetId(
  kind: TargetKind,
  key: string,
  part?: BonePart,
): string {
  if (kind === 'bone') return makeBoneAnchorId(key, part!)
  return `${kind}:${key}`
}

export interface TargetLookup {
  anchors: ReadonlyMap<string, Object3D>
  bones: ReadonlyMap<string, Object3D>
  models: ReadonlyMap<string, Object3D>
  cameras: ReadonlyMap<string, Object3D>
}

export function resolveTargetObject(
  id: string,
  lookup: TargetLookup,
): Object3D | null {
  const parsed = parseTargetId(id)
  if (!parsed) return null
  switch (parsed.kind) {
    case 'anchor':
      return lookup.anchors.get(parsed.key) ?? null
    case 'bone':
      return (
        lookup.bones.get(makeBoneAnchorId(parsed.placementKey, parsed.part)) ??
        null
      )
    case 'model':
      return lookup.models.get(parsed.key) ?? null
    case 'camera':
      return lookup.cameras.get(parsed.key) ?? null
  }
}

/** 独立锚点的 theatreKey → 场景网格(Anchors 组件登记) */
const anchorObjects = new Map<string, Object3D>()

/**
 * 运行时目标登记表(锚点/相机,bones/placedInstances 在 Task 8 接线)
 * 的变更订阅:挂载登记/卸载注销时广播。ShotCamera 订阅后重渲染,
 * 持久态 aimTarget 指向的目标在目标挂载登记瞬间 tracking 立即翻正,
 * 不等到无关重渲染;目标被删同理即时回退自由朝向(规格§4)。
 */
const targetRegistryListeners = new Set<() => void>()

/** 订阅登记表变更,返回退订函数 */
export function subscribeTargetRegistry(fn: () => void): () => void {
  targetRegistryListeners.add(fn)
  return () => {
    targetRegistryListeners.delete(fn)
  }
}

/** 登记表变更广播;各 register/unregister 路径在写表后调用 */
export function notifyTargetRegistryChange(): void {
  for (const fn of targetRegistryListeners) fn()
}

export function registerAnchorObject(key: string, obj: Object3D | null): void {
  if (obj) anchorObjects.set(key, obj)
  else anchorObjects.delete(key)
  notifyTargetRegistryChange()
}

export function getAnchorObjects(): ReadonlyMap<string, Object3D> {
  return anchorObjects
}

export function defaultTargetLookup(): TargetLookup {
  return {
    anchors: anchorObjects,
    bones: getBoneAnchorObjects(),
    models: getPlacedInstances(),
    cameras: getShotCameraObjects(),
  }
}

export function resolveAimTarget(id: string): Object3D | null {
  return resolveTargetObject(id, defaultTargetLookup())
}

export function resolveAnchorParent(id: string): Object3D | null {
  return resolveTargetObject(id, defaultTargetLookup())
}

/**
 * 「瞄准目标」下拉选项(模块级,studio 面板渲染时调用)。
 * 「无」+ 独立锚点(经 optionsSheet 读 Anchors 注册表,Task 6 落地,
 * 未落地前退化为空)+ 骨骼锚点(遍历运行时表,Task 8 接入数据)。
 */
let optionsSheet: ISheet | null = null
export function setAimOptionsSheet(sheet: ISheet | null): void {
  optionsSheet = sheet
}

export function aimTargetOptions(): {[key: string]: string} {
  const options: {[key: string]: string} = {'': translate('pg.props.aimNone')}
  if (!optionsSheet) return options
  try {
    for (const key of readAnchorKeys(getAnchorsRegistry(optionsSheet))) {
      options[makeTargetId('anchor', key)] = key
    }
  } catch {
    // Anchors 注册表尚未创建:跳过
  }
  // 骨骼锚点按模型分组:bone:<placement>#part → "<模型显示名> · <部位名>"
  const byPlacement = new Map<string, BonePart[]>()
  for (const id of getBoneAnchorObjects().keys()) {
    const parsed = parseBoneAnchorId(id)
    if (!parsed) continue
    const list = byPlacement.get(parsed.placementKey) ?? []
    list.push(parsed.part)
    byPlacement.set(parsed.placementKey, list)
  }
  for (const [placementKey, parts] of byPlacement) {
    const modelName = placementDisplayName(optionsSheet, placementKey)
    for (const part of parts) {
      options[makeTargetId('bone', placementKey, part)] =
        `${modelName} · ${translate(`pg.parts.${part}`)}`
    }
  }
  return options
}

/** 从放置注册表反查模型显示名;放置注册表未建好时回退原 key */
function placementDisplayName(sheet: ISheet, placementKey: string): string {
  try {
    const entry = readPlacementEntries(sheet).find(
      (e) => e.key === placementKey,
    )
    if (entry) return entry.key.replace(/^Models \/ /, '')
  } catch {
    // 放置注册表尚未创建
  }
  return placementKey
}
