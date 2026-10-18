/**
 * 统一对象删除(2026-10-19,Task 14):objects.delete 的领域层。
 * 带类型 ID 决定清理行为(spec 9.2),四类对象的删除处理器按
 * `{[K in SceneObjectKind]: DeleteHandler<K>}` 全量覆盖:
 *
 * - model:deletePlacement —— 清单行移除 + forgetObject 清持久数据
 *   (变换/姿势/动画覆盖与轨道),单个事务;
 * - camera:removeCamera —— forgetObject + 注册表移除合并为单个事务;
 * - anchor:removeAnchor —— 同事务折进子级锚点的 parent 解绑 + 世界定格
 *   (collectAnchorChildResets),避免子组件「父级消失看护」事后补一笔
 *   提交造成的撤销陷阱;
 * - path:deletePathDomain(Task 11)—— forgetObject + 注册表移除 +
 *   绑定相机 pathKey 重置与机位世界定格合并为单个事务,detachObject
 *   等非 historic 清理在事务后;最后一点删除复用同一 handler。
 *
 * 事务合并后,各注册表删除函数的 forgetObject 走内部 Studio 的
 * stateEditors(按地址清持久数据):注册表有条目但没有挂载 ref 的对象
 * 同样真删,不需要 SheetObject 句柄,也不创建新对象——查询/删除都
 * 不落实 SheetObject(resolver 的无副作用契约对删除同样成立)。
 *
 * 执行顺序:解析 ID(类型/存在性,只探测不创建)→ Studio 可用性 →
 * beforeWrite(命令层挂 expectedRevision 检查,先于任何副作用)→
 * 领域事务。任一校验失败抛出,不调用会话清理、不返回 deleted。
 */
import type {ISheet} from '@dreamerbird/core'
// 内部 Studio 通道(注册表删除函数实际使用的实例;与 keyframeTracks 同先例)
import getStudio from '@dreamerbird/studio/getStudio'
import {deletePlacement} from '../PlacementManager'
import {collectAnchorChildResets} from '../aimTargets'
import {removeAnchor} from '../anchorsRegistry'
import {removeCamera} from '../cameraRegistry'
import {deletePathDomain} from './pathCommands'
import {AgentApiError} from './errors'
import {formatSceneObjectId, parseSceneObjectId} from './objectIds'
import {listSceneObjectKeys} from './objectResolver'
import type {AgentRuntime} from './runtime'
import type {SceneObjectId, SceneObjectKind} from './types'

declare module './runtime' {
  interface AgentSceneRuntimeHandlers {
    /**
     * 对象删除后的会话清理(CameraScene 绑定,Task 15 接线;UI 删除
     * 流程共用同一实现):路径编辑态/控制点选择/大纲伪集合残留/右键
     * 菜单随被删对象清理;活动相机回退、镜头视角退出与导出中止由
     * CameraScene 的推导与看护 effect 自动完成。只在领域删除的项目
     * 事务成功提交后调用;未绑定时静默跳过(CameraScene 未挂载,
     * 会话态不存在)。
     */
    afterSceneObjectDeleted(args: {
      id: SceneObjectId
      kind: SceneObjectKind
      key: string
    }): void
  }
}

/** 按类型的领域删除处理器:同步完成项目事务,抛错即整体失败 */
export type DeleteHandler<K extends SceneObjectKind> = (
  sheet: ISheet,
  key: string,
) => void

export const deleteHandlers: {[K in SceneObjectKind]: DeleteHandler<K>} = {
  model: (sheet, key) => deletePlacement(sheet, key),
  camera: (sheet, key) => removeCamera(sheet, {cameraKey: key}),
  anchor: (sheet, key) =>
    removeAnchor(sheet, key, collectAnchorChildResets(sheet, key)),
  path: (sheet, key) => deletePathDomain(sheet, key),
}

/** Studio 不可用 = SCENE_UNAVAILABLE(spec 8.3:静默 return 不得翻译成成功) */
function requireStudio(): void {
  if (!getStudio()) {
    throw new AgentApiError('SCENE_UNAVAILABLE', 'Studio 不可用,无法删除对象')
  }
}

/**
 * 统一删除入口(objects.delete 的命令实现):解析带类型 ID → 注册表
 * 存在性校验(只探测不创建)→ Studio 可用性 → beforeWrite(乐观并发
 * 检查,先于任何副作用)→ 按类型执行完整删除的项目事务。
 * 返回解析后的 ID 信息,供命令层做会话清理与结果返回。
 */
export function deleteSceneObject(
  runtime: AgentRuntime,
  objectId: string,
  beforeWrite?: () => void,
): {id: SceneObjectId; kind: SceneObjectKind; key: string} {
  const {kind, key} = parseSceneObjectId(objectId)
  if (!listSceneObjectKeys(runtime.sheet, kind).includes(key)) {
    throw new AgentApiError('OBJECT_NOT_FOUND', `场景对象不存在: ${objectId}`, {
      details: {objectId, kind},
    })
  }
  requireStudio()
  // 全部校验完成;expectedRevision 等并发检查先于任何副作用
  beforeWrite?.()
  deleteHandlers[kind](runtime.sheet, key)
  return {id: formatSceneObjectId(kind, key), kind, key}
}
