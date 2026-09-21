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
    const outline =
      stateEditors.studio.historic.projects.stateByProjectId.outline
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
    stateEditors.studio.historic.projects.stateByProjectId.outline.addCollection(
      {
        projectId,
        id,
        name,
      },
    )
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
    stateEditors.studio.historic.projects.stateByProjectId.outline.deleteCollection(
      {
        projectId,
        id,
      },
    )
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
