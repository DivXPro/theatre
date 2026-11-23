import {
  AlwaysDepth,
  BufferAttribute,
  BufferGeometry,
  Color,
  DepthTexture,
  Material,
  Matrix4,
  Mesh,
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
import type {Camera, MeshPhysicalMaterial, Object3D, WebGLRenderer} from 'three'
import {withEditorOnlyHidden} from './editorOnly'

export type ViewportRenderMode = 'original' | 'line' | 'halftone'

export interface MangaViewportOptions {
  outerWidth?: number
  innerWidth?: number
  depthThreshold?: number
  normalThreshold?: number
  dotSpacing?: number
  lightDirection?: readonly [number, number, number]
}

export const mangaViewportDefaults: Required<MangaViewportOptions> = {
  outerWidth: 1.8,
  innerWidth: 0.95,
  depthThreshold: 0.003,
  normalThreshold: 0.13,
  dotSpacing: 4.8,
  lightDirection: [-0.42, 0.6, 0.7],
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

const compositeFragment = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tNormals;
  uniform sampler2D tDepth;
  uniform mat4 inverseProjection;
  uniform vec2 texel;
  uniform vec2 texelsPerCssPixel;
  uniform vec2 lineWidths;
  uniform vec2 thresholds;
  uniform bool halftone;
  uniform float dotSpacing;
  uniform vec3 lightDirection;

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

  float screenInk(vec3 normal) {
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float radius = diffuse >= 0.72 ? 0.0 : diffuse >= 0.42 ? 0.19 : 0.35;
    vec2 cssPixel = vUv / (texel * texelsPerCssPixel);
    vec2 grid = mat2(0.9, 0.436, -0.436, 0.9) * cssPixel / dotSpacing;
    float distanceToDot = length(fract(grid) - 0.5);
    float smoothing = max(0.001, 0.5 * fwidth(distanceToDot));
    return step(0.01, radius) *
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

    if (halftone) ink = max(ink, center.a * screenInk(normal));
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
  const hidden = new Material()
  hidden.visible = false
  const variants = new Map<
    Material,
    {data: DataMaterial; dispose: () => void}
  >()
  const swaps: MaterialSwap[] = []
  const clearColor = new Color()
  const viewport = new Vector4()
  const pixelViewport = new Vector4()
  const uniforms = {
    tNormals: {value: target.texture},
    tDepth: {value: target.depthTexture},
    inverseProjection: {value: new Matrix4()},
    texel: {value: new Vector2()},
    texelsPerCssPixel: {value: new Vector2()},
    lineWidths: {value: new Vector2()},
    thresholds: {value: new Vector2()},
    halftone: {value: false},
    dotSpacing: {value: mangaViewportDefaults.dotSpacing},
    lightDirection: {value: new Vector3()},
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
    uniforms.halftone.value = mode === 'halftone'
    uniforms.dotSpacing.value = Math.max(
      2,
      options?.dotSpacing ?? mangaViewportDefaults.dotSpacing,
    )
    const light = uniforms.lightDirection.value
    light.set(
      ...(options?.lightDirection ?? mangaViewportDefaults.lightDirection),
    )
    if (light.lengthSq() === 0)
      light.set(...mangaViewportDefaults.lightDirection)
    light.normalize()
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
      target.dispose()
      hidden.dispose()
      composite.dispose()
      geometry.dispose()
    },
  }
}
