import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react-swc'
import {getAliasesFromTsConfigForRollup} from '../../devEnv/getAliasesFromTsConfig'
import {definedGlobals} from '../../packages/core/devEnv/definedGlobals'

// monorepo 内的解析与 playground 同款:@dreamerbird/* 别名从
// tsconfig.base.json 的 paths 派生(getAliasesFromTsConfigForRollup),
// 不手写死路径;产物包发布形态下不需要这段(走 node_modules 与 exports)。
export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.gltf', '**/*.glb', '**/*.fbx'],
  resolve: {
    alias: [...getAliasesFromTsConfigForRollup()],
  },
  define: {
    ...definedGlobals,
  },
  optimizeDeps: {
    exclude: ['@dreamerbird/core', '@dreamerbird/studio'],
  },
})
