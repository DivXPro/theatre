/**
 * i18n 的 React 绑定:provider 挂在 studio 的 UIRoot,组件用 useT()
 * 取翻译函数;语言切换时 context value 变化,订阅组件自动重渲染。
 */
import React, {createContext, useContext, useEffect, useState} from 'react'
import type {ReactNode} from 'react'
import {resolvePropLabel} from '@dreamerbird/core'
import type {PropLabel} from '@dreamerbird/core/types/public'
import {
  getLanguage,
  onLanguageChange,
  translate,
  type InterpolationVars,
} from './core'

export type TFunction = (key: string, vars?: InterpolationVars) => string

const I18nContext = createContext<{t: TFunction; language: string}>({
  t: translate,
  language: 'en',
})

export function I18nProvider({children}: {children: ReactNode}) {
  const [language, setLanguage] = useState(getLanguage())
  useEffect(() => onLanguageChange(() => setLanguage(getLanguage())), [])
  const value = React.useMemo(
    () => ({t: translate as TFunction, language}),
    [language],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** 翻译函数 + 当前语言(需要按语言做逻辑分支时用 language) */
export function useI18n(): {t: TFunction; language: string} {
  return useContext(I18nContext)
}

/** 只要翻译函数的简写:const t = useT() */
export function useT(): TFunction {
  return useContext(I18nContext).t
}

/**
 * 属性显示名的 React 绑定:返回当前应显示的文字。
 * 本质 = resolvePropLabel + 订阅语言变化:语言一切换,持有本 hook
 * 的组件随 context 重渲染,label 函数重新求值——属性名即时换语言,
 * 不用重新打开面板。非 React 环境(测试/脚本)继续用 resolvePropLabel。
 */
export function usePropLabel(label: PropLabel | undefined): string | undefined {
  const {language} = useContext(I18nContext)
  void language // 仅订阅:语言变化触发重渲染,resolvePropLabel 重新求值
  return resolvePropLabel(label)
}
