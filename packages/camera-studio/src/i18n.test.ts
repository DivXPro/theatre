/**
 * 词条完整性 + 加载顺序回归。
 *
 * 回归背景:ShotCamera 在模块加载期就 translate 属性标签(配置是模块级
 * 常量)。若词条注册被入口文件的 import 顺序绕过去(先 App 后 ./i18n),
 * 原始 key 会被当文案烘焙进配置,界面上直接显示键名。这里用
 * isolateModules 模拟最坏顺序——先加载 ShotCamera,断言取词不再返回
 * key 原文。ShotCamera 自带的 './i18n' 副作用导入是本回归的修复本体。
 */
import {
  getLanguage,
  getRegisteredLanguages,
  translate,
} from '@dreamerbird/studio/i18n'
import type {Messages} from '@dreamerbird/studio/i18n'
import '../../r3f/src/main/i18n'
import {actionEditorEn} from './actionEditor/labels'
import {en, setCameraStudioLocale, zhCN} from './i18n'
import {cameraLocales} from './i18nLocales'
import {pathMessages} from './i18nLocales/paths'
import {PATH_PRESETS} from './pathPresets'
import {poseNameEn} from './poseNameMessages'

test.each([
  ['ja', 'ja-JP'],
  ['ko', 'ko-KR'],
  ['ru', 'ru-RU'],
  ['de', 'de-DE'],
  ['es', 'es-MX'],
  ['pt', 'pt-BR'],
  ['fr', 'fr-CA'],
])(
  'locale %s is available to studio and can be selected as %s by the host',
  (locale, region) => {
    expect(getRegisteredLanguages()).toContain(locale)
    setCameraStudioLocale(region)
    try {
      expect(getLanguage()).toBe(locale)
      for (const key of [
        'workspace.timeline',
        'workspace.timeline.expand',
        'pg.toolbar.addCamera',
        'pg.actionEditor.title',
        'pg.poseName.stand-relaxed',
        'pg.characterPath.settings',
        'pg.pathPreset.figure8v',
        'pg.pathEdit.pin',
        'r3f.props.groundColor',
      ]) {
        const localized = translate(key, undefined, locale)
        expect(localized).not.toBe(key)
        expect(localized).not.toBe(translate(key, undefined, 'en'))
        expect(translate(key)).toBe(localized)
      }
    } finally {
      setCameraStudioLocale('en')
    }
  },
)

const cameraMessagesEn: Messages = {
  ...en,
  ...poseNameEn,
  ...actionEditorEn,
  ...pathMessages.en,
}

function placeholders(message: string): string[] {
  return (message.match(/\{\w+\}/g) ?? []).sort()
}

test.each(Object.keys(cameraLocales) as Array<keyof typeof cameraLocales>)(
  '%s registers a complete camera dictionary with the same interpolation variables as English',
  (locale) => {
    const {camera, poseNames, actionEditor} = cameraLocales[locale]
    const messages: Messages = {
      ...camera,
      ...poseNames,
      ...actionEditor,
      ...pathMessages[locale],
    }
    expect(Object.keys(messages).sort()).toEqual(
      Object.keys(cameraMessagesEn).sort(),
    )
    for (const [key, value] of Object.entries(messages)) {
      expect([key, value.trim(), placeholders(value)]).toEqual([
        key,
        expect.stringMatching(/\S/),
        placeholders(cameraMessagesEn[key]),
      ])
      expect(translate(key, undefined, locale)).toBe(value)
    }
  },
)

test('all built-in path presets have a label in every locale', () => {
  const keys = PATH_PRESETS.map(({id}) => `pg.pathPreset.${id}`).sort()
  for (const messages of Object.values(pathMessages)) {
    expect(
      Object.keys(messages)
        .filter((key) => key.startsWith('pg.pathPreset.'))
        .sort(),
    ).toEqual(keys)
  }
})

test('en 与 zh-CN 词条 key 集合一致(漏翻会静默回退英文)', () => {
  expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort())
})

test('词条值非空', () => {
  for (const dict of [en, zhCN]) {
    for (const [k, v] of Object.entries(dict)) {
      expect(v.trim()).not.toBe('')
      expect(v).not.toBe(k)
    }
  }
})

test('最坏 import 顺序下(先 ShotCamera)属性标签也不会烘焙 key', () => {
  // studio i18n 自 usePropLabel 起传递依赖 @dreamerbird/core(react.tsx
  // 导入 resolvePropLabel),本测试文件顶部 import 词典时已加载 core,
  // 其 bundle 全局守卫(window.__TheatreJS_CoreBundle)在 isolateModules
  // 的二次评估下会误报"被其他模块设置"。清掉它 = 模拟全新页面首载。
  delete (globalThis as Record<string, unknown>).__TheatreJS_CoreBundle
  jest.isolateModules(() => {
    require('./ShotCamera')
    const {translate} = require('@dreamerbird/studio/i18n')
    for (const key of [
      'pg.props.aimTarget',
      'pg.props.pathKey',
      'pg.props.pathManual',
      'pg.props.animation',
      'pg.props.pose',
    ]) {
      expect(translate(key)).not.toBe(key)
    }
  })
})
