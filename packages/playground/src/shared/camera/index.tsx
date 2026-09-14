import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import theatre from '@dreamerbird/core'
import '@dreamerbird/studio'

// connect directly to a local sync-server (yarn cli dev start in
// packages/sync-server) — no app needed in the self-hosted minimal loop
// 不注册 @dreamerbird/r3f 扩展:它的 Create Snapshot 面板/Editor 配置节点
// 在本场景无人消费
void theatre.init({studio: true, serverUrl: 'ws://localhost:3000'})

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
