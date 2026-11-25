# Theming Theatre Studio

Studio 默认使用深色主题。将 `data-theme="light"` 设在 `#theatrejs-studio-root` 元素上即可切换浅色主题，将属性设为 `dark` 或移除即可恢复深色。元素由 Studio 挂载，可以在挂载后随宿主主题更新属性。

```ts
const studioRoot = document.getElementById('theatrejs-studio-root')
studioRoot?.setAttribute('data-theme', 'light')
```

使用 Camera Studio 时，将 `data-theme` 设在 `ui.portalContainer` 对应的元素上。省略 `ui.portalContainer` 时，设置在 `document.body` 上。Camera Studio 会同步编辑器和浮层的主题。

可以在宿主的 CSS 中为 Studio 根节点覆盖自定义属性。覆盖值在两种模式下都优先于内置值。

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
| `--theatre-panel-radius` | `11px` | 面板圆角 |
| `--theatre-input-bg` | `#202224` | 输入控件背景 |
| `--theatre-selected-bg` | `#202c27` | 选中项目背景 |
| `--theatre-selected-border` | `#3b5148` | 选中项目边框 |
| `--theatre-font-family` | 系统字体栈 | 全局字体 |
| `--theatre-font-size` | `11px` | 全局字号 |

浅色主题的完整默认值见 [lightTheme.json](src/lightTheme.json)。下列变量也可在深色模式中覆盖，默认沿用各控件原有的深色值。

| 变量后缀（`--theatre-ui-`） | 用途 |
|---|---|
| `surface`、`raised`、`recessed`、`input` | 面板、菜单与浮层、内凹区域、输入控件背景 |
| `text`、`secondary`、`muted` | 主文字、次级文字、弱化文字 |
| `border`、`grid-line`、`scrollbar` | 边框、轨道分隔线、滚动条 |
| `accent`、`accent-hover`、`on-accent` | 强调色、悬停强调色、强调色上的前景 |
| `hover`、`selected`、`selected-border` | 悬停背景、选中背景、选中边框 |
| `danger`、`danger-surface` | 错误前景与背景 |
| `keyframe-selected`、`axis-x`、`axis-y`、`axis-z` | 时间轴选中关键帧和属性轴前景 |
| `grid-filter`、`logo-filter`、`label-shadow` | 时间轴网格和 Studio 标志的 CSS 滤镜、属性标签阴影颜色 |

## 与 shadcn/ui 桥接示例

```css
#theatrejs-studio-root {
  --theatre-panel-bg: hsl(var(--background));
  --theatre-text-primary: hsl(var(--foreground));
  --theatre-accent: hsl(var(--primary));
  --theatre-font-family: var(--font-sans);
}
```

半透明背景 `-95`、`-80`、`-65`、`-99` 可按需分别覆盖。
