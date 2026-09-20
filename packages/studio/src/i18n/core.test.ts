/**
 * @jest-environment jsdom
 */
/**
 * i18n 核心的行为测试:注册/覆盖、回退链、en 兜底、插值、
 * 四级语言决策(显式 > 持久化 > 浏览器 > 默认)、切换与持久化、变更通知。
 *
 * 注意:core 是模块级单例,每个用例开始都 __resetI18nForTests() 清场;
 * navigator.language 用 defineProperty 桩掉。
 */
import {
  __resetI18nForTests,
  getLanguage,
  getRegisteredLanguages,
  initI18nLanguage,
  languageDisplayName,
  onLanguageChange,
  registerFallback,
  registerMessages,
  resolveLanguage,
  setLanguage,
  translate,
} from './core'

beforeEach(() => {
  __resetI18nForTests()
})

/** 桩掉 navigator.language(可设 undefined 模拟"无浏览器语言") */
function mockNavigatorLanguage(lang: string | undefined) {
  Object.defineProperty(window.navigator, 'language', {
    value: lang,
    configurable: true,
  })
}

describe('注册与取词', () => {
  it('注册后按 key 取词', () => {
    registerMessages('en', {hello: 'Hello'})
    registerMessages('zh-CN', {hello: '你好'})
    setLanguage('zh-CN')
    expect(translate('hello')).toBe('你好')
    setLanguage('en')
    expect(translate('hello')).toBe('Hello')
  })

  it('同 key 后注册覆盖先注册(宿主品牌定制)', () => {
    registerMessages('en', {brand: 'Theatre'})
    registerMessages('en', {brand: 'Acme Studio'})
    expect(translate('brand')).toBe('Acme Studio')
  })

  it('registerMessages 是合并不是替换', () => {
    registerMessages('en', {a: 'A'})
    registerMessages('en', {b: 'B'})
    expect(translate('a')).toBe('A')
    expect(translate('b')).toBe('B')
  })

  it('查不到时最终回退 en,再查不到返回 key 原文', () => {
    registerMessages('en', {onlyEn: 'Only EN'})
    setLanguage('zh-CN')
    expect(translate('onlyEn')).toBe('Only EN')
    expect(translate('missing.key')).toBe('missing.key')
  })

  it('translate 可显式指定语言,不动当前语言', () => {
    registerMessages('en', {hello: 'Hello'})
    registerMessages('zh-CN', {hello: '你好'})
    setLanguage('en')
    expect(translate('hello', undefined, 'zh-CN')).toBe('你好')
    expect(getLanguage()).toBe('en')
  })
})

describe('回退链', () => {
  it('沿注册的回退链逐级查', () => {
    registerMessages('en', {k: 'EN'})
    registerMessages('zh-CN', {k: '简中'})
    registerMessages('zh-HK', {})
    registerFallback('zh-HK', 'zh-CN')
    registerFallback('zh-CN', 'en')
    expect(translate('k', undefined, 'zh-HK')).toBe('简中')
  })

  it('多级回退链最终到 en', () => {
    registerMessages('en', {k: 'EN'})
    registerMessages('zh-CN', {})
    registerFallback('zh-TW', 'zh-HK')
    registerFallback('zh-HK', 'zh-CN')
    registerFallback('zh-CN', 'en')
    expect(translate('k', undefined, 'zh-TW')).toBe('EN')
  })

  it('回退环不会死循环', () => {
    registerMessages('en', {k: 'EN'})
    registerMessages('a', {})
    registerFallback('a', 'b')
    registerFallback('b', 'a')
    expect(translate('k', undefined, 'a')).toBe('EN')
  })
})

describe('插值', () => {
  it('{var} 替换,数字转字符串', () => {
    registerMessages('en', {welcome: 'Hi {name}, {count} items'})
    expect(translate('welcome', {name: 'Ada', count: 3})).toBe(
      'Hi Ada, 3 items',
    )
  })

  it('缺的变量保留占位符原样', () => {
    registerMessages('en', {k: 'Hi {name}'})
    expect(translate('k', {})).toBe('Hi {name}')
  })

  it('无 vars 时不做替换', () => {
    registerMessages('en', {k: 'Hi {name}'})
    expect(translate('k')).toBe('Hi {name}')
  })
})

describe('语言决策(resolveLanguage)', () => {
  it('默认 en', () => {
    mockNavigatorLanguage(undefined)
    expect(resolveLanguage()).toEqual({language: 'en', source: 'default'})
  })

  it('浏览器语言精确命中', () => {
    registerMessages('zh-CN', {})
    mockNavigatorLanguage('zh-CN')
    expect(resolveLanguage()).toEqual({language: 'zh-CN', source: 'navigator'})
  })

  it('浏览器语言前缀命中(zh 吃 zh-CN 词典)', () => {
    registerMessages('zh-CN', {})
    mockNavigatorLanguage('zh')
    expect(resolveLanguage()).toEqual({language: 'zh-CN', source: 'navigator'})
  })

  it('浏览器语言沿回退链命中(zh-TW → zh-CN)', () => {
    registerMessages('zh-CN', {})
    registerFallback('zh-TW', 'zh-CN')
    mockNavigatorLanguage('zh-TW')
    expect(resolveLanguage()).toEqual({language: 'zh-TW', source: 'navigator'})
  })

  it('持久化的用户选择优先于浏览器', () => {
    registerMessages('zh-CN', {})
    registerMessages('fr', {})
    window.localStorage.setItem('theatre-i18n-language', 'fr')
    mockNavigatorLanguage('zh-CN')
    expect(resolveLanguage()).toEqual({language: 'fr', source: 'persisted'})
  })

  it('宿主显式指定权最高,且不写持久化', () => {
    registerMessages('zh-CN', {})
    window.localStorage.setItem('theatre-i18n-language', 'zh-CN')
    mockNavigatorLanguage('zh-CN')
    expect(resolveLanguage('en')).toEqual({language: 'en', source: 'explicit'})
    expect(window.localStorage.getItem('theatre-i18n-language')).toBe('zh-CN')
  })

  it('显式指定未注册的语言时忽略,继续走后面的层级', () => {
    registerMessages('zh-CN', {})
    mockNavigatorLanguage('zh-CN')
    expect(resolveLanguage('klingon')).toEqual({
      language: 'zh-CN',
      source: 'navigator',
    })
  })
})

describe('initI18nLanguage', () => {
  it('只做一次决策,后来的调用和显式参数都被忽略', () => {
    registerMessages('zh-CN', {})
    initI18nLanguage('zh-CN')
    initI18nLanguage('en')
    expect(getLanguage()).toBe('zh-CN')
  })
})

describe('setLanguage', () => {
  it('用户切换写 localStorage,下次启动优先(端到端)', () => {
    registerMessages('zh-CN', {})
    setLanguage('zh-CN')
    expect(window.localStorage.getItem('theatre-i18n-language')).toBe('zh-CN')
    // 模拟重启:清模块态(不动 localStorage)再决策
    __resetI18nForTestsKeepStorage()
    registerMessages('zh-CN', {})
    initI18nLanguage()
    expect(getLanguage()).toBe('zh-CN')
  })

  it('宿主强制(explicit)不写 localStorage', () => {
    setLanguage('zh-CN', {explicit: true})
    expect(getLanguage()).toBe('zh-CN')
    expect(window.localStorage.getItem('theatre-i18n-language')).toBeNull()
  })

  it('切到同一语言是 no-op,不通知监听', () => {
    registerMessages('zh-CN', {})
    const fn = jest.fn()
    onLanguageChange(fn)
    setLanguage('zh-CN')
    expect(fn).toHaveBeenCalledTimes(1)
    // 再切一次同样的语言:no-op
    setLanguage('zh-CN')
    expect(fn).toHaveBeenCalledTimes(1)
    setLanguage('en')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('onLanguageChange 返回注销函数', () => {
    const fn = jest.fn()
    const off = onLanguageChange(fn)
    off()
    setLanguage('zh-CN')
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('语言列表与显示名(语言选择菜单)', () => {
  it('getRegisteredLanguages 按注册顺序返回', () => {
    registerMessages('en', {k: 'EN'})
    registerMessages('zh-CN', {k: '中'})
    registerMessages('fr', {k: 'FR'})
    expect(getRegisteredLanguages()).toEqual(['en', 'zh-CN', 'fr'])
  })

  it('languageDisplayName 给本地显示名,不按注册顺序乱', () => {
    expect(languageDisplayName('en', 'en')).toBe('English')
    // 中文环境下取中文名;具体措辞随 ICU 版本,只断言不再是 code
    expect(languageDisplayName('zh-CN', 'zh-CN')).not.toBe('zh-CN')
    expect(languageDisplayName('zh-CN', 'zh-CN')).toContain('中文')
  })

  it('languageDisplayName 对异常输入退回 code 原文,不抛错', () => {
    expect(languageDisplayName('not_a_lang!!')).toBe('not_a_lang!!')
  })
})

/** reset 但保留 localStorage(模拟浏览器重启的持久化偏好) */ function __resetI18nForTestsKeepStorage() {
  const saved = window.localStorage.getItem('theatre-i18n-language')
  __resetI18nForTests()
  if (saved !== null)
    window.localStorage.setItem('theatre-i18n-language', saved)
}
