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
  collectionsOfSheet,
  nextDefaultCollectionName,
} from './collectOutlineMenuItems'
import {
  createEmptyCollection,
  deleteOutlineObject,
  moveObjectToCollection,
  removeObjectFromCollection,
  setObjectDisplayName,
} from './stateOps'
import {setPendingCollectionRename} from './pendingCollectionRename'

/**
 * 对象行的右键菜单 + 显示名 + 行内编辑态。
 * optsFn 在菜单点开那一刻才执行(ContextOverlay 调 optsFn()),
 * 内部用 val() 直读——菜单内容永远新鲜,无需为菜单订阅重渲染。
 * 显示名要显示在行上,所以单独 useVal 订阅。
 */
export function useOutlineObjectMenu(sheetObject: SheetObject): {
  targetRef: MutableRefObject<$FixMe>
  displayName: string | undefined
  editingMode: null | 'name'
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

  const [editingMode, setEditingMode] = useState<null | 'name'>(null)

  const optsFn = useCallback((): ChordialOpts => {
    const extensionsById = val(
      getStudio().ephemeralAtom.pointer.extensions.byId,
    )
    // 集合挂 sheet 维度(spec §4):菜单只列当前 sheet 的集合
    const allCollections =
      val(
        getStudio().atomP.historic.projects.stateByProjectId[projectId]
          .outlineCollections,
      ) ?? []
    const collections = collectionsOfSheet(
      allCollections,
      address.sheetId,
      address.sheetInstanceId,
    )
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
          moveObjectToCollection(
            projectId,
            address.sheetId,
            address.sheetInstanceId,
            collectionId,
            address.objectKey,
          ),
        onRemoveFromCollection: () => {
          if (currentCollectionId) {
            removeObjectFromCollection(
              projectId,
              currentCollectionId,
              address.objectKey,
            )
          }
        },
        onStartNewCollection: () => {
          // 立即建空集合(默认名),名字输入发生在集合行自己挂载时
          // (pendingCollectionRename 登记认领),不在对象行输入
          const allCollections =
            val(
              getStudio().atomP.historic.projects.stateByProjectId[projectId]
                .outlineCollections,
            ) ?? []
          const collections = collectionsOfSheet(
            allCollections,
            address.sheetId,
            address.sheetInstanceId,
          )
          const id = generateNonSecure(10)
          createEmptyCollection(
            projectId,
            address.sheetId,
            address.sheetInstanceId,
            id,
            nextDefaultCollectionName(collections, translate),
          )
          setPendingCollectionRename(id)
        },
      },
    })
    return {title: `Object: ${address.objectKey}`, items}
  }, [sheetObject, address, projectId])

  const {targetRef} = useChordial(optsFn)

  const submitEditing = useCallback(
    (value: string) => {
      if (editingMode === 'name') {
        setObjectDisplayName(projectId, addressKey, value)
      }
      setEditingMode(null)
    },
    [editingMode, projectId, addressKey],
  )

  return {
    targetRef,
    displayName,
    editingMode,
    submitEditing,
    cancelEditing: () => setEditingMode(null),
  }
}
