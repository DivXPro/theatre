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
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three'
import type {
  Camera,
  DirectionalLight,
  MeshPhysicalMaterial,
  Object3D,
  WebGLRenderer,
} from 'three'
import {withEditorOnlyHidden} from './editorOnly'
import {
  createMangaPaperTexture,
  mangaPaperDotsPerHeight,
  mangaShadingPresets,
} from './mangaShading'
import type {MangaShadingPreset} from './mangaShading'

export type ViewportRenderMode = 'original' | 'line'

export interface MangaViewportOptions {
  outerWidth?: number
  innerWidth?: number
  depthThreshold?: number
  normalThreshold?: number
  /** 网点的最小间距（屏幕 CSS 像素） */
  dotSpacing?: number
  /** 是否将投射阴影加入漫画渲染 */
  castShadow?: boolean
  /** 按主光亮度选取网纸的预设 */
  shadingPreset?: MangaShadingPreset
}

export const mangaViewportDefaults: Required<MangaViewportOptions> = {
  outerWidth: 1.8,
  innerWidth: 0.95,
  depthThreshold: 0.003,
  normalThreshold: 0.13,
  dotSpacing: 2.8,
  castShadow: false,
  shadingPreset: 'light',
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
  Pick<MeshPhysicalMaterial, 'map' | 'alphaMap'> & {
    mangaCoverage: {value: number}
  }
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
    {map: null, alphaMap: null, mangaCoverage: {value: 1}},
  )
  material.onBeforeCompile = (shader) => {
    shader.uniforms.mangaCoverage = material.mangaCoverage
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
        'uniform float opacity;',
        'uniform float opacity;\nuniform float mangaCoverage;',
      )
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
      .replace('diffuseColor.a );', 'mangaCoverage );')
      .replace('gl_FragColor.a = 1.0;', 'gl_FragColor.a = mangaCoverage;')
  }
  return material
}

/**
 * 把场景渲染成"投影遮罩"数据贴图:1 = 处于投射阴影内,0 = 被照亮。
 *
 * 用 Lambert 是因为它原生包含法线/透明裁剪/骨骼变形等顶点链路,又带
 * shadowmap 采样;只把最终输出换掉,材质本身仍按真实光源与 shadow map
 * 计算 getShadowMask()。遮罩只反映真实的投射阴影,受光面与背光面保持
 * 纯白,网点只出现在被其他物体遮住的地方。
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
        gl_FragColor = vec4(vec3(1.0 - getShadowMask()), 1.0);
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
  data.mangaCoverage.value = source.userData.mangaShading === false ? 0.5 : 1
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
  uniform sampler2DArray tPaper;
  uniform mat4 inverseProjection;
  uniform vec2 texel;
  uniform vec2 texelsPerCssPixel;
  uniform vec2 lineWidths;
  uniform vec2 thresholds;
  uniform bool castShadow;
  uniform bool halftoneEnabled;
  uniform int halftoneSlots[6];
  uniform vec3 lightDirection;
  uniform float dotSpacing;

  vec3 viewPosition(vec2 uv, float depth) {
    vec4 view = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return view.xyz / view.w;
  }

  vec2 findEdge(vec2 sampleUv, vec4 center, vec3 normal, vec3 position) {
    sampleUv = clamp(sampleUv, 0.5 * texel, 1.0 - 0.5 * texel);
    vec4 neighbor = texture2D(tNormals, sampleUv);
    if ((neighbor.a == 0.0) != (center.a == 0.0)) return vec2(1.0, 0.0);
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
    if (amount < 0.01) return 0.0;
    vec2 cssPixel = vUv / (texel * texelsPerCssPixel);
    vec2 grid = mat2(0.7071, 0.7071, -0.7071, 0.7071) *
      cssPixel / dotSpacing;
    vec2 local = fract(grid) - 0.5;
    float distanceToDot = length(local);
    float smoothing = max(0.0005, 0.5 * fwidth(distanceToDot));
    float radius = 0.26 * sqrt(amount);
    return (
      1.0 - smoothstep(radius - smoothing, radius + smoothing, distanceToDot)
    );
  }

  float screenPaper(vec3 normal, float shadow) {
    float diffuse = dot(lightDirection, lightDirection) > 0.0
      ? dot(normal, lightDirection)
      : 1.0;
    float brightness = diffuse * (1.0 - 0.5 * shadow);
    int slot = 5 - int(clamp(floor(6.0 * brightness), 0.0, 5.0));

    vec2 cssSize = 1.0 / (texel * texelsPerCssPixel);
    float spacing = max(cssSize.y / ${mangaPaperDotsPerHeight}.0, dotSpacing);
    vec2 paperUV = mat2(0.7071, 0.7071, -0.7071, 0.7071) *
      (vUv * cssSize / spacing);
    return 1.0 - texture(tPaper, vec3(paperUV, float(halftoneSlots[slot]))).r;
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

    float shadow = castShadow ? texture2D(tShadow, vUv).r : 0.0;
    float shading = halftoneEnabled
      ? screenPaper(normal, shadow)
      : (castShadow ? screenShadow(shadow) : 0.0);
    ink = max(ink, step(0.75, center.a) * shading);
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
  const paperTexture = createMangaPaperTexture()
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
  const lightTarget = new Vector3()
  const uniforms = {
    tNormals: {value: target.texture},
    tDepth: {value: target.depthTexture},
    tShadow: {value: shadowTarget.texture},
    tPaper: {value: paperTexture},
    inverseProjection: {value: new Matrix4()},
    texel: {value: new Vector2()},
    texelsPerCssPixel: {value: new Vector2()},
    lineWidths: {value: new Vector2()},
    thresholds: {value: new Vector2()},
    castShadow: {value: false},
    halftoneEnabled: {value: false},
    halftoneSlots: {value: new Int32Array(6)},
    lightDirection: {value: new Vector3()},
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
    let keyLight: DirectionalLight | undefined
    withEditorOnlyHidden(() => {
      scene.traverseVisible((node: DrawObject) => {
        if (!node.layers.test(camera.layers)) return
        const light = node as unknown as DirectionalLight
        if (
          uniforms.halftoneEnabled.value &&
          !keyLight &&
          light.isDirectionalLight &&
          light.intensity > 0
        ) {
          keyLight = light
        }
        const original = node.material
        if (!original) return
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
    const direction = uniforms.lightDirection.value
    direction.set(0, 0, 0)
    if (keyLight) {
      direction
        .setFromMatrixPosition(keyLight.matrixWorld)
        .sub(lightTarget.setFromMatrixPosition(keyLight.target.matrixWorld))
        .transformDirection(camera.matrixWorldInverse)
    }
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
    const shadingPreset =
      options?.shadingPreset ?? mangaViewportDefaults.shadingPreset
    const slots = Object.hasOwn(mangaShadingPresets, shadingPreset)
      ? mangaShadingPresets[shadingPreset]
      : undefined
    uniforms.halftoneEnabled.value =
      mode !== 'original' && slots !== undefined && shadingPreset !== 'off'
    if (slots && uniforms.halftoneEnabled.value) {
      uniforms.halftoneSlots.value.set(slots)
    }
    uniforms.dotSpacing.value = Math.max(
      1.2,
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
      paperTexture.dispose()
      hidden.dispose()
      composite.dispose()
      geometry.dispose()
    },
  }
}
