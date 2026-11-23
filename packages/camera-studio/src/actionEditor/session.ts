import {
  channelId,
  copyBone,
  copyChannel,
  copyQuaternion,
  copyXYZ,
  isActionEditorChannels,
  isBoneTransform,
  isQuaternion,
  isXYZ,
  sameKeyTime,
  sampleActionEditorChannels,
  type ActionEditorBoneTransform,
  type ActionEditorChannel,
  type ActionEditorChannelRef,
  type ActionEditorKey,
  type ActionEditorKeyRef,
  type ActionEditorObjectChannel,
  type ActionEditorQuaternion,
  type ActionEditorValues,
  type ActionEditorXYZ,
} from './keys'

export {isActionEditorChannels, sampleActionEditorChannels}
export type {ActionEditorChannel}

export type ActionEditorStrip = Readonly<{
  id: string
  startMs: number
  sourceInMs: number
  sourceOutMs: number
  repeat?: number
}>

export type ActionEditorEntry = Readonly<{
  localTimeMs: number
  sceneTimeMs: number
  iteration: number
  repeat: number
  phase: 'before' | 'inside' | 'after'
}>

export type ActionEditorScope = 'strip' | 'all'
export type ActionEditorCloseReason = 'applied' | 'cancelled'
export type ActionEditorCommit = Readonly<{
  stripId: string
  channels: readonly ActionEditorChannel[]
  scope: ActionEditorScope
}>

export type ActionEditorOptions = {
  strip: ActionEditorStrip
  durationMs: number
  sceneTimeMs: number
  sourceTimeAt?: (sceneTimeMs: number) => number | null | undefined
  channels: readonly ActionEditorChannel[]
  objectChannels?: readonly ActionEditorObjectChannel[]
  boneNames?: readonly string[]
  sample: (localTimeMs: number) => ActionEditorValues
  seedBoneKeys?: (
    boneName: string,
  ) => readonly Omit<ActionEditorKey<ActionEditorBoneTransform>, 'id'>[]
  name?: string
  framesPerSecond?: number
  sourcePoseKeyTimes?: readonly number[]
  referenceCount?: number
  canApplyToAll?: boolean
  onApply: (commit: ActionEditorCommit) => void
  onClose?: (reason: ActionEditorCloseReason) => void
}

export type ActionEditorSnapshot = Readonly<{
  status: 'open' | ActionEditorCloseReason
  entry: ActionEditorEntry
  localTimeMs: number
  channels: readonly ActionEditorChannel[]
  selectedKey: ActionEditorKeyRef | null
  selectedBone: string | null
  values: ActionEditorValues
  preview: ActionEditorValues
  isDirty: boolean
  discardedPreview: boolean
}>

/**
 * GLB animation accessors are float32, so a clip authored as exactly 32/30 s
 * can load a few microseconds shorter than the strip's persisted sourceOut.
 * Keep the editor boundary inclusive within this practical millisecond margin.
 */
const TIMING_EPSILON_MS = 0.01

export function mapActionEditorTime(
  strip: Omit<ActionEditorStrip, 'id'>,
  sceneTimeMs: number,
): ActionEditorEntry {
  const {startMs, sourceInMs, sourceOutMs, repeat = 1} = strip
  const lengthMs = sourceOutMs - sourceInMs
  if (sceneTimeMs < startMs) {
    return {
      sceneTimeMs,
      localTimeMs: sourceInMs,
      iteration: 1,
      repeat,
      phase: 'before',
    }
  }
  if (sceneTimeMs >= startMs + lengthMs * repeat) {
    return {
      sceneTimeMs,
      localTimeMs: sourceOutMs,
      iteration: repeat,
      repeat,
      phase: 'after',
    }
  }
  let cycle = Math.floor((sceneTimeMs - startMs) / lengthMs)
  if (sceneTimeMs >= startMs + (cycle + 1) * lengthMs) cycle += 1
  else if (sceneTimeMs < startMs + cycle * lengthMs) cycle -= 1
  return {
    sceneTimeMs,
    localTimeMs: sourceInMs + (sceneTimeMs - (startMs + cycle * lengthMs)),
    iteration: cycle + 1,
    repeat,
    phase: 'inside',
  }
}

const emptyValues: ActionEditorValues = {object: {}, bones: {}}

function mergeValues(base: ActionEditorValues, overlay: ActionEditorValues) {
  return {
    object: {...base.object, ...overlay.object},
    bones: {...base.bones, ...overlay.bones},
  }
}

export function hasActionEditorPreview(preview: ActionEditorValues): boolean {
  return (
    Object.keys(preview.object).length > 0 ||
    Object.keys(preview.bones).length > 0
  )
}

function withoutPreview(
  values: ActionEditorValues,
  target: ActionEditorChannelRef,
) {
  const object = {...values.object}
  const bones = {...values.bones}
  if (target.kind === 'bone') delete bones[target.boneName]
  else delete object[target.kind]
  return {object, bones}
}

function changeKeys<Value>(
  keys: readonly ActionEditorKey<Value>[],
  keyId: string,
  timeMs?: number,
): ActionEditorKey<Value>[] {
  const remaining = keys.filter((key) => key.id !== keyId)
  if (timeMs !== undefined) {
    const key = keys.find((item) => item.id === keyId)
    if (key) remaining.push({...key, timeMs})
    remaining.sort((left, right) => left.timeMs - right.timeMs)
  }
  return remaining
}

function editKey(
  channel: ActionEditorChannel,
  keyId: string,
  timeMs?: number,
): ActionEditorChannel {
  switch (channel.kind) {
    case 'bone':
      return {...channel, keys: changeKeys(channel.keys, keyId, timeMs)}
    case 'quaternion':
      return {...channel, keys: changeKeys(channel.keys, keyId, timeMs)}
    default:
      return {...channel, keys: changeKeys(channel.keys, keyId, timeMs)}
  }
}

function keyId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  )
}

function recordValue<Value>(
  keys: readonly ActionEditorKey<Value>[],
  timeMs: number,
  value: Value,
): {keys: readonly ActionEditorKey<Value>[]; id: string} {
  const existing = keys.find((key) => sameKeyTime(key.timeMs, timeMs))
  if (existing && JSON.stringify(existing.value) === JSON.stringify(value))
    return {keys, id: existing.id}
  const id = existing?.id ?? keyId()
  return {
    keys: [
      ...keys.filter((key) => key !== existing),
      {id, timeMs: existing?.timeMs ?? timeMs, value},
    ].sort((left, right) => left.timeMs - right.timeMs),
    id,
  }
}

export type ActionEditorSession = ReturnType<typeof createActionEditorSession>

export function createActionEditorSession(options: ActionEditorOptions) {
  const {
    strip,
    durationMs,
    sceneTimeMs,
    sourceTimeAt,
    sample,
    seedBoneKeys,
    onApply,
    onClose,
    framesPerSecond,
    referenceCount = 1,
    canApplyToAll = true,
  } = options
  const {sourceInMs, sourceOutMs, startMs, repeat = 1} = strip
  if (
    !Number.isFinite(durationMs) ||
    !Number.isFinite(sceneTimeMs) ||
    !Number.isFinite(startMs) ||
    startMs < 0 ||
    !(
      sourceInMs >= 0 &&
      sourceInMs < sourceOutMs &&
      sourceOutMs <= durationMs + TIMING_EPSILON_MS
    ) ||
    !Number.isSafeInteger(repeat) ||
    repeat < 1 ||
    !Number.isFinite(startMs + (sourceOutMs - sourceInMs) * repeat)
  ) {
    throw new RangeError('Invalid action editor timing')
  }
  const timing = mapActionEditorTime(strip, sceneTimeMs)
  const mappedTime =
    timing.phase === 'inside' ? sourceTimeAt?.(sceneTimeMs) : undefined
  const entry = {
    ...timing,
    localTimeMs:
      mappedTime != null && Number.isFinite(mappedTime)
        ? Math.max(sourceInMs, Math.min(sourceOutMs, mappedTime))
        : timing.localTimeMs,
  }
  const initialChannels = options.channels.map(copyChannel)
  const initialChannelData = JSON.stringify(initialChannels)
  const objectChannels = [
    ...new Set(
      options.objectChannels ??
        initialChannels.flatMap((channel) =>
          channel.kind === 'bone' ? [] : [channel.kind],
        ),
    ),
  ]
  let base = sample(entry.localTimeMs)
  let sampled = mergeValues(
    base,
    sampleActionEditorChannels(initialChannels, entry.localTimeMs),
  )
  let applying = false
  let snapshot: ActionEditorSnapshot = {
    status: 'open',
    entry,
    localTimeMs: entry.localTimeMs,
    channels: initialChannels,
    selectedKey: null,
    selectedBone: null,
    values: sampled,
    preview: emptyValues,
    isDirty: false,
    discardedPreview: false,
  }
  const listeners = new Set<() => void>()
  const isOpen = () => snapshot.status === 'open' && !applying
  const validTime = (timeMs: number) =>
    Number.isFinite(timeMs) && timeMs >= 0 && timeMs <= durationMs
  const findChannel = (target: ActionEditorChannelRef) =>
    snapshot.channels.find(
      (channel) => channelId(channel) === channelId(target),
    )
  const sourceBones = new Map<string, ActionEditorChannel>()

  function getChannel(
    target: ActionEditorChannelRef,
  ): ActionEditorChannel | undefined {
    const edited = findChannel(target)
    if (edited || target.kind !== 'bone' || !seedBoneKeys) return edited
    const cached = sourceBones.get(target.boneName)
    if (cached) return cached
    const keys: ActionEditorKey<ActionEditorBoneTransform>[] = []
    const seeds = seedBoneKeys(target.boneName)
      .filter((key) => validTime(key.timeMs) && isBoneTransform(key.value))
      .sort((left, right) => left.timeMs - right.timeMs)
    for (const seed of seeds) {
      const previous = keys[keys.length - 1]
      if (!previous || !sameKeyTime(previous.timeMs, seed.timeMs)) {
        keys.push({
          id: keyId(),
          timeMs: seed.timeMs,
          value: copyBone(seed.value),
        })
      }
    }
    const channel = {...target, keys}
    sourceBones.set(target.boneName, channel)
    return channel
  }

  function publish(patch: Partial<ActionEditorSnapshot>) {
    const next = {...snapshot, ...patch}
    if (next.localTimeMs !== snapshot.localTimeMs)
      base = sample(next.localTimeMs)
    if (
      next.localTimeMs !== snapshot.localTimeMs ||
      next.channels !== snapshot.channels
    )
      sampled = mergeValues(
        base,
        sampleActionEditorChannels(next.channels, next.localTimeMs),
      )
    const channelsChanged = next.channels !== snapshot.channels
    snapshot = {
      ...next,
      values: mergeValues(sampled, next.preview),
      isDirty: channelsChanged
        ? JSON.stringify(next.channels) !== initialChannelData
        : snapshot.isDirty,
    }
    listeners.forEach((listener) => listener())
  }

  function scrub(timeMs: number, selectedKey: ActionEditorKeyRef | null) {
    const moved = timeMs !== snapshot.localTimeMs
    const hadKeyPreview =
      selectedKey?.kind === 'bone'
        ? Object.prototype.hasOwnProperty.call(
            snapshot.preview.bones,
            selectedKey.boneName,
          )
        : selectedKey && snapshot.preview.object[selectedKey.kind] !== undefined
    publish({
      localTimeMs: timeMs,
      selectedKey,
      selectedBone:
        selectedKey?.kind === 'bone'
          ? selectedKey.boneName
          : snapshot.selectedBone,
      preview: moved
        ? emptyValues
        : hadKeyPreview && selectedKey
          ? withoutPreview(snapshot.preview, selectedKey)
          : snapshot.preview,
      discardedPreview: moved
        ? hasActionEditorPreview(snapshot.preview)
        : Boolean(hadKeyPreview || snapshot.discardedPreview),
    })
  }

  function replaceChannel(
    before: ActionEditorChannel | undefined,
    after: ActionEditorChannel,
  ) {
    if (!before) return [...snapshot.channels, after]
    if (!after.keys.length)
      return snapshot.channels.filter((channel) => channel !== before)
    return snapshot.channels.map((channel) =>
      channel === before ? after : channel,
    )
  }

  function setObjectPreview(
    kind: ActionEditorObjectChannel,
    value: ActionEditorXYZ | ActionEditorQuaternion,
  ): boolean {
    if (!isOpen() || !objectChannels.includes(kind)) return false
    const preview =
      kind === 'quaternion'
        ? isQuaternion(value) && copyQuaternion(value)
        : isXYZ(value) && copyXYZ(value)
    if (!preview) return false
    publish({
      preview: {
        ...snapshot.preview,
        object: {
          ...snapshot.preview.object,
          [kind]: preview,
        },
      },
      discardedPreview: false,
    })
    return true
  }

  function setBonePreview(
    boneName: string,
    value: ActionEditorBoneTransform,
  ): boolean {
    if (!isOpen() || !boneName || !isBoneTransform(value)) return false
    publish({
      preview: {
        ...snapshot.preview,
        bones: {...snapshot.preview.bones, [boneName]: copyBone(value)},
      },
      discardedPreview: false,
    })
    return true
  }

  function recordBonePose(bones: ActionEditorValues['bones']): number {
    if (!isOpen()) return 0
    const {values, localTimeMs, preview} = snapshot
    const channels = [...snapshot.channels]
    const pending = {...preview.bones}
    let count = 0
    for (const [boneName, value] of Object.entries(bones)) {
      if (!isBoneTransform(value)) continue
      const before = values.bones[boneName]
      if (before) {
        const {position, quaternion, scale} = value
        const translation = Math.hypot(
          position.x - before.position.x,
          position.y - before.position.y,
          position.z - before.position.z,
        )
        const resize = Math.hypot(
          scale.x - before.scale.x,
          scale.y - before.scale.y,
          scale.z - before.scale.z,
        )
        const rotation = Math.min(
          Math.hypot(
            quaternion.x - before.quaternion.x,
            quaternion.y - before.quaternion.y,
            quaternion.z - before.quaternion.z,
            quaternion.w - before.quaternion.w,
          ),
          Math.hypot(
            quaternion.x + before.quaternion.x,
            quaternion.y + before.quaternion.y,
            quaternion.z + before.quaternion.z,
            quaternion.w + before.quaternion.w,
          ),
        )
        if (Math.max(translation, rotation, resize) <= 0.00001) continue
      }

      const target = {kind: 'bone' as const, boneName}
      const channel = getChannel(target)
      const keys = channel?.kind === 'bone' ? channel.keys : []
      const recorded = recordValue(keys, localTimeMs, copyBone(value))
      const next = {...target, keys: recorded.keys}
      const index = channel ? channels.indexOf(channel) : -1
      if (index < 0) channels.push(next)
      else channels[index] = next
      delete pending[boneName]
      count++
    }
    if (count) {
      publish({
        channels,
        preview: {...preview, bones: pending},
        discardedPreview: false,
      })
    }
    return count
  }

  function recordKey(target: ActionEditorChannelRef): boolean {
    if (!isOpen()) return false
    const channel = getChannel(target)
    const {values, localTimeMs} = snapshot
    let next: ActionEditorChannel
    let id: string
    if (target.kind === 'bone') {
      const value = Object.prototype.hasOwnProperty.call(
        values.bones,
        target.boneName,
      )
        ? values.bones[target.boneName]
        : undefined
      if (!value || !isBoneTransform(value)) return false
      const keys = channel?.kind === 'bone' ? channel.keys : []
      const recorded = recordValue(keys, localTimeMs, copyBone(value))
      next = {...target, keys: recorded.keys}
      id = recorded.id
    } else if (
      target.kind === 'quaternion' &&
      objectChannels.includes(target.kind)
    ) {
      const value = values.object.quaternion
      if (!value || !isQuaternion(value)) return false
      const recorded = recordValue(
        channel?.kind === 'quaternion' ? channel.keys : [],
        localTimeMs,
        copyQuaternion(value),
      )
      next = {kind: target.kind, keys: recorded.keys}
      id = recorded.id
    } else if (
      target.kind !== 'quaternion' &&
      objectChannels.includes(target.kind)
    ) {
      const value = values.object[target.kind]
      if (!value || !isXYZ(value)) return false
      const keys =
        channel?.kind === 'position' || channel?.kind === 'scale'
          ? channel.keys
          : []
      const recorded = recordValue(keys, localTimeMs, copyXYZ(value))
      next = {kind: target.kind, keys: recorded.keys}
      id = recorded.id
    } else {
      return false
    }
    const selectedKey = {...target, keyId: id}
    publish({
      channels:
        next.keys === channel?.keys
          ? snapshot.channels
          : replaceChannel(findChannel(target), next),
      selectedKey,
      selectedBone:
        target.kind === 'bone' ? target.boneName : snapshot.selectedBone,
      preview: withoutPreview(snapshot.preview, target),
      discardedPreview: false,
    })
    return true
  }

  function selectKey(ref: ActionEditorKeyRef): boolean {
    const key = getChannel(ref)?.keys.find((item) => item.id === ref.keyId)
    if (!isOpen() || !key) return false
    scrub(key.timeMs, ref)
    return true
  }

  function moveKey(ref: ActionEditorKeyRef, timeMs: number): boolean {
    const channel = getChannel(ref)
    const key = channel?.keys.find((item) => item.id === ref.keyId)
    if (!isOpen() || !channel || !key || !validTime(timeMs)) return false
    if (
      channel.keys.some(
        (item) => item !== key && sameKeyTime(item.timeMs, timeMs),
      )
    )
      return false
    if (sameKeyTime(key.timeMs, timeMs)) return selectKey(ref)
    publish({
      channels: replaceChannel(
        findChannel(ref),
        editKey(channel, ref.keyId, timeMs),
      ),
      selectedKey: ref,
      selectedBone: ref.kind === 'bone' ? ref.boneName : snapshot.selectedBone,
      localTimeMs: timeMs,
      preview: emptyValues,
      discardedPreview: hasActionEditorPreview(snapshot.preview),
    })
    return true
  }

  function canDeleteKey(ref: ActionEditorKeyRef): boolean {
    const channel = getChannel(ref)
    return Boolean(
      channel?.keys.some((item) => item.id === ref.keyId) &&
        (channel.keys.length > 1 || (channel.kind === 'bone' && !seedBoneKeys)),
    )
  }

  function deleteKey(ref: ActionEditorKeyRef): boolean {
    const channel = getChannel(ref)
    if (!isOpen() || !channel || !canDeleteKey(ref)) return false
    const selected = snapshot.selectedKey
    publish({
      channels: replaceChannel(findChannel(ref), editKey(channel, ref.keyId)),
      selectedKey:
        selected &&
        channelId(selected) === channelId(ref) &&
        selected.keyId === ref.keyId
          ? null
          : selected,
      preview: withoutPreview(snapshot.preview, ref),
    })
    return true
  }

  const allReferencesAvailable = referenceCount > 1 && canApplyToAll
  function apply(scope: ActionEditorScope = 'strip'): boolean {
    if (!isOpen() || (scope === 'all' && !allReferencesAvailable)) return false
    applying = true
    try {
      if (snapshot.isDirty) {
        if (!isActionEditorChannels(snapshot.channels, durationMs))
          throw new Error('Invalid action editor channels')
        onApply({
          stripId: strip.id,
          channels: snapshot.channels.map(copyChannel),
          scope,
        })
      }
    } finally {
      applying = false
    }
    publish({status: 'applied', preview: emptyValues})
    onClose?.('applied')
    return true
  }

  function cancel(): boolean {
    if (!isOpen()) return false
    publish({
      status: 'cancelled',
      channels: initialChannels,
      preview: emptyValues,
      selectedKey: null,
    })
    onClose?.('cancelled')
    return true
  }

  return {
    name: options.name,
    durationMs,
    framesPerSecond,
    sourcePoseKeyTimes: (options.sourcePoseKeyTimes ?? []).filter(validTime),
    referenceCount,
    canApplyToAll: allReferencesAvailable,
    objectChannels,
    boneNames: [...new Set(options.boneNames ?? [])],
    sourceInMs,
    sourceOutMs,
    getChannel,
    canDeleteKey,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    seek(timeMs: number) {
      if (!isOpen() || !validTime(timeMs)) return false
      scrub(timeMs, null)
      return true
    },
    selectBone(boneName: string | null) {
      if (!isOpen() || boneName === snapshot.selectedBone) return
      publish({
        selectedBone: boneName,
        selectedKey:
          snapshot.selectedKey?.kind === 'bone' ? null : snapshot.selectedKey,
      })
    },
    setObjectPreview,
    setBonePreview,
    resetPreview() {
      if (isOpen()) publish({preview: emptyValues, discardedPreview: false})
    },
    selectKey,
    recordKey,
    recordBonePose,
    moveKey,
    deleteKey,
    apply,
    cancel,
  }
}
