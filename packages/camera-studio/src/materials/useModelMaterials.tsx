import type {ISheetObject} from '@dreamerbird/core'
import {useVal} from '@dreamerbird/react'
import {useEffect, useMemo} from 'react'
import {TextureLoader, type Group} from 'three'
import {getLibrary} from '../assetLibrary/library'
import {LibraryError} from '../assetLibrary/source'
import {
  applyMaterialScalars,
  createMaterialTextureController,
} from './modelMaterials'
import type {MaterialSlot, MaterialValues} from './types'

export function useModelMaterials({
  instance,
  sheetObject,
  slots,
  invalidate,
}: {
  instance: Group
  sheetObject: ISheetObject<any> | undefined
  slots: MaterialSlot[]
  invalidate(): void
}): void {
  const overrides =
    (useVal(sheetObject?.props.materialOverrides) as
      | Record<string, MaterialValues>
      | undefined) ?? {}
  const controller = useMemo(() => {
    const loader = new TextureLoader()
    return createMaterialTextureController({
      getBlobUrl: (blobId) => getLibrary().getBlobUrl(blobId),
      loadTexture: (url) => loader.loadAsync(url),
      onError: (error, slotId, property) => {
        getLibrary().reportError(
          new LibraryError(
            'network',
            `材质贴图加载失败: ${slotId}/${property}`,
            error,
          ),
        )
      },
      invalidate,
    })
  }, [instance, invalidate])

  useEffect(() => {
    applyMaterialScalars(instance, slots, overrides)
    invalidate()
    void controller.update(instance, slots, overrides)
  }, [instance, slots, overrides, controller, invalidate])

  useEffect(() => () => controller.dispose(), [controller])
}
