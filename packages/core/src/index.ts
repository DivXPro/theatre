/**
 * The library providing the runtime functionality of Theatre.js.
 *
 * @packageDocumentation
 */

export * from './coreExports'
export * from './types/public'
import {defer} from '@toy-box/utils/defer'
import CoreBundle from './CoreBundle'
import {globalVariableNames} from './globals'
import {initState} from './initState'
import type {
  IStudio,
  IStudioBundle,
  IStudioInternal,
  InitOpts,
} from './types/public'

const studioDeferred = defer<IStudioInternal>()

export async function getStudio(): Promise<IStudio> {
  if (!initState.called) {
    throw new Error(
      `You seem to have called getStudio() before init(). The studio has not been initialized; make sure to call init() (e.g. theatre.init({studio: true})) before using the studio.`,
    )
  }
  return (await studioDeferred.promise).publicApi
}

export function getStudioSync(
  errorIfNotReady: boolean = false,
): IStudio | undefined {
  if (studioDeferred.status !== 'resolved') {
    if (errorIfNotReady) throw new Error(`Studio is not ready yet.`)
    return undefined
  }
  return studioDeferred.currentValue!.publicApi
}

/**
 * Initializes Theatre.js with the given options.
 *
 * This is safe to call multiple times; only the first call has any effect.
 */
export async function init(opts?: InitOpts) {
  if (initState.called) {
    return
  }
  initState.called = true
  initState.optsDeferred.resolve(opts)

  if (opts?.studio && typeof window !== 'undefined') {
    // The studio bundle registers itself with core when imported; init() only
    // supplies the opts. If nothing has attached after a while, the likely
    // cause is a missing `import '@toy-box/studio'` — say so instead of
    // leaving the user with a silently absent studio.
    setTimeout(() => {
      if (studioDeferred.status !== 'resolved') {
        console.warn(
          `theatre.init({studio: true}) was called, but @toy-box/studio has not loaded. ` +
            `Did you forget to import it? Add \`import '@toy-box/studio'\` to your app's entry ` +
            `module — the studio registers itself with core when it is imported.`,
        )
      }
    }, 5000)
  }
}

const theatre = {getStudio, getStudioSync, init}
export default theatre

type StudioBundle = IStudioBundle

registerCoreBundle()

/**
 * @remarks
 * the studio and core need to communicate with each other somehow, and currently we do that
 * by registering each of them as a global variable. This function does the work of registering
 * the core bundle (everything exported from `@toy-box/core`) to window.__TheatreJS_CoreBundle.
 */
function registerCoreBundle() {
  // This only works in a browser environment
  if (
    typeof window == 'undefined' &&
    global.__THEATREJS__FORCE_CONNECT_CORE_AND_STUDIO !== true
  )
    return

  const globalContext = typeof window !== 'undefined' ? window : global

  // another core bundle may already be registered

  const existingBundle: CoreBundle | undefined =
    // @ts-ignore ignore
    globalContext[globalVariableNames.coreBundle]

  if (typeof existingBundle !== 'undefined') {
    if (
      typeof existingBundle === 'object' &&
      existingBundle &&
      typeof existingBundle.version === 'string'
    ) {
      /*
      Another core bundle is registered. This usually means the bundler is not configured correctly and
      is bundling `@toy-box/core` multiple times, but, there are legitimate scenarios where a user may want
      to include multiple instances of `@toy-box/core` on the same page.

      For example, an article might embed two separate interactive graphics that
      are made by different teams (and even different tech stacks -- one in JS, the other in clojurescript).

      If both of those graphics use Theatre.js, our current setup makes them conflict with one another.

      ----------------------
      --------------------
      ----------------------
      -------.

      |   /\_/\   |
      |  ( o.o )  |      --------> graphic1 made with JS+Theatre.js
      |   > ^ <   |

      ## ---
      ----------------------
      --------------------
      ----------------------
      -------.

      |    __      _   |
      |  o'')}____//   | --------> graphic2 made with clojurescript+Theatre.js
      |  `_/      )    |
      |  (_(_/-(_/     |
      
      ---------------------
      -----♥.

      @todo Make it possible to have multiple separate bundles on the same page, but still communicate
      that there is more than one bundle so we can warn the user about bundler misconfiguration.
      
      */
      throw new Error(
        `It seems that the module '@toy-box/core' is loaded more than once. This could have two possible causes:\n` +
          `1. You might have two separate versions of Theatre.js in node_modules.\n` +
          `2. Or this might be a bundling misconfiguration, in case you're using a bundler like Webpack/ESBuild/Rollup.\n\n` +
          `Note that it **is okay** to import '@toy-box/core' multiple times. But those imports should point to the same module.`,
      )
    } else {
      throw new Error(
        `The variable window.${globalVariableNames.coreBundle} seems to be already set by a module other than @toy-box/core.`,
      )
    }
  }

  const coreBundle = new CoreBundle({
    onAttach: (s) => {
      void initState.optsDeferred.promise.then((opts) => {
        s.initialize(opts)
        studioDeferred.resolve(s)
      })
    },
  })

  // @ts-ignore ignore
  globalContext[globalVariableNames.coreBundle] = coreBundle

  const possibleExistingStudioBundle: undefined | StudioBundle =
    // @ts-ignore ignore
    globalContext[globalVariableNames.StudioBundle]

  if (
    possibleExistingStudioBundle &&
    possibleExistingStudioBundle !== null &&
    possibleExistingStudioBundle.type === 'Theatre_StudioBundle'
  ) {
    possibleExistingStudioBundle.registerCoreBundle(coreBundle)
  }
}
