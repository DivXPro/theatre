/**
 * camera-studio 最小宿主 demo:顶部宿主导航条 + 整页 CameraScene。
 * 集成指南(docs/guides/camera-studio-embedding.md)的配套可跑示例,
 * 运行(仓库根):pnpm --filter camera-host-demo dev
 *
 * 演示点:
 * - storage: 自定义可写存储(内存版,刷新即失;生产换 HTTP 实现);
 * - assets.baseUrl: 不传 = 包内缺省 assets/(上架 CDN 的写法见指南 §4);
 * - sync: false:协作关闭(缺省即 false,这里显式写出);
 * - onError: 模块错误交给宿主自己的提示条(不内置错误条)。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react'
import ReactDOM from 'react-dom/client'
import {
  useCameraStudio,
  CameraScene,
  loadSceneSyncState,
  resetCameraStudio,
  type CameraStudioAgentBridgeConfig,
  type CameraStudioError,
  type SceneSyncAdapter,
  type SceneSyncState,
} from '@dreamerbird/camera-studio'
import {MemorySource} from './memorySource'
import {createDemoSceneSyncAdapter} from './sceneSync'

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

// 宿主视觉决定:页面底色(库不替宿主页面着色)
document.body.style.backgroundColor = '#171717'

// 存储实例放模块级:重挂页面不丢库;两个 useCameraStudio 共享同一源也行,
// 单页单实例约束下只有一个消费者。
const memoryStorage = new MemorySource()

async function loadSceneState(): Promise<{
  adapter?: SceneSyncAdapter
  sync?: SceneSyncState
}> {
  const url = import.meta.env.VITE_CAMERA_STUDIO_STATE_URL
  if (!url) return {}
  const adapter = createDemoSceneSyncAdapter(url)
  return {
    adapter,
    sync: await loadSceneSyncState(adapter, {throttleMs: 0}),
  }
}

type SyncPhase =
  | 'idle'
  | 'remote'
  | 'reloading'
  | 'updated'
  | 'conflict'
  | 'error'

function syncNotice(phase: SyncPhase): string {
  switch (phase) {
    case 'remote':
      return '场景有新版本，等待编辑器就绪后自动加载'
    case 'reloading':
      return '正在加载最新场景…'
    case 'updated':
      return '场景已更新'
    case 'conflict':
      return '场景有新版本，当前编辑未保存，未自动覆盖'
    case 'error':
      return '加载最新场景失败，请刷新重试'
    default:
      return ''
  }
}

/** 宿主应用自己的顶栏——嵌入单位是「整页/整路由」时,顶栏仍在文档流里,
 * 但 studio 覆盖层铺满视口(z-100)会压在它上面:这是预期行为,不是
 * z-index bug,见指南「约束」一节。 */
function HostNav({phase}: {phase: SyncPhase}) {
  return (
    <header
      style={{
        height: 44,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 16px',
        boxSizing: 'border-box',
        background: '#1d1f24',
        borderBottom: '1px solid #33363c',
        color: '#e8e8e8',
        font: '13px/1.4 system-ui, sans-serif',
      }}
    >
      <strong style={{fontSize: 14}}>宿主应用</strong>
      <span style={{color: '#9aa0a6'}}>相机工作台(嵌入整页路由)</span>
      <span style={{flex: 1}} />
      <span role="status" style={{color: '#badaff'}}>
        {syncNotice(phase)}
      </span>
      <a href="#" style={{color: '#9aa0a6', textDecoration: 'none'}}>
        返回首页
      </a>
    </header>
  )
}

/** 宿主自己的错误提示组件:模块只上告结构化错误,不规定 UI 形态 */
function HostErrorToast({
  error,
  onClose,
}: {
  error: CameraStudioError
  onClose: () => void
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
        background: '#3b2323',
        border: '1px solid #8a4b4b',
        color: '#ffd7d7',
        font: '13px/1.5 system-ui, sans-serif',
        boxShadow: '0 8px 24px rgba(0,0,0,.35)',
      }}
    >
      <strong style={{display: 'block', marginBottom: 4}}>
        {
          {library: '资产库', export: '视频导出', state: '场景保存'}[
            error.source
          ]
        }
        ({error.code})
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
          color: '#ffd7d7',
          cursor: 'pointer',
        }}
      >
        关闭
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
  controlsRef,
  onReady,
}: {
  sync?: SceneSyncState
  controlsRef: {current: StudioControls | undefined}
  onReady: () => void
}) {
  const [notice, setNotice] = useState<CameraStudioError | null>(null)
  const {ready, error, sceneProps, flushState, hasTemporaryChanges} =
    useCameraStudio({
      project: 'Space',
      storage: memoryStorage,
      state: sync,
      // assets: {baseUrl: 'https://cdn.example.com/camera-assets/'} ← §4 CDN 写法
      sync: false,
      onError: setNotice,
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
        <HostErrorToast error={notice} onClose={() => setNotice(null)} />
      )}
      <CameraScene {...sceneProps} />
    </>
  )
}

function App({
  adapter,
  initialSync,
}: {
  adapter?: SceneSyncAdapter
  initialSync?: SceneSyncState
}) {
  const [sync, setSync] = useState(initialSync)
  const [generation, setGeneration] = useState(0)
  const [phase, setPhase] = useState<SyncPhase>('idle')
  const [studioReady, setStudioReady] = useState(false)
  const [remoteRevision, setRemoteRevision] = useState<string>()
  const controlsRef = useRef<StudioControls | undefined>(undefined)
  const handledRevision = useRef<string | undefined>(undefined)
  const onStudioReady = useCallback(() => setStudioReady(true), [])

  useEffect(() => {
    const subscribe = adapter?.subscribe
    if (!subscribe) return
    return subscribe(setRemoteRevision)
  }, [adapter])

  // 收到远端版本后先 flush 本页的尾部保存，再判断是否有未保存编辑。
  // 空闲页直接进入 reloading；有编辑只提示，绝不覆盖当前场景。
  useEffect(() => {
    if (!remoteRevision || !sync) return
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
  }, [remoteRevision, sync, phase, studioReady])

  // StudioRoute 已因 phase=reloading 卸载，消费者计数归零后再 reset，
  // 然后用新快照重新 boot 一个同 id 项目。
  useEffect(() => {
    if (phase !== 'reloading' || !adapter) return
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

  return (
    <div>
      <HostNav phase={phase} />
      {phase === 'reloading' ? (
        <div
          style={{
            padding: 24,
            color: '#9aa0a6',
            font: '13px/1.5 system-ui, sans-serif',
          }}
        >
          正在加载最新场景…
        </div>
      ) : (
        <StudioRoute
          key={generation}
          sync={sync}
          controlsRef={controlsRef}
          onReady={onStudioReady}
        />
      )}
    </div>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
void loadSceneState().then(
  ({adapter, sync}) =>
    root.render(<App adapter={adapter} initialSync={sync} />),
  (error: Error) => root.render(<p role="alert">{error.message}</p>),
)
