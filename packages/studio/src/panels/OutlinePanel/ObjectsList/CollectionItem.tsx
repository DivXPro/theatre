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
import {collectionsOfSheet} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/collectOutlineMenuItems'

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

  const allCollections =
    useVal(
      getStudio().atomP.historic.projects.stateByProjectId[projectId]
        .outlineCollections,
    ) ?? []
  // 同名集合显示去重:只在当前 sheet 内比较(spec §4,跨 sheet 同名互不影响)
  const collections = collectionsOfSheet(
    allCollections,
    sheet.address.sheetId,
    sheet.address.sheetInstanceId,
  )
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
