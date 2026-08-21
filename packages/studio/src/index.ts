/**
 * The library providing the editor components of Theatre.js.
 *
 * @packageDocumentation
 */

import {setStudio} from '@toy-box/studio/getStudio'
import {Studio} from '@toy-box/studio/Studio'

import type {GlobalVariableNames} from '@toy-box/core/globals'
import type {$FixMe} from '@toy-box/core/types/public'
import StudioBundle from './StudioBundle'
import type CoreBundle from '@toy-box/core/CoreBundle'
import type {IStudio} from '@toy-box/core/types/public'

const globalVariableNames: GlobalVariableNames = {
  StudioBundle: '__TheatreJS_StudioBundle',
  coreBundle: '__TheatreJS_CoreBundle',
  notifications: '__TheatreJS_Notifications',
}

const studioPrivateAPI = new Studio()
setStudio(studioPrivateAPI)

/**
 * The main instance of Studio. Read more at {@link IStudio}
 */
const studio: IStudio = studioPrivateAPI.publicApi

export {}

registerStudioBundle()

function registerStudioBundle() {
  if (
    typeof window == 'undefined' &&
    global.__THEATREJS__FORCE_CONNECT_CORE_AND_STUDIO !== true
  )
    return

  const globalContext = typeof window !== 'undefined' ? window : global

  const existingStudioBundle = (globalContext as $FixMe)[
    globalVariableNames.StudioBundle
  ]

  if (typeof existingStudioBundle !== 'undefined') {
    if (
      typeof existingStudioBundle === 'object' &&
      existingStudioBundle &&
      typeof existingStudioBundle.version === 'string'
    ) {
      throw new Error(
        `It seems that the module '@toy-box/studio' is loaded more than once. This could have two possible causes:\n` +
          `1. You might have two separate versions of Theatre.js in node_modules.\n` +
          `2. Or this might be a bundling misconfiguration, in case you're using a bundler like Webpack/ESBuild/Rollup.\n\n` +
          `Note that it **is okay** to import '@toy-box/studio' multiple times. But those imports should point to the same module.`,
      )
    } else {
      throw new Error(
        `The variable window.${globalVariableNames.StudioBundle} seems to be already set by a module other than @toy-box/core.`,
      )
    }
  }

  const studioBundle = new StudioBundle(studioPrivateAPI)

  // @ts-ignore ignore
  globalContext[globalVariableNames.StudioBundle] = studioBundle

  const possibleCoreBundle: undefined | CoreBundle =
    // @ts-ignore ignore
    globalContext[globalVariableNames.coreBundle]

  if (
    possibleCoreBundle &&
    possibleCoreBundle !== null &&
    possibleCoreBundle.type === 'Theatre_CoreBundle'
  ) {
    studioBundle.registerCoreBundle(possibleCoreBundle)
  }
}

import {notify} from '@toy-box/studio/notify'

if (typeof window !== 'undefined') {
  // @ts-ignore
  window[globalVariableNames.notifications] = {
    notify,
  }
}
