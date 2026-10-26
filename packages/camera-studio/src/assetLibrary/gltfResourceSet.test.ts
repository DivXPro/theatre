import {createResourceUrlModifier} from './gltfResourceSet'

describe('createResourceUrlModifier', () => {
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  let nextId = 0

  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => `blob:resource-${++nextId}`)
    URL.revokeObjectURL = jest.fn()
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
  })

  it('按相对 URI 的文件名映射并复用 object URL,dispose 全部回收', () => {
    const bin = new File([new Uint8Array(36)], 'triangle.bin')
    const png = new File(['png'], 'tiny pixel.png', {type: 'image/png'})
    const resources = createResourceUrlModifier([bin, png])

    const binUrl = resources.manager.resolveURL('./geometry/triangle.bin')
    const pngUrl = resources.manager.resolveURL('./textures/tiny%20pixel.png')
    expect(resources.manager.resolveURL('triangle.bin')).toBe(binUrl)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)

    resources.dispose()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(binUrl)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(pngUrl)
  })

  it('保留已有绝对资源 URL,缺失文件报出资源名', () => {
    const resources = createResourceUrlModifier([])
    for (const url of [
      'blob:existing',
      'data:image/png;base64,x',
      'https://example.com/a.bin',
      'http://example.com/a.bin',
    ]) {
      expect(resources.manager.resolveURL(url)).toBe(url)
    }
    expect(() => resources.manager.resolveURL('./missing.bin')).toThrow(
      'GLTF 外部资源缺失: missing.bin',
    )
    resources.dispose()
  })
})
