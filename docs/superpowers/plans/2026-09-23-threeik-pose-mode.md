# threeIK 姿势模式实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 `@dreamerbird/threeik`,让 camera playground 的人形模型可以通过 IK 控制点交互摆姿势,摆完内联持久化到 theatre 场景状态。

**Architecture:** 新建 `packages/playground/src/shared/camera/poseMode/` 模块:会话状态(poseSession)+ 骨名映射(controlSpec)+ 运行时组件(PoseModeRig)+ 持久化帮手(poseOverride)。App 集中持有会话;PlacedModelCore 在会话命中时挂 PoseModeRig;退出时捕获骨骼写进新 theatre 属性 `poseOverride`(优先级:poseOverride > 库姿势 > 绑定姿势)。

**Tech Stack:** three.js ^0.185.1、@dreamerbird/threeik 0.0.1(npm 钉版)、react-three-fiber(frameloop="demand")、theatre studio(sheet object props)、jest + jest-esbuild(从仓库根跑)、Playwright MCP(浏览器实测)。

**Spec:** `docs/superpowers/specs/2026-09-23-threeik-pose-mode-design.md`

## Global Constraints

- 依赖钉版:`@dreamerbird/threeik` 精确 `0.0.1`,加在 `packages/playground/package.json` 的 dependencies。
- jest 必须从**仓库根**跑:`cd /Users/huhui/Projects/theatre && npx jest packages/playground/<path>`(在 packages/playground 里跑 npx jest 没有配置,会用 babel 解析 TS 报错)。
- 提交信息用中文 conventional commits(如 `feat(playground): ...`),结尾带 `Co-Authored-By: Claude Code <noreply@anthropic.com>`;pre-commit 钩子会跑 lint-staged(prettier + eslint),不要留 eslint-disable 引用本包没有的规则。
- threeIK 导入面:核心 `from '@dreamerbird/threeik'`(SkeletonRig、suggestBoneMap、REQUIRED_HUMANOID_BONES);控制点 `from '@dreamerbird/threeik/controls'`(createSkeletonControls、类型 ControlPointSpec/ManipulatorMode/DragControl)。
- i18n 文案双语都加(en 块约 L45-55、zh 块约 L150-160,`packages/playground/src/shared/camera/i18n.ts`)。
- 姿势模式只在**序列未播放**时求解;播放开始 = 自动提交退出。

---

### Task 1: 依赖引入 + poseSession 会话状态模块

**Files:**
- Modify: `packages/playground/package.json`(dependencies 加一行)
- Create: `packages/playground/src/shared/camera/poseMode/poseSession.ts`
- Test: `packages/playground/src/shared/camera/poseMode/poseSession.test.ts`

**Interfaces:**
- Produces(后续任务全部依赖这些名字):
  - `getPoseSession(): {key: string} | null`
  - `enterPoseSession(key: string): void` — 已有别的会话时先走退出流程再开新的(会话唯一)
  - `requestPoseExit(): void` — 请求退出当前会话(PoseModeRig 的监听负责提交),无会话空操作
  - `clearPoseSession(): void` — PoseModeRig 提交完/被卸载时调用
  - `onPoseSessionChange(cb: (s: {key: string} | null) => void): () => void`
  - `onPoseExitRequested(cb: (key: string) => void): () => void`
  - `usePoseSessionKey(): string | null` — React hook(useState + useEffect 订阅)
  - `noteModelDoubleClick(timeStamp: number): void` / `isModelDoubleClick(timeStamp: number): boolean` — 双击空白判定用
  - `setPoseHitTester(fn: ((ev: {clientX: number; clientY: number}) => boolean) | null): void` / `poseHitTest(ev): boolean` — PoseModeRig 注册命中测试(控制球/被摆模型),App 双击判定用

- [ ] **Step 1: 加依赖并安装**

`packages/playground/package.json` 的 dependencies 里加(按字母序插在合适位置):

```json
"@dreamerbird/threeik": "0.0.1",
```

Run: `cd /Users/huhui/Projects/theatre && yarn install`
Expected: 锁文件更新,无报错。验证:`node -e "require.resolve('@dreamerbird/threeik/package.json')"` 或 `ls node_modules/@dreamerbird/threeik/dist/index.js` 存在。

- [ ] **Step 2: 写失败测试**

```ts
// packages/playground/src/shared/camera/poseMode/poseSession.test.ts
import {
  enterPoseSession,
  getPoseSession,
  clearPoseSession,
  requestPoseExit,
  onPoseSessionChange,
  onPoseExitRequested,
  noteModelDoubleClick,
  isModelDoubleClick,
  setPoseHitTester,
  poseHitTest,
} from './poseSession'

beforeEach(() => {
  clearPoseSession()
  setPoseHitTester(null)
})

test('进入会话后 getPoseSession 返回该模型;清空后回到 null', () => {
  expect(getPoseSession()).toBeNull()
  enterPoseSession('m1')
  expect(getPoseSession()).toEqual({key: 'm1'})
  clearPoseSession()
  expect(getPoseSession()).toBeNull()
})

test('会话唯一:已进入 A 再进入 B,先对 A 发退出请求再切到 B', () => {
  const exited: string[] = []
  onPoseExitRequested((key) => {
    exited.push(key)
    clearPoseSession() // 仿 PoseModeRig:提交后清会话
  })
  enterPoseSession('A')
  enterPoseSession('B')
  expect(exited).toEqual(['A'])
  expect(getPoseSession()).toEqual({key: 'B'})
})

test('重复进入同一会话是空操作,不发退出请求', () => {
  const exited: string[] = []
  onPoseExitRequested((key) => exited.push(key))
  enterPoseSession('A')
  enterPoseSession('A')
  expect(exited).toEqual([])
  expect(getPoseSession()).toEqual({key: 'A'})
})

test('requestPoseExit 通知监听者;监听者没清会话时兜底清掉', () => {
  const exited: string[] = []
  enterPoseSession('A')
  const off = onPoseExitRequested((key) => exited.push(key))
  requestPoseExit()
  expect(exited).toEqual(['A'])
  expect(getPoseSession()).toBeNull() // 监听者没调 clear,模块兜底
  off()
})

test('无会话时 requestPoseExit 空操作', () => {
  const exited: string[] = []
  onPoseExitRequested((key) => exited.push(key))
  requestPoseExit()
  expect(exited).toEqual([])
})

test('onPoseSessionChange 订阅进出', () => {
  const seen: Array<{key: string} | null> = []
  onPoseSessionChange((s) => seen.push(s))
  enterPoseSession('A')
  clearPoseSession()
  expect(seen).toEqual([{key: 'A'}, null])
})

test('双击判定:记录模型的双击 timeStamp 后判定命中', () => {
  expect(isModelDoubleClick(111)).toBe(false)
  noteModelDoubleClick(111)
  expect(isModelDoubleClick(111)).toBe(true)
  expect(isModelDoubleClick(222)).toBe(false)
})

test('命中测试:注册后代理调用,null 时恒 false', () => {
  expect(poseHitTest({clientX: 1, clientY: 2})).toBe(false)
  setPoseHitTester(() => true)
  expect(poseHitTest({clientX: 1, clientY: 2})).toBe(true)
  setPoseHitTester(null)
  expect(poseHitTest({clientX: 1, clientY: 2})).toBe(false)
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/huhui/Projects/theatre && npx jest packages/playground/src/shared/camera/poseMode/poseSession.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 4: 实现 poseSession.ts**

```ts
// packages/playground/src/shared/camera/poseMode/poseSession.ts
/**
 * 姿势会话:哪个模型正在摆姿势(placementKey),全局唯一。
 * App 管进入/退出的触发;PoseModeRig 订阅退出请求,负责提交骨骼写回。
 * 双击空白退出的判定需要两处共享状态:模型双击的 timeStamp 去重、
 * PoseModeRig 注册的命中测试(控制球/被摆模型不算空白)。
 */
import {useEffect, useState} from 'react'

export type PoseSession = {key: string}

let session: PoseSession | null = null
const changeListeners = new Set<(s: PoseSession | null) => void>()
const exitListeners = new Set<(key: string) => void>()

export function getPoseSession(): PoseSession | null {
  return session
}

export function onPoseSessionChange(
  cb: (s: PoseSession | null) => void,
): () => void {
  changeListeners.add(cb)
  return () => {
    changeListeners.delete(cb)
  }
}

/** PoseModeRig 订阅:外部请求退出时回调(提交 + clearPoseSession) */
export function onPoseExitRequested(cb: (key: string) => void): () => void {
  exitListeners.add(cb)
  return () => {
    exitListeners.delete(cb)
  }
}

function emitChange() {
  for (const cb of changeListeners) cb(session)
}

/** 请求退出当前会话;监听者没清会话时兜底清掉,防状态卡死 */
export function requestPoseExit(): void {
  if (!session) return
  for (const cb of exitListeners) cb(session.key)
  if (session) clearPoseSession()
}

/** 会话唯一:已在摆别的模型时,先按退出流程提交旧会话再开新的 */
export function enterPoseSession(key: string): void {
  if (session?.key === key) return
  if (session) requestPoseExit()
  session = {key}
  emitChange()
}

export function clearPoseSession(): void {
  if (!session) return
  session = null
  emitChange()
}

/** React 订阅hook:会话命中的 placementKey,无会话为 null */
export function usePoseSessionKey(): string | null {
  const [key, setKey] = useState<string | null>(getPoseSession()?.key ?? null)
  useEffect(() => onPoseSessionChange((s) => setKey(s?.key ?? null)), [])
  return key
}

// —— 双击空白退出判定的共享状态 ——

let lastModelDblClickAt = -1

/** 模型的 onDoubleClick 第一件事就是记录 timeStamp:落在模型上的双击不算空白 */
export function noteModelDoubleClick(timeStamp: number): void {
  lastModelDblClickAt = timeStamp
}

export function isModelDoubleClick(timeStamp: number): boolean {
  return timeStamp === lastModelDblClickAt
}

let hitTester: ((ev: {clientX: number; clientY: number}) => boolean) | null =
  null

/** PoseModeRig 注册/注销命中测试(被摆模型 + 控制球) */
export function setPoseHitTester(
  fn: ((ev: {clientX: number; clientY: number}) => boolean) | null,
): void {
  hitTester = fn
}

export function poseHitTest(ev: {clientX: number; clientY: number}): boolean {
  return hitTester?.(ev) ?? false
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/huhui/Projects/theatre && npx jest packages/playground/src/shared/camera/poseMode/poseSession.test.ts`
Expected: 8/8 PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/huhui/Projects/theatre
git add packages/playground/package.json yarn.lock packages/playground/src/shared/camera/poseMode/
git commit -m "feat(playground): 姿势会话状态模块 + 引入 @dreamerbird/threeik 依赖

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: poseOverride 属性与优先级

**Files:**
- Create: `packages/playground/src/shared/camera/poseMode/poseOverride.ts`
- Test: `packages/playground/src/shared/camera/poseMode/poseOverride.test.ts`
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`(PlacedModelCore 的 additionalProps L1060-1071、姿势应用 L1262-1277)
- Modify: `packages/playground/src/shared/camera/App.tsx`(applyPose L1384-1395 清 override)
- Modify: `packages/playground/src/shared/camera/i18n.ts`(加 `pg.props.poseOverride`)

**Interfaces:**
- Consumes: `PoseEntry['bones']`(`packages/playground/src/shared/camera/assetLibrary/types.ts`);`translate`(`./i18n`);`types as t`、`getStudioSync`(`@dreamerbird/core`,PlacementManager L2 已有 import)
- Produces:
  - `stringifyPoseOverride(bones: PoseEntry['bones']): string`
  - `parsePoseOverride(json: string): PoseEntry['bones'] | null`(空串/坏 JSON → null,警告一次)
  - `effectivePoseBones(overrideJson: string, poseBones: PoseEntry['bones'] | null, bindPose: PoseEntry['bones']): PoseEntry['bones']`

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/poseMode/poseOverride.test.ts
import {
  effectivePoseBones,
  parsePoseOverride,
  stringifyPoseOverride,
} from './poseOverride'
import type {PoseEntry} from '../assetLibrary/types'

const bonesA: PoseEntry['bones'] = {
  Hips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]},
}
const bonesB: PoseEntry['bones'] = {
  Head: {rotation: [0, 0, 0, 1], position: [0, 1.6, 0]},
}
const bind: PoseEntry['bones'] = {
  Root: {rotation: [0, 0, 0, 1], position: [0, 0, 0]},
}

test('stringify/parse 往返一致', () => {
  expect(parsePoseOverride(stringifyPoseOverride(bonesA))).toEqual(bonesA)
})

test('空串与坏 JSON 都返回 null', () => {
  expect(parsePoseOverride('')).toBeNull()
  expect(parsePoseOverride('{oops')).toBeNull()
  expect(parsePoseOverride('123')).toBeNull()
})

test('优先级:poseOverride > 库姿势 > 绑定姿势', () => {
  expect(effectivePoseBones('', null, bind)).toBe(bind)
  expect(effectivePoseBones('', bonesB, bind)).toBe(bonesB)
  expect(effectivePoseBones(stringifyPoseOverride(bonesA), bonesB, bind)).toEqual(
    bonesA,
  )
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/huhui/Projects/theatre && npx jest packages/playground/src/shared/camera/poseMode/poseOverride.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现 poseOverride.ts**

```ts
// packages/playground/src/shared/camera/poseMode/poseOverride.ts
/**
 * poseOverride:摆姿势退出时内联写进 theatre 对象的骨骼状态(JSON 字符串)。
 * 优先级高于库姿势 poseId、低于什么都不写的绑定姿势兜底:
 *   effectivePoseBones = poseOverride ?? 库姿势 ?? 绑定姿势
 * 刷新/撤销重做/多端同步都走 theatre 属性通道,无需额外处理。
 */
import type {PoseEntry} from '../assetLibrary/types'

export type PoseBones = PoseEntry['bones']

export function stringifyPoseOverride(bones: PoseBones): string {
  return JSON.stringify(bones)
}

let warned = false

/** 空串/坏 JSON/非对象都回 null(手改坏或同步损坏时回退库姿势,不崩画布) */
export function parsePoseOverride(json: string): PoseBones | null {
  if (!json) return null
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as PoseBones
  } catch {
    if (!warned) {
      warned = true
      console.warn('[poseMode] poseOverride JSON 解析失败,回退到库姿势/绑定姿势')
    }
    return null
  }
}

export function effectivePoseBones(
  overrideJson: string,
  poseBones: PoseBones | null,
  bindPose: PoseBones,
): PoseBones {
  return parsePoseOverride(overrideJson) ?? poseBones ?? bindPose
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/huhui/Projects/theatre && npx jest packages/playground/src/shared/camera/poseMode/poseOverride.test.ts`
Expected: 4/4 PASS

- [ ] **Step 5: PlacedModelCore 接线——声明属性 + 应用优先级**

`packages/playground/src/shared/camera/PlacementManager.tsx`:

a) import 区(L35 附近,`applyPose, captureBindPose` 那行下面)加:

```ts
import {effectivePoseBones} from './poseMode/poseOverride'
```

b) PlacedModelCore 的 additionalProps useMemo(L1060-1071)加一项:

```ts
const additionalProps = useMemo(() => {
  const modelEntryId =
    sourceType === 'library' ? entry.libraryEntryId : undefined
  const props: Record<string, any> = {
    animation: literalConfigFor('animation', modelEntryId),
    pose: literalConfigFor('pose', modelEntryId),
    // 摆姿势的内联产物(JSON 字符串);label 函数形式,i18n 热切换对齐既有写法
    poseOverride: t.string('', {
      label: () => translate('pg.props.poseOverride'),
    }),
  }
  if (sourceType === 'local' && entry.assetId) {
    props.source = fileConfigFor(entry.assetId)
  }
  return props
}, [sourceType, entry.assetId, entry.libraryEntryId])
```

(`translate` 已在 i18n 用法里——确认 PlacementManager 顶部有 `import {translate} from './i18n'`;没有就加上。)

c) poseId 那行(L1131)下面加 override 读取:

```ts
const poseOverrideJson = useVal(sheetObject?.props.poseOverride) ?? ''
```

d) 两条应用 effect(L1262-1277)改用优先级帮手:

```ts
useEffect(() => {
  return onChange(sheet.sequence.pointer.playing, (playing) => {
    if (playing) {
      invalidate()
    } else {
      applyPose(
        instance,
        effectivePoseBones(poseOverrideJson, poseBones, bindPoseRef.current),
      )
      invalidate()
    }
  })
}, [sheet, invalidate, instance, poseBones, poseOverrideJson])
// pose 数据变化且当前未播放时立即应用,覆盖 poseId 切换与撤销/重做路径
useEffect(() => {
  if (val(sheet.sequence.pointer.playing)) return
  applyPose(
    instance,
    effectivePoseBones(poseOverrideJson, poseBones, bindPoseRef.current),
  )
  invalidate()
}, [instance, poseBones, poseOverrideJson, invalidate, sheet])
```

- [ ] **Step 6: App 的 applyPose(「改变姿势」)清掉 override**

`packages/playground/src/shared/camera/App.tsx` L1384-1395:

```ts
const applyPose = useCallback(
  (poseEntry: PoseEntry) => {
    const studio = getStudioSync()
    if (!studio || !selectedPlacement) return
    const scrub = studio.scrub()
    scrub.capture(({set}) => {
      set(selectedPlacement.props.pose, poseEntry.id)
      // 应用库姿势 = 明确覆盖手工摆的,清掉内联 override
      set(selectedPlacement.props.poseOverride as any, '')
    })
    scrub.commit()
  },
  [selectedPlacement],
)
```

- [ ] **Step 7: i18n 文案**

`packages/playground/src/shared/camera/i18n.ts`:
- en 块 `'pg.props.pose': 'Pose',` 后面加:`'pg.props.poseOverride': 'Pose override',`
- zh 块 `'pg.props.pose': '姿势',` 后面加:`'pg.props.poseOverride': '姿势覆盖',`

- [ ] **Step 8: 验证**

Run: `cd /Users/huhui/Projects/theatre && npx jest packages/playground/src/shared/camera && cd packages/playground && yarn typecheck`
Expected: 测试全绿(本任务新测 4 条 + 既有不破),tsc 无错。

- [ ] **Step 9: Commit**

```bash
cd /Users/huhui/Projects/theatre
git add packages/playground/src/shared/camera/poseMode/poseOverride.ts \
        packages/playground/src/shared/camera/poseMode/poseOverride.test.ts \
        packages/playground/src/shared/camera/PlacementManager.tsx \
        packages/playground/src/shared/camera/App.tsx \
        packages/playground/src/shared/camera/i18n.ts
git commit -m "feat(playground): 放置模型新增 poseOverride 属性——摆姿势的内联持久化

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: controlSpec 骨名映射与控制点装配表

**Files:**
- Create: `packages/playground/src/shared/camera/poseMode/controlSpec.ts`
- Test: `packages/playground/src/shared/camera/poseMode/controlSpec.test.ts`

**Interfaces:**
- Consumes: `collectBoneNames`(`../assetLibrary/rig`,已导出);`suggestBoneMap`、`BoneMap`(`@dreamerbird/threeik`);`ControlPointSpec`(`@dreamerbird/threeik/controls`)
- Produces:
  - `resolveControlSpec(root: Object3D, facing?: Vector3): ControlPointSpec[] | null` — null = 无骨骼或关键骨映射不全(不支持摆姿势)
  - `findRootBone(root: Object3D): Bone | null` — 父不是 Bone 的第一根 Bone(PoseModeRig 建 SkeletonRig 用)

装配表(全部用骨名映射后的模型骨名;四肢带 pole 与双旋转通道;顺序即语义:脊柱链 → 胸口环 → 头部注视,深的后解):

```ts
[
  {kind: 'root', name: 'hips', bone: Hips, rotation: true},
  {kind: 'limb', name: 'armL', rootBone, middleBone, endBone, endRotation: true, rootRotation: true, pole: {position: 肘世界位置 - facing*0.25}},
  {kind: 'limb', name: 'armR', ...同上镜像},
  {kind: 'limb', name: 'legL', ..., pole: {position: 膝世界位置 + facing*0.25}},
  {kind: 'limb', name: 'legR', ...同上镜像},
  {kind: 'chain', name: 'spine', rootBone: Spine, endBone: Neck ?? Head},
  {kind: 'bone', name: 'chest', bone: UpperChest ?? Chest ?? Spine},   // Chest/UpperChest 都缺时退回 Spine
  {kind: 'lookAt', name: 'head', rootBone: Neck, endBone: Head},      // 仅当有 Neck
]
```

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/poseMode/controlSpec.test.ts
import {Bone, Group, Vector3} from 'three'
import {findRootBone, resolveControlSpec} from './controlSpec'

/** 按 Mixamo 命名习惯拼一棵骨架(平面树即可:映射只看骨名) */
function skeletonWith(names: string[]): Group {
  const root = new Group()
  for (const n of names) {
    const b = new Bone()
    b.name = n
    root.add(b)
  }
  return root
}

const MIXAMO_REQUIRED = [
  'mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2',
  'mixamorig:Neck', 'mixamorig:Head',
  'mixamorig:LeftShoulder', 'mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand',
  'mixamorig:RightShoulder', 'mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand',
  'mixamorig:LeftUpLeg', 'mixamorig:LeftLeg', 'mixamorig:LeftFoot',
  'mixamorig:RightUpLeg', 'mixamorig:RightLeg', 'mixamorig:RightFoot',
]

test('Mixamo 全骨 → 完整控制点表,骨名用模型侧名字', () => {
  const spec = resolveControlSpec(skeletonWith(MIXAMO_REQUIRED))
  expect(spec).not.toBeNull()
  const byName = new Map(spec!.map((c) => [c.name, c]))
  expect([...byName.keys()].sort()).toEqual(
    ['armL', 'armR', 'chest', 'head', 'hips', 'legL', 'legR', 'spine'].sort(),
  )
  expect((byName.get('hips') as any).bone).toBe('mixamorig:Hips')
  expect((byName.get('armL') as any).rootBone).toBe('mixamorig:LeftArm')
  expect((byName.get('armL') as any).endBone).toBe('mixamorig:LeftHand')
  expect((byName.get('spine') as any).endBone).toBe('mixamorig:Neck')
  expect((byName.get('head') as any).rootBone).toBe('mixamorig:Neck')
})

test('缺关键骨(LeftHand)→ null', () => {
  const names = MIXAMO_REQUIRED.filter((n) => n !== 'mixamorig:LeftHand')
  expect(resolveControlSpec(skeletonWith(names))).toBeNull()
})

test('无前缀 Mixamo 命名(ReadyPlayerMe 风格)→ 可解析', () => {
  const names = MIXAMO_REQUIRED.map((n) => n.replace('mixamorig:', ''))
  const spec = resolveControlSpec(skeletonWith(names))
  expect(spec).not.toBeNull()
  expect((spec!.find((c) => c.name === 'hips') as any).bone).toBe('Hips')
})

test('VRM camelCase 命名 → 可解析', () => {
  const names = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  ]
  const spec = resolveControlSpec(skeletonWith(names))
  expect(spec).not.toBeNull()
  expect((spec!.find((c) => c.name === 'hips') as any).bone).toBe('hips')
})

test('无骨骼 → null;findRootBone 找父不是 Bone 的第一根', () => {
  expect(resolveControlSpec(new Group())).toBeNull()
  expect(findRootBone(new Group())).toBeNull()
  const root = new Group()
  const hips = new Bone()
  hips.name = 'Hips'
  const spine = new Bone()
  spine.name = 'Spine'
  hips.add(spine)
  root.add(hips)
  expect(findRootBone(root)?.name).toBe('Hips')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/huhui/Projects/theatre && npx jest packages/playground/src/shared/camera/poseMode/controlSpec.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现 controlSpec.ts**

```ts
// packages/playground/src/shared/camera/poseMode/controlSpec.ts
/**
 * 人形骨架控制点装配表:用 threeIK 的骨名映射(Mixamo/VRM/无前缀预设)
 * 把模型骨名翻成人形 profile,产出标准控制点集合。关键骨(REQUIRED_HUMANOID_
 * BONES:髋/脊柱/头/肩/四肢)缺任一 → null = 不支持摆姿势(菜单置灰、双击静默)。
 */
import {Bone, Vector3} from 'three'
import type {Object3D} from 'three'
import {suggestBoneMap} from '@dreamerbird/threeik'
import type {ControlPointSpec} from '@dreamerbird/threeik/controls'
import {collectBoneNames} from '../assetLibrary/rig'

/** 父不是 Bone 的第一根 Bone = 骨架根(SkeletonRig 的构造参数) */
export function findRootBone(root: Object3D): Bone | null {
  let found: Bone | null = null
  root.traverse((o) => {
    if (found) return
    const asBone = o as Bone
    if (asBone.isBone && !(o.parent as Bone | null)?.isBone) found = asBone
  })
  return found
}

export function resolveControlSpec(
  root: Object3D,
  facing: Vector3 = new Vector3(0, 0, -1),
): ControlPointSpec[] | null {
  const names = collectBoneNames(root)
  if (names.length === 0) return null
  const {map, coverage} = suggestBoneMap(names)
  if (coverage < 1) return null // coverage 只算关键骨;1 = 关键骨全映射

  const bone = (profile: string): string => map.findModelBone(profile)!
  const optional = (profile: string): string | null =>
    map.findModelBone(profile)

  // 肘/膝 pole 初始方向提示(世界坐标):肘朝后、膝朝前。世界矩阵先刷新,
  // 保证菜单场景外(测试/刚进会话)也能取到正确位置。
  root.updateWorldMatrix(true, true)
  const worldPosOf = (name: string): Vector3 => {
    const obj = root.getObjectByName(name)!
    return obj.getWorldPosition(new Vector3())
  }
  const behind = facing.clone().normalize().multiplyScalar(-0.25)
  const ahead = facing.clone().normalize().multiplyScalar(0.25)

  const armL = [bone('LeftUpperArm'), bone('LeftLowerArm'), bone('LeftHand')]
  const armR = [bone('RightUpperArm'), bone('RightLowerArm'), bone('RightHand')]
  const legL = [bone('LeftUpperLeg'), bone('LeftLowerLeg'), bone('LeftFoot')]
  const legR = [bone('RightUpperLeg'), bone('RightLowerLeg'), bone('RightFoot')]
  const neck = optional('Neck')
  const chest = optional('UpperChest') ?? optional('Chest') ?? bone('Spine')

  const limb = (
    name: string,
    [rootBone, middleBone, endBone]: string[],
    poleOffset: Vector3,
  ): ControlPointSpec => ({
    kind: 'limb',
    name,
    rootBone,
    middleBone,
    endBone,
    endRotation: true,
    rootRotation: true,
    pole: {position: worldPosOf(middleBone).add(poleOffset)},
  })

  return [
    {kind: 'root', name: 'hips', bone: bone('Hips'), rotation: true},
    limb('armL', armL, behind),
    limb('armR', armR, behind),
    limb('legL', legL, ahead),
    limb('legR', legR, ahead),
    // 排序即语义:脊柱链先解,胸口环在弯腰之上拧上半身,头部注视最后重新瞄准
    {kind: 'chain', name: 'spine', rootBone: bone('Spine'), endBone: neck ?? bone('Head')},
    {kind: 'bone', name: 'chest', bone: chest},
    ...(neck
      ? [{kind: 'lookAt', name: 'head', rootBone: neck, endBone: bone('Head')} as ControlPointSpec]
      : []),
  ]
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/huhui/Projects/theatre && npx jest packages/playground/src/shared/camera/poseMode/controlSpec.test.ts`
Expected: 5/5 PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/huhui/Projects/theatre
git add packages/playground/src/shared/camera/poseMode/controlSpec.ts packages/playground/src/shared/camera/poseMode/controlSpec.test.ts
git commit -m "feat(playground): 人形骨架控制点装配表——threeIK 骨名映射,缺关键骨判不支持

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: PoseModeRig——threeIK 运行时组件

**Files:**
- Create: `packages/playground/src/shared/camera/poseMode/PoseModeRig.tsx`
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`(PlacedModelCore 挂载点,JSX L1315-1328 区域)

**Interfaces:**
- Consumes: Task 1 的 `clearPoseSession/onPoseExitRequested/setPoseHitTester/usePoseSessionKey`;Task 3 的 `resolveControlSpec/findRootBone`;`capturePose`(`../assetLibrary/pose`);Task 2 的 `stringifyPoseOverride`;`getStudioSync`、`val`(`@dreamerbird/core`)
- Produces: `PoseModeRig({instance, sheetObject, placementKey, sheet}: {...}): null`(React 组件,PlacedModelCore 挂载)

本任务没有 jest 测试(three.js 渲染/DOM 指针事件重,纯逻辑已抽去 Task 1-3);验证靠 typecheck + Task 7 浏览器实测。

- [ ] **Step 1: 实现 PoseModeRig.tsx**

```tsx
// packages/playground/src/shared/camera/poseMode/PoseModeRig.tsx
/**
 * 姿势模式运行时:SkeletonRig + threeIK 控制点的生命周期、每帧求解、退出提交。
 * 会话命中时由 PlacedModelCore 挂载;卸载(模型删除/会话切换)即 dispose 干净。
 *
 * 帧更新契约(threeIK README):基准姿势在进入时 captureBasePose 一次
 * (= 当前姿势,含 poseOverride/库姿势/绑定姿势;不接 mixer 时无需每帧采),
 * 之后每帧 rig.update + ctl.update;demand 帧循环下只在按下指针期间续帧。
 */
import {useEffect, useRef} from 'react'
import {useFrame, useThree} from '@react-three/fiber'
import {getStudioSync, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {Raycaster, Vector2} from 'three'
import type {Group} from 'three'
import {SkeletonRig} from '@dreamerbird/threeik'
import {createSkeletonControls} from '@dreamerbird/threeik/controls'
import {capturePose} from '../assetLibrary/pose'
import {resolveControlSpec, findRootBone} from './controlSpec'
import {stringifyPoseOverride} from './poseOverride'
import {
  clearPoseSession,
  onPoseExitRequested,
  setPoseHitTester,
} from './poseSession'

export function PoseModeRig({
  instance,
  sheetObject,
  placementKey,
  sheet,
}: {
  instance: Group
  sheetObject: ISheetObject<any>
  placementKey: string
  sheet: ISheet
}): null {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  // drei makeDefault 的轨道控制器:拖控制球期间锁住,防视角跟转
  const orbitControls = useThree((s) => s.controls) as unknown as {
    enabled: boolean
  } | null
  const invalidate = useThree((s) => s.invalidate)
  const rigRef = useRef<SkeletonRig | null>(null)
  const ctlRef = useRef<ReturnType<typeof createSkeletonControls> | null>(null)
  const pressingRef = useRef(false)

  useEffect(() => {
    const rootBone = findRootBone(instance)
    const spec = resolveControlSpec(instance)
    if (!rootBone || !spec) {
      // 入口已拦(菜单置灰/双击静默),这里是防御:直接清会话不挂载
      clearPoseSession()
      return
    }
    const rig = new SkeletonRig(rootBone)
    rigRef.current = rig
    rig.on('warning', (payload) =>
      console.warn('[poseMode]', (payload as {message?: string})?.message),
    )
    // 基准 = 当前姿势:没被控制点覆盖的骨骼保持原样,不弹回绑定姿势
    rig.captureBasePose()
    const ctl = createSkeletonControls({
      rig,
      scene,
      camera,
      dom: gl.domElement,
      controls: spec,
      // Esc 留给 App 退出会话,这里禁用 threeIK 的 Esc 取消选中
      hotkeys: {move: ['w'], rotate: ['e'], deselect: []},
      dragControl: {
        lock: () => {
          if (orbitControls) orbitControls.enabled = false
        },
        unlock: () => {
          if (orbitControls) orbitControls.enabled = true
        },
      },
      onManipulatorModeChange: () => invalidate(),
    })
    ctlRef.current = ctl

    // 双击空白退出的命中测试:点在被摆模型或控制球上不算空白
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    setPoseHitTester(({clientX, clientY}) => {
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      )
      raycaster.setFromCamera(ndc, camera)
      const balls = ctl.targets.map((t) => t.ball)
      return raycaster.intersectObjects([instance, ...balls], true).length > 0
    })

    // 退出提交:捕获实时骨骼 → 一步 theatre 历史写 poseOverride(可撤销)
    const offExit = onPoseExitRequested((key) => {
      if (key !== placementKey) return
      const studio = getStudioSync()
      if (studio) {
        const bones = capturePose(instance)
        const scrub = studio.scrub()
        scrub.capture(({set}) => {
          set(
            sheetObject.props.poseOverride as any,
            stringifyPoseOverride(bones),
          )
        })
        scrub.commit()
      }
      clearPoseSession()
    })

    invalidate() // 进姿势模式首帧:控制球立刻可见
    return () => {
      offExit()
      setPoseHitTester(null)
      ctl.dispose()
      ctlRef.current = null
      rigRef.current = null
      // 会话外因素卸载(模型被删等):实例已毁,跳过提交只清会话态
      clearPoseSession()
      invalidate()
    }
  }, [instance, sheetObject, placementKey, scene, camera, gl, orbitControls, invalidate])

  // demand 帧循环:按下指针期间逐帧求解+续帧,松开即停
  useEffect(() => {
    const dom = gl.domElement
    const down = () => {
      pressingRef.current = true
      invalidate()
    }
    const up = () => {
      pressingRef.current = false
      invalidate() // 松手补一帧:钳制回弹落定
    }
    dom.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    return () => {
      dom.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
    }
  }, [gl, invalidate])

  useFrame((_, delta) => {
    const rig = rigRef.current
    const ctl = ctlRef.current
    if (!rig || !ctl) return
    if (val(sheet.sequence.pointer.playing)) return // 播放时 mixer 写骨骼,不抢
    rig.update(delta)
    ctl.update()
    if (pressingRef.current) invalidate()
  })

  return null
}
```

- [ ] **Step 2: PlacedModelCore 挂载**

`packages/playground/src/shared/camera/PlacementManager.tsx`:

a) import 加:

```ts
import {PoseModeRig} from './poseMode/PoseModeRig'
import {usePoseSessionKey} from './poseMode/poseSession'
```

b) PlacedModelCore 里(`const poseOverrideJson = ...` 附近)加订阅:

```ts
const poseSessionKey = usePoseSessionKey()
```

c) JSX(L1315-1328 的 `<e.group>` 内,`<primitive>` 之后)加:

```tsx
{sheetObject && poseSessionKey === entry.key && (
  <PoseModeRig
    instance={instance}
    sheetObject={sheetObject}
    placementKey={entry.key}
    sheet={sheet}
  />
)}
```

- [ ] **Step 3: 验证**

Run: `cd /Users/huhui/Projects/theatre/packages/playground && yarn typecheck && cd /Users/huhui/Projects/theatre && npx jest packages/playground/src/shared/camera`
Expected: tsc 无错;既有测试全绿。

- [ ] **Step 4: Commit**

```bash
cd /Users/huhui/Projects/theatre
git add packages/playground/src/shared/camera/poseMode/PoseModeRig.tsx packages/playground/src/shared/camera/PlacementManager.tsx
git commit -m "feat(playground): PoseModeRig——threeIK 控制点运行时,退出提交写 poseOverride

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 进入/退出接线(菜单 + 双击 + Esc/双击空白/播放)

**Files:**
- Modify: `packages/playground/src/shared/camera/menuModel.ts`(buildObjectMenuItems L77-119 加 onPoseMode)
- Test: `packages/playground/src/shared/camera/menuModel.test.ts`(追加用例)
- Modify: `packages/playground/src/shared/camera/App.tsx`(菜单 call site L1622-1643、Esc/双击/播放三个 effect)
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`(PlacedModelCore 的 onDoubleClick,openMenu L1103 附近)
- Modify: `packages/playground/src/shared/camera/i18n.ts`(菜单文案)

**Interfaces:**
- Consumes: Task 1 的 `enterPoseSession/requestPoseExit/getPoseSession/noteModelDoubleClick/isModelDoubleClick/poseHitTest/usePoseSessionKey`;Task 3 的 `resolveControlSpec`;`collectBoneNames`(`./assetLibrary/rig`);`getPlacementInstanceForObject`/`getPlacementEntryForObject`(PlacementManager 已导出)
- Produces: buildObjectMenuItems opts 新增 `onPoseMode?: () => void`、`poseModeEnabled?: boolean`、`poseModeHint?: string`

- [ ] **Step 1: menuModel 失败测试(追加到 menuModel.test.ts)**

```ts
test('摆姿势菜单项:提供 onPoseMode 时排在最前,可点击', () => {
  const onPoseMode = jest.fn()
  const items = buildObjectMenuItems({
    mode: 'select',
    onSelectMode: jest.fn(),
    onDelete: jest.fn(),
    onPoseMode,
  })
  expect(String((items[0] as any).label)).toContain('摆姿势')
  ;(items[0] as any).callback?.({} as any)
  expect(onPoseMode).toHaveBeenCalled()
})

test('摆姿势菜单项:poseModeEnabled=false 时置灰且不可点', () => {
  const onPoseMode = jest.fn()
  const items = buildObjectMenuItems({
    mode: 'select',
    onSelectMode: jest.fn(),
    onDelete: jest.fn(),
    onPoseMode,
    poseModeEnabled: false,
    poseModeHint: '骨架不支持摆姿势',
  })
  expect((items[0] as any).enabled).toBe(false)
  expect((items[0] as any).callback).toBeUndefined()
  expect(String((items[0] as any).label)).toContain('骨架不支持摆姿势')
})

test('摆姿势菜单项:与改变姿势共存时摆姿势在前', () => {
  const items = buildObjectMenuItems({
    mode: 'select',
    onSelectMode: jest.fn(),
    onDelete: jest.fn(),
    onPoseMode: jest.fn(),
    onChangePose: jest.fn(),
  })
  expect(String((items[0] as any).label)).toContain('摆姿势')
  expect(String((items[1] as any).label)).toContain('改变姿势')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/huhui/Projects/theatre && npx jest packages/playground/src/shared/camera/menuModel.test.ts`
Expected: FAIL(没有 onPoseMode 支持)

- [ ] **Step 3: menuModel.ts 实现**

`buildObjectMenuItems` 的 opts 类型加三个字段,applyItems 构建处改为:

```ts
const applyItems: ContextMenuItem[] = []
if (opts.onPoseMode) {
  const enabled = opts.poseModeEnabled !== false
  applyItems.push({
    type: 'normal',
    // 置灰时把原因拼进 label(ContextMenuItem 没有 tooltip 字段)
    label: enabled
      ? t('pg.menu.poseMode')
      : `${t('pg.menu.poseMode')}(${opts.poseModeHint ?? ''})`,
    enabled,
    callback: enabled ? opts.onPoseMode : undefined,
  } as ContextMenuItem)
}
if (opts.onChangePose) { /* 既有不动 */ }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/huhui/Projects/theatre && npx jest packages/playground/src/shared/camera/menuModel.test.ts`
Expected: 全绿(新增 3 条 + 既有不破)

- [ ] **Step 5: i18n 文案**

`i18n.ts`:en 块加 `'pg.menu.poseMode': 'Pose interactively'`、`'pg.menu.poseModeUnsupported': 'skeleton not supported'`;zh 块加 `'pg.menu.poseMode': '摆姿势'`、`'pg.menu.poseModeUnsupported': '骨架不支持摆姿势'`。(各自放在 `'pg.menu.changePose'` 前一行。)

- [ ] **Step 6: App 菜单 call site 接线**

App.tsx import 区加:

```ts
import {resolveControlSpec} from './poseMode/controlSpec'
import {
  enterPoseSession,
  getPoseSession,
  isModelDoubleClick,
  noteModelDoubleClick,
  poseHitTest,
  requestPoseExit,
  usePoseSessionKey,
} from './poseMode/poseSession'
import {collectBoneNames} from './assetLibrary/rig'
```

(`getPlacementInstanceForObject` 已在 PlacementManager 的 import 列表里,确认即可。)

菜单 call site(L1631-1640 的展开区)加一项,独立于 libraryEntryId 判断(本地人形模型也能摆):

```tsx
// 摆姿势:有骨骼就显示;映射不出人形关键骨的置灰带原因
...(() => {
  const inst = selectedPlacement
    ? getPlacementInstanceForObject(selectedPlacement)
    : undefined
  const entry = selectedPlacement
    ? getPlacementEntryForObject(selectedPlacement)
    : undefined
  if (!inst || !entry || entry.key !== objectMenu.key) return {}
  if (collectBoneNames(inst).length === 0) return {}
  const supported = resolveControlSpec(inst) !== null
  return {
    onPoseMode: () => enterPoseSession(objectMenu.key),
    poseModeEnabled: supported,
    poseModeHint: t('pg.menu.poseModeUnsupported'),
  }
})(),
```

- [ ] **Step 7: App 三个退出 effect**

`const poseSessionKey = usePoseSessionKey()` 加在 App 组件里(`const [gizmoMode, setGizmoMode] = useGizmoMode()` 附近,L921)。

Esc 退出(导出中/镜头视角下让位,对齐既有 Esc effect 的避让):

```ts
// 姿势模式下 Esc 退出(提交);导出中/镜头视角的 Esc 语义优先,不抢
useEffect(() => {
  if (!poseSessionKey || shotView || exporting) return
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') requestPoseExit()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [poseSessionKey, shotView, exporting])
```

双击空白退出(落在模型上的双击由模型自己处理 = 进入/切换;落在控制球/被摆模型上不算空白;只认画布的双击,UI 面板里的双击不退出):

```ts
useEffect(() => {
  if (!poseSessionKey) return
  const onDblClick = (e: MouseEvent) => {
    if (!(e.target instanceof HTMLCanvasElement)) return
    if (isModelDoubleClick(e.timeStamp)) return
    if (poseHitTest(e)) return
    requestPoseExit()
  }
  window.addEventListener('dblclick', onDblClick)
  return () => window.removeEventListener('dblclick', onDblClick)
}, [poseSessionKey])
```

播放自动退出(`onChange` 从 `@dreamerbird/core` 补 import——注意 App L262 有局部同名变量,那个作用域不受影响):

```ts
// 序列开始播放 = mixer 接管骨骼,姿势模式自动提交退出
useEffect(() => {
  return onChange(sheet.sequence.pointer.playing, (playing) => {
    if (playing && getPoseSession()) requestPoseExit()
  })
}, [sheet])
```

- [ ] **Step 8: PlacedModelCore 双击进入**

PlacementManager.tsx import 加 `enterPoseSession, getPoseSession, noteModelDoubleClick`(从 './poseMode/poseSession')和 `resolveControlSpec`(从 './poseMode/controlSpec')。

PlacedModelCore 里 openMenu(L1103)下面加:

```ts
// 双击已选中的人形模型进入姿势模式。第一件事记录 timeStamp:
// App 的"双击空白退出"靠它区分落在模型上的双击。
const enterPoseViaDoubleClick = (event: ThreeEvent<MouseEvent>) => {
  noteModelDoubleClick(event.nativeEvent.timeStamp)
  if (selectLocked || isSelectSuppressed()) return
  const studio = getStudioSync()
  if (!studio || !objRef.current) return
  // 未选中不进:双击的第一击已由 selectSelf 选中,第二击这里自然满足
  if (!studio.selection.includes(objRef.current)) return
  if (!resolveControlSpec(instance)) return // 骨架不支持:静默不进
  event.stopPropagation()
  enterPoseSession(entry.key)
}
```

JSX 的 `<e.group>`(L1316 区域)加属性:`onDoubleClick={enterPoseViaDoubleClick}`

- [ ] **Step 9: 验证**

Run: `cd /Users/huhui/Projects/theatre && npx jest packages/playground/src/shared/camera && cd packages/playground && yarn typecheck`
Expected: 全绿 + tsc 无错。

- [ ] **Step 10: Commit**

```bash
cd /Users/huhui/Projects/theatre
git add packages/playground/src/shared/camera/menuModel.ts packages/playground/src/shared/camera/menuModel.test.ts packages/playground/src/shared/camera/App.tsx packages/playground/src/shared/camera/PlacementManager.tsx packages/playground/src/shared/camera/i18n.ts
git commit -m "feat(playground): 摆姿势入口——右键菜单项 + 双击进入,Esc/双击空白/播放退出

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 共存——手柄抑制、热键分流、点击守卫

**Files:**
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`(SelectionGizmo showControls L1521-1526、useGizmoMode 热键 L1366-1391、G 抓取热键 L1467 区域、PlacedModelCore.selectSelf L1092-1099)
- Modify: `packages/playground/src/shared/camera/App.tsx`(onPointerMissed L1750-1751)

**Interfaces:**
- Consumes: Task 1 的 `getPoseSession/usePoseSessionKey`;`getPlacementEntryForObject`(同模块)
- Produces: 无新接口

无新增 jest 测试(都是组件内行为);既有测试必须全绿,行为由 Task 7 浏览器实测覆盖。

- [ ] **Step 1: SelectionGizmo——被摆模型的三轴手柄不挂,描边保留**

SelectionGizmo 组件里加订阅与判定:

```ts
const poseKey = usePoseSessionKey()
// 姿势模式期间:被摆模型的三轴手柄让位给 threeIK 操纵器(描边保留——只取
// 模型子树,控制点不在其中,互不干扰)
const isPosingTarget =
  !!poseKey &&
  !!target &&
  getPlacementEntryForObject(target.obj)?.key === poseKey
const showControls =
  !hidden &&
  !!target &&
  !!target.node.parent &&
  !grabActive &&
  mode !== 'select' &&
  !isPosingTarget
```

import 加 `usePoseSessionKey`(注意 `getPlacementEntryForObject` 与本组件同文件,直接用)。

- [ ] **Step 2: 热键分流——姿势模式下 W/G/R/S 不切模型手柄模式**

useGizmoMode 的 onKey(L1367)在输入框守卫后加:

```ts
// 姿势模式期间 W/E 归 threeIK 操纵器,G/R/S 不响应
if (getPoseSession()) return
```

import 加 `getPoseSession`。

- [ ] **Step 3: G 模态抓取同样让位**

SelectionGizmo 的 G 键 effect(L1467 区域)onKey 里 `if (ev.code !== 'KeyG') return` 后加:

```ts
if (getPoseSession()) return
```

- [ ] **Step 4: PlacedModelCore.selectSelf——姿势模式下不响应选中切换**

```ts
const selectSelf = (event: ThreeEvent<MouseEvent>) => {
  if (selectLocked || isSelectSuppressed()) return
  // 摆姿势期间单击(自己或别的模型)都不改选中;stopPropagation 保持
  // "点击被模型处理"的语义,onPointerMissed 不会触发
  if (getPoseSession()) {
    event.stopPropagation()
    return
  }
  event.stopPropagation()
  // ... 余下不动
}
```

- [ ] **Step 5: App 的 onPointerMissed——姿势模式下单击空白不取消选中**

App.tsx L1750-1751:

```ts
onPointerMissed={() => {
  if (!placing && !getPoseSession()) getStudioSync()?.setSelection([])
}}
```

- [ ] **Step 6: 验证**

Run: `cd /Users/huhui/Projects/theatre && npx jest packages/playground/src/shared/camera && cd packages/playground && yarn typecheck`
Expected: 全绿 + tsc 无错。

- [ ] **Step 7: Commit**

```bash
cd /Users/huhui/Projects/theatre
git add packages/playground/src/shared/camera/PlacementManager.tsx packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): 姿势模式与选中体系共存——手柄抑制、W/E 分流、点击守卫

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 浏览器实测 + 全量回归

**Files:**
- 无新文件;发现的问题就地修(每个修复自带回归测试,遵循 TDD)

**Interfaces:**
- Consumes: 全部前序任务

- [ ] **Step 1: 全量回归**

Run: `cd /Users/huhui/Projects/theatre && npx jest packages/playground && cd packages/playground && yarn typecheck`
Expected: playground 全套测试绿 + tsc 无错。

- [ ] **Step 2: 起服务 + 打开页面**

Run: `cd /Users/huhui/Projects/theatre/packages/playground && yarn serve`(后台;我的 vite 在 8083 端口)
Playwright 打开 `http://localhost:8083/shared/camera/`(若 sync-server 没起,IDB 播种模型的"加载失败"属环境噪音,不影响姿势模式实测;模型不够就从顶栏加 Y_Bot)。

- [ ] **Step 3: 实测清单(逐条过,每条记录结果)**

1. 右键 Y_Bot → 菜单有「摆姿势」且可点;点它 → 出现控制球(髋/双手/双脚/脊柱/头),模型保持选中描边,三轴手柄消失。
2. 选中 Y_Bot 后双击它 → 同样进入(先在别的模型上试过菜单路径后,Esc 退出再试这条)。
3. 拖手球 → 手臂跟随,肘不反关节;拖脚球 → 腿跟随;拖脊柱端球 → 弯腰;点胸口标记球出环 → 拧上半身;W/E 切换操纵器模式。
4. 拖控制球期间视角不转(dragControl 锁住了轨道)。
5. Esc 退出 → 控制球消失,姿势保持在模型上;三轴手柄恢复(切 G 验证)。
6. 双击空白退出 → 同 5。双击控制球/模型本身不退出。
7. 退出后刷新页面 → 姿势还在(poseOverride 持久化)。
8. Ctrl+Z → 撤销退出那次提交,姿势弹回进入前;Ctrl+Shift+Z / 重做恢复。
9. 姿势面板「保存姿势」→ 能抽当前姿势入库;库面板出现新条目;「改变姿势」应用库姿势后手工 override 被清(再刷新 = 库姿势)。
10. 进入姿势模式后按播放 → 自动退出,动画正常播;暂停/停止后模型回到姿势(库姿势或 override)。
11. 右键 Thingy(静态)→ 无「摆姿势」项。
12. 摆姿势期间:单击空白不取消选中;单击其他模型无响应;右键另一模型选「摆姿势」→ A 提交退出、B 进入。
13. 摆姿势期间删掉被摆模型(右键删除)→ 控制球消失,不崩、无残留控制台错误。

- [ ] **Step 4: 发现问题就地修**

每个 bug:先写失败测试(能抽成纯逻辑的),再修,再验证,单独 commit。修不了的记进 spec 的已知限制并告诉用户。

- [ ] **Step 5: 收尾 commit(如有修复)**

```bash
git commit -m "fix(playground): <具体问题>

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
