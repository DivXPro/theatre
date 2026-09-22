/**
 * 宿主能力句柄的基础设施(规格 §1–§3)。
 * 句柄注册表:onFlows 一次性交付,宿主自存;模块级单例,场景卸载清空。
 * placing store:useSyncExternalStore 的外部 store,宿主组件(含 portal
 * 到 body 的 shadcn Dialog)用 usePlacing() 读放置状态,不依赖 context。
 * dropPointFromClient 与 createHostFlows 在同文件后续任务补齐。
 */
import {useSyncExternalStore} from 'react'
import type {PlacingState} from './PlacementManager'
import type {ModelEntry} from './assetLibrary/types'
import type {PathPreset} from './pathPresets'

export type Vec3 = {x: number; y: number; z: number}

export type CameraFlows = {
  /** 点选放置:宿主选中模型后调用,进入画布放置模式 */
  startPlacingModel(entry: ModelEntry): Promise<void>
  /** 拖拽放置:在指定三维落点直接放置,无幽灵阶段 */
  placeModelAt(entry: ModelEntry, point: Vec3): void
  /** 路径预设生成路径;不传 at = 场景中心(现状语义) */
  addPresetPath(preset: PathPreset, at?: Vec3): void
  addCamera(): void
  addAnchor(): void
  cancelPlacing(): void
  /** 宿主外部模型入库(走既有导入管线),返回正式库条目 */
  importModel(file: File): Promise<ModelEntry>
  /** 指针客户端坐标 → 场景三维落点;场景未就绪返回 null */
  dropPointFromClient(clientX: number, clientY: number): Vec3 | null
}

// ── 句柄注册表 ──────────────────────────────────────────────
let currentHandle: CameraFlows | null = null
export function setHostFlowsHandle(f: CameraFlows | null): void {
  currentHandle = f
}
export function getHostFlowsHandle(): CameraFlows | null {
  return currentHandle
}

// ── placing 外部 store ──────────────────────────────────────
let placingSnapshot: PlacingState | null = null
const placingListeners = new Set<() => void>()
export function setPlacingSnapshot(p: PlacingState | null): void {
  if (p === placingSnapshot) return
  placingSnapshot = p
  placingListeners.forEach((l) => l())
}
export function getPlacingSnapshot(): PlacingState | null {
  return placingSnapshot
}
export function subscribePlacing(l: () => void): () => void {
  placingListeners.add(l)
  return () => {
    placingListeners.delete(l)
  }
}
export function usePlacing(): PlacingState | null {
  return useSyncExternalStore(subscribePlacing, getPlacingSnapshot)
}

// ── 落点换算 ────────────────────────────────────────────────
// 场景内(HostFlowsDropPointCapture,App 的 Canvas 子树)把 gl/camera
// 捕获进来;宿主 dragover/drop 事件里的 clientX/clientY 直接喂给
// dropPointFromClient,规则与放置幽灵一致(表面优先、地面兜底)。
import {Raycaster} from 'three'
import type {Camera} from 'three'
import {computeDropPoint} from './dropPoint'
import {getPlacementSurfaces} from './PlacementManager'

export type DropPointContext = {
  gl: {domElement: HTMLElement}
  camera: Camera
}
let dropCtx: DropPointContext | null = null
export function setDropPointContext(ctx: DropPointContext | null): void {
  dropCtx = ctx
}
export function dropPointFromClient(
  clientX: number,
  clientY: number,
): Vec3 | null {
  if (!dropCtx) return null
  const {gl, camera} = dropCtx
  const rect = gl.domElement.getBoundingClientRect()
  const p = computeDropPoint(
    new Raycaster(),
    camera,
    getPlacementSurfaces(),
    rect,
    clientX,
    clientY,
  )
  return {x: p.x, y: p.y, z: p.z}
}
