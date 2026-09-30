/**
 * i18n 核心:纯逻辑、零依赖、零 React。
 *
 * 模块级单例——studio 与宿主应用 import 同一个包即共享实例,
 * 宿主注入词典/切语言不需要传 provider。宿主可后注册覆盖内置词条
 * (品牌定制),可补任意新语言;查不到按键逐级回退,最终返回 key 原文,
 * 永远有输出、永不抛错。
 *
 * 语言决策优先级(见 resolveLanguage):
 * 宿主显式指定 > 用户上次选择(localStorage)> 浏览器语言 > 'en'。
 */
export type Messages = {[key: string]: string}
export type InterpolationVars = Record<string, string | number>

/** 语言决策结果里,宿主显式指定以外的来源(测试断言用) */
export type LanguageSource = 'explicit' | 'persisted' | 'navigator' | 'default'

const STORAGE_KEY = 'theatre-i18n-language'

const dictionaries = new Map<string, Messages>()
const fallbacks = new Map<string, string>()
const listeners = new Set<() => void>()

/** 当前语言;explicit =true 表示宿主强制(不写入用户持久化偏好) */
let currentLanguage = 'en'
let currentExplicit = false
/** 启动时是否已经做过一次语言决策(initI18nLanguage) */
let resolved = false

function lookup(lang: string, key: string): string | undefined {
  let l: string | undefined = lang
  const guard = new Set<string>()
  while (l && !guard.has(l)) {
    guard.add(l)
    const hit = dictionaries.get(l)?.[key]
    if (hit !== undefined) return hit
    l = fallbacks.get(l)
  }
  // 链走完后兜底 en:任何语言缺词条都退回英文,不出现 key 原文
  return dictionaries.get('en')?.[key]
}

function interpolate(template: string, vars?: InterpolationVars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : m,
  )
}

/**
 * 按优先级决策语言。显式 > 持久化的用户选择 > 浏览器(前缀匹配注册
 * 语言,沿回退链)> 'en'。只在启动时调一次;之后语言由 setLanguage 管。
 */
export function resolveLanguage(explicit?: string): {
  language: string
  source: LanguageSource
} {
  if (explicit && (dictionaries.has(explicit) || explicit === 'en')) {
    return {language: explicit, source: 'explicit'}
  }
  try {
    const persisted = window.localStorage.getItem(STORAGE_KEY)
    if (persisted && dictionaries.has(persisted)) {
      return {language: persisted, source: 'persisted'}
    }
  } catch {
    // 隐私模式等场景 localStorage 不可达:跳过
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : undefined
  if (nav) {
    // 精确命中 → 前缀命中(zh-CN 词典吃 navigator 'zh')→ 缩写命中
    // ('zh' 吃 zh-CN 词典,取第一个以 nav 为前缀的注册语言)→ 回退链命中
    // (zh-TW navigator 对 zh-CN 词典,若注册了 zh-TW→zh-CN 回退)
    if (dictionaries.has(nav)) return {language: nav, source: 'navigator'}
    const prefix = nav.split('-')[0]
    if (dictionaries.has(prefix)) return {language: prefix, source: 'navigator'}
    for (const lang of dictionaries.keys()) {
      if (lang.startsWith(nav + '-'))
        return {language: lang, source: 'navigator'}
    }
    for (const [lang, fb] of fallbacks) {
      if (lang === nav && dictionaries.has(fb))
        return {language: lang, source: 'navigator'}
    }
  }
  return {language: 'en', source: 'default'}
}

/** studio 启动时调一次:决策语言并冻结来源。显式指定权最高。 */
export function initI18nLanguage(explicit?: string): void {
  if (resolved) return
  resolved = true
  const {language} = resolveLanguage(explicit)
  currentLanguage = language
}

/** 注册(合并)某语言的词条;同 key 后注册覆盖先注册 */
export function registerMessages(lang: string, messages: Messages): void {
  const dict = dictionaries.get(lang) ?? {}
  dictionaries.set(lang, {...dict, ...messages})
}

/** 注册语言回退:from 查不到时沿 to 继续查(可多级链) */
export function registerFallback(from: string, to: string): void {
  fallbacks.set(from, to)
}

export function getLanguage(): string {
  return currentLanguage
}

/** 已注册词典的语言列表(注册顺序)——语言选择菜单的数据源 */
export function getRegisteredLanguages(): string[] {
  return [...dictionaries.keys()]
}

/**
 * 语言的本地显示名(语言选择菜单用):优先 Intl.DisplayNames 按
 * inLanguage(缺省 = 该语言自身)给名,失败退回 code 原文。
 */
export function languageDisplayName(code: string, inLanguage?: string): string {
  try {
    const names = new Intl.DisplayNames([inLanguage ?? code, 'en'], {
      type: 'language',
    })
    return names.of(code) ?? code
  } catch {
    return code
  }
}

/**
 * 切换语言。宿主强制(explicit=true)不写 localStorage(不劫持用户
 * 偏好);用户手动切换(explicit=false)持久化,下次启动优先。
 */
export function setLanguage(lang: string, opts?: {explicit?: boolean}): void {
  if (lang === currentLanguage) return
  currentLanguage = lang
  currentExplicit = opts?.explicit === true
  if (!currentExplicit) {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // 持久化失败不阻塞切换
    }
  }
  listeners.forEach((fn) => fn())
}

/** 语言变化通知;返回注销函数 */
export function onLanguageChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * 取词条:当前语言 → 回退链 → en → key 原文。vars 做 `{name}` 插值。
 * 非 React 环境(宿主命令式代码)直接用它;React 组件用 useT()。
 */
export function translate(
  key: string,
  vars?: InterpolationVars,
  lang?: string,
): string {
  const hit = lookup(lang ?? currentLanguage, key)
  return interpolate(hit ?? key, vars)
}

/** 测试用:清空全部状态 */
export function __resetI18nForTests(): void {
  dictionaries.clear()
  fallbacks.clear()
  listeners.clear()
  currentLanguage = 'en'
  currentExplicit = false
  resolved = false
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
