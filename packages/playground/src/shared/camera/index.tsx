import React, {useEffect} from 'react'
import ReactDOM from 'react-dom/client'
import {useCameraStudio, CameraScene} from '@dreamerbird/camera-studio'
import {init} from '@dreamerbird/core'

// 页面底色是宿主的视觉决定(T10 顺带 A:库不再替宿主页面着色)
document.body.style.backgroundColor = '#171717'

// ?sync=ws://host:port 覆盖 sync-server 地址:浏览器实测隔离用(默认 3000
// 是用户的服,共享工作区的 8082/8083 两个 vite 都会吃到本文件,测试连错服
// 会把用户页面拉进测试场景)。缺省走默认路径,不影响日常使用。
const params = new URLSearchParams(window.location.search)
const serverUrl = params.get('sync') ?? 'ws://localhost:3000'
const arcDemo = import.meta.env.DEV && params.get('demo') === 'arc-walk'

if (arcDemo) {
  await init({
    studio: true,
    serverUrl,
    persistenceKey: 'camera-animation-persistent-qa-2',
  })
}

function Page() {
  const {ready, error, sceneProps, api} = useCameraStudio({
    project: arcDemo ? 'Camera Animation QA' : 'Space',
    sync: {serverUrl},
  })
  useEffect(() => {
    if (!arcDemo || !ready) return
    void Promise.all([api.ready, sceneProps.project.ready])
      .then(async () => {
        await api.cameras.setActive({objectId: 'camera:Shot Camera 2'})
        await api.view.setShotView({on: true})
        await api.sequence.seek({position: 0})
        if (params.get('play') === '1') await api.sequence.play()
      })
      .catch(console.error)
  }, [api, ready, sceneProps.project])
  if (error) throw error
  if (!ready) return null
  return <CameraScene {...sceneProps} includeDemoModel={!arcDemo} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Page />)
