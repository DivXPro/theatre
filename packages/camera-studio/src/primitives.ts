import {
  BoxGeometry,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from 'three'

export type PrimitiveKind = 'plane' | 'box' | 'sphere' | 'cylinder'
export const PRIMITIVE_KINDS = ['plane', 'box', 'sphere', 'cylinder'] as const

export function createPrimitive(kind: PrimitiveKind): Mesh {
  const geometry = {
    plane: () => new PlaneGeometry(2, 2),
    box: () => new BoxGeometry(1, 1, 1),
    sphere: () => new SphereGeometry(0.5, 32, 16),
    cylinder: () => new CylinderGeometry(0.5, 0.5, 1, 32),
  }[kind]()
  const mesh = new Mesh(geometry, new MeshStandardMaterial({color: '#b8b8b8'}))
  mesh.name = `Primitive/${kind}`
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
