import {Quaternion} from 'three'

export type ActionEditorXYZ = Readonly<{x: number; y: number; z: number}>
export type ActionEditorQuaternion = ActionEditorXYZ & Readonly<{w: number}>
export type ActionEditorBoneTransform = Readonly<{
  position: ActionEditorXYZ
  quaternion: ActionEditorQuaternion
  scale: ActionEditorXYZ
}>
export type ActionEditorObjectValues = Readonly<{
  position?: ActionEditorXYZ
  quaternion?: ActionEditorQuaternion
  scale?: ActionEditorXYZ
}>
export type ActionEditorValues = Readonly<{
  object: ActionEditorObjectValues
  bones: Readonly<Partial<Record<string, ActionEditorBoneTransform>>>
}>
export type ActionEditorKey<
  Value = ActionEditorXYZ | ActionEditorQuaternion | ActionEditorBoneTransform,
> = Readonly<{id: string; timeMs: number; value: Value}>
export type ActionEditorChannel =
  | Readonly<{
      kind: 'position' | 'scale'
      keys: readonly ActionEditorKey<ActionEditorXYZ>[]
    }>
  | Readonly<{
      kind: 'quaternion'
      keys: readonly ActionEditorKey<ActionEditorQuaternion>[]
    }>
  | Readonly<{
      kind: 'bone'
      boneName: string
      keys: readonly ActionEditorKey<ActionEditorBoneTransform>[]
    }>
export type ActionEditorObjectChannel = Exclude<
  ActionEditorChannel['kind'],
  'bone'
>
export type ActionEditorChannelRef =
  | Readonly<{kind: ActionEditorObjectChannel}>
  | Readonly<{kind: 'bone'; boneName: string}>
export type ActionEditorKeyRef = ActionEditorChannelRef &
  Readonly<{keyId: string}>

export function channelId(channel: ActionEditorChannelRef): string {
  return channel.kind === 'bone' ? `bone:${channel.boneName}` : channel.kind
}

export function sameKeyTime(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.000001
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isXYZ(value: unknown): value is ActionEditorXYZ {
  return (
    isRecord(value) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  )
}

export function isQuaternion(value: unknown): value is ActionEditorQuaternion {
  if (!isRecord(value)) return false
  const {w} = value
  if (typeof w !== 'number' || !Number.isFinite(w) || !isXYZ(value))
    return false
  const length = Math.hypot(value.x, value.y, value.z, w)
  return Number.isFinite(length) && length > 0
}

export function isBoneTransform(
  value: unknown,
): value is ActionEditorBoneTransform {
  return (
    isRecord(value) &&
    isXYZ(value.position) &&
    isQuaternion(value.quaternion) &&
    isXYZ(value.scale)
  )
}

export function isActionEditorChannels(
  value: unknown,
  durationMs = Infinity,
): value is ActionEditorChannel[] {
  if (!Array.isArray(value) || !(durationMs >= 0)) return false
  const channelIds = new Set<string>()
  for (const channel of value) {
    if (
      !isRecord(channel) ||
      !Array.isArray(channel.keys) ||
      !channel.keys.length
    )
      return false
    let id: string
    let validValue: (value: unknown) => boolean
    switch (channel.kind) {
      case 'position':
      case 'scale':
        id = channel.kind
        validValue = isXYZ
        break
      case 'quaternion':
        id = channel.kind
        validValue = isQuaternion
        break
      case 'bone':
        if (typeof channel.boneName !== 'string' || !channel.boneName)
          return false
        id = `bone:${channel.boneName}`
        validValue = isBoneTransform
        break
      default:
        return false
    }
    if (channelIds.has(id)) return false
    channelIds.add(id)
    const keyIds = new Set<string>()
    const times: number[] = []
    for (const key of channel.keys) {
      if (
        !isRecord(key) ||
        typeof key.id !== 'string' ||
        !key.id ||
        keyIds.has(key.id) ||
        typeof key.timeMs !== 'number' ||
        !Number.isFinite(key.timeMs) ||
        key.timeMs < 0 ||
        key.timeMs > durationMs ||
        !validValue(key.value)
      ) {
        return false
      }
      keyIds.add(key.id)
      times.push(key.timeMs)
    }
    times.sort((left, right) => left - right)
    if (
      times.some(
        (time, index) => index > 0 && sameKeyTime(time, times[index - 1]),
      )
    )
      return false
  }
  return true
}

export function copyXYZ({x, y, z}: ActionEditorXYZ): ActionEditorXYZ {
  return {x, y, z}
}

export function copyQuaternion({
  x,
  y,
  z,
  w,
}: ActionEditorQuaternion): ActionEditorQuaternion {
  const length = Math.hypot(x, y, z, w)
  return {x: x / length, y: y / length, z: z / length, w: w / length}
}

export function copyBone({
  position,
  quaternion,
  scale,
}: ActionEditorBoneTransform): ActionEditorBoneTransform {
  return {
    position: copyXYZ(position),
    quaternion: copyQuaternion(quaternion),
    scale: copyXYZ(scale),
  }
}

export function copyChannel(channel: ActionEditorChannel): ActionEditorChannel {
  function copyKeys<Value>(
    keys: readonly ActionEditorKey<Value>[],
    copy: (value: Value) => Value,
  ) {
    return keys
      .map(({id, timeMs, value}) => ({id, timeMs, value: copy(value)}))
      .sort((left, right) => left.timeMs - right.timeMs)
  }

  switch (channel.kind) {
    case 'bone':
      return {...channel, keys: copyKeys(channel.keys, copyBone)}
    case 'quaternion':
      return {...channel, keys: copyKeys(channel.keys, copyQuaternion)}
    default:
      return {...channel, keys: copyKeys(channel.keys, copyXYZ)}
  }
}

function lerpXYZ(
  left: ActionEditorXYZ,
  right: ActionEditorXYZ,
  weight: number,
): ActionEditorXYZ {
  const previous = 1 - weight
  return {
    x: left.x * previous + right.x * weight,
    y: left.y * previous + right.y * weight,
    z: left.z * previous + right.z * weight,
  }
}

function slerpQuaternion(
  left: ActionEditorQuaternion,
  right: ActionEditorQuaternion,
  weight: number,
): ActionEditorQuaternion {
  const from = copyQuaternion(left)
  const to = copyQuaternion(right)
  const result = new Quaternion(from.x, from.y, from.z, from.w).slerp(
    new Quaternion(to.x, to.y, to.z, to.w),
    weight,
  )
  return copyQuaternion(result)
}

function sampleKeys<Value>(
  keys: readonly ActionEditorKey<Value>[],
  timeMs: number,
  copy: (value: Value) => Value,
  interpolate: (left: Value, right: Value, weight: number) => Value,
): Value | undefined {
  let left: ActionEditorKey<Value> | undefined
  let right: ActionEditorKey<Value> | undefined
  for (const key of keys) {
    if (key.timeMs === timeMs) return copy(key.value)
    if (key.timeMs <= timeMs && (!left || key.timeMs > left.timeMs)) left = key
    if (key.timeMs >= timeMs && (!right || key.timeMs < right.timeMs))
      right = key
  }
  if (!left) return right && copy(right.value)
  if (!right) return copy(left.value)
  return interpolate(
    left.value,
    right.value,
    (timeMs - left.timeMs) / (right.timeMs - left.timeMs),
  )
}

export function sampleActionEditorChannels(
  channels: readonly ActionEditorChannel[],
  timeMs: number,
): ActionEditorValues {
  const object: {
    position?: ActionEditorXYZ
    quaternion?: ActionEditorQuaternion
    scale?: ActionEditorXYZ
  } = {}
  const bones = new Map<string, ActionEditorBoneTransform>()
  for (const channel of channels) {
    if (channel.kind === 'bone') {
      const value = sampleKeys(
        channel.keys,
        timeMs,
        copyBone,
        (left, right, weight) => ({
          position: lerpXYZ(left.position, right.position, weight),
          quaternion: slerpQuaternion(
            left.quaternion,
            right.quaternion,
            weight,
          ),
          scale: lerpXYZ(left.scale, right.scale, weight),
        }),
      )
      if (value) bones.set(channel.boneName, value)
    } else if (channel.kind === 'quaternion') {
      const value = sampleKeys(
        channel.keys,
        timeMs,
        copyQuaternion,
        slerpQuaternion,
      )
      if (value) object.quaternion = value
    } else {
      const value = sampleKeys(channel.keys, timeMs, copyXYZ, lerpXYZ)
      if (value) object[channel.kind] = value
    }
  }
  return {object, bones: Object.fromEntries(bones)}
}
