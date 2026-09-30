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
// ?sync=ws://host:port 覆盖 sync-server 地址:浏览器实测隔离用(默认 3000
// 是用户的服,共享工作区的 8082/8083 两个 vite 都会吃到本文件,测试连错服
// 会把用户页面拉进测试场景)。缺省走默认路径,不影响日常使用。
const syncParam = new URLSearchParams(window.location.search).get('sync')
void theatre.init({studio: true, serverUrl: syncParam ?? 'ws://localhost:3000'})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
)
