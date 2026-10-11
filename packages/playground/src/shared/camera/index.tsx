import React from 'react'
import ReactDOM from 'react-dom/client'
// App 改从包根导入,词条注册副作用由包 index.ts 第一行承担
import {App} from '@dreamerbird/camera-studio'
import theatre from '@dreamerbird/core'
import '@dreamerbird/studio'
import {I18nProvider} from '@dreamerbird/studio/i18n'

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
