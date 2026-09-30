# Studio CSS 变量主题体系(第一阶段)设计

日期:2026-08-24
状态:已获批准,待实现

## 背景与目标

Studio 的 UI 样式目前几乎全部硬编码在 126 个 styled-components 文件里,宿主应用(采用 shadcn/ui)无法换肤。本设计将最高频的样式值抽成 CSS 自定义属性,利用"CSS 变量可穿透 Shadow DOM"的特性,让宿主应用纯 CSS 即可换肤,不需要 studio 暴露任何 JS API。

约束:

- 默认值 = 现状色,改造后默认外观像素级不变;
- 不改 styled-components 的组件结构,不引入 ThemeProvider;
- 第一阶段不做:`studio.initialize({theme})` API、浅色主题预设、全量 126 文件收敛。

## 关键事实(实现依据)

- Studio UI 渲染在 Shadow DOM 中:`packages/studio/src/UI/UINonSSRBits.ts` 将 UI 挂载到 `#theatrejs-studio-root`(fixed,z-index 100)的 shadow root。
- 两条渲染路径(主 UI 与 `renderToolset` 嵌出的工具组)都经过 `packages/studio/src/css.tsx` 的 `ProvideStyles` → `GlobalStyle`,因此 `:host` 上定义的变量对两处都生效。
- `css.tsx` 现有 `theme` 对象(仅面板背景/标题几个值)与 `UIRoot/ProvideTheme.tsx` 空壳(定义了无人使用的 `--colors-panel-1: red`)。
- 颜色频次扫描结果:面板主背景 `#282b2f` 及其 rgba 形式 `rgba(40,43,47,0.95/0.8)`(10 次);强调色 `#40aaa4`/`#3eaaa4`(13 次);文字色 `#fff`/`#ccc`/`#a8a8a9`/`#919191`/`#888` 等。

## 令牌清单(13 个变量)

| 族 | 变量 | 默认值 |
|---|---|---|
| 背景 | `--theatre-panel-bg` | `#282b2f` |
| 背景(半透明) | `--theatre-panel-bg-95` / `--theatre-panel-bg-80` | `rgba(40,43,47,0.95)` / `rgba(40,43,47,0.8)` |
| 边框 | `--theatre-panel-border` | `#1f1f1f` |
| 文字 | `--theatre-text-primary` / `--theatre-text-secondary` / `--theatre-text-muted` | `#ffffff` / `#cccccc` / `#888888` |

映射铁律:**变量的默认值必须等于被它替换的硬编码值**,逐处替换、绝不借替换之机"顺便统一"近似色。因此 `#a8a8a9`(6 次)、`#919191`(5 次)等中间灰第一阶段保持原样,不映射到任何变量,留待后续阶段处理。 |
| 面板头 | `--theatre-head-title` / `--theatre-head-punctuation` | `#bbbbbb` / `#808080` |
| 强调 | `--theatre-accent` | `#40aaa4`(`#3eaaa4` 虽为近似变体,但依映射铁律第一阶段保持原样,不并入) |
| 阴影 | `--theatre-shadow-color` | `rgba(0,0,0,0.25)` |
| 字体 | `--theatre-font-family` / `--theatre-font-size` | 现状 11px 系统字体栈 |

文字族 `#ccc`(8 次)、`#fff`(10 次)、`#888`(多处)为前三高频,全部覆盖;低频次近似色按映射铁律不动。

## 机制

1. **默认值集中定义**:在 `css.tsx` 的 `GlobalStyle` 的 `:host` 块中定义全部 13 个变量(单一来源)。
2. **组件裸引用**:组件内硬编码值替换为 `var(--theatre-xxx)`,不带兜底值(`:host` 必然先定义;两条渲染路径共用 GlobalStyle 已确认)。
3. **`theme` 对象改造**:`css.tsx` 的 `theme.panel.*` 改为引用变量,保持对外结构不变。
4. **清理**:`ProvideTheme.tsx` 空壳删除(若被引用则并入新机制后删)。

## 宿主换肤方式

宿主应用在自己的 CSS 中对 studio 容器写变量即可穿透 Shadow DOM 生效:

```css
/* shadcn/ui 变量 → theatre 变量桥接,宿主侧维护一份 */
#theatrejs-studio-root {
  --theatre-panel-bg: hsl(var(--background));
  --theatre-accent: hsl(var(--primary));
  --theatre-text-primary: hsl(var(--foreground));
  --theatre-font-family: var(--font-sans);
}
```

随改造在 studio 包内附 `THEMING.md`(或 README 章节)说明该桥接写法与完整变量清单。

## 改动面

- `packages/studio/src/css.tsx`:变量定义 + theme 对象;
- `packages/studio/src/UIRoot/ProvideTheme.tsx`:删除或并入;
- 各令牌 Top 用量文件,预计 20~30 个,按族分批改,一族一个提交(背景族、文字族、强调色、字体等)。

## 验证

1. 默认值 = 现状色,跑仓库现有 visual regression / compat 测试,确认默认外观无变化;
2. playground 手动验证:宿主覆盖变量后换肤生效;
3. typecheck 通过。

## 风险与对策

- **遗漏某条渲染路径**:已确认两条路径(主 UI / renderToolset)共用 GlobalStyle;实现时若发现第三条路径(如 notify、context menu 的 portal),逐一核对是否经过 `ProvideStyles`,未经过的接入或单独补变量定义。
- **半透明背景用 color-mix 还是从变量派生**:不派生,`-95`/`-80` 各自独立成变量,宿主可分别覆盖,避免 color-mix 的兼容性顾虑。
- **渐变/阴影中内嵌的颜色**:第一阶段不强行收敛,保持现状。
