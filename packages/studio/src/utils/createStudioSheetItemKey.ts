import type SheetObject from '@toy-box/core/sheetObjects/SheetObject'
import type {PathToProp} from '@toy-box/utils/pathToProp'
import stableValueHash from '@toy-box/utils/stableJsonStringify'
import type Sheet from '@toy-box/core/sheets/Sheet'
import type {KeyframeId, SequenceTrackId} from '@toy-box/core/types/public'
import type {StudioSheetItemKey} from '@toy-box/core/types/private'

/**
 * This will not necessarily maintain consistent key values if any
 * versioning happens where something needs to
 */
export const createStudioSheetItemKey = {
  forSheet(): StudioSheetItemKey {
    return 'sheet' as StudioSheetItemKey
  },
  forSheetObject(obj: SheetObject): StudioSheetItemKey {
    return stableValueHash({
      o: obj.address.objectKey,
    }) as StudioSheetItemKey
  },
  forSheetObjectProp(
    obj: SheetObject,
    pathToProp: PathToProp,
  ): StudioSheetItemKey {
    return stableValueHash({
      o: obj.address.objectKey,
      p: pathToProp,
    }) as StudioSheetItemKey
  },
  forTrackKeyframe(
    obj: SheetObject,
    trackId: SequenceTrackId,
    keyframeId: KeyframeId,
  ): StudioSheetItemKey {
    return stableValueHash({
      o: obj.address.objectKey,
      t: trackId,
      k: keyframeId,
    }) as StudioSheetItemKey
  },
  forSheetObjectAggregateKeyframe(
    obj: SheetObject,
    position: number,
  ): StudioSheetItemKey {
    return createStudioSheetItemKey.forCompoundPropAggregateKeyframe(
      obj,
      [],
      position,
    )
  },
  forSheetAggregateKeyframe(obj: Sheet, position: number): StudioSheetItemKey {
    return stableValueHash({
      o: obj.address.sheetId,
      pos: position,
    }) as StudioSheetItemKey
  },
  forCompoundPropAggregateKeyframe(
    obj: SheetObject,
    pathToProp: PathToProp,
    position: number,
  ): StudioSheetItemKey {
    return stableValueHash({
      o: obj.address.objectKey,
      p: pathToProp,
      pos: position,
    }) as StudioSheetItemKey
  },
}
