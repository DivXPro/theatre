# Studio / Camera Studio Light / Dark Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让宿主通过一个 `data-theme="light|dark"` 属性同步切换 Studio 与 Camera Studio 的完整编辑器 UI，并保持未接入属性的现有应用为当前 Dark 外观。

**Architecture:** 在 Studio 中集中定义 Light / Dark 语义 CSS 变量，Shadow DOM 由 `:host` 属性选择器直接切换。Camera Studio 使用会话级桥接，把宿主容器的主题属性同步到主文档场景根节点、Portal 容器和 Studio Shadow 宿主；所有 UI 颜色消费同一套变量，Three.js 场景内容不参与主题切换。

**Tech Stack:** TypeScript、React 19、styled-components 6、CSS Custom Properties、MutationObserver、Jest 29、Playwright、pnpm。

**设计依据：** `docs/superpowers/specs/2026-10-28-studio-light-dark-theming-design.md`

## Global Constraints

- 不新增运行时依赖，不引入 ThemeProvider，不新增公开 JS 主题 API，不读取 `prefers-color-scheme`。
- 属性缺失、移除或非法时回退 Dark；Dark 令牌逐值保持当前外观，不能在迁移时顺便统一近似色。
- Camera Studio 主题源为 `config.ui.portalContainer ?? document.body`；独立 Studio 的主题源为 `#theatrejs-studio-root`。
- 主题桥接属于会话级资源，在 `acquireSession` 创建、在 `sessionTeardown` 销毁，不进入 boot 级永久资源。
- 只迁移编辑器 UI；Three.js 模型、灯光、材质、用户颜色、资产缩略图和场景视口背景不随主题变化。
- 宿主对 `--theatre-*` 的显式覆盖继续有效；透明背景变量保持独立，不做自动派生。
- 每个任务先写失败测试，再做最小实现；只提交本任务文件，不纳入工作区已有未跟踪文件。

## File Structure

- `packages/studio/src/theme.ts`：两套主题令牌、主题名规范化、令牌 CSS 序列化；无 React、无运行时状态。
- `packages/studio/src/css.tsx`：把令牌接入 Shadow DOM `GlobalStyle`，保留现有样式入口。
- `packages/studio/src/cssVariables.test.ts`：令牌一致性、Dark 兼容值、Studio 样式迁移回归。
- `packages/camera-studio/src/themeBridge.ts`：主题源观察、延迟目标发现、属性同步和资源清理。
- `packages/camera-studio/src/themeBridge.test.ts`：桥接行为单元测试。
- `packages/camera-studio/src/CameraThemeStyle.tsx`：主文档及 Portal 容器的主题变量样式。
- `packages/camera-studio/src/themeCoverage.test.ts`：Camera Studio 固定 UI 颜色回归。
- `packages/camera-studio/src/bootstrap.ts`：桥接生命周期接线。
- `packages/camera-studio/src/CameraScene.tsx`：场景 UI 根节点标记、主题样式挂载和场景 DOM 覆盖层迁移。
- `packages/studio/THEMING.md`、`docs/guides/camera-studio-embedding.md`：宿主契约与完整令牌说明。
- `examples/camera-host-demo/src/main.tsx`、`examples/camera-host-demo/src/theme.e2e.ts`：真实宿主切换示例与端到端验证。

---

### Task 1: 共享令牌与 Studio 双主题选择器

**Files:**
- Create: `packages/studio/src/theme.ts`
- Modify: `packages/studio/src/css.tsx:26-76`
- Modify: `packages/studio/src/cssVariables.test.ts:24-72`

**Interfaces:**
- Produces: `StudioThemeName = 'light' | 'dark'`
- Produces: `studioThemes: Record<StudioThemeName, Record<string, string>>`
- Produces: `normalizeStudioTheme(value: string | null | undefined): StudioThemeName`
- Produces: `themeVariablesCss(theme: StudioThemeName): string`
- Consumes: 后续 Camera Studio 桥接复用 `normalizeStudioTheme`，主文档样式复用 `themeVariablesCss`。

- [ ] **Step 1: 改写令牌测试，先验证不存在的模块和 Light 选择器**

在 `cssVariables.test.ts` 顶部加入：

```ts
import {
  normalizeStudioTheme,
  studioThemes,
  themeVariablesCss,
} from './theme'
```

保留现有 `TOKEN_DEFINITIONS`，新增：

```ts
describe('studio light/dark themes', () => {
  it('uses identical token keys in both themes', () => {
    expect(Object.keys(studioThemes.light).sort()).toEqual(
      Object.keys(studioThemes.dark).sort(),
    )
  })

  it('preserves every existing dark token value', () => {
    const css = themeVariablesCss('dark')
    for (const definition of TOKEN_DEFINITIONS) {
      expect(css).toContain(definition)
    }
  })

  it('normalizes missing and invalid values to dark', () => {
    expect(normalizeStudioTheme(undefined)).toBe('dark')
    expect(normalizeStudioTheme(null)).toBe('dark')
    expect(normalizeStudioTheme('sepia')).toBe('dark')
    expect(normalizeStudioTheme('light')).toBe('light')
    expect(normalizeStudioTheme('dark')).toBe('dark')
  })

  it('provides a light panel without changing dark defaults', () => {
    expect(studioThemes.light['--theatre-panel-bg']).toBe('#ffffff')
    expect(studioThemes.light['--theatre-text-primary']).toBe('#18181b')
    expect(studioThemes.dark['--theatre-panel-bg']).toBe('#282b2f')
  })
})
```

将原 `defines all 15 tokens in css.tsx with their default values` 测试改为读取 `themeVariablesCss('dark')`，并新增源码断言：

```ts
it('GlobalStyle selects light tokens from the host attribute', () => {
  const css = read('css.tsx')
  expect(css).toContain(":host([data-theme='light'])")
  expect(css).toContain("themeVariablesCss('dark')")
  expect(css).toContain("themeVariablesCss('light')")
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm test --runInBand packages/studio/src/cssVariables.test.ts`
Expected: FAIL，错误为无法解析 `./theme`。

- [ ] **Step 3: 创建完整令牌模块**

创建 `packages/studio/src/theme.ts`：

```ts
export type StudioThemeName = 'light' | 'dark'

const fontFamily =
  '-apple-system, BlinkMacSystemFont, Segoe WPC, Segoe Editor, HelveticaNeue-Light, Ubuntu, Droid Sans, sans-serif'

export const studioThemes: Record<
  StudioThemeName,
  Record<string, string>
> = {
  dark: {
    '--theatre-panel-bg': '#282b2f',
    '--theatre-panel-bg-95': 'rgba(40, 43, 47, 0.95)',
    '--theatre-panel-bg-80': 'rgba(40, 43, 47, 0.8)',
    '--theatre-panel-bg-65': 'rgba(40, 43, 47, 0.65)',
    '--theatre-panel-bg-99': 'rgba(40, 43, 47, 0.99)',
    '--theatre-panel-header-bg': '#25272b',
    '--theatre-panel-border': '#1f1f1f',
    '--theatre-header-border': 'rgba(0, 0, 0, 0.13)',
    '--theatre-dope-sheet-bg': 'rgba(33, 35, 39, 0.99)',
    '--theatre-text-primary': '#ffffff',
    '--theatre-text-primary-80': 'rgba(255, 255, 255, 0.8)',
    '--theatre-text-primary-85': 'rgba(255, 255, 255, 0.85)',
    '--theatre-text-secondary': '#cccccc',
    '--theatre-text-muted': '#888888',
    '--theatre-text-subtle': '#a8a8a9',
    '--theatre-text-disabled': '#919191',
    '--theatre-path-disabled': '#777777',
    '--theatre-compound-label': '#c0c4c9',
    '--theatre-head-title': '#bbbbbb',
    '--theatre-head-subtitle': '#adadadb3',
    '--theatre-head-punctuation': '#808080',
    '--theatre-accent': '#40aaa4',
    '--theatre-divider': 'rgba(255, 255, 255, 0.08)',
    '--theatre-control-hover-bg': 'rgba(59, 63, 69, 0.8)',
    '--theatre-control-active-bg': 'rgba(82, 88, 96, 0.8)',
    '--theatre-control-selected-border': 'rgba(255, 255, 255, 0.7)',
    '--theatre-tooltip-bg': 'rgba(45, 46, 66, 0.5)',
    '--theatre-tooltip-border': 'rgba(86, 100, 110, 0.46)',
    '--theatre-viewport-overlay-bg': 'rgba(24, 24, 28, 0.9)',
    '--theatre-shot-view-bg': 'rgba(0, 0, 0, 0.55)',
    '--theatre-pip-bg': 'rgba(24, 24, 28, 0.4)',
    '--theatre-pip-border': 'rgba(255, 255, 255, 0.14)',
    '--theatre-loading-bg': '#454545',
    '--theatre-loading-track': 'rgba(255, 255, 255, 0.25)',
    '--theatre-shadow-color': 'rgba(0, 0, 0, 0.25)',
    '--theatre-font-family': fontFamily,
    '--theatre-font-size': '11px',
  },
  light: {
    '--theatre-panel-bg': '#ffffff',
    '--theatre-panel-bg-95': 'rgba(255, 255, 255, 0.95)',
    '--theatre-panel-bg-80': 'rgba(255, 255, 255, 0.8)',
    '--theatre-panel-bg-65': 'rgba(255, 255, 255, 0.65)',
    '--theatre-panel-bg-99': 'rgba(255, 255, 255, 0.99)',
    '--theatre-panel-header-bg': '#f4f4f5',
    '--theatre-panel-border': '#d4d4d8',
    '--theatre-header-border': 'rgba(0, 0, 0, 0.12)',
    '--theatre-dope-sheet-bg': 'rgba(250, 250, 250, 0.99)',
    '--theatre-text-primary': '#18181b',
    '--theatre-text-primary-80': 'rgba(24, 24, 27, 0.8)',
    '--theatre-text-primary-85': 'rgba(24, 24, 27, 0.85)',
    '--theatre-text-secondary': '#52525b',
    '--theatre-text-muted': '#71717a',
    '--theatre-text-subtle': '#52525b',
    '--theatre-text-disabled': '#a1a1aa',
    '--theatre-path-disabled': '#a1a1aa',
    '--theatre-compound-label': '#3f3f46',
    '--theatre-head-title': '#3f3f46',
    '--theatre-head-subtitle': 'rgba(63, 63, 70, 0.7)',
    '--theatre-head-punctuation': '#71717a',
    '--theatre-accent': '#0f766e',
    '--theatre-divider': 'rgba(0, 0, 0, 0.12)',
    '--theatre-control-hover-bg': 'rgba(228, 228, 231, 0.8)',
    '--theatre-control-active-bg': 'rgba(212, 212, 216, 0.8)',
    '--theatre-control-selected-border': 'rgba(24, 24, 27, 0.55)',
    '--theatre-tooltip-bg': 'rgba(255, 255, 255, 0.92)',
    '--theatre-tooltip-border': 'rgba(113, 113, 122, 0.45)',
    '--theatre-viewport-overlay-bg': 'rgba(255, 255, 255, 0.92)',
    '--theatre-shot-view-bg': 'rgba(255, 255, 255, 0.85)',
    '--theatre-pip-bg': 'rgba(255, 255, 255, 0.6)',
    '--theatre-pip-border': 'rgba(24, 24, 27, 0.2)',
    '--theatre-loading-bg': '#e4e4e7',
    '--theatre-loading-track': 'rgba(24, 24, 27, 0.18)',
    '--theatre-shadow-color': 'rgba(0, 0, 0, 0.12)',
    '--theatre-font-family': fontFamily,
    '--theatre-font-size': '11px',
  },
}

export function normalizeStudioTheme(
  value: string | null | undefined,
): StudioThemeName {
  return value === 'light' ? 'light' : 'dark'
}

export function themeVariablesCss(theme: StudioThemeName): string {
  return Object.entries(studioThemes[theme])
    .map(([name, value]) => `${name}: ${value};`)
    .join('\n')
}
```

- [ ] **Step 4: 接入 Shadow DOM GlobalStyle**

在 `css.tsx` 引入：

```ts
import {themeVariablesCss} from './theme'
```

删除 `:host` 中 15 个原有变量声明，替换为：

```tsx
:host {
  all: initial;
  ${themeVariablesCss('dark')}
  color-scheme: dark;
  color: var(--theatre-text-primary);
  font: var(--theatre-font-size) var(--theatre-font-family);
```

在 `:host` 主块结束后、通用 `*` 规则前加入：

```tsx
:host([data-theme='light']) {
  ${themeVariablesCss('light')}
  color-scheme: light;
}
```

`theme` 对象和 `panelUtils` 保持现有公开结构；本任务不删除 `lighten` 派生逻辑，后续任务迁移。

- [ ] **Step 5: 运行测试与 Studio 类型检查**

Run: `pnpm test --runInBand packages/studio/src/cssVariables.test.ts`
Expected: PASS。

Run: `pnpm --filter @dreamerbird/studio typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/theme.ts packages/studio/src/css.tsx packages/studio/src/cssVariables.test.ts
git commit -m "feat(studio): add light and dark theme tokens"
```

---

### Task 2: Camera Studio 主题桥接与会话生命周期

**Files:**
- Create: `packages/camera-studio/src/themeBridge.ts`
- Create: `packages/camera-studio/src/themeBridge.test.ts`
- Create: `packages/camera-studio/src/CameraThemeStyle.tsx`
- Modify: `packages/camera-studio/src/CameraScene.tsx:1-30,1975-1983`
- Modify: `packages/camera-studio/src/bootstrap.ts:402-468`

**Interfaces:**
- Consumes: `normalizeStudioTheme`、`themeVariablesCss`（来自 `@dreamerbird/studio/theme`）。
- Produces: `CAMERA_SCENE_ROOT_ATTR = 'data-camera-studio-root'`
- Produces: `CAMERA_THEME_ROOT_ATTR = 'data-camera-studio-theme-root'`
- Produces: `startThemeBridge(source: HTMLElement): {dispose(): void}`

- [ ] **Step 1: 写桥接失败测试**

创建 `themeBridge.test.ts`：

```ts
/*
 * @jest-environment jsdom
 */
import {
  CAMERA_SCENE_ROOT_ATTR,
  CAMERA_THEME_ROOT_ATTR,
  startThemeBridge,
} from './themeBridge'

const nextMicrotask = () => new Promise<void>((resolve) => queueMicrotask(resolve))

function element(id: string): HTMLElement {
  const el = document.createElement('div')
  el.id = id
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
  document.body.removeAttribute('data-theme')
})

describe('startThemeBridge', () => {
  it('syncs initial and subsequent themes to scene and studio roots', async () => {
    const source = element('host')
    const scene = element('scene')
    scene.setAttribute(CAMERA_SCENE_ROOT_ATTR, '')
    const studio = element('theatrejs-studio-root')
    source.dataset.theme = 'light'

    const bridge = startThemeBridge(source)
    expect(scene.dataset.theme).toBe('light')
    expect(studio.dataset.theme).toBe('light')
    expect(source.hasAttribute(CAMERA_THEME_ROOT_ATTR)).toBe(true)

    source.dataset.theme = 'dark'
    await nextMicrotask()
    expect(scene.dataset.theme).toBe('dark')
    expect(studio.dataset.theme).toBe('dark')
    bridge.dispose()
  })

  it('falls back to dark and discovers late targets', async () => {
    const source = element('host')
    source.dataset.theme = 'light'
    const bridge = startThemeBridge(source)

    source.dataset.theme = 'invalid'
    await nextMicrotask()
    const scene = element('scene')
    scene.setAttribute(CAMERA_SCENE_ROOT_ATTR, '')
    await nextMicrotask()
    expect(scene.dataset.theme).toBe('dark')

    source.dataset.theme = 'light'
    await nextMicrotask()
    source.removeAttribute('data-theme')
    await nextMicrotask()
    expect(scene.dataset.theme).toBe('dark')
    bridge.dispose()
  })

  it('disconnects observers and removes only its own source marker', async () => {
    const source = element('host')
    const scene = element('scene')
    scene.setAttribute(CAMERA_SCENE_ROOT_ATTR, '')
    source.dataset.theme = 'light'
    const bridge = startThemeBridge(source)
    bridge.dispose()

    expect(source.hasAttribute(CAMERA_THEME_ROOT_ATTR)).toBe(false)
    source.dataset.theme = 'dark'
    await nextMicrotask()
    expect(scene.dataset.theme).toBe('light')
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm test --runInBand packages/camera-studio/src/themeBridge.test.ts`
Expected: FAIL，错误为无法解析 `./themeBridge`。

- [ ] **Step 3: 实现桥接**

创建 `themeBridge.ts`：

```ts
import {normalizeStudioTheme} from '@dreamerbird/studio/theme'

export const CAMERA_SCENE_ROOT_ATTR = 'data-camera-studio-root'
export const CAMERA_THEME_ROOT_ATTR = 'data-camera-studio-theme-root'

export function startThemeBridge(source: HTMLElement): {dispose(): void} {
  const hadMarker = source.hasAttribute(CAMERA_THEME_ROOT_ATTR)
  source.setAttribute(CAMERA_THEME_ROOT_ATTR, '')

  const sync = () => {
    const theme = normalizeStudioTheme(source.getAttribute('data-theme'))
    const targets = document.querySelectorAll<HTMLElement>(
      `#theatrejs-studio-root, [${CAMERA_SCENE_ROOT_ATTR}]`,
    )
    targets.forEach((target) => {
      if (target !== source) target.dataset.theme = theme
    })
  }

  sync()
  const sourceObserver = new MutationObserver(sync)
  sourceObserver.observe(source, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  const targetObserver = new MutationObserver(sync)
  targetObserver.observe(document.documentElement, {childList: true, subtree: true})

  return {
    dispose() {
      sourceObserver.disconnect()
      targetObserver.disconnect()
      if (!hadMarker) source.removeAttribute(CAMERA_THEME_ROOT_ATTR)
    },
  }
}
```

- [ ] **Step 4: 添加主文档主题样式并标记场景根**

创建 `CameraThemeStyle.tsx`：

```tsx
import {createGlobalStyle} from 'styled-components'
import {themeVariablesCss} from '@dreamerbird/studio/theme'
import {CAMERA_THEME_ROOT_ATTR} from './themeBridge'

export const CameraThemeStyle = createGlobalStyle`
  [${CAMERA_THEME_ROOT_ATTR}] {
    ${themeVariablesCss('dark')}
    color-scheme: dark;
  }

  [${CAMERA_THEME_ROOT_ATTR}][data-theme='light'] {
    ${themeVariablesCss('light')}
    color-scheme: light;
  }
`
```

在 `CameraScene.tsx` 导入 `CameraThemeStyle`，并在 `SceneI18nRoot` 内、根 `div` 前渲染 `<CameraThemeStyle />`。根 `div` 改为：

```tsx
<div
  data-camera-studio-root
  data-camera-studio-theme-root
  style={{height: '100vh', position: 'relative'}}
>
```

- [ ] **Step 5: 接入 acquireSession 与 teardown**

在 `bootstrap.ts` 导入 `startThemeBridge`。在 `acquireSession` 注册自定义属性编辑器后创建：

```ts
const themeBridge = startThemeBridge(
  ctx.config.ui?.portalContainer ?? document.body,
)
```

在 `sessionTeardown` 的最前面、`sessionTeardown = undefined` 之后调用：

```ts
themeBridge.dispose()
```

更新文件顶部生命周期注释，把主题桥接列入会话级资源。

- [ ] **Step 6: 运行测试和类型检查**

Run: `pnpm test --runInBand packages/camera-studio/src/themeBridge.test.ts packages/camera-studio/src/bootstrap.test.tsx packages/camera-studio/src/CameraScene.test.tsx`
Expected: PASS。

Run: `pnpm --filter @dreamerbird/camera-studio build:ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/camera-studio/src/themeBridge.ts packages/camera-studio/src/themeBridge.test.ts packages/camera-studio/src/CameraThemeStyle.tsx packages/camera-studio/src/CameraScene.tsx packages/camera-studio/src/bootstrap.ts
git commit -m "feat(camera-studio): sync host theme across ui roots"
```

---

### Task 3: Studio 面板与派生背景迁移

**Files:**
- Modify: `packages/studio/src/css.tsx:26-48`
- Modify: `packages/studio/src/panels/BasePanel/common.tsx:46-60`
- Modify: `packages/studio/src/panels/SequenceEditorPanel/SequenceEditorPanel.tsx`
- Modify: `packages/studio/src/panels/SequenceEditorPanel/TransportBar.tsx`
- Modify: `packages/studio/src/panels/SequenceEditorPanel/DopeSheet/Right/DopeSheetBackground.tsx`
- Modify: `packages/studio/src/panels/DetailPanel/DetailPanel.tsx`
- Modify: `packages/studio/src/panels/DetailPanel/ObjectDetails.tsx`
- Modify: `packages/studio/src/propEditors/simpleEditors/FilePropEditor.tsx`
- Modify: `packages/studio/src/propEditors/simpleEditors/ImagePropEditor.tsx`
- Modify: `packages/studio/src/propEditors/utils/propNameTextCSS.tsx`
- Modify: `packages/studio/src/panels/SequenceEditorPanel/DopeSheet/Right/BasicKeyframedTrack/KeyframeEditor/DeterminePropEditorForSingleKeyframe.tsx`
- Modify: `packages/studio/src/cssVariables.test.ts`

**Interfaces:**
- Consumes: `--theatre-panel-header-bg`、`--theatre-dope-sheet-bg`、`--theatre-text-subtle`、`--theatre-text-disabled`、`--theatre-compound-label`。

- [ ] **Step 1: 添加固定色失败断言**

在 `cssVariables.test.ts` 添加：

```ts
it('panel chrome and derived backgrounds use semantic tokens', () => {
  expectMigrated(
    [
      'panels/BasePanel/common.tsx',
      'panels/SequenceEditorPanel/SequenceEditorPanel.tsx',
      'panels/SequenceEditorPanel/TransportBar.tsx',
      'panels/SequenceEditorPanel/DopeSheet/Right/DopeSheetBackground.tsx',
    ],
    [/#25272b/i, /darken\([^)]*#282b2f/i],
    [],
  )
  expect(read('panels/BasePanel/common.tsx')).toContain(
    'var(--theatre-panel-header-bg)',
  )
  expect(
    read('panels/SequenceEditorPanel/DopeSheet/Right/DopeSheetBackground.tsx'),
  ).toContain('var(--theatre-dope-sheet-bg)')
})

it('secondary and disabled text use semantic tokens', () => {
  expectMigrated(
    [
      'panels/DetailPanel/DetailPanel.tsx',
      'panels/DetailPanel/ObjectDetails.tsx',
      'propEditors/simpleEditors/FilePropEditor.tsx',
      'propEditors/simpleEditors/ImagePropEditor.tsx',
      'propEditors/utils/propNameTextCSS.tsx',
      'panels/SequenceEditorPanel/DopeSheet/Right/BasicKeyframedTrack/KeyframeEditor/DeterminePropEditorForSingleKeyframe.tsx',
    ],
    [/#919191/i, /#a8a8a9/i, /#ccc\b/i],
    [],
  )
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm test --runInBand packages/studio/src/cssVariables.test.ts`
Expected: FAIL，命中 `#25272b` 和中间灰文字。

- [ ] **Step 3: 逐值替换样式**

执行以下精确映射：

```text
#25272b                  -> var(--theatre-panel-header-bg)
#919191                  -> var(--theatre-text-disabled)
#a8a8a9 / #A8A8A9        -> var(--theatre-text-subtle)
#adadadb3                -> var(--theatre-head-subtitle)
#CCC（propNameTextCSS）  -> var(--theatre-text-secondary)
```

`DopeSheetBackground.tsx` 删除 `darken`、`transparentize` import 和静态派生，背景改为：

```tsx
background: var(--theatre-dope-sheet-bg);
```

`css.tsx` 删除 `lighten` import，`theme.panel.body.compoudThing.label.color` 改为普通属性：

```ts
color: `var(--theatre-compound-label)`,
```

`TitleBar` 的 `rgb(0 0 0 / 13%)` 改为 `var(--theatre-header-border)`；这是标题栏分隔线语义，不改布局。

- [ ] **Step 4: 运行测试和类型检查**

Run: `pnpm test --runInBand packages/studio/src/cssVariables.test.ts`
Expected: PASS。

Run: `pnpm --filter @dreamerbird/studio typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/studio/src/css.tsx packages/studio/src/cssVariables.test.ts packages/studio/src/panels packages/studio/src/propEditors
git commit -m "refactor(studio): tokenize panel chrome colors"
```

---

### Task 4: Studio 控件、工具栏与浮层迁移

**Files:**
- Modify: `packages/studio/src/uiComponents/toolbar/ToolbarIconButton.tsx`
- Modify: `packages/studio/src/uiComponents/toolbar/ToolbarButton.tsx`
- Modify: `packages/studio/src/toolbars/PinButton.tsx`
- Modify: `packages/studio/src/uiComponents/Popover/BasicTooltip.tsx`
- Modify: `packages/studio/src/uiComponents/Popover/BasicPopover.tsx`
- Modify: `packages/studio/src/uiComponents/simpleContextMenu/ContextMenu/BaseMenu.tsx`
- Modify: `packages/studio/src/notify.tsx`
- Modify: `packages/studio/src/cssVariables.test.ts`

**Interfaces:**
- Consumes: `--theatre-control-hover-bg`、`--theatre-control-active-bg`、`--theatre-control-selected-border`、`--theatre-tooltip-bg`、`--theatre-tooltip-border`、`--theatre-divider`。

- [ ] **Step 1: 添加交互控件与浮层失败断言**

在 `cssVariables.test.ts` 添加：

```ts
it('toolbar interaction and tooltip surfaces use semantic tokens', () => {
  expectMigrated(
    [
      'uiComponents/toolbar/ToolbarIconButton.tsx',
      'uiComponents/toolbar/ToolbarButton.tsx',
      'toolbars/PinButton.tsx',
      'uiComponents/Popover/BasicTooltip.tsx',
    ],
    [
      /#919191/i,
      /#a8a8a9/i,
      /rgba\(59,\s*63,\s*69,\s*0\.8\)/,
      /rgba\(82,\s*88,\s*96,\s*0\.8\)/,
      /rgb\(45\s+46\s+66\s*\/\s*50%\)/,
    ],
    [],
  )
  expect(read('uiComponents/toolbar/ToolbarIconButton.tsx')).toContain(
    'var(--theatre-control-hover-bg)',
  )
  expect(read('uiComponents/Popover/BasicTooltip.tsx')).toContain(
    'var(--theatre-tooltip-bg)',
  )
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm test --runInBand packages/studio/src/cssVariables.test.ts`
Expected: FAIL，命中工具栏和 Tooltip 固定色。

- [ ] **Step 3: 替换交互态与浮层颜色**

在列出的文件中按以下映射修改：

```text
rgba(59, 63, 69, 0.8)       -> var(--theatre-control-hover-bg)
rgba(82, 88, 96, 0.8)       -> var(--theatre-control-active-bg)
rgba(255, 255, 255, 0.08)   -> var(--theatre-divider)
rgba(255, 255, 255, 0.7)    -> var(--theatre-control-selected-border)
rgb(45 46 66 / 50%)         -> var(--theatre-tooltip-bg)
rgb(86 100 110 / 46%)       -> var(--theatre-tooltip-border)
#919191                     -> var(--theatre-text-disabled)
#a8a8a9                     -> var(--theatre-text-subtle)
rgba(255, 255, 255, 0.8)    -> var(--theatre-text-primary-80)
```

`BasicPopover`、`BaseMenu`、`notify` 中仅替换与这些语义值相同的 UI chrome；成功/错误等状态色保留业务语义，不能与文字主色合并。不要改变 `backdrop-filter`、布局、阴影尺寸或 z-index。

- [ ] **Step 4: 扫描残留并分类**

Run: `graft grep "#25272b|#282b2f|#919191|#a8a8a9" --in packages/studio/`

对生产源码中的剩余命中逐一核对：属于面板/文字 chrome 的按 Task 3 映射替换；`compare.ts` 注释、测试断言、用户颜色换算和 Three.js 内容不改。扫描结果不得剩下列出文件中的固定 UI chrome。

- [ ] **Step 5: 运行测试和类型检查**

Run: `pnpm test --runInBand packages/studio/src/cssVariables.test.ts`
Expected: PASS。

Run: `pnpm --filter @dreamerbird/studio typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/uiComponents packages/studio/src/toolbars/PinButton.tsx packages/studio/src/notify.tsx packages/studio/src/cssVariables.test.ts
git commit -m "refactor(studio): tokenize controls and popovers"
```

---

### Task 5: Camera Studio 面板、工具栏和路径编辑迁移

**Files:**
- Create: `packages/camera-studio/src/themeCoverage.test.ts`
- Modify: `packages/camera-studio/src/TopToolbar.tsx`
- Modify: `packages/camera-studio/src/assetLibrary/AssetLibraryPanel.tsx`
- Modify: `packages/camera-studio/src/poseMode/PosePickerFrame.tsx`
- Modify: `packages/camera-studio/src/poseMode/PoseModeBar.tsx`
- Modify: `packages/camera-studio/src/CameraPath.tsx`

**Interfaces:**
- Consumes: Task 1 的全部语义变量；不新增公开接口。

- [ ] **Step 1: 写 Camera Studio 固定色失败测试**

创建 `themeCoverage.test.ts`：

```ts
import {readFileSync} from 'fs'
import {join} from 'path'

const read = (path: string) => readFileSync(join(__dirname, path), 'utf8')

describe('camera studio theme coverage', () => {
  it('uses semantic panel and control colors', () => {
    const files = [
      'TopToolbar.tsx',
      'assetLibrary/AssetLibraryPanel.tsx',
      'poseMode/PosePickerFrame.tsx',
      'poseMode/PoseModeBar.tsx',
      'CameraPath.tsx',
    ]
    for (const file of files) {
      const source = read(file)
      expect(source).not.toMatch(/#25272b/i)
      expect(source).not.toMatch(/#eee\b/i)
      expect(source).not.toMatch(/rgb\(45\s+46\s+66\s*\/\s*50%\)/)
      expect(source).not.toMatch(/rgba\(59,\s*63,\s*69,\s*0\.8\)/)
    }
    expect(read('assetLibrary/AssetLibraryPanel.tsx')).toContain(
      'var(--theatre-panel-header-bg)',
    )
    expect(read('poseMode/PosePickerFrame.tsx')).toContain(
      'var(--theatre-panel-header-bg)',
    )
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm test --runInBand packages/camera-studio/src/themeCoverage.test.ts`
Expected: FAIL，命中资产库、姿势框和路径编辑固定色。

- [ ] **Step 3: 替换面板与控件颜色**

在列出的文件中使用与 Studio 相同的映射：

```text
#25272b                       -> var(--theatre-panel-header-bg)
#eee                          -> var(--theatre-text-primary)
#777（路径禁用文字）           -> var(--theatre-path-disabled)
rgb(45 46 66 / 50%)           -> var(--theatre-tooltip-bg)
rgb(86 100 110 / 46%)         -> var(--theatre-tooltip-border)
rgba(59, 63, 69, 0.8)         -> var(--theatre-control-hover-bg)
rgba(82, 88, 96, 0.8)         -> var(--theatre-control-active-bg)
rgb(0 0 0 / 13%)              -> var(--theatre-header-border)
```

`PosePickerFrame.tsx` 保持 inline style，不改用 styled-components；其 Portal 挂载容器已由 Task 2 提供变量。`PoseModeBar` 复用现有工具栏变量。更新 `TopToolbar.tsx` 和 `AssetLibraryPanel.tsx` 顶部“只能使用深色兜底”的旧注释，改为说明主文档根节点和 Portal 容器均由主题桥接提供变量。

- [ ] **Step 4: 运行测试和类型检查**

Run: `pnpm test --runInBand packages/camera-studio/src/themeCoverage.test.ts packages/camera-studio/src/TopToolbar.test.tsx packages/camera-studio/src/uiConfig.test.tsx packages/camera-studio/src/CameraScene.test.tsx`
Expected: PASS。

Run: `pnpm --filter @dreamerbird/camera-studio build:ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/camera-studio/src/themeCoverage.test.ts packages/camera-studio/src/TopToolbar.tsx packages/camera-studio/src/assetLibrary/AssetLibraryPanel.tsx packages/camera-studio/src/poseMode/PosePickerFrame.tsx packages/camera-studio/src/poseMode/PoseModeBar.tsx packages/camera-studio/src/CameraPath.tsx
git commit -m "refactor(camera-studio): tokenize panel and editor colors"
```

---

### Task 6: Camera Scene DOM 覆盖层迁移

**Files:**
- Modify: `packages/camera-studio/src/CameraScene.tsx:2001-2064,2412-2442`
- Modify: `packages/camera-studio/src/PipCameraSelector.tsx`
- Modify: `packages/camera-studio/src/themeCoverage.test.ts`

**Interfaces:**
- Consumes: `--theatre-viewport-overlay-bg`、`--theatre-shot-view-bg`、`--theatre-pip-bg`、`--theatre-pip-border`、`--theatre-loading-bg`、`--theatre-loading-track`、`--theatre-text-primary-85`。

- [ ] **Step 1: 添加场景 DOM 覆盖层失败断言**

在 `themeCoverage.test.ts` 的 `describe` 中新增：

```ts
it('uses theme variables for DOM overlays but not the WebGL background', () => {
  const source = read('CameraScene.tsx')
  expect(source).toContain("background: 'var(--theatre-loading-bg)'")
  expect(source).toContain('var(--theatre-viewport-overlay-bg)')
  expect(source).toContain('var(--theatre-shot-view-bg)')
  expect(source).toContain('var(--theatre-pip-bg)')
  expect(source).toContain('const BACKGROUND = new Color().setRGB(')
  expect(source).toContain('0x45 / 255')
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm test --runInBand packages/camera-studio/src/themeCoverage.test.ts`
Expected: FAIL，加载遮罩仍是 `#454545`。

- [ ] **Step 3: 只迁移 DOM 覆盖层**

将放置提示、镜头视角提示、画中画 DOM 边框和首屏加载遮罩中的 UI 颜色替换为：

```text
rgba(24, 24, 28, 0.9)         -> var(--theatre-viewport-overlay-bg)
rgba(0, 0, 0, 0.55)           -> var(--theatre-shot-view-bg)
rgba(24, 24, 28, 0.4)         -> var(--theatre-pip-bg)
rgba(255, 255, 255, 0.14)     -> var(--theatre-pip-border)
#eee                          -> var(--theatre-text-primary)
rgba(255, 255, 255, 0.85)     -> var(--theatre-text-primary-85)
#454545（仅首屏 DOM 遮罩）     -> var(--theatre-loading-bg)
rgba(255, 255, 255, 0.25)     -> var(--theatre-loading-track)
```

加载 spinner 的 `borderTopColor` 使用 `var(--theatre-accent)`。`BACKGROUND`、`<ambientLight>`、`<hemisphereLight>`、相机 Target 的 `color="red"` 和任何 Three.js 材质保持原值。

- [ ] **Step 4: 运行测试和类型检查**

Run: `pnpm test --runInBand packages/camera-studio/src/themeCoverage.test.ts packages/camera-studio/src/CameraScene.test.tsx`
Expected: PASS。

Run: `pnpm --filter @dreamerbird/camera-studio build:ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/camera-studio/src/CameraScene.tsx packages/camera-studio/src/PipCameraSelector.tsx packages/camera-studio/src/themeCoverage.test.ts
git commit -m "refactor(camera-studio): tokenize scene dom overlays"
```

---

### Task 7: 宿主文档、可运行示例与端到端切换

**Files:**
- Modify: `packages/studio/THEMING.md`
- Modify: `docs/guides/camera-studio-embedding.md`
- Modify: `examples/camera-host-demo/src/main.tsx`
- Create: `examples/camera-host-demo/src/theme.e2e.ts`

**Interfaces:**
- Consumes: 宿主容器 `data-theme`、场景根 `[data-camera-studio-root]`、Studio 根 `#theatrejs-studio-root`。

- [ ] **Step 1: 先写端到端测试**

创建 `theme.e2e.ts`：

```ts
import {expect, test} from '@playwright/test'

test('host switches camera and studio UI between dark and light', async ({
  page,
}) => {
  await page.goto('/')
  const scene = page.locator('[data-camera-studio-root]')
  const studio = page.locator('#theatrejs-studio-root')

  await expect(scene).toHaveAttribute('data-theme', 'dark')
  await expect(studio).toHaveAttribute('data-theme', 'dark')

  await page.getByRole('button', {name: '切换浅色'}).click()
  await expect(scene).toHaveAttribute('data-theme', 'light')
  await expect(studio).toHaveAttribute('data-theme', 'light')
  await expect
    .poll(() =>
      scene.evaluate((el) =>
        getComputedStyle(el).getPropertyValue('--theatre-panel-bg').trim(),
      ),
    )
    .toBe('#ffffff')

  await page.getByRole('button', {name: '切换深色'}).click()
  await expect(scene).toHaveAttribute('data-theme', 'dark')
  await expect(studio).toHaveAttribute('data-theme', 'dark')
  await expect
    .poll(() =>
      scene.evaluate((el) =>
        getComputedStyle(el).getPropertyValue('--theatre-panel-bg').trim(),
      ),
    )
    .toBe('#282b2f')

  await scene.evaluate((el) =>
    el.style.setProperty('--theatre-panel-bg', 'rgb(1, 2, 3)'),
  )
  await expect
    .poll(() =>
      scene.evaluate((el) =>
        getComputedStyle(el).getPropertyValue('--theatre-panel-bg').trim(),
      ),
    )
    .toBe('rgb(1, 2, 3)')
  await scene.evaluate((el) =>
    el.style.removeProperty('--theatre-panel-bg'),
  )
})
```

- [ ] **Step 2: 运行 e2e 并确认失败**

Run: `pnpm --filter camera-host-demo test:e2e -- src/theme.e2e.ts`
Expected: FAIL，页面没有“切换浅色”按钮。

- [ ] **Step 3: 给宿主 demo 加主题切换**

`main.tsx` 的 React import 加入 `useEffect`，删除模块级固定 `document.body.style.backgroundColor = '#171717'`。在 `App` 中实现：

```tsx
function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  useEffect(() => {
    document.body.dataset.theme = theme
    document.body.style.backgroundColor =
      theme === 'light' ? '#f4f4f5' : '#171717'
  }, [theme])

  return (
    <div>
      <HostNav
        theme={theme}
        onToggle={() =>
          setTheme((value) => (value === 'dark' ? 'light' : 'dark'))
        }
      />
      <StudioRoute />
    </div>
  )
}
```

将 `HostNav` 签名改为：

```tsx
function HostNav({theme, onToggle}: {theme: 'light' | 'dark'; onToggle: () => void}) {
```

在返回首页链接前添加：

```tsx
<button type="button" onClick={onToggle}>
  {theme === 'dark' ? '切换浅色' : '切换深色'}
</button>
```

`HostNav` 自身背景、边框和文字颜色也按 `theme` 取宿主值；这部分属于宿主应用，不使用 Camera Studio 内部 API。

- [ ] **Step 4: 更新接入文档**

`packages/studio/THEMING.md` 增加：

```md
## Light / Dark

独立 Studio 在 `#theatrejs-studio-root` 上设置 `data-theme="light"` 或 `"dark"`。缺失、移除或非法值回退 Dark。Camera Studio 宿主改为在 `ui.portalContainer`（未配置时为 `document.body`）上设置该属性，桥接会同步 Studio、场景 UI 和 Portal。系统不读取 `prefers-color-scheme`，也不提供公开 JS 主题 API。
```

把完整令牌表补入 Task 1 新增的变量，注明 Dark 默认值和宿主覆盖优先级。`docs/guides/camera-studio-embedding.md` 增加相同的宿主示例和运行时切换代码，并说明 Three.js 场景内容不随 UI 主题变化。

- [ ] **Step 5: 运行 e2e、demo 构建和文档相关测试**

Run: `pnpm --filter camera-host-demo test:e2e -- src/theme.e2e.ts`
Expected: PASS，两次方向切换均通过。

Run: `pnpm --filter camera-host-demo build`
Expected: PASS。

Run: `pnpm --filter camera-host-demo typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/studio/THEMING.md docs/guides/camera-studio-embedding.md examples/camera-host-demo/src/main.tsx examples/camera-host-demo/src/theme.e2e.ts
git commit -m "docs(camera-studio): demonstrate host driven themes"
```

---

### Task 8: 全量回归与视觉验收

**Files:**
- Modify only files needed to fix regressions found by the following checks; keep each fix within the theme scope.

**Interfaces:**
- Consumes: Tasks 1–7 的全部实现；不新增接口。

- [ ] **Step 1: 运行两个包的定向测试**

Run: `pnpm test --runInBand packages/studio/src/cssVariables.test.ts packages/camera-studio/src/themeBridge.test.ts packages/camera-studio/src/themeCoverage.test.ts packages/camera-studio/src/CameraScene.test.tsx packages/camera-studio/src/bootstrap.test.tsx`
Expected: PASS，无快照更新。

- [ ] **Step 2: 运行全仓测试与类型检查**

Run: `pnpm test --runInBand`
Expected: PASS。

Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: 运行 lint 和 demo 生产构建**

Run: `pnpm lint:all`
Expected: PASS，无新增 warning。

Run: `pnpm --filter camera-host-demo build`
Expected: PASS。

- [ ] **Step 4: 在真实浏览器做双主题视觉检查**

Run: `pnpm --filter camera-host-demo dev -- --host 127.0.0.1`

使用浏览器依次检查 Dark → Light → Dark：

- 顶栏、资产库、属性面板、时间轴、姿势选择框、路径编辑条；
- 右键菜单、通知、Tooltip、Popover；
- hover、disabled、selected、focus；
- Shadow DOM 与主文档变量值一致，Portal 不出现深色残留；
- 场景模型、材质、灯光、WebGL 视口背景在切换前后不变；
- 选中对象、面板开关、播放头和播放状态在切换前后不变。

任何视觉缺陷先添加能覆盖该固定色或主题同步路径的失败测试，再修复并重跑 Steps 1–3。

- [ ] **Step 5: 最终提交**

```bash
git add packages/studio packages/camera-studio examples/camera-host-demo docs/guides/camera-studio-embedding.md
git commit -m "test(camera-studio): verify light and dark theme integration"
```
