import React, {useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {CameraScene} from './CameraScene'
import {resetCameraStudio} from './bootstrap'
import {useCameraStudio} from './useCameraStudio'
import {setCameraStudioLocale} from './i18n'
import type {CameraStudioApi} from './agent/api'
import type {
  CameraStudioConfig,
  CameraStudioExport,
  CameraStudioHandle,
} from './config'

/** Snapshot supplied by the desktop host. Omit initialState for a new scene. */
export type CameraStudioDesktopScene = {
  projectId: string
  initialState?: unknown
}

/** Export payload suitable for a native IPC call. */
export type CameraStudioDesktopExport = {
  projectId: string
  kind: 'image' | 'video'
  fileName: string
  mimeType: string
  data: ArrayBuffer
}

/** Implement these callbacks in the host or forward them to its IPC client. */
export type CameraStudioDesktopHost = {
  saveScene(scene: {projectId: string; state: unknown}): void | Promise<void>
  saveExport(output: CameraStudioDesktopExport): void | Promise<void>
  sceneClosed(scene: {projectId: string}): void | Promise<void>
}

export type CameraStudioDesktopOptions = Pick<
  CameraStudioConfig,
  'assets' | 'storage' | 'scene' | 'ui' | 'onError' | 'flows'
>

export type CameraStudioDesktop = {
  /** Available after openScene resolves. Keep this object in the WebView. */
  readonly api: CameraStudioApi | undefined
  /** Open the host's snapshot. Close the current scene before opening another. */
  openScene(scene: CameraStudioDesktopScene): Promise<void>
  closeScene(): Promise<void>
  setLocale(locale: string): void
  /** Deliver a programmatic export result through the same path as the toolbar. */
  saveExport(output: CameraStudioExport): Promise<void>
  /** Close and release this handle. A failed save leaves the scene open. */
  dispose(): Promise<void>
}

type SceneControls = Pick<CameraStudioHandle, 'api' | 'closeScene'>

type OpeningScene = {
  projectId: string
  ready: Promise<SceneControls>
  api?: CameraStudioApi
}

function DesktopScene({
  config,
  onReady,
  onError,
}: {
  config: CameraStudioConfig
  onReady: (handle: SceneControls) => void
  onError: (error: unknown) => void
}) {
  const handle = useCameraStudio(config)
  const {api, ready, error, closeScene} = handle
  useEffect(() => {
    if (error) onError(error)
    if (!ready) return
    let mounted = true
    void api.ready.then(
      () => {
        if (mounted) onReady({api, closeScene})
      },
      (cause) => {
        if (mounted) onError(cause)
      },
    )
    return () => {
      mounted = false
    }
  }, [api, ready, error, closeScene, onReady, onError])
  return ready ? (
    <CameraScene {...handle.sceneProps} demoDracoDecoderPath="/draco/" />
  ) : null
}

/** Mount Camera Studio in a desktop WebView using only the host's local adapter. */
export function mountCameraStudioDesktop(
  container: HTMLElement,
  host: CameraStudioDesktopHost,
  options: CameraStudioDesktopOptions = {},
): CameraStudioDesktop {
  let scene: OpeningScene | undefined
  let locale = options.ui?.locale
  let disposed = false
  let disposing: Promise<void> | undefined

  async function closeScene() {
    const opening = scene
    if (opening) await (await opening.ready).closeScene()
  }

  async function saveExport(
    projectId: string,
    {blob, kind, fileName, mimeType}: CameraStudioExport,
  ) {
    await host.saveExport({
      projectId,
      kind,
      fileName,
      mimeType,
      data: await blob.arrayBuffer(),
    })
  }

  return {
    get api() {
      return scene?.api
    },
    async openScene({projectId, initialState}) {
      if (disposed || disposing)
        throw new Error('Camera Studio desktop is disposed')
      if (scene)
        throw new Error(
          'Close the current Camera Studio scene before opening another',
        )
      let resolveReady!: (handle: SceneControls) => void
      let rejectReady!: (error: unknown) => void
      const opening: OpeningScene = {
        projectId,
        ready: new Promise((resolve, reject) => {
          resolveReady = resolve
          rejectReady = reject
        }),
      }
      const root = createRoot(container, {
        onUncaughtError(error) {
          rejectReady(error)
          if (opening.api) console.error(error)
        },
      })
      scene = opening
      const config: CameraStudioConfig = {
        ...options,
        agent: undefined,
        sync: false,
        project: projectId,
        ui: {...options.ui, locale},
        state: {
          initialState,
          onStateChange: (state) => host.saveScene({projectId, state}),
        },
        async onSceneClosed(event) {
          root.unmount()
          scene = undefined
          await host.sceneClosed(event)
        },
        onSaveExport: (output) => saveExport(projectId, output),
      }
      root.render(
        <DesktopScene
          config={config}
          onReady={resolveReady}
          onError={rejectReady}
        />,
      )
      try {
        opening.api = (await opening.ready).api
        // An IPC language change can arrive while the initial scene is mounting.
        if (locale) setCameraStudioLocale(locale)
      } catch (error) {
        root.unmount()
        // Release a partially booted snapshot before accepting another one.
        await resetCameraStudio().catch(() => {})
        scene = undefined
        throw error
      }
    },
    closeScene,
    setLocale(nextLocale) {
      locale = nextLocale
      setCameraStudioLocale(nextLocale)
    },
    async saveExport(output) {
      if (!scene?.api) throw new Error('Camera Studio scene is not ready')
      await saveExport(scene.projectId, output)
    },
    dispose() {
      if (!disposing) {
        disposing = closeScene()
          .then(() => {
            disposed = true
          })
          .finally(() => {
            disposing = undefined
          })
      }
      return disposing
    },
  }
}
