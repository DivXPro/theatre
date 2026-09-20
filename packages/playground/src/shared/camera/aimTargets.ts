// packages/playground/src/shared/camera/aimTargets.ts
/**
 * 瞄准/父级绑定的目标 id 方案与解析。
 * id 取值:''(无)| anchor:<key>(独立锚点)| bone:<placement>#<part>(骨骼锚点)
 *        | model:<placementKey>(整个放置模型)| camera:<cameraKey>(拍摄相机)。
 * 解析分两层:纯函数 resolveTargetObject(id, lookup) 供测试注入;
 * resolveAimTarget / resolveAnchorParent 读运行时登记表,供帧驱动调用。
 */
import type {Object3D} from 'three'
import {
  getBoneAnchorObjects,
  makeBoneAnchorId,
  parseBoneAnchorId,
} from './boneAnchors'
import type {BonePart} from './boneAnchors'
import {getPlacedInstances} from './PlacementManager'
import {getShotCameraObjects} from './cameraRegistry'

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

export function registerAnchorObject(key: string, obj: Object3D | null): void {
  if (obj) anchorObjects.set(key, obj)
  else anchorObjects.delete(key)
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
