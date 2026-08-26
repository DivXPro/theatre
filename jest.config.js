/** @type {import('jest').Config} */
module.exports = {
  testMatch: [
    '<rootDir>/packages/*/src/**/*.test.ts',
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
    'node_modules/(?!(property-graph|@gltf-transform)/)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'json', 'node'],
}
