/**
 * 宿主错误提示接口(2026-10-16):模块不内置错误条,统一把可展示错误
 * 转成这个形状交给宿主,由宿主自己的提示组件渲染。
 */
import type {LibraryError, LibraryErrorCode} from './assetLibrary/source'

/** library = 资产库存储/启动清理;export = 视频导出 */
export type CameraStudioErrorSource = 'library' | 'export'

/** 宿主提示组件可直接渲染的结构化错误 */
export type CameraStudioError = {
  source: CameraStudioErrorSource
  /** LibraryError 六码;非库错误当前一律 unknown */
  code: LibraryErrorCode
  /** 可直接给宿主提示组件展示的文本 */
  message: string
  /** 原始错误(供宿主日志/排错;未知错误原样带上) */
  cause?: unknown
}

/** CameraStudioConfig.onError 的回调签名 */
export type CameraStudioErrorHandler = (error: CameraStudioError) => void

/** 聚合库上告的 LibraryError → 宿主错误形状(保留六码与原始 cause) */
export function cameraErrorFromLibrary(error: LibraryError): CameraStudioError {
  return {
    source: 'library',
    code: error.code,
    message: error.message,
    cause: error.cause ?? error,
  }
}

/** 启动清理等非 LibraryError 失败 → 宿主错误形状(操作名进 message) */
export function cameraErrorFromUnknown(
  source: CameraStudioErrorSource,
  message: string,
  cause?: unknown,
): CameraStudioError {
  return {source, code: 'unknown', message, cause}
}
