/**
 * camera 场景的大纲右键菜单扩展:相机/锚点/放置模型/路径四类注册表
 * 对象接管 studio 内置删除(role: 'delete'),走与画布右键同一套真删
 * 流程(注册表移除 + forgetObject 清持久数据);删除后顺手把对象从
 * 大纲伪集合名单里清掉。
 *
 * 纯函数 cameraOutlineMenuItems 注入 ctx,测试注入固定语言的 t;
 * cameraOutlineObjectMenu 是注册给 studio extend() 的入口,读模块级
 * ctx(App 每渲染刷新,菜单点开时拿到的是最新清单与处理器)。
 */
import {translate, type InterpolationVars} from '@dreamerbird/studio/i18n'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import type {
  OutlineObjectMenuContribution,
  OutlineMenuItem,
} from '@dreamerbird/core/types/public'
import type {CameraEntry} from './cameraRegistry'
import type {PathEntry} from './pathRegistry'
import type {PlacementEntry} from './PlacementManager'

export const cameraOutlineMenuExtensionId = '@dreamerbird/camera-outline-menu'

export type CameraOutlineMenuHandlers = {
  removeCamera(entry: CameraEntry): void
  removeAnchor(key: string, object?: ISheetObject<any>): void
  removePlacement(key: string): void
  removePath(pathKey: string): void
}

export type CameraOutlineMenuCtx = {
  sheet: ISheet
  cameras: CameraEntry[]
  anchors: string[]
  placements: PlacementEntry[]
  paths: PathEntry[]
  handlers: CameraOutlineMenuHandlers
}

/**
 * 模块级 ctx:App 每渲染刷新(见 App.tsx),菜单点开时读到的就是最新清单
 * 与处理器。纯函数 cameraOutlineMenuItems 注入 ctx,测试对齐
 * menuModel.test.ts 的模式。
 */
let ctx: CameraOutlineMenuCtx | undefined

export function setCameraOutlineMenuCtx(
  next: CameraOutlineMenuCtx | undefined,
): void {
  ctx = next
}

export function cameraOutlineObjectMenu(
  object: ISheetObject<any>,
): OutlineObjectMenuContribution | undefined {
  if (!ctx) return undefined
  return cameraOutlineMenuItems(object, ctx)
}

/**
 * 用四个注册表反查对象归属;命中 → 返回接管删除的菜单项
 * (role:'delete',studio 不再显示默认删除);未命中 → undefined,
 * 走 studio 内置菜单(Thingy / Key Light / 导演相机组等)。
 * 删除处理器与画布右键共用同一套函数,两个入口行为一致。
 */
export function cameraOutlineMenuItems(
  object: ISheetObject<any>,
  ctx: CameraOutlineMenuCtx,
  t: (key: string, vars?: InterpolationVars) => string = translate,
): OutlineObjectMenuContribution | undefined {
  const key = object.address.objectKey
  let onDelete: (() => void) | undefined

  const camera = ctx.cameras.find((e) => e.cameraKey === key)
  if (camera) {
    onDelete = () => ctx.handlers.removeCamera(camera)
  } else if (ctx.anchors.includes(key)) {
    onDelete = () => ctx.handlers.removeAnchor(key, object)
  } else if (ctx.placements.some((e) => e.key === key)) {
    onDelete = () => ctx.handlers.removePlacement(key)
  } else if (ctx.paths.some((e) => e.pathKey === key)) {
    onDelete = () => ctx.handlers.removePath(key)
  }

  if (!onDelete) return undefined

  const item: OutlineMenuItem = {
    type: 'normal',
    label: t('pg.menu.delete'),
    onSelect: onDelete,
    role: 'delete',
  }
  return {items: [item]}
}
