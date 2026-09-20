/**
 * 词条完整性 + 加载顺序回归。
 *
 * 回归背景:ShotCamera 在模块加载期就 translate 属性标签(配置是模块级
 * 常量)。若词条注册被入口文件的 import 顺序绕过去(先 App 后 ./i18n),
 * 原始 key 会被当文案烘焙进配置,界面上直接显示键名。这里用
 * isolateModules 模拟最坏顺序——先加载 ShotCamera,断言取词不再返回
 * key 原文。ShotCamera 自带的 './i18n' 副作用导入是本回归的修复本体。
 */
import {en, zhCN} from './i18n'

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
      'pg.props.trackTarget',
      'pg.props.pathKey',
      'pg.props.pathManual',
      'pg.props.animation',
      'pg.props.pose',
    ]) {
      expect(translate(key)).not.toBe(key)
    }
  })
})
