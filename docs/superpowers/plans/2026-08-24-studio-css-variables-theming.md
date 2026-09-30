# Studio CSS 变量主题体系(第一阶段)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 studio 最高频的 13 个硬编码样式值抽成 `--theatre-*` CSS 变量,宿主应用纯 CSS 即可换肤,默认外观零变化。

**Architecture:** 变量默认值集中定义在 `packages/studio/src/css.tsx` 的 `GlobalStyle` 的 `:host` 块(单一来源);组件内硬编码值逐处替换为 `var(--theatre-xxx)` 裸引用。主 UI 与 `renderToolset` 两条渲染路径均经过 `ProvideStyles`/`GlobalStyle`,均已确认。守卫测试用 jest 直接读源码文件做断言,防止回潮。

**Tech Stack:** styled-components(CSS-in-JS)、jest(jest-esbuild)、TypeScript

**Spec:** `docs/superpowers/specs/2026-08-24-studio-css-variables-theming-design.md`

## Global Constraints

- **映射铁律:变量的默认值必须等于被它替换的硬编码值**,逐处替换、绝不借机"统一"近似色。`#3eaaa4`、`#a8a8a9`、`#919191` 等近似色本阶段一律不动。
- 默认外观像素级不变;不引入 ThemeProvider;不新增运行时依赖。
-  polished 的 `lighten`/`transparentize`/`darken` 等函数无法处理 `var()`,调用点按各任务说明单独处理。
- 提交信息遵循仓库 conventional commits(如 `refactor(studio): ...`),按任务分批提交。
- jest 只匹配 `packages/*/src/**/*.test.ts`(不含 `.tsx`),守卫测试文件必须是 `.test.ts`。
- 每个任务提交前跑:`yarn jest packages/studio/src/cssVariables.test.ts` 与 `yarn workspace @dreamerbird/studio typecheck`。

## 已核实的代码事实(实现时不必重查)

- `packages/studio/src/css.tsx`:`theme` 对象(L26-47)、`panelUtils.panelBorder`(L50)、`GlobalStyle` 的 `:host` 块(L53-190,含 `color: white`、11px 字体栈、`.text-color-pale { color: #CCC }`)。
- `packages/studio/src/UIRoot/ProvideTheme.tsx` 是死代码(仅自身文件出现,无任何 import),删除安全。
- `theme.panel.bg` 的消费方:`panels/BasePanel/common.tsx`(L26、L34)、`SequenceEditorPanel/DopeSheet/Right/DopeSheetBackground.tsx`(L18,套了 `darken`+`transparentize`)、`SequenceEditorPanel/DopeSheet/Left/AnyCompositeRow.tsx`(L34,经 `compoudThing.label.color` getter)。
- `panelUtils.panelBorder` 除 `css.tsx` 外无消费方,保留导出、仅改内部实现。
- 背景值分布:`#282b2f` 与 `rgba(40, 43, 47, 0.95)`、`rgba(40, 43, 47, 0.8)` 三种写法并存,共 8 个文件(Task 2 逐一列出)。
- `DetailCompoundPropEditor.tsx:110` 为 `transparentize(0.05, '#282b2f')`,等价于 0.95 不透明,替换为 `var(--theatre-panel-bg-95)`。
- 验证环境:`yarn jest`(根目录)、`yarn workspace @dreamerbird/studio typecheck`、playground 手动验证用 `yarn workspace @theatre/playground serve`(vite,包名以 `packages/playground/package.json` 为准)。

---

### Task 1: 令牌基础 —— 定义 13 变量、改造 theme 对象、删死代码

**Files:**
- Modify: `packages/studio/src/css.tsx`
- Delete: `packages/studio/src/UIRoot/ProvideTheme.tsx`
- Test: `packages/studio/src/cssVariables.test.ts`(新建)

**Interfaces:**
- Consumes: 无(首个任务)
- Produces: `:host` 上的 13 个变量定义(后续所有任务依赖的完整清单,见 Step 3);守卫测试工具函数 `expectMigrated(files, forbidden, required)`(后续任务的测试步骤复用,签名:`(files: string[], forbidden: RegExp[], required: string[]) => void`,路径相对于 `packages/studio/src/`)

- [ ] **Step 1: 写失败的守卫测试**

新建 `packages/studio/src/cssVariables.test.ts`:

```ts
import {readFileSync} from 'fs'
import {join} from 'path'

const studioSrc = __dirname
const read = (rel: string) => readFileSync(join(studioSrc, rel), 'utf8')

/** 断言一批文件:不含任何 forbidden 模式,且含有全部 required 字符串 */
export const expectMigrated = (
  files: string[],
  forbidden: RegExp[],
  required: string[],
) => {
  for (const f of files) {
    const src = read(f)
    for (const pat of forbidden) {
      expect(src).not.toMatch(pat)
    }
    for (const req of required) {
      expect(src).toContain(req)
    }
  }
}

const TOKEN_DEFINITIONS = [
  '--theatre-panel-bg:',
  '--theatre-panel-bg-95:',
  '--theatre-panel-bg-80:',
  '--theatre-panel-border:',
  '--theatre-text-primary:',
  '--theatre-text-secondary:',
  '--theatre-text-muted:',
  '--theatre-head-title:',
  '--theatre-head-punctuation:',
  '--theatre-accent:',
  '--theatre-shadow-color:',
  '--theatre-font-family:',
  '--theatre-font-size:',
]

describe('studio theming tokens', () => {
  it('defines all 13 tokens in css.tsx', () => {
    const css = read('css.tsx')
    for (const def of TOKEN_DEFINITIONS) {
      expect(css).toContain(def)
    }
  })

  it('theme object references variables', () => {
    const css = read('css.tsx')
    expect(css).toContain('var(--theatre-panel-bg)')
    expect(css).toContain('var(--theatre-head-title)')
    expect(css).toContain('var(--theatre-head-punctuation)')
    expect(css).toContain('var(--theatre-panel-border)')
  })

  it('ProvideTheme dead shell is removed', () => {
    expect(() => read('UIRoot/ProvideTheme.tsx')).toThrow()
  })
})
```

注意:`export` 会让 jest-esbuild 把文件当模块,后续任务 `import {expectMigrated} from './cssVariables.test'` 复用;若 lint 对 test 文件导出报错,则把 `expectMigrated` 挪到 `packages/studio/src/cssVariablesTestUtils.ts` 并在各测试里 import(二选一,以实现时 lint 结果为准)。

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn jest packages/studio/src/cssVariables.test.ts`
Expected: FAIL(变量定义尚不存在;ProvideTheme.tsx 还在)

- [ ] **Step 3: 实现 —— 在 GlobalStyle 定义变量**

`packages/studio/src/css.tsx` 的 `GlobalStyle` 模板中,`:host {` 块开头(`all: initial;` 之后)插入:

```
--theatre-panel-bg: #282b2f;
--theatre-panel-bg-95: rgba(40, 43, 47, 0.95);
--theatre-panel-bg-80: rgba(40, 43, 47, 0.8);
--theatre-panel-border: #1f1f1f;
--theatre-text-primary: #ffffff;
--theatre-text-secondary: #cccccc;
--theatre-text-muted: #888888;
--theatre-head-title: #bbbbbb;
--theatre-head-punctuation: #808080;
--theatre-accent: #40aaa4;
--theatre-shadow-color: rgba(0, 0, 0, 0.25);
--theatre-font-family: -apple-system, BlinkMacSystemFont, Segoe WPC, Segoe Editor, HelveticaNeue-Light, Ubuntu, Droid Sans, sans-serif;
--theatre-font-size: 11px;
```

- [ ] **Step 4: 实现 —— 改造 theme 对象与 panelUtils**

`css.tsx` 中:

```ts
export const theme = {
  panel: {
    bg: `var(--theatre-panel-bg)`,
    head: {
      title: {
        color: `var(--theatre-head-title)`,
      },
      punctuation: {
        color: `var(--theatre-head-punctuation)`,
      },
    },
    body: {
      compoudThing: {
        label: {
          get color(): string {
            // 派生色:polished 无法处理 var(),第一阶段保持静态计算值
            return lighten(0.6, `#282b2f`)
          },
        },
      },
    },
  },
}

export const panelUtils = {
  panelBorder: `2px solid var(--theatre-panel-border)`,
}
```

- [ ] **Step 5: 实现 —— 删除死代码**

```bash
rm packages/studio/src/UIRoot/ProvideTheme.tsx
```

- [ ] **Step 6: 跑测试与类型检查**

Run: `yarn jest packages/studio/src/cssVariables.test.ts`
Expected: PASS
Run: `yarn workspace @dreamerbird/studio typecheck`
Expected: 通过

- [ ] **Step 7: 提交**

```bash
git add packages/studio/src/css.tsx packages/studio/src/cssVariables.test.ts packages/studio/src/UIRoot/ProvideTheme.tsx
git commit -m "refactor(studio): define --theatre-* tokens in GlobalStyle, rewire theme object"
```

---

### Task 2: 背景族替换(8 个文件)

**Files:**
- Modify: `packages/studio/src/notify.tsx`
- Modify: `packages/studio/src/panels/OutlinePanel/BaseItem.tsx`
- Modify: `packages/studio/src/panels/SequenceEditorPanel/SequenceEditorPanel.tsx`
- Modify: `packages/studio/src/panels/DetailPanel/DetailPanel.tsx`
- Modify: `packages/studio/src/panels/DetailPanel/DeterminePropEditorForDetail/DetailCompoundPropEditor.tsx`
- Modify: `packages/studio/src/uiComponents/toolbar/ToolbarIconButton.tsx`
- Modify: `packages/studio/src/uiComponents/toolbar/ToolbarButton.tsx`
- Test: `packages/studio/src/cssVariables.test.ts`(追加用例)

**Interfaces:**
- Consumes: Task 1 的 `:host` 变量定义、`expectMigrated`
- Produces: 无新接口

替换规则(全库精确匹配,逐一替换):
- `#282b2f` → `var(--theatre-panel-bg)`
- `rgba(40, 43, 47, 0.95)` → `var(--theatre-panel-bg-95)`
- `rgba(40, 43, 47, 0.8)` → `var(--theatre-panel-bg-80)`
- `DetailCompoundPropEditor.tsx:110` 的 `transparentize(0.05, '#282b2f')` → `var(--theatre-panel-bg-95)`;替换后若 `transparentize` 在该文件不再使用,从 L10 的 import 中移除(`darken` 若仍被使用则保留)。

- [ ] **Step 1: 追加失败的守卫用例**

在 `cssVariables.test.ts` 的 describe 块中追加:

```ts
it('panel background family migrated', () => {
  expectMigrated(
    [
      'notify.tsx',
      'panels/OutlinePanel/BaseItem.tsx',
      'panels/SequenceEditorPanel/SequenceEditorPanel.tsx',
      'panels/DetailPanel/DetailPanel.tsx',
      'panels/DetailPanel/DeterminePropEditorForDetail/DetailCompoundPropEditor.tsx',
      'uiComponents/toolbar/ToolbarIconButton.tsx',
      'uiComponents/toolbar/ToolbarButton.tsx',
    ],
    [/#282b2f/i, /rgba\(\s*40,\s*43,\s*47/],
    ['var(--theatre-panel-bg'],
  )
})
```

Run: `yarn jest packages/studio/src/cssVariables.test.ts`
Expected: FAIL(文件尚未替换)

- [ ] **Step 2: 执行替换**

按上述规则逐个文件替换。定位命令:

```bash
grep -n '#282b2f\|rgba(40, 43, 47' packages/studio/src/notify.tsx \
  packages/studio/src/panels/OutlinePanel/BaseItem.tsx \
  packages/studio/src/panels/SequenceEditorPanel/SequenceEditorPanel.tsx \
  packages/studio/src/panels/DetailPanel/DetailPanel.tsx \
  packages/studio/src/panels/DetailPanel/DeterminePropEditorForDetail/DetailCompoundPropEditor.tsx \
  packages/studio/src/uiComponents/toolbar/ToolbarIconButton.tsx \
  packages/studio/src/uiComponents/toolbar/ToolbarButton.tsx
```

- [ ] **Step 3: 验证并提交**

Run: `yarn jest packages/studio/src/cssVariables.test.ts` → PASS
Run: `yarn workspace @dreamerbird/studio typecheck` → 通过

```bash
git add -u packages/studio/src
git commit -m "refactor(studio): migrate panel background colors to --theatre-panel-bg tokens"
```

---

### Task 3: 文字族替换(#fff / #ccc / #888)

**Files:**
- Modify: `packages/studio/src/css.tsx`(`:host` 的 `color: white` → `var(--theatre-text-primary)`;`.text-color-pale` 的 `#CCC` → `var(--theatre-text-secondary)`)
- Modify: `packages/studio/src/panels/SequenceEditorPanel/DopeSheet/Left/AnyCompositeRow.tsx`
- Modify: `packages/studio/src/panels/SequenceEditorPanel/DopeSheet/Left/PrimitivePropRow.tsx`
- Modify: `packages/studio/src/uiComponents/ExternalLink.tsx`(同时含 `#ccc` 与 `#888`)
- Modify: `packages/studio/src/propEditors/simpleEditors/ImagePropEditor.tsx`
- Modify: `packages/studio/src/propEditors/simpleEditors/FilePropEditor.tsx`
- Modify: `packages/studio/src/notify.tsx`
- Modify: `packages/studio/src/panels/SequenceEditorPanel/RightOverlay/HorizontalScrollbar.tsx`
- Modify: `packages/studio/src/uiComponents/ConnectionStatusBadge.tsx`
- Modify: `packages/studio/src/uiComponents/icons/CubeRendered.tsx`
- Modify: `packages/studio/src/uiComponents/colorPicker/components/common/Pointer.tsx`
- Modify: `packages/studio/src/uiComponents/colorPicker/components/common/Alpha.tsx`
- Modify: `packages/studio/src/uiComponents/colorPicker/components/common/Saturation.tsx`
- Modify: `packages/studio/src/panels/SequenceEditorPanel/DopeSheet/Right/BasicKeyframedTrack/KeyframeEditor/CurveEditorPopover/CurveEditorPopover.tsx`
- Modify: `packages/studio/src/panels/SequenceEditorPanel/DopeSheet/Right/BasicKeyframedTrack/KeyframeEditor/CurveEditorPopover/SVGCurveSegment.tsx`
- Test: `packages/studio/src/cssVariables.test.ts`(追加用例)

**Interfaces:**
- Consumes: Task 1 的变量定义、`expectMigrated`
- Produces: 无新接口

替换规则:
- `#fff`(独立词,排除 `#ffffff00` 等长形式)→ `var(--theatre-text-primary)`;`color: white` → `color: var(--theatre-text-primary)`(`white` 与 `#ffffff` 计算值相同,符合映射铁律)
- `#ccc` / `#CCC` → `var(--theatre-text-secondary)`
- `#888` / `#888888` → `var(--theatre-text-muted)`
- 图标与取色器内部的 `#fff`(CubeRendered、Pointer、Alpha、Saturation)视为前景主色,同样替换;主题化时图标跟随文字色,符合常规图标语义。

- [ ] **Step 1: 追加失败的守卫用例**

```ts
it('text color family migrated', () => {
  expectMigrated(
    [
      'css.tsx',
      'panels/SequenceEditorPanel/DopeSheet/Left/AnyCompositeRow.tsx',
      'panels/SequenceEditorPanel/DopeSheet/Left/PrimitivePropRow.tsx',
      'uiComponents/ExternalLink.tsx',
      'propEditors/simpleEditors/ImagePropEditor.tsx',
      'propEditors/simpleEditors/FilePropEditor.tsx',
      'notify.tsx',
      'panels/SequenceEditorPanel/RightOverlay/HorizontalScrollbar.tsx',
      'uiComponents/ConnectionStatusBadge.tsx',
      'uiComponents/icons/CubeRendered.tsx',
      'uiComponents/colorPicker/components/common/Pointer.tsx',
      'uiComponents/colorPicker/components/common/Alpha.tsx',
      'uiComponents/colorPicker/components/common/Saturation.tsx',
      'panels/SequenceEditorPanel/DopeSheet/Right/BasicKeyframedTrack/KeyframeEditor/CurveEditorPopover/CurveEditorPopover.tsx',
      'panels/SequenceEditorPanel/DopeSheet/Right/BasicKeyframedTrack/KeyframeEditor/CurveEditorPopover/SVGCurveSegment.tsx',
    ],
    [/#fff\b/i, /#ccc\b/i, /#888\b/i, /#888888/i, /color:\s*white\b/],
    [],
  )
})
```

注意 `css.tsx` 也在清单里,但 Task 1 已写入的变量默认值行含 `#ffffff`、`#cccccc`、`#888888`——这些是全词形式,`#fff\b` 不会匹配 `#ffffff`(f 是单词字符),`#ccc\b`/`#888\b` 同理;`#888888` 这条规则会误伤默认值行,实现时用 Negative Lookbehind 排除:`/(?<!-)#888888/i` 仍不够(默认值行合法),改为对 `css.tsx` 单独断言:只允许出现在 `--theatre-` 定义行。简化做法:把 `css.tsx` 从本用例 files 中移出,单独写一个用例断言 `css.tsx` 不含 `color: white` 与 `.text-color-pale` 的 `#CCC`。按此简化做法实现。

Run: `yarn jest packages/studio/src/cssVariables.test.ts`
Expected: FAIL

- [ ] **Step 2: 执行替换**

定位命令:

```bash
grep -rn '#fff\b\|#ccc\b\|#888\b\|#888888\|color: white' packages/studio/src --include='*.tsx' --include='*.ts' | grep -v cssVariables
```

逐文件按规则替换(注意 `#ffffff00` 这类带 alpha 的长形式不是 `#fff`,`grep` 的 `\b` 已排除,不要误改)。

- [ ] **Step 3: 验证并提交**

Run: `yarn jest packages/studio/src/cssVariables.test.ts` → PASS
Run: `yarn workspace @dreamerbird/studio typecheck` → 通过

```bash
git add -u packages/studio/src
git commit -m "refactor(studio): migrate text colors to --theatre-text-* tokens"
```

---

### Task 4: 强调色与阴影替换

**Files:**
- Modify: `packages/studio/src/panels/SequenceEditorPanel/RightOverlay/FocusRangeZone/FocusRangeThumb.tsx`
- Modify: `packages/studio/src/toolbars/GlobalToolbar/GlobalToolbar.tsx`
- Modify: `packages/studio/src/notify.tsx`
- Modify: `packages/studio/src/panels/DetailPanel/DetailPanel.tsx`
- Modify: `packages/studio/src/toolbars/GlobalToolbar/MoreMenu/MoreMenu.tsx`
- Test: `packages/studio/src/cssVariables.test.ts`(追加用例)

**Interfaces:**
- Consumes: Task 1 的变量定义、`expectMigrated`
- Produces: 无新接口

替换规则:
- `#40aaa4` → `var(--theatre-accent)`(`#3eaaa4` 是近似变体,按映射铁律**不动**)
- `rgba(0, 0, 0, 0.25)` → `var(--theatre-shadow-color)`

- [ ] **Step 1: 追加失败的守卫用例**

```ts
it('accent and shadow migrated', () => {
  expectMigrated(
    [
      'panels/SequenceEditorPanel/RightOverlay/FocusRangeZone/FocusRangeThumb.tsx',
      'toolbars/GlobalToolbar/GlobalToolbar.tsx',
    ],
    [/#40aaa4/i],
    ['var(--theatre-accent)'],
  )
  expectMigrated(
    [
      'notify.tsx',
      'panels/DetailPanel/DetailPanel.tsx',
      'toolbars/GlobalToolbar/MoreMenu/MoreMenu.tsx',
    ],
    [/rgba\(\s*0,\s*0,\s*0,\s*0\.25\s*\)/],
    ['var(--theatre-shadow-color)'],
  )
})
```

Run: `yarn jest packages/studio/src/cssVariables.test.ts`
Expected: FAIL

- [ ] **Step 2: 执行替换**

```bash
grep -n '#40aaa4' packages/studio/src/panels/SequenceEditorPanel/RightOverlay/FocusRangeZone/FocusRangeThumb.tsx packages/studio/src/toolbars/GlobalToolbar/GlobalToolbar.tsx
grep -n 'rgba(0, 0, 0, 0.25)' packages/studio/src/notify.tsx packages/studio/src/panels/DetailPanel/DetailPanel.tsx packages/studio/src/toolbars/GlobalToolbar/MoreMenu/MoreMenu.tsx
```

逐处替换。

- [ ] **Step 3: 验证并提交**

Run: `yarn jest packages/studio/src/cssVariables.test.ts` → PASS
Run: `yarn workspace @dreamerbird/studio typecheck` → 通过

```bash
git add -u packages/studio/src
git commit -m "refactor(studio): migrate accent and shadow colors to tokens"
```

---

### Task 5: 字体变量接入

**Files:**
- Modify: `packages/studio/src/css.tsx`(GlobalStyle 的 `:host` 字体声明)
- Test: `packages/studio/src/cssVariables.test.ts`(追加用例)

**Interfaces:**
- Consumes: Task 1 已在 `:host` 定义的 `--theatre-font-family` / `--theatre-font-size`
- Produces: 无新接口

- [ ] **Step 1: 追加失败的守卫用例**

```ts
it('host font uses font tokens', () => {
  const css = read('css.tsx')
  expect(css).toContain('var(--theatre-font-size)')
  expect(css).toContain('var(--theatre-font-family)')
  expect(css).not.toMatch(/font:\s*\n?\s*11px/)
})
```

Run: `yarn jest packages/studio/src/cssVariables.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现**

`css.tsx` GlobalStyle `:host` 块中,把:

```
font:
  11px -apple-system,
  BlinkMacSystemFont,
  Segoe WPC,
  Segoe Editor,
  HelveticaNeue-Light,
  Ubuntu,
  Droid Sans,
  sans-serif;
```

替换为:

```
font: var(--theatre-font-size) var(--theatre-font-family);
```

- [ ] **Step 3: 验证并提交**

Run: `yarn jest packages/studio/src/cssVariables.test.ts` → PASS
Run: `yarn workspace @dreamerbird/studio typecheck` → 通过

```bash
git add -u packages/studio/src
git commit -m "refactor(studio): drive host font from --theatre-font-* tokens"
```

---

### Task 6: THEMING 文档与全量验证

**Files:**
- Create: `packages/studio/THEMING.md`
- Test: 既有守卫测试全量回归

**Interfaces:**
- Consumes: Task 1-5 的全部变量
- Produces: 宿主侧桥接写法的官方说明

- [ ] **Step 1: 写 THEMING.md**

```markdown
# Theming Theatre Studio

Studio 的 UI 渲染在 Shadow DOM 中,但以下 CSS 自定义属性可以穿透 Shadow 边界。
在宿主页面的任意祖先选择器(推荐 `#theatrejs-studio-root`,即 studio 的容器 id)上覆盖即可换肤。

## 变量清单

| 变量 | 默认值 | 用途 |
|---|---|---|
| `--theatre-panel-bg` | `#282b2f` | 面板主背景 |
| `--theatre-panel-bg-95` | `rgba(40,43,47,0.95)` | 面板背景(95% 不透明,浮层用) |
| `--theatre-panel-bg-80` | `rgba(40,43,47,0.8)` | 面板背景(80% 不透明,浮层用) |
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
- 半透明背景 `-95`/`-80` 是独立变量,覆盖 `--theatre-panel-bg` 不会联动,需要时分别覆盖。
```

- [ ] **Step 2: 全量回归**

Run: `yarn jest packages/studio/src/cssVariables.test.ts` → 全部 PASS
Run: `yarn jest packages/studio` → studio 既有测试不回归
Run: `yarn workspace @dreamerbird/studio typecheck` → 通过

- [ ] **Step 3: playground 手动验证(人工执行,记录结果)**

```bash
yarn workspace @theatre/playground serve
```

1. 打开任一 playground 示例,确认 studio 默认外观与改造前一致(面板深色背景、白色文字、青色强调);
2. 在浏览器 DevTools 的 Console 执行:

```js
document.getElementById('theatrejs-studio-root').style.setProperty('--theatre-panel-bg', '#3b2f2f')
```

确认面板背景变为红褐色,即变量穿透生效;
3. 用 `style.removeProperty` 还原。

- [ ] **Step 4: 提交**

```bash
git add packages/studio/THEMING.md
git commit -m "docs(studio): document theming tokens and shadcn bridge"
```

---

## Self-Review 记录

- **Spec 覆盖**:13 变量(Task 1 定义、Task 2-5 接入)、theme 对象改造(Task 1)、ProvideTheme 清理(Task 1)、THEMING 文档(Task 6)、验证(Task 6)——spec 各节均有对应任务。`--theatre-panel-border` 因 `panelBorder` 无消费方,仅在定义层接入(Task 1),符合 spec"保留导出、仅改实现"。
- **占位符扫描**:无 TBD/TODO;每个代码步骤含实际代码或精确替换规则。
- **类型一致**:`expectMigrated` 签名在 Task 1 定义、Task 2-4 复用一致;变量名 13 个跨任务拼写一致。
- **遗留说明**:Task 3 的 `css.tsx` 断言误伤问题已在任务内给出简化做法(单独用例);`compoudThing.label.color` 派生色保持静态计算,已在 Task 1 代码注释中声明。
