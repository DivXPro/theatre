import {stateEditors} from './schema'
import type {OutlineCollectionState} from '@dreamerbird/core/types/private/studio'
import type {
  ProjectId,
  SheetId,
  SheetInstanceId,
} from '@dreamerbird/core/types/public'

const p1 = 'p1' as ProjectId
// sheet 维度用例的两组 sheet 地址(spec §4:集合挂 sheet 维度)
const sh1 = 'sh1' as SheetId
const si1 = 'si1' as SheetInstanceId
const sh2 = 'sh2' as SheetId
const si2 = 'si2' as SheetInstanceId

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
    outline.setObjectDisplayName(
      draft,
      {},
      {
        projectId: p1,
        addressKey: '{"k":1}',
        name: '主角相机',
      },
    )
    expect(
      draft.historic.projects.stateByProjectId.p1.outlineNamesByObjectAddress[
        '{"k":1}'
      ],
    ).toBe('主角相机')
  })

  it('空字符串清除名称', () => {
    const draft = makeDraft()
    outline.setObjectDisplayName(
      draft,
      {},
      {projectId: p1, addressKey: 'a', name: 'X'},
    )
    outline.setObjectDisplayName(
      draft,
      {},
      {projectId: p1, addressKey: 'a', name: '  '},
    )
    expect(
      draft.historic.projects.stateByProjectId.p1.outlineNamesByObjectAddress,
    ).toEqual({})
  })
})

describe('outline 伪集合', () => {
  const base = {projectId: p1, sheetId: sh1, sheetInstanceId: si1}

  it('addCollection 追加空集合并记录 sheet 地址', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: '集合 1'})
    const collections: OutlineCollectionState[] =
      draft.historic.projects.stateByProjectId.p1.outlineCollections
    expect(collections).toEqual([
      {
        id: 'c1',
        name: '集合 1',
        sheetId: sh1,
        sheetInstanceId: si1,
        members: [],
      },
    ])
  })

  it('renameCollection 改名', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.renameCollection(draft, {}, {projectId: p1, id: 'c1', name: 'B'})
    expect(
      draft.historic.projects.stateByProjectId.p1.outlineCollections[0].name,
    ).toBe('B')
  })

  it('deleteCollection 解散集合不动成员对象', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.addCollectionMember(
      draft,
      {},
      {...base, collectionId: 'c1', objectKey: 'Obj'},
    )
    outline.deleteCollection(draft, {}, {projectId: p1, id: 'c1'})
    expect(
      draft.historic.projects.stateByProjectId.p1.outlineCollections,
    ).toEqual([])
  })

  it('addCollectionMember 单归属:移入新集合时自动移出旧集合', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.addCollection(draft, {}, {...base, id: 'c2', name: 'B'})
    outline.addCollectionMember(
      draft,
      {},
      {...base, collectionId: 'c1', objectKey: 'Obj'},
    )
    outline.addCollectionMember(
      draft,
      {},
      {...base, collectionId: 'c2', objectKey: 'Obj'},
    )
    const collections =
      draft.historic.projects.stateByProjectId.p1.outlineCollections
    expect(collections[0].members).toEqual([])
    expect(collections[1].members).toEqual(['Obj'])
  })

  it('removeCollectionMember 移出', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.addCollectionMember(
      draft,
      {},
      {...base, collectionId: 'c1', objectKey: 'Obj'},
    )
    outline.removeCollectionMember(
      draft,
      {},
      {projectId: p1, collectionId: 'c1', objectKey: 'Obj'},
    )
    expect(
      draft.historic.projects.stateByProjectId.p1.outlineCollections[0].members,
    ).toEqual([])
  })

  it('removeObjectFromAllCollections 清掉所有名单残留', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.addCollection(draft, {}, {...base, id: 'c2', name: 'B'})
    outline.addCollectionMember(
      draft,
      {},
      {...base, collectionId: 'c1', objectKey: 'Obj'},
    )
    outline.addCollectionMember(
      draft,
      {},
      {...base, collectionId: 'c2', objectKey: 'Obj'},
    )
    outline.removeObjectFromAllCollections(
      draft,
      {},
      {...base, sheetId: sh1, sheetInstanceId: si1, objectKey: 'Obj'},
    )
    const collections =
      draft.historic.projects.stateByProjectId.p1.outlineCollections
    expect(collections[0].members).toEqual([])
    expect(collections[1].members).toEqual([])
  })
})

describe('outline 伪集合 sheet 维度(spec §4)', () => {
  const base = {projectId: p1, sheetId: sh1, sheetInstanceId: si1}

  it('不同 sheet 的同名集合共存,各自记录自己的 sheet 地址', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: '同名'})
    outline.addCollection(
      draft,
      {},
      {
        projectId: p1,
        sheetId: sh2,
        sheetInstanceId: si2,
        id: 'c2',
        name: '同名',
      },
    )
    const collections: OutlineCollectionState[] =
      draft.historic.projects.stateByProjectId.p1.outlineCollections
    expect(collections).toEqual([
      {id: 'c1', name: '同名', sheetId: sh1, sheetInstanceId: si1, members: []},
      {id: 'c2', name: '同名', sheetId: sh2, sheetInstanceId: si2, members: []},
    ])
  })

  it('单归属驱逐不跨 sheet:同名 objectKey 在各自 sheet 独立归属', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.addCollection(
      draft,
      {},
      {
        projectId: p1,
        sheetId: sh2,
        sheetInstanceId: si2,
        id: 'c2',
        name: 'B',
      },
    )
    // sheet1 的对象 Obj 进 c1
    outline.addCollectionMember(
      draft,
      {},
      {...base, collectionId: 'c1', objectKey: 'Obj'},
    )
    // sheet2 同名 objectKey 的对象进 c2,不得把 c1 的成员顶掉
    outline.addCollectionMember(
      draft,
      {},
      {
        projectId: p1,
        sheetId: sh2,
        sheetInstanceId: si2,
        collectionId: 'c2',
        objectKey: 'Obj',
      },
    )
    const collections =
      draft.historic.projects.stateByProjectId.p1.outlineCollections
    expect(collections[0].members).toEqual(['Obj'])
    expect(collections[1].members).toEqual(['Obj'])
  })

  it('单归属驱逐在同 sheet 内仍然生效', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.addCollection(draft, {}, {...base, id: 'c2', name: 'B'})
    outline.addCollectionMember(
      draft,
      {},
      {...base, collectionId: 'c1', objectKey: 'Obj'},
    )
    outline.addCollectionMember(
      draft,
      {},
      {...base, collectionId: 'c2', objectKey: 'Obj'},
    )
    const collections =
      draft.historic.projects.stateByProjectId.p1.outlineCollections
    expect(collections[0].members).toEqual([])
    expect(collections[1].members).toEqual(['Obj'])
  })

  it('removeObjectFromAllCollections 只清同 sheet 名单,不误清其它 sheet 同名对象', () => {
    const draft = makeDraft()
    outline.addCollection(draft, {}, {...base, id: 'c1', name: 'A'})
    outline.addCollection(
      draft,
      {},
      {
        projectId: p1,
        sheetId: sh2,
        sheetInstanceId: si2,
        id: 'c2',
        name: 'B',
      },
    )
    outline.addCollectionMember(
      draft,
      {},
      {...base, collectionId: 'c1', objectKey: 'Obj'},
    )
    outline.addCollectionMember(
      draft,
      {},
      {
        projectId: p1,
        sheetId: sh2,
        sheetInstanceId: si2,
        collectionId: 'c2',
        objectKey: 'Obj',
      },
    )
    outline.removeObjectFromAllCollections(
      draft,
      {},
      {...base, sheetId: sh1, sheetInstanceId: si1, objectKey: 'Obj'},
    )
    const collections =
      draft.historic.projects.stateByProjectId.p1.outlineCollections
    expect(collections[0].members).toEqual([])
    expect(collections[1].members).toEqual(['Obj'])
  })
})
