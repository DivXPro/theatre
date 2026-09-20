// packages/playground/src/shared/camera/cameraRegistry.ts
/**
 * 相机注册表:场景里有几台相机 = 注册表清单里有几行,每台相机是一对
 * theatre 对象(相机 + 瞄准点 Target)。照搬放置模型(Placements)的
 * 注册表模式,结构天然支持多相机;P1 在工具条上限一台。
 *
 * 生命周期:添加 = 注册表加一行(App 按清单渲染 ShotCamera,组件挂载
 * 即创建对象、大纲行出现);删除 = forgetObject 清持久数据 + 注册表
 * 移除(组件卸载 → detachObject → 大纲行消失)。
 */
import {getStudioSync, types as t, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {useEffect, useMemo, useState} from 'react'
import type {Object3D} from 'three'

/** 注册表对象的 theatre key(大纲顶层 "Cameras" 行,和 Placements 同款) */
export const CAMERAS_REGISTRY_KEY = 'Cameras'

/** 一台相机 = 一对 theatre 对象;清单里只存 key */
export type CameraEntry = {cameraKey: string; targetKey: string}

/** 新相机的初始取景(添加时从导演视角捕获,组件挂载后消费) */
export type CameraSeed = {
  position: {x: number; y: number; z: number}
  rotation: {x: number; y: number; z: number}
  targetPosition: {x: number; y: number; z: number}
}

/** 第一台的 key:相机对收在一个文件夹里,与导演相机的 "Camera" 组区分 */
const FIRST_CAMERA: CameraEntry = {
  cameraKey: 'Shot Camera / Camera',
  targetKey: 'Shot Camera / Target',
}

export function getCamerasRegistry(sheet: ISheet) {
  // 注册表只是存数据的对象,不出现在大纲树
  return sheet.object(
    CAMERAS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
}

/** 解析清单 JSON;坏数据一律回退空(注册表是底账,勿手改) */
export function parseCameraEntries(json: string): CameraEntry[] {
  try {
    const list = JSON.parse(json)
    if (!Array.isArray(list)) return []
    return list.filter(
      (item): item is CameraEntry =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.cameraKey === 'string' &&
        item.cameraKey.length > 0 &&
        typeof item.targetKey === 'string' &&
        item.targetKey.length > 0,
    )
  } catch {
    return []
  }
}

export function readCameraEntries(registry: ISheetObject<any>): CameraEntry[] {
  return parseCameraEntries(val(registry.props.list) as string)
}

/** 多相机(P2)的命名:第一台 Shot Camera,之后 Shot Camera 2 / 3… */
export function nextCameraEntry(existing: readonly CameraEntry[]): CameraEntry {
  if (existing.length === 0) return FIRST_CAMERA
  const used = new Set(existing.map((e) => e.cameraKey))
  for (let n = 2; ; n++) {
    const cameraKey = `Shot Camera ${n} / Camera`
    if (!used.has(cameraKey)) {
      return {cameraKey, targetKey: `Shot Camera ${n} / Target`}
    }
  }
}

/** 界面显示名:cameraKey 去掉 " / Camera" 后缀("Shot Camera 1 / Camera" → "Shot Camera 1") */
export function cameraDisplayName(cameraKey: string): string {
  return cameraKey.replace(/ \/ Camera$/, '')
}

/** 响应式读相机清单:scrub 提交/撤销/同步都会触发 onValuesChange */
export function useCamerasList(sheet: ISheet): CameraEntry[] {
  const registry = useMemo(() => getCamerasRegistry(sheet), [sheet])
  const [list, setList] = useState<CameraEntry[]>(() =>
    readCameraEntries(registry),
  )
  useEffect(() => {
    setList(readCameraEntries(registry))
    return registry.onValuesChange(() => setList(readCameraEntries(registry)))
  }, [registry])
  return list
}

/**
 * 新相机的取景种子:组件挂载前对象还不存在,没法直接写属性——
 * 添加时先把种子存这里,ShotCamera 挂载后消费一次。
 */
const pendingSeeds = new Map<string, CameraSeed>()

export function stashCameraSeed(cameraKey: string, seed: CameraSeed) {
  pendingSeeds.set(cameraKey, seed)
}

export function consumeCameraSeed(cameraKey: string): CameraSeed | undefined {
  const seed = pendingSeeds.get(cameraKey)
  pendingSeeds.delete(cameraKey)
  return seed
}

/** 添加相机:注册表加一行(App 按清单渲染,组件挂载即创建对象) */
export function addCameraToRegistry(
  sheet: ISheet,
  entry: CameraEntry,
  seed?: CameraSeed,
) {
  const studio = getStudioSync()
  if (!studio) return
  const registry = getCamerasRegistry(sheet)
  const list = readCameraEntries(registry)
  // 连击/重入防护:同一 cameraKey 已存在就不重复提交
  if (list.some((e) => e.cameraKey === entry.cameraKey)) return
  const scrub = studio.scrub()
  scrub.capture(({set}) =>
    set(registry.props.list, JSON.stringify([...list, entry])),
  )
  scrub.commit()
  if (seed) stashCameraSeed(entry.cameraKey, seed)
}

/**
 * 删除相机:先清持久数据(forgetObject:静态覆盖 + 时间轴轨道,
 * 同步到所有客户端),再从注册表移除(组件卸载 → detachObject →
 * 大纲行消失)。两个事务,撤销也是两步,都能完整回滚。
 */
export function removeCamera(
  sheet: ISheet,
  entry: CameraEntry,
  objects: {camera?: ISheetObject<any>; target?: ISheetObject<any>},
) {
  const studio = getStudioSync()
  if (!studio) return
  // 没来得及挂载消费掉的取景种子一并清掉,不留残留
  pendingSeeds.delete(entry.cameraKey)
  for (const obj of [objects.camera, objects.target]) {
    if (!obj) continue
    try {
      studio.transaction(({forgetObject}) => forgetObject(obj as any))
    } catch (err) {
      // forgetObject 对"没写过任何覆盖/轨道"的对象会触发 saaz draft 的
      // 老坑(TypeError);这类对象本来就没在持久态留痕,刷新即没,跳过
      console.warn('[camera] forgetObject 跳过(对象无持久数据)', err)
    }
  }
  const registry = getCamerasRegistry(sheet)
  const list = readCameraEntries(registry)
  const scrub = studio.scrub()
  scrub.capture(({set}) =>
    set(
      registry.props.list,
      JSON.stringify(list.filter((e) => e.cameraKey !== entry.cameraKey)),
    ),
  )
  scrub.commit()
}

/** 拍摄相机的 cameraKey → three 相机对象(锚点父级绑定的 camera: 解析用) */
const shotCameraObjects = new Map<string, Object3D>()

export function registerShotCameraObject(
  cameraKey: string,
  obj: Object3D | null,
): void {
  if (obj) shotCameraObjects.set(cameraKey, obj)
  else shotCameraObjects.delete(cameraKey)
}

export function getShotCameraObjects(): ReadonlyMap<string, Object3D> {
  return shotCameraObjects
}
