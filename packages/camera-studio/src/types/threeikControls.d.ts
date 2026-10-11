/**
 * @dreamerbird/threeik 的 ./controls 子路径只有 exports.import 条件里的 types,
 * 仓库用的 node10 moduleResolution 不认 exports 映射,直接 import 会 TS2307。
 * 这里把 '@dreamerbird/threeik/controls' 映射到包内可被 node10 按文件路径
 * 解析的 dist/controls/index.d.ts(参照 draco3dgltf.d.ts 的 shim 先例)。
 */
declare module '@dreamerbird/threeik/controls' {
  export * from '@dreamerbird/threeik/dist/controls/index'
}
