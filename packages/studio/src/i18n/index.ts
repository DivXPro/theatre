/**
 * i18n 公共入口。宿主应用与 playground 从这里拿 t()/useT()。
 *
 * 模块加载即注册内置词条(en/zh-CN)并完成一次语言决策
 * (持久化的用户选择 > 浏览器语言 > 'en');宿主通过
 * studio.extend({i18n:{language}}) 或 studio.i18n.setLanguage
 * 覆盖/切换。
 */
export {
  registerMessages,
  registerFallback,
  getLanguage,
  getRegisteredLanguages,
  languageDisplayName,
  setLanguage,
  onLanguageChange,
  translate,
  initI18nLanguage,
  type Messages,
  type InterpolationVars,
} from './core'
export {
  I18nProvider,
  useI18n,
  useT,
  usePropLabel,
  type TFunction,
} from './react'

import {en} from './dicts/en'
import {zhCN} from './dicts/zh-CN'
import {
  getLanguage,
  getRegisteredLanguages,
  initI18nLanguage,
  registerMessages,
  setLanguage,
  translate,
} from './core'

registerMessages('en', en)
registerMessages('zh-CN', zhCN)
initI18nLanguage()

// 浏览器控制台调试钩子(对齐 __cameraShot 的先例):切换后跑
// __theatreI18n.getLanguage() 看单例语言是否已变,定位"没换文案"的环节
if (typeof window !== 'undefined') {
  ;(window as typeof window & {__theatreI18n?: unknown}).__theatreI18n = {
    getLanguage,
    setLanguage,
    getRegisteredLanguages,
    translate,
  }
}
