/** @type {import('jest').Config} */
module.exports = {
  testMatch: [
    '<rootDir>/packages/*/src/**/*.test.ts',
    '<rootDir>/packages/*/src/**/*.test.tsx',
    '<rootDir>/devEnv/**/*.test.ts',
  ],
  moduleNameMapper: {
    ...require('./devEnv/getAliasesFromTsConfig').getAliasesFromTsConfigForJest(),
    '\\.(css|svg|png|glb)$': 'identity-obj-proxy',
    'lodash-es/(.*)': 'lodash/$1',
    'react-use/esm/(.*)': 'react-use/lib/$1',
    'lodash-es': 'lodash',
    // ES modules that jest can't handle at the moment.
    uuid: '<rootDir>/node_modules/uuid/dist/index.js',
    nanoid: '<rootDir>/node_modules/nanoid/index.cjs',
    'nanoid/non-secure': '<rootDir>/node_modules/nanoid/non-secure/index.cjs',
    // ESM-only exports(只有 import 条件):直接指到 dist,靠 transformIgnorePatterns 例外转 CJS
    '^@dreamerbird/threeik$':
      '<rootDir>/node_modules/@dreamerbird/threeik/dist/index.js',
    '^@dreamerbird/threeik/controls$':
      '<rootDir>/node_modules/@dreamerbird/threeik/dist/controls/index.js',
    'react-icons/(.*)': 'identity-obj-proxy',
    'react-merge-refs': 'identity-obj-proxy',
    '@trpc/client': 'identity-obj-proxy',
    oauth4webapi: 'identity-obj-proxy',
  },
  setupFiles: [
    // 必须在最前:transform 段用 esbuild define 把 import.meta.glob 指到
    // 本文件在 globalThis 上安装的 stub,setup 顺序保证测试模块求值前已就位
    './devEnv/jestBrowserEnvStubs.js',
    './packages/studio/src/integration-tests/setupIntegrationTestEnv.ts',
  ],
  automock: false,
  transform: {
    '^.+\\.tsx?$': [
      'jest-esbuild',
      {
        sourcemap: true,
        target: 'es2020',
        supported: {
          'dynamic-import': false,
        },
        // vite 专属 import.meta.glob 在 jest 里求值即崩(camera-studio
        // 顶层调用):换成 devEnv/jestBrowserEnvStubs.js 安装的 stub
        define: {
          'import.meta.glob': 'globalThis.__jestGlobStub',
        },
      },
    ],
    '^.+\\.js$': [
      'jest-esbuild',
      {
        sourcemap: true,
        target: 'es2020',
        supported: {
          'dynamic-import': false,
        },
        // 与上面 tsx? 段保持逐字一致:jest 的 transformer 缓存按模块路径
        // 归并,两段指同一 jest-esbuild,选项不同会互相覆盖
        define: {
          'import.meta.glob': 'globalThis.__jestGlobStub',
        },
      },
    ],
    '^.+\\.mjs$': './devEnv/jestMjsTransformer.js',
  },
  transformIgnorePatterns: [
    // three/examples/jsm:threeik 0.1.0 操纵器换芯 TransformControls 后
    // 依赖链上的纯 ESM(three 主包走 require 条件是 CJS,无需例外)。
    // pnpm 布局:jest 按 realpath 取路,真实路径带 .pnpm 段且作用域编码
    // 为 +(如 @dreamerbird+threeik@0.2.1),例外名单要按编码后的写法给。
    'node_modules/\\.pnpm/(?!(property-graph@|three@|@gltf-transform\\+|@dreamerbird\\+threeik@))',
    // 直接布局(npm/yarn 或 symlink 未被 realpath 时)
    'node_modules/(?!\\.pnpm)(?!(property-graph|@gltf-transform|@dreamerbird/threeik|three/examples)/)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'json', 'node'],
}
