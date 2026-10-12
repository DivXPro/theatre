/**
 * camera-studio 最小宿主 demo:顶部宿主导航条 + 整页 CameraScene。
 * 集成指南(docs/guides/camera-studio-embedding.md)的配套可跑示例,
 * 运行(仓库根):yarn workspace camera-host-demo dev
 *
 * 演示点:
 * - storage: 自定义可写存储(内存版,刷新即失;生产换 HTTP 实现);
 * - assets.baseUrl: 不传 = 包内缺省 assets/(上架 CDN 的写法见指南 §4);
 * - sync: false:协作关闭(缺省即 false,这里显式写出)。
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import {useCameraStudio, CameraScene} from '@dreamerbird/camera-studio'
import {MemorySource} from './memorySource'

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

function StudioRoute() {
  const {ready, error, sceneProps} = useCameraStudio({
    project: 'Space',
    storage: memoryStorage,
    // assets: {baseUrl: 'https://cdn.example.com/camera-assets/'} ← §4 CDN 写法
    sync: false,
  })
  if (error) throw error
  if (!ready) return null
  return <CameraScene {...sceneProps} />
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
