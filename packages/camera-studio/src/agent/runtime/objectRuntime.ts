/**
 * 场景 SheetObject 运行时登记(2026-10-17,Task 4):业务对象
 * (模型/相机/锚点/路径)的组件在 objRef 填充时登记、清空时按 id
 * 清理。Agent 查询/选择命令经此拿运行时 SheetObject —— 不绕运行时
 * 直接用 key 调 sheet.object 构造(那会顺手创建不存在的对象,
 * 查询的"无副作用"契约就破了)。
 *
 * 模块级表与 placementObjects/shotCameraObjects 同模式:单页单场景。
 */
import type {ISheetObject} from '@dreamerbird/core'
import type {SceneObjectId} from '../types'

const sceneSheetObjects = new Map<SceneObjectId, ISheetObject<any>>()

/** 登记某业务对象当前挂载的 SheetObject(objRef 填充时) */
export function registerSceneSheetObject(
  id: SceneObjectId,
  obj: ISheetObject<any>,
): void {
  sceneSheetObjects.set(id, obj)
}

/**
 * 按 id 清理登记(objRef 清空/组件卸载时)。传入 obj 时仅当登记的还是
 * 同一对象才删 —— 防过期组件的 cleanup 清掉新代次的登记。
 */
export function unregisterSceneSheetObject(
  id: SceneObjectId,
  obj?: ISheetObject<any>,
): void {
  if (obj && sceneSheetObjects.get(id) !== obj) return
  sceneSheetObjects.delete(id)
}

/** 当前挂载的 SheetObject;未挂载(注册表有条目但组件未起)为 undefined */
export function getSceneSheetObject(
  id: SceneObjectId,
): ISheetObject<any> | undefined {
  return sceneSheetObjects.get(id)
}

/**
 * 反查:selection.get 把 studio.selection 里的 SheetObject 映射回业务 ID;
 * 未登记的 theatre 对象(Thingy、演示对象等)返回 undefined,由调用方跳过
 */
export function resolveSceneObjectId(obj: unknown): SceneObjectId | undefined {
  for (const [id, registered] of sceneSheetObjects) {
    if (registered === obj) return id
  }
  return undefined
}
