/**
 * 自定义属性编辑器注册表(prop config `editor` 选项的 studio 侧,2026-10-01)。
 *
 * 宿主(如 camera playground)在这里按 key 注册属性值编辑器组件;属性配置
 * 声明 `editor: '<key>'` 后,详情面板的属性行用它渲染值区域,替代该类型
 * 的内置编辑器。属性行外壳(打帧钮/帧导航/右键菜单)仍由面板提供——
 * 可排序属性的轨道行为与内置属性一致。
 *
 * 数据注入:面板在 studio 自己的 React 树(shadow DOM)里渲染,与宿主
 * 应用不是同一棵树,React context 过不去。宿主每次渲染用最新闭包重新
 * 注册同 key 的组件(Map 覆盖语义),编辑器被面板渲染时即读到最新数据。
 */
import type React from 'react'
import type {PropTypeConfig_AllSimples} from '@dreamerbird/core/types/public'
import type {ISimplePropEditorReactProps} from './simpleEditors/ISimplePropEditorReactProps'

export type CustomPropEditorComponent = React.FC<
  ISimplePropEditorReactProps<PropTypeConfig_AllSimples>
>

const registry = new Map<string, CustomPropEditorComponent>()

/** 注册/覆盖 key 对应的编辑器组件 */
export function registerCustomPropEditor(
  key: string,
  component: CustomPropEditorComponent,
): void {
  registry.set(key, component)
}

/** 查 key 对应的编辑器;未注册或 key 为空返回 undefined(回落内置编辑器) */
export function getCustomPropEditor(
  key: string | undefined,
): CustomPropEditorComponent | undefined {
  return key === undefined ? undefined : registry.get(key)
}

/** 注销(宿主卸载/热更新时回落内置编辑器) */
export function unregisterCustomPropEditor(key: string): void {
  registry.delete(key)
}
