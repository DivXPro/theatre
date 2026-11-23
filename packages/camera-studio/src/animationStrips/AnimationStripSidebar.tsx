import {val} from '@dreamerbird/dataverse'
import {useT} from '@dreamerbird/studio/i18n'
import React from 'react'
import styled from 'styled-components'
import {useAnimationEntriesById} from '../assetLibrary/library'
import {
  AnimationStripProperties,
  AnimationStripPropertiesPanel,
} from './AnimationStripProperties'
import {findAnimationStrip, objectChannelsFor} from './model'
import type {
  AnimationStrip,
  AnimationTrack,
  AnimationTrackState,
  ObjectAnimationChannel,
} from './model'
import type {AnimationTracksObject} from './storage'
import {
  animationObjectAddressKey,
  animationStripSelectionB,
  clearAnimationStripSelection,
  openAnimationStripAction,
} from './stripSelection'

const channelLabels: Record<ObjectAnimationChannel, string> = {
  position: 'pg.strips.channelPosition',
  quaternion: 'pg.strips.channelQuaternion',
  scale: 'pg.strips.channelScale',
}

const Sidebar = styled(AnimationStripPropertiesPanel)`
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  font-size: 11px;

  form[data-camera-strip-properties] {
    display: grid;
    gap: 12px;
    padding: 10px 10px 12px;
  }

  form[data-camera-strip-properties] header {
    gap: 6px;
    align-items: flex-start;
  }

  .title {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .eyebrow,
  .track {
    color: #919191;
    font-size: 10px;
    line-height: 1.2;
  }

  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .track {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    padding: 0;
    color: #919191;
    background: transparent;
    border: 0;
  }

  .hint {
    color: #919191;
    font-size: 10px;
    line-height: 1.35;
  }

  fieldset {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    margin-bottom: 3px;
    padding: 0;
    color: #b8b8b8;
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  label {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.65fr);
    align-items: center;
    gap: 8px;
    overflow-wrap: anywhere;
  }

  input,
  select {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
  }

  footer {
    gap: 6px;
    flex-wrap: wrap;
    padding-top: 8px;
    border-top: 1px solid var(--theatre-panel-border, #555);
  }

  footer output {
    flex: 1;
    color: #919191;
  }

  footer button {
    white-space: nowrap;
  }
`

function trackNameFor(
  tracks: readonly AnimationTrack[],
  track: AnimationTrack,
  t: ReturnType<typeof useT>,
) {
  const kind = track.kind ?? 'bone'
  const sameKind = tracks.filter(
    (candidate) => (candidate.kind ?? 'bone') === kind,
  )
  const index = sameKind.findIndex((candidate) => candidate.id === track.id)
  const label = t(
    kind === 'object' ? 'pg.strips.objectTrack' : 'pg.strips.boneTrack',
  )
  return `${label} ${Math.max(index, 0) + 1}`
}

export function renderAnimationStripSidebar(
  object: AnimationTracksObject,
  state: AnimationTrackState,
) {
  const selection = val(animationStripSelectionB.prism)
  if (
    !selection ||
    selection.objectAddressKey !== animationObjectAddressKey(object.address) ||
    state.kind !== 'tracks'
  ) {
    return null
  }
  const found = findAnimationStrip(state.document, selection.stripId)
  if (!found) return null

  return (
    <AnimationStripSidebar
      key={selection.objectAddressKey}
      object={object}
      tracks={state.document.tracks}
      track={found.track}
      strip={found.strip}
    />
  )
}

function AnimationStripSidebar({
  object,
  tracks,
  track,
  strip,
}: {
  object: AnimationTracksObject
  tracks: readonly AnimationTrack[]
  track: AnimationTrack
  strip: AnimationStrip
}) {
  const t = useT()
  const asset = useAnimationEntriesById().get(strip.assetId)
  const isObjectTrack = track.kind === 'object'
  const sameKind = tracks.filter(
    (candidate) => (candidate.kind ?? 'bone') === (track.kind ?? 'bone'),
  )
  const destinations = sameKind.map((track) => ({
    id: track.id,
    name: trackNameFor(tracks, track, t),
  }))
  const name = isObjectTrack
    ? t('pg.strips.objectAction')
    : asset?.kind === 'animation'
      ? asset.name
      : strip.assetId
  const hint = isObjectTrack
    ? objectChannelsFor(strip)
        .map((channel) => t(channelLabels[channel]))
        .join(' · ')
    : ''
  const assetDurationMs =
    asset?.kind === 'animation' && asset.duration > 0
      ? asset.duration * 1000
      : strip.sourceDurationMs ?? strip.sourceOutMs

  return (
    <Sidebar>
      <AnimationStripProperties
        key={`${strip.id}:${strip.startMs}:${strip.sourceInMs}:${
          strip.sourceOutMs
        }:${strip.repeat ?? 1}`}
        object={object}
        strip={strip}
        name={name}
        hint={hint}
        assetDurationMs={assetDurationMs}
        onClose={clearAnimationStripSelection}
        trackId={track.id}
        trackName={trackNameFor(tracks, track, t)}
        tracks={destinations}
        onEditAction={() =>
          openAnimationStripAction(
            animationObjectAddressKey(object.address),
            strip,
          )
        }
      />
    </Sidebar>
  )
}
