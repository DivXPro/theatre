import type Sheet from '@dreamerbird/core/sheets/Sheet'
import {usePrism, useVal} from '@dreamerbird/react'
import {val} from '@dreamerbird/dataverse'
import React from 'react'
import styled from 'styled-components'
import {ObjectItem} from './ObjectItem'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import BaseItem from '@dreamerbird/studio/panels/OutlinePanel/BaseItem'
import {useCollapseStateInOutlinePanel} from '@dreamerbird/studio/panels/OutlinePanel/outlinePanelUtils'
import getStudio from '@dreamerbird/studio/getStudio'
import {outlineSelection} from '@dreamerbird/studio/selectors'
import {translate} from '@dreamerbird/studio/i18n'
import {useOutlineObjectMenu} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/useOutlineObjectMenu'
import {nanoid as generateNonSecure} from 'nanoid/non-secure'
import {CollectionItem} from './CollectionItem'
import {createEmptyCollection} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/stateOps'
import {collectionsOfSheet} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/collectOutlineMenuItems'
import {nextDefaultCollectionName} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/collectOutlineMenuItems'
import type {ChordialOpts} from '@dreamerbird/studio/uiComponents/chordial/chordialInternals'
import useChordial from '@dreamerbird/studio/uiComponents/chordial/useChodrial'

export const Li = styled.li<{$isSelected: boolean}>`
  color: ${(props) => (props.$isSelected ? 'white' : 'hsl(1, 1%, 80%)')};
`

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
            const allCollections =
              val(
                getStudio().atomP.historic.projects.stateByProjectId[projectId]
                  .outlineCollections,
              ) ?? []
            // 集合挂 sheet 维度(spec §4):默认名也只在当前 sheet 内顺延
            const collections = collectionsOfSheet(
              allCollections,
              sheet.address.sheetId,
              sheet.address.sheetInstanceId,
            )
            createEmptyCollection(
              projectId,
              sheet.address.sheetId,
              sheet.address.sheetInstanceId,
              generateNonSecure(10),
              nextDefaultCollectionName(collections, translate),
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

    // 集合挂 sheet 维度(spec §4):只渲染当前 sheet 的集合,
    // 成员过滤与渲染同源,跨 sheet 同名 objectKey 不会互相吸附
    const allCollections =
      val(
        getStudio().atomP.historic.projects.stateByProjectId[
          sheet.address.projectId
        ].outlineCollections,
      ) ?? []
    const collections = collectionsOfSheet(
      allCollections,
      sheet.address.sheetId,
      sheet.address.sheetInstanceId,
    )

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

function NamespaceTree(props: {
  namespace: NamespacedObjects
  visualIndentation: number
  path: string[]
  sheet: Sheet
}) {
  return (
    <>
      {[...props.namespace.entries()].map(([label, {object, nested}]) => {
        return (
          <Namespace
            key={label}
            label={label}
            object={object}
            nested={nested}
            visualIndentation={props.visualIndentation}
            path={props.path}
            sheet={props.sheet}
          />
        )
      })}
    </>
  )
}

function Namespace(props: {
  nested?: NamespacedObjects
  label: string
  object?: SheetObject
  visualIndentation: number
  path: string[]
  sheet: Sheet
}) {
  const {nested, label, object, sheet} = props
  const {collapsed, setCollapsed} = useCollapseStateInOutlinePanel({
    type: 'namespace',
    sheet,
    path: [...props.path, label],
  })

  const nestedChildrenElt = nested && (
    <NamespaceTree
      namespace={nested}
      path={[...props.path, label]}
      // Question: will there be key conflict if two components have the same labels?
      key={'namespaceTree(' + label + ')'}
      visualIndentation={props.visualIndentation + 1}
      sheet={sheet}
    />
  )
  const sameNameElt = object && (
    <ObjectItem
      depth={props.visualIndentation}
      // key is useful for navigating react dev component tree
      key={'objectPath(' + object.address.objectKey + ')'}
      // object entries should not allow this to be undefined
      sheetObject={object}
      overrideLabel={label}
    />
  )

  // 同名对象 + 子命名空间并存时只画一行:行就是对象本体(点选/右键和
  // ObjectItem 一致),行首箭头展开子节点;折叠状态沿用命名空间路径键
  if (object && nestedChildrenElt) {
    return (
      <MergedObjectItem
        sheetObject={object}
        label={label}
        depth={props.visualIndentation}
        collapsed={collapsed}
        setIsCollapsed={setCollapsed}
        children={nestedChildrenElt}
      />
    )
  }

  return (
    <React.Fragment key={`${label} - ${props.visualIndentation}`}>
      {sameNameElt}
      {nestedChildrenElt && (
        <BaseItem
          selectionStatus="not-selectable"
          label={label}
          // key necessary for no duplicate keys (next to other React.Fragments)
          key={`baseItem(${label})`}
          depth={props.visualIndentation}
          children={nestedChildrenElt}
          collapsed={collapsed}
          setIsCollapsed={setCollapsed}
        />
      )}
    </React.Fragment>
  )
}

/**
 * 同名对象与文件夹合并后的那一行:本体是对象(点选/右键行为和
 * ObjectItem 一致),行首箭头负责展开/折叠子命名空间。
 */
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
        onSubmit: submitEditing,
        onCancel: cancelEditing,
      }}
    />
  )
}

export default ObjectsList

/** See {@link addToNamespace} for adding to the namespace, easily. */
type NamespacedObjects = Map<
  string,
  {
    object?: SheetObject
    nested?: NamespacedObjects
    path: string[]
  }
>

function addToNamespace(
  mutObjects: NamespacedObjects,
  object: SheetObject,
  path = getObjectNamespacePath(object),
) {
  const [next, ...rest] = path
  let existing = mutObjects.get(next)
  if (!existing) {
    existing = {
      nested: undefined,
      object: undefined,
      path: [...path],
    }
    mutObjects.set(next, existing)
  }

  if (rest.length === 0) {
    console.assert(
      !existing.object,
      'expect not to have existing object with same name',
      {existing, object},
    )
    existing.object = object
  } else {
    if (!existing.nested) {
      existing.nested = new Map()
    }

    addToNamespace(existing.nested, object, rest)
  }
}

function getObjectNamespacePath(object: SheetObject): string[] {
  let existing = OBJECT_SPLITS_MEMO.get(object)
  if (!existing) {
    existing = object.address.objectKey.split(
      RE_SPLIT_BY_SLASH_WITHOUT_WHITESPACE,
    )
    console.assert(existing.length > 0, 'expected not empty')
    OBJECT_SPLITS_MEMO.set(object, existing)
  }
  return existing
}
/**
 * Relying on the fact we try to "sanitize paths" earlier.
 * Go look for `sanifySlashedPath` in a `utils/slashedPaths.ts`.
 */
const RE_SPLIT_BY_SLASH_WITHOUT_WHITESPACE = /\s*\/\s*/g
const OBJECT_SPLITS_MEMO = new WeakMap<SheetObject, string[]>()
