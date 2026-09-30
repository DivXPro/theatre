/**
 * r3f 词条注册壳(main 侧):把 src/i18nDicts.ts 的词典注入 studio
 * i18n 单例。宿主加载 r3f 时本模块随之注册,属性面板的 label 函数
 * (() => translate(...))在每次渲染时现查,语言切换热改。
 * 与 extension/i18n.ts 内容相同;重复注册同值合并,无副作用。
 */
import {registerMessages} from '@dreamerbird/studio/i18n'
import {
  r3fPropsEn,
  r3fPropsZhCN,
  r3fEditorEn,
  r3fEditorZhCN,
} from '../i18nDicts'

registerMessages('en', {...r3fPropsEn, ...r3fEditorEn})
registerMessages('zh-CN', {...r3fPropsZhCN, ...r3fEditorZhCN})
