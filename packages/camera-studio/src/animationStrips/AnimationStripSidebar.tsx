import {val} from '@dreamerbird/dataverse'
import {useT} from '@dreamerbird/studio/i18n'
import React from 'react'
import {useAnimationEntriesById} from '../assetLibrary/library'
import {AnimationStripProperties} from './AnimationStripProperties'
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
    <div className="cs-strip-properties cs-strip-sidebar">
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
    </div>
  )
}
