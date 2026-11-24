/**
 * 宿主可见的配置与句柄类型(spec §3 逐字为宿主所见形态)。
 *
 * CameraFlows 类型取自 ./hostFlows(定义所在);简报草样写 './App',
 * 但 App.tsx 只默认导出组件、不转出口该类型,从定义处引入才编译得过。
 */
import type {CameraStudioTheme} from './styles/theme'
import type {
  IProject,
  IProjectConfig,
  StudioPanelVisibility,
} from '@dreamerbird/core'
import type {ReactNode} from 'react'
import type {WritableLibrarySource} from './assetLibrary/source'
import type {CameraStudioErrorHandler} from './errors'
import type {CameraFlows} from './hostFlows'
import type {CameraStudioApi} from './agent/api'
import type {MangaViewportOptions, ViewportRenderMode} from './mangaViewport'
import type {
  StillExportResult,
  VideoExportResult,
} from './videoExport/previsTypes'

/** 成品的二进制数据、文件名、实际 MIME 类型与渲染信息。 */
export type CameraStudioExport =
  | ({kind: 'image'} & StillExportResult)
  | ({kind: 'video'} & VideoExportResult)

export type CameraStudioSaveExport = (
  output: CameraStudioExport,
) => void | Promise<void>

export type ViewportRenderingConfig = MangaViewportOptions & {
  initialMode?: ViewportRenderMode
}

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
  /** 场景状态由宿主管理。挂载前载入 initialState，提交后调用 onStateChange。 */
  state?: {
    initialState?: unknown
    onStateChange?: (content: unknown) => void | Promise<void>
    /** 保存节流，缺省 1000ms。设为 0 可在提交后立即排队保存。 */
    throttleMs?: number
  }
  /** 宿主错误提示入口:库存储/启动清理/视频导出错误统一上告;不传保持内置提示行为 */
  onError?: CameraStudioErrorHandler
  /** 启用退出按钮。场景保存、卸载和清理完成后通知宿主。 */
  onSceneClosed?: (event: {projectId: string}) => void | Promise<void>
  /** 接管工具栏的图片和视频保存。回调失败经 onError 通知宿主。 */
  onSaveExport?: CameraStudioSaveExport
  /** 可写资产库。接管场景状态时默认只读内置目录，可显式配置数据源。 */
  storage?: WritableLibrarySource | {namespace?: string} | false
  assets?: {
    /** 内置目录文件根，缺省为包内 assets。 */
    baseUrl?: string
    /** 场景文件的 URL 和上传接口。传入 IProject 时由创建方配置。 */
    projectStorage?: NonNullable<IProjectConfig['assets']>['storage']
  }
  /** 协作端点;缺省 false(关) */
  sync?: {serverUrl?: string} | false
  scene?: {
    /** 是否渲染内置 Thingy 演示模型;缺省 true */
    includeDemoModel?: boolean
    viewportRendering?: ViewportRenderingConfig
  }
  ui?: {
    portalContainer?: HTMLElement
    zIndexBase?: number
    locale?: string
    /** Optional UI token overrides. Applied when Camera Studio initializes. */
    theme?: CameraStudioTheme
    /** 隐藏 studio 左上角带 logo 的整条 LeftStrip(应用 logo + 工作区按钮) */
    hideLeftStrip?: boolean
    panels?: StudioPanelVisibility
    /** Scene Tree 顶部项目节点的显示名;不改变持久化 projectId */
    projectName?: string
  }
  flows?: {onFlows?: (flows: CameraFlows) => void}
  /** Agent JS API 行为配置;缺省不挂 window 全局 */
  agent?: CameraStudioAgentConfig
}

/** Props for the viewport and its workspace header. */
export type CameraSceneProps = {
  project: IProject
  onFlows?: (flows: CameraFlows) => void
  onError?: CameraStudioErrorHandler
  includeDemoModel?: boolean
  viewportRendering?: ViewportRenderingConfig
  onSaveExport?: CameraStudioSaveExport
  onCloseScene?: () => void
  /** Optional host actions alongside the viewport output controls. */
  headerActions?: ReactNode
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
  /** 保存并关闭已就绪的场景。宿主应仅在 ready 时渲染 CameraScene。 */
  closeScene(): Promise<void>
  flushState(): Promise<void>
  /**
   * 当前是否有尚未 commit/discard 的临时编辑（例如拖拽中的预览）。
   * 这些改动尚未进入状态保存通道，宿主在替换场景前应据此避免覆盖。
   */
  hasTemporaryChanges(): boolean
}
