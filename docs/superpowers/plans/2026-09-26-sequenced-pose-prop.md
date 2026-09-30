# 时间轴姿势属性(Sequenced Pose Prop)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把人体模型姿势变成 theatre 时间轴上的单一属性:一条轨道、菱形关键帧、逐骨骼平滑混合,库姿势与自定义姿势同一属性承载,旧数据无损迁移。

**Architecture:** 不动 `@dreamerbird/core` 属性类型系统。`pose` 属性保持 `t.string`(值为 JSON 字符串),经 opts 注入自定义插值器(逐骨骼 slerp/lerp)与 `hidden: true`;studio 侧仅补两个公共 API 透传(`undo/redo`、`unsequenceProp`)。写帧/读轨全部走 theatre 现成通道(`sequenceProp` + track-aware `set`)。

**Tech Stack:** TypeScript、React、three(slerp/lerp)、@dreamerbird/core+studio(fork 内)、jest(仓库根跑,jest-esbuild)。

**Spec:** docs/superpowers/specs/2026-09-26-sequenced-pose-prop-design.md(执行者必读,本计划从其条款论证)

## Global Constraints

- **测试从仓库根跑**:`yarn test <路径>`(根 jest 配置)。typecheck:`yarn typecheck`。
- **TDD**:先写失败测试并亲眼看它红,再写实现。
- **jest-esbuild 不提升 jest.mock**:mock 一律 `jest.doMock` + `jest.resetModules` + 运行时 `require`(jest-esbuild-no-hoist 教训)。
- **提交信息**:中文 conventional commits,结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- **不改 core 属性类型系统**;studio 侧唯一改动 = Task 1 的两个公共 API 透传。
- **数据向后兼容**:`parsePoseValue` 必须容错旧两种格式(裸库 id / 旧骨骼 JSON);applyPose 按名写回,容忍快照含双套骨(Y Bot 104 项)或单套骨。
- **顺序门槛(用户拍板,spec §8.2/§8.3)**:Task 10(撤销/重做快捷键)必须先于 Task 11(摆姿势写帧改造)完成——Esc=保存退出 只在撤销可靠后才允许落地。
- 8082(vite)与 3000(sync-server)是用户进程,任何任务不得启动/重启/写入;手工验证只交付冒烟清单。

## File Structure

新建(均在 `packages/playground/src/shared/camera/`):

| 文件 | 职责 |
|---|---|
| `poseMode/poseValue.ts` | 姿势属性值模型:parse/serialize + 旧格式容错(spec §3) |
| `poseMode/poseLibResolve.ts` | 库姿势同步解析缓存 + 异步预取(spec §5) |
| `poseMode/poseInterpolate.ts` | 自定义插值器:逐骨骼 slerp/lerp(spec §4) |
| `poseMode/poseTrack.ts` | 轨道读取(帧位/帧数/轨道 id)+ 两条写通道(writePoseKeyframe/setPoseValue) |
| `poseMode/poseMigration.ts` | 旧 pose/poseOverride → 新值合成(spec §9) |
| `poseMode/poseFrame.ts` | 摆姿势进入时的帧模式判定(edit/new)+ 播放头吸附 |
| `undoShortcuts.ts` | 窗口级撤销/重做快捷键判定与接线(spec §8.3) |

修改:

| 文件 | 改动 |
|---|---|
| `packages/core/src/types/public.ts` | `IStudio` 加 `undo()/redo()`;`ITransactionAPI` 加 `unsequenceProp` |
| `packages/studio/src/TheatreStudio.ts` | 两个透传实现 |
| `PlacementManager.tsx` | 属性注册(§6.1)、消费链路(resolvePoseBones)、预取 effect、播放渲染规则(§7.1)、迁移 effect(§9)、`countLibraryEntryUsage` 兼容 |
| `App.tsx` | `applyPose` 改道(§7.3)、撤销快捷键接线、Enter 加入退出会话、状态行 props 装配 |
| `poseMode/poseSession.ts` | 会话记录 sessionPosition/frameMode |
| `poseMode/PoseModeRig.tsx` | 进入判定、播放头锁定、保存改走 writePoseKeyframe |
| `poseMode/PoseModeBar.tsx` | 文案:编辑帧/新建帧 |
| `assetLibrary/AssetLibraryPanel.tsx` | 姿势面板状态行(spec §6.2) |
| `i18n.ts` | 新词条(英/中) |

---

### Task 1: studio 公共 API——undo()/redo() 与 unsequenceProp

**Files:**
- Modify: `packages/core/src/types/public.ts:1017`(`ITransactionAPI`)、`:1348`(`IStudio`)
- Modify: `packages/studio/src/TheatreStudio.ts`(`transaction` 返回 api 处约 L120-168、类尾部)
- Test: `packages/studio/src/TheatreStudio.publicApi.test.ts`(新建)

**Interfaces:**
- Produces(后续任务依赖):
  - `IStudio.undo(): void`、`IStudio.redo(): void`
  - `ITransactionAPI.unsequenceProp<V>(pointer: Pointer<V>): void`——删轨道并把当前求值值落成静态覆盖(画面不跳)

- [ ] **Step 1: 写失败测试**

```ts
// packages/studio/src/TheatreStudio.publicApi.test.ts
/**
 * 公共 API 透传:undo/redo 直达内部 Studio;unsequenceProp 走
 * setPrimitivePropAsStatic(删轨道+当前值落静态)。
 * jest-esbuild 不提升 jest.mock:doMock + resetModules + 运行时 require。
 */
import type {$IntentionalAny} from '@dreamerbird/core/types/public'

describe('TheatreStudio public api passthroughs', () => {
  function setup() {
    jest.resetModules()
    const undo = jest.fn()
    const redo = jest.fn()
    const setPrimitivePropAsStatic = jest.fn()
    jest.doMock('@dreamerbird/studio/getStudio', () => ({
      getStudio: () => ({undo, redo}),
    }))
    const {TheatreStudio} = require('./TheatreStudio') as $IntentionalAny
    return {undo, redo, setPrimitivePropAsStatic, TheatreStudio}
  }

  test('publicApi.undo/redo 透传到内部 Studio', () => {
    const {undo, redo, TheatreStudio} = setup()
    const api = new TheatreStudio(undefined)
    api.undo()
    api.redo()
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
  })
})
```

注:`TheatreStudio.ts` 顶部须有 `import {getStudio} from '@dreamerbird/studio/getStudio'`(若现有导入路径不同,以其为准,doMock 路径跟着改)。constructor 现签名是 `constructor(internals: Studio) {}`,测试传 `undefined` 即可(透传不读 internals)。

- [ ] **Step 2: 跑测试看它红**

Run: `yarn test packages/studio/src/TheatreStudio.publicApi.test.ts`
Expected: FAIL——`api.undo is not a function`

- [ ] **Step 3: 实现**

`packages/core/src/types/public.ts`,`IStudio` 接口内(`scrub(): IScrub` 声明之后)追加:

```ts
  /**
   * Undoes the last committed transaction or scrub, if any.
   * 与 studio UI 的撤销菜单/快捷键同一历史栈。
   */
  undo(): void

  /** Re-applies the last undone transaction or scrub, if any. */
  redo(): void
```

`ITransactionAPI` 接口内(`sequenceProp` 声明之后)追加:

```ts
  /**
   * Removes the sequence track of the given prop and keeps its current
   * evaluated value as a static override (画面不跳)。再配 unset() 即回到默认值。
   * 与 sequenceProp 互逆。
   */
  unsequenceProp<V>(pointer: Pointer<V>): void
```

`packages/studio/src/TheatreStudio.ts`:

类内任意位置(靠近 `scrub()`)加:

```ts
  undo(): void {
    getStudio().undo()
  }

  redo(): void {
    getStudio().redo()
  }
```

`transaction(fn)` 里 `sequenceProp` 之后加(与 `sequenceProp` 同构):

```ts
      const unsequenceProp = <V>(prop: Pointer<V>) => {
        const {path, root} = getPointerParts(prop)

        if (!isSheetObject(root)) {
          throw new Error(
            'Argument prop must be a pointer to a SheetObject property',
          )
        }

        stateEditors.coreByProject.historic.sheetsById.sequence.setPrimitivePropAsStatic(
          {
            ...root.address,
            pathToProp: path,
            value: root.getValueByPointer(prop) as SerializablePrimitive,
          },
        )
      }
```

并把 `unsequenceProp` 加入 `return fn({...})` 的对象。若 `SerializablePrimitive` 未导入,从 `@dreamerbird/dataverse` 导入类型;`root.getValueByPointer` 参照 `useEditingToolsForSimpleProp.tsx:170` 的既有用法。

- [ ] **Step 4: 跑测试 + typecheck**

Run: `yarn test packages/studio/src/TheatreStudio.publicApi.test.ts && yarn typecheck`
Expected: PASS;typecheck 干净(`IStudio`/`ITransactionAPI` 的实现类全部满足新成员)。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/public.ts packages/studio/src/TheatreStudio.ts packages/studio/src/TheatreStudio.publicApi.test.ts
git commit -m "feat(studio): 公共 API 加 undo/redo 与 transaction.unsequenceProp(姿势轨道清除与宿主撤销快捷键的前置)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 姿势值模型 poseValue(parse/serialize + 旧格式容错)

**Files:**
- Create: `packages/playground/src/shared/camera/poseMode/poseValue.ts`
- Test: `packages/playground/src/shared/camera/poseMode/poseValue.test.ts`

**Interfaces:**
- Consumes: `PoseBones`(from `./poseOverride`,转口自 assetLibrary/types)
- Produces(后续任务依赖):
  - `type PosePropValue = {kind: 'lib'; id: string} | {kind: 'custom'; bones: PoseBones}`
  - `serializePoseValue(v: PosePropValue): string`
  - `serializeLibPose(id: string): string`
  - `serializeCustomPose(bones: PoseBones): string`
  - `parsePoseValue(json: string): PosePropValue | null`——容错:空/非法→null;裸 id→lib;无 kind 对象→custom
  - `isMigratedPoseValue(json: string): boolean`——是否已是新格式(迁移判定用,Task 8)

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/poseMode/poseValue.test.ts
import {
  isMigratedPoseValue,
  parsePoseValue,
  serializeCustomPose,
  serializeLibPose,
  serializePoseValue,
} from './poseValue'
import type {PoseBones} from './poseOverride'

const bones: PoseBones = {
  Hips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]},
}

describe('parsePoseValue', () => {
  test('空串与坏 JSON 回 null', () => {
    expect(parsePoseValue('')).toBe(null)
    expect(parsePoseValue('   ')).toBe(null)
    expect(parsePoseValue('{oops')).toBe(null)
  })

  test('新格式:lib 引用', () => {
    expect(parsePoseValue('{"kind":"lib","id":"p1"}')).toEqual({
      kind: 'lib',
      id: 'p1',
    })
  })

  test('新格式:custom 快照', () => {
    const json = serializeCustomPose(bones)
    expect(parsePoseValue(json)).toEqual({kind: 'custom', bones})
  })

  test('旧格式:不以 { 开头的一律按裸库 id 容错', () => {
    expect(parsePoseValue('entry_abc123')).toEqual({
      kind: 'lib',
      id: 'entry_abc123',
    })
    expect(parsePoseValue('42')).toEqual({kind: 'lib', id: '42'})
    expect(parsePoseValue('[1,2]')).toEqual({kind: 'lib', id: '[1,2]'})
  })

  test('旧格式:无 kind 的骨骼 JSON 容错为 custom', () => {
    expect(parsePoseValue(JSON.stringify(bones))).toEqual({
      kind: 'custom',
      bones,
    })
  })

  test('kind 无法识别回 null(有 kind 但不合法)', () => {
    expect(parsePoseValue('{"kind":"weird"}')).toBe(null)
    expect(parsePoseValue('{"kind":"lib"}')).toBe(null) // 缺 id
    expect(parsePoseValue('{"kind":"custom"}')).toBe(null) // 缺 bones
  })
})

describe('serializePoseValue / isMigratedPoseValue', () => {
  test('serialize 往返', () => {
    for (const v of [
      {kind: 'lib', id: 'x'} as const,
      {kind: 'custom', bones} as const,
    ]) {
      expect(parsePoseValue(serializePoseValue(v))).toEqual(v)
    }
    expect(serializeLibPose('x')).toBe('{"kind":"lib","id":"x"}')
  })

  test('isMigratedPoseValue 只认新格式', () => {
    expect(isMigratedPoseValue('{"kind":"lib","id":"x"}')).toBe(true)
    expect(isMigratedPoseValue('{"kind":"custom","bones":{}}')).toBe(true)
    expect(isMigratedPoseValue('entry_abc')).toBe(false)
    expect(isMigratedPoseValue(JSON.stringify(bones))).toBe(false)
    expect(isMigratedPoseValue('')).toBe(false)
    expect(isMigratedPoseValue('{oops')).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `yarn test packages/playground/src/shared/camera/poseMode/poseValue.test.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: 实现**

```ts
// packages/playground/src/shared/camera/poseMode/poseValue.ts
/**
 * 时间轴姿势属性的值模型(spec §3):pose 属性是 t.string,值为 JSON 字符串,
 * 二选一——库姿势引用 {kind:'lib',id} 或自定义骨骼快照 {kind:'custom',bones}。
 * 空串 = 无姿势(回绑定)。解析对旧两种格式容错:
 *   旧 props.pose(裸条目 id 字符串)→ lib;旧 props.poseOverride(无 kind
 *   骨骼 JSON)→ custom。读取侧因此天然向后兼容,迁移(Task 8)只搬家不改写。
 */
import type {PoseBones} from './poseOverride'

export type PosePropValue =
  | {kind: 'lib'; id: string}
  | {kind: 'custom'; bones: PoseBones}

export function serializePoseValue(v: PosePropValue): string {
  return JSON.stringify(v)
}

export function serializeLibPose(id: string): string {
  return JSON.stringify({kind: 'lib', id} satisfies PosePropValue)
}

export function serializeCustomPose(bones: PoseBones): string {
  return JSON.stringify({kind: 'custom', bones} satisfies PosePropValue)
}

let warned = false

export function parsePoseValue(json: string): PosePropValue | null {
  const trimmed = (json ?? '').trim()
  if (!trimmed) return null
  // 旧 props.pose:裸条目 id(库条目 id 由系统生成,不以 '{' 开头)
  if (!trimmed.startsWith('{')) return {kind: 'lib', id: trimmed}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    if (!warned) {
      warned = true
      console.warn('[pose] pose 值 JSON 解析失败,回退绑定姿势')
    }
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const rec = parsed as Record<string, unknown>
  if ('kind' in rec) {
    if (rec.kind === 'lib' && typeof rec.id === 'string' && rec.id) {
      return {kind: 'lib', id: rec.id}
    }
    if (
      rec.kind === 'custom' &&
      rec.bones &&
      typeof rec.bones === 'object' &&
      !Array.isArray(rec.bones)
    ) {
      return {kind: 'custom', bones: rec.bones as PoseBones}
    }
    // kind 字段存在但无法识别:明确回 null(骨骼名不会叫 kind,无歧义)
    return null
  }
  // 旧 props.poseOverride:无 kind 的骨骼快照
  return {kind: 'custom', bones: parsed as PoseBones}
}

/** 是否已是新格式(带合法 kind 的 JSON)——迁移只搬旧格式,见 poseMigration */
export function isMigratedPoseValue(json: string): boolean {
  const trimmed = (json ?? '').trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') return false
    const kind = (parsed as {kind?: unknown}).kind
    return kind === 'lib' || kind === 'custom'
  } catch {
    return false
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `yarn test packages/playground/src/shared/camera/poseMode/poseValue.test.ts`
Expected: PASS(全绿)

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/poseMode/poseValue.ts packages/playground/src/shared/camera/poseMode/poseValue.test.ts
git commit -m "feat(playground): 姿势属性值模型——lib 引用/custom 快照两形态,旧裸 id 与旧骨骼 JSON 读取侧容错

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 库姿势解析缓存 poseLibResolve

**Files:**
- Create: `packages/playground/src/shared/camera/poseMode/poseLibResolve.ts`
- Test: `packages/playground/src/shared/camera/poseMode/poseLibResolve.test.ts`

**Interfaces:**
- Consumes: `getLibrary().backend.getEntry`(`../assetLibrary/library`);`PosePropValue`(Task 2)
- Produces:
  - `resolveLibPoseBones(id: string): PoseBones | null`——同步缓存读;未命中每 id 告警一次
  - `resolvePoseBones(value: PosePropValue | null): PoseBones | null`——custom→bones;lib→缓存
  - `prefetchLibPoses(ids: Iterable<string>, onReady: () => void): Promise<void>`——异步填缓存后回调(调用方 invalidate)
  - `__primeLibPoseCache(id: string, bones: PoseBones): void`、`__resetLibPoseCache(): void`(测试与内部用)

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/poseMode/poseLibResolve.test.ts
/**
 * 库姿势解析缓存(spec §5):插值器在求值热路径必须同步读,库条目在
 * IndexedDB 是异步——同步缓存 + 异步预取 + invalidate 重求值。
 * 缓存未命中:回 null(调用方回绑定/阶跃),每个 id 只告警一次。
 */
import {
  __primeLibPoseCache,
  __resetLibPoseCache,
  prefetchLibPoses,
  resolveLibPoseBones,
  resolvePoseBones,
} from './poseLibResolve'
import type {PoseBones} from './poseOverride'

const bones: PoseBones = {Hips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]}}

jest.doMock('../assetLibrary/library', () => ({
  getLibrary: () => ({
    backend: {
      getEntry: jest.fn(async (id: string) =>
        id === 'inLib' ? {kind: 'pose', id, rig: 'mixamo', bones} : undefined,
      ),
    },
  }),
}))

beforeEach(() => {
  __resetLibPoseCache()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  ;(console.warn as jest.Mock).mockRestore()
})

test('未缓存回 null 且每 id 只告警一次;prime 后命中', () => {
  expect(resolveLibPoseBones('missing')).toBe(null)
  expect(resolveLibPoseBones('missing')).toBe(null)
  expect(console.warn).toHaveBeenCalledTimes(1)
  __primeLibPoseCache('missing', bones)
  expect(resolveLibPoseBones('missing')).toBe(bones)
})

test('prefetch 拉取缺失条目进缓存并回调 onReady;已缓存不重复拉', async () => {
  __primeLibPoseCache('inLib', bones)
  const onReady = jest.fn()
  await prefetchLibPoses(['inLib', 'absent'], onReady)
  expect(resolveLibPoseBones('inLib')).toBe(bones)
  expect(resolveLibPoseBones('absent')).toBe(null)
  expect(onReady).toHaveBeenCalledTimes(1)
})

test('resolvePoseBones:null→null;custom→bones;lib→缓存或 null', () => {
  expect(resolvePoseBones(null)).toBe(null)
  expect(resolvePoseBones({kind: 'custom', bones})).toBe(bones)
  expect(resolvePoseBones({kind: 'lib', id: 'inLib'})).toBe(null) // 未预取
  __primeLibPoseCache('inLib', bones)
  expect(resolvePoseBones({kind: 'lib', id: 'inLib'})).toBe(bones)
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `yarn test packages/playground/src/shared/camera/poseMode/poseLibResolve.test.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: 实现**

```ts
// packages/playground/src/shared/camera/poseMode/poseLibResolve.ts
/**
 * 库姿势解析缓存(spec §5)。约束:插值器/求值是同步热路径,库条目读取
 * (IndexedDB)是异步——同步 Map 缓存 + 异步 prefetch 填充,填充完成由
 * 调用方 invalidate() 触发重求值;未命中期间回 null(渲染回绑定、
 * 插值阶跃),每个 id 只告警一次。库姿势条目视为不可变(抽帧存姿势
 * 总是新建条目),缓存不失效。
 */
import {getLibrary} from '../assetLibrary/library'
import type {PoseBones} from './poseOverride'
import type {PosePropValue} from './poseValue'

const cache = new Map<string, PoseBones>()
const warned = new Set<string>()

export function resolveLibPoseBones(id: string): PoseBones | null {
  const bones = cache.get(id)
  if (bones) return bones
  if (!warned.has(id)) {
    warned.add(id)
    console.warn(`[pose] 库姿势 ${id} 未解析(缺失或加载中),回退绑定姿势`)
  }
  return null
}

export function resolvePoseBones(value: PosePropValue | null): PoseBones | null {
  if (!value) return null
  return value.kind === 'custom' ? value.bones : resolveLibPoseBones(value.id)
}

export async function prefetchLibPoses(
  ids: Iterable<string>,
  onReady: () => void,
): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => !cache.has(id))
  if (missing.length === 0) return
  await Promise.all(
    missing.map(async (id) => {
      try {
        const entry = await getLibrary().backend.getEntry(id)
        if (entry?.kind === 'pose') cache.set(id, entry.bones)
      } catch (err) {
        console.warn('[pose] 库姿势加载失败', id, err)
      }
    }),
  )
  onReady()
}

/** 测试与已知好数据(如刚解析过的库面板列表)直填缓存 */
export function __primeLibPoseCache(id: string, bones: PoseBones): void {
  cache.set(id, bones)
}

export function __resetLibPoseCache(): void {
  cache.clear()
  warned.clear()
}
```

- [ ] **Step 4: 跑测试**

Run: `yarn test packages/playground/src/shared/camera/poseMode/poseLibResolve.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/poseMode/poseLibResolve.ts packages/playground/src/shared/camera/poseMode/poseLibResolve.test.ts
git commit -m "feat(playground): 库姿势同步解析缓存——求值热路径同步读,异步预取+告警一次

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 自定义插值器 poseInterpolate

**Files:**
- Create: `packages/playground/src/shared/camera/poseMode/poseInterpolate.ts`
- Test: `packages/playground/src/shared/camera/poseMode/poseInterpolate.test.ts`

**Interfaces:**
- Consumes: `parsePoseValue`/`serializeCustomPose`(Task 2)、`resolvePoseBones`/`__primeLibPoseCache`(Task 3)、three
- Produces:
  - `poseInterpolate(leftJson: string, rightJson: string, progression: number): string`——注入 `t.string` opts 的插值器(spec §4)
  - `mixPoseBones(a: PoseBones, b: PoseBones, t: number): PoseBones`(纯函数,测试友好)

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/poseMode/poseInterpolate.test.ts
/**
 * 姿势插值器(spec §4):两侧都能解析出骨骼 → 逐骨骼 slerp/lerp,结果恒为
 * custom 快照(两帧之间的求值产物);任一侧不行 → 阶跃返回 left。
 * parse 结果按字符串值 LRU 缓存,求值热路径不重复 parse。
 */
import {Quaternion, Vector3} from 'three'
import {mixPoseBones, poseInterpolate} from './poseInterpolate'
import {__primeLibPoseCache, __resetLibPoseCache} from './poseLibResolve'
import {serializeCustomPose, serializeLibPose} from './poseValue'
import type {PoseBones} from './poseOverride'

const A: PoseBones = {
  Hips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]},
}
const B: PoseBones = {
  // 绕 Z 转 90°:四元数 (0,0,sin45°,cos45°)
  Hips: {rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], position: [0, 2, 2]},
}

beforeEach(() => __resetLibPoseCache())

test('mixPoseBones:中点 = 旋转 slerp 一半 + 位置 lerp 一半', () => {
  const mid = mixPoseBones(A, B, 0.5)
  const q = new Quaternion().fromArray(mid.Hips.rotation)
  const expected = new Quaternion().slerp(
    new Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2),
    0.5,
  )
  expect(q.angleTo(expected)).toBeLessThan(1e-6)
  expect(new Vector3().fromArray(mid.Hips.position).toArray()).toEqual([
    0, 1.5, 1,
  ])
})

test('mixPoseBones:端点恒等(t=0 回 a,t=1 回 b)', () => {
  expect(mixPoseBones(A, B, 0)).toEqual(A)
  expect(mixPoseBones(A, B, 1)).toEqual(B)
})

test('mixPoseBones:只在一侧有的骨骼全程取有数据侧', () => {
  const onlyA: PoseBones = {ArmL: {rotation: [0, 0, 0, 1], position: [1, 0, 0]}}
  const merged = {...A, ...onlyA}
  for (const t of [0, 0.3, 1]) {
    expect(mixPoseBones(merged, B, t).ArmL).toEqual(onlyA.ArmL)
    expect(mixPoseBones(A, {...B, ...onlyA}, t).ArmL).toEqual(onlyA.ArmL)
  }
})

test('poseInterpolate:custom↔custom 结果是可回读的 custom 快照', () => {
  const out = poseInterpolate(serializeCustomPose(A), serializeCustomPose(B), 0.5)
  expect(JSON.parse(out).kind).toBe('custom')
  expect(out).toBe(serializeCustomPose(mixPoseBones(A, B, 0.5)))
})

test('poseInterpolate:lib 引用经缓存解析后参与混合(lib↔custom、lib↔lib)', () => {
  __primeLibPoseCache('pa', A)
  __primeLibPoseCache('pb', B)
  expect(poseInterpolate(serializeLibPose('pa'), serializeCustomPose(B), 1)).toBe(
    serializeCustomPose(B),
  )
  expect(poseInterpolate(serializeLibPose('pa'), serializeLibPose('pb'), 0)).toBe(
    serializeCustomPose(A),
  )
})

test('poseInterpolate:一侧空/非法/库未解析 → 阶跃返回 left 原串', () => {
  const left = serializeCustomPose(A)
  expect(poseInterpolate(left, '', 0.5)).toBe(left)
  expect(poseInterpolate(left, '{oops', 0.5)).toBe(left)
  expect(poseInterpolate(left, serializeLibPose('notFetched'), 0.5)).toBe(left)
  expect(poseInterpolate('', serializeCustomPose(B), 0.5)).toBe('')
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `yarn test packages/playground/src/shared/camera/poseMode/poseInterpolate.test.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: 实现**

```ts
// packages/playground/src/shared/camera/poseMode/poseInterpolate.ts
/**
 * 姿势属性的自定义插值器(spec §4),注入 t.string 的 opts.interpolate。
 * theatre 求值契约:(left, right, progression) => value,progression 已过
 * 贝塞尔手柄缓动。语义:
 *   两侧都解析出骨骼 → 逐骨骼 slerp/lerp,结果恒为 custom 快照——
 *     两帧之间的求值产物天然可被 applyPose 直接回放;
 *   任一侧为空/非法/库引用未解析 → 阶跃,原样返回 left(与 theatre 缺省
 *     leftInterpolate 行为一致,可预测)。
 * 性能:parse 按字符串值小容量 LRU;拖针/播放时帧值不变全部命中。
 */
import {Quaternion, Vector3} from 'three'
import type {PoseBones} from './poseOverride'
import {resolvePoseBones} from './poseLibResolve'
import {parsePoseValue, serializeCustomPose} from './poseValue'
import type {PosePropValue} from './poseValue'

const PARSE_CACHE_LIMIT = 64
const parseCache = new Map<string, PosePropValue | null>()

function parseCached(json: string): PosePropValue | null {
  const hit = parseCache.get(json)
  if (hit !== undefined || parseCache.has(json)) return hit ?? null
  const v = parsePoseValue(json)
  if (parseCache.size >= PARSE_CACHE_LIMIT) {
    parseCache.delete(parseCache.keys().next().value!)
  }
  parseCache.set(json, v)
  return v
}

export function mixPoseBones(a: PoseBones, b: PoseBones, t: number): PoseBones {
  if (t === 0) return a
  if (t === 1) return b
  const out: PoseBones = {}
  const qa = new Quaternion()
  const qb = new Quaternion()
  const va = new Vector3()
  const vb = new Vector3()
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const ba = a[name]
    const bb = b[name]
    // 只在一侧有的骨骼全程取有数据侧(不淡入淡出,避免半姿势)
    if (ba && !bb) {
      out[name] = ba
      continue
    }
    if (!ba && bb) {
      out[name] = bb
      continue
    }
    qa.fromArray(ba!.rotation)
    qb.fromArray(bb!.rotation)
    qa.slerp(qb, t)
    va.fromArray(ba!.position)
    vb.fromArray(bb!.position)
    va.lerp(vb, t)
    out[name] = {rotation: qa.toArray(), position: va.toArray()}
  }
  return out
}

export function poseInterpolate(
  leftJson: string,
  rightJson: string,
  progression: number,
): string {
  const lb = resolvePoseBones(parseCached(leftJson))
  const rb = resolvePoseBones(parseCached(rightJson))
  if (!lb || !rb) return leftJson
  return serializeCustomPose(mixPoseBones(lb, rb, progression))
}
```

- [ ] **Step 4: 跑测试 + typecheck**

Run: `yarn test packages/playground/src/shared/camera/poseMode/poseInterpolate.test.ts && yarn typecheck`
Expected: PASS;typecheck 干净

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/poseMode/poseInterpolate.ts packages/playground/src/shared/camera/poseMode/poseInterpolate.test.ts
git commit -m "feat(playground): 姿势插值器——逐骨骼 slerp/lerp,产物恒为 custom 快照,缺侧阶跃

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 轨道读取与两条写通道 poseTrack

**Files:**
- Create: `packages/playground/src/shared/camera/poseMode/poseTrack.ts`
- Test: `packages/playground/src/shared/camera/poseMode/poseTrack.test.ts`

**Interfaces:**
- Consumes: `getStudioSync`(@dreamerbird/core)、`getPointerParts`(@dreamerbird/dataverse)、`ISheetObject`
- Produces:
  - `getPoseTrackId(sheetObject): string | undefined`
  - `getPoseKeyframePositions(sheetObject): number[]`
  - `getPoseKeyframeCount(sheetObject): number`
  - `writePoseKeyframe(sheetObject, json: string): void`——spec §7.2:有轨道=scrub set(帧上覆盖/帧间新建);无轨道=transaction sequenceProp 建轨 + scrub set 写首帧(两步事务,已知限制)
  - `setPoseValue(sheetObject, json: string): void`——spec §7.3:单 scrub set(不建轨道)
  - `collectLibPoseIds(sheetObject): string[]`——当前值 + 轨道全部帧值里的 lib 引用 id(预取用,Task 6)

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/poseMode/poseTrack.test.ts
/**
 * 写帧通道分支(spec §7.2/§7.3):writePoseKeyframe 有轨道时只 scrub set;
 * 无轨道时先 transaction(sequenceProp)建轨再 scrub set(两步事务为已知
 * 限制,spec §2.4)。setPoseValue 永不建轨。轨道读取依赖 theatre 内部
 * 指针结构,单测用注入的根解析器;真实对象行为进冒烟清单。
 * jest-esbuild 不提升 jest.mock:doMock + resetModules + 运行时 require。
 */
import type {$IntentionalAny} from '@dreamerbird/core/types/public'

function setup() {
  jest.resetModules()
  const calls = {sequenceProp: 0, set: 0, commit: 0, transaction: 0}
  const fakeStudio = {
    transaction: jest.fn((fn: $IntentionalAny) => {
      calls.transaction++
      fn({sequenceProp: () => calls.sequenceProp++})
    }),
    scrub: jest.fn(() => ({
      capture: (fn: $IntentionalAny) => fn({set: () => calls.set++}),
      commit: () => calls.commit++,
    })),
  }
  jest.doMock('@dreamerbird/core', () => ({getStudioSync: () => fakeStudio}))
  const mod = require('./poseTrack') as $IntentionalAny as typeof import('./poseTrack') & {
    __setPointerRootResolverForTest: (fn: (() => $IntentionalAny) | null) => void
  }
  const rootWithTrack = (trackId: string | undefined) => ({
    template: {
      getMapOfValidSequenceTracks_forStudio: () => ({
        getValue: () => (trackId ? {pose: trackId} : {}),
      }),
    },
  })
  const sheetObject = {
    address: {
      projectId: 'p',
      sheetId: 's',
      sheetInstanceId: 'i',
      objectKey: 'o',
    },
    props: {pose: {}},
  } as $IntentionalAny
  return {calls, mod, sheetObject, rootWithTrack}
}

afterEach(() => jest.dontMock('@dreamerbird/core'))

describe('writePoseKeyframe', () => {
  test('无轨道:transaction 建轨 + scrub 写首帧(两步)', () => {
    const {calls, mod, sheetObject, rootWithTrack} = setup()
    mod.__setPointerRootResolverForTest(() => rootWithTrack(undefined))
    mod.writePoseKeyframe(sheetObject, '{"kind":"custom","bones":{}}')
    expect(calls.transaction).toBe(1)
    expect(calls.sequenceProp).toBe(1)
    expect(calls.set).toBe(1)
    expect(calls.commit).toBe(1)
    mod.__setPointerRootResolverForTest(null)
  })

  test('有轨道:只 scrub set(帧上覆盖/帧间新建由 theatre 按 position 决定)', () => {
    const {calls, mod, sheetObject, rootWithTrack} = setup()
    mod.__setPointerRootResolverForTest(() => rootWithTrack('track-1'))
    mod.writePoseKeyframe(sheetObject, '{"kind":"custom","bones":{}}')
    expect(calls.transaction).toBe(0)
    expect(calls.set).toBe(1)
    expect(calls.commit).toBe(1)
    mod.__setPointerRootResolverForTest(null)
  })

  test('getPoseTrackId / getPoseKeyframeCount 经根解析器读取', () => {
    const {mod, sheetObject, rootWithTrack} = setup()
    mod.__setPointerRootResolverForTest(() => rootWithTrack('track-1'))
    expect(mod.getPoseTrackId(sheetObject)).toBe('track-1')
    mod.__setPointerRootResolverForTest(() => rootWithTrack(undefined))
    expect(mod.getPoseTrackId(sheetObject)).toBe(undefined)
    mod.__setPointerRootResolverForTest(null)
  })
})

describe('setPoseValue', () => {
  test('永不建轨:无轨道也只 scrub set', () => {
    const {calls, mod, sheetObject, rootWithTrack} = setup()
    mod.__setPointerRootResolverForTest(() => rootWithTrack(undefined))
    mod.setPoseValue(sheetObject, '{"kind":"lib","id":"x"}')
    expect(calls.transaction).toBe(0)
    expect(calls.set).toBe(1)
    mod.__setPointerRootResolverForTest(null)
  })
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `yarn test packages/playground/src/shared/camera/poseMode/poseTrack.test.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: 实现**

```ts
// packages/playground/src/shared/camera/poseMode/poseTrack.ts
/**
 * 姿势轨道的读取与写入通道(spec §7)。
 *
 * 读取:theatre 没有公共的轨道查询 API,经 props 指针根(内部 SheetObject)
 * 的 template.getMapOfValidSequenceTracks_forStudio 取轨道映射——与
 * createTransactionPrivateApi 内部读取同一数据源。getPointerParts 走
 * dataverse 内部注册表,单测无法伪造真指针,根解析经
 * __setPointerRootResolverForTest 注入(仅测试用)。
 *
 * 写入(spec §7.2/§7.3 两条通道):
 *   writePoseKeyframe:摆姿势保存与面板「打帧」按钮。有轨道 = scrub set
 *   (theatre 按当前 position 写贝塞尔帧,同 position 覆盖);无轨道 =
 *   transaction sequenceProp 建轨 + scrub set 写首帧——两步事务为已知
 *   限制(setPrimitivePropAsSequenced 的 trackId 随机生成,set 看不到
 *   同事务草稿里的新轨道,spec §2.4)。
 *   setPoseValue:面板库姿势应用。永不建轨:有轨道写帧、无轨道写静态,
 *   theatre track-aware set 原生行为。
 */
import {getStudioSync} from '@dreamerbird/core'
import {getPointerParts} from '@dreamerbird/dataverse'
import type {ISheetObject} from '@dreamerbird/core'
import type {$IntentionalAny} from '@dreamerbird/core/types/public'

type InternalSheetObject = {
  template: {
    getMapOfValidSequenceTracks_forStudio: () => {
      getValue: () => Record<string, unknown>
    }
  }
}

let pointerRootResolverForTest: (() => $IntentionalAny) | null = null

/** 仅测试:getPointerParts 依赖 dataverse 内部注册表,真指针无法伪造 */
export function __setPointerRootResolverForTest(
  fn: (() => $IntentionalAny) | null,
): void {
  pointerRootResolverForTest = fn
}

function internalRoot(sheetObject: ISheetObject<$IntentionalAny>): InternalSheetObject {
  if (pointerRootResolverForTest) return pointerRootResolverForTest()
  const {root} = getPointerParts(sheetObject.props.pose as $IntentionalAny)
  // props 指针的根恒为内部 SheetObject(sheet 对象属性的定义域)
  return root as InternalSheetObject
}

export function getPoseTrackId(
  sheetObject: ISheetObject<$IntentionalAny>,
): string | undefined {
  const tree = internalRoot(sheetObject)
    .template.getMapOfValidSequenceTracks_forStudio()
    .getValue()
  const trackId = (tree as {pose?: unknown}).pose
  return typeof trackId === 'string' ? trackId : undefined
}

/** 轨道 BasicKeyframedTrack 的帧数据;无轨道回 undefined */
function poseTrackData(
  sheetObject: ISheetObject<$IntentionalAny>,
): {keyframes: {byId: Record<string, {position: number; value: unknown}>}} | undefined {
  const trackId = getPoseTrackId(sheetObject)
  if (!trackId) return undefined
  const root = internalRoot(sheetObject) as $IntentionalAny
  const {sheetId, objectKey} = sheetObject.address
  // 与 useEditingToolsForSimpleProp.tsx:181-187 同一读取路径
  const {val} = require('@dreamerbird/dataverse') as typeof import('@dreamerbird/dataverse')
  return val(
    root.template.project.pointers.historic.sheetsById[sheetId].sequence
      .tracksByObject[objectKey].trackData[trackId],
  )
}

export function getPoseKeyframePositions(
  sheetObject: ISheetObject<$IntentionalAny>,
): number[] {
  const track = poseTrackData(sheetObject)
  if (!track) return []
  return Object.values(track.keyframes.byId).map((kf) => kf.position)
}

export function getPoseKeyframeCount(
  sheetObject: ISheetObject<$IntentionalAny>,
): number {
  return getPoseKeyframePositions(sheetObject).length
}

/** 当前值 + 轨道全部帧值里的 lib 引用 id(prefetchLibPoses 的输入) */
export function collectLibPoseIds(
  sheetObject: ISheetObject<$IntentionalAny>,
): string[] {
  const {parsePoseValue} = require('./poseValue') as typeof import('./poseValue')
  const {val} = require('@dreamerbird/dataverse') as typeof import('@dreamerbird/dataverse')
  const ids = new Set<string>()
  const current = parsePoseValue(
    (val(sheetObject.props.pose as $IntentionalAny) as string) ?? '',
  )
  if (current?.kind === 'lib') ids.add(current.id)
  const track = poseTrackData(sheetObject)
  if (track) {
    for (const kf of Object.values(track.keyframes.byId)) {
      const v = parsePoseValue(typeof kf.value === 'string' ? kf.value : '')
      if (v?.kind === 'lib') ids.add(v.id)
    }
  }
  return [...ids]
}

export function writePoseKeyframe(
  sheetObject: ISheetObject<$IntentionalAny>,
  json: string,
): void {
  const studio = getStudioSync()
  if (!studio) return
  if (!getPoseTrackId(sheetObject)) {
    studio.transaction(({sequenceProp}) => {
      sequenceProp(sheetObject.props.pose as $IntentionalAny)
    })
  }
  const scrub = studio.scrub()
  scrub.capture(({set}) => {
    set(sheetObject.props.pose as $IntentionalAny, json)
  })
  scrub.commit()
}

export function setPoseValue(
  sheetObject: ISheetObject<$IntentionalAny>,
  json: string,
): void {
  const studio = getStudioSync()
  if (!studio) return
  const scrub = studio.scrub()
  scrub.capture(({set}) => {
    set(sheetObject.props.pose as $IntentionalAny, json)
  })
  scrub.commit()
}
```

实现注意:`require('@dreamerbird/dataverse')` 的运行时 require 只为避免循环 import 的顾虑其实不存在——直接顶部 `import {val} from '@dreamerbird/dataverse'`、`import {parsePoseValue} from './poseValue'` 即可(无环)。写实现时改成顶部导入,测试不受影响。

- [ ] **Step 4: 跑测试 + typecheck**

Run: `yarn test packages/playground/src/shared/camera/poseMode/poseTrack.test.ts && yarn typecheck`
Expected: PASS;typecheck 干净

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/poseMode/poseTrack.ts packages/playground/src/shared/camera/poseMode/poseTrack.test.ts
git commit -m "feat(playground): 姿势轨道读取与写通道——writePoseKeyframe(建轨+写帧)与 setPoseValue(静态保留)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: PlacementManager 属性注册与消费链路改造

**Files:**
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`(注册 L1075-1095、`literalConfigFor` L138-160、poseId/poseBones 加载 L1173/L1229-1249、应用 effect L1300-1335、`countLibraryEntryUsage` L185-195)
- Test: `packages/playground/src/shared/camera/placementPoseProps.test.ts`(新建,纯函数部分)

**Interfaces:**
- Consumes: Task 2-5 全部(parsePoseValue/resolvePoseBones/prefetchLibPoses/collectLibPoseIds/poseInterpolate)
- Produces: `pose` 属性新注册(hidden+interpolate);`poseBones` 供 Task 7 渲染规则;`countLibraryEntryUsage` 新旧格式通吃

- [ ] **Step 1: 写失败测试(纯函数部分)**

`literalConfigFor` 收窄与 `countLibraryEntryUsage` 的值判定抽纯函数:

```ts
// packages/playground/src/shared/camera/placementPoseProps.test.ts
/**
 * PlacementManager 姿势注册改造的可测纯件:
 * - countLibraryEntryUsage 的姿势计数对旧裸 id 与新 {kind:'lib'} 都算使用
 * - 注册形态:pose = hidden + 自定义插值器;poseOverride 保留但 hidden(迁移过渡)
 */
import {isPoseEntryUsed, posePropConfigShape} from './placementPoseProps'
import {poseInterpolate} from './poseMode/poseInterpolate'

test('isPoseEntryUsed:旧裸 id 与新格式 lib 引用都算使用;custom 不算', () => {
  expect(isPoseEntryUsed('entry_a', 'entry_a')).toBe(true)
  expect(isPoseEntryUsed('{"kind":"lib","id":"entry_a"}', 'entry_a')).toBe(true)
  expect(isPoseEntryUsed('{"kind":"custom","bones":{}}', 'entry_a')).toBe(false)
  expect(isPoseEntryUsed('', 'entry_a')).toBe(false)
})

test('posePropConfigShape:hidden + poseInterpolate + 空默认', () => {
  const shape = posePropConfigShape()
  expect(shape.defaultValue).toBe('')
  expect(shape.opts.hidden).toBe(true)
  expect(shape.opts.interpolate).toBe(poseInterpolate)
  expect(typeof shape.opts.label).toBe('function')
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `yarn test packages/playground/src/shared/camera/placementPoseProps.test.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: 实现**

新建 `packages/playground/src/shared/camera/placementPoseProps.ts`:

```ts
// packages/playground/src/shared/camera/placementPoseProps.ts
/**
 * PlacementManager 姿势属性注册的可测纯件(组件逻辑留 PlacementManager.tsx)。
 */
import {parsePoseValue} from './poseMode/poseValue'
import {poseInterpolate} from './poseMode/poseInterpolate'
import {translate} from './i18n'

/** 库条目使用计数:姿势值(新旧格式通吃)是否引用了该条目 */
export function isPoseEntryUsed(poseJson: string, entryId: string): boolean {
  const v = parsePoseValue(poseJson)
  return v?.kind === 'lib' && v.id === entryId
}

/** pose 属性的注册形态(spec §6.1):值是 JSON 字符串,面板隐藏,自定义插值 */
export function posePropConfigShape(): {
  defaultValue: string
  opts: {
    label: () => string
    hidden: boolean
    interpolate: typeof poseInterpolate
  }
} {
  return {
    defaultValue: '',
    opts: {
      label: () => translate('pg.props.pose'),
      hidden: true,
      interpolate: poseInterpolate,
    },
  }
}
```

`PlacementManager.tsx` 改动:

1. `additionalProps`(约 L1075-1095)——`pose` 从 stringLiteral 改为新形态;`poseOverride` 保留加 `hidden: true`(迁移过渡,注释注明下版本删):

```ts
      animation: literalConfigFor('animation', modelEntryId),
      // 姿势 = 时间轴单属性(spec §6.1):值 JSON(lib 引用|custom 快照),
      // 面板 hidden(JSON 不可读),自定义插值器让它可打帧且平滑混合
      pose: t.string('', posePropConfigShape().opts),
      // 迁移过渡(spec §9):读取/清理旧值用,面板隐藏;下个大版本删 key
      poseOverride: t.string('', {
        label: () => translate('pg.props.poseOverride'),
        hidden: true,
      }),
```

2. `literalConfigFor`(L138-160)——kind 收窄为 `'animation'`,删 `'pose'` 分支与缓存键(类型签名 `kind: 'animation'`;调用点只有 animation)。

3. 消费链路——删 `poseId`/`poseBones`/`poseOverrideJson` 旧三件套(L1173-1174 与 L1229-1249 整个库姿势加载 effect),替换为:

```ts
  const poseJson = (useVal(sheetObject?.props.pose) as string | undefined) ?? ''
  const poseBones = useMemo(
    () => resolvePoseBones(parsePoseValue(poseJson)),
    [poseJson],
  )
  // 库姿势引用预取(spec §5):当前值与轨道全部帧值里的 lib id 异步进缓存,
  // 到手 invalidate 触发重求值,阶跃变平滑
  useEffect(() => {
    if (!sheetObject) return
    const ids = collectLibPoseIds(sheetObject)
    if (ids.length === 0) return
    let cancelled = false
    prefetchLibPoses(ids, () => {
      if (!cancelled) invalidate()
    })
    return () => {
      cancelled = true
    }
  }, [sheetObject, poseJson, invalidate])
```

(`invalidate` 从该组件已有的 r3f 钩子来——L1317 的 effect 已在用,保持同一来源。)

4. `countLibraryEntryUsage`(L185-195)——`val(obj.props.pose)` 判定改走 `isPoseEntryUsed`:

```ts
    if (isPoseEntryUsed((val(obj.props.pose) as string) ?? '', entryId)) n++
```

5. 两个应用 effect(L1306-1327)与停止回调里的 `effectivePoseBones(poseOverrideJson, poseBones, bindPoseRef.current)` 统一改为 `poseBones ?? bindPoseRef.current`(优先级坍塌,spec §3.2);deps 里的 `poseOverrideJson` 移除、`poseBones` 保留。`effectivePoseBones`/`parsePoseOverride` 的 import 随之删除(poseOverride.ts 模块本身保留给 Task 8 迁移与 PoseBones 类型用)。

- [ ] **Step 4: 跑测试 + typecheck + 全量 camera 测试**

Run: `yarn test packages/playground/src/shared/camera/placementPoseProps.test.ts && yarn typecheck && yarn test packages/playground/src/shared/camera`
Expected: 新测试 PASS;typecheck 干净;既有 camera 套件无回归(注意 poseOverride.test.ts 等旧测试不应被本任务破坏——poseOverride.ts 文件不删)

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/PlacementManager.tsx packages/playground/src/shared/camera/placementPoseProps.ts packages/playground/src/shared/camera/placementPoseProps.test.ts
git commit -m "feat(playground): pose 属性注册改造——hidden+自定义插值器的单姿势属性,旧三层优先级坍塌为值优先

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 播放渲染规则(有轨道时逐帧应用,姿势压过动作)

**Files:**
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`(播放 effect 与 useFrame,L1300-1335)
- Test: `packages/playground/src/shared/camera/placementPoseProps.test.ts`(追加纯判定)

**Interfaces:**
- Consumes: Task 6 的 `poseBones`、`getPoseTrackId`(Task 5)
- Produces: `shouldApplyPoseDuringPlayback(hasPoseTrack: boolean): boolean`(纯判定);`useFrame` 内 mixer.update 后 applyPose 的接线

- [ ] **Step 1: 写失败测试(追加到 placementPoseProps.test.ts)**

```ts
import {shouldApplyPoseDuringPlayback} from './placementPoseProps'

test('播放中只在有姿势轨道时逐帧应用姿势(spec §7.1)', () => {
  expect(shouldApplyPoseDuringPlayback(true)).toBe(true)
  expect(shouldApplyPoseDuringPlayback(false)).toBe(false)
})
```

Run: `yarn test packages/playground/src/shared/camera/placementPoseProps.test.ts`
Expected: FAIL——`shouldApplyPoseDuringPlayback is not a function`

- [ ] **Step 2: 实现**

`placementPoseProps.ts` 追加:

```ts
/**
 * 播放中是否逐帧应用求值姿势(spec §7.1):有轨道才应用——姿势对快照内含的
 * 骨骼逐骨压过动作片段;无轨道保持现状(mixer 独占,停止时一次性回放)。
 */
export function shouldApplyPoseDuringPlayback(hasPoseTrack: boolean): boolean {
  return hasPoseTrack
}
```

`PlacementManager.tsx`:

1. 组件内加轨道状态(帧数据变化罕见,onChange 订阅轨道映射):

```ts
  const [hasPoseTrack, setHasPoseTrack] = useState(false)
  useEffect(() => {
    if (!sheetObject) return
    const update = () => setHasPoseTrack(getPoseTrackId(sheetObject) !== undefined)
    update()
    // 值变化(写帧/撤销/清除)时轨道有无可能翻转,随 poseJson 重查即可;
    // 轨道建立本身不改变值,但建轨必然伴随随后的写帧,一个 tick 内跟上
  }, [sheetObject, poseJson])
```

2. `useFrame`(L1329-1333)改为:

```ts
  useFrame((_, delta) => {
    if (!val(sheet.sequence.pointer.playing)) return
    if (!sheetObject) return
    mixer.update(delta)
    // 有姿势轨道:求值姿势逐骨压过动作片段(spec §7.1);
    // 每帧重读求值值(拖针/播放求值产物),resolvePoseBones 有 LRU/缓存兜底
    if (shouldApplyPoseDuringPlayback(hasPoseTrack)) {
      const evaluated = (val(sheetObject.props.pose) as string) ?? ''
      applyPose(
        instance,
        resolvePoseBones(parsePoseValue(evaluated)) ?? bindPoseRef.current,
      )
    }
    invalidate()
  })
```

3. 非播放的两个既有 effect 保持 Task 6 后的样子(值变化/停止时 `poseBones ?? bindPoseRef.current`)。r3f 的 `useFrame` 回调每次渲染都是新闭包,自然读到最新 `hasPoseTrack`/`sheetObject`,无需依赖数组接线。

- [ ] **Step 3: 跑测试 + typecheck + 全量 camera 测试**

Run: `yarn test packages/playground/src/shared/camera && yarn typecheck`
Expected: 全绿;typecheck 干净

- [ ] **Step 4: Commit**

```bash
git add packages/playground/src/shared/camera/PlacementManager.tsx packages/playground/src/shared/camera/placementPoseProps.ts packages/playground/src/shared/camera/placementPoseProps.test.ts
git commit -m "feat(playground): 播放渲染规则——有姿势轨道时每帧求值应用,姿势逐骨压过动作片段

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: 旧数据迁移 poseMigration

**Files:**
- Create: `packages/playground/src/shared/camera/poseMode/poseMigration.ts`
- Test: `packages/playground/src/shared/camera/poseMode/poseMigration.test.ts`
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`(迁移 effect)

**Interfaces:**
- Consumes: `isMigratedPoseValue`(Task 2)、`getStudioSync`
- Produces: `computeLegacyPoseMigration(legacy: {pose: string; poseOverride: string}): string | null`(spec §9:覆盖优先,新值已存在不迁移)

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/poseMode/poseMigration.test.ts
/**
 * 旧两字段 → 新 pose 值的迁移合成(spec §9):覆盖优先;已是新格式不动;
 * 双空不迁移。旧值原样搬——读取侧容错(parsePoseValue)完成格式升级。
 */
import {computeLegacyPoseMigration} from './poseMigration'

const legacyBones = JSON.stringify({
  Hips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]},
})

test('已是新格式:不迁移(返回 null)', () => {
  expect(
    computeLegacyPoseMigration({
      pose: '{"kind":"lib","id":"p1"}',
      poseOverride: legacyBones,
    }),
  ).toBe(null)
})

test('覆盖优先:poseOverride 非空时搬 override(旧骨骼 JSON 原样)', () => {
  expect(
    computeLegacyPoseMigration({pose: 'entry_a', poseOverride: legacyBones}),
  ).toBe(legacyBones)
})

test('仅库姿势:搬旧裸 id 原样', () => {
  expect(computeLegacyPoseMigration({pose: 'entry_a', poseOverride: ''})).toBe(
    'entry_a',
  )
})

test('双空:不迁移', () => {
  expect(computeLegacyPoseMigration({pose: '', poseOverride: ''})).toBe(null)
  expect(computeLegacyPoseMigration({pose: '  ', poseOverride: '  '})).toBe(null)
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `yarn test packages/playground/src/shared/camera/poseMode/poseMigration.test.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: 实现**

```ts
// packages/playground/src/shared/camera/poseMode/poseMigration.ts
/**
 * 旧两字段(props.pose 裸 id / props.poseOverride 骨骼 JSON)迁移为新 pose
 * 值(spec §9)。覆盖优先;新值已存在不碰;旧值原样搬——读取侧
 * parsePoseValue 把旧格式容错成新形态,搬家即升级。
 */
import {isMigratedPoseValue} from './poseValue'

export function computeLegacyPoseMigration(legacy: {
  pose: string
  poseOverride: string
}): string | null {
  if (isMigratedPoseValue(legacy.pose)) return null
  if (legacy.poseOverride.trim()) return legacy.poseOverride
  if (legacy.pose.trim()) return legacy.pose
  return null
}
```

`PlacementManager.tsx` 加迁移 effect(放在 sheetObject ready 之后、其他姿势 effect 之前;deps 只 `[sheetObject]`,幂等,StrictMode 双跑安全):

```ts
  // 旧两字段 → 新 pose 值迁移(spec §9):一个事务(可撤销、经 saaz 同步),
  // 幂等——新值已存在或旧值双空即不触发;迁移后旧 override unset 即天然标记
  useEffect(() => {
    if (!sheetObject) return
    const legacyPose = (val(sheetObject.props.pose) as string) ?? ''
    const legacyOverride =
      (val(sheetObject.props.poseOverride) as string) ?? ''
    const migrated = computeLegacyPoseMigration({
      pose: legacyPose,
      poseOverride: legacyOverride,
    })
    if (migrated === null && !legacyOverride.trim()) return
    const studio = getStudioSync()
    if (!studio) return
    studio.transaction(({set, unset}) => {
      if (migrated !== null) set(sheetObject.props.pose, migrated)
      if (legacyOverride.trim()) unset(sheetObject.props.poseOverride)
    })
  }, [sheetObject])
```

(`getStudioSync`、`computeLegacyPoseMigration` 加导入。)

- [ ] **Step 4: 跑测试 + typecheck + 全量 camera 测试**

Run: `yarn test packages/playground/src/shared/camera && yarn typecheck`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/poseMode/poseMigration.ts packages/playground/src/shared/camera/poseMode/poseMigration.test.ts packages/playground/src/shared/camera/PlacementManager.tsx
git commit -m "feat(playground): 旧 pose/poseOverride 自动迁移为新姿势值——覆盖优先,单事务可撤销

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: App 库姿势应用改道 setPoseValue

**Files:**
- Modify: `packages/playground/src/shared/camera/App.tsx`(`applyPose` L1429-1443)
- Test: 无新单测(通道分支已被 Task 5 覆盖;此处为接线,冒烟验证)

**Interfaces:**
- Consumes: `setPoseValue`/`serializeLibPose`(Task 5/2)
- Produces: 库姿势应用 = 写 `{kind:'lib', id}`;有轨道写帧、无轨道写静态(spec §6.2/§7.3);不再触碰 poseOverride

- [ ] **Step 1: 改造 applyPose**

`App.tsx` L1429-1443 整段替换:

```ts
  const applyPose = useCallback(
    (poseEntry: PoseEntry) => {
      if (!selectedPlacement) return
      // 库姿势应用(spec §6.2/§7.3):写 lib 引用。有轨道时在播放头写
      // 关键帧(引用入帧);无轨道时写静态值,不建轨道——固定姿势不
      // 意外多出轨道。旧「顺手清 poseOverride」随两字段合并消失。
      setPoseValue(selectedPlacement, serializeLibPose(poseEntry.id))
    },
    [selectedPlacement],
  )
```

删除不再使用的 `getStudioSync` 局部变量(若无其他用处);加导入 `setPoseValue`(./poseMode/poseTrack)、`serializeLibPose`(./poseMode/poseValue)。

- [ ] **Step 2: typecheck + 全量 camera 测试**

Run: `yarn typecheck && yarn test packages/playground/src/shared/camera`
Expected: 干净、全绿(若 App.hostFlows.test.tsx 等触及 applyPose 行为,按新语义更新断言:props.pose 收到 `{"kind":"lib","id":"..."}` 且 props.poseOverride 不再被写)

- [ ] **Step 3: Commit**

```bash
git add packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): 库姿势应用改道 setPoseValue——写 lib 引用,轨道自适应,不再清 override

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: 窗口级撤销/重做快捷键(spec §8.3 门槛任务)

**Files:**
- Create: `packages/playground/src/shared/camera/undoShortcuts.ts`
- Test: `packages/playground/src/shared/camera/undoShortcuts.test.ts`
- Modify: `packages/playground/src/shared/camera/App.tsx`(接线)

**Interfaces:**
- Consumes: Task 1 的 `studio.undo()/redo()`
- Produces: `undoIntentFromKeyEvent(ev: UndoKeyEventLike): 'undo' | 'redo' | null`(纯判定,含可编辑目标与 studio UI 内事件排除);App 窗口级 keydown 接线
- **门槛**:本任务未交付前,Task 11 不得开始(spec §8.2)

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/undoShortcuts.test.ts
/**
 * 窗口级撤销/重做快捷键(spec §8.3):
 *   Cmd/Ctrl+Z → undo;Cmd/Ctrl+Shift+Z 与 Ctrl+Y → redo。
 * 排除:可编辑目标(输入框/textarea/contentEditable);事件穿过 studio UI
 * 根(studio 自己处理,避免一次按键撤两步)。
 */
import {undoIntentFromKeyEvent} from './undoShortcuts'

const z = (over: Partial<Parameters<typeof undoIntentFromKeyEvent>[0]> = {}) =>
  undoIntentFromKeyEvent({
    key: 'z',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    isEditableTarget: false,
    insideStudioUi: false,
    ...over,
  })

test('Ctrl/Cmd+Z = undo;加 Shift = redo;Ctrl+Y = redo', () => {
  expect(z()).toBe('undo')
  expect(z({metaKey: true, ctrlKey: false})).toBe('undo')
  expect(z({shiftKey: true})).toBe('redo')
  expect(z({metaKey: true, ctrlKey: false, shiftKey: true})).toBe('redo')
  expect(z({key: 'y'})).toBe('redo')
})

test('无修饰键/其他键 = null', () => {
  expect(z({ctrlKey: false})).toBe(null)
  expect(z({key: 'x'})).toBe(null)
})

test('可编辑目标与 studio UI 内事件 = null(不抢 studio/输入框的撤销)', () => {
  expect(z({isEditableTarget: true})).toBe(null)
  expect(z({insideStudioUi: true})).toBe(null)
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `yarn test packages/playground/src/shared/camera/undoShortcuts.test.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: 实现**

```ts
// packages/playground/src/shared/camera/undoShortcuts.ts
/**
 * 窗口级撤销/重做快捷键(spec §8.3):studio 自带快捷键只在其 UI 焦点内
 * 生效(9-23 终审遗留),画布焦点下 Ctrl+Z 石沉大海——playground 在
 * window 级接管,直达 studio.undo()/redo()(Task 1 公共 API)。
 * 两个不抢:可编辑目标(输入框自己的文本撤销);事件穿过 studio UI
 * (studio 会自己处理,一次按键撤两步是大坑)。
 */
export type UndoKeyEventLike = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  isEditableTarget: boolean
  insideStudioUi: boolean
}

export function undoIntentFromKeyEvent(
  ev: UndoKeyEventLike,
): 'undo' | 'redo' | null {
  if (ev.isEditableTarget || ev.insideStudioUi) return null
  if (!ev.ctrlKey && !ev.metaKey) return null
  const key = ev.key.toLowerCase()
  if (key === 'z') return ev.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && !ev.shiftKey) return 'redo'
  return null
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!(
    el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable)
  )
}

/** studio UI 挂在 shadow DOM;事件 composedPath 含其宿主即视为 studio 内部 */
function isInsideStudioUi(ev: KeyboardEvent): boolean {
  const path = ev.composedPath() as HTMLElement[]
  return path.some(
    (el) =>
      el instanceof HTMLElement &&
      (el.id === 'theatrejs-studio-root' ||
        el.dataset?.['theatreStudioRoot'] !== undefined),
  )
}

/** App 接线:返回注销函数 */
export function bindUndoShortcuts(
  undo: () => void,
  redo: () => void,
): () => void {
  const onKey = (ev: KeyboardEvent) => {
    const intent = undoIntentFromKeyEvent({
      key: ev.key,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      shiftKey: ev.shiftKey,
      isEditableTarget: isEditableTarget(ev.target),
      insideStudioUi: isInsideStudioUi(ev),
    })
    if (!intent) return
    ev.preventDefault()
    if (intent === 'undo') undo()
    else redo()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
```

studio UI 根的真实标识(`#theatrejs-studio-root` / `data-theatre-studio-root`)实现第一步在浏览器 DOM 探一次(`document.querySelectorAll('[id*="theatre"]')` / 看 studio UI 挂载点),按实证改 `isInsideStudioUi` 的两个候选;找不到稳定标识就用「事件目标在 shadowRoot 内」兜底:`path.some(el => el instanceof ShadowRoot)`。

`App.tsx` 接线(顶层 effect,与其他 window 监听并列):

```ts
  // 窗口级撤销/重做(spec §8.3):画布焦点下 Ctrl+Z 也能撤,直达 studio 历史
  useEffect(() => {
    const studio = getStudioSync()
    if (!studio) return
    return bindUndoShortcuts(
      () => studio.undo(),
      () => studio.redo(),
    )
  }, [])
```

- [ ] **Step 4: 跑测试 + typecheck**

Run: `yarn test packages/playground/src/shared/camera/undoShortcuts.test.ts && yarn typecheck && yarn test packages/playground/src/shared/camera`
Expected: 全绿

- [ ] **Step 5: 手工核对(门槛验证,不计自动化)**

本任务是 Task 11 的门槛。交付前在浏览器手工核对(由用户或交付者带冒烟):画布上点一下(画布持焦点)→ Ctrl+Z 撤销上一笔姿势/属性改动 → 画面立即跟随;输入框里 Ctrl+Z 不触发场景撤销。**此核对通过后 Task 11 才开工。**

- [ ] **Step 6: Commit**

```bash
git add packages/playground/src/shared/camera/undoShortcuts.ts packages/playground/src/shared/camera/undoShortcuts.test.ts packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): 窗口级撤销/重做快捷键——画布焦点可用,不抢输入框与 studio UI

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: 摆姿势会话改造(帧模式 + 锁播放头 + 写帧保存)

**Files:**
- Create: `packages/playground/src/shared/camera/poseMode/poseFrame.ts`
- Test: `packages/playground/src/shared/camera/poseMode/poseFrame.test.ts`
- Modify: `packages/playground/src/shared/camera/poseMode/poseSession.ts`
- Modify: `packages/playground/src/shared/camera/poseMode/PoseModeRig.tsx`(进入判定 L100-190、保存 L148-168、锁定)
- Modify: `packages/playground/src/shared/camera/poseMode/PoseModeBar.tsx`(文案)
- Modify: `packages/playground/src/shared/camera/App.tsx`(Enter 加入退出,L1359 附近)
- Modify: `packages/playground/src/shared/camera/i18n.ts`(新词条)

**Interfaces:**
- Consumes: `getPoseKeyframePositions`/`writePoseKeyframe`/`serializeCustomPose`(Task 5/2);Task 10 已交付(门槛)
- Produces:
  - `determinePoseFrameMode(keyframePositions: number[], position: number, snap: (t: number) => number): {mode: 'edit' | 'new'; position: number}`
  - poseSession 新 API:`setPoseSessionFrame(key, frame: {mode, position}): void`、`getPoseSessionFrame(): {mode, position} | null`、`usePoseFrameMode(): {mode, position} | null`(clearPoseSession 一并清)

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/poseMode/poseFrame.test.ts
/**
 * 摆姿势进入的帧模式判定(spec §8.1):播放头贴网格后恰等于某姿势帧 =
 * 编辑该帧(保存=覆盖);否则 = 新建帧(保存=插入)。
 */
import {determinePoseFrameMode} from './poseFrame'

const snap = (t: number) => Math.round(t * 30) / 30 // 30fps 网格

test('播放头贴网格后落在帧上 = edit', () => {
  expect(determinePoseFrameMode([1, 2, 3], 2.001, snap)).toEqual({
    mode: 'edit',
    position: 2,
  })
})

test('两帧之间 = new', () => {
  expect(determinePoseFrameMode([1, 2, 3], 2.5, snap)).toEqual({
    mode: 'new',
    position: 2.5,
  })
})

test('无帧轨道 = new(保存即建轨写首帧)', () => {
  expect(determinePoseFrameMode([], 0, snap)).toEqual({mode: 'new', position: 0})
})
```

poseSession 增补测试(追加到 poseSession.test.ts):

```ts
test('会话帧信息随会话生灭:set/get/clear', () => {
  enterPoseSession('k1')
  setPoseSessionFrame('k1', {mode: 'edit', position: 2})
  expect(getPoseSessionFrame()).toEqual({mode: 'edit', position: 2})
  clearPoseSession()
  expect(getPoseSessionFrame()).toBe(null)
})

test('非当前会话 key 写入帧信息被忽略(A→B 切换防护)', () => {
  enterPoseSession('kB')
  setPoseSessionFrame('kA', {mode: 'edit', position: 2})
  expect(getPoseSessionFrame()).toBe(null)
  clearPoseSession()
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `yarn test packages/playground/src/shared/camera/poseMode/poseFrame.test.ts packages/playground/src/shared/camera/poseMode/poseSession.test.ts`
Expected: FAIL——`determinePoseFrameMode`/`setPoseSessionFrame` 不存在

- [ ] **Step 3: 实现**

`poseMode/poseFrame.ts`:

```ts
// packages/playground/src/shared/camera/poseMode/poseFrame.ts
/**
 * 摆姿势进入的帧模式判定(spec §8.1):底姿 = 播放头处时间轴求值(画面
 * 即求值,编辑态与画面一张皮);帧上进入 = 编辑该帧(保存覆盖),帧间
 * 进入 = 新建帧(保存插入)。位置一律贴网格(theatre 写帧也会贴)。
 */
export type PoseFrameMode = {mode: 'edit' | 'new'; position: number}

export function determinePoseFrameMode(
  keyframePositions: number[],
  position: number,
  snap: (t: number) => number,
): PoseFrameMode {
  const snapped = snap(position)
  return {
    mode: keyframePositions.includes(snapped) ? 'edit' : 'new',
    position: snapped,
  }
}
```

`poseSession.ts` 追加(与现有会话态同构,订阅沿用 onPoseSessionChange):

```ts
export type {PoseFrameMode} from './poseFrame'
import type {PoseFrameMode} from './poseFrame'

let sessionFrame: PoseFrameMode | null = null

/** 记录当前会话的帧信息;非当前会话 key 忽略(A→B 切换防护,同 clearPoseSessionIfCurrent) */
export function setPoseSessionFrame(key: string, frame: PoseFrameMode): void {
  if (!session || session.key !== key) return
  sessionFrame = frame
  notify() // 复用现有通知(变量名以实际为准)
}

export function getPoseSessionFrame(): PoseFrameMode | null {
  return session ? sessionFrame : null
}

export function usePoseFrameMode(): PoseFrameMode | null {
  // 与 usePoseSessionKey 同构:useSyncExternalStore 订阅 onPoseSessionChange
}
```

`clearPoseSession()` 与 `enterPoseSession()` 里把 `sessionFrame` 重置为 `null`(进入新会话由 Rig 挂载后写入)。

`PoseModeRig.tsx`:

1. 挂载 effect 内(进会话时,拿到 sheetObject 后)判定并记录帧模式 + 锁播放头:

```ts
    // 帧模式判定(spec §8.1):贴网格后帧上=编辑、帧间=新建;底姿由
    // 既有应用 effect 保证(非播放时画面恒为播放头求值,所见即所编)
    const frame = determinePoseFrameMode(
      getPoseKeyframePositions(sheetObject),
      sheet.sequence.position,
      (t) => sheet.sequence.closestGridPosition(t),
    )
    sheet.sequence.position = frame.position
    setPoseSessionFrame(placementKey, frame)

    // 锁播放头(spec §8.1.4):会话期间 position 被挪动即拉回会话时刻
    const offPosition = onChange(sheet.sequence.pointer.position, (pos) => {
      if (Math.abs((pos as number) - frame.position) > 1e-6) {
        sheet.sequence.position = frame.position
      }
    })
```

`offPosition` 加入清理(return 的 cleanup 里调用)。`onChange` 从 `@dreamerbird/core` 导入。

2. 保存路径(L148-168 的 onPoseExitRequested)改走写帧:

```ts
    const offExit = onPoseExitRequested((key) => {
      if (key !== placementKey) return
      const studio = getStudioSync()
      // 脏检查同前(threeIK 首解漂移会产生幻影撤销步,不脏不写)
      if (studio && (dirtyRef.current || isPoseDirty())) {
        const bones = capturePose(instance)
        // 写帧(spec §7.2):帧上=覆盖、帧间=新建、无轨=建轨+首帧;
        // 先把播放头钉回会话时刻(锁定期间理论不动,双保险)
        const frame = getPoseSessionFrame()
        if (frame) sheet.sequence.position = frame.position
        writePoseKeyframe(sheetObject, serializeCustomPose(bones))
      }
      clearPoseSession()
    })
```

3. `PoseModeBar.tsx` 文案:用 `usePoseFrameMode()` 显示「正在摆姿势 · 编辑关键帧/新建关键帧 · [移动|旋转] · Esc 完成」。i18n 新词条:

```ts
// i18n.ts en
'pg.pose.editFrame': 'editing keyframe',
'pg.pose.newFrame': 'new keyframe',
// zh
'pg.pose.editFrame': '编辑关键帧',
'pg.pose.newFrame': '新建关键帧',
```

4. `App.tsx`:L1359 的 Esc 处理处同条件加 `Enter`(`e.key === 'Escape' || e.key === 'Enter'`,保持既有可编辑目标守卫——若该 handler 没有守卫,Enter 只对非输入目标生效,守卫写法参照 PoseModeRig onKey L109-116)。Esc=Enter=保存退出(spec §8.2,门槛已由 Task 10 满足)。

- [ ] **Step 4: 跑测试 + typecheck + 全量 camera 测试**

Run: `yarn test packages/playground/src/shared/camera && yarn typecheck`
Expected: 全绿(poseSession.test.ts 新旧用例都过)

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/poseMode/poseFrame.ts packages/playground/src/shared/camera/poseMode/poseFrame.test.ts packages/playground/src/shared/camera/poseMode/poseSession.ts packages/playground/src/shared/camera/poseMode/poseSession.test.ts packages/playground/src/shared/camera/poseMode/PoseModeRig.tsx packages/playground/src/shared/camera/poseMode/PoseModeBar.tsx packages/playground/src/shared/camera/App.tsx packages/playground/src/shared/camera/i18n.ts
git commit -m "feat(playground): 摆姿势会话接入时间轴——帧上覆盖/帧间新建,锁播放头,Esc/Enter 写帧退出

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: 姿势面板状态行(spec §6.2)

**Files:**
- Modify: `packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx`(kind='pose' 顶部状态行)
- Modify: `packages/playground/src/shared/camera/App.tsx`(装配 status/计数/两动作,L1644-1653 附近)
- Modify: `packages/playground/src/shared/camera/i18n.ts`(新词条)
- Test: `packages/playground/src/shared/camera/poseStatusText.test.ts`(新建,纯文案推导)

**Interfaces:**
- Consumes: `getPoseKeyframeCount`(Task 5)、`unsequenceProp`(Task 1)、`resolvePoseBones`(Task 3)
- Produces:
  - `poseStatusText(poseJson: string, libName: string | null, t: (k: string) => string): string`——绑定/自定义/库:名称
  - App 装配:`poseStatus`、`poseKeyframeCount`、`onWritePoseKeyframe`、`onClearPose` 传入 AssetLibraryPanel

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/poseStatusText.test.ts
/**
 * 姿势状态行文案(spec §6.2):空/非法=绑定;custom=自定义;lib=库:名称
 * (条目缺失显示 id,告警与回退由 resolve 层负责)。
 */
import {poseStatusText} from './poseStatusText'

const t = (k: string) =>
  ({
    'pg.pose.statusBind': '绑定姿势',
    'pg.pose.statusCustom': '自定义姿势',
    'pg.pose.statusLibPrefix': '库:',
  })[k] ?? k

test('空与非法 JSON = 绑定姿势', () => {
  expect(poseStatusText('', null, t)).toBe('绑定姿势')
  expect(poseStatusText('{oops', null, t)).toBe('绑定姿势')
})

test('custom = 自定义姿势', () => {
  expect(poseStatusText('{"kind":"custom","bones":{}}', null, t)).toBe(
    '自定义姿势',
  )
})

test('lib = 库:名称(名称缺失回退 id)', () => {
  expect(poseStatusText('{"kind":"lib","id":"p1"}', '挥手', t)).toBe('库:挥手')
  expect(poseStatusText('{"kind":"lib","id":"p1"}', null, t)).toBe('库:p1')
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `yarn test packages/playground/src/shared/camera/poseStatusText.test.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: 实现**

`packages/playground/src/shared/camera/poseStatusText.ts`:

```ts
// packages/playground/src/shared/camera/poseStatusText.ts
/** 姿势状态行文案推导(spec §6.2),纯函数便于单测 */
import {parsePoseValue} from './poseMode/poseValue'

export function poseStatusText(
  poseJson: string,
  libName: string | null,
  t: (k: string) => string,
): string {
  const v = parsePoseValue(poseJson)
  if (!v) return t('pg.pose.statusBind')
  if (v.kind === 'custom') return t('pg.pose.statusCustom')
  return `${t('pg.pose.statusLibPrefix')}${libName ?? v.id}`
}
```

`AssetLibraryPanel.tsx`(kind='pose' 分支,网格上方)加状态行——新 props:

```ts
  poseStatus?: string
  poseKeyframeCount?: number
  onWritePoseKeyframe?: () => void
  onClearPose?: () => void
```

渲染(kind==='pose' 且 poseStatus 提供时;样式贴面板既有行内风格):

```tsx
    {kind === 'pose' && poseStatus !== undefined && (
      <div style={{display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', fontSize: 12}}>
        <span>
          {poseStatus}
          {typeof poseKeyframeCount === 'number' &&
            ` · ${poseKeyframeCount} ${t('pg.pose.keyframesUnit')}`}
        </span>
        {onWritePoseKeyframe && (
          <button onClick={onWritePoseKeyframe}>{t('pg.pose.addKeyframe')}</button>
        )}
        {onClearPose && <button onClick={onClearPose}>{t('pg.pose.clear')}</button>}
      </div>
    )}
```

(面板里文案函数的既有获取方式——translate 或 i18n hook——以其文件内现状为准,`t` 换成对应引用。)

`App.tsx` 装配(pose 面板 JSX 处):

```ts
  const selectedPoseJson =
    (useVal(selectedPlacement?.props.pose) as string | undefined) ?? ''
  const poseKeyframeCount = selectedPlacement
    ? getPoseKeyframeCount(selectedPlacement)
    : 0
  const onWritePoseKeyframe = useCallback(() => {
    if (selectedPlacement) writePoseKeyframe(selectedPlacement, selectedPoseJson)
  }, [selectedPlacement, selectedPoseJson])
  const onClearPose = useCallback(() => {
    const studio = getStudioSync()
    if (!studio || !selectedPlacement) return
    // 单事务(spec §6.2):删轨道(当前值落静态)+ 清静态 → 回默认绑定,一步撤销
    studio.transaction(({unsequenceProp, unset}) => {
      unsequenceProp(selectedPlacement.props.pose)
      unset(selectedPlacement.props.pose)
    })
  }, [selectedPlacement])
```

库姿势名称:面板已有 `PoseEntry` 列表(filterRig 那套),状态行的 libName 由 App 从 `useLibraryEntries`(或面板现有数据源)按当前 poseJson 的 id 反查后传入;装配代码随面板现状接线。`poseStatusText(selectedPoseJson, libName, translate)` 计算 `poseStatus`。

注意:`poseKeyframeCount` 不是响应式值(命令式读取)——App 已随 `selectedPoseJson`(useVal)与选中变化重渲,覆盖写帧/撤销/切换对象的刷新路径;轨道刚建立的那一瞬由随后的写帧值变化带动,一个渲染周期内跟上。i18n 词条:

```ts
// en
'pg.pose.statusBind': 'Bind pose',
'pg.pose.statusCustom': 'Custom pose',
'pg.pose.statusLibPrefix': 'Library: ',
'pg.pose.keyframesUnit': 'keyframes',
'pg.pose.addKeyframe': 'Add keyframe',
'pg.pose.clear': 'Clear pose',
// zh
'pg.pose.statusBind': '绑定姿势',
'pg.pose.statusCustom': '自定义姿势',
'pg.pose.statusLibPrefix': '库:',
'pg.pose.keyframesUnit': '个关键帧',
'pg.pose.addKeyframe': '打帧',
'pg.pose.clear': '清除姿势',
```

- [ ] **Step 4: 跑测试 + typecheck + 全量 camera 测试**

Run: `yarn test packages/playground/src/shared/camera && yarn typecheck`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add packages/playground/src/shared/camera/poseStatusText.ts packages/playground/src/shared/camera/poseStatusText.test.ts packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx packages/playground/src/shared/camera/App.tsx packages/playground/src/shared/camera/i18n.ts
git commit -m "feat(playground): 姿势面板状态行——来源/帧数/打帧/清除姿势,JSON 彻底退出视野

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review 记录

**Spec 覆盖核对**(spec 章节 → 任务):
- §3 值模型 → Task 2;§4 插值器 → Task 4;§5 解析缓存 → Task 3(+Task 6 预取 effect)
- §6.1 注册 → Task 6;§6.2 状态行 → Task 12;§6.3 粗糙边 → 范围外(spec §11)
- §7.1 渲染规则 → Task 7;§7.2/§7.3 两通道 → Task 5(+9/11/12 消费)
- §8.1/§8.2 会话 → Task 11;§8.3 撤销门槛 → Task 1+10(顺序约束已守:10 先于 11)
- §9 迁移 → Task 8;§10 测试策略 → 各任务 TDD + 下方冒烟清单
- §2.4 unsequenceProp 需要 → Task 1(已含)

**类型一致性**:`PosePropValue`/`serializeLibPose`/`resolvePoseBones`/`writePoseKeyframe`/`determinePoseFrameMode` 跨任务引用与产出定义处一致;`poseSession` 新 API 名(set/get/usePoseSessionFrame)在 Task 11 内自洽。

**已知留白(有意)**:轨道读取/getPointerParts 的真实对象行为、studio UI 根的 DOM 标识、useFrame 与 mixer 的逐帧次序——三处无法在 jsdom 单测钉死,已在对应任务标注「冒烟验证」,进下方清单。

## 手工冒烟清单(交付时逐项过;8082/3000 是用户进程,只给清单不动手)

1. 摆姿势写两帧(站→坐),拖播放头看平滑混合;右键帧调贝塞尔手柄看缓动变化。
2. 帧上进入摆姿势 → 调整 → Esc → 该帧被覆盖(帧数不变);**画布焦点 Ctrl+Z → 帧数据与画面同时回原**;重做恢复覆盖。
3. 帧间进入 → 以混合姿势为底 → Esc → 新建一帧;撤销后该帧消失;首次打帧两步撤销后轨道消失。
4. 库姿势应用:无轨道时写静态(面板状态行变「库:X」,无轨道出现);打帧后移动播放头再应用 → 第二帧(库引用)入轨;两帧间混合正常。
5. 多端:对端库缺该姿势条目 → 回绑定 + console 告警;custom 帧对端照放。
6. 旧工程(含 poseOverride/pose 旧值)打开自动迁移:姿势照旧、面板状态行正确、override 字段已清;撤销可回退迁移。
7. 姿势轨道与动作片段并存:播放时姿势逐骨压过动作;「清除姿势」后动作恢复,撤销后轨道与帧复原。
8. 同步:另一窗口看到同样的轨道与帧;重载后姿势如初;输入框内 Ctrl+Z 不触发场景撤销。
