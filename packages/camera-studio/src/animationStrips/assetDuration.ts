import {getLibrary} from '../assetLibrary/library'
import {createGLTFLoader} from '../assetLibrary/gltfLoader'
import type {AnimationEntry} from '../assetLibrary/types'

const durations = new Map<string, number | Promise<number>>()

/**
 * Older library entries could be written before AnimationEntry.duration was
 * persisted. Their GLB still carries the real clip length, so resolve it once
 * and repair the entry when the writable source allows it.
 */
export function resolveAnimationDuration(
  entry: AnimationEntry,
): Promise<number> {
  if (entry.duration > 0) return Promise.resolve(entry.duration)
  const cached = durations.get(entry.id)
  if (typeof cached === 'number') return Promise.resolve(cached)
  if (cached) return cached

  const library = getLibrary()
  const promise = (async () => {
    const url = await library.getBlobUrl(entry.blobId)
    const gltf = await createGLTFLoader().loadAsync(url)
    const duration = gltf.animations[0]?.duration
    if (
      !(
        typeof duration === 'number' &&
        Number.isFinite(duration) &&
        duration > 0
      )
    ) {
      throw new Error('Animation asset contains no usable duration')
    }
    durations.set(entry.id, duration)
    void library.putEntry({...entry, duration}).catch(() => {})
    return duration
  })()
  durations.set(entry.id, promise)
  void promise.catch(() => {
    if (durations.get(entry.id) === promise) durations.delete(entry.id)
  })
  return promise
}
