/*
 * @jest-environment jsdom
 */
/**
 * 纯查看器模式的骨架族标签(终审 M-6):改名入口与导入/删除入口同套
 * canWrite 判别——纯查看器下标签仍是纯展示,点击不再弹改名 prompt
 * (修复前可点但 setRigAlias 抛 auth 被 catch 成 console-only)。
 *
 * 重依赖逐项 doMock(与 CameraScene.test.tsx 同套手法;jest-esbuild
 * 不提升 jest.mock,doMock 先行登记 + 运行时 require):
 * PlacementManager(three/r3f 重链)、importPipeline/thumbnail(导入与
 * 缩略图副作用)、useModelThumbUrl(hook)、PathPresetThumb(预设卡片)、
 * contextMenu(studio ContextMenu)。i18n 用模块级 fallback(全局
 * translate 单例,pg.* 词条已由 camera-studio i18n 模块注册)。
 */
import React, {act} from 'react'
import ReactDOM from 'react-dom/client'
import type {WritableLibrarySource} from './source'
import type {AnimationEntry, LibraryEntry} from './types'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}
jest.doMock('../PlacementManager', () => ({
  __esModule: true,
  countLibraryEntryUsage: () => 0,
}))
jest.doMock('./importPipeline', () => ({
  __esModule: true,
  planImport: async () => {
    throw new Error('test 未布置导入')
  },
  executeImport: async () => {},
  realImportDeps: () => ({}),
}))
jest.doMock('./thumbnail', () => ({
  __esModule: true,
  backfillModelThumbnails: async () => {},
}))
jest.doMock('./useModelThumbUrl', () => ({
  __esModule: true,
  useModelThumbUrl: () => ({
    getThumbUrl: () => undefined,
    dropThumbUrl: noop,
  }),
}))
jest.doMock('../PathPresetThumb', () => ({
  __esModule: true,
  PathPresetThumb: () => null,
}))
jest.doMock('../contextMenu', () => ({
  __esModule: true,
  CanvasContextMenu: () => null,
}))

const {AssetLibraryPanel} = require('./AssetLibraryPanel') as {
  AssetLibraryPanel: (props: Record<string, unknown>) => React.ReactElement
}
const {configureLibrary} = require('./library') as {
  configureLibrary: (opts: {sources: unknown[]}) => unknown
}

/** 造一个持有一条姿势条目(骨架 rig-test)的源;writable 决定查看器模式 */
function makeSource(
  writable: boolean,
  entries: LibraryEntry[] = [
    {
      id: 'pose-1',
      kind: 'pose',
      name: '姿势一',
      rig: 'rig-test',
      bones: {},
      createdAt: 1,
    },
  ],
) {
  const base = {
    id: writable ? 'idb' : 'catalog',
    listEntries: async () => entries,
    getEntry: async (id: string) => entries.find((e) => e.id === id),
    getBlobUrl: async () => '',
  }
  if (!writable) return {...base, capabilities: {writable: false}}
  return {
    ...base,
    capabilities: {writable: true},
    putEntry: async () => {},
    deleteEntry: async () => {},
    putBlob: async () => 'blob:x',
    deleteBlob: async () => {},
    getRigAliases: async () => [],
    putRigAlias: async () => {},
  } as WritableLibrarySource
}

async function renderPosePanel(writable: boolean): Promise<HTMLElement> {
  configureLibrary({sources: [makeSource(writable)]})
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = ReactDOM.createRoot(el)
  await act(async () => {
    root.render(
      React.createElement(AssetLibraryPanel, {
        kind: 'pose',
        onClose: noop,
        onApplyPose: noop,
      }),
    )
  })
  await act(async () => {}) // 冲刷库条目/别名订阅的异步 effect
  return el
}

/** 卡片上的骨架族标签:文本 = 族 id(无别名时) */
function findRigTag(el: HTMLElement): HTMLElement | undefined {
  return [...el.querySelectorAll('div')].find(
    (d) => d.textContent === 'rig-test',
  ) as HTMLElement | undefined
}

test('纯查看器:族标签点击不弹改名 prompt(入口隐藏)', async () => {
  const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('新族名')
  try {
    const el = await renderPosePanel(false)
    const tag = findRigTag(el)
    expect(tag).toBeTruthy() // 标签本身仍在(纯展示)
    await act(async () => {
      tag!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })
    expect(promptSpy).not.toHaveBeenCalled()
  } finally {
    promptSpy.mockRestore()
  }
})

test('可写源:族标签点击弹改名 prompt(入口仍在)', async () => {
  const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('新族名')
  try {
    const el = await renderPosePanel(true)
    const tag = findRigTag(el)
    expect(tag).toBeTruthy()
    await act(async () => {
      tag!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })
    expect(promptSpy).toHaveBeenCalledTimes(1)
  } finally {
    promptSpy.mockRestore()
  }
})

test('动作库按包筛选共享动作，并支持动作名搜索', async () => {
  const animate = (
    id: string,
    name: string,
    packs: string[],
  ): AnimationEntry => ({
    id,
    name,
    packs,
    kind: 'animation',
    rig: 'rig-test',
    blobId: id,
    contentHash: id,
    duration: 1,
    createdAt: 0,
  })
  const walk = animate('walk', 'Mixamo Locomotion - Walking', [
    'Locomotion',
    'Basic Locomotion',
  ])
  const idle = animate('idle', 'Mixamo Locomotion - Idle', [
    'Locomotion',
    'Basic Locomotion',
  ])
  const wave = animate('wave', 'Mixamo Gestures Basic - Wave', [
    'Gestures Basic',
  ])
  configureLibrary({sources: [makeSource(false, [walk, idle, wave])]})
  const container = document.body.appendChild(document.createElement('div'))
  const root = ReactDOM.createRoot(container)
  try {
    await act(async () => {
      root.render(<AssetLibraryPanel kind="animation" onClose={noop} />)
    })
    expect(
      Array.from(
        container.querySelectorAll('h3'),
        (heading) => heading.textContent,
      ),
    ).toEqual(expect.arrayContaining(['Locomotion', 'Gestures Basic']))

    const pack = container.querySelector('select')!
    const search = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!
    const cards = () =>
      [walk, idle, wave].filter((entry) =>
        container.querySelector(`[title="${entry.name}"]`),
      )
    expect(cards()).toEqual([walk, idle, wave])
    const locomotionHeading = [...container.querySelectorAll('h3')].find(
      (heading) => heading.textContent?.includes('Locomotion'),
    )
    const togglePack = locomotionHeading!.querySelector('button')!
    await act(async () => togglePack.click())
    expect(togglePack.getAttribute('aria-expanded')).toBe('false')
    expect(cards()).toEqual([wave])

    await act(async () => {
      pack.value = 'Basic Locomotion'
      pack.dispatchEvent(new Event('change', {bubbles: true}))
    })
    expect(cards()).toEqual([walk, idle])
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(search, '  WALK  ')
      search.dispatchEvent(new Event('input', {bubbles: true}))
    })
    expect(cards()).toEqual([walk])
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
