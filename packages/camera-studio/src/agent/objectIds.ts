/**
 * 带类型场景对象 ID(spec 8.4):`model:` / `camera:` / `anchor:` / `path:`
 * 前缀 + key。key 内可含额外冒号,解析只按第一个冒号分隔。
 */
import {AgentApiError} from './errors'
import type {SceneObjectId, SceneObjectKind} from './types'

const kinds = new Set<SceneObjectKind>(['model', 'camera', 'anchor', 'path'])

export function formatSceneObjectId(
  kind: SceneObjectKind,
  key: string,
): SceneObjectId {
  if (!key) throw new AgentApiError('INVALID_ARGUMENT', '对象 key 不能为空')
  return `${kind}:${key}`
}

export function parseSceneObjectId(id: string): {
  kind: SceneObjectKind
  key: string
} {
  const separator = id.indexOf(':')
  const kind = separator > 0 ? id.slice(0, separator) : ''
  const key = separator > 0 ? id.slice(separator + 1) : ''
  if (!kinds.has(kind as SceneObjectKind) || !key) {
    throw new AgentApiError('INVALID_ID_KIND', `无效场景对象 ID: ${id}`)
  }
  return {kind: kind as SceneObjectKind, key}
}
