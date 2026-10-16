// 词条注册必须最先执行:模块按 import 顺序求值,CameraScene 依赖链里有模块
// 加载期就 translate 的调用(ShotCamera 属性标签)
import './i18n'
export {CameraScene} from './CameraScene'
export {CAMERA_STUDIO_VERSION} from './version'
export {useCameraStudio} from './useCameraStudio'
export type {
  CameraStudioConfig,
  CameraStudioHandle,
  CameraSceneProps,
} from './config'
// flows.onFlows 回调句柄类型(指南 §2 config 表已点名)及其签名用到的类型
export type {CameraFlows, Vec3} from './hostFlows'
export type {PathPreset} from './pathPresets'
export type {
  CameraStudioError,
  CameraStudioErrorHandler,
  CameraStudioErrorSource,
} from './errors'
// 测试与高级宿主可用:绕过 hook 直接管 init/dispose 生命周期
export {initCameraStudio, disposeCameraStudio} from './bootstrap'
export type {BootCtx} from './bootstrap'
// 统一数据源公开契约(spec §5):宿主实现/组合存储用的类型族、错误族与
// 内置 IndexedDB 实现;宿主自实现源可对 contract-tests 子路径跑契约套件
export type {
  LibrarySource,
  LibrarySourceCapabilities,
  WritableLibrarySource,
  LibraryErrorCode,
} from './assetLibrary/source'
export {LibraryError, isWritableSource} from './assetLibrary/source'
export type {
  RigId,
  RigAlias,
  EntryKind,
  ModelEntry,
  PoseEntry,
  AnimationEntry,
  LibraryEntry,
} from './assetLibrary/types'
export {IndexedDBBackend} from './assetLibrary/indexedDBBackend'
