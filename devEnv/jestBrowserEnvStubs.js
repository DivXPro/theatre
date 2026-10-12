// 包根冒烟测试(camera-studio/src/smoke.test.ts)在 node 环境经
// `import {App}` 静态求值整条浏览器模块链,这里补齐三样 jest 没有、
// 求值期就碰的东西。全部「仅在不存在时安装」,jsdom 测试环境不受影响。
//
// 1) import.meta.glob:vite 专属语法,CJS 变换后是空对象,顶层调用即
//    TypeError。esbuild define 把 import.meta.glob 换成
//    globalThis.__jestGlobStub(jest.config.js transform 段),这里提供
//    实现,返回空表。camera-studio 2026-10-10 资产目录化后仓内已无
//    消费者;stub 与 define 保留兜底,防止未来引入 glob 的模块在 jest
//    里加载即崩。
globalThis.__jestGlobStub = () => ({})
//
// 2) document:App.tsx 模块顶层 `document.body.style.backgroundColor=...`
//    设置画布底色。冒烟测试不渲染,给个最小真值即可。
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {body: {style: {}}}
}
