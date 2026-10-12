// camera-studio 冒烟/组件测试在 node 环境经包根 `import {CameraScene}`
// 静态求值整条浏览器模块链,这里补齐两样 jest 没有、模块求值期可能碰
// 的东西。全部「仅在不存在时安装」,jsdom 测试环境不受影响。
//
// 1) import.meta.glob:vite 专属语法,CJS 变换后是空对象,顶层调用即
//    TypeError。esbuild define 把 import.meta.glob 换成
//    globalThis.__jestGlobStub(jest.config.js transform 段),这里提供
//    实现,返回空表。camera-studio 2026-10-10 资产目录化后仓内已无
//    消费者;stub 与 define 保留兜底,防止未来引入 glob 的模块在 jest
//    里加载即崩。
globalThis.__jestGlobStub = () => ({})
//
// 2) document:纯 node 环境的兜底——模块链求值期若碰 DOM(如未来的
//    模块顶层样式注入),给个最小真值即可不崩。当前 CameraScene 链已
//    无顶层 DOM 访问(T10 摘掉画布底色),jsdom 环境自带 document 也
//    不会走到这里。
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {body: {style: {}}}
}
