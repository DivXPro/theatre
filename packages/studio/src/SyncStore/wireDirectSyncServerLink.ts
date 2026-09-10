import type {$IntentionalAny} from '@dreamerbird/utils/types'
import type {Studio} from '@dreamerbird/studio/Studio'
import type SyncServerLink from './SyncServerLink'

/**
 * Wires a direct-ws (`ws://`/`wss://`) sync-server link into a Studio:
 * `authedLinks.syncServer` becomes the bare sync-server client (no Auth, no
 * auth wrapper — the server runs with AUTH_DISABLED and ignores tokens), and
 * the link's connection state is surfaced to the UI's `connectionStatus`.
 *
 * Extracted from the Studio constructor so the wiring is unit-testable without
 * a browser env — the constructor guards it behind `typeof window` +
 * NODE_ENV, so jest never reaches it. Returns the connection-state unsub so
 * the caller can tear it down.
 */
export const wireDirectSyncServerLink = (
  studio: Pick<Studio, 'authedLinks' | 'ephemeralAtom'>,
  link: SyncServerLink,
): (() => void) => {
  // authedLinks.syncServer must be the client itself, not a promise —
  // createTrpcBackend accesses `.projectState…` on it synchronously.
  studio.authedLinks = {
    syncServer: link.api as $IntentionalAny,
    app: undefined as $IntentionalAny,
  }
  // surface the direct link's connection state to the UI
  return link.onConnectionStateChange((state) => {
    studio.ephemeralAtom.setByPointer((p) => p.connectionStatus, state)
  })
}
