import {stateEditors} from './schema'
import type {OutlineCollectionState} from '@dreamerbird/core/types/private/studio'
import type {ProjectId} from '@dreamerbird/core/types/public'

const p1 = 'p1' as ProjectId

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
  const base = {projectId: p1}

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
    outline.deleteCollection(draft, {}, {...base, id: 'c1'})
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
      {...base, collectionId: 'c1', objectKey: 'Obj'},
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
      {...base, objectKey: 'Obj'},
    )
    const collections =
      draft.historic.projects.stateByProjectId.p1.outlineCollections
    expect(collections[0].members).toEqual([])
    expect(collections[1].members).toEqual([])
  })
})
