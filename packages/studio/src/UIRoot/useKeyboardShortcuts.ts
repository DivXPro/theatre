import {useEffect} from 'react'
import getStudio from '@dreamerbird/studio/getStudio'
import {cmdIsDown} from '@dreamerbird/utils/keyboardUtils'
import {getSelectedSequence} from '@dreamerbird/studio/selectors'
import type {$IntentionalAny} from '@dreamerbird/core/types/public'
import type {Prism} from '@dreamerbird/dataverse'
import {Atom, prism, val} from '@dreamerbird/dataverse'
import type Sequence from '@dreamerbird/core/sequences/Sequence'
import memoizeFn from '@dreamerbird/utils/memoizeFn'
import type {IPlaybackRange} from '@dreamerbird/core/types/public'

let playPauseKeyboardShortcutIsEnabled = true
export function disablePlayPauseKeyboardShortcut() {
  playPauseKeyboardShortcutIsEnabled = false
}

export function enablePlayPauseKeyboardShortcut() {
  playPauseKeyboardShortcutIsEnabled = true
}

export default function useKeyboardShortcuts() {
  const studio = getStudio()
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 宿主已接管的按键不抢:本监听挂在 window 级(画布焦点下同样触发),
      // 宿主(如 playground 的 bindUndoShortcuts)也挂 window 级时一次
      // Cmd+Z 会撤两步(2026-10-01 冒烟实证)。先跑的一方 preventDefault,
      // 后跑的一方见到 defaultPrevented 即跳过——与宿主侧同款守卫互认
      if (e.defaultPrevented) return
      const target: null | HTMLElement =
        e.composedPath()[0] as unknown as $IntentionalAny
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      ) {
        return
      }

      if (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ') {
        if (cmdIsDown(e)) {
          if (e.shiftKey === true) {
            studio.redo()
          } else {
            studio.undo()
          }
        } else {
          return
        }
      } else if (
        e.code === 'Space' &&
        !e.shiftKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.ctrlKey
      ) {
        if (!playPauseKeyboardShortcutIsEnabled) return
        // Control the playback using the `Space` key
        const seq = getSelectedSequence()
        if (seq) {
          if (seq.playing) {
            seq.pause()
          } else {
            /*
             * The sequence will be played in its whole length unless all of the
             * following conditions are met:
             *  1. the focus range is set and enabled
             *  2. the playback starts within the focus range.
             */
            const {projectId, sheetId} = seq.address

            /*
             * The value of this prism is an array that contains the
             * range of the playback (start and end), and a boolean that is
             * `true` if the playback should be played within that range.
             */
            const controlledPlaybackStateD = prism(
              (): {range: IPlaybackRange; isFollowingARange: boolean} => {
                const focusRange = val(
                  getStudio().atomP.ahistoric.projects.stateByProjectId[
                    projectId
                  ].stateBySheetId[sheetId].sequence.focusRange,
                )

                // Determines whether the playback should be played
                // within the focus range.
                const shouldFollowFocusRange = prism.memo<boolean>(
                  'shouldFollowFocusRange',
                  (): boolean => {
                    const posBeforePlay = seq.position
                    if (focusRange) {
                      const withinRange =
                        posBeforePlay >= focusRange.range[0] &&
                        posBeforePlay <= focusRange.range[1]
                      if (focusRange.enabled) {
                        if (withinRange) {
                          return true
                        } else {
                          return false
                        }
                      } else {
                        return true
                      }
                    } else {
                      return true
                    }
                  },
                  [],
                )

                if (
                  shouldFollowFocusRange &&
                  focusRange &&
                  focusRange.enabled
                ) {
                  return {
                    range: [focusRange.range[0], focusRange.range[1]],
                    isFollowingARange: true,
                  }
                } else {
                  const sequenceLength = val(seq.pointer.length)
                  return {range: [0, sequenceLength], isFollowingARange: false}
                }
              },
            )

            const playbackPromise = seq.playDynamicRange(
              prism(() => val(controlledPlaybackStateD).range),
              getStudio().ticker,
            )

            const playbackStateBox = getPlaybackStateBox(seq)

            void playbackPromise.finally(() => {
              playbackStateBox.set(undefined)
            })

            playbackStateBox.set(controlledPlaybackStateD)
          }
        } else {
          return
        }
      }
      // alt + \
      else if (
        e.altKey &&
        (e.key === '\\' || e.code === 'Backslash' || e.code === 'IntlBackslash')
      ) {
        const prev = val(studio.atomP.ahistoric.visibilityState)
        studio.transaction(({stateEditors}) => {
          stateEditors.studio.ahistoric.setVisibilityState(
            prev === 'everythingIsHidden'
              ? 'everythingIsVisible'
              : 'everythingIsHidden',
          )
        })
      } else {
        return
      }

      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])
}

type ControlledPlaybackStateBox = Atom<
  undefined | Prism<{range: IPlaybackRange; isFollowingARange: boolean}>
>

const getPlaybackStateBox = memoizeFn(
  (sequence: Sequence): ControlledPlaybackStateBox => {
    const box = new Atom(undefined) as ControlledPlaybackStateBox
    return box
  },
)

/*
 * A memoized function that returns a prism with a boolean value.
 * This value is set to `true` if:
 * 1. the playback is playing and using the focus range instead of the whole sequence
 * 2. the playback is stopped, but would use the focus range if it were started.
 */
export const getIsPlayheadAttachedToFocusRange = memoizeFn(
  (sequence: Sequence) =>
    prism<boolean>(() => {
      const controlledPlaybackState =
        getPlaybackStateBox(sequence).prism.getValue()
      if (controlledPlaybackState) {
        return controlledPlaybackState.getValue().isFollowingARange
      } else {
        const {projectId, sheetId} = sequence.address
        const focusRange = val(
          getStudio().atomP.ahistoric.projects.stateByProjectId[projectId]
            .stateBySheetId[sheetId].sequence.focusRange,
        )

        if (!focusRange || !focusRange.enabled) return false

        const pos = val(sequence.pointer.position)

        const withinRange =
          pos >= focusRange.range[0] && pos <= focusRange.range[1]
        return withinRange
      }
    }),
)
