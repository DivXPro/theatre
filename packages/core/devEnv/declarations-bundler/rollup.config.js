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

// rollup-plugin-dts inlines @toy-box/utils (mapped to utils/src) by compiling its
// TypeScript source. For most symbols it emits proper declarations, but for
// `SimpleCache` and the `nominal$1` unique symbol it leaks implementation bodies into
// the output: `declare const nominal$1 = Symbol()`, a `_values` field initializer,
// `constructor() {}`, and method bodies. Those are illegal in an ambient context and
// break any consumer compiling without `skipLibCheck`. Replace them with their proper
// declaration-only forms (mirroring the already-correct `nominal`/`Nominal` pair that
// ships in the same bundle). Both are private to the bundle and appear exactly once,
// so a bounded exact-match replacement is safe and deterministic.
const stripImplementations = {
  name: 'strip-implementations',
  renderChunk(code) {
    code = code.replace(
      'declare const nominal$1 = Symbol()',
      'declare const nominal$1: unique symbol;',
    )

    const simpleCacheImpl = `declare class SimpleCache {
  /**
   * NOTE this could also be a Map.
   */
  protected _values: Record<string, unknown> = {}
  constructor() {}

  /**
   * get the cache item at \`key\` or produce it using \`producer\` and cache _that_.
   *
   * Note that this won't work if you change the producer, like \`get(key, producer1); get(key, producer2)\`.
   */
  get<T>(key: string, producer: () => T): T {
    if (this.has(key)) {
      return this._values[key] as $IntentionalAny
    } else {
      const cachedValue = producer()
      this._values[key] = cachedValue
      return cachedValue
    }
  }

  /**
   * Returns true if the cache has an item at \`key\`.
   */
  has(key: string): boolean {
    return this._values.hasOwnProperty(key)
  }
}`

    const simpleCacheDecl = `declare class SimpleCache {
  /**
   * NOTE this could also be a Map.
   */
  protected _values: Record<string, unknown>;
  constructor();

  /**
   * get the cache item at \`key\` or produce it using \`producer\` and cache _that_.
   *
   * Note that this won't work if you change the producer, like \`get(key, producer1); get(key, producer2)\`.
   */
  get<T>(key: string, producer: () => T): T;

  /**
   * Returns true if the cache has an item at \`key\`.
   */
  has(key: string): boolean;
}`

    if (!code.includes(simpleCacheImpl)) {
      // Fail loudly if upstream changes the emitted shape, so this doesn't silently
      // stop stripping. (The block above must match the d.ts rollup emits verbatim.)
      throw new Error(
        '[strip-implementations] expected inlined SimpleCache implementation not found; update the replacement to match the new emitted shape.',
      )
    }
    code = code.replace(simpleCacheImpl, simpleCacheDecl)

    return code
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
    // Runs after dts/alias have produced the final chunk, so it sees the inlined
    // implementation bodies and strips them before the file is written.
    stripImplementations,
  ],
}

export default config
