import {mangaShadingPresets} from '../../mangaShading'
import type {MangaShadingPreset} from '../../mangaShading'
import type {ViewportRenderMode} from '../../mangaViewport'
import {AgentApiError} from '../errors'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {requireBoolean, requireObject} from '../validation'

export type ViewRenderingState = {
  mode: ViewportRenderMode
  castShadow: boolean
  shadingPreset: MangaShadingPreset
  characterNamesVisible: boolean
}

export type ViewRenderingApi = {
  getRendering(): Promise<ViewRenderingState>
  setRendering(args: Partial<ViewRenderingState>): Promise<ViewRenderingState>
}

declare module '../runtime' {
  interface AgentSceneRuntimeHandlers {
    getRendering(): ViewRenderingState
    setRendering(args: Partial<ViewRenderingState>): ViewRenderingState
  }
}

const presets: string[] = Object.keys(mangaShadingPresets)
const properties = {
  mode: {type: 'string', enum: ['original', 'line']},
  castShadow: {type: 'boolean'},
  shadingPreset: {type: 'string', enum: presets},
  characterNamesVisible: {type: 'boolean'},
}
const outputSchema = {
  type: 'object',
  properties,
  required: Object.keys(properties),
}
const errors = [
  'API_DISPOSED',
  'API_NOT_READY',
  'INVALID_ARGUMENT',
  'SCENE_UNAVAILABLE',
] as const

export function registerViewRenderingCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
) {
  registry.register({
    name: 'view.getRendering',
    kind: 'query',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {type: 'object', additionalProperties: false},
    outputSchema,
    errorCodes: errors,
    validate: (value) => {
      if (value !== undefined && Object.keys(requireObject(value)).length) {
        throw new AgentApiError('INVALID_ARGUMENT', 'view.getRendering 无参数')
      }
    },
    execute: async () => {
      runtime.assertActive()
      const get = runtime.handlers.getRendering
      if (!get) throw new AgentApiError('SCENE_UNAVAILABLE', '漫画视口尚未挂载')
      return get()
    },
  })

  registry.register({
    name: 'view.setRendering',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {type: 'object', properties, additionalProperties: false},
    outputSchema,
    errorCodes: errors,
    validate: (value): Partial<ViewRenderingState> => {
      const args = requireObject(value)
      if (
        !Object.keys(args).length ||
        Object.keys(args).some(
          (key) => !Object.prototype.hasOwnProperty.call(properties, key),
        )
      ) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          '请提供至少一个有效的视口设置',
        )
      }
      const result: Partial<ViewRenderingState> = {}
      if (args.mode !== undefined) {
        if (args.mode !== 'original' && args.mode !== 'line') {
          throw new AgentApiError(
            'INVALID_ARGUMENT',
            'mode 必须为 original 或 line',
          )
        }
        result.mode = args.mode
      }
      if (args.shadingPreset !== undefined) {
        if (
          typeof args.shadingPreset !== 'string' ||
          !presets.includes(args.shadingPreset)
        ) {
          throw new AgentApiError('INVALID_ARGUMENT', '未知的漫画网点预设')
        }
        result.shadingPreset = args.shadingPreset as MangaShadingPreset
      }
      if (args.castShadow !== undefined)
        result.castShadow = requireBoolean(args, 'castShadow')
      if (args.characterNamesVisible !== undefined) {
        result.characterNamesVisible = requireBoolean(
          args,
          'characterNamesVisible',
        )
      }
      if (!Object.keys(result).length)
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          '请提供至少一个有效的视口设置',
        )
      return result
    },
    execute: async (args) => {
      runtime.assertActive()
      const set = runtime.handlers.setRendering
      if (!set) throw new AgentApiError('SCENE_UNAVAILABLE', '漫画视口尚未挂载')
      return set(args)
    },
  })
}
