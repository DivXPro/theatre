// 资产模块声明:App.tsx `import sceneGLB from './scene.glb'`(vite 按 url
// 加载,类型层面只需要 string)。原 packages/playground/src/playground-globals.d.ts
// 的子集——camera 代码只静态导入 .glb;其余资产(模型 GLB/姿势预览 PNG)
// 自 2026-10-10 目录化后由 StaticCatalogSource 按 URL 直取包内 assets/,
// 不再经 vite 目录 glob。
declare module '*.glb' {
  export default string
}
