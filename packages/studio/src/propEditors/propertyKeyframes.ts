import {__private} from '@dreamerbird/core'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import type {HistoricPositionalSequence} from '@dreamerbird/core/types/private/core'
import type {SerializablePrimitive} from '@dreamerbird/core/types/public'
import {Atom, getPointerParts} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import getStudio from '@dreamerbird/studio/getStudio'
import {encodePathToProp} from '@dreamerbird/utils/pathToProp'

export const focusedProperty = new Atom<
  | {
      object: SheetObject
      key: string
    }
  | undefined
>(undefined)

export function togglePropertyKeyframe<T extends SerializablePrimitive>(
  obj: SheetObject,
  pointer: Pointer<T>,
): void {
  const sequence = obj.sheet.getSequence()
  const currentTime = sequence.position
  const snappedTime = sequence.closestGridPosition(currentTime)
  const keys = sequence.publicApi.getKeyframes(pointer)
  const existing =
    keys.find((key) => key.position === currentTime) ??
    keys.find((key) => key.position === snappedTime)
  const value = obj.getValueByPointer(pointer)
  const {path} = getPointerParts(pointer)
  const key = encodePathToProp(path)

  sequence.publicApi.pause()
  sequence.position = existing?.position ?? snappedTime
  getStudio().transaction(({stateEditors}) => {
    const editors = stateEditors.coreByProject.historic.sheetsById.sequence
    const draft = editors._ensure(
      obj.address,
    ) as unknown as HistoricPositionalSequence
    const trackId =
      draft.tracksByObject[obj.address.objectKey]?.trackIdByPropPath[key]
    if (!trackId) {
      editors.setPrimitivePropAsSequenced({...obj.address, pathToProp: path})
      // A track assigned in this transaction has no Immer snapshot yet.
      const tracks = draft.tracksByObject[obj.address.objectKey]!
      const newTrackId = tracks.trackIdByPropPath[key]!
      tracks.trackData[newTrackId]!.keyframes =
        __private.keyframeUtils.fromArray([
          {
            id: __private.ids.asKeyframeId(newTrackId),
            position: snappedTime,
            value,
            connectedRight: true,
            handles: [0.5, 1, 0.5, 0],
            type: 'bezier',
          },
        ])
    } else if (existing) {
      editors.deleteKeyframes({
        ...obj.address,
        trackId,
        keyframeIds: [existing.id],
      })
    } else {
      editors.setKeyframeAtPosition({
        ...obj.address,
        trackId,
        position: snappedTime,
        value,
        snappingFunction: sequence.closestGridPosition,
      })
    }
  })
}
