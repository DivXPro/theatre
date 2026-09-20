import {usePrism} from '@dreamerbird/react'
import getStudio from '@dreamerbird/studio/getStudio'
import React, {useRef} from 'react'
import useTooltip from '@dreamerbird/studio/uiComponents/Popover/useTooltip'
import ErrorTooltip from '@dreamerbird/studio/uiComponents/Popover/ErrorTooltip'
import BasicTooltip from '@dreamerbird/studio/uiComponents/Popover/BasicTooltip'
import {val} from '@dreamerbird/dataverse'
import usePopover from '@dreamerbird/studio/uiComponents/Popover/usePopover'
import {useT} from '@dreamerbird/studio/i18n'
import MoreMenu from './MoreMenu/MoreMenu'

export function useOutlineTriggerTooltip(
  conflicts: ReturnType<typeof useConflicts>,
) {
  const t = useT()
  return useTooltip(
    {enabled: conflicts.length > 0, enterDelay: conflicts.length > 0 ? 0 : 200},
    () =>
      conflicts.length > 0 ? (
        <ErrorTooltip>
          {conflicts.length === 1
            ? t('toolbar.outline.conflict.one', {
                projectId: conflicts[0].projectId,
              })
            : t('toolbar.outline.conflict.many', {count: conflicts.length})}
        </ErrorTooltip>
      ) : (
        <BasicTooltip>
          <>{t('toolbar.outline.tooltip')}</>
        </BasicTooltip>
      ),
  )
}

export function useConflicts() {
  return usePrism(() => {
    const ephemeralStateOfAllProjects = val(
      getStudio().ephemeralAtom.pointer.coreByProject,
    )
    return Object.entries(ephemeralStateOfAllProjects)
      .map(([projectId, state]) => ({projectId, state}))
      .filter(
        ({state}) =>
          state.loadingState.type === 'browserStateIsNotBasedOnDiskState',
      )
  }, [])
}

export function useMoreMenu() {
  const moreMenu = usePopover(
    () => {
      const triggerBounds = moreMenuTriggerRef.current!.getBoundingClientRect()
      return {
        debugName: 'More Menu',

        constraints: {
          maxX: triggerBounds.right,
          maxY: 8,
          // MVP: Don't render the more menu all the way to the left
          // when it doesn't fit on the screen height
          // See https://linear.app/theatre/issue/P-178/bug-broken-updater-ui-in-simple-html-page
          // 1/10 There's a better way to solve this.
          // 1/10 Perhaps consider separate constraint like "rightSideMinX" & for future: "bottomSideMinY"
          // 2/10 Or, consider constraints being a function of the dimensions of the box => constraints.
          minX: triggerBounds.left - 140,
          minY: 8,
        },
        verticalGap: 2,
      }
    },
    () => {
      return <MoreMenu />
    },
  )
  const moreMenuTriggerRef = useRef<HTMLButtonElement>(null)
  return {moreMenu, moreMenuTriggerRef}
}
