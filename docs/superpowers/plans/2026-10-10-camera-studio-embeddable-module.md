# camera-studio 可嵌入模块实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 playground 的相机场景系统封装为可嵌入宿主应用的模块包 `@dreamerbird/camera-studio`(hooks 初始化 + 统一数据源 + 资产清单化)。

**Architecture:** 新建 `packages/camera-studio`,`src/shared/camera/` 整目录 git mv 迁入;公开面 = `useCameraStudio(config)` + `<CameraScene>`;存储抽象升级为统一数据源接口(`LibrarySource`/`WritableLibrarySource`),内置种子资产改只读目录源(不再播种进用户库);场景状态与协作走 theatre 既有通道,模块不含服务端。

**Tech Stack:** TypeScript 5.6 / React 19 / three 0.185 / jest(jest-esbuild,从仓库根跑)/ vite(playground 壳与 demo)/ IndexedDB(内置可写源实现)。

**Spec:** `docs/superpowers/specs/2026-10-10-camera-studio-embeddable-module-design.md`(已评审定稿;本计划逐任务对照其实现)

## Global Constraints

- jest 必须从**仓库根**跑:`npx jest <path>`(在 packages 子目录跑会拿错 babel 配置);eslint 同理从根跑 `npx eslint <path>`。
- 类型检查:搬迁前 `npx tsc -p packages/playground/tsconfig.json --noEmit`;搬迁后 `npx tsc -p packages/camera-studio/tsconfig.json --noEmit`(T1 建好后两个都能跑)。
- jest-esbuild **不提升 jest.mock**:需要 mock 时用 `jest.doMock` + `jest.resetModules` + 运行时 `require`。
- 提交信息中文、结尾必须带:
  ```
  Co-Authored-By: Claude Code <noreply@anthropic.com>
  ```
- IndexedDB 缺省库名保持 `toybox-asset-library` 一字不变(存量用户数据零迁移,硬约束)。
- 内置条目 id 前缀 `seed-pose-*` 保持不变(场景里的旧姿势引用靠它继续解析)。
- 每个任务结束:相关测试绿 + tsc 绿 + eslint 绿,再提交。
- 代码注释用中文,风格对齐所在文件既有注释密度。

## Review Focus

1. **宿主不配 storage 且浏览器无 IndexedDB**(隐私模式):模块应降级为内置目录只读可用,不白屏 → T5 步骤里有测试钉住。
2. **旧场景引用已被清理的旧播种模型条目**:模型缺失要显示占位而不是崩 → T7 测试钉住(姿势引用同 id 存活 + 模型缺失占位)。
3. **`assets.baseUrl` 配错(404)**:内置模型/预览图加载失败走 LibraryError('network'),选择框照常打开 → T6 测试。
4. **React StrictMode 双跑 / 快速进出编辑页**(挂载-卸载-挂载):不重复注册编辑器、不重复 `theatre.init`、库连接干净关 → T8 测试。
5. **宿主的可写源行为不端**(同一 id 两次返回不同条目、`getBlobUrl` 抛错):聚合器防御 + 错误事件,不拖垮面板 → T4 契约套件 + T5 聚合器测试各钉一部分。

---

### Task 1: packages/camera-studio 包骨架

**Files:**
- Create: `packages/camera-studio/package.json`
- Create: `packages/camera-studio/tsconfig.json`
- Create: `packages/camera-studio/src/index.ts`
- Create: `packages/camera-studio/src/smoke.test.ts`
- Modify: `tsconfig.base.json`(:19 行前插入两行 paths)

**Interfaces:**
- Produces: 包名 `@dreamerbird/camera-studio`;别名 `@dreamerbird/camera-studio` → `packages/camera-studio/src/index.ts`(jest/vite/tsc 三套别名都由 tsconfig.base.json paths 生成,加这一处就够)。

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "@dreamerbird/camera-studio",
  "version": "0.1.0",
  "license": "Apache-2.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {"types": "./dist/index.d.ts", "default": "./dist/index.js"}
  },
  "files": ["dist/**/*", "assets/**/*"],
  "scripts": {
    "build:ts": "tsc -b tsconfig.json",
    "clean": "rimraf dist tsconfig.tsbuildinfo"
  },
  "peerDependencies": {
    "@dreamerbird/core": "*",
    "@dreamerbird/studio": "*",
    "react": ">=19",
    "react-dom": ">=19",
    "three": ">=0.185"
  }
}
```

(peerDependencies 完整清单在 T2 搬迁后按实际 import 补齐——T2 Step 里有核对命令。)

- [ ] **Step 2: 写 tsconfig.json**

先 `cat packages/saaz/tsconfig.json` 看现状,照它复制一份改 `include`/`references`(composite 模式、rootDir `src`)。若 saaz 的有 `outDir: dist` 就照搬。

- [ ] **Step 3: 注册别名**

`tsconfig.base.json` 在 `"@dreamerbird/core"` 行(:19)之前插入(字母序 camera-studio < core):

```json
      "@dreamerbird/camera-studio": ["./packages/camera-studio/src/index.ts"],
      "@dreamerbird/camera-studio/*": ["./packages/camera-studio/src/*"],
```

- [ ] **Step 4: 冒烟测试(先写测试)**

`packages/camera-studio/src/index.ts`:
```ts
export const CAMERA_STUDIO_VERSION = '0.1.0'
```

`packages/camera-studio/src/smoke.test.ts`:
```ts
import {CAMERA_STUDIO_VERSION} from './index'

test('包骨架可导入', () => {
  expect(CAMERA_STUDIO_VERSION).toBe('0.1.0')
})
```

- [ ] **Step 5: 验证**

Run(一律从仓库根): `npx jest packages/camera-studio`
Expected: PASS 1 个测试。再跑 `npx tsc -p packages/camera-studio/tsconfig.json --noEmit`,Expected: 无输出。

- [ ] **Step 6: Commit**

```bash
git add packages/camera-studio tsconfig.base.json
git commit -m "$(cat <<'EOF'
feat(camera-studio): 新建 @dreamerbird/camera-studio 包骨架

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: camera 整目录 git mv 迁入

**Files:**
- Move: `packages/playground/src/shared/camera/*`(除 `index.html`、`index.tsx`)→ `packages/camera-studio/src/`
- Move: `packages/playground/scripts/pose-pipeline` → `packages/camera-studio/scripts/pose-pipeline`
- Modify: `packages/playground/src/shared/camera/index.tsx`(改 import 来源)
- Modify: `packages/camera-studio/src/index.ts`
- Modify: `packages/playground/package.json`(加依赖)

**Interfaces:**
- Consumes: T1 的别名。
- Produces: 包根导出 `App`(T9 才改名 CameraScene);词条副作用经包根 `import './i18n'` 传递。

**关键事实**(已核实,不要再全文翻):
- vite 页面入口 glob = `packages/playground/src/shared/*/index.html`,所以 `index.html` 必须留在原地,URL 不变。
- `index.tsx` 里 `import './i18n'` 必须最先求值(App 依赖链里 ShotCamera 模块加载期就翻译)。搬到包根后由包 index.ts 的第一行承担。
- jest 通配 `packages/*/src/**` 自动覆盖新位置。

- [ ] **Step 1: git mv 代码与脚本**

```bash
mkdir -p packages/camera-studio/scripts
cd packages/playground/src/shared/camera
for f in *; do
  case "$f" in index.html|index.tsx) ;; *) git mv "$f" ../../../../camera-studio/src/ ;; esac
done
cd /Users/huhui/Projects/theatre
git mv packages/playground/scripts/pose-pipeline packages/camera-studio/scripts/pose-pipeline
```

- [ ] **Step 2: 包根导出 + playground 壳改 import**

`packages/camera-studio/src/index.ts`:
```ts
// 词条注册必须最先执行:模块按 import 顺序求值,App 依赖链里有模块
// 加载期就 translate 的调用(ShotCamera 属性标签)
import './i18n'
export {default as App} from './App'
```

`packages/playground/src/shared/camera/index.tsx` 全文改为(过渡期:theatre.init 仍在壳里,T8 收进 bootstrap、T10 再瘦到 40 行):
```tsx
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
```

`packages/playground/package.json` dependencies 加 `"@dreamerbird/camera-studio"`(版本写法照抄同文件里 `@dreamerbird/studio` 的),然后 `yarn install` 让 workspace 软链生效。

- [ ] **Step 3: 修搬迁后的相对路径**

```bash
grep -rn "__dirname" packages/camera-studio/src packages/camera-studio/scripts
grep -rn "scripts/pose-pipeline" packages/playground/package.json docs/ 2>/dev/null
```

逐个修:`src/**` 里的 `__dirname` 上跳层数比原来少 2(旧 `src/shared/camera/assetLibrary` → 新 `src/assetLibrary`);package.json scripts / 文档里的 `scripts/pose-pipeline` 改指 `packages/camera-studio/scripts/pose-pipeline`。已知至少 `src/assetLibrary/seedPosesQbx.test.ts` 的 pkgRoot 要改。

- [ ] **Step 4: 验证**

Run: `npx jest packages/camera-studio packages/playground`
Expected: 全绿(搬迁不改变行为;若 seedPosesQbx.test.ts 红,就是 Step 3 的 pkgRoot 没修对)。
再跑 `npx tsc -p packages/playground/tsconfig.json --noEmit && npx tsc -p packages/camera-studio/tsconfig.json --noEmit`,均无输出。
再跑 `npx eslint packages/camera-studio/src packages/playground/src/shared/camera`,无错误。

- [ ] **Step 5: 刷新 graft 图谱 + Commit**

```bash
graft build
git add -A
git commit -m "$(cat <<'EOF'
refactor(camera-studio): camera 场景整目录迁入 packages/camera-studio(git mv 保历史)

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 统一数据源接口 + IndexedDBBackend 命名空间化

**Files:**
- Create: `packages/camera-studio/src/assetLibrary/source.ts`
- Test: `packages/camera-studio/src/assetLibrary/source.test.ts`
- Modify: `packages/camera-studio/src/assetLibrary/indexedDBBackend.ts`
- Modify: `packages/camera-studio/src/assetLibrary/types.ts`(:现 `LibraryBackend` 改为 type alias)

**Interfaces:**
- Consumes: 现有 `LibraryEntry`/`EntryKind`/`RigAlias`(types.ts)、`IndexedDBBackend`。
- Produces(T4/T5/T6/T8 都依赖,签名逐字固定):
  - `class LibraryError extends Error { readonly code: LibraryErrorCode }`,`LibraryErrorCode = 'auth' | 'quota' | 'network' | 'conflict' | 'not-found' | 'unknown'`
  - `interface LibrarySource` / `interface WritableLibrarySource`(spec §5 逐字)
  - `isWritableSource(s: LibrarySource): s is WritableLibrarySource`
  - `new IndexedDBBackend(opts?: {dbName?: string})`,缺省 `'toybox-asset-library'` 一字不变;实例加 `readonly id = 'idb'`、`readonly capabilities = {writable: true}`。

- [ ] **Step 1: 写失败测试**

`source.test.ts`:
```ts
import {LibraryError, isWritableSource} from './source'
import type {LibrarySource, WritableLibrarySource} from './source'

test('LibraryError 携带 code 与 cause', () => {
  const cause = new Error('boom')
  const err = new LibraryError('quota', '配额已满', cause)
  expect(err.code).toBe('quota')
  expect(err.cause).toBe(cause)
  expect(err instanceof Error).toBe(true)
})

test('isWritableSource:有 putEntry 才判定可写', () => {
  const ro: LibrarySource = {
    id: 'ro',
    listEntries: async () => [],
    getEntry: async () => undefined,
    getBlobUrl: async () => '',
  }
  const rw: WritableLibrarySource = {
    ...ro,
    id: 'rw',
    putEntry: async () => {},
    deleteEntry: async () => {},
    putBlob: async () => 'x',
    deleteBlob: async () => {},
    getRigAliases: async () => [],
    putRigAlias: async () => {},
  }
  expect(isWritableSource(ro)).toBe(false)
  expect(isWritableSource(rw)).toBe(true)
})
```

`indexedDBBackend.test.ts` 追加(文件已有 fake-indexeddb 搭建,照抄其头部):
```ts
test('命名空间:不同 dbName 数据隔离;缺省库名一字不变', async () => {
  const openSpy = jest.spyOn(indexedDB, 'open')
  const a = new IndexedDBBackend() // 缺省
  const b = new IndexedDBBackend({dbName: 'toybox-asset-library-teamA'})
  await a.putEntry({id: 'e1', kind: 'pose', name: 'p', rig: 'r', bones: {}} as any)
  expect(await b.getEntry('e1')).toBeUndefined()
  expect(openSpy).toHaveBeenCalledWith('toybox-asset-library', expect.anything())
  expect(openSpy).toHaveBeenCalledWith('toybox-asset-library-teamA', expect.anything())
  openSpy.mockRestore()
})
```

Run: `npx jest packages/camera-studio/src/assetLibrary/source.test.ts`
Expected: FAIL(`./source` 不存在)。

- [ ] **Step 2: 实现 source.ts(接口逐字照 spec §5)**

```ts
/**
 * 统一数据源(2026-10-10 spec §5):模型/姿势/动画数据完全由应用提供的
 * 存储承担;模块附带的基础资产也走同一接口——一个接口、三种实现
 * (内置目录 / 宿主生产存储 / 本地 IndexedDB 演示),零特判。
 */
import type {EntryKind, LibraryEntry, RigAlias} from './types'

export type LibraryErrorCode =
  | 'auth'
  | 'quota'
  | 'network'
  | 'conflict'
  | 'not-found'
  | 'unknown'

export class LibraryError extends Error {
  constructor(
    readonly code: LibraryErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'LibraryError'
  }
}

/** 统一数据源(读) */
export interface LibrarySource {
  readonly id: string
  listEntries(kind?: EntryKind): Promise<LibraryEntry[]>
  getEntry(id: string): Promise<LibraryEntry | undefined>
  /** 每个源自己解析自己的 blob:静态源→CDN 地址,HTTP 源→预签名,IDB→blob: */
  getBlobUrl(blobId: string): Promise<string>
  capabilities?: {
    writable?: boolean
    permanentUrls?: boolean // URL 长效才允许跨挂载缓存
    maxUploadBytes?: number // 导入前先校验先提示
  }
  /** 远端变更推送(可选,v1 不强制) */
  subscribe?(fn: () => void): () => void
}

/** 可写源 = 用户库(宿主生产存储 / 内置 IDB) */
export interface WritableLibrarySource extends LibrarySource {
  putEntry(entry: LibraryEntry): Promise<void>
  deleteEntry(id: string): Promise<void>
  putBlob(
    data: Blob,
    opts?: {onProgress?: (ratio: number) => void; signal?: AbortSignal},
  ): Promise<string>
  deleteBlob(blobId: string): Promise<void>
  getRigAliases(): Promise<RigAlias[]>
  putRigAlias(alias: RigAlias): Promise<void>
  /** 孤儿清扫用;HTTP 源不实现则跳过清扫 */
  listBlobIds?(): Promise<string[]>
}

export function isWritableSource(s: LibrarySource): s is WritableLibrarySource {
  return typeof (s as WritableLibrarySource).putEntry === 'function'
}
```

- [ ] **Step 3: IndexedDBBackend 改造**

`indexedDBBackend.ts`:
- `openDB()` 从模块级函数改实例方法 `private openDB()`,用 `this.dbName`;构造函数 `constructor(opts: {dbName?: string} = {}) { this.dbName = opts.dbName ?? 'toybox-asset-library' }`(缺省值一字不变,硬约束)。
- 类声明加 `implements WritableLibrarySource`;加 `readonly id = 'idb'`、`readonly capabilities = {writable: true} as const`。
- `putBlob(data, opts?)`:签名加 opts,IDB 本地写没有进度概念,写完调 `opts?.onProgress?.(1)`;`signal` 忽略(注释注明)。

`types.ts`:`LibraryBackend` 接口删除,改:
```ts
import type {WritableLibrarySource} from './source'
/** @deprecated 统一数据源后的兼容别名,新代码用 WritableLibrarySource */
export type LibraryBackend = WritableLibrarySource
```

- [ ] **Step 4: 验证**

Run: `npx jest packages/camera-studio/src/assetLibrary`
Expected: 全绿(含既有 indexedDBBackend/library 用例——构造参数有缺省值,旧调用 `new IndexedDBBackend()` 不破)。
`npx tsc -p packages/camera-studio/tsconfig.json --noEmit` 无输出。

- [ ] **Step 5: Commit**

```bash
git add packages/camera-studio/src/assetLibrary
git commit -m "$(cat <<'EOF'
feat(camera-studio): 统一数据源接口 LibrarySource/WritableLibrarySource + IndexedDB 实现命名空间化

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 契约测试套件(宿主实现自检)

**Files:**
- Create: `packages/camera-studio/src/assetLibrary/contractTests.ts`
- Test: `packages/camera-studio/src/assetLibrary/contract.indexeddb.test.ts`
- Modify: `packages/camera-studio/package.json`(exports 加 `./contract-tests`)
- Modify: `tsconfig.base.json`(加一行显式 paths,让 monorepo 内 import 路径与发布形态一致)

**Interfaces:**
- Consumes: T3 的 `WritableLibrarySource`。
- Produces: `runLibrarySourceContractTests(makeSource)`;宿主用法 `import {runLibrarySourceContractTests} from '@dreamerbird/camera-studio/contract-tests'`。

- [ ] **Step 1: 写套件本体**

`contractTests.ts`(jest 专用,所以从独立子路径导出,主入口不带 jest 类型):
```ts
/**
 * 宿主存储实现的契约测试套件。宿主在自己仓库里:
 *   import {runLibrarySourceContractTests} from '@dreamerbird/camera-studio/contract-tests'
 *   runLibrarySourceContractTests(async () => ({source: new MyHttpSource(...)}))
 * 每个用例拿全新空实例;套件对内置 IDB 实现自身也跑(contract.indexeddb.test.ts)。
 */
import type {WritableLibrarySource} from './source'

export function runLibrarySourceContractTests(
  makeSource: () => Promise<{
    source: WritableLibrarySource
    cleanup?: () => Promise<void>
  }>,
): void {
  describe('LibrarySource 契约', () => {
    let ctx: {source: WritableLibrarySource; cleanup?: () => Promise<void>}
    beforeEach(async () => {
      ctx = await makeSource()
    })
    afterEach(async () => {
      await ctx.cleanup?.()
    })

    test('条目 round-trip:put → get/list → delete', async () => {
      const entry = {
        id: 'c1',
        kind: 'pose',
        name: '契约姿势',
        rig: 'r',
        bones: {},
      } as any
      await ctx.source.putEntry(entry)
      expect(await ctx.source.getEntry('c1')).toMatchObject({id: 'c1'})
      expect(await ctx.source.listEntries('pose')).toHaveLength(1)
      expect(await ctx.source.listEntries('model')).toHaveLength(0)
      await ctx.source.deleteEntry('c1')
      expect(await ctx.source.getEntry('c1')).toBeUndefined()
    })

    test('getEntry(不存在)→ undefined,不抛', async () => {
      await expect(ctx.source.getEntry('nope')).resolves.toBeUndefined()
    })

    test('同 id 重复 put = upsert 覆盖', async () => {
      const e = {id: 'c2', kind: 'pose', name: 'v1', rig: 'r', bones: {}} as any
      await ctx.source.putEntry(e)
      await ctx.source.putEntry({...e, name: 'v2'})
      expect((await ctx.source.getEntry('c2'))?.name).toBe('v2')
      expect(await ctx.source.listEntries()).toHaveLength(1)
    })

    test('blob round-trip + 内容寻址:同内容两次同 id', async () => {
      const data = new Blob(['hello'], {type: 'text/plain'})
      const id1 = await ctx.source.putBlob(data)
      const id2 = await ctx.source.putBlob(new Blob(['hello']))
      expect(id1).toBe(id2)
      const url = await ctx.source.getBlobUrl(id1)
      expect(typeof url).toBe('string')
      expect(url.length).toBeGreaterThan(0)
      await ctx.source.deleteBlob(id1)
    })

    test('骨架别名 round-trip', async () => {
      await ctx.source.putRigAlias({rig: 'rig-x', name: '别名 X'} as any)
      const aliases = await ctx.source.getRigAliases()
      expect(aliases.some((a) => a.rig === 'rig-x' && a.name === '别名 X')).toBe(
        true,
      )
    })
  })
}
```

- [ ] **Step 2: 对内置 IDB 实现跑套件**

`contract.indexeddb.test.ts`(fake-indexeddb 搭建照抄 indexedDBBackend.test.ts 头部):
```ts
import {runLibrarySourceContractTests} from './contractTests'
import {IndexedDBBackend} from './indexedDBBackend'

runLibrarySourceContractTests(async () => ({
  source: new IndexedDBBackend({dbName: `contract-${Math.random()}`}),
}))
```

Run: `npx jest packages/camera-studio/src/assetLibrary/contract.indexeddb.test.ts`
Expected: PASS 5 个用例。红哪条修哪条(内容寻址若现有实现是随机 id 则把 putBlob 改回 hash 寻址——hash.ts 的 FNV-1a 已有,确认 putBlob 走的是它)。

- [ ] **Step 3: 子路径导出**

`tsconfig.base.json` 在 T1 那两行后面加:
```json
      "@dreamerbird/camera-studio/contract-tests": ["./packages/camera-studio/src/assetLibrary/contractTests.ts"],
```
`package.json` exports 加:
```json
    "./contract-tests": {"types": "./dist/assetLibrary/contractTests.d.ts", "default": "./dist/assetLibrary/contractTests.js"}
```

- [ ] **Step 4: 验证 + Commit**

Run: `npx jest packages/camera-studio && npx tsc -p packages/camera-studio/tsconfig.json --noEmit`
Expected: 全绿、无输出。

```bash
git add packages/camera-studio tsconfig.base.json
git commit -m "$(cat <<'EOF'
feat(camera-studio): 数据源契约测试套件(宿主实现自检)

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Library 门面改聚合器

**Files:**
- Modify: `packages/camera-studio/src/assetLibrary/library.ts`(构造改 sources;`backend` 字段删)
- Test: `packages/camera-studio/src/assetLibrary/library.test.ts`(追加聚合用例)
- Modify(`.backend.` 调用点,先跑 `graft grep ".backend."` 拿实时清单核对,以下为 recon 时点数):`PlacementManager.tsx` 5 处、`seedBuiltinPoses.ts` 4、`poseThumbnail.ts` 4、`useModelThumbUrl.ts` 3、`App.tsx` 3、`importModelFile.ts` 2、`AssetLibraryPanel.tsx` 2、`PosePropEditor.tsx` 1、`poseLibResolve.ts` 1、`gesturePropsEditor.tsx` 1、`types.ts` 1、`thumbnail.ts` 1、`seedModels.ts` 1、`indexedDBBackend.ts` 1

**Interfaces:**
- Consumes: T3 全部接口。
- Produces(T6/T8 依赖):
  - `new Library({sources: LibrarySource[]; writable?: WritableLibrarySource; onError?: (e: LibraryError) => void})`(writable 缺省 = sources 里第一个 isWritableSource)
  - `library.canWrite: boolean`、`library.getEntrySource(id): LibrarySource | undefined`
  - `library.listEntries/getEntry/getBlobUrl` 升为聚合方法
  - `configureLibrary(opts): Library`(重置单例,bootstrap 用);`getLibrary()` 保持签名,缺省 = 现状(单 IDB 源)
  - blobId 路由规则:**含 `:` → 前缀即源 id;裸 hash → 可写源**(写进代码注释)

- [ ] **Step 1: 写失败测试(library.test.ts 追加)**

```ts
const fakeSource = (
  id: string,
  entries: LibraryEntry[],
  writable = false,
): LibrarySource => ({
  id,
  capabilities: {writable},
  listEntries: async () => entries,
  getEntry: async (eid) => entries.find((e) => e.id === eid),
  getBlobUrl: async (b) => `${id}://${b}`,
})

test('聚合读:多源合并,id 冲突先注册者胜并告警', async () => {
  const errors: LibraryError[] = []
  const lib = new Library({
    sources: [
      fakeSource('a', [{id: 'x', name: 'A 的 x'} as any]),
      fakeSource('b', [{id: 'x', name: 'B 的 x'} as any, {id: 'y'} as any]),
    ],
    onError: (e) => errors.push(e),
  })
  const entries = await lib.listEntries()
  expect(entries.map((e) => e.id).sort()).toEqual(['x', 'y'])
  expect((await lib.getEntry('x'))?.name).toBe('A 的 x')
  expect(errors.some((e) => e.code === 'conflict')).toBe(true)
})

test('seed-* 前缀拒绝:可写源返回内置前缀条目被剔除并告警', async () => {
  const errors: LibraryError[] = []
  const writable: WritableLibrarySource = {
    ...(fakeSource('idb', [{id: 'seed-pose-fake'} as any], true) as any),
    putEntry: async () => {},
    deleteEntry: async () => {},
    putBlob: async () => 'h',
    deleteBlob: async () => {},
    getRigAliases: async () => [],
    putRigAlias: async () => {},
  }
  const lib = new Library({sources: [writable], onError: (e) => errors.push(e)})
  expect(await lib.listEntries()).toEqual([])
  expect(errors.some((e) => e.code === 'conflict')).toBe(true)
})

test('纯查看器模式:无可写源,写操作抛 auth;面板照常可读', async () => {
  const lib = new Library({
    sources: [fakeSource('catalog', [{id: 'seed-pose-a'} as any])],
  })
  expect(lib.canWrite).toBe(false)
  expect(await lib.listEntries()).toHaveLength(1)
  await expect(lib.putEntry({id: 'u1'} as any)).rejects.toMatchObject({
    code: 'auth',
  })
})

test('blobId 路由:带源前缀走该源,裸 hash 走可写源', async () => {
  const writable = {
    ...(fakeSource('idb', [], true) as any),
    putEntry: async () => {},
    deleteEntry: async () => {},
    putBlob: async () => 'h',
    deleteBlob: async () => {},
    getRigAliases: async () => [],
    putRigAlias: async () => {},
  } as WritableLibrarySource
  const lib = new Library({
    sources: [fakeSource('catalog', []), writable],
  })
  expect(await lib.getBlobUrl('catalog:models/a.glb')).toBe(
    'catalog://catalog:models/a.glb',
  )
  expect(await lib.getBlobUrl('abc123')).toBe('idb://abc123')
})
```

**Review Focus #1 钉住**(无 IndexedDB 环境):
```ts
test('无 IndexedDB + 只给静态目录:降级只读可用,不白屏', async () => {
  const lib = new Library({sources: [fakeSource('catalog', [{id: 'p1'} as any])]})
  expect(lib.canWrite).toBe(false)
  expect(await lib.listEntries()).toHaveLength(1) // 目录照常
})
```
(「无 IndexedDB」由「根本不给 IDB 源」表达;IndexedDBBackend 自身在无 indexedDB 全局时构造即抛是既有行为,T8 bootstrap 的 try/catch 兜它。)

Run: `npx jest packages/camera-studio/src/assetLibrary/library.test.ts`
Expected: FAIL(新构造签名不存在)。

- [ ] **Step 2: 改 library.ts**

要点(保留既有写队列 enqueue / deleteEntryDeep / sweepOrphanBlobs / subscribe-emit 机制,只换底层来源):
```ts
type LibraryOpts = {
  sources: LibrarySource[]
  writable?: WritableLibrarySource
  onError?: (err: LibraryError) => void
}

class Library {
  readonly sources: LibrarySource[]
  readonly writable?: WritableLibrarySource
  private onError?: (err: LibraryError) => void

  constructor(opts: LibraryOpts) {
    this.sources = opts.sources
    this.writable = opts.writable ?? opts.sources.find(isWritableSource)
    this.onError = opts.onError
  }

  get canWrite(): boolean {
    return this.writable !== undefined
  }

  /** 读路由:先可写库(用户条目优先),再按注册顺序探只读源 */
  getEntrySource(id: string): LibrarySource | undefined {
    // 同步快照里没有来源信息,按 listEntries 聚合时的顺序推断:
    // 实现上 listEntries 时记录 id→source 映射(refreshSnapshot 里建)
    return this.entrySourceMap.get(id)
  }

  async listEntries(kind?: EntryKind): Promise<LibraryEntry[]> {
    // 合并各源;同 id 先注册者胜 + onError(conflict);
    // 可写源里 seed-pose-*/seed-model-* 前缀条目剔除 + onError(conflict)
    // …(refreshSnapshot 改用本方法)
  }

  async getBlobUrl(blobId: string): Promise<string> {
    // blobId 路由规则:含 ':' → 前缀即源 id;裸 hash → 可写源
    const colon = blobId.indexOf(':')
    if (colon > 0) {
      const src = this.sources.find((s) => s.id === blobId.slice(0, colon))
      if (src) return src.getBlobUrl(blobId)
    }
    if (this.writable) return this.writable.getBlobUrl(blobId)
    throw new LibraryError('not-found', `无法解析 blob:${blobId}`)
  }

  private requireWritable(): WritableLibrarySource {
    if (!this.writable) {
      throw new LibraryError('auth', '纯查看器模式:未配置可写存储')
    }
    return this.writable
  }
  // putEntry/deleteEntry/putBlobWithEntry/renameEntry/setRigAlias 内部
  // 统一改走 requireWritable();sweepOrphanBlobs 只在 writable.listBlobIds
  // 存在时执行,否则返回 0。
}
```
`getLibrary()` 保持:
```ts
let singleton: Library | undefined
export function getLibrary(): Library {
  if (!singleton) {
    const idb = new IndexedDBBackend()
    singleton = new Library({sources: [idb]})
  }
  return singleton
}
/** bootstrap 用:按宿主配置重建单例(T8 接线) */
export function configureLibrary(opts: LibraryOpts): Library {
  singleton = new Library(opts)
  return singleton
}
```
类型修正:`useLibraryEntries`/`useRigAliases` 改走 `lib.listEntries` 聚合(原来 `lib.backend.listEntries`)。

- [ ] **Step 3: 改 13 个调用点**

机械规则,逐文件执行:
- 读(`backend.getEntry/getBlobUrl/listEntries/getRigAliases`)→ `lib.getEntry/lib.getBlobUrl/lib.listEntries/lib.getRigAliases`(Library 上补对应聚合方法,getRigAliases 读 = 可写源 ∪ 内置默认别名,可写源优先)。
- 写(`backend.putEntry/deleteEntry/putBlob/putRigAlias`)→ 走 Library 既有写方法(内部已路由 requireWritable)。
- `graft grep ".backend."` 复核到 0( library.test.ts 里的假源不算)。

- [ ] **Step 4: 纯查看器模式 UI 隐藏**

`AssetLibraryPanel.tsx`:导入按钮、条目删除按钮外包 `library.canWrite &&`。
`PosePropEditor.tsx`:保存姿势按钮同理。
(隐藏不是置灰——spec §5「导入/保存姿势/删除入口整体隐藏」。)

- [ ] **Step 5: 验证 + Commit**

Run: `npx jest packages/camera-studio && npx jest packages/playground`
Expected: 全绿。
`npx tsc -p packages/camera-studio/tsconfig.json --noEmit && npx eslint packages/camera-studio/src` 干净。

```bash
git add packages/camera-studio
git commit -m "$(cat <<'EOF'
feat(camera-studio): Library 门面改聚合器——多读合流/写路由/纯查看器模式

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 内置资产目录化(清单 + StaticCatalogSource,去播种)

**Files:**
- Create: `packages/camera-studio/scripts/pose-pipeline/build_seed_assets_manifest.ts`
- Create: `packages/camera-studio/src/assetLibrary/seedAssetsManifest.ts`(脚本生成,入库)
- Create: `packages/camera-studio/src/assetLibrary/staticCatalogSource.ts`
- Test: `packages/camera-studio/src/assetLibrary/staticCatalogSource.test.ts`
- Modify: `seedBuiltinPoses.ts`(删 `seedBuiltinPoses()`;抽出 `buildBuiltinPoseEntries()`;`seedBuiltinPosesInto` 保留给测试)
- Delete: `packages/camera-studio/src/assetLibrary/seedBuiltinModels.ts`、`poseThumbsQbxUrls.ts`、`seedModels.ts`(函数被清单取代;`seedModels/` GLB 目录与 `poseThumbsQbx/` PNG 目录 git mv 到 `packages/camera-studio/assets/`)
- Modify: 调用播种的编辑器/面板(`ModelPickerSlot.tsx`、`AssetLibraryPanel.tsx`、两个姿势编辑器——grep `seedBuiltin` 拿清单)
- Modify: `poseThumbnail.ts`(回填只对可写源条目生效)、`PlacementManager.tsx`(GLB 加载失败包 LibraryError('network') 经 onError 发出)
- Modify: `packages/camera-studio/package.json`(files 已含 assets;补 copy 脚本)

**Interfaces:**
- Consumes: T3 接口、T5 聚合器与 blobId 前缀路由。
- Produces:
  - `seedAssetsManifest`(类型 `SeedAssetsManifest`)= `{models: [{key, file, contentHash, name, rig}], poseThumbs: [{key, file}]}`
  - `class StaticCatalogSource implements LibrarySource`,`readonly id = 'catalog'`,构造 `{baseUrl?, manifest?, fetcher?, renderPoseThumb?, renderModelThumb?}`
  - 内置模型条目 id = `seed-model-<contentHash>`(清单稳定 → id 稳定);内置姿势条目 id 保持 `seed-pose-*` 不变(硬约束)
  - `buildBuiltinPoseEntries(): PoseEntry[]`(seedBuiltinPosesInto 与 StaticCatalogSource 共用)

- [ ] **Step 1: 资产目录搬家**

```bash
mkdir -p packages/camera-studio/assets
git mv packages/camera-studio/src/assetLibrary/seedModels packages/camera-studio/assets/models
git mv packages/camera-studio/src/assetLibrary/poseThumbsQbx packages/camera-studio/assets/poseThumbs
```
(import.meta.glob 引用这些目录的文件下一步就删,中间态 jest 会红,按顺序做完再跑。)

- [ ] **Step 2: 清单生成脚本 + 生成**

`build_seed_assets_manifest.ts` 要点:
- 扫 `assets/models/*.glb`、`assets/poseThumbs/*.png`;
- contentHash 用 `src/assetLibrary/hash.ts` 的 FNV-1a 同款算法(Node 里算,须与浏览器逐字节一致——已有测试钉算法);
- 每个模型的 `rig`:用 `@gltf-transform/core`(已是 devDep)读 skins joints 名列表,喂给 `rig.ts` 的骨架判定函数(importPipeline 判定骨架族用的那个,导出名 executor 从 rig.ts 核实)——**禁止另写一套骨架判定**;
- 输出 TS 文件头加 `// 本文件由 build_seed_assets_manifest.ts 生成,勿手改`。

Run: `npx tsx packages/camera-studio/scripts/pose-pipeline/build_seed_assets_manifest.ts`
Expected: 写出 `src/assetLibrary/seedAssetsManifest.ts`,含 6 个模型 + 110 张姿势预览图;`git diff` 可审。

校验 parity 的测试(staticCatalogSource.test.ts 里):
```ts
test('清单 rig 与运行时解析一致', async () => {
  // 抽 1 个模型:GLTFLoader 解析 GLB 取骨名 → rig 判定,与清单值相等
  // (importPipeline.test.ts 已证明 jest 环境能解析 GLB)
})
```

- [ ] **Step 3: StaticCatalogSource + 失败测试**

```ts
test('目录源:条目齐全,id 前缀与 blobId 路由正确', async () => {
  const src = new StaticCatalogSource({baseUrl: 'https://cdn.example.com/a/'})
  const models = await src.listEntries('model')
  const poses = await src.listEntries('pose')
  expect(models).toHaveLength(6)
  expect(poses.length).toBe(58 + 110) // DPL 58 + QBX 110
  expect(models.every((m) => m.id.startsWith('seed-model-'))).toBe(true)
  expect(poses.every((p) => p.id.startsWith('seed-pose-'))).toBe(true)
  const url = await src.getBlobUrl((models[0] as ModelEntry).blobId)
  expect(url.startsWith('https://cdn.example.com/a/models/')).toBe(true)
})

test('QBX 预览图走静态文件;身体姿势缩略图走注入渲染器(内存缓存,不落地)', async () => {
  const renderPoseThumb = jest.fn(async () => 'data:image/png;base64,x')
  const src = new StaticCatalogSource({
    baseUrl: 'https://cdn.example.com/a/',
    renderPoseThumb,
  })
  const poses = (await src.listEntries('pose')) as PoseEntry[]
  const qbx = poses.find((p) => p.id === 'seed-pose-qbx-hands-01-base-base-l')!
  expect(await src.getBlobUrl(qbx.thumbnailId!)).toContain('/poseThumbs/')
  const dpl = poses.find((p) => !p.id.startsWith('seed-pose-qbx'))!
  const t1 = await src.getBlobUrl(dpl.thumbnailId!)
  const t2 = await src.getBlobUrl(dpl.thumbnailId!)
  expect(t1).toBe('data:image/png;base64,x')
  expect(renderPoseThumb).toHaveBeenCalledTimes(1) // 内存缓存
  expect(t2).toBe(t1)
})
```

实现要点:
- `listEntries('model')` = manifest.models → `ModelEntry`(`blobId = 'catalog:models/<file>'` 即 `catalog:` + file;`thumbnailId = 'catalog:runtime/model/<key>'`)。
- `listEntries('pose')` = `buildBuiltinPoseEntries()`(从 seedPosesQbx/seedPosesDpl 数据模块构建,逻辑从 seedBuiltinPoses.ts 抽出);QBX 条目 `thumbnailId = 'catalog:poseThumbs/<file>'`(按 manifest.poseThumbs key 对上才有),其余 `thumbnailId = 'catalog:runtime/pose/<entryId>'`。
- `getBlobUrl`:`'catalog:models/…'`/`'catalog:poseThumbs/…'` → `baseUrl + 余下路径`;`'catalog:runtime/model/<key>'` → `renderModelThumb`(缺注入则抛 `LibraryError('not-found')`);`'catalog:runtime/pose/<id>'` → `renderPoseThumb`,结果 Map 内存缓存。
- baseUrl 缺省惰性:`new URL('../../assets/', import.meta.url)`(src/ 与 dist/ 同层深,两种形态都指到包根 `assets/`;jest 不碰,注释写明)。

- [ ] **Step 4: 去播种 + 回填收窄 + 错误包装**

- 删 `seedBuiltinModels.ts`、`seedModels.ts`、`poseThumbsQbxUrls.ts`;`seedBuiltinPoses.ts` 只留 `seedBuiltinPosesInto` + 新抽的 `buildBuiltinPoseEntries`。
- grep `seedBuiltinModels\|seedBuiltinPoses(` 删掉编辑器/面板里的调用(App.tsx、ModelPickerSlot.tsx、AssetLibraryPanel.tsx、PosePropEditor.tsx、gesturePropsEditor.tsx——以 grep 实际清单为准)。
- `poseThumbnail.ts` 回填:`getEntrySource(entry.id)` 不是可写源的条目跳过(内置条目改由 catalog 运行时渲染,不写任何存储)。
- `PlacementManager.tsx` GLB fetch/解析失败 → `onError(new LibraryError('network', …, cause))`(选择框照常打开,错误条提示)。

**Review Focus #3 钉住**:
```ts
test('baseUrl 配错:GLB 加载失败走 LibraryError(network),选择框数据照常', async () => {
  const src = new StaticCatalogSource({baseUrl: 'https://bad.example/'})
  // getBlobUrl 纯拼接不探测:
  expect(await src.getBlobUrl('catalog:models/x.glb')).toContain('bad.example')
  // PlacementManager 加载失败 → LibraryError network(用 fetcher stub reject 驱动)
})
```

- [ ] **Step 5: 验证 + Commit**

Run: `npx jest packages/camera-studio && npx jest packages/playground`
Expected: 全绿(凡 import 被删模块的测试一并改完,如 App.hostFlows.test.tsx、seedPosesQbx.test.ts 里对 poseThumbsQbxUrls 的引用改读 manifest)。
全仓确认零 glob:`grep -rn "import.meta.glob" packages/camera-studio/src` 无结果。
`npx tsc -p packages/camera-studio/tsconfig.json --noEmit && npx eslint packages/camera-studio/src` 干净。

```bash
git add packages/camera-studio
git commit -m "$(cat <<'EOF'
feat(camera-studio): 内置资产目录化——清单 + StaticCatalogSource,去播种与 import.meta.glob

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 旧播种条目启动清理(一次性迁移)

**Files:**
- Create: `packages/camera-studio/src/assetLibrary/legacySeedCleanup.ts`
- Test: `packages/camera-studio/src/assetLibrary/legacySeedCleanup.test.ts`

**Interfaces:**
- Consumes: T5 Library、T6 StaticCatalogSource。
- Produces: `cleanupLegacySeeds(lib: Library): Promise<{removed: number}>`(T8 bootstrap 在用内置 IDB 时调用)。

**语义**(与 spec §5/§8.6 对齐,注意边界):
- 删:可写源里 id 以 `seed-pose-` 开头的条目(目录取代,**同 id** → 场景里的姿势引用继续解析,零断裂)。
- 留:旧播种的模型条目(id 是当年导入管线随机串,不是 seed-* 前缀;场景放置引用它们,删了旧场景模型就断——留着,contentHash 去重保证不会越攒越多)。这个取舍写进文件头注释。
- 一次性:localStorage 键 `theatre.cameraStudio.legacySeedCleanup.v1` 标记;清理只在内置 IDB 场景发生(bootstrap 判定),宿主生产存储不跑。

- [ ] **Step 1: 写失败测试(fake-indexeddb)**

```ts
test('旧 seed-pose-* 条目静默删一次;用户条目与旧模型条目保留', async () => {
  const idb = new IndexedDBBackend({dbName: `legacy-${Math.random()}`})
  // 布置一份「旧时代」的库:播种姿势 + 用户姿势 + 旧播种模型(随机 id)
  await idb.putEntry({id: 'seed-pose-qbx-hands-01-base-base-l', kind: 'pose'} as any)
  await idb.putEntry({id: 'user-pose-1', kind: 'pose'} as any)
  await idb.putEntry({id: 'a1b2c3-model', kind: 'model'} as any)
  const catalog = new StaticCatalogSource({baseUrl: 'https://x/'})
  const lib = new Library({sources: [idb, catalog]})

  const r1 = await cleanupLegacySeeds(lib)
  expect(r1.removed).toBe(1)
  expect(await idb.getEntry('seed-pose-qbx-hands-01-base-base-l')).toBeUndefined()
  expect(await idb.getEntry('user-pose-1')).toBeDefined()
  expect(await idb.getEntry('a1b2c3-model')).toBeDefined()
  // 幂等:第二遍不再删
  expect((await cleanupLegacySeeds(lib)).removed).toBe(0)
  // 场景旧引用经聚合读存活(同 id 由目录取代):
  expect(
    await lib.getEntry('seed-pose-qbx-hands-01-base-base-l'),
  ).toBeDefined()
})
```

**Review Focus #2 钉住**(姿势引用存活已在上;模型缺失占位):
```ts
test('旧场景引用已不存在的模型条目:解析返回 undefined,不抛', async () => {
  const lib = new Library({sources: [new StaticCatalogSource({baseUrl: 'https://x/'})]})
  await expect(lib.getEntry('ghost-model-id')).resolves.toBeUndefined()
})
```
(PlacementManager 对 undefined 条目的占位渲染是既有行为,这里钉解析层不崩;若 PlacementManager 现有缺失路径没有占位 UI,在 PR 描述里记遗留项,不在本任务扩 scope。)

localStorage 标记在测试里用 jest 环境的 localStorage(jsdom 有);无 localStorage 环境 try/catch 跳过标记(每次都跑,删除本身幂等)。

- [ ] **Step 2: 实现**

```ts
/**
 * 旧播种条目清理(2026-10-10):内置资产改目录源后,旧用户浏览器里
 * 已播种的 seed-pose-* 条目静默删一次——目录沿用同 id,场景里的姿势
 * 引用经聚合读无缝续命。旧播种的模型条目保留:它们的 id 是当年导入
 * 管线随机串,场景放置直接引用,删了旧场景就断;目录模型按内容寻址
 * 去重,不会因此重复计数。
 */
export async function cleanupLegacySeeds(
  lib: Library,
): Promise<{removed: number}> {
  const FLAG = 'theatre.cameraStudio.legacySeedCleanup.v1'
  try {
    if (globalThis.localStorage?.getItem(FLAG)) return {removed: 0}
  } catch {
    /* 无 localStorage 环境照样跑,删除本身幂等 */
  }
  let removed = 0
  if (lib.canWrite) {
    for (const e of await lib.listEntries()) {
      if (
        lib.getEntrySource(e.id) === lib.writable &&
        e.id.startsWith('seed-pose-')
      ) {
        await lib.deleteEntry(e.id)
        removed++
      }
    }
  }
  try {
    globalThis.localStorage?.setItem(FLAG, '1')
  } catch {
    /* 同上 */
  }
  return {removed}
}
```

Run: `npx jest packages/camera-studio/src/assetLibrary/legacySeedCleanup.test.ts`
Expected: FAIL → 实现后 PASS。

- [ ] **Step 3: Commit**

```bash
git add packages/camera-studio/src/assetLibrary
git commit -m "$(cat <<'EOF'
feat(camera-studio): 旧播种条目启动清理(一次性迁移)

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: bootstrap + useCameraStudio hook

**Files:**
- Create: `packages/camera-studio/src/config.ts`
- Create: `packages/camera-studio/src/bootstrap.ts`
- Create: `packages/camera-studio/src/useCameraStudio.ts`
- Test: `packages/camera-studio/src/bootstrap.test.tsx`
- Modify: `packages/camera-studio/src/App.tsx`(编辑器注册 useEffect :1616 删,挪进 bootstrap)
- Modify: `packages/camera-studio/src/index.ts`(导出 hook/类型)

**Interfaces:**
- Consumes: T3-T7 全部;`registerCustomPropEditor`(`@dreamerbird/studio/propEditors/customPropEditors`);`theatre.init`/`InitOpts.usePersistentStorage`;`studio.ui.hide/restore`。
- Produces(spec §3 逐字为宿主所见形态):
  - `CameraStudioConfig`、`CameraStudioHandle = {ready: boolean; error: Error | undefined; sceneProps: CameraSceneProps}`
  - `useCameraStudio(config?: CameraStudioConfig): CameraStudioHandle`
  - `initCameraStudio(config): Promise<BootCtx>` / `disposeCameraStudio(ctx): Promise<void>`(测试与高级宿主可用)
  - config.storage 新增 `false` 语义 = 纯查看器(仅内置目录)——spec §5「宿主不给可写源即纯查看器模式」的显式开关,字段缺省 = 现状(内置 IDB 可写)

- [ ] **Step 1: config.ts(spec §3 逐字)**

```ts
import type {IProject} from '@dreamerbird/core'
import type {WritableLibrarySource} from './assetLibrary/source'
import type {CameraFlows} from './App'

export interface CameraStudioConfig {
  /** id 字符串(getProject)或 IProject 实例;缺省 'Space' */
  project?: string | IProject
  /** 场景状态宿主接管;传了即关 theatre 本地持久化 */
  state?: {
    initialState?: unknown
    onStateChange?: (content: unknown) => void
    /** onStateChange 节流,缺省 1000ms(尾部触发,卸载时 flush) */
    throttleMs?: number
  }
  /** 可写源实例 | {namespace} 内置 IDB 简写(库名 toybox-asset-library[-namespace],
      不带 namespace 与现状一字不差) | false 纯查看器(仅内置目录);缺省 = 现状 */
  storage?: WritableLibrarySource | {namespace?: string} | false
  /** 内置目录文件根;缺省包内 assets */
  assets?: {baseUrl?: string}
  /** 协作端点;缺省 false(关) */
  sync?: {serverUrl?: string} | false
  ui?: {
    portalContainer?: HTMLElement
    zIndexBase?: number
    locale?: string
  }
  flows?: {onFlows?: (flows: CameraFlows) => void}
}

export interface CameraStudioHandle {
  ready: boolean
  error: Error | undefined
  sceneProps: {project: IProject; onFlows?: (flows: CameraFlows) => void}
}
```

- [ ] **Step 2: 写失败测试(bootstrap.test.tsx)**

先确认 `@testing-library/react` 可用(playground 的 App.hostFlows.test.tsx 已在用 testing-library,照抄它的版本进 camera-studio 的 devDependencies;没有就先补再写)。

jest-esbuild 不提升 jest.mock——用 doMock 模式:
```tsx
import {renderHook, act} from '@testing-library/react'
import React, {StrictMode} from 'react'

const initSpy = jest.fn(async () => ({}))
const hideSpy = jest.fn()
const restoreSpy = jest.fn()
jest.doMock('@dreamerbird/core', () => ({
  __esModule: true,
  default: {init: initSpy, getProject: jest.fn(() => ({fake: true}))},
  getStudio: () => ({ui: {hide: hideSpy, restore: restoreSpy, isHidden: false}}),
}))

let useCameraStudio: typeof import('./useCameraStudio').useCameraStudio
let bootstrap: typeof import('./bootstrap')
beforeEach(async () => {
  jest.resetModules()
  initSpy.mockClear()
  useCameraStudio = (await import('./useCameraStudio')).useCameraStudio
  bootstrap = await import('./bootstrap')
})
```

用例(每个都是独立 test):
1. **幂等 + StrictMode**:`<StrictMode>` 里 renderHook → initSpy 只调 1 次(共享 promise)。
2. **卸载四项清理**:unmount → 编辑器注销函数被调、`studio.ui.hide` 被调、库订阅断开(spy)、ui.restore 在重挂时调。
3. **重挂幂等**:unmount 后再 renderHook → ready 恢复,initSpy 仍 1 次,restoreSpy 调用。
4. **第二实例报错**:两个 hook 同时挂载 → 第二个 error 含「单页只允许一个」。
5. **namespace**:`storage: {namespace: 'ns1'}` → `jest.spyOn(indexedDB, 'open')` 见到 `toybox-asset-library-ns1`;`storage: {}` → 见到 `toybox-asset-library` 一字不差。
6. **state 通道**:`state: {onStateChange}` → initSpy 收到的 opts 里 `usePersistentStorage: false`;触发场景变更(直接调 BootCtx 里暴露的测试钩子)后 fake timers 走 1s,onStateChange 恰好 1 次(节流)。
7. **sync 透传**:`sync: {serverUrl: 'wss://x'}` → initSpy opts.serverUrl 一致;`sync` 缺省 → 不传 serverUrl(协作关)。
8. **storage: false** → `getLibrary().canWrite === false`,且 init 不碰 indexedDB。
9. **冲突矩阵**:initSpy 已经被人调过(模拟宿主先 init)且配置不一致 → console.warn 告警 + 以先到为准(不再 init)。宿主未 init → 模块 init;一致 → 静默复用。

Run: `npx jest packages/camera-studio/src/bootstrap.test.tsx`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 bootstrap.ts**

```ts
/**
 * 装配入口(spec §4/§7):theatre.init 检测复用、词典显式注册、
 * 数据源聚合接线、编辑器注册、状态通道、sync 透传。
 * init 挂共享 promise——StrictMode 双跑/重复触发只复用,不重复执行。
 */
let initPromise: Promise<BootCtx> | undefined
let activeConsumers = 0

export interface BootCtx {
  config: CameraStudioConfig
  library: Library
  unregisterEditors: () => void
  flushState: () => void
  sceneProps: CameraStudioHandle['sceneProps']
}

export function initCameraStudio(config: CameraStudioConfig): Promise<BootCtx> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    // 1. 数据源:storage 三分支(实例 / {namespace} / false 或缺省)
    //    缺省与 {namespace} → IndexedDBBackend;实例 → 直接用;false → 不要可写源
    //    内置 IDB 分支顺带 cleanupLegacySeeds(lib)(T7)
    //    catalog = new StaticCatalogSource({baseUrl: config.assets?.baseUrl,
    //      renderPoseThumb/renderModelThumb: 接 poseThumbnail.ts 的现有渲染})
    //    configureLibrary({sources: [...]})
    // 2. 词典显式注册 registerCameraMessages()(i18n.ts 导出新函数;
    //    自调用副作用保留——ShotCamera 模块加载期就翻译)
    // 3. theatre.init 冲突矩阵:getStudio() 探活;
    //    宿主已 init → 配置一致静默复用 / 不一致 console.warn 以先到为准;
    //    未 init → theatre.init({studio: true,
    //      serverUrl: config.sync ? config.sync.serverUrl : undefined,
    //      usePersistentStorage: config.state ? false : 缺省})
    // 4. state 通道:initialState 透传;订阅 project.onChange →
    //    尾部节流(缺省 1000ms)调 onStateChange;flush 挂卸载
    // 5. 编辑器注册(从 App.tsx:1616 挪来):
    //    registerCustomPropEditor('gestureL', …) / ('gestureR', …),
    //    收好返回的注销函数
    // 6. project 解析:字符串 → getProject(name, state?),
    //    IProject 实例 → 直接用
    return ctx
  })()
  return initPromise
}

export async function disposeCameraStudio(ctx: BootCtx): Promise<void> {
  // 对称清理(逐项可测):注销 gestureL/gestureR → 清框体注册表 →
  // 清宿主句柄 → flushState → 断库订阅 + dispose → studio.ui.hide()
  // initPromise 保留(重挂幂等复用),activeConsumers 计数由 hook 管
}
```

`useCameraStudio.ts`:
```ts
export function useCameraStudio(
  config: CameraStudioConfig = {},
): CameraStudioHandle {
  // config 只在首帧取一次(变更不热更,宿主文档注明);用 useRef 锁存
  // useState<{phase, error}>;useEffect 里 initCameraStudio →
  // activeConsumers++ >1 → 第二实例 setState error('单页只允许一个
  // CameraScene 实例');cleanup: activeConsumers-- + disposeCameraStudio
  // StrictMode 下 effect 双跑:init 共享 promise 保证只 init 一次,
  // dispose 用「最后一个消费者退场才执行」计数守卫
}
```

`App.tsx` 删掉 :1616 的编辑器注册 useEffect(挪走了);`index.ts` 追加:
```ts
export {useCameraStudio} from './useCameraStudio'
export type {CameraStudioConfig, CameraStudioHandle} from './config'
export {CameraScene} from './CameraScene' // T9 落地,先占位注释
```
(T9 之前 index.ts 暂不导出 CameraScene,保持 App 导出;T9 切换。)

- [ ] **Step 4: 验证 + Commit**

Run: `npx jest packages/camera-studio && npx jest packages/playground`
Expected: 全绿(Review Focus #4 由用例 1/2/3 钉住)。
`npx tsc -p packages/camera-studio/tsconfig.json --noEmit && npx eslint packages/camera-studio/src` 干净。

```bash
git add packages/camera-studio
git commit -m "$(cat <<'EOF'
feat(camera-studio): useCameraStudio 初始化 hook + bootstrap 生命周期

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: CameraScene 组件化 + UI 装配可配

**Files:**
- Modify: `packages/camera-studio/src/App.tsx` → 改名 `CameraScene.tsx`(git mv),导出 `CameraScene`,props `{project: IProject; onFlows?}`;删 `getProject('Space')`(:729)
- Create: `packages/camera-studio/src/uiConfig.ts`
- Test: `packages/camera-studio/src/uiConfig.test.tsx`、`CameraScene.test.tsx`
- Modify: `gesturePropsEditor.tsx`、`poseMode/PosePropEditor.tsx`、`poseMode/PosePickerFrame.tsx`(3 处 createPortal + z-index 1000 硬编码)
- Modify: `packages/camera-studio/src/bootstrap.ts`(把 config.ui 写进 uiConfig)、`index.ts`(CameraScene 替换 App 导出)

**Interfaces:**
- Consumes: T8 config.ui。
- Produces: `CameraScene`(spec §3 宿主唯一渲染面);`setUiConfig(cfg)/getUiConfig()`(模块级,缺省 = 现状:portal → document.body、zIndexBase 1000)。

- [ ] **Step 1: uiConfig + 失败测试**

```ts
/** UI 装配(spec §3 ui 字段):停靠框 portal 容器 / z-index 基准 / 语言 */
type UiConfig = {
  portalContainer?: HTMLElement
  zIndexBase?: number
  locale?: string
}
let current: UiConfig = {}
export function setUiConfig(cfg: UiConfig): void {
  current = cfg
}
export function getUiConfig(): Required<Pick<UiConfig, 'zIndexBase'>> & UiConfig {
  return {zIndexBase: 1000, ...current}
}
```

```tsx
test('portalContainer 可配:选择框渲染进宿主给的容器', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  setUiConfig({portalContainer: host, zIndexBase: 5000})
  // 渲染一个走 createPortal 的停靠框(PosePickerFrame),断言:
  expect(host.querySelector('[data-...]')).not.toBeNull()
  // 且 z-index 以 5000 为基准
  setUiConfig({}) // 复位
})
```

- [ ] **Step 2: 三处 portal 接入**

grep `createPortal` 与 `1000`(z-index)定位三处;`createPortal(x, document.body)` → `createPortal(x, getUiConfig().portalContainer ?? document.body)`;z-index `1000` → `getUiConfig().zIndexBase`(若是 1000+n 的偏移写法,改 `getUiConfig().zIndexBase + n`)。

- [ ] **Step 3: CameraScene 抽取**

```bash
git mv packages/camera-studio/src/App.tsx packages/camera-studio/src/CameraScene.tsx
```
- `function App({onFlows}: …)` → `export function CameraScene({project, onFlows}: {project: IProject; onFlows?: (flows: CameraFlows) => void})`
- 删 `getProject('Space')`,全部改用 `project` prop;`registerEditorOnly`(:633)保留(按画布注册,非全局)。
- I18nProvider 嵌套(spec §7):从 `@dreamerbird/studio/i18n` 拿 context(executor 核实其导出的 context/hook 名),`const hostI18n = useContext(I18nContext)`,有 → 直接渲染(语言以宿主为准),无 → 自包 `<I18nProvider locale={getUiConfig().locale}>`,ui.locale 仅在自包时生效。
- bootstrap 把 `config.ui` 交给 `setUiConfig`;`sceneProps = {project, onFlows: config.flows?.onFlows}`。

```tsx
// CameraScene.test.tsx
test('project 走 prop,不再 getProject(Space)', () => {
  // getProject spy 断言未调;传入的 fake IProject 出现在渲染树数据里
})
test('宿主已包 I18nProvider 时跳过自包', () => {
  // 外层包 I18nProvider 渲染 CameraScene,断言不再嵌套第二层
})
```

- [ ] **Step 4: 验证 + Commit**

Run: `npx jest packages/camera-studio && npx jest packages/playground`
Expected: 全绿(App.hostFlows.test.tsx 等引用 App 的测试一并改 CameraScene)。

```bash
git add packages/camera-studio
git commit -m "$(cat <<'EOF'
feat(camera-studio): CameraScene 组件化——project 注入 + UI 装配可配(portal/zIndex/locale)

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: playground 薄壳化

**Files:**
- Modify: `packages/playground/src/shared/camera/index.tsx`(全文替换,≤40 行)

**Interfaces:**
- Consumes: T8/T9 公开面。

- [ ] **Step 1: 薄壳**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import {useCameraStudio, CameraScene} from '@dreamerbird/camera-studio'

// ?sync=ws://host:port 覆盖 sync-server 地址:浏览器实测隔离用(默认 3000
// 是用户的服,共享工作区的 8082/8083 两个 vite 都会吃到本文件,测试连错服
// 会把用户页面拉进测试场景)。缺省走默认路径,不影响日常使用。
const syncParam = new URLSearchParams(window.location.search).get('sync')

function Page() {
  const {ready, error, sceneProps} = useCameraStudio({
    project: 'Space',
    sync: {serverUrl: syncParam ?? 'ws://localhost:3000'},
  })
  if (error) throw error
  if (!ready) return null
  return <CameraScene {...sceneProps} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Page />)
```

行数核对:`wc -l` ≤ 40(含空行注释,本写法约 24 行)。

- [ ] **Step 2: 冒烟**

Run: `npx jest packages/playground packages/camera-studio` 全绿;`npx tsc -p packages/playground/tsconfig.json --noEmit` 干净。
手工冒烟清单(交给用户或 playwright MCP,按 memory camera-playground-ops 的三连坑注意:蒙皮变形 raycast 不灵须先回 T、console_messages 跨会话、截图落 .playwright-mcp):放置 / 姿势 / 手势 / 路径 / 相机 / 视频导出 / 撤销。

- [ ] **Step 3: Commit**

```bash
git add packages/playground/src/shared/camera/index.tsx
git commit -m "$(cat <<'EOF'
refactor(playground): 相机页薄壳化(≤40 行)吃模块狗粮

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: 最小宿主 demo + 集成指南

**Files:**
- Create: `examples/camera-host-demo/package.json`、`vite.config.ts`、`index.html`、`src/main.tsx`、`src/memorySource.ts`
- Create: `docs/guides/camera-studio-embedding.md`

**Interfaces:**
- Consumes: 全部前序。

- [ ] **Step 1: examples/camera-host-demo**

`src/memorySource.ts`:内存版 `WritableLibrarySource`(约 60 行:Map 存条目/blob,getBlobUrl 用 URL.createObjectURL)——同时是集成指南的示例实现。
`src/main.tsx`:宿主页面 = 顶部导航条 + 整页 `<CameraScene>`;演示 `storage: new MemorySource()`、`assets.baseUrl` 指到包内缺省、`sync: false`。
`package.json` private,vite dev 依赖照抄 playground 的相关段;`yarn install` 后 `yarn workspace camera-host-demo dev` 可跑(root workspaces 已含 `examples/*`,核实 package.json workspaces 字段,若没有 `examples/*` 就加上)。

- [ ] **Step 2: 集成指南**

`docs/guides/camera-studio-embedding.md` 大纲(每节都要有可复制代码):
1. 安装与 peer 依赖清单;
2. 两行接入(useCameraStudio + CameraScene),config 全字段参考表;
3. 存储:实现 `WritableLibrarySource` 的注意事项(upsert 语义/内容寻址/错误码 `auth/quota/network/conflict/not-found`)+ 先用契约套件自检的完整示例;
4. 内置资产上架到自有 CDN:照 `seedAssetsManifest` 拷 `assets/`、`assets.baseUrl` 指过去;
5. 场景状态接管:initialState/onStateChange 与 `usePersistentStorage: false` 的联动语义;
6. 协作:模块只含客户端;服务端用 `@dreamerbird/saaz` + `@trpc/server` WS 适配器,路由照 `packages/sync-server/src` 抄(6 个 saaz_* 路由,内存 BackMemoryAdapter 可换持久化);**资产库不过 sync**(存储服务职责);
7. 约束:单页单实例、嵌入单位 = 整页/整路由(studio 覆盖层铺满视口 z-100,停靠框基准 1000 可配)、i18n 嵌套规则、config 首帧锁定不热更;
8. 排错:纯查看器模式入口消失是预期;`seed-*` id 前缀可写源不可用;baseUrl 404 的表象。

- [ ] **Step 3: 验证 + Commit**

Run: `yarn workspace camera-host-demo build`(或 dev 起服手工开一次)确认 demo 真能跑;`npx jest packages/camera-studio` 全绿。

```bash
git add examples/camera-host-demo docs/guides/camera-studio-embedding.md package.json yarn.lock
git commit -m "$(cat <<'EOF'
docs(camera-studio): 宿主集成指南 + examples 最小宿主 demo

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: 公共 API 快照 + 验收全量核对

**Files:**
- Create: `packages/camera-studio/etc/camera-studio.api.md`(api-extractor 产物)
- Modify: `packages/camera-studio/package.json`(build:api 脚本照 core 同款)
- Create: `packages/camera-studio/src/publicApi.test.ts`(导出面快照兜底)

**Interfaces:**
- Consumes: 全部前序;core 的 api-extractor 基座(`devEnv/api-extractor-base.json`、`packages/core/etc/core.api.md`)。

- [ ] **Step 1: api-extractor 接线**

照 packages/core 的做法:`cat packages/core/package.json | grep -A3 api` 找它的 api-extractor 脚本与 config,复制改造成 camera-studio 版(report 落 `etc/camera-studio.api.md`)。若 api-extractor 对 vite-only 语法报错且 30 分钟内修不好,降级为导出面快照测试并在 PR 说明:
```ts
// publicApi.test.ts
test('公共导出面快照', async () => {
  const api = await import('./index')
  expect(Object.keys(api).sort()).toMatchSnapshot()
})
```

- [ ] **Step 2: 全量验证**

Run(从仓库根):
```bash
npx jest                                    # 全量
npx tsc -p packages/camera-studio/tsconfig.json --noEmit
npx tsc -p packages/playground/tsconfig.json --noEmit
npx eslint packages/camera-studio/src packages/playground/src/shared/camera examples/camera-host-demo/src
graft build                                 # 图谱终态刷新
```
Expected: 全绿(jest 若有既有基线失败套件,对照 memory sequenced-pose-prop 记录的 3 个既有债套件,只允许那些红)。

- [ ] **Step 3: 验收 8 条逐条核对(spec §8)**

- [ ] 1. 包形态:`packages/camera-studio` git log 有历史(`git log --follow`)、package.json 非 private、exports 完整、peerDeps 按 `grep -rh "from '" src --include='*.ts*' -o | sort -u` 核对无遗(产物的 import 全部要么 peer 要么 dependency)。
- [ ] 2. playground 薄壳 ≤40 行 + 冒烟清单过(放置/姿势/手势/路径/相机/视频导出/撤销)。
- [ ] 3. hook 单测:幂等/StrictMode/卸载四项/第二实例/namespace 库名/sync 透传/state 联动(T8 用例 1-9)。
- [ ] 4. 统一数据源:聚合读/写路由/前缀拒绝/纯查看器隐藏/契约套件对 IDB 跑通(T4/T5)。
- [ ] 5. 资产去打包器耦合:`grep -rn "import.meta.glob" packages/camera-studio/src` 为空;清单入库;baseUrl 可配(T6)。
- [ ] 6. 旧数据清理:fake-indexeddb 迁移测试(T7)。
- [ ] 7. examples demo 跑通 + 集成指南含 saaz 配方(T11)。
- [ ] 8. 基线全绿 + API 快照建档(本任务 Step 1/2)。

- [ ] **Step 4: Commit**

```bash
git add packages/camera-studio
git commit -m "$(cat <<'EOF'
chore(camera-studio): 公共 API 快照建档 + 验收全量核对

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review 记录

- **Spec 覆盖**:§3 公开 API → T8/T9;§4 装配拆分 → T1/T2/T8/T9/T10;§5 统一数据源 → T3/T4/T5/T6/T7;§6 状态与协作 → T8(config.state/sync)+ T11 指南 saaz 配方;§7 生命周期 → T8/T9;§8 验收 8 条 → T12 核对表;§9 非目标未安插任何任务(subscribe/多实例/局部嵌入均未实现,正确)。
- **占位扫描**:无 TBD/TODO;所有测试步骤带真实断言;所有命令可直接执行。
- **类型一致性**:LibraryError/LibrarySource/WritableLibrarySource(T3)→ T4/T5/T6/T8 逐字复用;`configureLibrary`、`canWrite`、`getEntrySource`(T5)→ T7/T8 复用;`StaticCatalogSource`/`seedAssetsManifest`/`buildBuiltinPoseEntries`(T6)→ T7/T8 复用;`CameraStudioConfig/CameraStudioHandle/BootCtx`(T8)→ T9/T10 复用;blobId 前缀路由规则在 T5 定义、T6 catalog 遵循、T7 不涉及。
- **Review Focus 五条**:#1 → T5 Step 1;#2 → T7 Step 1;#3 → T6 Step 4;#4 → T8 Step 2 用例 1/2/3;#5 → T4 契约(round-trip/upsert)+ T5 Step 1(id 冲突防御)。均有测试钉住。

## 执行交接

计划完成,已保存到本文件。请审阅计划,确认后选择执行方式:

- **Subagent-driven(推荐)**——每个任务派一个全新子代理实现、独立评审通过再进下一个,最后整分支终审。本计划 12 个任务、任务间接口咬合紧(T3 的接口 T4-T8 全依赖),子代理模式能靠每任务门禁兜住接口漂移;代价是每个任务/评审各烧一份新上下文。
- **Native**——我在本会话里逐任务实现,最后整分支一次评审。最便宜最快,但中途无独立评审。
