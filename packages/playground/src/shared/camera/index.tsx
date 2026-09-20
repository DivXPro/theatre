import React from 'react'
import ReactDOM from 'react-dom/client'
// 词条注册必须最先执行:模块按 import 顺序求值,App 依赖链里有模块
// 加载期就 translate 的调用(ShotCamera 属性标签,已自带副作用导入兜底)
import './i18n'
import App from './App'
import theatre from '@dreamerbird/core'
import '@dreamerbird/studio'
import {I18nProvider} from '@dreamerbird/studio/i18n'

// connect directly to a local sync-server (yarn cli dev start in
// packages/sync-server) — no app needed in the self-hosted minimal loop
// 不注册 @dreamerbird/r3f 扩展:它的 Create Snapshot 面板/Editor 配置节点
// 在本场景无人消费
void theatre.init({studio: true, serverUrl: 'ws://localhost:3000'})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
)
