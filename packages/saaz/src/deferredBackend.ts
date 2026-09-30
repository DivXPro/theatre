import type {SaazBackInterface} from './types'

/**
 * Wraps a backend that is chosen asynchronously (e.g. local vs tRPC depending
 * on init opts) so callers can hold a SaazBackInterface synchronously.
 */
export function createDeferredBackend(
  impl: Promise<SaazBackInterface>,
): SaazBackInterface {
  return {
    getUpdatesSinceClock: (opts) =>
      impl.then((b) => b.getUpdatesSinceClock(opts)),
    getLastIncorporatedPeerClock: (opts) =>
      impl.then((b) => b.getLastIncorporatedPeerClock(opts)),
    closePeer: (opts) => impl.then((b) => b.closePeer(opts)),
    applyUpdates: (opts) => impl.then((b) => b.applyUpdates(opts)),
    updatePresence: (opts) => impl.then((b) => b.updatePresence(opts)),
    subscribe: (opts, onUpdate) =>
      impl
        .then((b) => b.subscribe(opts, onUpdate))
        .then((unsub) => {
          let inner: (() => void) | undefined = unsub
          return () => inner?.()
        }),
  }
}
