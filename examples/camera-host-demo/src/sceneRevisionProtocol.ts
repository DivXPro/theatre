export const sceneStatePath = '/api/scene'
export const sceneRevisionPath = `${sceneStatePath}/revisions`
export const sceneClientIdHeader = 'x-scene-client-id'

export interface SceneRevisionNotice {
  revision: string
  clientId?: string
}
