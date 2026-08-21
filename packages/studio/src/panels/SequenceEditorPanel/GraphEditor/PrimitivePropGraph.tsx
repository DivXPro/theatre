import type SheetObject from '@toy-box/core/sheetObjects/SheetObject'
import getStudio from '@toy-box/studio/getStudio'
import type {PathToProp} from '@toy-box/utils/pathToProp'
import type {SequenceTrackId} from '@toy-box/core/types/public'
import {usePrism} from '@toy-box/react'
import type {Pointer} from '@toy-box/dataverse'
import {val} from '@toy-box/dataverse'
import React from 'react'
import type {SequenceEditorPanelLayout} from '@toy-box/studio/panels/SequenceEditorPanel/layout/layout'
import BasicKeyframedTrack from './BasicKeyframedTrack/BasicKeyframedTrack'
import type {GraphEditorColors} from '@toy-box/core/types/private'

const PrimitivePropGraph: React.FC<{
  layoutP: Pointer<SequenceEditorPanelLayout>
  sheetObject: SheetObject
  pathToProp: PathToProp
  trackId: SequenceTrackId
  color: keyof GraphEditorColors
}> = (props) => {
  return usePrism(() => {
    const {sheetObject, trackId} = props
    const trackData = val(
      getStudio()!.atomP.historic.coreByProject[sheetObject.address.projectId]
        .sheetsById[sheetObject.address.sheetId].sequence.tracksByObject[
        sheetObject.address.objectKey
      ].trackData[trackId],
    )

    if (trackData?.type !== 'BasicKeyframedTrack') {
      console.error(
        `trackData type ${trackData?.type} is not yet supported on the graph editor`,
      )
      return <></>
    } else {
      return <BasicKeyframedTrack {...props} trackData={trackData} />
    }
  }, [props.trackId, props.layoutP])
}

export default PrimitivePropGraph
