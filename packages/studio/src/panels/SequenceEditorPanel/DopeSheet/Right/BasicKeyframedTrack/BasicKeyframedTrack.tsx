import type {TrackData} from '@toy-box/core/types/private/core'
import type {SequenceEditorPanelLayout} from '@toy-box/studio/panels/SequenceEditorPanel/layout/layout'
import type {SequenceEditorTree_PrimitiveProp} from '@toy-box/studio/panels/SequenceEditorPanel/layout/tree'
import {usePrism, useVal} from '@toy-box/react'
import type {Pointer} from '@toy-box/dataverse'
import {val} from '@toy-box/dataverse'
import React, {useMemo} from 'react'
import styled from 'styled-components'
import SingleKeyframeEditor from './KeyframeEditor/SingleKeyframeEditor'
import useContextMenu from '@toy-box/studio/uiComponents/simpleContextMenu/useContextMenu'
import useRefAndState from '@toy-box/studio/utils/useRefAndState'
import getStudio from '@toy-box/studio/getStudio'
import {arePathsEqual} from '@toy-box/utils/pathToProp'
import type {KeyframeWithPathToPropFromCommonRoot} from '@toy-box/core/types/private'
import KeyframeSnapTarget, {
  snapPositionsStateD,
} from '@toy-box/studio/panels/SequenceEditorPanel/DopeSheet/Right/KeyframeSnapTarget'
import {createStudioSheetItemKey} from '@toy-box/studio/utils/createStudioSheetItemKey'
import type {BasicKeyframe} from '@toy-box/core'
import {__private} from '@toy-box/core'

const {keyframeUtils} = __private
import type {ContextMenuItem} from '@toy-box/studio/uiComponents/chordial/chordialInternals'

const Container = styled.div`
  position: relative;
  height: 100%;
  width: 100%;
`

type BasicKeyframedTracksProps = {
  leaf: SequenceEditorTree_PrimitiveProp
  layoutP: Pointer<SequenceEditorPanelLayout>
  trackData: TrackData
}

const BasicKeyframedTrack: React.VFC<BasicKeyframedTracksProps> = React.memo(
  (props) => {
    const {layoutP, trackData, leaf} = props
    const [containerRef, containerNode] = useRefAndState<HTMLDivElement | null>(
      null,
    )
    const {selectedKeyframeIds, selection} = usePrism(() => {
      const selectionAtom = val(layoutP.selectionAtom)
      const selectedKeyframeIds = val(
        selectionAtom.pointer.current.byObjectKey[
          leaf.sheetObject.address.objectKey
        ].byTrackId[leaf.trackId].byKeyframeId,
      )
      if (selectedKeyframeIds) {
        return {
          selectedKeyframeIds,
          selection: val(selectionAtom.pointer.current),
        }
      } else {
        return {
          selectedKeyframeIds: {},
          selection: undefined,
        }
      }
    }, [layoutP, leaf.trackId])

    const [contextMenu, _, isOpen] = useBasicKeyframedTrackContextMenu(
      containerNode,
      props,
    )

    const snapPositionsState = useVal(snapPositionsStateD)

    const snapPositions =
      snapPositionsState.mode === 'snapToSome'
        ? snapPositionsState.positions[leaf.sheetObject.address.objectKey]?.[
            leaf.trackId
          ]
        : [] ?? []

    const snapToAllKeyframes = snapPositionsState.mode === 'snapToAll'

    const track = useMemo(
      () => ({
        data: trackData,
        id: leaf.trackId,
        sheetObject: props.leaf.sheetObject,
      }),
      [trackData, leaf.trackId],
    )

    const sortedKeyframes = keyframeUtils.getSortedKeyframesCached(
      trackData.keyframes,
    )
    const keyframeEditors = sortedKeyframes.map((kf, index) => (
      <SingleKeyframeEditor
        key={'keyframe-' + kf.id}
        itemKey={createStudioSheetItemKey.forTrackKeyframe(
          leaf.sheetObject,
          leaf.trackId,
          kf.id,
        )}
        keyframe={kf}
        index={index}
        track={track}
        layoutP={layoutP}
        leaf={leaf}
        selection={selectedKeyframeIds[kf.id] === true ? selection : undefined}
      />
    ))

    const snapTargets = snapPositions.map((position) => (
      <KeyframeSnapTarget
        key={'snap-target-' + position}
        layoutP={layoutP}
        leaf={leaf}
        position={position}
      />
    ))

    const additionalSnapTargets = !snapToAllKeyframes
      ? null
      : sortedKeyframes.map((kf) => (
          <KeyframeSnapTarget
            key={`additionalSnapTarget-${kf.id}`}
            layoutP={layoutP}
            leaf={leaf}
            position={kf.position}
          />
        ))

    return (
      <Container
        ref={containerRef}
        style={{
          background: isOpen ? '#444850 ' : 'unset',
        }}
      >
        {keyframeEditors}
        {snapTargets}
        <>{additionalSnapTargets}</>
        {contextMenu}
      </Container>
    )
  },
)

BasicKeyframedTrack.displayName = `BasicKeyframedTrack`

export default BasicKeyframedTrack

function useBasicKeyframedTrackContextMenu(
  node: HTMLDivElement | null,
  props: BasicKeyframedTracksProps,
) {
  return useContextMenu(node, {
    displayName: 'Keyframe Track',
    items: () => {
      const selectionKeyframes =
        val(
          getStudio()!.atomP.ahistoric.clipboard.keyframesWithRelativePaths,
        ) ?? []

      return [pasteKeyframesContextMenuItem(props, selectionKeyframes)]
    },
  })
}

function pasteKeyframesContextMenuItem(
  props: BasicKeyframedTracksProps,
  keyframes: KeyframeWithPathToPropFromCommonRoot[],
): ContextMenuItem {
  return {
    type: 'normal',
    label: 'Paste Keyframes',
    enabled: keyframes.length > 0,
    callback: () => {
      const sheet = val(props.layoutP.sheet)
      const sequence = sheet.getSequence()

      const firstPath = keyframes[0]?.pathToProp
      const singleTrackKeyframes = keyframes
        .filter(({keyframe, pathToProp}) =>
          arePathsEqual(firstPath, pathToProp),
        )
        .map(({keyframe, pathToProp}) => keyframe)

      getStudio()!.transaction(({stateEditors}) => {
        sequence.position = sequence.closestGridPosition(sequence.position)
        const keyframeOffset = earliestKeyframe(singleTrackKeyframes)?.position!

        for (const keyframe of singleTrackKeyframes) {
          stateEditors.coreByProject.historic.sheetsById.sequence.setKeyframeAtPosition(
            {
              ...props.leaf.sheetObject.address,
              trackId: props.leaf.trackId,
              position: sequence.position + keyframe.position - keyframeOffset,
              handles: keyframe.handles,
              value: keyframe.value,
              snappingFunction: sequence.closestGridPosition,
              type: keyframe.type,
            },
          )
        }
      })
    },
  }
}

function earliestKeyframe(keyframes: BasicKeyframe[]) {
  let curEarliest: BasicKeyframe | null = null
  for (const keyframe of keyframes) {
    if (curEarliest === null || keyframe.position < curEarliest.position) {
      curEarliest = keyframe
    }
  }
  return curEarliest
}
