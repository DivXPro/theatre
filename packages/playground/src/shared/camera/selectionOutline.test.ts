/**
 * 选中轮廓线(Blender 式)的可测逻辑:withOutlineLayer 在蒙版 pass 期间
 * 把目标子树的网格临时开进描边层,结束后逐个还原。
 * 渲染本体(RT/着色器)依赖 WebGL,在浏览器实测里验证。
 */
import {BoxGeometry, Group, Mesh, MeshBasicMaterial} from 'three'
import {
  OUTLINE_LAYER,
  SELECTION_OUTLINE_COLOR,
  withOutlineLayer,
} from './selectionOutline'

function meshUnder(root: Group, name: string): Mesh {
  const m = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  m.name = name
  root.add(m)
  return m
}

test('蒙版 pass 期间子树网格全部开描边层,非网格不动', () => {
  const root = new Group()
  const a = meshUnder(root, 'a')
  const inner = new Group()
  root.add(inner)
  const b = meshUnder(inner, 'b')
  const innerMask = inner.layers.mask

  withOutlineLayer(root, () => {
    expect(a.layers.test(maskOf(OUTLINE_LAYER))).toBe(true)
    expect(b.layers.test(maskOf(OUTLINE_LAYER))).toBe(true)
    // 纯分组不是可渲染网格,不该被动
    expect(inner.layers.mask).toBe(innerMask)
  })
})

test('结束后还原每个对象的原始 layers(原本就在描边层的保持开)', () => {
  const root = new Group()
  const a = meshUnder(root, 'a')
  const b = meshUnder(root, 'b')
  b.layers.enable(OUTLINE_LAYER) // 本来就开着
  const maskA = a.layers.mask
  const maskB = b.layers.mask

  withOutlineLayer(root, () => {})

  expect(a.layers.mask).toBe(maskA)
  expect(b.layers.mask).toBe(maskB)
})

test('fn 抛错也照样还原(finally 语义)', () => {
  const root = new Group()
  const a = meshUnder(root, 'a')
  const maskA = a.layers.mask
  expect(() =>
    withOutlineLayer(root, () => {
      throw new Error('boom')
    }),
  ).toThrow('boom')
  expect(a.layers.mask).toBe(maskA)
})

test('返回值透传', () => {
  const root = new Group()
  expect(withOutlineLayer(root, () => 42)).toBe(42)
})

test('选中橙保持 Blender 橙', () => {
  expect(SELECTION_OUTLINE_COLOR).toBe(0xffb020)
})

function maskOf(layer: number) {
  // three 的 Layers.test 需要一个 Layers 实例;这里用 bit 对象的掩码形式
  return {mask: 1 << layer} as never
}
