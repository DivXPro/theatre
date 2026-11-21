import {homedir} from 'node:os'
import {resolve} from 'node:path'
import {defineConfig, loadEnv} from 'vite'
import react from '@vitejs/plugin-react-swc'
import {getAliasesFromTsConfigForRollup} from '../../devEnv/getAliasesFromTsConfig'
import {definedGlobals} from '../../packages/core/devEnv/definedGlobals'
import {createSceneStateServer} from './devEnv/sceneStateServer'
import {sceneStatePath} from './src/sceneRevisionProtocol'

// monorepo 内的解析与 playground 同款:@dreamerbird/* 别名从
// tsconfig.base.json 的 paths 派生(getAliasesFromTsConfigForRollup),
// 不手写死路径;产物包发布形态下不需要这段(走 node_modules 与 exports)。
export default defineConfig(({mode}) => {
  const env = loadEnv(mode, __dirname, '')
  const sceneFile = resolve(
    env.CAMERA_HOST_DEMO_STATE_FILE ||
      resolve(homedir(), '.camera-host-demo', 'scene.json'),
  )
  return {
    plugins: [
      react(),
      env.VITE_CAMERA_STUDIO_STATE_URL === sceneStatePath && {
        name: 'camera-host-demo-scene-state',
        configureServer(server) {
          const {middleware, attach} = createSceneStateServer(sceneFile)
          server.middlewares.use(middleware)
          if (server.httpServer) attach(server.httpServer)
        },
        configurePreviewServer(server) {
          const {middleware, attach} = createSceneStateServer(sceneFile)
          server.middlewares.use(middleware)
          attach(server.httpServer)
        },
      },
    ],
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
  }
})
