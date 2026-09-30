# 大纲树对象操作实施计划（右键菜单复制/粘贴/显示名重命名/删除 + 宿主扩展点 + 伪集合）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 studio 大纲树对象行加上右键菜单（复制/粘贴/重命名/删除），用显示层投影实现 Blender 式组织能力（显示名 + 伪集合），并给宿主（camera 场景）提供 `outlineObjectMenu` 扩展点接管删除。

**Architecture:** 方案 A——通用能力 studio 内置，删除项可被宿主以 `role:'delete'` 接管。存储完全走显示层：显示名与伪集合存 studio historic 新切片（随项目持久化），不碰 core 的 byObject 存储键。复制粘贴以"模板结构指纹"把关（只拷静态值，不拷关键帧）。

**Tech Stack:** TypeScript / React 19 / dataverse(useVal/usePrism/Atom) / saaz 状态(schema.ts stateEditors) / chordial 右键菜单 / 仓库 jest(jest-esbuild)。

**Spec:** `docs/superpowers/specs/2026-09-20-outline-tree-ops-design.md`（本计划据此编写；冲突处以 spec 为准）

## Global Constraints

- 所有新词条 en + zh-CN 双语，进 `packages/studio/src/i18n/dicts/{en,zh-CN}.ts`；消费用 `useT()`/`translate`（菜单构建在点开时渲染，translate 直读即热切换）。两词典 key 集合必须一致（本计划新增 parity 单测守住）。
- 指纹只取结构：顶层键 + 各 propType 的 `type` 名 + compound 子键树；**不含**函数/选项/默认值。宁可保守禁用粘贴，不可误粘贴。
- 任一扩展菜单项带 `role:'delete'` → 该对象的内置删除项被隐藏（spec §1）。
- 显示名优先级：显示名 > `overrideLabel` > `objectKey`；提交空字符串 = 清除显示名（spec §3）。
- 伪集合：扁平、单归属（一个对象至多一个集合）；`members` 存 objectKey 字符串；成员真删后名单残留由渲染求交忽略（spec §4）。
- 重命名/集合都是显示状态，**绝不写 core 存储**（不动 `staticOverrides.byObject` / `tracksByObject` 的键）。
- 测试命令：仓库根 `yarn jest <相对路径>`；类型检查：`npx tsc --noEmit -p packages/<pkg>`。
- 提交信息中文 conventional（`feat(studio): …` 等），末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；只 stage 本任务涉及的文件（仓库有无关未跟踪文件）。
- TDD：先写失败测试，再实现。

## 已知机制偏差（相对 spec 措辞，功能不变）

1. **新建集合的内联输入用"行内编辑态"实现**，不用 chordial invoke popover——chordial 菜单项不支持 per-item popover（`invoke` 是元素级，弹 popover 会替换整个菜单）。行内输入框 + placeholder 达到同样的"内联输入名称"效果，且与重命名交互一致。
2. camera 词条复用已有 `pg.menu.delete`（spec §5 允许"复用词即可"），不新增 `pg.outline.delete`。

## 文件结构

新建：
- `packages/studio/src/panels/OutlinePanel/outlineOps/addressKey.ts` — 对象地址稳定序列化
- `packages/studio/src/panels/OutlinePanel/outlineOps/fingerprint.ts` — 模板结构指纹
- `packages/studio/src/panels/OutlinePanel/outlineOps/clipboard.ts` — 对象快照/会话剪贴板/粘贴
- `packages/studio/src/panels/OutlinePanel/outlineOps/collectOutlineMenuItems.ts` — 菜单装配纯函数
- `packages/studio/src/panels/OutlinePanel/outlineOps/stateOps.ts` — 显示名/集合/删除的事务封装
- `packages/studio/src/panels/OutlinePanel/outlineOps/useOutlineObjectMenu.ts` — 对象行菜单 hook
- `packages/studio/src/panels/OutlinePanel/ObjectsList/CollectionItem.tsx` — 集合行
- `packages/studio/src/panels/OutlinePanel/outlineOps/fingerprint.test.ts`
- `packages/studio/src/panels/OutlinePanel/outlineOps/clipboard.test.ts`
- `packages/studio/src/panels/OutlinePanel/outlineOps/collectOutlineMenuItems.test.ts`
- `packages/studio/src/i18n/dicts/parity.test.ts`
- `packages/sync-server/src/state/schema.test.ts`
- `packages/playground/src/shared/camera/outlineObjectMenu.ts`
- `packages/playground/src/shared/camera/outlineObjectMenu.test.ts`

修改：
- `packages/core/src/types/public.ts` — `OutlineMenuItem`/`OutlineObjectMenuContribution` 类型 + `IExtension.outlineObjectMenu`
- `packages/core/src/types/private/studio/historic.ts` — `StudioHistoricStateProject` 加两个可选切片
- `packages/sync-server/src/state/schema.ts` — `stateEditors.studio.historic.projects.stateByProjectId.outline` 命名空间
- `packages/studio/src/i18n/dicts/en.ts` / `zh-CN.ts` — `outline.ctx.*` 词条
- `packages/studio/src/panels/OutlinePanel/BaseItem.tsx` — 行内编辑态
- `packages/studio/src/panels/OutlinePanel/ObjectsList/ObjectItem.tsx`、`ObjectsList.tsx` — 接线/集合行/空白处菜单
- `packages/studio/src/panels/OutlinePanel/outlinePanelUtils.ts` — 折叠 itemKey 支持集合
- `packages/playground/src/shared/camera/App.tsx` — extend + ctx 刷新

---

### Task 1: core 扩展协议类型（`outlineObjectMenu`）

**Files:**
- Modify: `packages/core/src/types/public.ts`（`IExtension` 定义在 ~1180 行，`ISheetObject`/`UnknownShorthandCompoundProps` 同文件，无需新 import）

**Interfaces:**
- Produces（后续任务依赖，签名必须逐字一致）:
  ```ts
  export type OutlineMenuItem = {
    type: 'normal'
    label: string
    onSelect: () => void
    enabled?: boolean
    /** role: 'delete' 表示该项接管 studio 内置删除（studio 不再显示默认删除项） */
    role?: 'delete'
  }
  export type OutlineObjectMenuContribution = {items: OutlineMenuItem[]}
  // IExtension 新增可选字段:
  // outlineObjectMenu?: (object: ISheetObject<UnknownShorthandCompoundProps>) => OutlineObjectMenuContribution | undefined
  ```

- [ ] **Step 1: 在 `IExtension`（`panes?` 字段之后）加字段，并在 `IExtension` 定义之前加两个类型**

```ts
export type OutlineMenuItem = {
  type: 'normal'
  label: string
  onSelect: () => void
  enabled?: boolean
  /** role: 'delete' 表示该项接管 studio 内置删除（studio 不再显示默认删除项） */
  role?: 'delete'
}

export type OutlineObjectMenuContribution = {items: OutlineMenuItem[]}
```

`IExtension` 内、`panes?: Array<PaneClassDefinition>` 之后：

```ts
  /**
   * 大纲树对象行右键菜单扩展：按对象返回追加菜单项。
   * studio 把各扩展（注册顺序）返回的 items 追加在内置项之后；
   * 任一 item 带 role: 'delete' 时，该对象的内置删除项被隐藏
   * （宿主接管删除，如注册表式对象需要"注册表移除 + 组件卸载 +
   * forgetObject"三步真删的场景）。
   */
  outlineObjectMenu?: (
    object: ISheetObject<UnknownShorthandCompoundProps>,
  ) => OutlineObjectMenuContribution | undefined
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit -p packages/core`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/public.ts
git commit -m "feat(core): IExtension 新增 outlineObjectMenu 扩展点——宿主可按对象贡献大纲右键菜单项,role:'delete' 接管内置删除"
```

---

### Task 2: studio historic 状态切片（显示名 + 伪集合）与 stateEditors

**Files:**
- Modify: `packages/core/src/types/private/studio/historic.ts:106-108`（`StudioHistoricStateProject`）
- Modify: `packages/sync-server/src/state/schema.ts`（`stateByProjectId` 命名空间内、`stateBySheetId` 之后插入 `outline` 命名空间；`historic.ts` 的 type import 块 ~39-47；`public` 的 type import 块 ~10-26）
- Test: `packages/sync-server/src/state/schema.test.ts`（新建）

**Interfaces:**
- Produces:
  - `OutlineCollectionState`（core historic.ts 导出）: `{id: string; name: string; members: string[]}`
  - `StudioHistoricStateProject` 新增可选字段 `outlineNamesByObjectAddress?: StrictRecord<string, string>`、`outlineCollections?: OutlineCollectionState[]`
  - stateEditors 路径（组件/封装层调用形式，事务内自动注入 draft/api）:
    - `stateEditors.studio.historic.projects.stateByProjectId.outline.setObjectDisplayName({projectId, addressKey, name})` — 空串清除
    - `…outline.addCollection({projectId, id, name})`
    - `…outline.renameCollection({projectId, id, name})`
    - `…outline.deleteCollection({projectId, id})`
    - `…outline.addCollectionMember({projectId, collectionId, objectKey})` — 单归属：先移出其他集合
    - `…outline.removeCollectionMember({projectId, collectionId, objectKey})`
    - `…outline.removeObjectFromAllCollections({projectId, objectKey})`

- [ ] **Step 1: 写失败测试 `packages/sync-server/src/state/schema.test.ts`**

```ts
import {stateEditors} from '@dreamerbird/sync-server/state/schema'
import type {OutlineCollectionState} from '@dreamerbird/core/types/private/studio'

function makeDraft(): any {
  return {
    historic: {projects: {stateByProjectId: {}}},
    ahistoric: {projects: {stateByProjectId: {}}},
    ephemeral: {projects: {stateByProjectId: {}}},
  }
}
const outline = stateEditors.studio.historic.projects.stateByProjectId.outline

describe('outline 显示名', () => {
  it('setObjectDisplayName 写入名称', () => {
    const draft = makeDraft()
    outline.setObjectDisplayName(draft, {}, {
      projectId: 'p1',
      addressKey: '{"k":1}',
      name: '主角相机',
    })
    expect(
      draft.historic.projects.stateByProjectId.p1
        .outlineNamesByObjectAddress['{"k":1}'],
    ).toBe('主角相机')
  })

  it('空字符串清除名称', () => {
    const draft = makeDraft()
    outline.setObjectDisplayName(draft, {}, {projectId: 'p1', addressKey: 'a', name: 'X'})
    outline.setObjectDisplayName(draft, {}, {projectId: 'p1', addressKey: 'a', name: '  '})
    expect(
      draft.historic.projects.stateByProjectId.p1.outlineNamesByObjectAddress,
    ).toEqual({})
  })
})

describe('outline 伪集合', () => {
  const base = {projectId: 'p1'}

  it('addCollection 追加空集合', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: '集合 1'})
    const collections: OutlineCollectionState[] =
      draft.historic.projects.stateByProjectId.p1.outlineCollections
    expect(collections).toEqual([{id: 'c1', name: '集合 1', members: []}])
  })

  it('renameCollection 改名', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.renameCollection(draft, {}, {...base, id: 'c1', name: 'B'})
    expect(draft.historic.projects.stateByProjectId.p1.outlineCollections[0].name).toBe('B')
  })

  it('deleteCollection 解散集合不动成员对象', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.addCollectionMember(draft, {}, {...base, collectionId: 'c1', objectKey: 'Obj'})
    outline.deleteCollection(draft, {}, {...base, id: 'c1'})
    expect(draft.historic.projects.stateByProjectId.p1.outlineCollections).toEqual([])
  })

  it('addCollectionMember 单归属:移入新集合时自动移出旧集合', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.addCollection(draft, {}, {...base, id: 'c2', name: 'B'})
    outline.addCollectionMember(draft, {}, {...base, collectionId: 'c1', objectKey: 'Obj'})
    outline.addCollectionMember(draft, {}, {...base, collectionId: 'c2', objectKey: 'Obj'})
    const collections =
      draft.historic.projects.stateByProjectId.p1.outlineCollections
    expect(collections[0].members).toEqual([])
    expect(collections[1].members).toEqual(['Obj'])
  })

  it('removeCollectionMember 移出', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.addCollectionMember(draft, {}, {...base, collectionId: 'c1', objectKey: 'Obj'})
    outline.removeCollectionMember(draft, {}, {...base, collectionId: 'c1', objectKey: 'Obj'})
    expect(
      draft.historic.projects.stateByProjectId.p1.outlineCollections[0].members,
    ).toEqual([])
  })

  it('removeObjectFromAllCollections 清掉所有名单残留', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.addCollection(draft, {}, {...base, id: 'c2', name: 'B'})
    outline.addCollectionMember(draft, {}, {...base, collectionId: 'c1', objectKey: 'Obj'})
    outline.addCollectionMember(draft, {}, {...base, collectionId: 'c2', objectKey: 'Obj'})
    outline.removeObjectFromAllCollections(draft, {}, {...base, objectKey: 'Obj'})
    const collections =
      draft.historic.projects.stateByProjectId.p1.outlineCollections
    expect(collections[0].members).toEqual([])
    expect(collections[1].members).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn jest packages/sync-server/src/state/schema.test.ts`
Expected: FAIL（`outline` 命名空间不存在 / setObjectDisplayName 不是函数）

- [ ] **Step 3: core 类型——`packages/core/src/types/private/studio/historic.ts`**

`StudioHistoricStateProject` 改为：

```ts
/** See {@link StudioHistoricState} */
export type StudioHistoricStateProject = {
  stateBySheetId: StrictRecord<SheetId, StudioHistoricStateProjectSheet>
  /**
   * 大纲显示名（key = 对象地址的稳定 JSON，见 outlineOps/addressKey.ts）。
   * 只影响显示，不触碰 core 存储键。
   */
  outlineNamesByObjectAddress?: StrictRecord<string, string>
  /** 伪集合：显示层名单（扁平、单归属），members 存 objectKey */
  outlineCollections?: OutlineCollectionState[]
}

export type OutlineCollectionState = {
  id: string
  name: string
  members: string[]
}
```

- [ ] **Step 4: schema.ts 编辑器**

4a. 顶部 import 增补：在 `import type {…} from '@dreamerbird/core/types/private/studio'` 列表加 `OutlineCollectionState`；在 `import type {…} from '@dreamerbird/core/types/public'` 列表加 `ProjectId`、`StrictRecord`。

4b. 在 `export namespace stateByProjectId {`（~218 行）内、`export namespace stateBySheetId` 块结束后，插入同级命名空间：

```ts
          export namespace outline {
            function _ensureProject(
              draft: Draft,
              api: API,
              p: {projectId: ProjectId},
            ) {
              return stateEditors.studio.historic.projects.stateByProjectId._ensure(
                draft,
                api,
                p,
              )
            }

            export function setObjectDisplayName(
              draft: Draft,
              api: API,
              p: {projectId: ProjectId; addressKey: string; name: string},
            ) {
              const project = _ensureProject(draft, api, p)
              project.outlineNamesByObjectAddress ??= {}
              if (p.name.trim() === '') {
                delete project.outlineNamesByObjectAddress[p.addressKey]
              } else {
                project.outlineNamesByObjectAddress[p.addressKey] = p.name
              }
            }

            function _ensureCollections(
              draft: Draft,
              api: API,
              p: {projectId: ProjectId},
            ): OutlineCollectionState[] {
              const project = _ensureProject(draft, api, p)
              project.outlineCollections ??= []
              return project.outlineCollections
            }

            export function addCollection(
              draft: Draft,
              api: API,
              p: {projectId: ProjectId; id: string; name: string},
            ) {
              _ensureCollections(draft, api, p).push({
                id: p.id,
                name: p.name,
                members: [],
              })
            }

            export function renameCollection(
              draft: Draft,
              api: API,
              p: {projectId: ProjectId; id: string; name: string},
            ) {
              const collection = _ensureCollections(draft, api, p).find(
                (c) => c.id === p.id,
              )
              if (collection) collection.name = p.name
            }

            export function deleteCollection(
              draft: Draft,
              api: API,
              p: {projectId: ProjectId; id: string},
            ) {
              const project = _ensureProject(draft, api, p)
              if (!project.outlineCollections) return
              project.outlineCollections = project.outlineCollections.filter(
                (c) => c.id !== p.id,
              )
            }

            export function addCollectionMember(
              draft: Draft,
              api: API,
              p: {projectId: ProjectId; collectionId: string; objectKey: string},
            ) {
              const collections = _ensureCollections(draft, api, p)
              // 单归属:先从所有旧集合移出
              for (const c of collections) {
                c.members = c.members.filter((m) => m !== p.objectKey)
              }
              const target = collections.find((c) => c.id === p.collectionId)
              if (target && !target.members.includes(p.objectKey)) {
                target.members.push(p.objectKey)
              }
            }

            export function removeCollectionMember(
              draft: Draft,
              api: API,
              p: {projectId: ProjectId; collectionId: string; objectKey: string},
            ) {
              const target = _ensureCollections(draft, api, p).find(
                (c) => c.id === p.collectionId,
              )
              if (target) {
                target.members = target.members.filter(
                  (m) => m !== p.objectKey,
                )
              }
            }

            export function removeObjectFromAllCollections(
              draft: Draft,
              api: API,
              p: {projectId: ProjectId; objectKey: string},
            ) {
              const project = _ensureProject(draft, api, p)
              if (!project.outlineCollections) return
              for (const c of project.outlineCollections) {
                c.members = c.members.filter((m) => m !== p.objectKey)
              }
            }
          }
```

- [ ] **Step 5: 跑测试确认通过 + 类型检查**

Run: `yarn jest packages/sync-server/src/state/schema.test.ts`
Expected: PASS（7 个用例全绿）
Run: `npx tsc --noEmit -p packages/sync-server && npx tsc --noEmit -p packages/core`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types/private/studio/historic.ts packages/sync-server/src/state/schema.ts packages/sync-server/src/state/schema.test.ts
git commit -m "feat(studio): 大纲显示名与伪集合的状态切片——studio historic 每 project 存 outlineNamesByObjectAddress/outlineCollections,stateEditors 七件套含单归属迁移与名单清理"
```

---

### Task 3: 指纹 + 对象剪贴板（复制/粘贴纯逻辑）

**Files:**
- Create: `packages/studio/src/panels/OutlinePanel/outlineOps/fingerprint.ts`
- Create: `packages/studio/src/panels/OutlinePanel/outlineOps/clipboard.ts`
- Test: `packages/studio/src/panels/OutlinePanel/outlineOps/fingerprint.test.ts`、`clipboard.test.ts`

**Interfaces:**
- Consumes: 无（仅 core 类型）
- Produces（Task 4/5 依赖）:
  ```ts
  // fingerprint.ts
  export function fingerprintOfConfig(config: SheetObjectPropTypeConfig): string
  // clipboard.ts
  export type ObjectSnapshot = {
    fingerprint: string
    values: Record<string, SerializableValue>
  }
  export function snapshotSheetObject(obj: SheetObject): ObjectSnapshot
  export function readObjectClipboard(): ObjectSnapshot | undefined
  export function copySheetObject(obj: SheetObject): void
  export function canPasteSnapshot(target: SheetObject, snap?: ObjectSnapshot): boolean
  export function pasteSnapshot(
    setProp: (pointer: Pointer<$FixMe>, value: $FixMe) => void,
    target: SheetObject,
    snap: ObjectSnapshot,
  ): void
  export function pasteSheetObject(target: SheetObject): boolean
  ```

- [ ] **Step 1: 写失败测试 fingerprint.test.ts**

```ts
import {fingerprintOfConfig} from './fingerprint'
import type {SheetObjectPropTypeConfig} from '@dreamerbird/core/types/public'

const pos3 = {
  type: 'compound',
  props: {
    x: {type: 'number'},
    y: {type: 'number'},
    z: {type: 'number'},
  },
} as unknown as SheetObjectPropTypeConfig['props'][string]

const cameraLike = {
  type: 'compound',
  props: {
    position: pos3,
    aimTarget: {type: 'stringLiteral', options: {}},
    fov: {type: 'number'},
  },
} as unknown as SheetObjectPropTypeConfig

describe('fingerprintOfConfig', () => {
  it('同构模板指纹相同(与键序无关)', () => {
    const reordered = {
      type: 'compound',
      props: {
        fov: {type: 'number'},
        aimTarget: {type: 'stringLiteral', options: {}},
        position: {
          type: 'compound',
          props: {
            z: {type: 'number'},
            y: {type: 'number'},
            x: {type: 'number'},
          },
        },
      },
    } as unknown as SheetObjectPropTypeConfig
    expect(fingerprintOfConfig(cameraLike)).toBe(fingerprintOfConfig(reordered))
  })

  it('顶层键不同则指纹不同', () => {
    const other = {
      type: 'compound',
      props: {position: pos3, aimTarget: {type: 'stringLiteral', options: {}}},
    } as unknown as SheetObjectPropTypeConfig
    expect(fingerprintOfConfig(cameraLike)).not.toBe(fingerprintOfConfig(other))
  })

  it('compound 子键不同则指纹不同', () => {
    const other = {
      type: 'compound',
      props: {
        position: {
          type: 'compound',
          props: {x: {type: 'number'}, y: {type: 'number'}},
        },
      },
    } as unknown as SheetObjectPropTypeConfig
    expect(fingerprintOfConfig(cameraLike)).not.toBe(fingerprintOfConfig(other))
  })

  it('同名键类型不同则指纹不同', () => {
    const other = {
      type: 'compound',
      props: {fov: {type: 'boolean'}},
    } as unknown as SheetObjectPropTypeConfig
    const mine = {
      type: 'compound',
      props: {fov: {type: 'number'}},
    } as unknown as SheetObjectPropTypeConfig
    expect(fingerprintOfConfig(mine)).not.toBe(fingerprintOfConfig(other))
  })

  it('指纹只取结构:默认值/选项变化不影响指纹', () => {
    const a = {
      type: 'compound',
      props: {fov: {type: 'number', default: 50}},
    } as unknown as SheetObjectPropTypeConfig
    const b = {
      type: 'compound',
      props: {fov: {type: 'number', default: 90}},
    } as unknown as SheetObjectPropTypeConfig
    expect(fingerprintOfConfig(a)).toBe(fingerprintOfConfig(b))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn jest packages/studio/src/panels/OutlinePanel/outlineOps/fingerprint.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 fingerprint.ts**

```ts
import type {
  PropTypeConfig,
  SheetObjectPropTypeConfig,
} from '@dreamerbird/core/types/public'

/**
 * 模板结构指纹:顶层键 + 各 propType 的 type 名 + compound 子键树。
 * 只取结构,不含函数/选项/默认值(spec §2)——宁可保守禁用粘贴,
 * 不可误粘贴。键排序后序列化,与书写顺序无关。
 */
export function fingerprintOfConfig(
  config: SheetObjectPropTypeConfig,
): string {
  return JSON.stringify(_nodeOfCompoundProps(config.props))
}

function _nodeOfCompoundProps(
  props: Record<string, PropTypeConfig>,
): unknown {
  return Object.keys(props)
    .sort()
    .map((key) => [key, _nodeOf(props[key]!)])
}

function _nodeOf(config: PropTypeConfig): unknown {
  if (config.type === 'compound') {
    return {compound: _nodeOfCompoundProps(config.props)}
  }
  return config.type
}
```

- [ ] **Step 4: 跑 fingerprint 测试确认通过**

Run: `yarn jest packages/studio/src/panels/OutlinePanel/outlineOps/fingerprint.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: 写失败测试 clipboard.test.ts**

```ts
import {Atom} from '@dreamerbird/dataverse'
import {
  canPasteSnapshot,
  copySheetObject,
  pasteSnapshot,
  readObjectClipboard,
  snapshotSheetObject,
} from './clipboard'
import type {SheetObjectPropTypeConfig} from '@dreamerbird/core/types/public'

const staticConfig = {
  type: 'compound',
  props: {
    fov: {type: 'number'},
    pos: {
      type: 'compound',
      props: {
        x: {type: 'number'},
        y: {type: 'number'},
        z: {type: 'number'},
      },
    },
  },
} as unknown as SheetObjectPropTypeConfig

function makeObject(values: {fov: number; pos: {x: number; y: number; z: number}}) {
  const atom = new Atom(values)
  return {
    props: atom.pointer,
    template: {staticConfig},
  } as unknown as import('@dreamerbird/core/sheetObjects/SheetObject').default
}

describe('对象剪贴板', () => {
  it('snapshotSheetObject 快照顶层静态值 + 指纹', () => {
    const snap = snapshotSheetObject(makeObject({fov: 50, pos: {x: 1, y: 2, z: 3}}))
    expect(snap.values).toEqual({fov: 50, pos: {x: 1, y: 2, z: 3}})
    expect(typeof snap.fingerprint).toBe('string')
  })

  it('copySheetObject 写入模块剪贴板,readObjectClipboard 读回', () => {
    const obj = makeObject({fov: 70, pos: {x: 0, y: 0, z: 0}})
    copySheetObject(obj)
    expect(readObjectClipboard()?.values.fov).toBe(70)
  })

  it('canPasteSnapshot:剪贴板空或指纹不匹配则禁粘', () => {
    const target = makeObject({fov: 1, pos: {x: 0, y: 0, z: 0}})
    expect(canPasteSnapshot(target, undefined)).toBe(false)
    const otherConfig = {
      type: 'compound',
      props: {other: {type: 'number'}},
    } as unknown as SheetObjectPropTypeConfig
    const otherAtom = new Atom({other: 1})
    const foreign = {
      props: otherAtom.pointer,
      template: {staticConfig: otherConfig},
    } as any
    const snap = snapshotSheetObject(foreign)
    expect(canPasteSnapshot(target, snap)).toBe(false)
    expect(canPasteSnapshot(target, snapshotSheetObject(target))).toBe(true)
  })

  it('pasteSnapshot 逐个顶层键写入(setProp 收集调用)', () => {
    const target = makeObject({fov: 1, pos: {x: 0, y: 0, z: 0}})
    const snap = snapshotSheetObject(
      makeObject({fov: 90, pos: {x: 4, y: 5, z: 6}}),
    )
    const calls: Array<[unknown, unknown]> = []
    pasteSnapshot((p, v) => calls.push([p, v]), target, snap)
    expect(calls).toHaveLength(2)
    expect(calls[0]![1]).toEqual(90)
    expect(calls[1]![1]).toEqual({x: 4, y: 5, z: 6})
  })
})
```

- [ ] **Step 6: 跑测试确认失败**

Run: `yarn jest packages/studio/src/panels/OutlinePanel/outlineOps/clipboard.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 7: 实现 clipboard.ts**

```ts
import {val} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import type {$FixMe} from '@dreamerbird/core/types/public'
import type {SerializableValue} from '@dreamerbird/core/types/public'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import getStudio from '@dreamerbird/studio/getStudio'
import {fingerprintOfConfig} from './fingerprint'

/**
 * 对象剪贴板:会话内有效的对象快照(静态值 + 模板结构指纹)。
 * 粘贴以指纹把关——只有同构模板的对象才允许粘贴(spec §2)。
 */
export type ObjectSnapshot = {
  fingerprint: string
  values: Record<string, SerializableValue>
}

let clipboard: ObjectSnapshot | undefined

export function snapshotSheetObject(obj: SheetObject): ObjectSnapshot {
  const props = obj.template.staticConfig.props
  const values: Record<string, SerializableValue> = {}
  for (const key of Object.keys(props)) {
    const v = val((obj.props as $FixMe)[key])
    // 快照要脱开引用,JSON 克隆即可(值均为 SerializableValue)
    values[key] = JSON.parse(JSON.stringify(v))
  }
  return {fingerprint: fingerprintOfConfig(obj.template.staticConfig), values}
}

export function readObjectClipboard(): ObjectSnapshot | undefined {
  return clipboard
}

export function copySheetObject(obj: SheetObject): void {
  clipboard = snapshotSheetObject(obj)
}

export function canPasteSnapshot(
  target: SheetObject,
  snap: ObjectSnapshot | undefined = clipboard,
): boolean {
  if (!snap) return false
  return snap.fingerprint === fingerprintOfConfig(target.template.staticConfig)
}

/** 纯写入逻辑:test 注入 setProp 收集调用;生产传事务 api 的 set */
export function pasteSnapshot(
  setProp: (pointer: Pointer<$FixMe>, value: $FixMe) => void,
  target: SheetObject,
  snap: ObjectSnapshot,
): void {
  for (const [key, value] of Object.entries(snap.values)) {
    setProp((target.props as $FixMe)[key] as Pointer<$FixMe>, value)
  }
}

/** 事务内整体写入;指纹不匹配返回 false 不做事 */
export function pasteSheetObject(target: SheetObject): boolean {
  if (!canPasteSnapshot(target)) return false
  const snap = clipboard!
  getStudio().transaction(({set}) => {
    pasteSnapshot(set, target, snap)
  })
  return true
}
```

- [ ] **Step 8: 跑测试确认通过 + tsc**

Run: `yarn jest packages/studio/src/panels/OutlinePanel/outlineOps/clipboard.test.ts`
Expected: PASS（4 个用例）
Run: `npx tsc --noEmit -p packages/studio`
Expected: 无错误

- [ ] **Step 9: Commit**

```bash
git add packages/studio/src/panels/OutlinePanel/outlineOps/fingerprint.ts packages/studio/src/panels/OutlinePanel/outlineOps/clipboard.ts packages/studio/src/panels/OutlinePanel/outlineOps/fingerprint.test.ts packages/studio/src/panels/OutlinePanel/outlineOps/clipboard.test.ts
git commit -m "feat(studio): 大纲对象复制粘贴纯逻辑——模板结构指纹(键+类型名+compound 子键树)把关,会话剪贴板快照顶层静态值"
```

---

### Task 4: 菜单装配纯函数 + i18n 词条

**Files:**
- Create: `packages/studio/src/panels/OutlinePanel/outlineOps/collectOutlineMenuItems.ts`
- Test: `packages/studio/src/panels/OutlinePanel/outlineOps/collectOutlineMenuItems.test.ts`
- Modify: `packages/studio/src/i18n/dicts/en.ts`、`zh-CN.ts`
- Test: `packages/studio/src/i18n/dicts/parity.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `OutlineMenuItem`；Task 3 的 `ObjectSnapshot`
- Produces（Task 5 依赖）:
  ```ts
  export type OutlineMenuHandlers = {
    onCopy(): void
    onPaste(): void
    onStartRename(): void
    onDelete(): void
    onMoveToCollection(collectionId: string): void
    onRemoveFromCollection(): void
    onStartNewCollection(): void
  }
  export function collectOutlineMenuItems(p: {
    t: (key: string, vars?: {[name: string]: string | number}) => string
    clipboardSnapshot: ObjectSnapshot | undefined
    targetFingerprint: string
    collections: OutlineCollectionState[]
    currentCollectionId: string | undefined
    extensionItems: OutlineMenuItem[]
    handlers: OutlineMenuHandlers
  }): ContextMenuItem[]
  // stateOps.ts(Task 5)复用的默认集合名:
  export function nextDefaultCollectionName(
    collections: OutlineCollectionState[],
    t: (key: string, vars?: {[name: string]: string | number}) => string,
  ): string
  ```
- 词条（两词典同步，key 集合一致——parity 测试断言）:
  `outline.ctx.copy / paste / rename / delete / newCollection / moveToCollection({name}) / removeFromCollection / deleteCollection / collectionNamePlaceholder / defaultCollectionName({n})`

- [ ] **Step 1: 加词条（en + zh-CN）**

`en.ts` 的 `en` 对象末尾（`detailPanel.propsRoot` 之后）追加：

```ts
  'outline.ctx.copy': 'Copy',
  'outline.ctx.paste': 'Paste',
  'outline.ctx.rename': 'Rename',
  'outline.ctx.delete': 'Delete',
  'outline.ctx.newCollection': 'New collection…',
  'outline.ctx.moveToCollection': 'Move to collection: {name}',
  'outline.ctx.removeFromCollection': 'Remove from collection',
  'outline.ctx.deleteCollection': 'Delete collection',
  'outline.ctx.collectionNamePlaceholder': 'Collection name',
  'outline.ctx.defaultCollectionName': 'Collection {n}',
```

`zh-CN.ts` 同步追加：

```ts
  'outline.ctx.copy': '复制',
  'outline.ctx.paste': '粘贴',
  'outline.ctx.rename': '重命名',
  'outline.ctx.delete': '删除',
  'outline.ctx.newCollection': '新建集合…',
  'outline.ctx.moveToCollection': '移到集合:{name}',
  'outline.ctx.removeFromCollection': '从集合移出',
  'outline.ctx.deleteCollection': '删除集合',
  'outline.ctx.collectionNamePlaceholder': '集合名称',
  'outline.ctx.defaultCollectionName': '集合 {n}',
```

- [ ] **Step 2: 写 parity 测试 `packages/studio/src/i18n/dicts/parity.test.ts`**

```ts
import {en} from './en'
import {zhCN} from './zh-CN'

test('studio 内置词典 en/zh-CN key 集合一致', () => {
  expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort())
})
```

- [ ] **Step 3: 跑 parity 测试确认通过**

Run: `yarn jest packages/studio/src/i18n/dicts/parity.test.ts`
Expected: PASS（Step 1 两词典同步加键,key 集合一致。此测试的价值是回归守护:今后任一侧缺 key 即红,不追求"先红后绿"）

- [ ] **Step 4: 写失败测试 collectOutlineMenuItems.test.ts**

```ts
import {collectOutlineMenuItems} from './collectOutlineMenuItems'
import type {OutlineCollectionState} from '@dreamerbird/core/types/private/studio'
import type {OutlineMenuItem} from '@dreamerbird/core/types/public'

const t = (key: string, vars?: {[name: string]: string | number}) =>
  vars?.name !== undefined ? `${key}:{${vars.name}}` : key

const handlers = {
  onCopy: () => {},
  onPaste: () => {},
  onStartRename: () => {},
  onDelete: () => {},
  onMoveToCollection: (_id: string) => {},
  onRemoveFromCollection: () => {},
  onStartNewCollection: () => {},
}

const base = {
  t,
  clipboardSnapshot: undefined as undefined | {fingerprint: string; values: {}},
  targetFingerprint: 'fp',
  collections: [] as OutlineCollectionState[],
  currentCollectionId: undefined as string | undefined,
  extensionItems: [] as OutlineMenuItem[],
}

const labels = (items: ReturnType<typeof collectOutlineMenuItems>) =>
  items.map((i) => (i.type === 'separator' ? '—' : i.label))

describe('collectOutlineMenuItems', () => {
  it('无剪贴板时粘贴置灰,有匹配指纹的剪贴板时启用', () => {
    const disabled = collectOutlineMenuItems({...base})
    expect(disabled[1]).toMatchObject({label: 'outline.ctx.paste', enabled: false})
    const enabled = collectOutlineMenuItems({
      ...base,
      clipboardSnapshot: {fingerprint: 'fp', values: {}},
    })
    expect(enabled[1]).toMatchObject({label: 'outline.ctx.paste', enabled: true})
    const mismatch = collectOutlineMenuItems({
      ...base,
      clipboardSnapshot: {fingerprint: 'other', values: {}},
    })
    expect(mismatch[1]).toMatchObject({enabled: false})
  })

  it('内置顺序:复制/粘贴/重命名 → 集合项 → 分隔符 → 删除', () => {
    const items = collectOutlineMenuItems({...base})
    expect(labels(items)).toEqual([
      'outline.ctx.copy',
      'outline.ctx.paste',
      'outline.ctx.rename',
      'outline.ctx.newCollection',
      '—',
      'outline.ctx.delete',
    ])
  })

  it('集合项:非当前集合出"移到集合",当前集合出"从集合移出"', () => {
    const collections: OutlineCollectionState[] = [
      {id: 'c1', name: 'A', members: ['Obj']},
      {id: 'c2', name: 'B', members: []},
    ]
    const items = collectOutlineMenuItems({
      ...base,
      collections,
      currentCollectionId: 'c1',
    })
    expect(labels(items)).toEqual([
      'outline.ctx.copy',
      'outline.ctx.paste',
      'outline.ctx.rename',
      'outline.ctx.moveToCollection:{B}',
      'outline.ctx.removeFromCollection',
      'outline.ctx.newCollection',
      '—',
      'outline.ctx.delete',
    ])
  })

  it('扩展项追加在内置项之后;role:delete 抑制内置删除与末尾分隔符', () => {
    const hostDelete: OutlineMenuItem = {
      type: 'normal',
      label: 'Host delete',
      onSelect: () => {},
      role: 'delete',
    }
    const items = collectOutlineMenuItems({...base, extensionItems: [hostDelete]})
    expect(labels(items)).toEqual([
      'outline.ctx.copy',
      'outline.ctx.paste',
      'outline.ctx.rename',
      'outline.ctx.newCollection',
      'Host delete',
    ])
  })

  it('无 delete-role 的扩展项出现时仍保留内置删除', () => {
    const extra: OutlineMenuItem = {
      type: 'normal',
      label: 'Host extra',
      onSelect: () => {},
    }
    const items = collectOutlineMenuItems({...base, extensionItems: [extra]})
    expect(labels(items)).toEqual([
      'outline.ctx.copy',
      'outline.ctx.paste',
      'outline.ctx.rename',
      'outline.ctx.newCollection',
      'Host extra',
      '—',
      'outline.ctx.delete',
    ])
  })
})
```

- [ ] **Step 5: 跑测试确认失败**

Run: `yarn jest packages/studio/src/panels/OutlinePanel/outlineOps/collectOutlineMenuItems.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 6: 实现 collectOutlineMenuItems.ts**

```ts
import type {ContextMenuItem} from '@dreamerbird/studio/uiComponents/chordial/chordialInternals'
import type {OutlineCollectionState} from '@dreamerbird/core/types/private/studio'
import type {OutlineMenuItem} from '@dreamerbird/core/types/public'
import type {ObjectSnapshot} from './clipboard'

export type OutlineT = (
  key: string,
  vars?: {[name: string]: string | number},
) => string

export type OutlineMenuHandlers = {
  onCopy(): void
  onPaste(): void
  onStartRename(): void
  onDelete(): void
  onMoveToCollection(collectionId: string): void
  onRemoveFromCollection(): void
  onStartNewCollection(): void
}

/**
 * 对象行右键菜单装配(spec §2 + §4 顺序):
 * 复制/粘贴/重命名 → [移到集合:{name}…/从集合移出/新建集合…] →
 * 扩展项(注册顺序) → [分隔符 + 删除]。
 * 任一扩展项带 role:'delete' 时,内置删除与末尾分隔符整组省略(spec §1)。
 */
export function collectOutlineMenuItems(p: {
  t: OutlineT
  clipboardSnapshot: ObjectSnapshot | undefined
  targetFingerprint: string
  collections: OutlineCollectionState[]
  currentCollectionId: string | undefined
  extensionItems: OutlineMenuItem[]
  handlers: OutlineMenuHandlers
}): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {type: 'normal', label: p.t('outline.ctx.copy'), callback: p.handlers.onCopy},
    {
      type: 'normal',
      label: p.t('outline.ctx.paste'),
      callback: p.handlers.onPaste,
      enabled:
        !!p.clipboardSnapshot &&
        p.clipboardSnapshot.fingerprint === p.targetFingerprint,
    },
    {
      type: 'normal',
      label: p.t('outline.ctx.rename'),
      callback: p.handlers.onStartRename,
    },
  ]

  for (const collection of p.collections) {
    if (collection.id === p.currentCollectionId) continue
    items.push({
      type: 'normal',
      label: p.t('outline.ctx.moveToCollection', {name: collection.name}),
      callback: () => p.handlers.onMoveToCollection(collection.id),
    })
  }
  if (p.currentCollectionId) {
    items.push({
      type: 'normal',
      label: p.t('outline.ctx.removeFromCollection'),
      callback: p.handlers.onRemoveFromCollection,
    })
  }
  items.push({
    type: 'normal',
    label: p.t('outline.ctx.newCollection'),
    callback: p.handlers.onStartNewCollection,
  })

  for (const extItem of p.extensionItems) {
    items.push({
      type: 'normal',
      label: extItem.label,
      enabled: extItem.enabled,
      callback: extItem.onSelect,
    })
  }

  const hasHostDelete = p.extensionItems.some((i) => i.role === 'delete')
  if (!hasHostDelete) {
    items.push({type: 'separator'})
    items.push({
      type: 'normal',
      label: p.t('outline.ctx.delete'),
      callback: p.handlers.onDelete,
    })
  }
  return items
}

/** 空白处"新建集合"的默认名:集合 N(N 从现有数量+1 起,冲突顺延) */
export function nextDefaultCollectionName(
  collections: OutlineCollectionState[],
  t: OutlineT,
): string {
  const taken = new Set(collections.map((c) => c.name))
  for (let n = collections.length + 1; n < collections.length + 1000; n++) {
    const name = t('outline.ctx.defaultCollectionName', {n})
    if (!taken.has(name)) return name
  }
  return t('outline.ctx.defaultCollectionName', {n: Date.now()})
}
```

- [ ] **Step 7: 跑测试确认通过**

Run: `yarn jest packages/studio/src/panels/OutlinePanel/outlineOps/collectOutlineMenuItems.test.ts packages/studio/src/i18n/dicts/parity.test.ts`
Expected: PASS（5 + 1 用例）

- [ ] **Step 8: Commit**

```bash
git add packages/studio/src/panels/OutlinePanel/outlineOps/collectOutlineMenuItems.ts packages/studio/src/panels/OutlinePanel/outlineOps/collectOutlineMenuItems.test.ts packages/studio/src/i18n/dicts/en.ts packages/studio/src/i18n/dicts/zh-CN.ts packages/studio/src/i18n/dicts/parity.test.ts
git commit -m "feat(studio): 大纲右键菜单装配纯函数——内置复制/粘贴/重命名/集合项/删除,扩展项按注册序追加,role:'delete' 接管内置删除;outline.ctx.* 双语词条 + en/zh-CN key parity 测试"
```

---

### Task 5: 行内编辑态 + 对象行菜单接线（BaseItem / ObjectItem / MergedObjectItem）

**Files:**
- Modify: `packages/studio/src/panels/OutlinePanel/BaseItem.tsx`
- Create: `packages/studio/src/panels/OutlinePanel/outlineOps/addressKey.ts`
- Create: `packages/studio/src/panels/OutlinePanel/outlineOps/stateOps.ts`
- Create: `packages/studio/src/panels/OutlinePanel/outlineOps/useOutlineObjectMenu.ts`
- Modify: `packages/studio/src/panels/OutlinePanel/ObjectsList/ObjectItem.tsx`
- Modify: `packages/studio/src/panels/OutlinePanel/ObjectsList/ObjectsList.tsx`（仅 MergedObjectItem 部分）

**Interfaces:**
- Consumes: Task 2 stateEditors 路径；Task 3 clipboard；Task 4 collectOutlineMenuItems/nextDefaultCollectionName/OutlineT；Task 1 IExtension（ephemeralAtom 读取）
- Produces（Task 6 依赖）:
  ```ts
  // addressKey.ts
  export function objectAddressKey(address: SheetObjectAddress): string
  // stateOps.ts
  export function setObjectDisplayName(projectId: ProjectId, addressKey: string, name: string): void
  export function createCollectionAndAddMember(projectId: ProjectId, id: string, name: string, objectKey: string): void
  export function createEmptyCollection(projectId: ProjectId, id: string, name: string): void
  export function renameCollection(projectId: ProjectId, id: string, name: string): void
  export function deleteCollection(projectId: ProjectId, id: string): void
  export function moveObjectToCollection(projectId: ProjectId, collectionId: string, objectKey: string): void
  export function removeObjectFromCollection(projectId: ProjectId, collectionId: string, objectKey: string): void
  export function pruneObjectFromOutlineCollections(projectId: ProjectId, objectKey: string): void
  export function deleteOutlineObject(sheetObject: SheetObject): void
  // useOutlineObjectMenu.ts
  export function useOutlineObjectMenu(sheetObject: SheetObject): {
    targetRef: MutableRefObject<$FixMe>
    displayName: string | undefined
    editingMode: null | 'name' | 'newCollection'
    submitEditing(value: string): void
    cancelEditing(): void
  }
  // BaseItem.tsx 新增可选 prop:
  // rename?: {editing: boolean; placeholder?: string; onSubmit(name: string): void; onCancel(): void}
  ```

- [ ] **Step 1: addressKey.ts**

```ts
import type {SheetObjectAddress} from '@dreamerbird/core/types/public'

/**
 * 对象地址的稳定序列化(显示名存储键,spec §3)。
 * 显式按字段序拼接,不受对象构造时键序影响。
 */
export function objectAddressKey(address: SheetObjectAddress): string {
  const {projectId, sheetId, sheetInstanceId, objectKey} = address
  return JSON.stringify({projectId, sheetId, sheetInstanceId, objectKey})
}
```

- [ ] **Step 2: stateOps.ts**

```ts
import type {ProjectId} from '@dreamerbird/core/types/public'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import getStudio from '@dreamerbird/studio/getStudio'

/** 显示名写入;空串/纯空白 = 清除(spec §3) */
export function setObjectDisplayName(
  projectId: ProjectId,
  addressKey: string,
  name: string,
): void {
  getStudio().transaction(({stateEditors}) => {
    stateEditors.studio.historic.projects.stateByProjectId.outline.setObjectDisplayName(
      {projectId, addressKey, name},
    )
  })
}

/** 一步事务:建集合并把对象移入(单条撤销记录) */
export function createCollectionAndAddMember(
  projectId: ProjectId,
  id: string,
  name: string,
  objectKey: string,
): void {
  getStudio().transaction(({stateEditors}) => {
    const outline = stateEditors.studio.historic.projects.stateByProjectId.outline
    outline.addCollection({projectId, id, name})
    outline.addCollectionMember({projectId, collectionId: id, objectKey})
  })
}

export function createEmptyCollection(
  projectId: ProjectId,
  id: string,
  name: string,
): void {
  getStudio().transaction(({stateEditors}) => {
    stateEditors.studio.historic.projects.stateByProjectId.outline.addCollection({
      projectId,
      id,
      name,
    })
  })
}

export function renameCollection(
  projectId: ProjectId,
  id: string,
  name: string,
): void {
  getStudio().transaction(({stateEditors}) => {
    stateEditors.studio.historic.projects.stateByProjectId.outline.renameCollection(
      {projectId, id, name},
    )
  })
}

/** 解散集合:只删分组,成员对象不动(spec §4) */
export function deleteCollection(projectId: ProjectId, id: string): void {
  getStudio().transaction(({stateEditors}) => {
    stateEditors.studio.historic.projects.stateByProjectId.outline.deleteCollection({
      projectId,
      id,
    })
  })
}

export function moveObjectToCollection(
  projectId: ProjectId,
  collectionId: string,
  objectKey: string,
): void {
  getStudio().transaction(({stateEditors}) => {
    stateEditors.studio.historic.projects.stateByProjectId.outline.addCollectionMember(
      {projectId, collectionId, objectKey},
    )
  })
}

export function removeObjectFromCollection(
  projectId: ProjectId,
  collectionId: string,
  objectKey: string,
): void {
  getStudio().transaction(({stateEditors}) => {
    stateEditors.studio.historic.projects.stateByProjectId.outline.removeCollectionMember(
      {projectId, collectionId, objectKey},
    )
  })
}

/** 对象真删后清掉所有集合名单残留(spec §4;渲染求交是另一道兜底) */
export function pruneObjectFromOutlineCollections(
  projectId: ProjectId,
  objectKey: string,
): void {
  getStudio().transaction(({stateEditors}) => {
    stateEditors.studio.historic.projects.stateByProjectId.outline.removeObjectFromAllCollections(
      {projectId, objectKey},
    )
  })
}

/**
 * 内置默认删除:forgetObject 清持久数据(静态覆盖/轨道),
 * 并清掉集合名单残留。forgetObject 对"从没写过持久数据"的对象会踩
 * saaz draft 老坑(TypeError),跳过即可——这类对象本来就没留痕。
 */
export function deleteOutlineObject(sheetObject: SheetObject): void {
  const studio = getStudio()
  try {
    studio.transaction(({stateEditors}) => {
      stateEditors.coreByProject.historic.sheetsById.forgetObject(
        sheetObject.address,
      )
    })
  } catch (err) {
    console.warn('[outline] forgetObject 跳过(对象无持久数据)', err)
  }
  pruneObjectFromOutlineCollections(
    sheetObject.address.projectId,
    sheetObject.address.objectKey,
  )
}
```

- [ ] **Step 3: BaseItem.tsx 加行内编辑态**

3a. `BaseHeader` 样式附近新增输入框样式（放在 `Head_Label` 定义之后）：

```tsx
const NameInput = styled.input`
  ${outlineItemFont};
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 2px;
  color: rgba(255, 255, 255, 0.95);
  height: 18px;
  padding: 0 4px;
  width: 150px;
  outline: none;
  box-sizing: border-box;

  &::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }
`
```

3b. props 类型与解构：`rename?: {editing: boolean; placeholder?: string; onSubmit: (name: string) => void; onCancel: () => void}` 加入 props 类型与解构列表。

3c. `Head_Label` 渲染替换：

```tsx
        <Head_Label>
          {rename?.editing ? (
            <NameInput
              autoFocus
              defaultValue={typeof label === 'string' ? label : ''}
              placeholder={rename.placeholder}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                // 输入态接管按键:别让折叠/全局快捷键抢(spec §8)
                e.stopPropagation()
                if (e.key === 'Enter') {
                  rename.onSubmit(e.currentTarget.value)
                } else if (e.key === 'Escape') {
                  rename.onCancel()
                }
              }}
            />
          ) : (
            <span>{label}</span>
          )}
        </Head_Label>
```

- [ ] **Step 4: useOutlineObjectMenu.ts**

```tsx
import {useCallback, useState} from 'react'
import type {MutableRefObject} from 'react'
import {useVal} from '@dreamerbird/react'
import {val} from '@dreamerbird/dataverse'
import {nanoid as generateNonSecure} from 'nanoid/non-secure'
import type {$FixMe} from '@dreamerbird/core/types/public'
import type {
  ISheetObject,
  UnknownShorthandCompoundProps,
} from '@dreamerbird/core/types/public'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import getStudio from '@dreamerbird/studio/getStudio'
import useChordial from '@dreamerbird/studio/uiComponents/chordial/useChodrial'
import type {ChordialOpts} from '@dreamerbird/studio/uiComponents/chordial/chordialInternals'
import {translate} from '@dreamerbird/studio/i18n'
import {objectAddressKey} from './addressKey'
import {fingerprintOfConfig} from './fingerprint'
import {
  copySheetObject,
  pasteSheetObject,
  readObjectClipboard,
} from './clipboard'
import {
  collectOutlineMenuItems,
  nextDefaultCollectionName,
} from './collectOutlineMenuItems'
import {
  createCollectionAndAddMember,
  deleteOutlineObject,
  moveObjectToCollection,
  removeObjectFromCollection,
  setObjectDisplayName,
} from './stateOps'

/**
 * 对象行的右键菜单 + 显示名 + 行内编辑态。
 * optsFn 在菜单点开那一刻才执行(ContextOverlay 调 optsFn()),
 * 内部用 val() 直读——菜单内容永远新鲜,无需为菜单订阅重渲染。
 * 显示名要显示在行上,所以单独 useVal 订阅。
 */
export function useOutlineObjectMenu(sheetObject: SheetObject): {
  targetRef: MutableRefObject<$FixMe>
  displayName: string | undefined
  editingMode: null | 'name' | 'newCollection'
  submitEditing(value: string): void
  cancelEditing(): void
} {
  const address = sheetObject.address
  const addressKey = objectAddressKey(address)
  const projectId = address.projectId

  const displayName = useVal(
    getStudio().atomP.historic.projects.stateByProjectId[projectId]
      .outlineNamesByObjectAddress[addressKey],
  )

  const [editingMode, setEditingMode] = useState<
    null | 'name' | 'newCollection'
  >(null)

  const optsFn = useCallback((): ChordialOpts => {
    const extensionsById = val(
      getStudio().ephemeralAtom.pointer.extensions.byId,
    )
    const collections =
      val(
        getStudio().atomP.historic.projects.stateByProjectId[projectId]
          .outlineCollections,
      ) ?? []
    const currentCollectionId = collections.find((c) =>
      c.members.includes(address.objectKey),
    )?.id

    const extensionItems: import('@dreamerbird/core/types/public').OutlineMenuItem[] =
      []
    for (const extension of Object.values(extensionsById)) {
      const contribution = extension?.outlineObjectMenu?.(
        sheetObject.publicApi as ISheetObject<UnknownShorthandCompoundProps>,
      )
      if (contribution) extensionItems.push(...contribution.items)
    }

    const items = collectOutlineMenuItems({
      t: translate,
      clipboardSnapshot: readObjectClipboard(),
      targetFingerprint: fingerprintOfConfig(sheetObject.template.staticConfig),
      collections,
      currentCollectionId,
      extensionItems,
      handlers: {
        onCopy: () => copySheetObject(sheetObject),
        onPaste: () => pasteSheetObject(sheetObject),
        onStartRename: () => setEditingMode('name'),
        onDelete: () => deleteOutlineObject(sheetObject),
        onMoveToCollection: (collectionId) =>
          moveObjectToCollection(projectId, collectionId, address.objectKey),
        onRemoveFromCollection: () => {
          if (currentCollectionId) {
            removeObjectFromCollection(
              projectId,
              currentCollectionId,
              address.objectKey,
            )
          }
        },
        onStartNewCollection: () => setEditingMode('newCollection'),
      },
    })
    return {title: `Object: ${address.objectKey}`, items}
  }, [sheetObject, address, projectId])

  const {targetRef} = useChordial(optsFn)

  const submitEditing = useCallback(
    (value: string) => {
      if (editingMode === 'name') {
        setObjectDisplayName(projectId, addressKey, value)
      } else if (editingMode === 'newCollection') {
        const collections =
          val(
            getStudio().atomP.historic.projects.stateByProjectId[projectId]
              .outlineCollections,
          ) ?? []
        const name =
          value.trim() !== ''
            ? value
            : nextDefaultCollectionName(collections, translate)
        createCollectionAndAddMember(
          projectId,
          generateNonSecure(10),
          name,
          address.objectKey,
        )
      }
      setEditingMode(null)
    },
    [editingMode, projectId, addressKey, address.objectKey],
  )

  return {
    targetRef,
    displayName,
    editingMode,
    submitEditing,
    cancelEditing: () => setEditingMode(null),
  }
}
```

- [ ] **Step 5: ObjectItem.tsx 全量替换**

```tsx
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import getStudio from '@dreamerbird/studio/getStudio'
import React from 'react'
import BaseItem from '@dreamerbird/studio/panels/OutlinePanel/BaseItem'
import {useVal} from '@dreamerbird/react'
import {outlineSelection} from '@dreamerbird/studio/selectors'
import {translate} from '@dreamerbird/studio/i18n'
import {useOutlineObjectMenu} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/useOutlineObjectMenu'

export const ObjectItem: React.FC<{
  sheetObject: SheetObject
  depth: number
  overrideLabel?: string
}> = ({sheetObject, depth, overrideLabel}) => {
  const select = () => {
    getStudio()!.transaction(({stateEditors}) => {
      stateEditors.studio.historic.panels.outline.selection.set([
        {...sheetObject.address, type: 'SheetObject'},
      ])
    })
  }

  const selection = useVal(outlineSelection)

  const {targetRef, displayName, editingMode, submitEditing, cancelEditing} =
    useOutlineObjectMenu(sheetObject)

  return (
    <BaseItem
      select={select}
      label={displayName ?? overrideLabel ?? sheetObject.address.objectKey}
      depth={depth}
      headerRef={targetRef}
      selectionStatus={
        selection.includes(sheetObject) ? 'selected' : 'not-selected'
      }
      rename={{
        editing: editingMode !== null,
        placeholder:
          editingMode === 'newCollection'
            ? translate('outline.ctx.collectionNamePlaceholder')
            : undefined,
        onSubmit: submitEditing,
        onCancel: cancelEditing,
      }}
    />
  )
}
```

- [ ] **Step 6: ObjectsList.tsx 的 MergedObjectItem 接线**

把 `MergedObjectItem` 组件（143-177 行）替换为：

```tsx
const MergedObjectItem: React.FC<{
  sheetObject: SheetObject
  label: string
  depth: number
  collapsed: boolean
  setIsCollapsed: (v: boolean) => void
  children?: React.ReactNode
}> = ({sheetObject, label, depth, collapsed, setIsCollapsed, children}) => {
  const select = () => {
    getStudio()!.transaction(({stateEditors}) => {
      stateEditors.studio.historic.panels.outline.selection.set([
        {...sheetObject.address, type: 'SheetObject'},
      ])
    })
  }
  const selection = useVal(outlineSelection)
  const {targetRef, displayName, editingMode, submitEditing, cancelEditing} =
    useOutlineObjectMenu(sheetObject)
  return (
    <BaseItem
      select={select}
      label={displayName ?? label}
      depth={depth}
      headerRef={targetRef}
      selectionStatus={
        selection.includes(sheetObject) ? 'selected' : 'not-selected'
      }
      children={children}
      collapsed={collapsed}
      setIsCollapsed={setIsCollapsed}
      rename={{
        editing: editingMode !== null,
        placeholder:
          editingMode === 'newCollection'
            ? translate('outline.ctx.collectionNamePlaceholder')
            : undefined,
        onSubmit: submitEditing,
        onCancel: cancelEditing,
      }}
    />
  )
}
```

文件头部 import 增加：`import {translate} from '@dreamerbird/studio/i18n'`、`import {useOutlineObjectMenu} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/useOutlineObjectMenu'`。**`useChordial` 的 import 保留**（Task 6 的 ObjectsList 本体还要用）。

- [ ] **Step 7: 类型检查 + 全量相关测试**

Run: `npx tsc --noEmit -p packages/studio`
Expected: 无错误
Run: `yarn jest packages/studio/src/panels/OutlinePanel packages/studio/src/i18n`
Expected: 全绿（含 Task 3/4 用例）

- [ ] **Step 8: Commit**

```bash
git add packages/studio/src/panels/OutlinePanel/BaseItem.tsx packages/studio/src/panels/OutlinePanel/ObjectsList/ObjectItem.tsx packages/studio/src/panels/OutlinePanel/ObjectsList/ObjectsList.tsx packages/studio/src/panels/OutlinePanel/outlineOps/addressKey.ts packages/studio/src/panels/OutlinePanel/outlineOps/stateOps.ts packages/studio/src/panels/OutlinePanel/outlineOps/useOutlineObjectMenu.ts
git commit -m "feat(studio): 大纲对象行右键菜单接线——BaseItem 行内编辑态(Enter 提交/Esc 取消/输入态接管按键),对象行显示名优先展示,内置删除含集合名单清理"
```

---

### Task 6: ObjectsList 伪集合渲染（集合行/成员过滤/空白处新建）

**Files:**
- Modify: `packages/studio/src/panels/OutlinePanel/outlinePanelUtils.ts`
- Create: `packages/studio/src/panels/OutlinePanel/ObjectsList/CollectionItem.tsx`
- Modify: `packages/studio/src/panels/OutlinePanel/ObjectsList/ObjectsList.tsx`

**Interfaces:**
- Consumes: Task 2 的 `OutlineCollectionState`；Task 5 的 `useOutlineObjectMenu`/`stateOps`；Task 4 的 `nextDefaultCollectionName`
- Produces: 无新接口（纯 UI 集成）

- [ ] **Step 1: outlinePanelUtils.ts 支持集合折叠**

`useCollapseStateInOutlinePanel` 的参数类型与 itemKey/projectId 推导改为：

```ts
export function useCollapseStateInOutlinePanel(
  item:
    | Project
    | Sheet
    | {type: 'namespace'; sheet: Sheet; path: string[]}
    | {type: 'collection'; projectId: string; id: string},
): {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
} {
  const itemKey =
    item.type === 'namespace'
      ? `namespace:${item.sheet.address.sheetId}:${item.path.join('/')}`
      : item.type === 'collection'
        ? `collection:${item.projectId}:${item.id}`
        : item.type === 'Theatre_Project'
          ? 'project'
          : item.type === 'Theatre_Sheet'
            ? `sheetInstance:${item.address.sheetId}:${item.address.sheetInstanceId}`
            : 'unknown'

  const projectId =
    item.type === 'namespace'
      ? item.sheet.address.projectId
      : item.type === 'collection'
        ? item.projectId
        : item.address.projectId
  // ...其余实现不变
}
```

- [ ] **Step 2: CollectionItem.tsx**

```tsx
import React, {useState} from 'react'
import {useVal} from '@dreamerbird/react'
import type Sheet from '@dreamerbird/core/sheets/Sheet'
import type {OutlineCollectionState} from '@dreamerbird/core/types/private/studio'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import BaseItem from '@dreamerbird/studio/panels/OutlinePanel/BaseItem'
import {ObjectItem} from './ObjectItem'
import {useCollapseStateInOutlinePanel} from '@dreamerbird/studio/panels/OutlinePanel/outlinePanelUtils'
import useChordial from '@dreamerbird/studio/uiComponents/chordial/useChodrial'
import type {ChordialOpts} from '@dreamerbird/studio/uiComponents/chordial/chordialInternals'
import {translate} from '@dreamerbird/studio/i18n'
import getStudio from '@dreamerbird/studio/getStudio'
import {
  deleteCollection,
  renameCollection,
} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/stateOps'

/**
 * 伪集合行:不是对象,不参与选区;右键 = 重命名(行内)/删除集合
 * (解散分组,成员对象回到默认树,spec §4)。成员对象以 ObjectItem
 * 平铺其中(depth+1),折叠键 collection:{projectId}:{id}。
 */
export const CollectionItem: React.FC<{
  collection: OutlineCollectionState
  members: SheetObject[]
  sheet: Sheet
  depth: number
}> = ({collection, members, sheet, depth}) => {
  const projectId = sheet.address.projectId
  const {collapsed, setCollapsed} = useCollapseStateInOutlinePanel({
    type: 'collection',
    projectId,
    id: collection.id,
  })
  const [editing, setEditing] = useState(false)

  const collections =
    useVal(
      getStudio().atomP.historic.projects.stateByProjectId[projectId]
        .outlineCollections,
    ) ?? []
  // 同名集合显示去重:第二个同名起加序号后缀
  const nameIndex = collections
    .filter((c) => c.name === collection.name)
    .findIndex((c) => c.id === collection.id)
  const label =
    nameIndex > 0 ? `${collection.name} (${nameIndex + 1})` : collection.name

  const {targetRef} = useChordial(
    (): ChordialOpts => ({
      title: collection.name,
      items: [
        {
          type: 'normal',
          label: translate('outline.ctx.rename'),
          callback: () => setEditing(true),
        },
        {type: 'separator'},
        {
          type: 'normal',
          label: translate('outline.ctx.deleteCollection'),
          callback: () => deleteCollection(projectId, collection.id),
        },
      ],
    }),
  )

  return (
    <BaseItem
      label={label}
      depth={depth}
      headerRef={targetRef}
      selectionStatus="not-selectable"
      collapsed={collapsed}
      setIsCollapsed={setCollapsed}
      rename={{
        editing,
        onSubmit: (name) => {
          renameCollection(projectId, collection.id, name)
          setEditing(false)
        },
        onCancel: () => setEditing(false),
      }}
    >
      {members.map((object) => (
        <ObjectItem
          key={object.address.objectKey}
          sheetObject={object}
          depth={depth + 1}
        />
      ))}
    </BaseItem>
  )
}
```

- [ ] **Step 3: ObjectsList.tsx 集成**

3a. 文件顶部 import 增加：

```ts
import {nanoid as generateNonSecure} from 'nanoid/non-secure'
import {CollectionItem} from './CollectionItem'
import {createEmptyCollection} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/stateOps'
import {nextDefaultCollectionName} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/collectOutlineMenuItems'
import type {ChordialOpts} from '@dreamerbird/studio/uiComponents/chordial/chordialInternals'
import {translate} from '@dreamerbird/studio/i18n'
```

3b. `ObjectsList` 组件整体替换为：

```tsx
const ListContainer = styled.div`
  display: flex;
  flex-direction: column;
`

const ObjectsList: React.FC<{
  depth: number
  sheet: Sheet
}> = ({sheet, depth}) => {
  // 空白处右键:仅"新建集合…"(容器上独立 chordial;行内菜单按 DOM 就近
  // 优先,右键落在对象行时自然落到行的菜单,spec §4)
  const {targetRef: emptyAreaRef} = useChordial(
    (): ChordialOpts => ({
      title: translate('outline.ctx.newCollection'),
      items: [
        {
          type: 'normal',
          label: translate('outline.ctx.newCollection'),
          callback: () => {
            const projectId = sheet.address.projectId
            const current =
              val(
                getStudio().atomP.historic.projects.stateByProjectId[projectId]
                  .outlineCollections,
              ) ?? []
            createEmptyCollection(
              projectId,
              generateNonSecure(10),
              nextDefaultCollectionName(current, translate),
            )
          },
        },
      ],
    }),
  )

  return usePrism(() => {
    const objectsMap = val(sheet.objectsP)
    const objects = Object.values(objectsMap).filter(
      (a): a is SheetObject => a != null && !a.template.hideFromOutline,
    )

    const collections =
      val(
        getStudio().atomP.historic.projects.stateByProjectId[
          sheet.address.projectId
        ].outlineCollections,
      ) ?? []

    // 成员对象从默认命名空间树过滤(spec §4);真删残留的 key 在这里
    // 自然消失(求交),不用先清理名单
    const memberOf = new Map<string, string>()
    for (const c of collections) {
      for (const m of c.members) memberOf.set(m, c.id)
    }
    const visibleObjects = objects.filter(
      (o) => !memberOf.has(o.address.objectKey),
    )

    const rootObject: NamespacedObjects = new Map()
    visibleObjects.forEach((object) => {
      addToNamespace(rootObject, object)
    })

    return (
      <ListContainer ref={emptyAreaRef}>
        {collections.map((collection) => (
          <CollectionItem
            key={`collection:${collection.id}`}
            collection={collection}
            members={objects.filter((o) =>
              collection.members.includes(o.address.objectKey),
            )}
            sheet={sheet}
            depth={depth}
          />
        ))}
        <NamespaceTree
          namespace={rootObject}
          visualIndentation={depth}
          path={[]}
          sheet={sheet}
        />
      </ListContainer>
    )
  }, [sheet, depth])
}
```

（注意：`useChordial` 在组件顶层、`usePrism` 之前调用——hook 顺序固定。`ObjectsList` 从"直接 return usePrism(...)"改为先调 `useChordial` 再 return。）

3c. 检查 `Namespace` 中 `sameNameElt`/`MergedObjectItem` 分支不受影响；`addToNamespace`、`getObjectNamespacePath`、memo 部分原样保留。

- [ ] **Step 4: 类型检查 + 全量相关测试**

Run: `npx tsc --noEmit -p packages/studio`
Expected: 无错误
Run: `yarn jest packages/studio/src/panels/OutlinePanel packages/studio/src/i18n`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add packages/studio/src/panels/OutlinePanel/outlinePanelUtils.ts packages/studio/src/panels/OutlinePanel/ObjectsList/CollectionItem.tsx packages/studio/src/panels/OutlinePanel/ObjectsList/ObjectsList.tsx
git commit -m "feat(studio): 大纲伪集合渲染——集合行置顶(重命名/删除集合菜单、折叠),成员对象从默认树过滤平铺其中,空白处右键新建集合"
```

---

### Task 7: camera 场景宿主接入（outlineObjectMenu）

**Files:**
- Create: `packages/playground/src/shared/camera/outlineObjectMenu.ts`
- Test: `packages/playground/src/shared/camera/outlineObjectMenu.test.ts`
- Modify: `packages/playground/src/shared/camera/App.tsx`
- Modify: `packages/playground/src/shared/camera/i18n.ts`（无需改——复用 `pg.menu.delete`，确认存在即可）

**Interfaces:**
- Consumes: Task 1 的 `OutlineObjectMenuContribution`/`OutlineMenuItem`（core public）
- Produces:
  ```ts
  export const cameraOutlineMenuExtensionId = '@dreamerbird/camera-outline-menu'
  export type CameraOutlineMenuHandlers = {
    removeCamera(entry: CameraEntry): void
    removeAnchor(key: string, object?: ISheetObject<any>): void
    removePlacement(key: string): void
    removePath(pathKey: string): void
  }
  export type CameraOutlineMenuCtx = {
    sheet: ISheet
    cameras: CameraEntry[]
    anchors: string[]
    placements: PlacementEntry[]
    paths: PathEntry[]
    handlers: CameraOutlineMenuHandlers
  }
  export function setCameraOutlineMenuCtx(ctx: CameraOutlineMenuCtx | undefined): void
  export function cameraOutlineObjectMenu(
    object: ISheetObject<any>,
  ): OutlineObjectMenuContribution | undefined
  export function cameraOutlineMenuItems(
    object: ISheetObject<any>,
    ctx: CameraOutlineMenuCtx,
    t?: (key: string, vars?: Record<string, unknown>) => string,
  ): OutlineObjectMenuContribution | undefined
  ```

- [ ] **Step 1: 写失败测试 outlineObjectMenu.test.ts**

```ts
import {
  cameraOutlineMenuItems,
  cameraOutlineObjectMenu,
  setCameraOutlineMenuCtx,
  type CameraOutlineMenuCtx,
} from './outlineObjectMenu'
import {makeDictT, en} from './i18n'
import type {ISheetObject} from '@dreamerbird/core'

const t = makeDictT(en)

function makeCtx(overrides: Partial<CameraOutlineMenuCtx> = {}): CameraOutlineMenuCtx {
  return {
    sheet: {} as any,
    cameras: [],
    anchors: [],
    placements: [],
    paths: [],
    handlers: {
      removeCamera: () => {},
      removeAnchor: () => {},
      removePlacement: () => {},
      removePath: () => {},
    },
    ...overrides,
  }
}

const asObject = (objectKey: string): ISheetObject<any> =>
  ({address: {objectKey}}) as unknown as ISheetObject<any>

describe('cameraOutlineMenuItems', () => {
  it('命中相机:delete 项接管内置删除(role)', () => {
    const calls: string[] = []
    const ctx = makeCtx({
      cameras: [{cameraKey: 'Shot Camera'}],
      handlers: {
        removeCamera: (e) => calls.push(`camera:${e.cameraKey}`),
        removeAnchor: () => {},
        removePlacement: () => {},
        removePath: () => {},
      },
    })
    const contribution = cameraOutlineMenuItems(
      asObject('Shot Camera'),
      ctx,
      t,
    )
    expect(contribution).toBeDefined()
    expect(contribution!.items).toHaveLength(1)
    expect(contribution!.items[0]!.label).toBe('Delete')
    expect(contribution!.items[0]!.role).toBe('delete')
    contribution!.items[0]!.onSelect()
    expect(calls).toEqual(['camera:Shot Camera'])
  })

  it('命中锚点:传 key 和对象本身', () => {
    const calls: string[] = []
    const ctx = makeCtx({
      anchors: ['Anchor 1'],
      handlers: {
        removeCamera: () => {},
        removeAnchor: (key, obj) => calls.push(`anchor:${key}:${obj ? 'obj' : 'noobj'}`),
        removePlacement: () => {},
        removePath: () => {},
      },
    })
    const obj = asObject('Anchor 1')
    const contribution = cameraOutlineMenuItems(obj, ctx, t)
    contribution!.items[0]!.onSelect()
    expect(calls).toEqual(['anchor:Anchor 1:obj'])
  })

  it('命中放置模型与路径', () => {
    const calls: string[] = []
    const ctx = makeCtx({
      placements: [{key: 'Model A', position: {x: 0, y: 0, z: 0}}],
      paths: [{pathKey: 'Path 1'}],
      handlers: {
        removeCamera: () => {},
        removeAnchor: () => {},
        removePlacement: (key) => calls.push(`placement:${key}`),
        removePath: (key) => calls.push(`path:${key}`),
      },
    })
    cameraOutlineMenuItems(asObject('Model A'), ctx, t)!.items[0]!.onSelect()
    cameraOutlineMenuItems(asObject('Path 1'), ctx, t)!.items[0]!.onSelect()
    expect(calls).toEqual(['placement:Model A', 'path:Path 1'])
  })

  it('未命中(Thingy/注册表等)返回 undefined,走 studio 默认菜单', () => {
    const ctx = makeCtx({cameras: [{cameraKey: 'Shot Camera'}]})
    expect(cameraOutlineMenuItems(asObject('Thingy'), ctx, t)).toBeUndefined()
  })
})

describe('cameraOutlineObjectMenu(注册扩展用)', () => {
  it('ctx 未设置时返回 undefined', () => {
    setCameraOutlineMenuCtx(undefined)
    expect(cameraOutlineObjectMenu(asObject('Shot Camera'))).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn jest packages/playground/src/shared/camera/outlineObjectMenu.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 outlineObjectMenu.ts**

```ts
import {translate} from '@dreamerbird/studio/i18n'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import type {
  OutlineObjectMenuContribution,
  OutlineMenuItem,
} from '@dreamerbird/core/types/public'
import type {CameraEntry} from './cameraRegistry'
import type {PathEntry} from './pathRegistry'
import type {PlacementEntry} from './PlacementManager'

export const cameraOutlineMenuExtensionId =
  '@dreamerbird/camera-outline-menu'

export type CameraOutlineMenuHandlers = {
  removeCamera(entry: CameraEntry): void
  removeAnchor(key: string, object?: ISheetObject<any>): void
  removePlacement(key: string): void
  removePath(pathKey: string): void
}

export type CameraOutlineMenuCtx = {
  sheet: ISheet
  cameras: CameraEntry[]
  anchors: string[]
  placements: PlacementEntry[]
  paths: PathEntry[]
  handlers: CameraOutlineMenuHandlers
}

/**
 * 模块级 ctx:App 每渲染刷新(见 App.tsx),菜单点开时读到的就是最新清单
 * 与处理器。纯函数 cameraOutlineMenuItems 注入 ctx,测试对齐
 * menuModel.test.ts 的模式。
 */
let ctx: CameraOutlineMenuCtx | undefined

export function setCameraOutlineMenuCtx(
  next: CameraOutlineMenuCtx | undefined,
): void {
  ctx = next
}

export function cameraOutlineObjectMenu(
  object: ISheetObject<any>,
): OutlineObjectMenuContribution | undefined {
  if (!ctx) return undefined
  return cameraOutlineMenuItems(object, ctx)
}

/**
 * 用四个注册表反查对象归属;命中 → 返回接管删除的菜单项
 * (role:'delete',studio 不再显示默认删除);未命中 → undefined,
 * 走 studio 内置菜单(Thingy / Key Light / 导演相机组等)。
 * 删除处理器与画布右键共用同一套函数,两个入口行为一致。
 */
export function cameraOutlineMenuItems(
  object: ISheetObject<any>,
  ctx: CameraOutlineMenuCtx,
  t: (key: string, vars?: Record<string, unknown>) => string = translate,
): OutlineObjectMenuContribution | undefined {
  const key = object.address.objectKey
  let onDelete: (() => void) | undefined

  const camera = ctx.cameras.find((e) => e.cameraKey === key)
  if (camera) {
    onDelete = () => ctx.handlers.removeCamera(camera)
  } else if (ctx.anchors.includes(key)) {
    onDelete = () => ctx.handlers.removeAnchor(key, object)
  } else if (ctx.placements.some((e) => e.key === key)) {
    onDelete = () => ctx.handlers.removePlacement(key)
  } else if (ctx.paths.some((e) => e.pathKey === key)) {
    onDelete = () => ctx.handlers.removePath(key)
  }

  if (!onDelete) return undefined

  const item: OutlineMenuItem = {
    type: 'normal',
    label: t('pg.menu.delete'),
    onSelect: onDelete,
    role: 'delete',
  }
  return {items: [item]}
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `yarn jest packages/playground/src/shared/camera/outlineObjectMenu.test.ts`
Expected: PASS（6 用例）

- [ ] **Step 5: App.tsx 接线**

5a. import 块追加（`./outlineObjectMenu` 与 stateOps）：

```ts
import {
  cameraOutlineMenuExtensionId,
  cameraOutlineObjectMenu,
  setCameraOutlineMenuCtx,
} from './outlineObjectMenu'
import {pruneObjectFromOutlineCollections} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/stateOps'
```

5b. 在 `deleteCamera` useCallback 之后（~761 行）插入：

```tsx
  // 大纲右键删除走宿主注册表删除流程(与画布右键同一套真删);
  // extend 按 id 幂等覆盖,重复执行安全
  useEffect(() => {
    getStudioSync()?.extend({
      id: cameraOutlineMenuExtensionId,
      outlineObjectMenu: cameraOutlineObjectMenu,
    })
  }, [])

  // 每渲染刷新菜单上下文:注册表清单 + 删除处理器(含集合名单清理)。
  // App 不卸载;卸载时清 ctx,防止悬空 sheet 引用
  useEffect(() => {
    const projectId = sheet.address.projectId
    setCameraOutlineMenuCtx({
      sheet,
      cameras,
      anchors,
      placements: readPlacementEntries(sheet),
      paths,
      handlers: {
        removeCamera: (entry) => {
          deleteCamera(entry)
          pruneObjectFromOutlineCollections(projectId, entry.cameraKey)
        },
        removeAnchor: (key, object) => {
          removeAnchor(sheet, key, (object as any)?.publicApi ?? object)
          getStudioSync()?.setSelection([])
          pruneObjectFromOutlineCollections(projectId, key)
        },
        removePlacement: (key) => {
          deletePlacement(sheet, key)
          getStudioSync()?.setSelection([])
          pruneObjectFromOutlineCollections(projectId, key)
        },
        removePath: (pathKey) => {
          removePath(pathKey)
          pruneObjectFromOutlineCollections(projectId, pathKey)
        },
      },
    })
    return () => setCameraOutlineMenuCtx(undefined)
  })
```

注意：
- `removePath` 属性值里的 `removePath(pathKey)` 指向 App 已有的 `removePath` useCallback(~1067 行)——属性名不遮蔽闭包变量,可直接引用;若 lint 报 no-shadow 类问题,把外层回调先赋局部别名再引用。
- `deleteCamera`、`deletePlacement`、`readPlacementEntries`、`cameras`、`anchors`、`paths`、`sheet` 均为 App 现有变量/函数,直接复用。
- 若 `useAnchorsList` 的返回值在 App 中不叫 `anchors`(请按实际变量名调整;App 已导入 `useAnchorsList`)。

5c. 类型检查 + camera 全量测试：

Run: `npx tsc --noEmit -p packages/playground`
Expected: 无错误
Run: `yarn jest packages/playground/src/shared/camera`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add packages/playground/src/shared/camera/outlineObjectMenu.ts packages/playground/src/shared/camera/outlineObjectMenu.test.ts packages/playground/src/shared/camera/App.tsx
git commit -m "feat(playground): camera 场景接入大纲右键扩展——相机/锚点/放置/路径删除项接管 studio 内置删除,与画布右键共用同一套真删流程,删除顺手清理伪集合名单"
```

---

### Task 8: 收尾验证

**Files:** 无新增（验证 + 冒烟清单）

- [ ] **Step 1: 三包类型检查**

Run: `npx tsc --noEmit -p packages/core && npx tsc --noEmit -p packages/sync-server && npx tsc --noEmit -p packages/studio && npx tsc --noEmit -p packages/playground`
Expected: 全部无错误

- [ ] **Step 2: 相关 jest 全量**

Run: `yarn jest packages/studio/src/panels/OutlinePanel packages/studio/src/i18n packages/sync-server/src/state packages/playground/src/shared/camera`
Expected: 全绿

- [ ] **Step 3: 既有套件回归**

Run: `yarn jest packages/studio/src/integration-tests/persistence.test.ts packages/studio/src/integration-tests/createContentOfSaveFile.test.ts`
Expected: PASS（新切片可选字段不影响持久化/存盘格式）

- [ ] **Step 4: 手工冒烟清单(浏览器,需用户执行)**

1. 大纲对象行右键:复制/粘贴/重命名/删除齐全;camera 场景的相机/锚点/模型/路径右键删除后**刷新不复活**(注册表真删),Thingy 删除走内置。
2. 复制一台相机的取景参数 → 粘贴到另一台:值整体写入、可撤销;对非同类对象(如锚点)粘贴项置灰。
3. 重命名显示名:行内输入、Enter 提交、Esc 取消、空串清除回退原名;刷新后仍在;中/英文切换即时。
4. 伪集合:对象菜单"新建集合…"输入名称建集合并移入;"移到集合：X"/"从集合移出"工作正常;集合行右键重命名/删除集合;空白处右键新建集合;成员从默认树消失、集合解散后成员回默认树。
5. 集合内成员被删除(真删)后,刷新前后都不出现幽灵行。
6. 旧项目(无新切片状态)打开正常,大纲与以前行为一致。

---

## Self-Review 记录

- **Spec 覆盖**:§1 扩展协议→T1/T4/T5;§2 内置菜单(复制/粘贴/重命名/删除+指纹)→T3/T4/T5;§3 显示名→T2/T5;§4 伪集合→T2/T5/T6;§5 camera 宿主→T7;§6 i18n→T4(camera 复用 pg.menu.delete,spec §5 允许);§7 测试→T2/T3/T4/T7 均有失败先行的单测;§8 风险→行内输入 stopPropagation(T5)、渲染求交兜底(T6)、forgetObject try/catch(T5);§9 二期→不在本期。
- **占位符扫描**:全文无 TBD/TODO;每个代码步骤给出可直接转写的完整实现。
- **类型一致性**:`OutlineMenuItem`/`OutlineObjectMenuContribution`(T1)= T4/T7 引用一致;`ObjectSnapshot`(T3)= T4 参数一致;stateEditors 七件套签名(T2)= T5 stateOps 调用一致;`objectAddressKey`/`useOutlineObjectMenu` 返回值(T5)= ObjectItem/MergedObjectItem/CollectionItem 消费一致;`nextDefaultCollectionName`(T4)= T5/T6 调用一致。
- **依赖顺序**:T1→T4/T7(类型);T2→T5/T6/T7(状态);T3→T4/T5(剪贴板);T4→T5/T6(装配);T5→T6(对象行 hook);T7 依赖 T1+T2(prune)+App 现有删除函数。
