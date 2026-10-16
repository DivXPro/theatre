/**
 * 宿主可见的配置与句柄类型(spec §3 逐字为宿主所见形态)。
 *
 * CameraFlows 类型取自 ./hostFlows(定义所在);简报草样写 './App',
 * 但 App.tsx 只默认导出组件、不转出口该类型,从定义处引入才编译得过。
 */
import type {IProject} from '@dreamerbird/core'
import type {WritableLibrarySource} from './assetLibrary/source'
import type {CameraStudioErrorHandler} from './errors'
import type {CameraFlows} from './hostFlows'

export interface CameraStudioConfig {
  /** id 字符串(getProject)或 IProject 实例;缺省 'Space' */
  project?: string | IProject
  /** 场景状态宿主接管;传了即关 theatre 本地持久化 */
  state?: {
    initialState?: unknown
    onStateChange?: (content: unknown) => void
    /** onStateChange 节流,缺省 1000ms(尾部触发,卸载时 flush) */
    throttleMs?: number
  }
  /** 宿主错误提示入口:库存储/启动清理/视频导出错误统一上告;不传保持内置提示行为 */
  onError?: CameraStudioErrorHandler
  /** 可写源实例 | 「namespace」内置 IDB 简写(库名 toybox-asset-library[-namespace],
      不带 namespace 与现状一字不差) | false 纯查看器(仅内置目录);缺省 = 现状 */
  storage?: WritableLibrarySource | {namespace?: string} | false
  /** 内置目录文件根;缺省包内 assets */
  assets?: {baseUrl?: string}
  /** 协作端点;缺省 false(关) */
  sync?: {serverUrl?: string} | false
  ui?: {
    portalContainer?: HTMLElement
    zIndexBase?: number
    locale?: string
  }
  flows?: {onFlows?: (flows: CameraFlows) => void}
}

/** CameraScene 的 props 形态(T9 落地组件);对宿主不透明,不解构 */
export type CameraSceneProps = {
  project: IProject
  onFlows?: (flows: CameraFlows) => void
  onError?: CameraStudioErrorHandler
}

export interface CameraStudioHandle {
  ready: boolean
  error: Error | undefined
  sceneProps: CameraSceneProps
}
