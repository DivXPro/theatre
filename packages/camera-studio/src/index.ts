// 词条注册必须最先执行:模块按 import 顺序求值,App 依赖链里有模块
// 加载期就 translate 的调用(ShotCamera 属性标签)
import './i18n'
export {default as App} from './App'
export const CAMERA_STUDIO_VERSION = '0.1.0'
