/** @type {import('jest').Config} */
module.exports = {
  testMatch: [
    '<rootDir>/packages/*/src/**/*.test.ts',
    '<rootDir>/packages/*/src/**/*.test.tsx',
    '<rootDir>/devEnv/**/*.test.ts',
  ],
  moduleNameMapper: {
    ...require('./devEnv/getAliasesFromTsConfig').getAliasesFromTsConfigForJest(),
    '\\.(css|svg|png)$': 'identity-obj-proxy',
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
      },
    ],
    '^.+\\.mjs$': './devEnv/jestMjsTransformer.js',
  },
  transformIgnorePatterns: [
    // three/examples/jsm:threeik 0.1.0 操纵器换芯 TransformControls 后
    // 依赖链上的纯 ESM(three 主包走 require 条件是 CJS,无需例外)
    'node_modules/(?!(property-graph|@gltf-transform|@dreamerbird/threeik|three/examples)/)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'json', 'node'],
}
