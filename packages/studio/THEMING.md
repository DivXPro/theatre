# Theming Theatre Studio

Studio 的 UI 渲染在 Shadow DOM 中,但以下 CSS 自定义属性可以穿透 Shadow 边界。
在宿主页面的任意祖先选择器(推荐 `#theatrejs-studio-root`,即 studio 的容器 id)上覆盖即可换肤。

## 变量清单

| 变量 | 默认值 | 用途 |
|---|---|---|
| `--theatre-panel-bg` | `#282b2f` | 面板主背景 |
| `--theatre-panel-bg-95` | `rgba(40,43,47,0.95)` | 面板背景(95% 不透明,浮层用) |
| `--theatre-panel-bg-80` | `rgba(40,43,47,0.8)` | 面板背景(80% 不透明,浮层用) |
| `--theatre-panel-bg-65` | `rgba(40,43,47,0.65)` | 面板背景(65% 不透明) |
| `--theatre-panel-bg-99` | `rgba(40,43,47,0.99)` | 面板背景(99% 不透明) |
| `--theatre-panel-border` | `#1f1f1f` | 面板边框 |
| `--theatre-text-primary` | `#ffffff` | 主文字/图标前景 |
| `--theatre-text-secondary` | `#cccccc` | 次级文字 |
| `--theatre-text-muted` | `#888888` | 弱化文字 |
| `--theatre-head-title` | `#bbbbbb` | 面板头标题 |
| `--theatre-head-punctuation` | `#808080` | 面板头标点 |
| `--theatre-accent` | `#40aaa4` | 强调色 |
| `--theatre-shadow-color` | `rgba(0,0,0,0.25)` | 阴影 |
| `--theatre-font-family` | 系统字体栈 | 全局字体 |
| `--theatre-font-size` | `11px` | 全局字号 |

## 与 shadcn/ui 桥接示例

```css
#theatrejs-studio-root {
  --theatre-panel-bg: hsl(var(--background));
  --theatre-text-primary: hsl(var(--foreground));
  --theatre-accent: hsl(var(--primary));
  --theatre-font-family: var(--font-sans);
}
```

## 注意

- 未列出的颜色(如曲线编辑器配色、`#3eaaa4` 等)尚未开放,后续阶段逐步收敛。
- 半透明背景 `-95`/`-80`/`-65`/`-99` 是独立变量,覆盖 `--theatre-panel-bg` 不会联动,需要时分别覆盖。
