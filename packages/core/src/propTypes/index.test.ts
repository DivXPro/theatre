import {number, string, stringLiteral} from './index'

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
