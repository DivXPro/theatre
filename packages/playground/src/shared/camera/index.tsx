import React from 'react'
import ReactDOM from 'react-dom/client'
import {useCameraStudio, CameraScene} from '@dreamerbird/camera-studio'

// 页面底色是宿主的视觉决定(T10 顺带 A:库不再替宿主页面着色)
document.body.style.backgroundColor = '#171717'

// ?sync=ws://host:port 覆盖 sync-server 地址:浏览器实测隔离用(默认 3000
// 是用户的服,共享工作区的 8082/8083 两个 vite 都会吃到本文件,测试连错服
// 会把用户页面拉进测试场景)。缺省走默认路径,不影响日常使用。
const syncParam = new URLSearchParams(window.location.search).get('sync')

function Page() {
  const {ready, error, sceneProps} = useCameraStudio({
    project: 'Space',
    sync: {serverUrl: syncParam ?? 'ws://localhost:3000'},
  })
  if (error) throw error
  if (!ready) return null
  return <CameraScene {...sceneProps} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Page />)
