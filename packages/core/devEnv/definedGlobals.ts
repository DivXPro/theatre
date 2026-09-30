import type {Env} from '@dreamerbird/core/envSchema'
import type {$IntentionalAny} from '@dreamerbird/utils/types'
// This file gets imported by other packages who may ot have set up path aliases, so we should use relative imports here
// eslint-disable-next-line no-relative-imports
import {fullSchema} from '../src/envSchema'
// Bare `require` is not defined in ESM scope (node >= 20.19), and this file
// can be imported from either CJS or ESM consumers, so create one explicitly.
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)

const env: Env = {
  THEATRE_VERSION: require('../package.json').version,
  BUILT_FOR_PLAYGROUND: 'false',
  BACKEND_URL: `https://app.theatrejs.com`,
}

fullSchema.parse(env)

export const definedGlobals: Record<string, string> = {
  // json-touch-patch (an unmaintained package) reads this value. We patch it to just 'Set', becauce
  // this is only used in `@dreamerbird/studio`, which only supports evergreen browsers
  'global.Set': 'Set',
}

for (const entry of Object.entries(env)) {
  const [key, value] = entry as $IntentionalAny
  definedGlobals[`process.env.${key}`] = JSON.stringify(value)
}
