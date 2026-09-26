/**
 * 公共 API 透传:undo/redo 直达内部 Studio;unsequenceProp 走
 * setPrimitivePropAsStatic(删轨道+当前值落静态)。
 * jest-esbuild 不提升 jest.mock:doMock + resetModules + 运行时 require。
 *
 * 注:TheatreStudio.ts 用的是 `import getStudio from './getStudio'`(默认导出),
 * 所以 doMock 的路径与导出形状以实际模块为准。
 */
import type {$IntentionalAny} from '@dreamerbird/core/types/public'

describe('TheatreStudio public api passthroughs', () => {
  function setup() {
    jest.resetModules()
    const undo = jest.fn()
    const redo = jest.fn()
    const setPrimitivePropAsStatic = jest.fn()
    jest.doMock('./getStudio', () => ({
      __esModule: true,
      default: () => ({undo, redo}),
    }))
    // TheatreStudio.ts 是 `export default class`,取 .default
    const {default: TheatreStudio} =
      require('./TheatreStudio') as $IntentionalAny
    return {undo, redo, setPrimitivePropAsStatic, TheatreStudio}
  }

  test('publicApi.undo/redo 透传到内部 Studio', () => {
    const {undo, redo, TheatreStudio} = setup()
    const api = new TheatreStudio(undefined)
    api.undo()
    api.redo()
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
  })
})
