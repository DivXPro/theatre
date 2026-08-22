import type {CoreBits} from '@toy-box/core/CoreBundle'
import type {$IntentionalAny, InitOpts} from '@toy-box/core/types/public'
import type {StudioOpts} from './Studio'

export const DEFAULT_PERSISTENCE_KEY = 'theatre-0.4'

export function sanitizeOpts(
  opts: InitOpts | undefined,
  coreBits: CoreBits,
): StudioOpts {
  const storeOpts: StudioOpts = {
    persistenceKey: DEFAULT_PERSISTENCE_KEY,
    usePersistentStorage: true,
    // The fork is offline-first: no cloud backend is contacted unless the user
    // explicitly provides a `serverUrl`.
    serverUrl: undefined,
    rafDriver: coreBits.getCoreRafDriver(),
  }

  if (typeof opts?.serverUrl == 'string') {
    if (
      // a fully formed url
      opts.serverUrl.match(/^(https?|wss?):\/\//) &&
      // not ending with a slash
      !opts.serverUrl.endsWith('/')
    ) {
      storeOpts.serverUrl = opts.serverUrl
    } else {
      throw new Error(
        'parameter `serverUrl` in `theatre.init({studio: true, serverUrl})` must be either undefined or a fully formed url (e.g. `http://localhost:3000` or `ws://localhost:3000`)',
      )
    }
  }

  if (typeof opts?.persistenceKey === 'string') {
    storeOpts.persistenceKey = opts.persistenceKey
  }

  if (opts?.usePersistentStorage === false || typeof window === 'undefined') {
    storeOpts.usePersistentStorage = false
  }

  if (opts?.rafDriver) {
    if (opts?.rafDriver.type !== 'Theatre_RafDriver_PublicAPI') {
      throw new Error(
        'parameter `rafDriver` in `theatre.init({studio: true, rafDriver})` must be either be undefined, or the return type of core.createRafDriver()',
      )
    }

    const rafDriverPrivateApi = coreBits.privateAPI(opts.rafDriver)
    if (!rafDriverPrivateApi) {
      // TODO - need to educate the user about this edge case
      throw new Error(
        'parameter `rafDriver` in `theatre.init({studio: true, rafDriver})` seems to come from a different version of `@toy-box/core` than the version that is attached to `@toy-box/studio`',
      )
    }
    storeOpts.rafDriver = rafDriverPrivateApi
  }

  return storeOpts
}

/**
 * A single-argument convenience wrapper around {@link sanitizeOpts} for tests,
 * where no real core bits (rafDriver, privateAPI) are needed.
 */
export function sanitizeOptsForTest(opts?: InitOpts): StudioOpts {
  return sanitizeOpts(opts, {
    getCoreRafDriver: () => undefined,
    privateAPI: () => undefined,
  } as $IntentionalAny as CoreBits)
}
