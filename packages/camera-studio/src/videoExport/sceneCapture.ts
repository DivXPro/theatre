/**
 * 离线场景捕获:把 Three 场景渲染到独立 render target,并完成 PNG /
 * VideoFrame 需要的像素搬运。
 *
 * 这里不读主 canvas 的 DOM 像素:输出尺寸由 render target 精确决定,
 * 编辑辅助对象在导出期整体隐藏,白模通过 scene.overrideMaterial 临时
 * 覆盖。任何临时状态都由 beginExportSceneState 返回的幂等 restore 恢复。
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  MeshStandardMaterial,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
} from 'three'
import type {
  Camera,
  Fog,
  FogExp2,
  Material,
  Object3D,
  PerspectiveCamera,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three'
import {AgentApiError} from '../agent/errors'
import {hideEditorOnlyObjects} from '../editorOnly'
import {
  DEFAULT_NEUTRAL_BACKGROUND,
  type ResolvedRenderOptions,
} from './previsTypes'

type SceneBackground = Color | Texture | null
type SceneFog = Fog | FogExp2 | null
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

function createClayMaterial(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(color),
    metalness: 0,
    roughness: 1,
    envMapIntensity: 0,
    map: null,
    alphaMap: null,
    envMap: null,
    vertexColors: false,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    depthTest: true,
    side: DoubleSide,
  })
}

function sceneHasLight(scene: Scene): boolean {
  let found = false
  scene.traverse((object) => {
    if ((object as Object3D & {isLight?: boolean}).isLight) found = true
  })
  return found
}

function createNeutralLights(): Group {
  const group = new Group()
  group.name = '__previs_export_lights__'
  group.add(new AmbientLight(0xffffff, 0.65))
  const key = new DirectionalLight(0xffffff, 2.2)
  key.position.set(5, 8, 6)
  group.add(key)
  group.add(key.target)
  const fill = new DirectionalLight(0xffffff, 0.7)
  fill.position.set(-6, 3, 4)
  group.add(fill)
  group.add(fill.target)
  const rim = new DirectionalLight(0xffffff, 0.9)
  rim.position.set(0, 5, -7)
  group.add(rim)
  group.add(rim.target)
  return group
}

/**
 * 应用一次导出所需的临时场景/相机/renderer 状态,返回幂等恢复函数。
 * 不写 Theatre 对象、不 bump revision、不持久化任何材质/灯光/背景。
 */
export function beginExportSceneState(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  options: ResolvedRenderOptions,
): () => void {
  const prevBackground = scene.background as SceneBackground
  const prevOverrideMaterial = scene.overrideMaterial as Material | null
  const prevFog = scene.fog as SceneFog
  const prevClearColor = renderer.getClearColor(new Color()).clone()
  const prevClearAlpha = renderer.getClearAlpha()
  const prevOutputColorSpace = renderer.outputColorSpace
  const prevAutoClear = renderer.autoClear
  const prevPixelRatio = renderer.getPixelRatio()
  const prevSize = renderer.getSize(new Vector2())
  const prevTarget = renderer.getRenderTarget()
  const prevAspect = camera.aspect
  const prevProjection = camera.projectionMatrix.clone()
  const prevProjectionInverse = camera.projectionMatrixInverse.clone()

  const restoreEditorOnly = hideEditorOnlyObjects()
  const clayMaterial =
    options.renderMode === 'clay' ? createClayMaterial(options.clayColor) : null
  let temporaryLights: Group | null = null

  let restored = false
  const restore = (): void => {
    if (restored) return
    restored = true
    restoreEditorOnly()
    scene.background = prevBackground
    scene.overrideMaterial = prevOverrideMaterial
    scene.fog = prevFog
    if (temporaryLights) {
      scene.remove(temporaryLights)
      temporaryLights = null
    }
    clayMaterial?.dispose()
    camera.aspect = prevAspect
    camera.projectionMatrix.copy(prevProjection)
    camera.projectionMatrixInverse.copy(prevProjectionInverse)
    renderer.setRenderTarget(prevTarget)
    renderer.setClearColor(prevClearColor, prevClearAlpha)
    renderer.outputColorSpace = prevOutputColorSpace
    renderer.autoClear = prevAutoClear
    renderer.setPixelRatio(prevPixelRatio)
    renderer.setSize(prevSize.x, prevSize.y, false)
  }

  try {
    camera.aspect = options.width / options.height
    camera.updateProjectionMatrix()

    if (options.background === 'transparent') {
      scene.background = null
      renderer.setClearColor(0x000000, 0)
    } else if (options.background === 'neutral') {
      scene.background = new Color(DEFAULT_NEUTRAL_BACKGROUND)
      renderer.setClearColor(new Color(DEFAULT_NEUTRAL_BACKGROUND), 1)
    }

    if (clayMaterial) {
      scene.overrideMaterial = clayMaterial
      // 白模参考不应被工程雾效染色或吞掉远景轮廓。
      scene.fog = null
      if (!sceneHasLight(scene)) {
        temporaryLights = createNeutralLights()
        scene.add(temporaryLights)
      }
    }

    // 导出统一按 sRGB 写入 PNG/视频;主视口原有色彩空间在 finally 恢复。
    renderer.outputColorSpace = SRGBColorSpace
    // 透明背景依赖清屏;临时强制 autoClear,避免宿主关闭后残留上一帧。
    renderer.autoClear = true

    // 快照尺寸/pixelRatio 并在恢复时写回,即使本路径只改 render target,
    // 也保证与宿主 renderer 的临时改动契约一致。
    renderer.setPixelRatio(prevPixelRatio)
    renderer.setSize(prevSize.x, prevSize.y, false)
    renderer.setRenderTarget(prevTarget)
  } catch (error) {
    restore()
    throw error
  }

  return restore
}

/**
 * 单个导出任务复用的离屏帧渲染器。输出像素固定为 width×height,
 * 与主 renderer 的 drawing buffer / CSS 尺寸无关。
 */
export class ExportFrameRenderer {
  private readonly target: WebGLRenderTarget
  private readonly pixels: Uint8Array

  constructor(
    private readonly renderer: WebGLRenderer,
    readonly width: number,
    readonly height: number,
  ) {
    this.target = new WebGLRenderTarget(width, height, {
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 4,
    })
    this.target.texture.colorSpace = SRGBColorSpace
    this.pixels = new Uint8Array(width * height * 4)
  }

  /** 渲染当前 scene/camera,返回从上到下的 RGBA8 像素 */
  render(scene: Scene, camera: Camera): Uint8Array {
    const prevTarget = this.renderer.getRenderTarget()
    try {
      this.renderer.setRenderTarget(this.target)
      this.renderer.render(scene, camera)
      this.renderer.readRenderTargetPixels(
        this.target,
        0,
        0,
        this.width,
        this.height,
        this.pixels,
      )
    } finally {
      this.renderer.setRenderTarget(prevTarget)
    }
    return flipRows(this.pixels, this.width, this.height)
  }

  dispose(): void {
    this.target.dispose()
  }
}

function flipRows(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(pixels.length)
  const rowBytes = width * 4
  for (let y = 0; y < height; y++) {
    out.set(
      pixels.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes),
      y * rowBytes,
    )
  }
  return out
}

function create2DCanvas(width: number, height: number): AnyCanvas {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : typeof document !== 'undefined'
        ? document.createElement('canvas')
        : null
  if (!canvas) {
    throw new AgentApiError(
      'CAPABILITY_UNAVAILABLE',
      '运行环境没有 OffscreenCanvas 或 DOM canvas,无法编码图像',
    )
  }
  canvas.width = width
  canvas.height = height
  // Chrome 在 OffscreenCanvas 还没有 2D 上下文时拒绝把它作为
  // VideoFrame 源(Invalid source state);提前初始化再交给 WebCodecs。
  if (!canvas.getContext('2d')) {
    throw new AgentApiError(
      'CAPABILITY_UNAVAILABLE',
      '画布无法创建 2D 上下文,无法编码图像',
    )
  }
  return canvas
}

function createHtmlCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new AgentApiError(
      'CAPABILITY_UNAVAILABLE',
      'MediaRecorder 降级需要 DOM canvas',
    )
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function createVideoFrameCanvas(
  width: number,
  height: number,
): AnyCanvas {
  return create2DCanvas(width, height)
}

export function createMediaRecorderCanvas(
  width: number,
  height: number,
): HTMLCanvasElement {
  return createHtmlCanvas(width, height)
}

export function drawPixels(
  canvas: AnyCanvas,
  pixels: Uint8Array,
  width: number,
  height: number,
): void {
  const context = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!context) {
    throw new AgentApiError('CAPABILITY_UNAVAILABLE', '2D canvas 上下文不可用')
  }
  context.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height),
    0,
    0,
  )
}

export async function encodePng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = create2DCanvas(width, height)
  drawPixels(canvas, pixels, width, height)
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({type: 'image/png'})
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new AgentApiError('INTERNAL_ERROR', 'PNG canvas 编码返回空 Blob'),
            ),
      'image/png',
    )
  })
}
