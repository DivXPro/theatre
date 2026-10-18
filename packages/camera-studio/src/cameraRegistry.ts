// packages/camera-studio/src/cameraRegistry.ts
/**
 * 相机注册表:场景里有几台相机 = 注册表清单里有几行,每台相机是一个
 * theatre 对象。照搬放置模型(Placements)的注册表模式,结构天然支持
 * 多相机;P1 在工具条上限一台。
 *
 * 生命周期:添加 = 注册表加一行(App 按清单渲染 ShotCamera,组件挂载
 * 即创建对象、大纲行出现);删除 = forgetObject 清持久数据 + 注册表
 * 移除(组件卸载 → detachObject → 大纲行消失)。
 */
import {getStudioSync, types as t, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import type {ObjectAddressKey} from '@dreamerbird/core/types/public'
// 内部 Studio 通道:合并事务需要 stateEditors.forgetObject(按地址清持久
// 数据,不要求对象已挂载)——与 keyframeTracks/poseTrack 同先例
import getStudio from '@dreamerbird/studio/getStudio'
import {useEffect, useMemo, useState} from 'react'
import type {Object3D} from 'three'
import {notifyTargetRegistryChange, sheetObjectExists} from './aimTargets'

/** 注册表对象的 theatre key(大纲顶层 "Cameras" 行,和 Placements 同款) */
export const CAMERAS_REGISTRY_KEY = 'Cameras'

/**
 * 一台相机 = 一个 theatre 对象;旧清单里的 targetKey 解析时忽略
 * (不做迁移,老相机自由朝向)
 */
export type CameraEntry = {cameraKey: string}

/** 新相机的初始取景(添加时从导演视角捕获,组件挂载后消费) */
export type CameraSeed = {
  position: {x: number; y: number; z: number}
  rotation: {x: number; y: number; z: number}
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
    return list
      .filter(
        (item): item is {cameraKey: string} =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.cameraKey === 'string' &&
          item.cameraKey.length > 0,
      )
      .map((item) => ({cameraKey: item.cameraKey}))
  } catch {
    return []
  }
}

export function readCameraEntries(registry: ISheetObject<any>): CameraEntry[] {
  return parseCameraEntries(val(registry.props.list) as string)
}

/**
 * 多相机(P2)的命名:第一台 Shot Camera,之后 Shot Camera 2 / 3…。
 * 顶层扁平后无前缀隔离,编号要同时避开注册表已用 key 和全场景已占用
 * 路径(放置模型可能叫 "Shot Camera 2.fbx" 这种,探测只查不建)
 */
export function nextCameraEntry(
  sheet: ISheet,
  existing: readonly CameraEntry[],
): CameraEntry {
  const used = new Set(existing.map((e) => e.cameraKey))
  for (let n = 1; ; n++) {
    const cameraKey = n === 1 ? 'Shot Camera' : `Shot Camera ${n}`
    if (!used.has(cameraKey) && !sheetObjectExists(sheet, cameraKey)) {
      return {cameraKey}
    }
  }
}

/** 界面显示名:旧状态(套文件夹时期)的 key 去掉 " / Camera" 后缀;
 *  扁平化后的新 key 无后缀,原样即显示名 */
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
 * 删除相机:单个事务完成 forgetObject + 注册表移除 = 一步撤销
 * (2026-10-19,Task 14 合并;原先两个事务两步撤销)。
 *
 * forgetObject 走 stateEditors 按地址清持久数据(静态覆盖 + 时间轴
 * 轨道,同步到所有客户端):不再要求挂载中的对象句柄——注册表有条目
 * 但组件未挂载(或已脱离对象表)的相机同样真删,不静默跳过
 * (schema 编辑器对无持久数据的对象先查后删,幂等不抛)。
 * 注册表行移除 → 组件卸载 → detachObject → 大纲行消失。
 */
export function removeCamera(sheet: ISheet, entry: CameraEntry) {
  const studio = getStudio()
  if (!studio) return
  // 没来得及挂载消费掉的取景种子一并清掉,不留残留
  pendingSeeds.delete(entry.cameraKey)
  const registry = getCamerasRegistry(sheet)
  const list = readCameraEntries(registry)
  studio.transaction(({set, stateEditors}) => {
    stateEditors.coreByProject.historic.sheetsById.forgetObject({
      projectId: sheet.address.projectId,
      sheetId: sheet.address.sheetId,
      // 业务 key 跨适配层边界按不透明字符串传递,此处回到 core 的名义类型
      // (同 keyframeTracks 的 trackId as SequenceTrackId)
      objectKey: entry.cameraKey as ObjectAddressKey,
    })
    set(
      registry.props.list,
      JSON.stringify(list.filter((e) => e.cameraKey !== entry.cameraKey)),
    )
  })
}

/**
 * 活动相机推导(2026-10-19,Task 14 抽成纯函数):activeCameraKey 失效
 * (被删/对端同步)时顺位清单第一台,空清单为 null。CameraScene 的
 * 活动相机、objects.delete 的「删除活动相机按现有规则回退」共用。
 */
export function resolveActiveCamera(
  cameras: readonly CameraEntry[],
  activeCameraKey: string | null,
): CameraEntry | null {
  return (
    cameras.find((e) => e.cameraKey === activeCameraKey) ?? cameras[0] ?? null
  )
}

/** 拍摄相机的 cameraKey → three 相机对象(锚点父级绑定的 camera: 解析用) */
const shotCameraObjects = new Map<string, Object3D>()

export function registerShotCameraObject(
  cameraKey: string,
  obj: Object3D | null,
): void {
  if (obj) shotCameraObjects.set(cameraKey, obj)
  else shotCameraObjects.delete(cameraKey)
  // 与 registerAnchorObject 同机制:登记表变更广播,ShotCamera 等的
  // 瞄准/父级解析随挂载/注销即时翻正(循环 import 仅运行时调用,安全)
  notifyTargetRegistryChange()
}

export function getShotCameraObjects(): ReadonlyMap<string, Object3D> {
  return shotCameraObjects
}
