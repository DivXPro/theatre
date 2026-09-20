/**
 * r3f 词条注册壳(extension 侧):把 src/i18nDicts.ts 的词典注入
 * studio i18n 单例。extension 是独立构建入口,不能 import main/ 内部,
 * 词典本体放共享根部(src/i18nDicts.ts),两侧各留一个注册壳。
 * 与 main/i18n.ts 内容相同;重复注册同值合并,无副作用。
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
