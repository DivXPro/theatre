/**
 * 包骨架冒烟:index 公开面可导入。
 *
 * bootstrap 现带 studio 根模块副作用导入(T10 fix round 1:根模块加载即
 * new Studio() 向 core 自注册)——真身进 jsdom 会装全局监听/定时器,
 * jest worker 退不干净。按 R8 裁定与 bootstrap.test.tsx 同款手法替身
 * (jest-esbuild 不提升 jest.mock:doMock + 运行时 import)。
 */
jest.doMock('@dreamerbird/studio', () => ({
  __esModule: true,
}))

test('包骨架可导入,版本号与 package.json 同步', async () => {
  const {version} = require('../package.json') as {version: string}
  const {CAMERA_STUDIO_VERSION} = await import('./index')
  expect(CAMERA_STUDIO_VERSION).toBe(version)
})
