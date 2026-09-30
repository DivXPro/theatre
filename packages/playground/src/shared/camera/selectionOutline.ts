/**
 * 选中轮廓线(Blender 式):不往场景里挂任何辅助网格,屏幕空间画剪影描边。
 *
 * 原理(与 Blender 的选中描边同思路):
 * 1) 蒙版 pass:场景画成纯黑(写深度),选中物画成纯白,得到"可见剪影"
 *    蒙版——整个选中物是一张联合蒙版,所以只有外剪影有边,绝不会有内部线;
 *    被其他物体挡住的部分不进蒙版,描边只落在看得见的部分(同 Blender);
 *    蒙皮网格走正常渲染管线,骨骼动画/姿势播放时剪影跟着变形。
 * 2) 合成 pass:全屏着色器在蒙版外圈 uThicknessPx 像素内画橙色边,
 *    宽度按物理像素恒定,与距离无关。
 *
 * 两步都在 useFrame 回调里同步完成,不往场景树加任何节点,选中物零侵入。
 */
import {
  BufferGeometry,
  BufferAttribute,
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
} from 'three'
import type {Camera, Object3D, WebGLRenderer} from 'three'
import {withEditorOnlyHidden} from './editorOnly'

/** 选中高亮橙:与锚点/相机视锥的选中色一致(Blender 式选中橙) */
export const SELECTION_OUTLINE_COLOR = 0xffb020

/** 描边宽度(CSS 像素,合成时乘 dpr 换算物理像素) */
const DEFAULT_THICKNESS_PX = 4

/** 蒙版 pass 用的临时图层:只把选中物画进蒙版,不动对象常驻层 */
export const OUTLINE_LAYER = 7

/**
 * 把 node 下所有网格临时开进 OUTLINE_LAYER,fn 结束后逐个还原。
 * 只动网格(可渲染物),分组/骨骼等纯节点保持原样。
 */
export function withOutlineLayer<T>(node: Object3D, fn: () => T): T {
  const touched: Array<{obj: Object3D; mask: number}> = []
  node.traverse((child) => {
    if ((child as Mesh).isMesh) {
      touched.push({obj: child, mask: child.layers.mask})
      child.layers.enable(OUTLINE_LAYER)
    }
  })
  try {
    return fn()
  } finally {
    for (const {obj, mask} of touched) obj.layers.mask = mask
  }
}

export type OutlineSize = {width: number; height: number}

export type SelectionOutlineRenderer = {
  /**
   * 在当前帧的渲染结果上叠加选中描边。调用时机:主视角场景画完之后、
   * 画中画之前(调用方的 useFrame 优先级管这件事)。
   */
  render: (
    gl: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    node: Object3D,
    size: OutlineSize,
    dpr: number,
    thicknessPx?: number,
  ) => void
  dispose: () => void
}

/** 全屏三角形:比 Quad 少一次顶点插值,后处理通行做法 */
function makeFullscreenTriangle(): BufferGeometry {
  const geo = new BufferGeometry()
  geo.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  )
  geo.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2),
  )
  return geo
}

const OUTLINE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tMask;
  uniform vec2 uResolution; // 蒙版物理像素尺寸
  uniform float uThicknessPx; // 描边宽(物理像素)
  uniform vec3 uColor;

  void main() {
    // 蒙版内部(物体本体)不画:描边只出现在剪影外圈
    if (texture2D(tMask, vUv).r > 0.5) discard;

    // 环采一周:半径 uThicknessPx 内有蒙版像素 → 在描边带上。
    // 命中比例直接当 alpha:剪影处约半圈命中,向外渐隐,自带抗锯齿。
    vec2 radius = uThicknessPx / uResolution;
    const int TAPS = 12;
    float acc = 0.0;
    for (int i = 0; i < TAPS; i++) {
      float a = float(i) * 6.2831853 / float(TAPS);
      vec2 off = vec2(cos(a), sin(a)) * radius;
      acc += step(0.5, texture2D(tMask, vUv + off).r);
    }
    float alpha = acc / float(TAPS);
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`

const OUTLINE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/**
 * 持有蒙版 RT 与合成着色器的描边渲染器。一个选中态一个实例,
 * 卸载时 dispose(跟随 SelectionOutlineHighlight 的生命周期)。
 */
export function createSelectionOutlineRenderer(): SelectionOutlineRenderer {
  // 蒙版 RT:只要 r 通道够不够,RGBA8 最省;深度必须开(遮挡裁剪靠它)
  const maskRT = new WebGLRenderTarget(1, 1, {depthBuffer: true})

  // 蒙版材质:纯色、不吃雾、不吃色调映射,保证白是 1.0、黑是 0.0
  const blackMat = new MeshBasicMaterial({color: 0x000000})
  blackMat.fog = false
  blackMat.toneMapped = false
  const whiteMat = new MeshBasicMaterial({color: 0xffffff})
  whiteMat.fog = false
  whiteMat.toneMapped = false

  const outlineMat = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tMask: {value: maskRT.texture},
      uResolution: {value: {x: 1, y: 1} as any},
      uThicknessPx: {value: DEFAULT_THICKNESS_PX},
      // ShaderMaterial 的输出不经过 three 的色彩空间转换,片元直写画布;
      // 所以这里直接给画布的 sRGB 值(0xffb020),不走 Color 的线性换算
      uColor: {value: new Vector3(1.0, 176 / 255, 32 / 255)},
    },
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
  })
  const quad = new Mesh(makeFullscreenTriangle(), outlineMat)
  quad.frustumCulled = false
  const quadScene = new Scene()
  quadScene.add(quad)
  const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const clearColorBackup = new Color()

  function render(
    gl: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    node: Object3D,
    size: OutlineSize,
    dpr: number,
    thicknessPx: number = DEFAULT_THICKNESS_PX,
  ) {
    const w = Math.max(1, Math.round(size.width * dpr))
    const h = Math.max(1, Math.round(size.height * dpr))
    if (maskRT.width !== w || maskRT.height !== h) maskRT.setSize(w, h)
    ;(outlineMat.uniforms.uResolution.value as {x: number; y: number}).x = w
    ;(outlineMat.uniforms.uResolution.value as {x: number; y: number}).y = h
    outlineMat.uniforms.uThicknessPx.value = thicknessPx * dpr

    // 保存现场:渲染目标/清屏色/autoClear/场景背景与覆盖材质/相机层
    const prevRT = gl.getRenderTarget()
    const prevAutoClear = gl.autoClear
    gl.getClearColor(clearColorBackup)
    const prevClearAlpha = gl.getClearAlpha()
    const prevBackground = scene.background
    const prevOverride = scene.overrideMaterial
    const prevCamLayers = camera.layers.mask

    try {
      gl.setRenderTarget(maskRT)
      gl.setClearColor(0x000000, 1)
      gl.clear(true, true, false)
      gl.autoClear = false
      scene.background = null

      // pass 1:全场景画黑并把深度写进蒙版 RT——被挡住的选中物部分
      // 在 pass 2 里会被深度裁掉,描边只描看得见的剪影(同 Blender)。
      // 编辑辅助对象(网格地面/手柄/视锥线)藏起来,不当遮挡物。
      scene.overrideMaterial = blackMat
      withEditorOnlyHidden(() => gl.render(scene, camera))

      // pass 2:同一 RT 上只画选中物(白),深度沿用 pass 1 的场景深度
      scene.overrideMaterial = whiteMat
      camera.layers.set(OUTLINE_LAYER)
      try {
        withOutlineLayer(node, () => gl.render(scene, camera))
      } finally {
        camera.layers.mask = prevCamLayers
      }

      // 合成:蒙版外圈画橙色边,直写当前帧缓冲(叠在主视角画面上)
      gl.setRenderTarget(prevRT)
      gl.render(quadScene, quadCam)
    } finally {
      scene.background = prevBackground
      scene.overrideMaterial = prevOverride
      camera.layers.mask = prevCamLayers
      gl.setRenderTarget(prevRT)
      gl.setClearColor(clearColorBackup, prevClearAlpha)
      gl.autoClear = prevAutoClear
    }
  }

  function dispose() {
    maskRT.dispose()
    blackMat.dispose()
    whiteMat.dispose()
    outlineMat.dispose()
    quad.geometry.dispose()
  }

  return {render, dispose}
}
