import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three'
import {AgentApiError} from '../errors'
import type {JsonSchema, Vec3} from '../types'
import {
  requireFiniteNumber,
  requireObject,
  requireString,
  requireVec3,
} from '../validation'

/** 一个静态三角网格，局部变换相对模型原点。 */
export type GeneratedModelMesh = {
  name?: string
  positions: number[]
  indices?: number[]
  color?: string
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
}

export type SaveModelArgs = {name: string; meshes: GeneratedModelMesh[]}

const vectorSchema: JsonSchema = {
  type: 'object',
  properties: {x: {type: 'number'}, y: {type: 'number'}, z: {type: 'number'}},
  required: ['x', 'y', 'z'],
  additionalProperties: false,
}

export const saveModelInput: JsonSchema = {
  type: 'object',
  properties: {
    name: {type: 'string', description: '模型资产名称'},
    meshes: {
      type: 'array',
      description: '组成同一资产的一个或多个静态三角网格',
      items: {
        type: 'object',
        properties: {
          name: {type: 'string'},
          positions: {
            type: 'array',
            items: {type: 'number'},
            description: '以米为单位的平铺 XYZ 顶点坐标',
          },
          indices: {
            type: 'array',
            items: {type: 'integer'},
            description:
              '每三个从零开始的顶点索引组成一个三角面；省略时按顶点顺序组面',
          },
          color: {type: 'string', description: '材质颜色 #RRGGBB'},
          position: {
            ...vectorSchema,
            description: '相对模型原点的偏移，单位为米',
          },
          rotation: {...vectorSchema, description: 'XYZ 欧拉角，单位为弧度'},
          scale: vectorSchema,
        },
        required: ['positions'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'meshes'],
  additionalProperties: false,
}

export function validateSaveModel(value: unknown): SaveModelArgs {
  const args = requireObject(value)
  const name = requireString(args, 'name').trim()
  if (!name)
    throw new AgentApiError('INVALID_ARGUMENT', 'name 必须是非空字符串')
  if (!Array.isArray(args.meshes) || args.meshes.length === 0) {
    throw new AgentApiError('INVALID_ARGUMENT', 'meshes 至少需要一个三角网格')
  }
  return {name, meshes: Array.from(args.meshes, validateMesh)}
}

function validateMesh(value: unknown, meshIndex: number): GeneratedModelMesh {
  const mesh = requireObject(value)
  const label = `meshes[${meshIndex}]`
  const {positions, indices, color, position, rotation, scale} = mesh
  if (
    !Array.isArray(positions) ||
    positions.length < 9 ||
    positions.length % (indices === undefined ? 9 : 3) !== 0
  ) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      `${label}.positions 必须包含完整 XYZ 坐标，且至少能构成一个三角面`,
    )
  }
  const vertices = Array.from(positions, (coordinate, index) => {
    const key = `${label}.positions[${index}]`
    const number = requireFiniteNumber(coordinate, key)
    if (!Number.isFinite(Math.fround(number))) {
      throw new AgentApiError('INVALID_ARGUMENT', `${key} 超出 Float32 范围`)
    }
    return number
  })
  if (
    color !== undefined &&
    (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))
  ) {
    throw new AgentApiError('INVALID_ARGUMENT', `${label}.color 必须是 #RRGGBB`)
  }
  return {
    name: mesh.name === undefined ? undefined : requireString(mesh, 'name'),
    positions: vertices,
    indices:
      indices === undefined
        ? undefined
        : validateIndices(indices, vertices.length / 3, label),
    color,
    position:
      position === undefined
        ? undefined
        : requireVec3(position, `${label}.position`),
    rotation:
      rotation === undefined
        ? undefined
        : requireVec3(rotation, `${label}.rotation`),
    scale:
      scale === undefined ? undefined : requireVec3(scale, `${label}.scale`),
  }
}

function validateIndices(
  value: unknown,
  vertexCount: number,
  label: string,
): number[] {
  if (!Array.isArray(value) || value.length < 3 || value.length % 3 !== 0) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      `${label}.indices 必须包含完整三角面`,
    )
  }
  return Array.from(value, (value, index) => {
    const key = `${label}.indices[${index}]`
    const vertex = requireFiniteNumber(value, key)
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount) {
      throw new AgentApiError('INVALID_ARGUMENT', `${key} 必须指向已有顶点`)
    }
    return vertex
  })
}

export function buildGeneratedModel(meshes: GeneratedModelMesh[]): Group {
  const root = new Group()
  for (const {
    name,
    positions,
    indices,
    color,
    position,
    rotation,
    scale,
  } of meshes) {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    if (indices) geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({color: color ?? '#b8b8b8'}),
    )
    if (name !== undefined) mesh.name = name
    if (position) mesh.position.copy(position)
    if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z)
    if (scale) mesh.scale.copy(scale)
    root.add(mesh)
  }
  return root
}
