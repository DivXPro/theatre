import {
  AlwaysDepth,
  BufferAttribute,
  BufferGeometry,
  Color,
  DepthTexture,
  Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshNormalMaterial,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
} from 'three'
import type {Camera, MeshPhysicalMaterial, Object3D, WebGLRenderer} from 'three'
import {withEditorOnlyHidden} from './editorOnly'

export type ViewportRenderMode = 'original' | 'line'

export interface MangaViewportOptions {
  outerWidth?: number
  innerWidth?: number
  depthThreshold?: number
  normalThreshold?: number
  /** 投影网点间距(屏幕 CSS 像素),越小颗粒越细 */
  dotSpacing?: number
  /** 是否用网点材质绘制真实投射阴影 */
  castShadow?: boolean
}

export const mangaViewportDefaults: Required<MangaViewportOptions> = {
  outerWidth: 1.8,
  innerWidth: 0.95,
  depthThreshold: 0.003,
  normalThreshold: 0.13,
  dotSpacing: 2.6,
  castShadow: false,
}

type Surface = Material &
  Partial<
    Pick<
      MeshPhysicalMaterial,
      | 'map'
      | 'alphaMap'
      | 'flatShading'
      | 'displacementMap'
      | 'displacementScale'
      | 'displacementBias'
      | 'transmission'
      | 'wireframe'
      | 'wireframeLinewidth'
    >
  >
type DataMaterial = MeshNormalMaterial &
  Pick<MeshPhysicalMaterial, 'map' | 'alphaMap'>
type ShadowMaskMaterial = MeshLambertMaterial &
  Pick<
    MeshPhysicalMaterial,
    | 'map'
    | 'alphaMap'
    | 'flatShading'
    | 'displacementMap'
    | 'displacementScale'
    | 'displacementBias'
  >
type DrawObject = Object3D & {
  isMesh?: boolean
  material?: Material | Material[]
}
type MaterialSwap = {
  object: DrawObject
  original: Material | Material[]
  data: Material | Material[]
  overlay: Material | Material[]
}
type ShadowSwap = {
  object: DrawObject
  original: Material | Material[]
  receiveShadow: boolean
  castShadow: boolean
}
type ShadowState = {
  bias: number
  normalBias: number
  mapSize: Vector2
  camera: {
    isOrthographicCamera?: boolean
    left: number
    right: number
    near: number
    far: number
  }
}
type ShadowLight = {
  isLight?: boolean
  castShadow?: boolean
  shadow?: ShadowState
}

function makeDataMaterial(): DataMaterial {
  const material = Object.assign(
    new MeshNormalMaterial({blending: NoBlending, toneMapped: false}),
    {map: null, alphaMap: null},
  )
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <uv_pars_vertex>',
        (chunk) => `${chunk}
        #include <color_pars_vertex>`,
      )
      .replace(
        '#include <batching_vertex>',
        (chunk) => `${chunk}
        #include <color_vertex>`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <uv_pars_fragment>',
        (chunk) => `${chunk}
        #include <map_pars_fragment>
        #include <alphamap_pars_fragment>
        #include <alphatest_pars_fragment>
        #include <alphahash_pars_fragment>
        #include <color_pars_fragment>`,
      )
      .replace(
        '#include <logdepthbuf_fragment>',
        (chunk) => `${chunk}
        #include <map_fragment>
        #include <color_fragment>
        #include <alphamap_fragment>
        #include <alphatest_fragment>
        #include <alphahash_fragment>`,
      )
      .replace('diffuseColor.a );', '1.0 );')
  }
  return material
}

/**
 * 把场景渲染成"投影遮罩"数据贴图:1 = 处于投射阴影内,0 = 被照亮。
 *
 * 用 Lambert 是因为它原生包含法线/透明裁剪/骨骼变形等顶点链路,又带
 * shadowmap 采样;只把最终输出换掉,材质本身仍按真实光源与 shadow map
 * 计算 getShadowMask()。再叠加"背向主光"的遮挡,网点浓度取两者较暗的
 * 那个:被别的东西挡住(投射阴影)和背光面都铺点,完全受光的亮面不铺点。
 */
function makeShadowMaskMaterial(): ShadowMaskMaterial {
  const material = Object.assign(
    new MeshLambertMaterial({color: 0xffffff, toneMapped: false}),
    {map: null, alphaMap: null},
  )
  material.fog = false
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <shadowmap_pars_fragment>',
        (chunk) => `${chunk}
        #include <shadowmask_pars_fragment>`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        float facingLight = 1.0;
        #if NUM_DIR_LIGHTS > 0
          facingLight = 0.0;
          for ( int lightIndex = 0; lightIndex < NUM_DIR_LIGHTS; lightIndex ++ ) {
            vec3 lightDirection = normalize(directionalLights[lightIndex].direction);
            facingLight = max(
              facingLight,
              smoothstep(-0.05, 0.12, dot(normal, lightDirection))
            );
          }
        #endif
        float lit = min(getShadowMask(), facingLight);
        gl_FragColor = vec4(vec3(1.0 - lit), 1.0);
        `,
      )
      .replace('#include <tonemapping_fragment>', '')
      .replace('#include <colorspace_fragment>', '')
      .replace('#include <fog_fragment>', '')
      .replace('#include <premultiplied_alpha_fragment>', '')
      .replace('#include <dithering_fragment>', '')
  }
  return material
}

function usesMangaData(material: Surface) {
  return (
    material.visible &&
    material.colorWrite &&
    material.depthWrite &&
    !material.transparent &&
    !material.transmission &&
    !material.stencilWrite &&
    !('isShaderMaterial' in material) &&
    material.onBeforeCompile === Material.prototype.onBeforeCompile
  )
}

/**
 * 投影遮罩只看"有没有被挡住",不需要成片那种精细的 bias。低多边形/大尺度
 * 场景里原始 bias 往往偏小,法线方向的自遮挡会被整片判成阴影,网点就会爬满
 * 受光面。按 shadow map 的每纹素世界尺寸临时放大 normalBias/bias,渲染完还原。
 */
function withShadowMaskBias(scene: Scene, render: () => void) {
  const saved: {shadow: ShadowState; bias: number; normalBias: number}[] = []
  scene.traverse((node) => {
    const light = node as unknown as ShadowLight
    const shadow = light.shadow
    if (!light.isLight || !light.castShadow || !shadow) return
    const span = shadow.camera.isOrthographicCamera
      ? shadow.camera.right - shadow.camera.left
      : 10
    const texel = span / Math.max(1, shadow.mapSize.x)
    const depth = Math.max(1, shadow.camera.far - shadow.camera.near)
    saved.push({shadow, bias: shadow.bias, normalBias: shadow.normalBias})
    shadow.normalBias = Math.max(shadow.normalBias, texel * 2)
    shadow.bias = Math.min(shadow.bias, (-texel * 2) / depth)
  })
  try {
    render()
  } finally {
    for (const {shadow, bias, normalBias} of saved) {
      shadow.bias = bias
      shadow.normalBias = normalBias
    }
  }
}

function syncDataMaterial(data: DataMaterial, source: Surface) {
  const masked = source.alphaTest > 0 || source.alphaHash
  const map = masked ? source.map ?? null : null
  const alphaMap = masked ? source.alphaMap ?? null : null
  const displacementMap = source.displacementMap ?? null
  const vertexColors = masked && source.vertexColors
  const flatShading = source.flatShading ?? false
  const wireframe = source.wireframe ?? false
  if (
    data.map !== map ||
    data.alphaMap !== alphaMap ||
    data.displacementMap !== displacementMap ||
    data.vertexColors !== vertexColors ||
    data.flatShading !== flatShading ||
    data.side !== source.side ||
    data.alphaHash !== source.alphaHash ||
    data.wireframe !== wireframe
  ) {
    data.needsUpdate = true
  }
  data.map = map
  data.alphaMap = alphaMap
  data.alphaTest = source.alphaTest
  data.alphaHash = source.alphaHash
  data.vertexColors = vertexColors
  data.opacity = source.opacity
  data.side = source.side
  data.flatShading = flatShading
  data.wireframe = wireframe
  data.wireframeLinewidth = source.wireframeLinewidth ?? 1
  data.displacementMap = displacementMap
  data.displacementScale = source.displacementScale ?? 1
  data.displacementBias = source.displacementBias ?? 0
  data.clippingPlanes = source.clippingPlanes
  data.clipIntersection = source.clipIntersection
  data.depthTest = source.depthTest
  data.depthFunc = source.depthFunc
  data.polygonOffset = source.polygonOffset
  data.polygonOffsetFactor = source.polygonOffsetFactor
  data.polygonOffsetUnits = source.polygonOffsetUnits
}

function syncShadowMaskMaterial(data: ShadowMaskMaterial, source: Surface) {
  const masked = source.alphaTest > 0 || source.alphaHash
  const map = masked ? source.map ?? null : null
  const alphaMap = masked ? source.alphaMap ?? null : null
  const displacementMap = source.displacementMap ?? null
  const vertexColors = masked && source.vertexColors
  const flatShading = source.flatShading ?? false
  if (
    data.map !== map ||
    data.alphaMap !== alphaMap ||
    data.displacementMap !== displacementMap ||
    data.vertexColors !== vertexColors ||
    data.flatShading !== flatShading ||
    data.side !== source.side ||
    data.alphaHash !== source.alphaHash
  ) {
    data.needsUpdate = true
  }
  data.map = map
  data.alphaMap = alphaMap
  data.alphaTest = source.alphaTest
  data.alphaHash = source.alphaHash
  data.vertexColors = vertexColors
  data.flatShading = flatShading
  data.side = source.side
  data.displacementMap = displacementMap
  data.displacementScale = source.displacementScale ?? 1
  data.displacementBias = source.displacementBias ?? 0
  data.clippingPlanes = source.clippingPlanes
  data.clipIntersection = source.clipIntersection
}

const compositeFragment = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tNormals;
  uniform sampler2D tDepth;
  uniform sampler2D tShadow;
  uniform mat4 inverseProjection;
  uniform vec2 texel;
  uniform vec2 texelsPerCssPixel;
  uniform vec2 lineWidths;
  uniform vec2 thresholds;
  uniform bool castShadow;
  uniform float dotSpacing;

  vec3 viewPosition(vec2 uv, float depth) {
    vec4 view = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return view.xyz / view.w;
  }

  vec2 findEdge(vec2 sampleUv, vec4 center, vec3 normal, vec3 position) {
    sampleUv = clamp(sampleUv, 0.5 * texel, 1.0 - 0.5 * texel);
    vec4 neighbor = texture2D(tNormals, sampleUv);
    if (neighbor.a != center.a) return vec2(1.0, 0.0);
    if (center.a == 0.0) return vec2(0.0);

    vec3 otherNormal = normalize(neighbor.rgb * 2.0 - 1.0);
    vec3 otherPosition = viewPosition(sampleUv, texture2D(tDepth, sampleUv).r);
    vec3 delta = otherPosition - position;
    float scale = max(min(-position.z, -otherPosition.z), 0.01);
    float depthJump = abs(delta.z) / scale;
    float planeGap = min(abs(dot(delta, normal)), abs(dot(delta, otherNormal))) / scale;
    float depthEdge = smoothstep(thresholds.x, thresholds.x * 2.0, min(depthJump, planeGap));
    float crease = smoothstep(thresholds.y, thresholds.y * 1.5, 1.0 - dot(normal, otherNormal));
    return vec2(depthEdge, crease);
  }

  float screenShadow(float shadow) {
    float amount = clamp(shadow, 0.0, 1.0);
    vec2 cssPixel = vUv / (texel * texelsPerCssPixel);
    vec2 grid = mat2(0.9, 0.436, -0.436, 0.9) * cssPixel / dotSpacing;
    float distanceToDot = length(fract(grid) - 0.5);
    float smoothing = max(0.001, 0.5 * fwidth(distanceToDot));
    float radius = 0.36 * amount;
    return step(0.001, amount) *
      (1.0 - smoothstep(radius - smoothing, radius + smoothing, distanceToDot));
  }

  void main() {
    vec4 center = texture2D(tNormals, vUv);
    float depth = texture2D(tDepth, vUv).r;
    vec3 normal = normalize(center.rgb * 2.0 - 1.0);
    vec3 position = viewPosition(vUv, depth);
    float ink = 0.0;
    for (int axis = 0; axis < 2; axis++) {
      float scale = axis == 0 ? texelsPerCssPixel.x : texelsPerCssPixel.y;
      vec2 radii = 0.5 * lineWidths * scale;
      vec2 direction = axis == 0 ? vec2(texel.x, 0.0) : vec2(0.0, texel.y);
      for (int tap = 1; tap <= int(ceil(max(radii.x, radii.y))); tap++) {
        vec2 offset = direction * float(tap);
        vec2 weight = clamp(radii - float(tap - 1), 0.0, 1.0);
        vec2 edge = max(
          findEdge(vUv + offset, center, normal, position),
          findEdge(vUv - offset, center, normal, position)
        ) * weight;
        ink = max(ink, max(edge.x, edge.y));
      }
    }

    if (castShadow)
      ink = max(ink, center.a * screenShadow(texture2D(tShadow, vUv).r));
    gl_FragDepth = depth;
    gl_FragColor = vec4(vec3(1.0 - ink), 1.0);
    #include <colorspace_fragment>
  }
`

export function createMangaViewport() {
  const target = new WebGLRenderTarget(1, 1, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthTexture: new DepthTexture(1, 1),
  })
  target.texture.name = 'Manga view normals and coverage'
  const shadowTarget = new WebGLRenderTarget(1, 1, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
  })
  shadowTarget.texture.name = 'Manga cast shadow mask'
  const hidden = new Material()
  hidden.visible = false
  const variants = new Map<
    Material,
    {data: DataMaterial; dispose: () => void}
  >()
  const shadowVariants = new Map<
    Material,
    {data: ShadowMaskMaterial; dispose: () => void}
  >()
  const swaps: MaterialSwap[] = []
  const clearColor = new Color()
  const viewport = new Vector4()
  const pixelViewport = new Vector4()
  const uniforms = {
    tNormals: {value: target.texture},
    tDepth: {value: target.depthTexture},
    tShadow: {value: shadowTarget.texture},
    inverseProjection: {value: new Matrix4()},
    texel: {value: new Vector2()},
    texelsPerCssPixel: {value: new Vector2()},
    lineWidths: {value: new Vector2()},
    thresholds: {value: new Vector2()},
    castShadow: {value: false},
    dotSpacing: {value: mangaViewportDefaults.dotSpacing},
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  )
  const composite = new ShaderMaterial({
    uniforms,
    depthFunc: AlwaysDepth,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: compositeFragment,
  })
  const triangle = new Mesh(geometry, composite)
  triangle.frustumCulled = false
  const compositeScene = new Scene()
  compositeScene.add(triangle)
  const compositeCamera = new OrthographicCamera()

  function dataMaterial(source: Surface) {
    let variant = variants.get(source)
    if (!variant) {
      const data = makeDataMaterial()
      const dispose = () => {
        source.removeEventListener('dispose', dispose)
        variants.delete(source)
        data.dispose()
      }
      variant = {data, dispose}
      source.addEventListener('dispose', dispose)
      variants.set(source, variant)
    }
    syncDataMaterial(variant.data, source)
    return variant.data
  }

  function shadowMaskMaterial(source: Surface) {
    let variant = shadowVariants.get(source)
    if (!variant) {
      const data = makeShadowMaskMaterial()
      const dispose = () => {
        source.removeEventListener('dispose', dispose)
        shadowVariants.delete(source)
        data.dispose()
      }
      variant = {data, dispose}
      source.addEventListener('dispose', dispose)
      shadowVariants.set(source, variant)
    }
    syncShadowMaskMaterial(variant.data, source)
    return variant.data
  }

  function captureShadows(gl: WebGLRenderer, scene: Scene, camera: Camera) {
    const shadowSwaps: ShadowSwap[] = []
    withEditorOnlyHidden(() => {
      scene.traverseVisible((node: DrawObject) => {
        const original = node.material
        if (!node.isMesh || !original || !node.layers.test(camera.layers))
          return
        const source = Array.isArray(original) ? original : [original]
        if (source.every((material) => !material.visible)) return

        const receiving = source.map((material) =>
          usesMangaData(material) ? shadowMaskMaterial(material) : hidden,
        )
        const receivesShadow = receiving.some((material) => material !== hidden)
        const previousReceiveShadow = node.receiveShadow
        const previousCastShadow = node.castShadow
        node.castShadow = true
        if (receivesShadow) {
          node.material = Array.isArray(original) ? receiving : receiving[0]
          node.receiveShadow = true
        }
        if (receivesShadow || !previousCastShadow) {
          shadowSwaps.push({
            object: node,
            original,
            receiveShadow: previousReceiveShadow,
            castShadow: previousCastShadow,
          })
        }
      })
      try {
        withShadowMaskBias(scene, () => gl.render(scene, camera))
      } finally {
        for (const swap of shadowSwaps) {
          swap.object.material = swap.original
          swap.object.receiveShadow = swap.receiveShadow
          swap.object.castShadow = swap.castShadow
        }
      }
    })
  }

  function captureData(gl: WebGLRenderer, scene: Scene, camera: Camera) {
    let hasOverlays = false
    withEditorOnlyHidden(() => {
      scene.traverseVisible((node: DrawObject) => {
        const original = node.material
        if (!original || !node.layers.test(camera.layers)) return
        const source = Array.isArray(original) ? original : [original]
        const data = source.map((material) =>
          node.isMesh && usesMangaData(material)
            ? dataMaterial(material)
            : hidden,
        )
        const overlay = source.map((material, index) =>
          data[index] === hidden ? material : hidden,
        )
        hasOverlays ||= overlay.some((material) => material.visible)
        swaps.push({
          object: node,
          original,
          data: Array.isArray(original) ? data : data[0],
          overlay: Array.isArray(original) ? overlay : overlay[0],
        })
      })
      try {
        for (const swap of swaps) swap.object.material = swap.data
        gl.render(scene, camera)
      } finally {
        for (const swap of swaps) swap.object.material = swap.original
      }
    })
    return hasOverlays
  }

  function render(
    gl: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    size: {width: number; height: number},
    mode: ViewportRenderMode,
    options: MangaViewportOptions | undefined,
    showEditor: boolean,
  ) {
    gl.getCurrentViewport(pixelViewport)
    const width = pixelViewport.z
    const height = pixelViewport.w
    if (width < 1 || height < 1 || size.width <= 0 || size.height <= 0) return
    target.setSize(width, height)
    uniforms.texel.value.set(1 / width, 1 / height)
    uniforms.texelsPerCssPixel.value.set(
      width / size.width,
      height / size.height,
    )
    uniforms.lineWidths.value.set(
      Math.max(0, options?.outerWidth ?? mangaViewportDefaults.outerWidth),
      Math.max(0, options?.innerWidth ?? mangaViewportDefaults.innerWidth),
    )
    uniforms.thresholds.value.set(
      Math.max(
        0.00001,
        options?.depthThreshold ?? mangaViewportDefaults.depthThreshold,
      ),
      Math.max(
        0.00001,
        options?.normalThreshold ?? mangaViewportDefaults.normalThreshold,
      ),
    )
    const castShadow =
      mode !== 'original' &&
      (options?.castShadow ?? mangaViewportDefaults.castShadow)
    uniforms.castShadow.value = castShadow
    uniforms.dotSpacing.value = Math.max(
      2,
      options?.dotSpacing ?? mangaViewportDefaults.dotSpacing,
    )
    uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse)

    const output = gl.getRenderTarget()
    const cubeFace = gl.getActiveCubeFace()
    const mip = gl.getActiveMipmapLevel()
    gl.getViewport(viewport)
    const background = scene.background
    const clearAlpha = gl.getClearAlpha()
    gl.getClearColor(clearColor)
    const autoClear = gl.autoClear
    const shadowAutoUpdate = gl.shadowMap.autoUpdate
    const shadowNeedsUpdate = gl.shadowMap.needsUpdate
    try {
      scene.background = null
      gl.autoClear = false
      gl.shadowMap.autoUpdate = false
      gl.shadowMap.needsUpdate = false
      if (castShadow) {
        shadowTarget.setSize(width, height)
        gl.shadowMap.needsUpdate = true
        gl.setRenderTarget(shadowTarget)
        gl.setClearColor(0, 0)
        gl.clear(true, true, false)
        captureShadows(gl, scene, camera)
      }
      gl.setRenderTarget(target)
      gl.setClearColor(0, 0)
      gl.clear(true, true, false)
      const hasOverlays = captureData(gl, scene, camera)

      gl.setRenderTarget(output, cubeFace, mip)
      if (!output) gl.setViewport(viewport)
      gl.render(compositeScene, compositeCamera)

      if (showEditor || hasOverlays) {
        for (const swap of swaps) swap.object.material = swap.overlay
        if (showEditor) gl.render(scene, camera)
        else withEditorOnlyHidden(() => gl.render(scene, camera))
      }
    } finally {
      for (const swap of swaps) swap.object.material = swap.original
      swaps.length = 0
      if (gl.getRenderTarget() !== output) {
        gl.setRenderTarget(output, cubeFace, mip)
        if (!output) gl.setViewport(viewport)
      }
      gl.setClearColor(clearColor, clearAlpha)
      gl.autoClear = autoClear
      gl.shadowMap.autoUpdate = shadowAutoUpdate
      gl.shadowMap.needsUpdate = shadowNeedsUpdate
      scene.background = background
    }
  }

  return {
    render,
    dispose() {
      for (const variant of variants.values()) variant.dispose()
      for (const variant of shadowVariants.values()) variant.dispose()
      target.dispose()
      shadowTarget.dispose()
      hidden.dispose()
      composite.dispose()
      geometry.dispose()
    },
  }
}
