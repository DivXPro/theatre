import type {CoreBits} from '@dreamerbird/core/CoreBundle'
import type {$IntentionalAny, InitOpts} from '@dreamerbird/core/types/public'
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
        'parameter `rafDriver` in `theatre.init({studio: true, rafDriver})` seems to come from a different version of `@dreamerbird/core` than the version that is attached to `@dreamerbird/studio`',
      )
    }
    storeOpts.rafDriver = rafDriverPrivateApi
  }

  const wb = opts?.workspaceButton
  if (wb !== undefined) {
    if (typeof wb !== 'object' || wb === null) {
      throw new Error(
        'parameter `workspaceButton` in `theatre.init({studio: true, workspaceButton})` must be an object like {team?, name?, icon?, menu?}',
      )
    }
    if (wb.menu !== undefined) {
      if (!Array.isArray(wb.menu)) {
        throw new Error(
          'parameter `workspaceButton.menu` must be an array of {label, onClick}',
        )
      }
      for (const item of wb.menu) {
        if (
          typeof item !== 'object' ||
          item === null ||
          typeof item.label !== 'string' ||
          typeof item.onClick !== 'function'
        ) {
          throw new Error(
            'each item of `workspaceButton.menu` must be {label: string, onClick: function}',
          )
        }
      }
    }
    storeOpts.workspaceButton = wb
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
