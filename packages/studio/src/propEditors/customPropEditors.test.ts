import {
  getCustomPropEditor,
  registerCustomPropEditor,
  unregisterCustomPropEditor,
} from './customPropEditors'

describe('自定义属性编辑器注册表(editor 配置项的 studio 侧)', () => {
  afterEach(() => {
    unregisterCustomPropEditor('pose')
  })

  it('注册后按 key 取回同一组件;未注册/未传 key 返回 undefined', () => {
    const component = () => null
    expect(getCustomPropEditor('pose')).toBeUndefined()
    expect(getCustomPropEditor(undefined)).toBeUndefined()
    registerCustomPropEditor('pose', component)
    expect(getCustomPropEditor('pose')).toBe(component)
  })

  it('同 key 再注册覆盖(宿主重渲染刷新闭包数据的通路)', () => {
    const first = () => null
    const second = () => null
    registerCustomPropEditor('pose', first)
    registerCustomPropEditor('pose', second)
    expect(getCustomPropEditor('pose')).toBe(second)
  })

  it('注销后回落 undefined(内置编辑器)', () => {
    registerCustomPropEditor('pose', () => null)
    unregisterCustomPropEditor('pose')
    expect(getCustomPropEditor('pose')).toBeUndefined()
  })
})
