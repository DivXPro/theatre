import {Atom, val} from '@toy-box/dataverse'
import type {$IntentionalAny} from '@toy-box/utils/types'
import {wireDirectSyncServerLink} from './wireDirectSyncServerLink'

type ConnectionState = 'connected' | 'reconnecting'

/**
 * The Studio constructor wires a direct-ws sync-server link behind
 * `typeof window !== 'undefined' && process.env.NODE_ENV !== 'test'`, so jest
 * never reaches it. The wiring is extracted into `wireDirectSyncServerLink`
 * and tested here directly with a fake link + a real Atom.
 */
const makeFakeLink = () => {
  const cbs: Array<(state: ConnectionState) => void> = []
  return {
    api: {fakeSyncServerApi: true} as $IntentionalAny,
    onConnectionStateChange: jest.fn((cb: (state: ConnectionState) => void) => {
      cbs.push(cb)
      return () => cbs.splice(cbs.indexOf(cb), 1)
    }),
    fire: (state: ConnectionState) => cbs.forEach((cb) => cb(state)),
  }
}

const makeStudio = () => ({
  authedLinks: undefined as
    | undefined
    | {syncServer: $IntentionalAny; app: undefined},
  ephemeralAtom: new Atom({connectionStatus: 'connected' as ConnectionState}),
})

describe('wireDirectSyncServerLink', () => {
  test('sets authedLinks.syncServer to link.api and app to undefined', () => {
    const link = makeFakeLink()
    const studio = makeStudio()
    wireDirectSyncServerLink(studio as $IntentionalAny, link as $IntentionalAny)
    // syncServer must be the client itself (not a promise): createTrpcBackend
    // accesses `.projectState…` on it synchronously.
    expect(studio.authedLinks?.syncServer).toBe(link.api)
    expect(studio.authedLinks?.app).toBeUndefined()
  })

  test('surfaces the link connection state into connectionStatus', () => {
    const link = makeFakeLink()
    const studio = makeStudio()
    wireDirectSyncServerLink(studio as $IntentionalAny, link as $IntentionalAny)
    expect(val(studio.ephemeralAtom.pointer.connectionStatus)).toBe('connected')

    link.fire('reconnecting')
    expect(val(studio.ephemeralAtom.pointer.connectionStatus)).toBe(
      'reconnecting',
    )

    link.fire('connected')
    expect(val(studio.ephemeralAtom.pointer.connectionStatus)).toBe('connected')
  })

  test('returns the connection-state unsub so the wiring can be torn down', () => {
    const link = makeFakeLink()
    const studio = makeStudio()
    const unsub = wireDirectSyncServerLink(
      studio as $IntentionalAny,
      link as $IntentionalAny,
    )
    unsub()
    link.fire('reconnecting')
    expect(val(studio.ephemeralAtom.pointer.connectionStatus)).toBe('connected')
  })
})
