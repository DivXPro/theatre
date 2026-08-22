import alias from '@rollup/plugin-alias'
import path from 'path'
import {dts} from 'rollup-plugin-dts'

const fromPackages = (s) => path.join(__dirname, '../../../', s)
const fromPackage = (s) => path.join(__dirname, '../..', s)

// rollup materializes inlined namespace modules (star-exports and `import * as`
// re-exports) as `var X = Object.freeze({ get a () { return a; }, ... })` (annotated as pure).
// rollup-plugin-dts's NamespaceFixer only understands the property-assignment form that
// tsc emits (`a: a`), so rewrite the getters to assignments before it runs.
const normalizeGetterNamespaces = {
  name: 'normalize-getter-namespaces',
  renderChunk(code) {
    const lines = code.split('\n')
    let inFreeze = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (inFreeze) {
        const getter = line.match(
          /^\s*get\s+([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\{\s*return\s+([A-Za-z_$][\w$]*)\s*;\s*\},?\s*$/,
        )
        if (getter) {
          const indent = line.match(/^\s*/)[0]
          lines[i] = `${indent}${getter[1]}: ${getter[2]},`
        } else if (line.includes('});')) {
          inFreeze = false
        }
      } else if (line.includes('Object.freeze({')) {
        inFreeze = true
      }
    }
    return lines.join('\n')
  },
}

const config = {
  input: fromPackage(`.temp/declarations/src/index.d.ts`),
  output: {
    dir: fromPackage('dist'),
    entryFileNames: 'index.d.ts',
    format: 'es',
  },
  external: (s) => {
    if (s === '@toy-box/dataverse') {
      return true
    }

    if (s.startsWith('@toy-box')) {
      return false
    }

    if (s.startsWith('/') || s.startsWith('./') || s.startsWith('../')) {
      return false
    }

    return true
  },

  plugins: [
    normalizeGetterNamespaces,
    dts({
      respectExternal: true,
      compilerOptions: {
        paths: {
          '@toy-box/core': [fromPackage(`.temp/declarations/src`)],
        },
      },
    }),
    alias({
      entries: [
        {
          find: `@toy-box/core`,
          replacement: fromPackage(`.temp/declarations/src`),
        },
        {
          find: `@toy-box/utils`,
          replacement: fromPackages(`utils/src`),
        },
      ],
    }),
  ],
}

export default config
