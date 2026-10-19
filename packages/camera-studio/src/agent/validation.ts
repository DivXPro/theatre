/**
 * Agent 命令参数校验复用器(2026-10-17):所有领域命令的 validate
 * 都组合这些函数,统一抛 `INVALID_ARGUMENT`(spec 第 12 节)。
 */
import {AgentApiError} from './errors'
import type {Vec3} from './types'

export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentApiError('INVALID_ARGUMENT', '参数必须是对象')
  }
  return value as Record<string, unknown>
}

export function requireString(
  object: Record<string, unknown>,
  key: string,
): string {
  const value = object[key]
  if (typeof value !== 'string' || !value) {
    throw new AgentApiError('INVALID_ARGUMENT', `${key} 必须是非空字符串`)
  }
  return value
}

export function requireBoolean(
  object: Record<string, unknown>,
  key: string,
): boolean {
  const value = object[key]
  if (typeof value !== 'boolean') {
    throw new AgentApiError('INVALID_ARGUMENT', `${key} 必须是布尔值`)
  }
  return value
}

export function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AgentApiError('INVALID_ARGUMENT', `${label} 必须是有限数字`)
  }
  return value
}

export function requireVec3(value: unknown, label = 'position'): Vec3 {
  const object = requireObject(value)
  return {
    x: requireFiniteNumber(object.x, `${label}.x`),
    y: requireFiniteNumber(object.y, `${label}.y`),
    z: requireFiniteNumber(object.z, `${label}.z`),
  }
}
