import {
  BoxGeometry,
  CylinderGeometry,
  PlaneGeometry,
  SphereGeometry,
} from 'three'
import {createPrimitive} from './primitives'

test('creates the four metric primitive kinds', () => {
  expect(createPrimitive('plane').geometry).toBeInstanceOf(PlaneGeometry)
  expect(createPrimitive('box').geometry).toBeInstanceOf(BoxGeometry)
  expect(createPrimitive('sphere').geometry).toBeInstanceOf(SphereGeometry)
  expect(createPrimitive('cylinder').geometry).toBeInstanceOf(CylinderGeometry)
})

test('uses the specified metric dimensions and tessellation', () => {
  const plane = createPrimitive('plane').geometry as PlaneGeometry
  const box = createPrimitive('box').geometry as BoxGeometry
  const sphere = createPrimitive('sphere').geometry as SphereGeometry
  const cylinder = createPrimitive('cylinder').geometry as CylinderGeometry
  expect(plane.parameters).toMatchObject({width: 2, height: 2})
  expect(box.parameters).toMatchObject({width: 1, height: 1, depth: 1})
  expect(sphere.parameters).toMatchObject({
    radius: 0.5,
    widthSegments: 32,
    heightSegments: 16,
  })
  expect(cylinder.parameters).toMatchObject({
    radiusTop: 0.5,
    radiusBottom: 0.5,
    height: 1,
    radialSegments: 32,
  })
})
