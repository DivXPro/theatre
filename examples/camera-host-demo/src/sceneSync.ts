import {HttpPatchAdapter, HttpSnapshotAdapter} from '@dreamerbird/camera-studio'
import type {SceneSyncAdapter} from '@dreamerbird/camera-studio'
import {
  sceneClientIdHeader,
  sceneRevisionPath,
  sceneStatePath,
  type SceneRevisionNotice,
} from './sceneRevisionProtocol'

export function createDemoSceneSyncAdapter(url: string): SceneSyncAdapter {
  if (url !== sceneStatePath) return new HttpSnapshotAdapter(url)

  const clientId = crypto.getRandomValues(new Uint32Array(4)).join('-')
  const http = new HttpPatchAdapter(url, (input, init) => {
    if (init?.method !== 'PUT' && init?.method !== 'PATCH')
      return fetch(input, init)
    const headers = new Headers(init.headers)
    headers.set(sceneClientIdHeader, clientId)
    return fetch(input, {...init, headers})
  })
  let localRevision: string | undefined

  return {
    async load() {
      const snapshot = await http.load()
      localRevision = snapshot?.revision
      return snapshot
    },
    async commit(change) {
      const result = await http.commit(change)
      localRevision = result.revision
      return result
    },
    async commitPatch(change) {
      const result = await http.commitPatch(change)
      localRevision = result.revision
      return result
    },
    subscribe(onRevision) {
      const endpoint = new URL(sceneRevisionPath, window.location.href)
      endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:'
      let active = true
      let socket: WebSocket | undefined
      let retry: number | undefined
      let lastNotified: string | undefined

      const connect = () => {
        socket = new WebSocket(endpoint)
        socket.addEventListener('message', ({data}) => {
          if (!active || typeof data !== 'string') return
          let notice: SceneRevisionNotice | null
          try {
            notice = JSON.parse(data)
          } catch {
            return
          }
          const revision = notice?.revision
          if (
            typeof revision === 'string' &&
            revision !== localRevision &&
            revision !== lastNotified &&
            notice?.clientId !== clientId
          ) {
            lastNotified = revision
            onRevision(revision)
          }
        })
        socket.addEventListener('close', () => {
          if (active) retry = window.setTimeout(connect, 1000)
        })
      }
      connect()
      return () => {
        active = false
        window.clearTimeout(retry)
        socket?.close()
      }
    },
  }
}
