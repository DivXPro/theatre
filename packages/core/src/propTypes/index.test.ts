import {boolean, number, resolvePropLabel, string, stringLiteral} from './index'

describe('label 选项(PropLabel:字符串或函数)', () => {
  it('字符串 label 原样存入配置', () => {
    expect(string('a', {label: 'Name'}).label).toBe('Name')
  })

  it('函数 label 原样存入配置(resolvePropLabel 每次渲染现调)', () => {
    const label = () => 'Name'
    expect(string('a', {label}).label).toBe(label)
  })

  it('resolvePropLabel:字符串原样返回,undefined 原样返回', () => {
    expect(resolvePropLabel('Name')).toBe('Name')
    expect(resolvePropLabel(undefined)).toBeUndefined()
  })

  it('resolvePropLabel:函数调用取返回值(i18n 热切换的支撑)', () => {
    let lang = 'en'
    const label = () => (lang === 'en' ? 'Name' : '名称')
    expect(resolvePropLabel(label)).toBe('Name')
    lang = 'zh-CN'
    // 同一个函数引用,返回值跟随外部状态——属性名无需刷新即换语言
    expect(resolvePropLabel(label)).toBe('名称')
  })

  it('非法 label(数字)开发模式下抛错', () => {
    expect(() => string('a', {label: 42 as never})).toThrow(/opts\.label/)
  })
})

describe('hidden 选项(属性面板隐藏纯数据属性)', () => {
  it('hidden 透传进配置;不传则为 undefined', () => {
    expect(string('[]', {hidden: true}).hidden).toBe(true)
    expect(string('[]', {hidden: false}).hidden).toBe(false)
    expect(string('[]').hidden).toBeUndefined()
    expect(number(0, {hidden: true}).hidden).toBe(true)
    expect(stringLiteral('a', {a: 'A'}, {hidden: true}).hidden).toBe(true)
  })

  it('hidden 必须是布尔,否则开发模式下抛错', () => {
    expect(() => string('[]', {hidden: 1 as never})).toThrow(/opts\.hidden/)
  })
})

describe('editor 选项(属性面板自定义编辑器注册表 key)', () => {
  it('editor 透传进配置;不传则为 undefined', () => {
    expect(string('[]', {editor: 'pose'}).editor).toBe('pose')
    expect(string('[]').editor).toBeUndefined()
    expect(number(0, {editor: 'pose'}).editor).toBe('pose')
    expect(stringLiteral('a', {a: 'A'}, {editor: 'pose'}).editor).toBe('pose')
    expect(boolean(true, {editor: 'pose'}).editor).toBe('pose')
  })

  it('editor 必须是非空字符串,否则开发模式下抛错', () => {
    expect(() => string('[]', {editor: 1 as never})).toThrow(/opts\.editor/)
    expect(() => string('[]', {editor: ''})).toThrow(/opts\.editor/)
    expect(() => string('[]', {editor: ' a '})).toThrow(/opts\.editor/)
  })
})

describe('stringLiteral 动态选项(函数形式)', () => {
  it('函数形式的选项原样存入配置,静态对象则拷贝', () => {
    const dynamic = () => ({a: 'A'})
    const fnConfig = stringLiteral('a', dynamic)
    expect(fnConfig.valuesAndLabels).toBe(dynamic)

    const staticOptions = {a: 'A'}
    const staticConfig = stringLiteral('a', staticOptions)
    expect(staticConfig.valuesAndLabels).toEqual(staticOptions)
    expect(staticConfig.valuesAndLabels).not.toBe(staticOptions)
  })

  it('校验时现取选项:当前在选项里的值通过', () => {
    const config = stringLiteral('idle', () => ({idle: '待机', run: '跑步'}))
    expect(config.deserializeAndSanitize('run')).toBe('run')
    expect(config.deserializeAndSanitize('jump')).toBeUndefined()
    expect(config.deserializeAndSanitize(42)).toBeUndefined()
  })

  it('选项变化后,校验跟随最新选项', () => {
    let options: Record<string, string> = {idle: '待机'}
    const config = stringLiteral('idle', () => options)
    expect(config.deserializeAndSanitize('run')).toBeUndefined()

    // 库里新增动作后,同一个配置对象无需重建即可接受新值
    options = {idle: '待机', run: '跑步'}
    expect(config.deserializeAndSanitize('run')).toBe('run')
  })

  it('已存的值从选项里消失后回退(undefined → 外层用默认值)', () => {
    let options: Record<string, string> = {idle: '待机', run: '跑步'}
    const config = stringLiteral('idle', () => options)
    expect(config.deserializeAndSanitize('run')).toBe('run')

    // 动作从库里删除后,旧值不再合法,sanitize 返回 undefined,
    // getValues 会用 default 顶替——不会把失效值继续喂给运行时
    options = {idle: '待机'}
    expect(config.deserializeAndSanitize('run')).toBeUndefined()
  })

  it('每次校验都重新调用函数(不是创建时固化)', () => {
    let calls = 0
    const config = stringLiteral('a', () => {
      calls++
      return {a: 'A'}
    })
    config.deserializeAndSanitize('a')
    config.deserializeAndSanitize('a')
    expect(calls).toBe(2)
  })
})
