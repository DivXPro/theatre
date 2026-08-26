const {transformSync} = require('esbuild')

/**
 * jest-esbuild 0.3.0 的 isTarget 只认 .js/.jsx/.ts/.tsx,遇到 ESM-only 的
 * .mjs 依赖(如 property-graph)会原样返回,导致 Jest 把 ESM 当 CJS 执行失败。
 * 这个轻量 transformer 专门把 .mjs 转成 CJS,补全这一条链路。
 */
module.exports = {
  process(sourceText, sourcePath) {
    const result = transformSync(sourceText, {
      format: 'cjs',
      target: 'es2020',
      sourcemap: true,
      loader: 'js',
      sourcefile: sourcePath,
    })
    return {code: result.code, map: result.map}
  },
}
