import {
  Color,
  type ColorRepresentation,
  LinearSRGBColorSpace,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector2,
} from 'three'
import type {WebGLRenderer} from 'three'
import {registerEditorOnly} from '../editorOnly'
import {
  beginExportSceneState,
  createVideoFrameCanvas,
  ExportFrameRenderer,
} from './sceneCapture'
import type {ResolvedRenderOptions} from './previsTypes'

class FakeRenderer {
  outputColorSpace = LinearSRGBColorSpace
  autoClear = false
  private clearColor = new Color('#224466')
  private clearAlpha = 0.5
  private pixelRatio = 2
  private size = new Vector2(800, 600)
  private target: unknown = null
  readonly calls: string[] = []

  getClearColor(target: Color): Color {
    return target.copy(this.clearColor)
  }
  getClearAlpha(): number {
    return this.clearAlpha
  }
  getPixelRatio(): number {
    return this.pixelRatio
  }
  getSize(target: Vector2): Vector2 {
    return target.copy(this.size)
  }
  getRenderTarget(): unknown {
    return this.target
  }
  setClearColor(color: ColorRepresentation, alpha = 1): void {
    this.clearColor = new Color(color)
    this.clearAlpha = alpha
    this.calls.push('setClearColor')
  }
  setPixelRatio(value: number): void {
    this.pixelRatio = value
    this.calls.push('setPixelRatio')
  }
  setSize(width: number, height: number): void {
    this.size.set(width, height)
    this.calls.push('setSize')
  }
  setRenderTarget(target: unknown): void {
    this.target = target
    this.calls.push('setRenderTarget')
  }
}

const options: ResolvedRenderOptions = {
  width: 321,
  height: 123,
  renderMode: 'clay',
  clayColor: '#ABCDEF',
  background: 'neutral',
}

function makeScene() {
  const scene = new Scene()
  const background = new Color('#112233')
  scene.background = background
  const material = new MeshStandardMaterial({color: '#ff0000'})
  const mesh = new Mesh(undefined, material)
  scene.add(mesh)
  const helper = new Object3D()
  helper.visible = true
  scene.add(helper)
  const unregister = registerEditorOnly(helper)
  const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 100)
  camera.updateProjectionMatrix()
  const renderer = new FakeRenderer()
  return {
    scene,
    background,
    material,
    mesh,
    helper,
    unregister,
    camera,
    renderer: renderer as unknown as WebGLRenderer,
    fakeRenderer: renderer,
  }
}

describe('beginExportSceneState', () => {
  test('clay 覆盖与全部临时状态在恢复后回到原值', () => {
    const s = makeScene()
    const prevProjection = s.camera.projectionMatrix.clone()
    const prevBackground = s.scene.background

    const restore = beginExportSceneState(
      s.renderer,
      s.scene,
      s.camera,
      options,
    )

    expect(s.camera.aspect).toBe(321 / 123)
    expect(s.scene.overrideMaterial).toBeTruthy()
    expect(s.scene.background).not.toBe(prevBackground)
    expect(s.helper.visible).toBe(false)
    expect(s.material.color.getHexString()).toBe('ff0000')
    expect(s.fakeRenderer.autoClear).toBe(true)
    // 原场景无灯:添加临时中性灯组
    expect(s.scene.children.filter((o) => o.type === 'Group')).toHaveLength(1)

    restore()

    expect(s.camera.aspect).toBe(16 / 9)
    expect(s.camera.projectionMatrix.elements).toEqual(prevProjection.elements)
    expect(s.scene.overrideMaterial).toBe(null)
    expect(s.scene.background).toBe(prevBackground)
    expect(s.helper.visible).toBe(true)
    expect(s.scene.children.filter((o) => o.type === 'Group')).toHaveLength(0)
    expect(s.fakeRenderer.outputColorSpace).toBe(LinearSRGBColorSpace)
    expect(s.fakeRenderer.autoClear).toBe(false)
    s.unregister()
  })

  test('应用临时状态中途抛错时完整恢复材质/背景/相机/renderer', () => {
    const s = makeScene()
    const prevAspect = s.camera.aspect
    // 在相机/背景已改、clay 已覆盖之后抛错,验证 catch 不是只恢复一部分
    const failing = s.fakeRenderer
    const originalSetRenderTarget = failing.setRenderTarget.bind(failing)
    let targetCalls = 0
    failing.setRenderTarget = (target: unknown) => {
      targetCalls += 1
      if (targetCalls === 1) throw new Error('render target bind failed')
      originalSetRenderTarget(target)
    }
    expect(() =>
      beginExportSceneState(s.renderer, s.scene, s.camera, options),
    ).toThrow('render target bind failed')

    expect(s.camera.aspect).toBe(prevAspect)
    expect(s.scene.overrideMaterial).toBe(null)
    expect(s.scene.background).toBe(s.background)
    expect(s.helper.visible).toBe(true)
    expect(s.material.color.getHexString()).toBe('ff0000')
    expect(s.scene.children.filter((o) => o.type === 'Group')).toHaveLength(0)
    expect(failing.outputColorSpace).toBe(LinearSRGBColorSpace)
    expect(failing.autoClear).toBe(false)
    s.unregister()
  })

  test('透明背景清空 scene.background 并恢复', () => {
    const s = makeScene()
    const restore = beginExportSceneState(s.renderer, s.scene, s.camera, {
      ...options,
      renderMode: 'styled',
      background: 'transparent',
    })
    expect(s.scene.background).toBe(null)
    restore()
    expect(s.scene.background).toBe(s.background)
    s.unregister()
  })
})

describe('ExportFrameRenderer', () => {
  test('readRenderTargetPixels 使用精确请求尺寸,输出翻为从上到下', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera()
    let readWidth = 0
    let readHeight = 0
    const fake = {
      target: null as unknown,
      getRenderTarget() {
        return this.target
      },
      setRenderTarget(value: unknown) {
        this.target = value
      },
      render() {},
      readRenderTargetPixels(
        _target: unknown,
        _x: number,
        _y: number,
        width: number,
        height: number,
        pixels: Uint8Array,
      ) {
        readWidth = width
        readHeight = height
        for (let row = 0; row < height; row++) {
          pixels.fill(row, row * width * 4, (row + 1) * width * 4)
        }
      },
    }
    const frameRenderer = new ExportFrameRenderer(
      fake as unknown as WebGLRenderer,
      7,
      3,
    )
    const pixels = frameRenderer.render(scene, camera)
    expect(readWidth).toBe(7)
    expect(readHeight).toBe(3)
    expect(pixels[0]).toBe(2) // 原最后一行翻到第一行
    expect(pixels[7 * 4 * 2]).toBe(0)
    expect(fake.target).toBe(null)
    frameRenderer.dispose()
  })
})

describe('createVideoFrameCanvas', () => {
  test('返回可直接构造 VideoFrame 的已初始化画布', () => {
    const getContext = jest.fn(() => ({}))
    class FakeOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext = getContext
    }
    const previous = (globalThis as {OffscreenCanvas?: unknown}).OffscreenCanvas
    ;(globalThis as {OffscreenCanvas?: unknown}).OffscreenCanvas =
      FakeOffscreenCanvas
    try {
      expect(createVideoFrameCanvas(320, 180)).toMatchObject({
        width: 320,
        height: 180,
      })
      expect(getContext).toHaveBeenCalledWith('2d')
    } finally {
      ;(globalThis as {OffscreenCanvas?: unknown}).OffscreenCanvas = previous
    }
  })
})
