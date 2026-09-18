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

// 演示扩展:验证 studio 全局顶栏(global 工具栏)的扩展机制可用。
// 顶栏中右段会多出一个图标按钮和一个下拉菜单,均为 console.log 占位,
// 后续把真实功能(如添加相机/导出视频)接进 items/onClick 即可
void theatre.getStudio().then((studio) => {
  studio.extend({
    id: '@dreamerbird/camera-demo-toolbar',
    toolbars: {
      global(set) {
        set([
          {
            type: 'Icon',
            title: '演示按钮',
            svgSource: '🎬',
            onClick: () => console.log('[demo-toolbar] icon clicked'),
          },
          {
            type: 'Flyout',
            label: '📋',
            items: [
              {
                label: '演示项 1',
                onClick: () => console.log('[demo-toolbar] item 1'),
              },
              {
                label: '演示项 2',
                onClick: () => console.log('[demo-toolbar] item 2'),
              },
            ],
          },
        ])
        return () => {}
      },
    },
  })
})

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
