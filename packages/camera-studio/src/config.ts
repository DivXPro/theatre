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
import type {CameraStudioApi} from './agent/api'

/**
 * Agent 桥接连接配置(spec §10.3/§10.4,Task 6)。
 * 浏览器默认不连接桥接:只有宿主显式配置本项才启动桥接客户端;
 * 配置变化按既有 boot 规则处理(重挂告警,换配置需整页刷新)。
 */
export type CameraStudioAgentBridgeConfig = {
  /** 桥接 WebSocket 地址,如 ws://127.0.0.1:43110 */
  url: string
  /**
   * Bearer 凭据:WebSocket subprotocol(token.<encoded>)与桥接 HTTP
   * 文件传输(Authorization)共用;绝不写入日志
   */
  token: string
  /** 桥接 HTTP 地址(二进制 File/Blob ↔ fileId 适配),如 http://127.0.0.1:43110 */
  httpUrl: string
}

/** Agent JS API 配置(spec §7;首 boot 锁定,重挂换配置不生效) */
export type CameraStudioAgentConfig = {
  /**
   * 场景 ready 后把 api 挂载为 window.__cameraStudioApi(浏览器默认不挂,
   * 不连接桥接);会话拆解时删除。缺省 false
   */
  exposeGlobal?: boolean
  /** 本机桥接连接;缺省不连接(浏览器默认不连桥接) */
  bridge?: CameraStudioAgentBridgeConfig
}

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
    /** 隐藏 studio 左上角带 logo 的整条 LeftStrip(应用 logo + 工作区按钮) */
    hideLeftStrip?: boolean
  }
  flows?: {onFlows?: (flows: CameraFlows) => void}
  /** Agent JS API 行为配置;缺省不挂 window 全局 */
  agent?: CameraStudioAgentConfig
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
  /**
   * Agent JS API 门面(spec §7):模块级单例,首帧即稳定(后续 render
   * 同一对象);`api.ready` 在 project+studio+Scene Runtime 就位后兑现
   */
  api: CameraStudioApi
}
