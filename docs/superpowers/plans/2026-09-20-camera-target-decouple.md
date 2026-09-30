# 相机与瞄准点解耦 + 骨骼锚点 + 锚点父级绑定 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 相机不再自带瞄准点;"瞄准目标"下拉可选独立锚点或放置模型的骨骼锚点(头/胸口/双手/双腿);独立锚点可由顶栏添加,并支持绑定父级(模型/相机/其他锚点/骨骼锚点),跟随其移动。

**Architecture:** 沿用 playground 既有模式——注册表(隐藏 sheet 对象存 key 清单)+ `t.stringLiteral` 动态选项函数(模块级,读注册表)+ 运行时模块级 Object3D 登记表。锚点父级绑定直接做真实场景树父子(`parentObj.add(mesh)`),theatre 的 position 属性自动获得"相对父级偏移"语义;绑定/解绑/父级消失时把世界坐标换算进属性(画面不跳)。

**Tech Stack:** theatre(@dreamerbird/core/r3f/studio)、three、React、jest(jest-esbuild)、vite。

**Spec:** `docs/superpowers/specs/2026-09-20-camera-target-decouple-design.md`

## Global Constraints

- **jest 必须从仓库根目录跑**(`cd /Users/huhui/Projects/theatre && yarn jest <pattern>`);jest-esbuild 不提升 `jest.mock`,要 mock 必须用 `jest.doMock` + `resetModules` + 运行时 require。
- **TypeScript 检查**:`cd /Users/huhui/Projects/theatre/packages/playground && npx tsc --noEmit; echo TSC_EXIT=$?`,必须看到 `TSC_EXIT=0`。
- 属性 label 一律函数形式 `() => translate('pg.xxx')`;在模块加载期就 translate 的文件必须带副作用导入 `import './i18n'`(本计划涉及文件都已导入)。
- i18n key 一律 `pg.` 前缀,en / zh-CN 两部词典同步增删。
- `t.stringLiteral` 的动态选项函数必须**模块级定义**(sheet.object 重复调用要求配置 deep-equal,函数按引用比);按 key 缓存配置的用 `Map` 缓存(参照 `literalConfigCache`)。
- 提交信息用 `feat(playground):` / `test(playground):` / `refactor(playground):` 前缀,结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- **绝不自动回退任何已有改动**;测试失败先看失败原因,拿不准就问用户。
- 工作树里有未提交的早前工作(workspaceButton 等),**只 add 本计划触及的文件**,提交前 `git status --short` 核对。

---

### Task 1: 骨骼锚点模块 boneAnchors.ts

**Files:**
- Create: `packages/playground/src/shared/camera/boneAnchors.ts`
- Test: `packages/playground/src/shared/camera/boneAnchors.test.ts`

**Interfaces:**
- Consumes: 无(纯 three 依赖)。
- Produces(后续任务依赖的精确签名):
  ```ts
  export const BONE_PARTS: readonly ['head', 'chest', 'handL', 'handR', 'legL', 'legR']
  export type BonePart = (typeof BONE_PARTS)[number]
  export function normalizeBoneName(name: string): string
  export function resolveAnchorBones(root: Object3D): Partial<Record<BonePart, Object3D>>
  export function makeBoneAnchorId(placementKey: string, part: BonePart): string
  // 形如 "bone:Models / Y Bot#head"
  export function parseBoneAnchorId(id: string): {placementKey: string; part: BonePart} | null
  export function registerBoneAnchors(placementKey: string, root: Object3D): void
  export function unregisterBoneAnchors(placementKey: string): void
  export function getBoneAnchorObjects(): ReadonlyMap<string, Object3D>
  // key = bone:<placementKey>#<part>,value = 挂在骨骼下的 Object3D
  ```

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/boneAnchors.test.ts
import {Bone, Object3D} from 'three'
import {
  BONE_PARTS,
  parseBoneAnchorId,
  resolveAnchorBones,
  makeBoneAnchorId,
  registerBoneAnchors,
  unregisterBoneAnchors,
  getBoneAnchorObjects,
} from './boneAnchors'

function mixamoRig(): Object3D {
  // Y Bot 实测骨架的精简版:mixamorig 前缀、无冒号
  const names = [
    'mixamorigHips',
    'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2',
    'mixamorigNeck', 'mixamorigHead',
    'mixamorigLeftHand', 'mixamorigRightHand',
    'mixamorigLeftLeg', 'mixamorigRightLeg',
  ]
  const root = new Object3D()
  const byName = new Map<string, Bone>()
  for (const name of names) {
    const bone = new Bone()
    bone.name = name
    byName.set(name, bone)
  }
  root.add(byName.get('mixamorigHips')!)
  return root
}

describe('resolveAnchorBones', () => {
  test('mixamo 骨架六个部位全命中', () => {
    const found = resolveAnchorBones(mixamoRig())
    expect(Object.keys(found).sort()).toEqual([...BONE_PARTS].sort())
    expect(found.head?.name).toBe('mixamorigHead')
    expect(found.chest?.name).toBe('mixamorigSpine1')
    expect(found.handL?.name).toBe('mixamorigLeftHand')
    expect(found.handR?.name).toBe('mixamorigRightHand')
    expect(found.legL?.name).toBe('mixamorigLeftLeg')
    expect(found.legR?.name).toBe('mixamorigRightLeg')
  })
  test('容忍冒号/大小写变体(mixamorig:Head / MixamorigHead)', () => {
    const root = new Object3D()
    for (const name of ['mixamorig:Head', 'MixamorigSpine1', 'LEFTHAND', 'right_hand']) {
      const b = new Bone()
      b.name = name
      root.add(b)
    }
    const found = resolveAnchorBones(root)
    expect(found.head).toBeDefined()
    expect(found.chest).toBeDefined()
    expect(found.handL).toBeDefined()
    expect(found.handR).toBeDefined()
  })
  test('无骨骼的静态模型全部落空', () => {
    const root = new Object3D()
    root.add(new Object3D())
    expect(resolveAnchorBones(root)).toEqual({})
  })
})

describe('bone anchor id', () => {
  test('构造/解析互逆;坏 id 返回 null', () => {
    const id = makeBoneAnchorId('Models / Y Bot', 'head')
    expect(id).toBe('bone:Models / Y Bot#head')
    expect(parseBoneAnchorId(id)).toEqual({placementKey: 'Models / Y Bot', part: 'head'})
    expect(parseBoneAnchorId('anchor:Anchor 1')).toBeNull()
    expect(parseBoneAnchorId('bone:no-part-here')).toBeNull()
    expect(parseBoneAnchorId('bone:k#nope')).toBeNull()
  })
})

describe('registerBoneAnchors / unregisterBoneAnchors', () => {
  test('登记后在 getBoneAnchorObjects 可查,按 placementKey 成组清理', () => {
    const rig = mixamoRig()
    registerBoneAnchors('Models / Y Bot', rig)
    const all = getBoneAnchorObjects()
    expect(all.size).toBe(6)
    const headId = makeBoneAnchorId('Models / Y Bot', 'head')
    // 锚点是挂到骨骼下的子节点
    expect(all.get(headId)?.parent?.name).toBe('mixamorigHead')
    unregisterBoneAnchors('Models / Y Bot')
    expect(getBoneAnchorObjects().size).toBe(0)
  })
  test('同一模型重复登记不堆积(先清同组再挂)', () => {
    const rig = mixamoRig()
    registerBoneAnchors('M1', rig)
    registerBoneAnchors('M1', rig)
    expect(getBoneAnchorObjects().size).toBe(6)
    unregisterBoneAnchors('M1')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/boneAnchors.test.ts; echo JEST_EXIT=$?
```
预期:FAIL,`Cannot find module './boneAnchors'`。

- [ ] **Step 3: 实现 boneAnchors.ts**

```ts
// packages/playground/src/shared/camera/boneAnchors.ts
/**
 * 骨骼锚点:放置模型的"可瞄准部位"。按骨骼名在实例骨架里找
 * 头/胸口/双手/双腿,把无网格的 Object3D 挂到骨骼下(对齐 Blender
 * 空物体的"骨骼父子"),登记进模块级 Map 供瞄准/父级绑定解析。
 * 运行时零件,不进大纲、无属性面板。
 */
import type {Object3D} from 'three'
import {Object3D as Object3DImpl} from 'three'

export const BONE_PARTS = ['head', 'chest', 'handL', 'handR', 'legL', 'legR'] as const
export type BonePart = (typeof BONE_PARTS)[number]

/** 部位的骨骼名候选(按优先序);匹配前先做归一化 */
const BONE_CANDIDATES: Record<BonePart, string[]> = {
  head: ['Head'],
  // 胸口取中段脊柱(Spine1);Spine2 更靠脖颈,作兜底
  chest: ['Spine1', 'Spine2'],
  handL: ['LeftHand', 'HandLeft'],
  handR: ['RightHand', 'HandRight'],
  legL: ['LeftLeg', 'LegLeft', 'LeftShin'],
  legR: ['RightLeg', 'LegRight', 'RightShin'],
}

/** 归一化骨骼名:去 mixamorig 前缀/冒号、去下划线、转小写。
 *  "mixamorig:Head" / "Mixamorig_Head" / "Head" → "head" */
export function normalizeBoneName(name: string): string {
  return name
    .replace(/^mixamorig:?/i, '')
    .replace(/_/g, '')
    .toLowerCase()
}

/** 在骨架树里按部位找骨骼;找不到的部位缺省(Y Bot 实测
 * 骨架前缀是 mixamorig、无冒号,归一化后天然兼容) */
export function resolveAnchorBones(root: Object3D): Partial<Record<BonePart, Object3D>> {
  const bones: Object3D[] = []
  root.traverse((o) => {
    if ((o as {isBone?: boolean}).isBone) bones.push(o)
  })
  const byNormalized = new Map<string, Object3D>()
  for (const bone of bones) {
    const key = normalizeBoneName(bone.name)
    if (!byNormalized.has(key)) byNormalized.set(key, bone)
  }
  const found: Partial<Record<BonePart, Object3D>> = {}
  for (const part of BONE_PARTS) {
    for (const candidate of BONE_CANDIDATES[part]) {
      const bone = byNormalized.get(normalizeBoneName(candidate))
      if (bone) {
        found[part] = bone
        break
      }
    }
  }
  return found
}

export function makeBoneAnchorId(placementKey: string, part: BonePart): string {
  return `bone:${placementKey}#${part}`
}

export function parseBoneAnchorId(
  id: string,
): {placementKey: string; part: BonePart} | null {
  if (!id.startsWith('bone:')) return null
  const hash = id.indexOf('#')
  if (hash < 0) return null
  const placementKey = id.slice(5, hash)
  const part = id.slice(hash + 1) as BonePart
  if (!placementKey || !(BONE_PARTS as readonly string[]).includes(part)) return null
  return {placementKey, part}
}

/** anchorId(bone:…#part)→ 骨骼下的锚点节点 */
const boneAnchors = new Map<string, Object3D>()

/**
 * 在放置实例上登记骨骼锚点:解析部位 → 挂节点 → 入表。
 * 同 placementKey 重复调用先清旧组(热更新/重挂载防堆积)。
 * 无骨骼的模型自然解析为空,不进表。
 */
export function registerBoneAnchors(placementKey: string, root: Object3D): void {
  unregisterBoneAnchors(placementKey)
  const found = resolveAnchorBones(root)
  for (const part of BONE_PARTS) {
    const bone = found[part]
    if (!bone) continue
    const anchor = new Object3DImpl()
    anchor.name = `Anchor_${part}`
    bone.add(anchor)
    boneAnchors.set(makeBoneAnchorId(placementKey, part), anchor)
  }
}

export function unregisterBoneAnchors(placementKey: string): void {
  for (const part of BONE_PARTS) {
    const id = makeBoneAnchorId(placementKey, part)
    const anchor = boneAnchors.get(id)
    if (anchor) {
      anchor.parent?.remove(anchor)
      boneAnchors.delete(id)
    }
  }
}

export function getBoneAnchorObjects(): ReadonlyMap<string, Object3D> {
  return boneAnchors
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/boneAnchors.test.ts; echo JEST_EXIT=$?
```
预期:PASS(9 个用例全绿)。

- [ ] **Step 5: 类型检查 + 提交**

```bash
cd /Users/huhui/Projects/theatre/packages/playground && npx tsc --noEmit; echo TSC_EXIT=$?
# 预期 TSC_EXIT=0
cd /Users/huhui/Projects/theatre && git add packages/playground/src/shared/camera/boneAnchors.ts packages/playground/src/shared/camera/boneAnchors.test.ts
git status --short  # 核对只有这两个文件
git commit -m "feat(playground): 骨骼锚点模块——按骨骼名解析头/胸口/双手/双腿,挂运行时节点供后续瞄准与父级绑定

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 目标 id 方案与解析 aimTargets.ts

**Files:**
- Create: `packages/playground/src/shared/camera/aimTargets.ts`
- Test: `packages/playground/src/shared/camera/aimTargets.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `getBoneAnchorObjects()`、`parseBoneAnchorId`、`BonePart`、`BONE_PARTS`。
- Produces:
  ```ts
  export type TargetKind = 'anchor' | 'bone' | 'model' | 'camera'
  export function parseTargetId(id: string):
    | {kind: 'anchor'; key: string}
    | {kind: 'bone'; placementKey: string; part: BonePart}
    | {kind: 'model'; key: string}
    | {kind: 'camera'; key: string}
    | null
  export function makeTargetId(kind: TargetKind, key: string, part?: BonePart): string
  export interface TargetLookup {
    anchors: ReadonlyMap<string, Object3D>
    bones: ReadonlyMap<string, Object3D>
    models: ReadonlyMap<string, Object3D>
    cameras: ReadonlyMap<string, Object3D>
  }
  // 纯函数:测试注入 fake Map
  export function resolveTargetObject(id: string, lookup: TargetLookup): Object3D | null
  // 模块级便捷封装:读运行时登记表(锚点表由本模块提供,骨骼/模型/相机表由后续任务接入)
  export function registerAnchorObject(key: string, obj: Object3D | null): void
  export function getAnchorObjects(): ReadonlyMap<string, Object3D>
  export function defaultTargetLookup(): TargetLookup
  export function resolveAimTarget(id: string): Object3D | null
  export function resolveAnchorParent(id: string): Object3D | null
  ```

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/aimTargets.test.ts
import {Object3D} from 'three'
import {
  parseTargetId,
  makeTargetId,
  resolveTargetObject,
  registerAnchorObject,
  getAnchorObjects,
  type TargetLookup,
} from './aimTargets'
import {makeBoneAnchorId} from './boneAnchors'

function emptyLookup(): TargetLookup {
  return {anchors: new Map(), bones: new Map(), models: new Map(), cameras: new Map()}
}

describe('parseTargetId / makeTargetId', () => {
  test('四种 kind 互逆', () => {
    expect(parseTargetId('')).toBeNull()
    expect(makeTargetId('anchor', 'Anchor 1')).toBe('anchor:Anchor 1')
    expect(parseTargetId('anchor:Anchor 1')).toEqual({kind: 'anchor', key: 'Anchor 1'})
    expect(makeTargetId('model', 'Models / Y Bot')).toBe('model:Models / Y Bot')
    expect(parseTargetId('model:Models / Y Bot')).toEqual({kind: 'model', key: 'Models / Y Bot'})
    expect(makeTargetId('camera', 'Shot Camera / Camera')).toBe('camera:Shot Camera / Camera')
    expect(parseTargetId('camera:Shot Camera / Camera')).toEqual({
      kind: 'camera',
      key: 'Shot Camera / Camera',
    })
    const boneId = makeBoneAnchorId('Models / Y Bot', 'head')
    expect(parseTargetId(boneId)).toEqual({
      kind: 'bone',
      placementKey: 'Models / Y Bot',
      part: 'head',
    })
    expect(makeTargetId('bone', 'Models / Y Bot', 'head')).toBe(boneId)
  })
  test('坏 id 返回 null', () => {
    expect(parseTargetId('nonsense')).toBeNull()
    expect(parseTargetId('anchor:')).toBeNull()
    expect(parseTargetId('bone:k#nope')).toBeNull()
  })
})

describe('resolveTargetObject', () => {
  test('按 kind 查对应表;空 id 与解析失败都是 null', () => {
    const anchorObj = new Object3D()
    const boneObj = new Object3D()
    const modelObj = new Object3D()
    const camObj = new Object3D()
    const lookup = emptyLookup()
    lookup.anchors.set('Anchor 1', anchorObj)
    lookup.bones.set(makeBoneAnchorId('M1', 'handL'), boneObj)
    lookup.models.set('M1', modelObj)
    lookup.cameras.set('C1', camObj)
    expect(resolveTargetObject('', lookup)).toBeNull()
    expect(resolveTargetObject('anchor:Anchor 1', lookup)).toBe(anchorObj)
    expect(resolveTargetObject(makeBoneAnchorId('M1', 'handL'), lookup)).toBe(boneObj)
    expect(resolveTargetObject('model:M1', lookup)).toBe(modelObj)
    expect(resolveTargetObject('camera:C1', lookup)).toBe(camObj)
    expect(resolveTargetObject('anchor:不存在', lookup)).toBeNull()
  })
})

describe('registerAnchorObject', () => {
  test('登记/覆盖/注销(null)', () => {
    const obj = new Object3D()
    registerAnchorObject('Anchor 1', obj)
    expect(getAnchorObjects().get('Anchor 1')).toBe(obj)
    registerAnchorObject('Anchor 1', null)
    expect(getAnchorObjects().size).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/aimTargets.test.ts; echo JEST_EXIT=$?
```
预期:FAIL,`Cannot find module './aimTargets'`。

- [ ] **Step 3: 实现 aimTargets.ts**

```ts
// packages/playground/src/shared/camera/aimTargets.ts
/**
 * 瞄准/父级绑定的目标 id 方案与解析。
 * id 取值:''(无)| anchor:<key>(独立锚点)| bone:<placement>#<part>(骨骼锚点)
 *        | model:<placementKey>(整个放置模型)| camera:<cameraKey>(拍摄相机)。
 * 解析分两层:纯函数 resolveTargetObject(id, lookup) 供测试注入;
 * resolveAimTarget / resolveAnchorParent 读运行时登记表,供帧驱动调用。
 */
import type {Object3D} from 'three'
import {getBoneAnchorObjects, makeBoneAnchorId, parseBoneAnchorId} from './boneAnchors'
import type {BonePart} from './boneAnchors'
import {getPlacedInstances} from './PlacementManager'
import {getShotCameraObjects} from './cameraRegistry'

export type TargetKind = 'anchor' | 'bone' | 'model' | 'camera'

const KIND_PREFIXES: TargetKind[] = ['anchor', 'bone', 'model', 'camera']

export function parseTargetId(
  id: string,
):
  | {kind: 'anchor'; key: string}
  | {kind: 'bone'; placementKey: string; part: BonePart}
  | {kind: 'model'; key: string}
  | {kind: 'camera'; key: string}
  | null {
  if (id === '') return null
  const bone = parseBoneAnchorId(id)
  if (bone) return {kind: 'bone', ...bone}
  const colon = id.indexOf(':')
  if (colon <= 0) return null
  const kind = id.slice(0, colon) as TargetKind
  const key = id.slice(colon + 1)
  if (!KIND_PREFIXES.includes(kind) || !key) return null
  if (kind === 'bone') return null // 已被 parseBoneAnchorId 拦截,带 # 校验
  return {kind, key} as
    | {kind: 'anchor'; key: string}
    | {kind: 'model'; key: string}
    | {kind: 'camera'; key: string}
}

export function makeTargetId(kind: TargetKind, key: string, part?: BonePart): string {
  if (kind === 'bone') return makeBoneAnchorId(key, part!)
  return `${kind}:${key}`
}

export interface TargetLookup {
  anchors: ReadonlyMap<string, Object3D>
  bones: ReadonlyMap<string, Object3D>
  models: ReadonlyMap<string, Object3D>
  cameras: ReadonlyMap<string, Object3D>
}

export function resolveTargetObject(id: string, lookup: TargetLookup): Object3D | null {
  const parsed = parseTargetId(id)
  if (!parsed) return null
  switch (parsed.kind) {
    case 'anchor':
      return lookup.anchors.get(parsed.key) ?? null
    case 'bone':
      return lookup.bones.get(makeBoneAnchorId(parsed.placementKey, parsed.part)) ?? null
    case 'model':
      return lookup.models.get(parsed.key) ?? null
    case 'camera':
      return lookup.cameras.get(parsed.key) ?? null
  }
}

/** 独立锚点的 theatreKey → 场景网格(Anchors 组件登记) */
const anchorObjects = new Map<string, Object3D>()

export function registerAnchorObject(key: string, obj: Object3D | null): void {
  if (obj) anchorObjects.set(key, obj)
  else anchorObjects.delete(key)
}

export function getAnchorObjects(): ReadonlyMap<string, Object3D> {
  return anchorObjects
}

export function defaultTargetLookup(): TargetLookup {
  return {
    anchors: anchorObjects,
    bones: getBoneAnchorObjects(),
    models: getPlacedInstances(),
    cameras: getShotCameraObjects(),
  }
}

export function resolveAimTarget(id: string): Object3D | null {
  return resolveTargetObject(id, defaultTargetLookup())
}

export function resolveAnchorParent(id: string): Object3D | null {
  return resolveTargetObject(id, defaultTargetLookup())
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/aimTargets.test.ts; echo JEST_EXIT=$?
```
预期:第一次跑会报 `getPlacedInstances` / `getShotCameraObjects` 不存在——这是**预期中的实现缺口**,先补两个占位(Task 3/8 会充实它们):

- 在 `PlacementManager.tsx` 追加(放在 `placedModelRoots` 相关代码之后):
  ```ts
  /** 放置实例登记表:placementKey → 场景实例根(父级绑定的 model: 解析用) */
  const placedInstances = new Map<string, Group>()

  /** 放置实例登记/注销的便利 hook(PlacedModelCore 用) */
  function usePlacedInstance(key: string, instance: Group | null) {
    useEffect(() => {
      if (!instance) return
      placedInstances.set(key, instance)
      return () => {
        placedInstances.delete(key)
      }
    }, [key, instance])
  }

  export function getPlacedInstances(): ReadonlyMap<string, Group> {
    return placedInstances
  }
  ```
- 在 `cameraRegistry.ts` 追加(文件底部):
  ```ts
  /** 拍摄相机的 cameraKey → three 相机对象(锚点父级绑定的 camera: 解析用) */
  const shotCameraObjects = new Map<string, Object3D>()

  export function registerShotCameraObject(
    cameraKey: string,
    obj: Object3D | null,
  ): void {
    if (obj) shotCameraObjects.set(cameraKey, obj)
    else shotCameraObjects.delete(cameraKey)
  }

  export function getShotCameraObjects(): ReadonlyMap<string, Object3D> {
    return shotCameraObjects
  }
  ```
  cameraRegistry 需要 `import type {Object3D} from 'three'`。

然后再跑,预期:PASS。

- [ ] **Step 5: 类型检查 + 提交**

```bash
cd /Users/huhui/Projects/theatre/packages/playground && npx tsc --noEmit; echo TSC_EXIT=$?
# 预期 TSC_EXIT=0(占位函数此时无人调用,不影响)
cd /Users/huhui/Projects/theatre && git add packages/playground/src/shared/camera/aimTargets.ts packages/playground/src/shared/camera/aimTargets.test.ts packages/playground/src/shared/camera/PlacementManager.tsx packages/playground/src/shared/camera/cameraRegistry.ts
git status --short
git commit -m "feat(playground): 瞄准/父级绑定目标 id 方案与解析——anchor/bone/model/camera 四类,纯函数可注入测试

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 相机注册表瘦身(去 targetKey)

**Files:**
- Modify: `packages/playground/src/shared/camera/cameraRegistry.ts`
- Test: `packages/playground/src/shared/camera/cameraRegistry.test.ts`

**Interfaces:**
- Consumes: 无新依赖。
- Produces:
  ```ts
  export type CameraEntry = {cameraKey: string}  // 不再有 targetKey
  export type CameraSeed = {position: {...}; rotation: {...}}  // 不再有 targetPosition
  export function nextCameraEntry(existing: readonly CameraEntry[]): CameraEntry
  export function parseCameraEntries(json: string): CameraEntry[]
  // removeCamera 本任务不动(仍收 {camera?, target?}),Task 4 再收窄
  ```

- [ ] **Step 1: 改测试(先反映新契约)**

`cameraRegistry.test.ts` 中:
- `parseCameraEntries` 第一例的期望值从 `[{cameraKey, targetKey}]` 改为 `[{cameraKey: 'Shot Camera / Camera'}]`(同样输入,断言 targetKey 被剥掉);加一行注释说明"旧格式宽容解析:targetKey 被忽略"。
- `过滤畸形项` 一例期望值从 `[{cameraKey:'A',targetKey:'B'}]` 改为 `[{cameraKey:'A'}]`。
- `nextCameraEntry` 两个用例的 existing/期望值全部去掉 `targetKey` 字段,期望值分别为 `{cameraKey: 'Shot Camera / Camera'}` 和 `{cameraKey: 'Shot Camera 2 / Camera'}`。
- 其余用例(displayName、seed)不动。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/cameraRegistry.test.ts; echo JEST_EXIT=$?
```
预期:FAIL(断言不符)。

- [ ] **Step 3: 实现**

`cameraRegistry.ts`:
- `CameraEntry` 类型注释更新为"一台相机 = 一个 theatre 对象;旧清单里的 targetKey 解析时忽略(不做迁移,老相机自由朝向)";类型体改为 `{cameraKey: string}`。
- `FIRST_CAMERA` 改为 `{cameraKey: 'Shot Camera / Camera'}`。
- `parseCameraEntries` 的过滤谓词只校验 `cameraKey`,通过时返回 `{cameraKey: item.cameraKey}`(显式构造,剥掉多余字段)。
- `nextCameraEntry`:`used` 集合与返回的 entry 去掉 targetKey。
- `CameraSeed` 删 `targetPosition` 字段。

- [ ] **Step 4: 跑测试确认通过 + 类型检查**

```bash
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/cameraRegistry.test.ts; echo JEST_EXIT=$?
# 预期 PASS。注意:App.tsx 还在用 entry.targetKey,但那是值层面(运行时 undefined),
# tsc 会因类型缺字段报错——属预期,Task 4 一并清理;本任务以 jest 绿为准。
```

- [ ] **Step 5: 提交**

```bash
cd /Users/huhui/Projects/theatre && git add packages/playground/src/shared/camera/cameraRegistry.ts packages/playground/src/shared/camera/cameraRegistry.test.ts
git status --short
git commit -m "refactor(playground): 相机注册表瘦身——每行只存 cameraKey,旧格式 targetKey 宽容忽略

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: ShotCamera 解耦 + aimTarget 属性

**Files:**
- Modify: `packages/playground/src/shared/camera/ShotCamera.tsx`
- Modify: `packages/playground/src/shared/camera/App.tsx`
- Modify: `packages/playground/src/shared/camera/cameraRegistry.ts`(removeCamera 收窄)
- Modify: `packages/playground/src/shared/camera/i18n.ts`(词条)
- Test: `packages/playground/src/shared/camera/aimTargets.test.ts`(扩充)

**Interfaces:**
- Consumes: Task 2 的 `resolveAimTarget`、`parseTargetId`、`makeTargetId`、`getAnchorObjects`;Task 3 的 `CameraEntry`。
- Produces:
  ```ts
  // ShotCamera 新签名(去掉 targetKey/targetObjRef):
  export function ShotCamera(props: {
    cameraKey: string
    isActive: boolean
    shotView: boolean
    pipVisible: boolean
    pipBottom: number
    cameraObjRef: MutableRefObject<ISheetObject<any> | undefined>
    onCameraContextMenu?: (x: number, y: number) => void
  })
  // cameraRegistry:
  export function removeCamera(
    sheet: ISheet,
    entry: CameraEntry,
    objects: {camera?: ISheetObject<any>},
  )
  ```

- [ ] **Step 1: 写失败测试(aimTarget 选项函数)**

在 `aimTargets.test.ts` 追加:

```ts
import {translate, registerMessages} from '@dreamerbird/studio/i18n'

describe('aimTargetOptions', () => {
  // 选项函数读运行时登记表;用真实 registerAnchorObject + 注入 bones/models/cameras
  test('无候选时只有「无」;登记锚点后出现 anchor: 项', async () => {
    // 动态 import 拿绑定默认 lookup 的模块级函数前,先注册词条避免 key 原文兜底
    registerMessages('en', {'pg.props.aimNone': 'None'})
    registerMessages('zh-CN', {'pg.props.aimNone': '无'})
    const mod = await import('./aimTargets')
    // 直接断言选项组装纯函数(listAimTargetOptions)见下;此处只验证「无」兜底
    expect(true).toBe(true)
  })
})
```

> 说明:下拉选项的完整组装(读 sheet 注册表 + 各登记表)在本任务以**手工冒烟**验收(Task 8 统一浏览器验证),单元测试覆盖纯函数层。上面的占位用例删掉,改成测 `ShotCamera` 的定格纯逻辑不值得(重 React 依赖),本任务的自动化验证 = tsc + 既有全量 jest 不回归。

实际执行:Step 1 改为——扩充 `aimTargets.ts`,新增并导出:

```ts
/**
 * 「瞄准目标」下拉选项(模块级,studio 面板渲染时调用)。
 * 「无」+ 独立锚点(经 optionsSheet 读 Anchors 注册表,Task 6 落地,
 * 未落地前退化为空)+ 骨骼锚点(遍历运行时表,Task 8 接入数据)。
 */
let optionsSheet: ISheet | null = null
export function setAimOptionsSheet(sheet: ISheet | null): void {
  optionsSheet = sheet
}

export function aimTargetOptions(): {[key: string]: string} {
  const options: {[key: string]: string} = {'': translate('pg.props.aimNone')}
  if (!optionsSheet) return options
  try {
    for (const key of readAnchorKeys(getAnchorsRegistry(optionsSheet))) {
      options[makeTargetId('anchor', key)] = key
    }
  } catch {
    // Anchors 注册表尚未创建:跳过
  }
  // 骨骼锚点按模型分组:bone:<placement>#part → "<模型显示名> · <部位名>"
  const byPlacement = new Map<string, BonePart[]>()
  for (const id of getBoneAnchorObjects().keys()) {
    const parsed = parseBoneAnchorId(id)
    if (!parsed) continue
    const list = byPlacement.get(parsed.placementKey) ?? []
    list.push(parsed.part)
    byPlacement.set(parsed.placementKey, list)
  }
  for (const [placementKey, parts] of byPlacement) {
    const modelName = placementDisplayName(optionsSheet, placementKey)
    for (const part of parts) {
      options[makeTargetId('bone', placementKey, part)] =
        `${modelName} · ${translate(`pg.parts.${part}`)}`
    }
  }
  return options
}
```

配套 import:`translate` 来自 `@dreamerbird/studio/i18n`;`getAnchorsRegistry`/`readAnchorKeys` 来自 `./anchorsRegistry`(Task 6 才创建)——**本任务先建最小桩** `anchorsRegistry.ts`:

```ts
// packages/playground/src/shared/camera/anchorsRegistry.ts(本任务最小桩,Task 5/6 充实)
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {types as t} from '@dreamerbird/core'

export const ANCHORS_REGISTRY_KEY = 'Anchors'

export function getAnchorsRegistry(sheet: ISheet): ISheetObject<any> {
  return sheet.object(
    ANCHORS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
}

export function readAnchorKeys(registry: ISheetObject<any>): string[] {
  try {
    const list = JSON.parse(registry ? (registry.props.list as unknown as string) : '[]')
    return Array.isArray(list) ? list.filter((k) => typeof k === 'string' && k) : []
  } catch {
    return []
  }
}
```

以及 `placementDisplayName` 辅助(放 aimTargets.ts,从放置注册表反查显示名;放置注册表未建好时回退原 key):

```ts
import {readPlacementEntries} from './PlacementManager'

function placementDisplayName(sheet: ISheet, placementKey: string): string {
  try {
    const entry = readPlacementEntries(sheet).find((e) => e.key === placementKey)
    if (entry) return entry.key.replace(/^Models \/ /, '')
  } catch {
    // 放置注册表尚未创建
  }
  return placementKey
}
```

- [ ] **Step 2: 跑既有测试确认无回归**

```bash
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/aimTargets.test.ts packages/playground/src/shared/camera/boneAnchors.test.ts; echo JEST_EXIT=$?
```
预期:PASS。

- [ ] **Step 3: 改造 ShotCamera.tsx**

具体编辑(每一处都是小步,改完即对照):

1. import 区:加 `import {resolveAimTarget, aimTargetOptions} from './aimTargets'`;`Mesh` 类型若只在 targetRef 用到则一并清理。
2. `shotCameraAdditionalProps`:`trackTarget` 改 hidden(`{label: () => translate('pg.props.trackTarget'), hidden: true}`——词条本任务从词典删除,label 函数对 missing key 回退原文,不影响;属性保留只为兼容旧持久态),新增:
   ```ts
   aimTarget: t.stringLiteral('', aimTargetOptions, {
     label: () => translate('pg.props.aimTarget'),
     as: 'menu',
   }),
   ```
3. 组件签名:删 `targetKey`、`targetObjRef` 两个 prop 及其类型。
4. 删 `const targetRef = useRef<Mesh>(null!)`。
5. 落地种子 effect:`set(targetObj.props.position, seed.targetPosition)` 删除;依赖数组里的 `targetObj` 相关清理(改为只 set camObj 的 position/rotation)。`CameraSeed` 已无该字段。
6. 卸载清理 effect:去掉 `targetObjRef.current = undefined`。
7. 朝向绑定块(原 trackTarget/tracking/prevTrackingRef 定格 effect)整体替换为按 aimTarget 的版本:
   ```ts
   // 朝向绑定:aimTarget 下拉选目标(对齐 Blender Track To 的目标槽)。
   // tracking = 目标存在且可解析;目标被删/选「无」→ 定格当前朝向进
   // rotation 属性,画面不跳(对齐 Blender 约束失效)
   const aimTargetId = useObjPropScalar<string>(cameraObjRef, 'aimTarget', '')
   const aimObj = aimTargetId ? resolveAimTarget(aimTargetId) : null
   const tracking = aimObj !== null
   const prevTrackingRef = useRef<boolean | null>(null)
   const capturePosTmp = useRef(new Vector3())
   useEffect(() => {
     const prev = prevTrackingRef.current
     prevTrackingRef.current = tracking
     // prev=null 是挂载首次跑(持久态恢复):rotation 本来就是对的,跳过
     if (prev !== true || tracking) return
     const cam = camRef.current
     const obj = cameraObjRef.current
     const studio = getStudioSync()
     if (!cam || !obj || !studio) return
     const sampled = capturePosTmp.current
     const from =
       boundMeta &&
       samplePathPoint(boundKey!, val(boundMeta.props.progress), sampled)
         ? sampled
         : cam.position
     // aimRef 每帧镜像目标位置,此刻存的是最后画面里的目标位置
     const m = new Matrix4().lookAt(from, aimRef.current.position, cam.up)
     const e = new Euler().setFromRotationMatrix(m, 'XYZ')
     const scrub = studio.scrub()
     scrub.capture(({set}) => set(obj.props.rotation, {x: e.x, y: e.y, z: e.z}))
     scrub.commit()
   }, [tracking, cameraObjRef, boundKey, boundMeta])
   ```
8. `useSelectionGizmoTarget(targetObjRef, targetRef, true)` 删除。
9. `useFrame(-1)` 里的瞄准镜像:`if (targetRef.current) aimRef...` 替换为:
   ```ts
   const aimObj = aimTargetId ? resolveAimTarget(aimTargetId) : null
   if (aimObj) aimObj.getWorldPosition(aimRef.current.position)
   ```
   (useFrame 回调里读外层渲染作用域的 aimTargetId——它在帧间变化会触发重渲染,闭包是新的,安全。)
10. `useEffect(() => registerEditorOnly(targetRef.current), [])` 删除。
11. JSX:删整个 `<e.mesh theatreKey={targetKey}>…</e.mesh>` 块。
12. 模块顶部大注释里 "Shot Target(瞄准点)"、"Target 线框小方块同理" 等描述更新为 aimTarget 下拉语义(简述即可)。

- [ ] **Step 4: 改 App.tsx 调用侧**

- `ShotObjRefs` 类型(约 492 行):`{camera: {...}; target: {...}}` → `{camera: {current: undefined}}`(保持具体泛型写法与现一致:`MutableRefObject<ISheetObject<any> | undefined>`)。
- `getShotRefs`:`refs = {camera: {current: undefined}}`。
- `addCamera`:seed 构造删 `targetPosition` 行。
- `deleteCamera`:`removeCamera(sheet, entry, {camera: refs?.camera.current})`。
- `cameras.map((entry) => <ShotCamera …>)`:删 `targetKey={entry.targetKey}` 与 `targetObjRef={…}` 两行。
- ShotCamera 的 effect 注册相机对象:在 ShotCamera 组件内加(属于 Step 3 的文件,这里列出):
  ```ts
  // 登记 three 相机对象,供锚点父级绑定的 camera: 解析
  useEffect(() => {
    registerShotCameraObject(cameraKey, camRef.current)
    return () => registerShotCameraObject(cameraKey, null)
  }, [cameraKey])
  ```
  import `registerShotCameraObject` from './cameraRegistry'。
- `cameraRegistry.ts` 的 `removeCamera`:签名收窄为 `objects: {camera?: ISheetObject<any>}`,循环数组 `[objects.camera]`。

- [ ] **Step 5: i18n 词条**

`i18n.ts`:
- en 增:`'pg.props.aimTarget': 'Aim target'`、`'pg.props.aimNone': 'None'`。
- zh-CN 增:`'pg.props.aimTarget': '瞄准目标'`、`'pg.props.aimNone': '无'`。
- 两个词典删 `'pg.props.trackTarget'`。

- [ ] **Step 6: 全量验证**

```bash
cd /Users/huhui/Projects/theatre/packages/playground && npx tsc --noEmit; echo TSC_EXIT=$?
# 预期 TSC_EXIT=0
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera; echo JEST_EXIT=$?
# 预期:camera 目录全绿(i18n.test.ts 的 isolateModules 用例若因新增 import 报错,
# 在测试顶部已有 delete globalThis.__TheatreJS_CoreBundle 兜底,不应回归)
```

- [ ] **Step 7: 提交**

```bash
cd /Users/huhui/Projects/theatre && git add packages/playground/src/shared/camera/ShotCamera.tsx packages/playground/src/shared/camera/App.tsx packages/playground/src/shared/camera/cameraRegistry.ts packages/playground/src/shared/camera/i18n.ts packages/playground/src/shared/camera/aimTargets.ts packages/playground/src/shared/camera/aimTargets.test.ts packages/playground/src/shared/camera/anchorsRegistry.ts
git status --short
git commit -m "feat(playground): 相机与瞄准点解耦——新相机不再带 Target,瞄准目标改下拉(aimTarget 属性),解绑/目标消失定格朝向

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Anchors 注册表

**Files:**
- Modify: `packages/playground/src/shared/camera/anchorsRegistry.ts`(充实 Task 4 的桩)
- Test: `packages/playground/src/shared/camera/anchorsRegistry.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `getAnchorsRegistry`/`readAnchorKeys` 桩语义。
- Produces:
  ```ts
  export type AnchorSeed = {position: {x: number; y: number; z: number}}
  export function parseAnchorKeys(json: string): string[]
  export function useAnchorsList(sheet: ISheet): string[]
  export function nextAnchorKey(existing: readonly string[]): string
  export function addAnchorToRegistry(sheet: ISheet, key: string, seed?: AnchorSeed): void
  export function removeAnchor(sheet: ISheet, key: string, object?: ISheetObject<any>): void
  export function stashAnchorSeed(key: string, seed: AnchorSeed): void
  export function consumeAnchorSeed(key: string): AnchorSeed | undefined
  ```

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/anchorsRegistry.test.ts
import {
  parseAnchorKeys,
  nextAnchorKey,
  stashAnchorSeed,
  consumeAnchorSeed,
} from './anchorsRegistry'

describe('parseAnchorKeys', () => {
  test('合法清单;坏 JSON/非数组/非字符串项回退', () => {
    expect(parseAnchorKeys('["Anchor 1","Anchor 2"]')).toEqual(['Anchor 1', 'Anchor 2'])
    expect(parseAnchorKeys('not json')).toEqual([])
    expect(parseAnchorKeys('{"a":1}')).toEqual([])
    expect(parseAnchorKeys('[1,"Anchor 1",null]')).toEqual(['Anchor 1'])
  })
})

describe('nextAnchorKey', () => {
  test('空清单给 Anchor 1;占用后取第一个空位', () => {
    expect(nextAnchorKey([])).toBe('Anchor 1')
    expect(nextAnchorKey(['Anchor 1', 'Anchor 2'])).toBe('Anchor 3')
    expect(nextAnchorKey(['Anchor 1', 'Anchor 3'])).toBe('Anchor 2')
  })
})

describe('anchor seed', () => {
  test('存取一次即清;未存的 key 返回 undefined', () => {
    stashAnchorSeed('Anchor 1', {position: {x: 1, y: 2, z: 3}})
    expect(consumeAnchorSeed('Anchor 1')).toEqual({position: {x: 1, y: 2, z: 3}})
    expect(consumeAnchorSeed('Anchor 1')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/anchorsRegistry.test.ts; echo JEST_EXIT=$?
```
预期:FAIL(导出的函数不存在)。

- [ ] **Step 3: 实现 anchorsRegistry.ts(整体替换 Task 4 的桩)**

```ts
// packages/playground/src/shared/camera/anchorsRegistry.ts
/**
 * 独立锚点注册表:场景里有几个空物体锚点 = 清单里有几行。
 * 模式照搬 cameraRegistry(隐藏注册表对象存 key 数组 JSON;
 * 增删都是可撤销事务;种子暂存-挂载消费)。锚点与相机平级独立,
 * 可被相机瞄准、可绑定父级。
 */
import {getStudioSync, types as t, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {useEffect, useMemo, useState} from 'react'

export const ANCHORS_REGISTRY_KEY = 'Anchors'

export type AnchorSeed = {position: {x: number; y: number; z: number}}

export function getAnchorsRegistry(sheet: ISheet): ISheetObject<any> {
  return sheet.object(
    ANCHORS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
}

export function parseAnchorKeys(json: string): string[] {
  try {
    const list = JSON.parse(json)
    if (!Array.isArray(list)) return []
    return list.filter((k): k is string => typeof k === 'string' && k.length > 0)
  } catch {
    return []
  }
}

export function readAnchorKeys(registry: ISheetObject<any>): string[] {
  return parseAnchorKeys(val(registry.props.list) as string)
}

export function nextAnchorKey(existing: readonly string[]): string {
  const used = new Set(existing)
  for (let n = 1; ; n++) {
    const key = `Anchor ${n}`
    if (!used.has(key)) return key
  }
}

export function useAnchorsList(sheet: ISheet): string[] {
  const registry = useMemo(() => getAnchorsRegistry(sheet), [sheet])
  const [list, setList] = useState<string[]>(() => readAnchorKeys(registry))
  useEffect(() => {
    setList(readAnchorKeys(registry))
    return registry.onValuesChange(() => setList(readAnchorKeys(registry)))
  }, [registry])
  return list
}

const pendingSeeds = new Map<string, AnchorSeed>()

export function stashAnchorSeed(key: string, seed: AnchorSeed) {
  pendingSeeds.set(key, seed)
}

export function consumeAnchorSeed(key: string): AnchorSeed | undefined {
  const seed = pendingSeeds.get(key)
  pendingSeeds.delete(key)
  return seed
}

/** 添加锚点:注册表加一行(App 按清单渲染,组件挂载即创建对象) */
export function addAnchorToRegistry(
  sheet: ISheet,
  key: string,
  seed?: AnchorSeed,
): void {
  const studio = getStudioSync()
  if (!studio) return
  const registry = getAnchorsRegistry(sheet)
  const list = readAnchorKeys(registry)
  if (list.includes(key)) return
  const scrub = studio.scrub()
  scrub.capture(({set}) => set(registry.props.list, JSON.stringify([...list, key])))
  scrub.commit()
  if (seed) stashAnchorSeed(key, seed)
}

/** 删除锚点:真删(forgetObject 清持久数据 + 注册表移除),两步事务 */
export function removeAnchor(
  sheet: ISheet,
  key: string,
  object?: ISheetObject<any>,
): void {
  const studio = getStudioSync()
  if (!studio) return
  pendingSeeds.delete(key)
  if (object) {
    try {
      studio.transaction(({forgetObject}) => forgetObject(object as any))
    } catch (err) {
      console.warn('[anchors] forgetObject 跳过(对象无持久数据)', err)
    }
  }
  const registry = getAnchorsRegistry(sheet)
  const list = readAnchorKeys(registry)
  const scrub = studio.scrub()
  scrub.capture(({set}) =>
    set(registry.props.list, JSON.stringify(list.filter((k) => k !== key))),
  )
  scrub.commit()
}
```

> 注意:`getAnchorsRegistry`/`readAnchorKeys` 两个导出 Task 4 的桩里已有,**保留签名不变**,其余新增。

- [ ] **Step 4: 跑测试 + 类型检查**

```bash
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/anchorsRegistry.test.ts; echo JEST_EXIT=$?
# 预期 PASS
cd /Users/huhui/Projects/theatre/packages/playground && npx tsc --noEmit; echo TSC_EXIT=$?
# 预期 TSC_EXIT=0
```

- [ ] **Step 5: 提交**

```bash
cd /Users/huhui/Projects/theatre && git add packages/playground/src/shared/camera/anchorsRegistry.ts packages/playground/src/shared/camera/anchorsRegistry.test.ts
git status --short
git commit -m "feat(playground): 独立锚点注册表——添加/删除/命名取空位,模式对齐相机注册表

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Anchors 组件 + 顶栏按钮 + App 接线

**Files:**
- Create: `packages/playground/src/shared/camera/Anchors.tsx`
- Modify: `packages/playground/src/shared/camera/App.tsx`
- Modify: `packages/playground/src/shared/camera/TopToolbar.tsx`
- Modify: `packages/playground/src/shared/camera/menuModel.ts`
- Modify: `packages/playground/src/shared/camera/i18n.ts`

**Interfaces:**
- Consumes: Task 5 全套;Task 2 的 `registerAnchorObject`;Task 4 的 `setAimOptionsSheet`。
- Produces:
  ```tsx
  // Anchors.tsx
  export function Anchors({sheet, shotView}: {sheet: ISheet; shotView: boolean}): JSX.Element
  // 内部渲染 anchorKeys.map(<AnchorObject>),每个 AnchorObject 一个 e.mesh
  // menuModel.ts 追加:
  export function buildAnchorMenuItems(
    opts: {onDeleteAnchor: () => void},
    t?: MenuT,
  ): ContextMenuItem[]
  // TopToolbar 新增 prop:
  onAddAnchor: () => void
  ```

- [ ] **Step 1: i18n 词条**

`i18n.ts` en 增:
```ts
'pg.toolbar.addAnchor': 'Add anchor',
'pg.toolbar.addAnchor.hint':
  'Place an empty anchor in front of the current view (aim target / parentable)',
'pg.menu.deleteAnchor': 'Delete anchor',
```
zh-CN 增:
```ts
'pg.toolbar.addAnchor': '添加锚点',
'pg.toolbar.addAnchor.hint': '在当前视角前方放一个空锚点(可被相机瞄准、可绑父级)',
'pg.menu.deleteAnchor': '删除锚点',
```

- [ ] **Step 2: menuModel.ts 追加**

```ts
export function buildAnchorMenuItems(
  opts: {
    onDeleteAnchor: () => void
  },
  t: MenuT = translate,
): ContextMenuItem[] {
  return [
    {
      type: 'normal',
      label: t('pg.menu.deleteAnchor'),
      callback: opts.onDeleteAnchor,
    },
  ]
}
```
(`ContextMenuItem`/`MenuT` 的 import 该文件已有,照抄现有 builder。)

- [ ] **Step 3: 实现 Anchors.tsx**

```tsx
// packages/playground/src/shared/camera/Anchors.tsx
/**
 * 独立锚点(空物体):顶栏按钮添加,橙色线框小方块(沿用旧 Target
 * 视觉)。可点选、可拖(gizmo)、右键删除;可被相机瞄准,可绑定父级
 * (Task 7)。仅编辑视角可见。
 */
import {editable as e} from '@dreamerbird/r3f'
import {getStudioSync} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import React, {useEffect, useLayoutEffect, useRef} from 'react'
import type {MutableRefObject} from 'react'
import type {Mesh} from 'three'
import type {ThreeEvent} from '@react-three/fiber'
import {registerEditorOnly} from './editorOnly'
import {useSelectionGizmoTarget} from './PlacementManager'
import {
  consumeAnchorSeed,
  useAnchorsList,
} from './anchorsRegistry'
import {registerAnchorObject} from './aimTargets'

export function Anchors({sheet, shotView}: {sheet: ISheet; shotView: boolean}) {
  const anchorKeys = useAnchorsList(sheet)
  // 锚点网格的"娘家":r3f 原挂载点,解绑/父级消失时挂回这里
  const homeRef = useRef<React.ElementRef<'group'>>(null!)
  return (
    <group ref={homeRef}>
      {anchorKeys.map((key) => (
        <AnchorObject
          key={key}
          anchorKey={key}
          shotView={shotView}
          homeRef={homeRef}
        />
      ))}
    </group>
  )
}

function AnchorObject({
  anchorKey,
  shotView,
  homeRef,
}: {
  anchorKey: string
  shotView: boolean
  homeRef: MutableRefObject<import('three').Group | null>
}) {
  const meshRef = useRef<Mesh>(null!)
  const objRef = useRef<ISheetObject<any> | undefined>(undefined)
  const setObjRef = (obj: ISheetObject<any> | null) => {
    objRef.current = obj ?? undefined
  }

  // 新锚点落地:消费位置种子(顶栏添加时从导演视角捕获)
  useLayoutEffect(() => {
    const seed = consumeAnchorSeed(anchorKey)
    const obj = objRef.current
    if (!seed || !obj) return
    const studio = getStudioSync()
    if (!studio) return
    const scrub = studio.scrub()
    scrub.capture(({set}) => set(obj.props.position, seed.position))
    scrub.commit()
  }, [anchorKey])

  // 登记运行时对象(瞄准解析 anchor:)与选中 gizmo;卸载清理
  useEffect(() => {
    registerAnchorObject(anchorKey, meshRef.current)
    return () => {
      registerAnchorObject(anchorKey, null)
      objRef.current = undefined
    }
  }, [anchorKey])
  useSelectionGizmoTarget(objRef, meshRef, true)
  useEffect(() => registerEditorOnly(meshRef.current), [])

  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const studio = getStudioSync()
    if (studio && objRef.current) studio.setSelection([objRef.current])
  }

  return (
    <e.mesh
      theatreKey={anchorKey}
      objRef={setObjRef}
      ref={meshRef}
      position={[0, 1, 0]}
      visible={!shotView}
      onClick={select}
      onContextMenu={(event) => {
        event.stopPropagation()
        event.nativeEvent.preventDefault()
        select(event)
        // 菜单由 App 弹:经自定义事件透传坐标,避免层层 props
        window.dispatchEvent(
          new CustomEvent('pg:anchor-context-menu', {
            detail: {key: anchorKey, x: event.nativeEvent.clientX, y: event.nativeEvent.clientY},
          }),
        )
      }}
    >
      <boxGeometry args={[0.25, 0.25, 0.25]} />
      <meshBasicMaterial color="#ffb020" wireframe />
    </e.mesh>
  )
}
```

> 说明:右键菜单走 `CustomEvent` 是为了不穿透 `sheet`/`onAnchorContextMenu` 两层 props——参照 ShotCamera 用的是 props 回调,但 Anchors 在 App 里的挂载点深;若评审倾向 props 回调,改成 `Anchors({onAnchorContextMenu})` 亦可,App 里 `<Anchors … onAnchorContextMenu={(key,x,y)=>setAnchorMenu({key,x,y})}/>`。**以 CustomEvent 为准**(改动面最小)。

- [ ] **Step 4: TopToolbar 加按钮**

`TopToolbar.tsx`:
- 新增锚点图标(16×16,风格对齐现有内联 svg——十字准星):
  ```tsx
  const AnchorIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" />
    </svg>
  )
  ```
- props 增 `onAddAnchor: () => void`;按钮插在「添加相机」之后:
  ```tsx
  <ToolbarBtn
    onClick={onAddAnchor}
    tip={t('pg.toolbar.addAnchor')}
    hint={t('pg.toolbar.addAnchor.hint')}
  >
    <AnchorIcon />
  </ToolbarBtn>
  ```

- [ ] **Step 5: App.tsx 接线**

- state 与菜单:`const [anchorMenu, setAnchorMenu] = useState<{key: string; x: number; y: number} | null>(null)`;`useEffect` 监听 `pg:anchor-context-menu`:
  ```ts
  useEffect(() => {
    const handler = (e: Event) => {
      const {key, x, y} = (e as CustomEvent).detail
      setAnchorMenu({key, x, y})
    }
    window.addEventListener('pg:anchor-context-menu', handler)
    return () => window.removeEventListener('pg:anchor-context-menu', handler)
  }, [])
  ```
- `addAnchor`(放在 `addCamera` 之后):
  ```ts
  // 添加锚点:落在当前导演视角前方约 5 单位(无导演相机退场景中心上方)
  const addAnchor = useCallback(() => {
    const key = nextAnchorKey(anchors)
    const mainCam = cameraObjRef.current
    const pos = mainCam
      ? (() => {
          const p = val(mainCam.props.position) as {x: number; y: number; z: number}
          const r = val(mainCam.props.rotation) as {x: number; y: number; z: number}
          // 导演相机 -Z 前方 5 单位(three 相机朝向约定)
          const forward = new Vector3(0, 0, -1).applyEuler(new Euler(r.x, r.y, r.z, 'XYZ'))
          return {
            x: p.x + forward.x * 5,
            y: p.y + forward.y * 5,
            z: p.z + forward.z * 5,
          }
        })()
      : {x: 0, y: 1, z: 0}
    addAnchorToRegistry(sheet, key, {position: pos})
  }, [anchors, sheet])
  ```
  import:`nextAnchorKey, addAnchorToRegistry` from './anchorsRegistry';`Vector3, Euler` from 'three'。
- 渲染:在 cameras.map 之后加 `<Anchors sheet={sheet} shotView={shotView} />`。
- `setAimOptionsSheet`:`useEffect(() => setAimOptionsSheet(sheet), [sheet])`。
- 右键菜单 JSX(参照 cameraMenu 的写法):
  ```tsx
  {anchorMenu && (
    <CanvasContextMenu
      position={{x: anchorMenu.x, y: anchorMenu.y}}
      items={buildAnchorMenuItems({
        onDeleteAnchor: () => {
          removeAnchor(sheet, anchorMenu.key)
          getStudioSync()?.setSelection([])
        },
      })}
      onClose={() => setAnchorMenu(null)}
    />
  )}
  ```
- `<TopToolbar … onAddAnchor={addAnchor} />`。

- [ ] **Step 6: 验证(tsc + jest)**

```bash
cd /Users/huhui/Projects/theatre/packages/playground && npx tsc --noEmit; echo TSC_EXIT=$?
# 预期 TSC_EXIT=0
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera; echo JEST_EXIT=$?
# 预期全绿
```

- [ ] **Step 7: 提交**

```bash
cd /Users/huhui/Projects/theatre && git add packages/playground/src/shared/camera/Anchors.tsx packages/playground/src/shared/camera/App.tsx packages/playground/src/shared/camera/TopToolbar.tsx packages/playground/src/shared/camera/menuModel.ts packages/playground/src/shared/camera/i18n.ts
git status --short
git commit -m "feat(playground): 独立锚点落地——顶栏添加、点选/拖拽/右键删除,进瞄准目标下拉

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 锚点父级绑定

**Files:**
- Modify: `packages/playground/src/shared/camera/Anchors.tsx`
- Modify: `packages/playground/src/shared/camera/aimTargets.ts`
- Modify: `packages/playground/src/shared/camera/i18n.ts`
- Test: `packages/playground/src/shared/camera/anchorParenting.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `resolveAnchorParent`、`parseTargetId`、`makeTargetId`、`getAnchorObjects`、`defaultTargetLookup`;Task 5 的 `useAnchorsList`/`getAnchorsRegistry`/`readAnchorKeys`。
- Produces:
  ```ts
  // aimTargets.ts
  export function anchorParentOptionsFor(selfKey: string): {[key: string]: string}
  // 选项 = 「无」+ 除自己/后代外的锚点 + 相机 + 放置模型 + 骨骼锚点
  export function isDescendantAnchor(
    selfKey: string,
    candidateKey: string,
    parentOf: (key: string) => string,
  ): boolean
  // Anchors.tsx(模块级,按 key 缓存配置,对齐 literalConfigCache):
  const anchorPropsFor = (key: string) => cached {parent: t.stringLiteral('', () => anchorParentOptionsFor(key), {as:'menu', label})}
  ```

- [ ] **Step 1: 写失败测试**

```ts
// packages/playground/src/shared/camera/anchorParenting.test.ts
import {Euler, Group, Matrix4, Object3D, Quaternion, Vector3} from 'three'
import {
  isDescendantAnchor,
  localOffsetForParent,
  worldPositionOf,
} from './aimTargets'

describe('isDescendantAnchor', () => {
  // 父链:A ← B ← C(C 挂 B,B 挂 A);即 B、C 都是 A 的后代,C 是 B 的后代
  const parentOf = (k: string) =>
    ({C: 'anchor:B', B: 'anchor:A', A: ''} as Record<string, string>)[k] ?? ''
  test('后代判 true;自己/祖先/旁系 false', () => {
    expect(isDescendantAnchor('A', 'B', parentOf)).toBe(true)
    expect(isDescendantAnchor('A', 'C', parentOf)).toBe(true)
    expect(isDescendantAnchor('B', 'C', parentOf)).toBe(true)
    expect(isDescendantAnchor('C', 'B', parentOf)).toBe(false) // B 是 C 的祖先
    expect(isDescendantAnchor('C', 'A', parentOf)).toBe(false)
    expect(isDescendantAnchor('C', 'C', parentOf)).toBe(false) // 自己
  })
})

describe('localOffsetForParent', () => {
  test('父级世界矩阵逆 × 子世界坐标 = 局部偏移', () => {
    const parent = new Object3D()
    parent.position.set(10, 0, 0)
    parent.updateMatrixWorld(true)
    const childWorld = new Vector3(12, 3, -1)
    const out = new Vector3()
    localOffsetForParent(childWorld, parent, out)
    expect(out.x).toBeCloseTo(2)
    expect(out.y).toBeCloseTo(3)
    expect(out.z).toBeCloseTo(-1)
  })
  test('父级带旋转也算得对', () => {
    const parent = new Object3D()
    parent.position.set(0, 5, 0)
    parent.quaternion.setFromEuler(new Euler(0, Math.PI / 2, 0))
    parent.updateMatrixWorld(true)
    // 子在世界 (1,5,0):父级绕 Y 转 90° 后,局部 = (0,0,-1)?手算:
    // 世界 = 父位置 + R × 局部 → 局部 = R⁻¹ × (世界 - 父位置)
    const out = new Vector3()
    localOffsetForParent(new Vector3(1, 5, 0), parent, out)
    expect(out.x).toBeCloseTo(0)
    expect(out.y).toBeCloseTo(0)
    expect(out.z).toBeCloseTo(-1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/anchorParenting.test.ts; echo JEST_EXIT=$?
```
预期:FAIL(函数不存在)。

- [ ] **Step 3: 实现 aimTargets.ts 追加**

```ts
/** 环检测:candidate 沿父链向上能否到达 selfKey(candidate 是 self 的后代) */
export function isDescendantAnchor(
  selfKey: string,
  candidateKey: string,
  parentOf: (key: string) => string,
): boolean {
  let cur = parentOf(candidateKey)
  let guard = 0
  while (cur && guard++ < 100) {
    if (cur === `anchor:${selfKey}`) return true
    const parsed = parseTargetId(cur)
    cur = parsed && parsed.kind === 'anchor' ? parentOf(parsed.key) : ''
  }
  return false
}

/** 世界坐标 → 父级局部偏移(纯函数,绑定/解绑定格用) */
export function localOffsetForParent(
  childWorld: Vector3,
  parentObj: Object3D,
  out: Vector3,
): Vector3 {
  parentObj.updateWorldMatrix(true, false)
  const inv = new Matrix4().copy(parentObj.matrixWorld).invert()
  return out.copy(childWorld).applyMatrix4(inv)
}

export function worldPositionOf(obj: Object3D, out: Vector3): Vector3 {
  obj.updateWorldMatrix(true, false)
  return out.copy(obj.getWorldPosition(new Vector3()))
}

/**
 * 「父级」下拉选项(锚点面板,按锚点 key 排除自己与后代防环)。
 * 候选:其他锚点 + 拍摄相机 + 放置模型 + 骨骼锚点。
 */
export function anchorParentOptionsFor(selfKey: string): {[key: string]: string} {
  const options: {[key: string]: string} = {'': translate('pg.props.parentNone')}
  if (!optionsSheet) return options
  const parentOf = (key: string): string => {
    try {
      const obj = optionsSheet.getObject(key)
      return obj ? ((val(obj.props.parent) as string | undefined) ?? '') : ''
    } catch {
      return ''
    }
  }
  try {
    for (const key of readAnchorKeys(getAnchorsRegistry(optionsSheet))) {
      if (key === selfKey) continue
      if (isDescendantAnchor(selfKey, key, parentOf)) continue
      options[makeTargetId('anchor', key)] = key
    }
  } catch {
    // 注册表未建
  }
  try {
    for (const entry of readCameraEntries(getCamerasRegistry(optionsSheet))) {
      options[makeTargetId('camera', entry.cameraKey)] =
        cameraDisplayName(entry.cameraKey)
    }
  } catch {
    // 相机注册表未建
  }
  try {
    for (const entry of readPlacementEntries(optionsSheet)) {
      options[makeTargetId('model', entry.key)] = entry.key.replace(/^Models \/ /, '')
    }
  } catch {
    // 放置注册表未建
  }
  // 骨骼锚点(分组同 aimTargetOptions)
  const byPlacement = new Map<string, BonePart[]>()
  for (const id of getBoneAnchorObjects().keys()) {
    const parsed = parseBoneAnchorId(id)
    if (!parsed) continue
    const list = byPlacement.get(parsed.placementKey) ?? []
    list.push(parsed.part)
    byPlacement.set(parsed.placementKey, list)
  }
  for (const [placementKey, parts] of byPlacement) {
    const modelName = placementDisplayName(optionsSheet, placementKey)
    for (const part of parts) {
      options[makeTargetId('bone', placementKey, part)] =
        `${modelName} · ${translate(`pg.parts.${part}`)}`
    }
  }
  return options
}
```

配套 import 增:`Vector3, Matrix4` from 'three';`val` from '@dreamerbird/core';`translate` from '@dreamerbird/studio/i18n';`readCameraEntries, getCamerasRegistry, cameraDisplayName` from './cameraRegistry';`readPlacementEntries` 已有。

- [ ] **Step 4: 实现 Anchors.tsx 的绑定逻辑**

- 模块级 props 配置(文件顶部,imports 之后):
  ```ts
  import {types as t} from '@dreamerbird/core'
  import {translate} from '@dreamerbird/studio/i18n'
  import {anchorParentOptionsFor} from './aimTargets'

  const anchorPropsCache = new Map<string, Record<string, any>>()
  function anchorPropsFor(key: string) {
    let config = anchorPropsCache.get(key)
    if (!config) {
      config = {
        parent: t.stringLiteral('', () => anchorParentOptionsFor(key), {
          label: () => translate('pg.props.anchorParent'),
          as: 'menu',
        }),
      }
      anchorPropsCache.set(key, config)
    }
    return config
  }
  ```
- `AnchorObject` 内(parent prop 读写 + 场景树父子):
  ```tsx
  // 响应式读 parent 属性(参照 ShotCamera 的 useObjPropScalar:
  // 本文件内小抄实现一份,或从 ShotCamera export 后 import——
  // 选择:把 ShotCamera.tsx 的 useObjPropScalar 加 export 关键字,
  // 这里 import {useObjPropScalar} from './ShotCamera')
  const parentId = useObjPropScalar<string>(objRef, 'parent', '')

  // 场景树父子:parent 变化 → 解析目标 → 真挂载;位置属性自动成为
  // 相对父级的局部偏移。绑定/解绑/父级消失的"画面不跳"定格见下。
  const prevParentRef = useRef<string | null>(null)
  const tmpWorld = useRef(new Vector3())
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const prev = prevParentRef.current
    prevParentRef.current = parentId
    if (prev === null) {
      // 挂载首次:持久态恢复,场景位置由包装器按属性恢复,不干预
      return
    }
    if (prev === parentId) return
    const studio = getStudioSync()
    const obj = objRef.current
    if (!studio || !obj) return
    const world = mesh.getWorldPosition(tmpWorld.current).clone()
    const newParentObj = parentId ? resolveAnchorParent(parentId) : null
    if (parentId && !newParentObj) return // 目标暂不可解析(对端时序),下帧 effect 重试
    // 先定格世界坐标进属性(一次事务),再换挂载点:
    // 挂到父级下时属性=局部偏移;解绑时属性=世界坐标。两者同式:
    // 换父后的"属性应取值" = 新父(根则恒等)矩阵逆 × 世界坐标
    if (newParentObj) newParentObj.add(mesh)
    else homeRef.current?.add(mesh)
    mesh.updateWorldMatrix(true, false)
    const local = newParentObj
      ? localOffsetForParent(world, newParentObj, tmpWorld.current)
      : world
    const scrub = studio.scrub()
    scrub.capture(({set}) =>
      set(obj.props.position, {x: local.x, y: local.y, z: local.z}),
    )
    scrub.commit()
  }, [parentId])
  ```
- 父级消失回落(目标对象被删,parentId 非空但解析不到):
  ```tsx
  // 父级消失看护:parentId 非空但解析失败 → 挂回 root 并把世界
  // 坐标定格进属性(对齐 Blender 父级消失;一次事务)
  useEffect(() => {
    if (!parentId) return
    const obj = objRef.current
    if (!obj) return
    if (resolveAnchorParent(parentId)) return
    const mesh = meshRef.current
    const studio = getStudioSync()
    if (!mesh || !studio) return
    const world = mesh.getWorldPosition(new Vector3())
    homeRef.current?.add(mesh)
    const scrub = studio.scrub()
    scrub.capture(({set}) => {
      set(obj.props.parent, '')
      set(obj.props.position, {x: world.x, y: world.y, z: world.z})
    })
    scrub.commit()
  })
  ```
  (无依赖数组:每次渲染后检查,幂等——解析得到就 return。)
- JSX 的 `<e.mesh>` 加 `additionalProps={anchorPropsFor(anchorKey)}`。

- [ ] **Step 5: ShotCamera 导出 useObjPropScalar**

`ShotCamera.tsx`:`function useObjPropScalar` → `export function useObjPropScalar`。

- [ ] **Step 6: i18n 词条**

en:`'pg.props.anchorParent': 'Parent'`、`'pg.props.parentNone': 'None'`。
zh-CN:`'pg.props.anchorParent': '父级'`、`'pg.props.parentNone': '无'`。

- [ ] **Step 7: 验证**

```bash
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera/anchorParenting.test.ts packages/playground/src/shared/camera/aimTargets.test.ts; echo JEST_EXIT=$?
# 预期 PASS
cd /Users/huhui/Projects/theatre/packages/playground && npx tsc --noEmit; echo TSC_EXIT=$?
# 预期 TSC_EXIT=0
```

- [ ] **Step 8: 提交**

```bash
cd /Users/huhui/Projects/theatre && git add packages/playground/src/shared/camera/Anchors.tsx packages/playground/src/shared/camera/aimTargets.ts packages/playground/src/shared/camera/anchorParenting.test.ts packages/playground/src/shared/camera/ShotCamera.tsx packages/playground/src/shared/camera/i18n.ts
git status --short
git commit -m "feat(playground): 锚点父级绑定——场景树真父子,绑定/解绑/父级消失均定格世界位置,下拉防环

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: 骨骼锚点接入 + 全量验证

**Files:**
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`
- Modify: `packages/playground/src/shared/camera/i18n.ts`
- Test: `packages/playground/src/shared/camera/boneAnchors.test.ts`(扩充登记用例已覆盖;本任务补一个 usePlacedInstance 无关的纯验证)

**Interfaces:**
- Consumes: Task 1 `registerBoneAnchors`/`unregisterBoneAnchors`;Task 2 `getPlacedInstances`;Task 6/7 的选项函数(骨骼数据流入后自动出现)。
- Produces:
  ```ts
  // PlacementManager.tsx
  export function getPlacedInstances(): ReadonlyMap<string, Group>
  ```

- [ ] **Step 1: PlacementManager 挂钩**

- 落实 Task 2 的占位:把 `placedInstances`  Map、`usePlacedInstance`、`getPlacedInstances` 确认存在(占位已写,本步只需接线)。
- `PlacedModelCore` 里,在登记 `placementObjects` 的同一个 effect(`useEffect(() => {placementObjects.set(sheetObject, {entry, instance}) …`)中追加:
  ```ts
  // 骨骼锚点:按实例骨架登记头/胸口/双手/双腿(运行时,非 theatre 对象)
  registerBoneAnchors(entry.key, instance)
  ```
  cleanup return 里追加:
  ```ts
  unregisterBoneAnchors(entry.key)
  ```
  以及 placedInstances 登记——用现成的 `usePlacedInstance(entry.key, instance)` hook(在组件顶层调用,不在 effect 里):
  ```ts
  usePlacedInstance(entry.key, instance)
  ```
- imports:`registerBoneAnchors, unregisterBoneAnchors` from './boneAnchors'。

- [ ] **Step 2: i18n 词条(六个部位)**

en:`'pg.parts.head': 'Head'`、`'pg.parts.chest': 'Chest'`、`'pg.parts.handL': 'Left hand'`、`'pg.parts.handR': 'Right hand'`、`'pg.parts.legL': 'Left leg'`、`'pg.parts.legR': 'Right leg'`。
zh-CN:`'pg.parts.head': '头'`、`'pg.parts.chest': '胸口'`、`'pg.parts.handL': '左手'`、`'pg.parts.handR': '右手'`、`'pg.parts.legL': '左腿'`、`'pg.parts.legR': '右腿'`。

- [ ] **Step 3: 全量自动化验证**

```bash
cd /Users/huhui/Projects/theatre/packages/playground && npx tsc --noEmit; echo TSC_EXIT=$?
# 预期 TSC_EXIT=0
cd /Users/huhui/Projects/theatre && yarn jest packages/playground/src/shared/camera; echo JEST_EXIT=$?
# 预期全绿
```

- [ ] **Step 4: 浏览器冒烟(手工,照 camera playground 运维手册)**

```bash
cd /Users/huhui/Projects/theatre/packages/playground && npx vite --port 8083
```
浏览器开 `http://localhost:8083/shared/camera/index.html`,逐项确认:
1. 顶栏出现「添加锚点」按钮,点击后场景出现橙色线框小方块、大纲出现 `Anchor 1`。
2. 拖锚点 → 位置属性跟着变;右键 → 删除锚点,大纲行消失。
3. 放置 Y Bot 模型 → 相机面板「瞄准目标」下拉出现 `Y Bot · 头` 等 6 项;选中「头」,相机盯住头部;播放模型动作(右键模型 → 播放动作),相机跟随头部移动。
4. 锚点面板「父级」下拉把锚点绑到 `Y Bot · 左手` → 锚点跳到手上;拖锚点 = 调偏移;删模型 → 锚点落回场景原位(世界坐标定格)。
5. 老行为回归:添加相机不再出现 Target 方块;相机仍能绑路径、画中画/镜头视角正常。
(用 Playwright MCP 操作;**文件选择器应答必须用 browser_file_upload**,memory 有前科。)

- [ ] **Step 5: 提交**

```bash
cd /Users/huhui/Projects/theatre && git add packages/playground/src/shared/camera/PlacementManager.tsx packages/playground/src/shared/camera/i18n.ts
git status --short
git commit -m "feat(playground): 骨骼锚点接入放置实例——相机可瞄准头/胸口/双手/双腿,动画实时跟随

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review 记录

- **规格覆盖**:解耦(§2-§5 → Task 3/4)、独立锚点(§5 → Task 5/6)、骨骼锚点(§6 → Task 1/8)、父级绑定(§7 → Task 7)、顶栏(§8 → Task 6)、i18n(§9 → 各任务内)、测试(§10 → 各任务)、风险对策(§风险 → Task 7 防环/回落、Task 8 冒烟)。用户拍板项全部落任务:不迁移(Task 3 宽容解析)、顶栏入口(Task 6)、六部位(Task 1 BONE_PARTS)、保持世界位置(Task 7 localOffsetForParent)。
- **占位符扫描**:无 TBD;所有代码步骤带完整代码。Task 4 Step 1 中出现的"占位用例"已内联说明处理方式(删除、改手工冒烟)。
- **类型一致性**:`getPlacedInstances`/`getShotCameraObjects` 在 Task 2 创建占位、Task 8 接线,签名一致;`useObjPropScalar` Task 7 改为 export,ShotCamera 内既有调用不变;`anchorParentOptionsFor`/`aimTargetOptions` 名称在 Task 2/4/6/7 间一致;`parseTargetId` 返回联合类型在 Task 2 定义、Task 7 消费一致。
