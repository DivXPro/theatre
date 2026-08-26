# 资产库 P2(姿势 + 硬化)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给资产库补姿势能力(姿势 tab、姿势套用、抽帧存姿势、删除级联提示),并修掉 P1 评审留下的硬化项。

**Architecture:** 姿势是库里的 `PoseEntry`(bones 内联,无 blob),一期已注册 `pose` theatre 属性。本期在 PlacedModelCore 加"停止时应用姿势"的联动逻辑(播放且动画非空时动画优先,与规格一致);抽帧存姿势 = 读取选中实例的骨骼状态生成 PoseEntry 入库;硬化项集中在 blob 生命周期与异步竞态。

**Tech Stack:** three.js(SkeletonUtils/AnimationMixer)、@toy-box/core(theatre props/scrub)、IndexedDB(fake-indexeddb 测试)、jest(jest-esbuild)

**Spec:** docs/superpowers/specs/2026-08-26-asset-library-design.md(分期 P2 节 + "姿势 / 动作的应用规则"节为绑定依据)

## Global Constraints

- jest 从**仓库根**跑:`yarn jest <path>`;测试文件必须 `.test.ts`(jest.config 不匹配 .tsx);jest-esbuild **不提升 jest.mock** —— 用依赖注入或运行时 require。
- fake-indexeddb 对无效 key 静默宽容(真实 IDB 抛错)——涉及删除路径的测试要断言"数据仍在/已删"的最终状态,不依赖抛错。
- 类型检查:`cd packages/playground && yarn typecheck` 必须绿。
- 库 blob URL 由 backend 会话级缓存统一管理,**任何代码不得 revoke**(一期裁定)。
- 注释用中文,风格与周边一致;提交信息中文,结尾带 `Co-Authored-By: Claude <noreply@anthropic.com>`;每个任务一个提交,只提交该任务点名的文件。
- 工作目录:仓库根 /Users/huhui/Projects/theatre,直接在 main 上工作(沿用 fork 惯例,已获用户同意)。
- 浏览器验证由控制器在每个 UI 任务后执行,实现者不跑 dev server。
- Playwright 文件选择器必须用 browser_file_upload 应答,不得在 run_code 里应答(幻影堆积)。

---

### Task 1: 姿势骨骼工具(pose.ts)

**Files:**
- Create: `packages/playground/src/shared/camera/assetLibrary/pose.ts`
- Test: `packages/playground/src/shared/camera/assetLibrary/pose.test.ts`

**Interfaces:**
- Consumes: `PoseEntry['bones']`(types.ts,已存在)
- Produces: `capturePose(root: Object3D): PoseEntry['bones']`;`applyPose(root: Object3D, bones: PoseEntry['bones']): {applied: number; missed: string[]}`;`captureBindPose = capturePose`(同一函数,语义别名)

要点:遍历 `root` 下所有 `isBone` 节点,按骨骼名记录四元数(4)与位置(3);applyPose 按名寻址设置,找不到的骨骼名计入 missed 跳过。纯 three 数学,无 DOM 依赖,jsdom 可直接测。

- [ ] **Step 1: 写失败测试**

```ts
import {Bone, Group} from 'three'
import {applyPose, capturePose} from './pose'

function makeRig(): {root: Group; hips: Bone; spine: Bone} {
  const root = new Group()
  const hips = new Bone()
  hips.name = 'hips'
  const spine = new Bone()
  spine.name = 'spine'
  hips.add(spine)
  root.add(hips)
  return {root, hips, spine}
}

describe('capturePose / applyPose', () => {
  test('capture 记录每根骨骼的旋转与位置', () => {
    const {root, hips} = makeRig()
    hips.quaternion.set(0, 0, Math.SQRT1_2, Math.SQRT1_2)
    hips.position.set(1, 2, 3)
    const pose = capturePose(root)
    expect(Object.keys(pose).sort()).toEqual(['hips', 'spine'])
    expect(pose.hips.rotation![2]).toBeCloseTo(Math.SQRT1_2)
    expect(pose.hips.position).toEqual([1, 2, 3])
  })

  test('apply 把骨骼恢复到 capture 时的状态(往返)', () => {
    const {root, hips, spine} = makeRig()
    hips.quaternion.set(0.1, 0.2, 0.3, 0.9).normalize()
    spine.position.set(0, 5, 0)
    const pose = capturePose(root)
    hips.quaternion.set(0, 0, 0, 1)
    spine.position.set(9, 9, 9)
    const r = applyPose(root, pose)
    expect(r.applied).toBe(2)
    expect(r.missed).toEqual([])
    expect(hips.quaternion.x).toBeCloseTo(0.1, 5)
    expect(spine.position.y).toBe(5)
  })

  test('apply 跳过实例里不存在的骨骼名,计入 missed', () => {
    const {root} = makeRig()
    const r = applyPose(root, {
      ghost: {rotation: [0, 0, 0, 1]},
      hips: {position: [7, 0, 0]},
    })
    expect(r.applied).toBe(1)
    expect(r.missed).toEqual(['ghost'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn jest packages/playground/src/shared/camera/assetLibrary/pose.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现 pose.ts**

```ts
import type {Object3D} from 'three'
import type {PoseEntry} from './types'

/** 抓取骨骼树当前状态为姿势数据:按骨骼名记录四元数与位置 */
export function capturePose(root: Object3D): PoseEntry['bones'] {
  const bones: PoseEntry['bones'] = {}
  root.traverse((o) => {
    if ((o as {isBone?: boolean}).isBone) {
      bones[o.name] = {
        rotation: o.quaternion.toArray() as [number, number, number, number],
        position: o.position.toArray() as [number, number, number],
      }
    }
  })
  return bones
}

/** 语义别名:实例刚克隆出来时的 capture 即绑定姿势,用于"无姿势"时还原 */
export const captureBindPose = capturePose

/**
 * 把姿势数据按骨骼名写回骨骼树。实例里没有的骨骼名跳过并计入
 * missed(跨族套用由调用方先过滤,这里只兜底)。
 */
export function applyPose(
  root: Object3D,
  bones: PoseEntry['bones'],
): {applied: number; missed: string[]} {
  const byName = new Map<string, Object3D>()
  root.traverse((o) => {
    if ((o as {isBone?: boolean}).isBone) byName.set(o.name, o)
  })
  let applied = 0
  const missed: string[] = []
  for (const [name, v] of Object.entries(bones)) {
    const bone = byName.get(name)
    if (!bone) {
      missed.push(name)
      continue
    }
    if (v.rotation) bone.quaternion.fromArray(v.rotation)
    if (v.position) bone.position.fromArray(v.position)
    applied++
  }
  return {applied, missed}
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `yarn jest packages/playground/src/shared/camera/assetLibrary/pose.test.ts`
Expected: 3 passed

- [ ] **Step 5: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/pose.ts packages/playground/src/shared/camera/assetLibrary/pose.test.ts
git commit -m "feat(playground): 姿势骨骼工具(抓取/应用/绑定姿势还原)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: blob 生命周期硬化(共享缩略图保护 + 孤儿清理)

**Files:**
- Modify: `packages/playground/src/shared/camera/assetLibrary/types.ts`(接口加 listBlobIds)
- Modify: `packages/playground/src/shared/camera/assetLibrary/indexedDBBackend.ts`
- Modify: `packages/playground/src/shared/camera/assetLibrary/library.ts`
- Test: `packages/playground/src/shared/camera/assetLibrary/library.test.ts`(追加 describe,先看现有写法再续)

**Interfaces:**
- Consumes: 现有 Library/IndexedDBBackend
- Produces: `LibraryBackend.listBlobIds(): Promise<string[]>`(接口新成员,HTTP 实现待补时在适配层文档注明);`Library.deleteEntryDeep(id: string): Promise<void>`(删条目 + 清理其 blob:模型 blobId 与 thumbnailId,仅当无其他条目引用时才删);`Library.sweepOrphanBlobs(): Promise<number>`(删无引用 blob,返回删除数)

要点:
- 引用集合 = 所有条目的 `blobId` + 模型的 `thumbnailId`(姿势条目无 blob)。
- `getLibrary()` 首次创建后 fire-and-forget 调一次 `sweepOrphanBlobs()`(catch 打 console.warn,不阻塞)。
- 面板的 `removeEntry` 后续任务改调 `deleteEntryDeep`(本任务只落库层)。

- [ ] **Step 1: 写失败测试(追加到 library.test.ts)**

```ts
describe('blob 生命周期', () => {
  test('deleteEntryDeep: 缩略图被两个模型共享时,删一个不删 blob', async () => {
    const lib = new Library(new IndexedDBBackend())
    const thumbId = await lib.backend.putBlob(new Blob(['thumb']))
    const model = (id: string) => ({
      id, kind: 'model' as const, name: id, rig: 'static', blobId: 'b-' + id,
      contentHash: 'h-' + id, thumbnailId: thumbId, boneCount: 0, vertexCount: 1, createdAt: 1,
    })
    await lib.putEntry(model('m1'))
    await lib.putEntry(model('m2'))
    await lib.deleteEntryDeep('m1')
    // 共享缩略图仍在;m1 自己的模型 blob 不在本次放入(不影响断言)
    expect(await lib.backend.listBlobIds()).toContain(thumbId)
  })

  test('deleteEntryDeep: 独占 blob 随条目删除', async () => {
    const lib = new Library(new IndexedDBBackend())
    const blobId = await lib.backend.putBlob(new Blob(['glb']))
    await lib.putEntry({
      id: 'm1', kind: 'model', name: 'm1', rig: 'static', blobId,
      contentHash: 'h', boneCount: 0, vertexCount: 1, createdAt: 1,
    })
    await lib.deleteEntryDeep('m1')
    expect(await lib.backend.listBlobIds()).not.toContain(blobId)
  })

  test('sweepOrphanBlobs: 清掉无引用 blob,保留有引用的', async () => {
    const lib = new Library(new IndexedDBBackend())
    const used = await lib.backend.putBlob(new Blob(['used']))
    const orphan = await lib.backend.putBlob(new Blob(['orphan']))
    await lib.putEntry({
      id: 'a1', kind: 'animation', name: 'a1', rig: 'r', blobId: used,
      contentHash: 'h', duration: 1, createdAt: 1,
    })
    expect(await lib.sweepOrphanBlobs()).toBe(1)
    const ids = await lib.backend.listBlobIds()
    expect(ids).toContain(used)
    expect(ids).not.toContain(orphan)
  })
})
```

注意:现有 library.test.ts 若已用 fake-indexeddb,沿用其 setup;IndexedDB 是进程级共享,测试间用不同 blob 内容(哈希不同)避免互相污染。

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn jest packages/playground/src/shared/camera/assetLibrary/library.test.ts`
Expected: FAIL(listBlobIds / deleteEntryDeep / sweepOrphanBlobs 不存在)

- [ ] **Step 3: 实现**

types.ts 接口加:

```ts
  /** 列出全部 blob id(孤儿清理用);HTTP 实现后续补 */
  listBlobIds(): Promise<string[]>
```

indexedDBBackend.ts 加:

```ts
  async listBlobIds(): Promise<string[]> {
    const db = await this.db()
    const req = db.transaction('blobs', 'readonly').objectStore('blobs').getAllKeys()
    return (await requestToPromise(req)) as string[]
  }
```

library.ts 加(收集引用时遍历全部条目,模型带 thumbnailId):

```ts
  /** 所有条目引用的 blob id 集合(模型 blobId + thumbnailId) */
  private async referencedBlobIds(): Promise<Set<string>> {
    const entries = await this.backend.listEntries()
    const ids = new Set<string>()
    for (const e of entries) {
      if ('blobId' in e) ids.add(e.blobId)
      if (e.kind === 'model' && e.thumbnailId) ids.add(e.thumbnailId)
    }
    return ids
  }

  /** 删条目并清理它的 blob;blob 被其他条目共享时保留 */
  async deleteEntryDeep(id: string): Promise<void> {
    const entry = await this.backend.getEntry(id)
    if (!entry) return
    const own: string[] = []
    if ('blobId' in entry) own.push(entry.blobId)
    if (entry.kind === 'model' && entry.thumbnailId) own.push(entry.thumbnailId)
    await this.backend.deleteEntry(id)
    const referenced = await this.referencedBlobIds()
    for (const blobId of own) {
      if (!referenced.has(blobId)) await this.backend.deleteBlob(blobId)
    }
    this.emit()
  }

  /** 清理无条目引用的孤儿 blob,返回删除数量 */
  async sweepOrphanBlobs(): Promise<number> {
    const referenced = await this.referencedBlobIds()
    const all = await this.backend.listBlobIds()
    let n = 0
    for (const id of all) {
      if (!referenced.has(id)) {
        await this.backend.deleteBlob(id)
        n++
      }
    }
    return n
  }
```

`getLibrary()` 单例创建后补一次启动清理:

```ts
export function getLibrary(): Library {
  if (!singleton) {
    singleton = new Library(new IndexedDBBackend())
    // 启动时清理孤儿 blob(上次导入中断等留下的),失败不阻塞
    void singleton.sweepOrphanBlobs().catch((err) => {
      console.warn('[assetLibrary] 孤儿 blob 清理失败', err)
    })
  }
  return singleton
}
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `yarn jest packages/playground && cd packages/playground && yarn typecheck`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/{types,indexedDBBackend,library}.ts packages/playground/src/shared/camera/assetLibrary/library.test.ts
git commit -m "feat(playground): blob 生命周期硬化(共享缩略图保护+孤儿清理)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 前端生命周期硬化(dispose / 竞态 / action 缓存 / rig 加载态)

**Files:**
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`
- Modify: `packages/playground/src/shared/camera/App.tsx`

**Interfaces:**
- Consumes: 现状 P1 代码
- Produces: 无新接口(行为修复)

要点(四项,一个任务内分步提交前一起过类型检查):
1. **GLTF dispose**:`LibraryPlacedModel` 与 `PlacementRigGLTF` 加载成功的 Group,在卸载/URL 变化时遍历 dispose(geometry.dispose();material 数组逐个,连同 material.map 等纹理 dispose)。抽一个 `disposeObjectTree(root: Object3D)` 放 `assetLibrary/dispose.ts`,PlacedModelCore 的 instance 卸载时也调它(SkeletonUtils.clone 的克隆体共享 geometry,dispose 克隆体引用即可——three 的 dispose 是释放 GPU 资源,源 Group 若也卸载属正常;当前实例随条目删除即整体不再使用,安全)。
2. **startPlacingFromLibrary 竞态**:controller 内加 generation 计数,resolve 时若不是最新一次则丢弃;App 侧调用处 `.catch((err) => console.warn('[placement] 库模型加载失败', err))` 替换裸 `void`。
3. **mixer action 缓存**:clip 切换 effect 里,旧 action fadeOut 后 `mixer.uncacheAction(oldClip, instance)`;currentActionRef 更新前执行。
4. **rig 加载态**:App 的 selectedRig 解析期间(getEntry await 中)传 `rigLoading` 给面板,面板动画/姿势卡在此期间与"未选中"同等置灰(面板 prop 先加 `disabled?: boolean`,姿势 tab 在 Task 5 才用,本任务先接动画卡)。

- [ ] **Step 1: disposeObjectTree + 三处接入 + 三项修复**

dispose.ts:

```ts
import type {Material, Object3D, Texture} from 'three'

/** 递归释放对象树的 GPU 资源(几何体/材质/纹理),实例卸载时调用 */
export function disposeObjectTree(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as {isMesh?: boolean; geometry?: {dispose(): void}; material?: Material | Material[]}
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const m of mats) {
      for (const v of Object.values(m)) {
        if ((v as Texture | null)?.isTexture) (v as Texture).dispose()
      }
      m.dispose()
    }
  })
}
```

- [ ] **Step 2: 类型检查 + 全量测试**

Run: `yarn jest packages/playground && cd packages/playground && yarn typecheck`
Expected: 全绿

- [ ] **Step 3: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/dispose.ts packages/playground/src/shared/camera/PlacementManager.tsx packages/playground/src/shared/camera/App.tsx
git commit -m "fix(playground): 前端生命周期硬化(dispose/竞态/action缓存/rig加载态)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 姿势应用(停止时摆姿势,播放时动画优先)

**Files:**
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`

**Interfaces:**
- Consumes: Task 1 的 `captureBindPose`/`applyPose`;`PoseEntry`(types.ts)
- Produces: PlacedModelCore 的姿势联动行为(Task 5/6 依赖的"pose 属性生效")

要点(绑定 spec"姿势 / 动作的应用规则"节):
- `const poseId = useVal(sheetObject?.props.pose) ?? ''`
- bind pose:instance 创建时 `bindPoseRef.current = captureBindPose(instance)`
- 姿势数据:poseId 变化 → `getLibrary().backend.getEntry(poseId)`(姿势条目 bones 内联,无 blob 加载)→ `setPoseBones(entry?.kind === 'pose' ? entry.bones : null)`;空 id → null。带 cancelled 标志。
- 应用规则 effect(依赖 playing 用 `onChange(sheet.sequence.pointer.playing, ...)` 订阅,poseBones 用 state):
  - **playing=false**:applyPose(instance, poseBones ?? bindPose);调 invalidate()(demand 帧循环下手动画一帧)。播放中→停止的跳变同一路径覆盖(mixer 不再 update,骨骼值即最终画面)。
  - **playing=true 且 animationId 为空**:不动(骨骼保持姿势,mixer 不驱动,模型静止于姿势)。
  - **playing=true 且 animationId 非空**:现状(clip effect 驱动)。
- poseId 变化且当前非播放 → 立即应用(撤销/重做也走这条)。
- 注释写明:旧 action fadeOut 残余权重在停止后由 applyPose 直接覆盖,无需 stopAllAction。

- [ ] **Step 1: 实现姿势联动**

- [ ] **Step 2: 类型检查 + 全量测试**

Run: `yarn jest packages/playground && cd packages/playground && yarn typecheck`
Expected: 全绿

- [ ] **Step 3: 提交**

```bash
git add packages/playground/src/shared/camera/PlacementManager.tsx
git commit -m "feat(playground): 已放置模型停止时应用姿势(播放时动画优先)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 姿势 tab + 套用 + 不同族提示 + 删除级联提示

**Files:**
- Modify: `packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx`
- Modify: `packages/playground/src/shared/camera/App.tsx`
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`(placementObjects 值结构 + 导出用量统计)

**Interfaces:**
- Consumes: Task 2 的 `deleteEntryDeep`;Task 3 的面板 `disabled` prop;Task 4 的 pose 行为
- Produces: 面板 props 增加 `onApplyPose?: (entry: PoseEntry) => void`;`PlacementManager` 导出 `countLibraryEntryUsage(entryId: string): number`;placementObjects 值从 `PlacementEntry` 变 `{entry: PlacementEntry; instance: Group}`(Task 6 抽帧用 instance)

要点:
1. **placementObjects 结构**:Map<ISheetObject, {entry, instance}>;PlacedModelCore 登记处与 App 反查处同步改。导出:

```ts
/** 统计场景里引用某库条目的已放置实例数(模型本体/动作/姿势三种引用) */
export function countLibraryEntryUsage(entryId: string): number {
  let n = 0
  for (const {entry} of placementObjects.values()) {
    if (entry.libraryEntryId === entryId) n++
  }
  return n
}
```
   animation/pose 的引用在 theatre props 上,不在 PlacementEntry——用量统计改扫 props:`val(obj.props.animation) === entryId || val(obj.props.pose) === entryId`(map 的 key 是 sheetObject,遍历 entries() 拿 obj)。删除提示文案:`删除「name」?场景中有 N 个实例正在使用它,删除后这些实例将回退为绑定姿势/无动作。` N=0 时维持原文案。
2. **姿势 tab**:Tab 联合加 'pose';`useLibraryEntries('pose')`;卡片 🧍 + 名称 + 族标签 + 右键菜单(复用);删除统一改调 `deleteEntryDeep`(模型/动作/姿势三类都走,模型才涉及 blob,姿势条目无 blob 自然只删元数据)。
3. **套用**:面板加 `onApplyPose`;App 侧与 onApplyAnimation 同一选中对象,一次 scrub 提交 `set(obj.props.pose, entry.id)`。未选中/多选/`disabled`(rig 解析中)置灰。
4. **不同族提示**(spec P2):选中模型时,姿势/动作列表**不再过滤隐藏**,同族排前、不同族置灰且标签旁加"骨架不匹配"提示;filterRig 提示条文案改为"只列出同骨架族的条目可套用,不同族的已置灰"。未选中时行为不变(全量列出,均置灰)。

- [ ] **Step 1: placementObjects 结构 + countLibraryEntryUsage**

- [ ] **Step 2: 面板姿势 tab + 不同族置灰 + 删除走 deleteEntryDeep + 级联提示**

- [ ] **Step 3: App 接 onApplyPose(scrub 一步撤销)**

- [ ] **Step 4: 类型检查 + 全量测试**

Run: `yarn jest packages/playground && cd packages/playground && yarn typecheck`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx packages/playground/src/shared/camera/App.tsx packages/playground/src/shared/camera/PlacementManager.tsx
git commit -m "feat(playground): 姿势 tab(套用/不同族置灰/删除级联提示)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 抽帧存姿势

**Files:**
- Modify: `packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx`
- Modify: `packages/playground/src/shared/camera/App.tsx`
- Modify: `packages/playground/src/shared/camera/PlacementManager.tsx`(导出按选中对象取实例的 helper)

**Interfaces:**
- Consumes: Task 1 的 `capturePose` + rig.ts 的 `rigIdOf`;Task 5 的 placementObjects 新结构
- Produces: `PlacementManager` 导出 `getSelectedPlacementInstance(obj: ISheetObject): {entry: PlacementEntry; instance: Group} | undefined`(或直接让面板/App 用 placementObjects.get);面板姿势 tab 顶部"存当前姿势"按钮

要点:
- 按钮位置:姿势 tab 顶部工具行(过滤提示条旁边/下方);"存当前姿势"。
- 交互:选中一个已放置的**带骨架**模型时可用(否则置灰,title 说明"先选中一个带骨架的已放置模型");点击 → `window.prompt('姿势名称', `姿势-${条目数+1}`)`,确认后 `capturePose(instance)` → `rigIdOf(instance)` → `putEntry({id: 新 id, kind: 'pose', name, rig, bones, createdAt: Date.now()})`(id 生成沿用 importPipeline 的 `'lib-' + Math.random().toString(36).slice(2,10)`)。
- 当前骨骼状态即"停止时用户看到的姿势"(Task 4 生效后,停止时骨骼 = pose ?? bind;播放中截取也允许,截的是当前帧)。
- App 把选中的 sheetObject 传给面板已有通道(selectedObj state),按钮逻辑可整体放 App 回调 `onSavePose: () => Promise<void>` 传给面板,面板只负责按钮与置灰。

- [ ] **Step 1: helper 导出 + App onSavePose 回调**

- [ ] **Step 2: 面板按钮 + 置灰**

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `yarn jest packages/playground && cd packages/playground && yarn typecheck`
Expected: 全绿

- [ ] **Step 4: 提交**

```bash
git add packages/playground/src/shared/camera/assetLibrary/AssetLibraryPanel.tsx packages/playground/src/shared/camera/App.tsx packages/playground/src/shared/camera/PlacementManager.tsx
git commit -m "feat(playground): 抽帧存姿势(当前骨骼状态一键入库)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 自我评审记录

- Spec 覆盖:P2 分期节三项(静态姿势含两条来源、姿势 tab、删除级联提示)对应 Task 1/4/6、Task 5、Task 5;"不同族条目标记不匹配原因(P2 加提示)"在 Task 5;硬化项对应 Task 2/3(共享缩略图 Important、blob 孤儿化、dispose、竞态、action 缓存、rig 加载态)。手动摆骨骼(骨骼级编辑 UI)经用户确认不做,留后续。
- 占位符检查:Task 1/2 代码完整;Task 3-6 为 UI/集成代码按结构+关键代码给出(浏览器验证收口),逻辑代码完整。
- 类型一致性:PoseEntry.bones 内联无 blob(Task 4 不走路径 getBlobUrl);placementObjects 新结构在 Task 5 定义、Task 6 消费;deleteEntryDeep/sweepOrphanBlobs/listBlobIds 三个名字全计划一致;面板 prop 名 onApplyPose/disabled 一致。
