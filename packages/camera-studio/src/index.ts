// 词条注册必须最先执行:模块按 import 顺序求值,App 依赖链里有模块
// 加载期就 translate 的调用(ShotCamera 属性标签)
import './i18n'
export {default as App} from './App'
export const CAMERA_STUDIO_VERSION = '0.1.0'
export {useCameraStudio} from './useCameraStudio'
export type {
  CameraStudioConfig,
  CameraStudioHandle,
  CameraSceneProps,
} from './config'
// 测试与高级宿主可用:绕过 hook 直接管 init/dispose 生命周期
export {initCameraStudio, disposeCameraStudio} from './bootstrap'
export type {BootCtx} from './bootstrap'
// T9 落地后:export {CameraScene} from './CameraScene'(替换 App 导出)
