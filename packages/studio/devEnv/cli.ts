import {copyFile, mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import sade from 'sade'
import {path, $} from '@cspotcode/zx'
import * as esbuild from 'esbuild'
// eslint-disable-next-line no-relative-imports
import {definedGlobals} from '../../core/devEnv/definedGlobals'

const packageRoot = path.join(
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

const prog = sade('cli')

prog
  .command('build js', 'Generate the .js bundle')
  .option('--watch', 'Watch')
  .action(async (opts) => {
    await bundle(opts.watch)
  })

prog.command('build ts', 'Generate the .d.ts bundles').action(async () => {
  await bundleTypes()
})

prog.command('build', 'Generate the .js and .d.ts bundles').action(async () => {
  await Promise.all([bundle(false), bundleTypes()])
})

prog.parse(process.argv)

async function bundleTypes() {
  await $`tsc --build`
  const dist = path.join(packageRoot, 'dist')
  await mkdir(dist, {recursive: true})
  await Promise.all([
    copyFile(
      path.join(packageRoot, '.temp/declarations/src/index.d.ts'),
      path.join(dist, 'index.d.ts'),
    ),
    $`rollup -c devEnv/declarations-bundler/rollup.config.js --bundleConfigAsCjs`,
  ])
}

async function bundle(watch: boolean) {
  const esbuildConfig: Parameters<typeof esbuild.context>[0] = {
    entryPoints: {
      index: path.join(packageRoot, 'src/index.ts'),
      'camera-studio': path.join(packageRoot, 'src/publishedRuntime.ts'),
      i18n: path.join(packageRoot, 'src/i18n/index.ts'),
    },
    target: ['es6'],
    loader: {'.png': 'dataurl', '.svg': 'dataurl'},
    bundle: true,
    platform: 'node',
    mainFields: ['browser', 'module', 'main'],
    conditions: ['browser'],
    sourcemap: true,
    supported: {
      // 'unicode-escapes': false,
      'template-literal': false,
    },
    define: {
      ...definedGlobals,
      __IS_VISUAL_REGRESSION_TESTING: 'false',
      'process.env.NODE_ENV': '"production"',
    },
    external: [
      '@dreamerbird/dataverse',
      '@dreamerbird/core',
      'react',
      'react-dom',
      'styled-components',
    ],
    plugins: [
      {
        name: 'shared-studio-entries',
        setup(build) {
          build.onResolve({filter: /^\.\/registration$/}, ({importer}) =>
            importer === path.join(packageRoot, 'src/index.ts')
              ? {path: './camera-studio.js', external: true}
              : undefined,
          )
          build.onResolve({filter: /^@dreamerbird\/studio\/i18n$/}, () => ({
            path: './i18n.js',
            external: true,
          }))
        },
      },
    ],
    minify: true,
  }

  const ctx = await esbuild.context({
    ...esbuildConfig,
    outdir: path.join(packageRoot, 'dist'),
    format: 'cjs',
  })

  if (watch) {
    await ctx.watch()
  } else {
    await ctx.rebuild()
    await ctx.dispose()
  }
}
