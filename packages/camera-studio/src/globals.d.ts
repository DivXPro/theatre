// 资产模块声明:App.tsx `import sceneGLB from './scene.glb'`(vite 按 url
// 加载,类型层面只需要 string)。原 packages/playground/src/playground-globals.d.ts
// 的子集——camera 代码只静态导入 .glb,其余格式(png/fbx 等)走
// import.meta.glob 字符串,不经模块解析。
declare module '*.glb' {
  export default string
}

// vite 的 import.meta.glob 类型补充:本包 tsconfig 不含 vite/client
// 类型,而 seedBuiltinModels/poseThumbsQbxUrls 顶层调用 import.meta.glob。
// 只作类型声明——jest 下的运行期替身见 devEnv/jestBrowserEnvStubs.js,
// 浏览器下由 vite 实现;后续任务移除 glob 后可删。
interface ImportMeta {
  glob(
    pattern: string,
    options?: {eager?: boolean; as?: string},
  ): Record<string, unknown>
}
