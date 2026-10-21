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
import React, {useState} from 'react'
import ReactDOM from 'react-dom/client'
import {
  useCameraStudio,
  CameraScene,
  type CameraStudioAgentBridgeConfig,
  type CameraStudioError,
} from '@dreamerbird/camera-studio'
import {MemorySource} from './memorySource'

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

/** 宿主应用自己的顶栏——嵌入单位是「整页/整路由」时,顶栏仍在文档流里,
 * 但 studio 覆盖层铺满视口(z-100)会压在它上面:这是预期行为,不是
 * z-index bug,见指南「约束」一节。 */
function HostNav() {
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
        {error.source === 'library' ? '资产库' : '视频导出'}({error.code})
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

function StudioRoute() {
  const [notice, setNotice] = useState<CameraStudioError | null>(null)
  const {ready, error, sceneProps} = useCameraStudio({
    project: 'Space',
    storage: memoryStorage,
    // assets: {baseUrl: 'https://cdn.example.com/camera-assets/'} ← §4 CDN 写法
    sync: false,
    onError: setNotice,
    // 桥接配置缺失时是 undefined:浏览器默认不连桥接(spec §4/§10.4)。
    // 桥接模式下同时挂 window.__cameraStudioApi(exposeGlobal):端到端
    // 验收用它扮演「另一个写入者」制造 revision 冲突;不连桥接时不挂
    ...(agentBridge ? {agent: {bridge: agentBridge, exposeGlobal: true}} : {}),
  })
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

function App() {
  return (
    <div>
      <HostNav />
      <StudioRoute />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
