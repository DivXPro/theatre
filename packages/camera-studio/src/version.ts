/**
 * CAMERA_STUDIO_VERSION 的唯一事实源是 package.json。
 *
 * 不启 resolveJsonModule:tsconfig rootDir=src,JSON import 用 ts-ignore
 * 压掉类型解析;产物保留 ../package.json 相对引用(npm 包必含 package.json)。
 * 宿主打包器(Vite/Rollup/webpack)与 jest-esbuild 都原生处理 JSON;发布脚本
 * 先改 package.json 再构建,产物版本因此自动同步。
 */
// @ts-ignore JSON 不在 rootDir 内;d.ts 只导出 string 常量
import {version} from '../package.json'

export const CAMERA_STUDIO_VERSION: string = version
