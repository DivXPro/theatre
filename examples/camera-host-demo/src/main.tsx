/**
 * camera-studio 最小宿主 demo:整页 CameraScene + 工具栏返回入口。
 * 集成指南(docs/guides/camera-studio-embedding.md)的配套可跑示例,
 * 运行(仓库根):pnpm --filter camera-host-demo dev
 *
 * 演示点:
 * - storage: 使用独立的 IndexedDB 命名空间保存资产;
 * - assets.baseUrl: 不传 = 包内缺省 assets/(上架 CDN 的写法见指南 §4);
 * - sync: false:协作关闭(缺省即 false,这里显式写出);
 * - onError: 模块错误交给宿主自己的提示条(不内置错误条)。
 */
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import ReactDOM from 'react-dom/client'
import {getLanguage, onLanguageChange} from '@dreamerbird/studio/i18n'
import {
  useCameraStudio,
  CameraScene,
  loadSceneSyncState,
  resetCameraStudio,
  setCameraStudioLocale,
  type CameraStudioAgentBridgeConfig,
  type CameraStudioError,
  type CameraStudioExport,
  type SceneSyncAdapter,
  type SceneSyncSnapshot,
  type SceneSyncState,
} from '@dreamerbird/camera-studio'
import {createDemoSceneSyncAdapter} from './sceneSync'
import hostMessages from './hostMessages.json'
import './host-nav.css'

/**
 * Agent HTTP 桥接(可选,默认关闭):三个 Vite 环境变量齐全才连接本机桥接
 * 进程,任一缺失都保持浏览器默认行为(不连桥接、不挂全局),demo 照常可用。
 * 部署方式与 curl 示例见 docs/guides/camera-studio-agent-http.md。
 *
 *   VITE_CAMERA_STUDIO_AGENT_WS    桥接 WebSocket 地址(ws://127.0.0.1:43110)
 *   VITE_CAMERA_STUDIO_AGENT_HTTP  桥接 HTTP 地址(http://127.0.0.1:43110)
 *   VITE_CAMERA_STUDIO_AGENT_TOKEN Bearer 凭据(部署方注入,勿提交真实密钥)
 */
function bridgeConfigFromEnv(): CameraStudioAgentBridgeConfig | undefined {
  const url = import.meta.env.VITE_CAMERA_STUDIO_AGENT_WS
  const httpUrl = import.meta.env.VITE_CAMERA_STUDIO_AGENT_HTTP
  const token = import.meta.env.VITE_CAMERA_STUDIO_AGENT_TOKEN
  if (!url || !httpUrl || !token) return undefined
  return {url, httpUrl, token}
}
const agentBridge = bridgeConfigFromEnv()

// 资产和场景状态各自保存，重新打开页面仍可放置同一资产。
const assetStorage = {namespace: 'camera-host-demo'}

function createMemorySceneAdapter(): SceneSyncAdapter {
  let snapshot: SceneSyncSnapshot | null = null
  let revision = 0
  return {
    async load() {
      return snapshot
    },
    async commit({content}) {
      snapshot = {content, revision: String(++revision)}
      return {revision: snapshot.revision}
    },
  }
}

async function loadSceneState(): Promise<{
  adapter: SceneSyncAdapter
  sync: SceneSyncState
}> {
  const url = import.meta.env.VITE_CAMERA_STUDIO_STATE_URL
  const adapter = url
    ? createDemoSceneSyncAdapter(url)
    : createMemorySceneAdapter()
  return {
    adapter,
    sync: await loadSceneSyncState(adapter, {throttleMs: 0}),
  }
}

function saveExport({blob, fileName}: CameraStudioExport) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  try {
    link.click()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

type SyncPhase =
  | 'idle'
  | 'remote'
  | 'reloading'
  | 'updated'
  | 'conflict'
  | 'error'

function getHostMessages(locale: string): typeof hostMessages.en {
  return hostMessages[locale as keyof typeof hostMessages] ?? hostMessages.en
}

/** 宿主自己的错误提示组件:模块只上告结构化错误,不规定 UI 形态 */
function HostErrorToast({
  error,
  onClose,
  messages,
}: {
  error: CameraStudioError
  onClose: () => void
  messages: typeof hostMessages.en
}) {
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 56,
        right: 16,
        zIndex: 2000, // 高过模块停靠框基准(1000),由宿主自己掌握层级
        maxWidth: 360,
        padding: '10px 12px',
        borderRadius: 6,
        background: 'var(--camera-host-error-background, #3b2323)',
        border: '1px solid var(--camera-host-error-border, #8a4b4b)',
        color: 'var(--camera-host-error-text, #ffd7d7)',
        font: '13px/1.5 system-ui, sans-serif',
        boxShadow: '0 8px 24px rgba(0,0,0,.35)',
      }}
    >
      <strong style={{display: 'block', marginBottom: 4}}>
        {messages[error.source]} ({error.code})
      </strong>
      {error.message}
      <button
        type="button"
        onClick={onClose}
        style={{
          float: 'right',
          marginLeft: 12,
          border: 0,
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        {messages.close}
      </button>
    </div>
  )
}

type StudioControls = {
  ready: boolean
  flushState(): Promise<void>
  hasTemporaryChanges(): boolean
}

function StudioRoute({
  sync,
  phase,
  controlsRef,
  onReady,
  onSceneClosed,
  locale,
}: {
  sync: SceneSyncState
  phase: SyncPhase
  controlsRef: {current: StudioControls | undefined}
  onReady: () => void
  onSceneClosed: () => void
  locale: string
}) {
  const messages = getHostMessages(locale)
  const [notice, setNotice] = useState<CameraStudioError | null>(null)
  const {ready, error, sceneProps, flushState, hasTemporaryChanges} =
    useCameraStudio({
      project: 'Space',
      storage: assetStorage,
      state: sync,
      // assets: {baseUrl: 'https://cdn.example.com/camera-assets/'} ← §4 CDN 写法
      sync: false,
      onError: setNotice,
      onSceneClosed,
      onSaveExport: saveExport,
      // 桥接配置缺失时是 undefined:浏览器默认不连桥接(spec §4/§10.4)。
      // 桥接模式下同时挂 window.__cameraStudioApi(exposeGlobal):端到端
      // 验收用它扮演「另一个写入者」制造 revision 冲突;不连桥接时不挂
      ...(agentBridge
        ? {agent: {bridge: agentBridge, exposeGlobal: true}}
        : {}),
    })

  useEffect(() => {
    const controls: StudioControls = {ready, flushState, hasTemporaryChanges}
    controlsRef.current = controls
    return () => {
      if (controlsRef.current === controls) controlsRef.current = undefined
    }
  }, [controlsRef, ready, flushState, hasTemporaryChanges])

  // 等 controls 先就位,父组件收到 ready 后才能安全地 flush/检查脏状态。
  useEffect(() => {
    if (ready) onReady()
  }, [ready, onReady])

  if (error) throw error
  if (!ready) return null
  return (
    <>
      {notice && (
        <HostErrorToast
          error={notice}
          onClose={() => setNotice(null)}
          messages={messages}
        />
      )}
      <CameraScene {...sceneProps} />
      <span className="camera-host-nav__status" role="status">
        {phase === 'idle' ? '' : messages[phase]}
      </span>
    </>
  )
}

function App({
  adapter,
  initialSync,
}: {
  adapter: SceneSyncAdapter
  initialSync: SceneSyncState
}) {
  const [sync, setSync] = useState(initialSync)
  const [generation, setGeneration] = useState(0)
  const [phase, setPhase] = useState<SyncPhase>('idle')
  const [studioReady, setStudioReady] = useState(false)
  const [sceneClosed, setSceneClosed] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string>()
  const locale = useSyncExternalStore(onLanguageChange, getLanguage)
  const messages = getHostMessages(locale)
  const [remoteRevision, setRemoteRevision] = useState<string>()
  const controlsRef = useRef<StudioControls | undefined>(undefined)
  const handledRevision = useRef<string | undefined>(undefined)
  const onStudioReady = useCallback(() => setStudioReady(true), [])
  const onSceneClosed = useCallback(() => {
    setSceneClosed(true)
    setStudioReady(false)
    setPhase('idle')
  }, [])
  useEffect(() => {
    document.documentElement.lang = locale
    document.title = messages.webTitle
  }, [locale, messages.webTitle])
  const openScene = async () => {
    setOpening(true)
    setOpenError(undefined)
    try {
      setSync(await loadSceneSyncState(adapter, {throttleMs: 0}))
      handledRevision.current = remoteRevision
      setGeneration((value) => value + 1)
      setSceneClosed(false)
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error))
    } finally {
      setOpening(false)
    }
  }

  useEffect(() => {
    const subscribe = adapter.subscribe
    if (!subscribe) return
    return subscribe(setRemoteRevision)
  }, [adapter])

  // 收到远端版本后先 flush 本页的尾部保存，再判断是否有未保存编辑。
  // 空闲页直接进入 reloading；有编辑只提示，绝不覆盖当前场景。
  useEffect(() => {
    if (!remoteRevision || sceneClosed) return
    if (remoteRevision === handledRevision.current) return
    if (phase === 'reloading') return
    const controls = controlsRef.current
    if (!studioReady || !controls?.ready) {
      setPhase('remote')
      return
    }

    let cancelled = false
    void (async () => {
      try {
        await controls.flushState()
      } catch {
        if (cancelled) return
        handledRevision.current = remoteRevision
        setPhase('conflict')
        return
      }
      if (cancelled) return
      if (sync.hasUnsavedChanges() || controls.hasTemporaryChanges()) {
        handledRevision.current = remoteRevision
        setPhase('conflict')
        return
      }
      handledRevision.current = remoteRevision
      setStudioReady(false)
      setPhase('reloading')
    })()
    return () => {
      cancelled = true
    }
  }, [remoteRevision, sceneClosed, sync, phase, studioReady])

  // StudioRoute 已因 phase=reloading 卸载，消费者计数归零后再 reset，
  // 然后用新快照重新 boot 一个同 id 项目。
  useEffect(() => {
    if (phase !== 'reloading') return
    let cancelled = false
    void (async () => {
      try {
        await resetCameraStudio()
        const next = await loadSceneSyncState(adapter, {throttleMs: 0})
        if (cancelled) return
        setSync(next)
        setGeneration((value) => value + 1)
        setPhase('updated')
      } catch (error) {
        if (cancelled) return
        console.error('[camera-host-demo] 加载最新场景失败', error)
        // reset 已拆掉旧会话：用旧快照重新挂载，至少不让页面空着。
        setGeneration((value) => value + 1)
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase, adapter])

  useEffect(() => {
    if (phase !== 'updated') return
    const timer = window.setTimeout(() => setPhase('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [phase])

  if (sceneClosed) {
    return (
      <main className="camera-host-nav__home">
        <button type="button" onClick={openScene} disabled={opening}>
          {opening ? messages.opening : messages.open}
        </button>
        {openError && <p role="alert">{openError}</p>}
      </main>
    )
  }

  return (
    <div>
      {phase === 'reloading' ? (
        <div
          style={{
            padding: 24,
            color: 'var(--camera-host-text, #9aa0a6)',
            font: '13px/1.5 system-ui, sans-serif',
          }}
        >
          {messages.reloading}
        </div>
      ) : (
        <StudioRoute
          key={generation}
          sync={sync}
          phase={phase}
          controlsRef={controlsRef}
          onReady={onStudioReady}
          onSceneClosed={onSceneClosed}
          locale={locale}
        />
      )}
    </div>
  )
}

// 以宿主页面声明的语言为初值。宿主运行时可调用同一个 API 更新语言。
setCameraStudioLocale(document.documentElement.lang || 'en')
const root = ReactDOM.createRoot(document.getElementById('root')!)
void loadSceneState().then(
  ({adapter, sync}) =>
    root.render(<App adapter={adapter} initialSync={sync} />),
  (error: Error) => root.render(<p role="alert">{error.message}</p>),
)
