import path from 'node:path'
import {dts} from 'rollup-plugin-dts'

const packages = path.join(__dirname, '../../..')
const declarations = path.join(packages, 'studio/.temp/declarations/src')
const internal = {
  core: path.join(packages, 'core/.temp/declarations/src'),
  saaz: path.join(packages, 'saaz/dist'),
  studio: declarations,
  'sync-server': path.join(packages, 'sync-server/dist/src'),
  utils: path.join(packages, 'utils/dist'),
}

const publicCoreTypes = {
  name: 'public-core-types',
  resolveId(id) {
    if (id === '@dreamerbird/core/types/public') {
      return {id: '@dreamerbird/core', external: true}
    }
  },
}

function config(entry, output) {
  return {
    input: path.join(declarations, entry),
    output: {
      file: path.join(packages, 'studio/dist', output),
      format: 'es',
    },
    external(id) {
      if (path.isAbsolute(id) || id.startsWith('.')) return false
      if (id === '@dreamerbird/core' || id === '@dreamerbird/studio/i18n') {
        return true
      }
      const name = id.replace(/^@dreamerbird\/([^/]+).*/, '$1')
      return !Object.hasOwn(internal, name)
    },
    plugins: [
      publicCoreTypes,
      dts({
        respectExternal: true,
        compilerOptions: {
          paths: {
            ...Object.fromEntries(
              Object.entries(internal).flatMap(([name, dir]) => [
                [`@dreamerbird/${name}`, [dir]],
                [`@dreamerbird/${name}/*`, [path.join(dir, '*')]],
              ]),
            ),
            '@dreamerbird/saaz/src/*': [path.join(internal.saaz, '*')],
          },
        },
      }),
    ],
  }
}

export default [
  config('camera-studio.d.ts', 'camera-studio.d.ts'),
  config('i18n/index.d.ts', 'i18n.d.ts'),
]
