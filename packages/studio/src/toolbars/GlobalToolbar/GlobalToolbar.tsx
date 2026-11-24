import {useVal} from '@dreamerbird/react'
import getStudio from '@dreamerbird/studio/getStudio'
import React from 'react'
import styled from 'styled-components'
import ExtensionToolbar from '@dreamerbird/studio/toolbars/ExtensionToolbar/ExtensionToolbar'
import ConnectionStatusBadge from '@dreamerbird/studio/uiComponents/ConnectionStatusBadge'
import {
  useNotifications,
  useEmptyNotificationsTooltip,
} from '@dreamerbird/studio/notify'
import {
  useConflicts,
  useOutlineTriggerTooltip,
  useMoreMenu,
} from './globalToolbarHooks'
import LeftStrip from './LeftStrip/LeftStrip'
import RightStrip from './RightStrip/RightStrip'
import {outlineContentId} from '@dreamerbird/studio/panels/OutlinePanel/OutlinePanel'
import ChevronDown from '@dreamerbird/studio/uiComponents/icons/ChevronDown'
import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import {useT} from '@dreamerbird/studio/i18n'

const Container = styled.div`
  position: fixed;
  left: 0;
  right: 0;
  top: 12px;
  height: 42px;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
`

const NumberOfConflictsIndicator = styled.div`
  color: var(--theatre-text-primary);
  width: 14px;
  height: 14px;
  background: #d00;
  border-radius: 4px;
  text-align: center;
  line-height: 14px;
  font-weight: 600;
  font-size: 8px;
  position: relative;
  left: -6px;
  top: -11px;
  margin-right: -14px;
  box-shadow: 0 4px 6px -4px #00000059;
`

const SubContainer = styled.div`
  display: flex;
  gap: 8px;
`

const OutlineToggle = styled.button`
  ${pointerEventsAutoInNormalMode};
  display: none;
`

const HasUpdatesBadge = styled.div<{$type: 'info' | 'warning'}>`
  position: absolute;
  background: ${({$type}) =>
    $type === 'info' ? 'var(--theatre-accent)' : '#f59e0b'};
  width: 6px;
  height: 6px;
  border-radius: 50%;
  right: -2px;
  top: -2px;
`

const GlobalToolbar: React.FC<{
  outlineCollapsed: boolean
  onToggleOutline: () => void
}> = ({outlineCollapsed, onToggleOutline}) => {
  const t = useT()
  const conflicts = useConflicts()
  const [outlineTriggerTooltip, outlineTriggerRef] =
    useOutlineTriggerTooltip(conflicts)

  const outlinePinned = useVal(getStudio().atomP.ahistoric.pinOutline) ?? true
  const outlineHidden = useVal(
    getStudio().ephemeralAtom.pointer.hiddenPanels.outline,
  )
  const showCollapsedOutline = outlineCollapsed && !outlineHidden
  const outlineToggleLabel = t(
    outlineCollapsed
      ? 'workspace.outline.expand'
      : 'workspace.outline.collapse',
  )
  const detailsPinned = useVal(getStudio().atomP.ahistoric.pinDetails) ?? true
  const connectionStatus =
    useVal(getStudio().ephemeralAtom.pointer.connectionStatus) ?? 'connected'

  const {moreMenu, moreMenuTriggerRef} = useMoreMenu()

  const {hasNotifications} = useNotifications()

  const [notificationsTooltip, notificationsTriggerRef] =
    useEmptyNotificationsTooltip()

  return (
    <Container className="cs-studio-global-toolbar">
      <SubContainer
        className="cs-studio-outline-controls"
        data-cs-outline-collapsed={showCollapsedOutline ? '' : undefined}
      >
        <LeftStrip />
        {!outlineHidden && (
          <OutlineToggle
            className="cs-studio-outline-toggle"
            type="button"
            aria-controls={outlineContentId}
            aria-expanded={!outlineCollapsed}
            aria-label={outlineToggleLabel}
            title={outlineToggleLabel}
            onClick={onToggleOutline}
          >
            <ChevronDown aria-hidden="true" />
          </OutlineToggle>
        )}
      </SubContainer>
      {outlineTriggerTooltip}
      <SubContainer>
        {/* <PinButton
          ref={outlineTriggerRef as $IntentionalAny}
          data-testid="OutlinePanel-TriggerButton"
          onClick={() => {
            const prev = val(getStudio().atomP.ahistoric.pinOutline)
            getStudio().transaction(({stateEditors}) => {
              stateEditors.studio.ahistoric.setPinOutline(!(prev ?? true))
            })
          }}
          icon={<Outline />}
          pinHintIcon={<DoubleChevronRight />}
          unpinHintIcon={<DoubleChevronLeft />}
          pinned={outlinePinned}
        /> */}
        {/* <AuthState /> */}
        {conflicts.length > 0 ? (
          <NumberOfConflictsIndicator>
            {conflicts.length}
          </NumberOfConflictsIndicator>
        ) : null}
        <ConnectionStatusBadge status={connectionStatus} />
        <ExtensionToolbar showLeftDivider toolbarId="global" />
      </SubContainer>
      <SubContainer>
        <RightStrip />
        {/* 
        {notificationsTooltip}
        <PinButton
          ref={notificationsTriggerRef as $IntentionalAny}
          onClick={() => {
            const prev = val(getStudio().atomP.ahistoric.pinNotifications)
            getStudio().transaction(({stateEditors}) => {
              stateEditors.studio.ahistoric.setPinNotifications(
                !(prev ?? false),
              )
            })
          }}
          icon={<Bell />}
          pinHintIcon={<Bell />}
          unpinHintIcon={<Bell />}
          pinned={useVal(getStudio().atomP.ahistoric.pinNotifications) ?? false}
        >
          {hasNotifications && <HasUpdatesBadge $type="warning" />}
        </PinButton> */}
        {/* {moreMenu.node}
        <ToolbarIconButton
          ref={moreMenuTriggerRef}
          onClick={(e) => {
            moreMenu.toggle(e, moreMenuTriggerRef.current!)
          }}
        >
          <Ellipsis />
          {showUpdatesBadge && <HasUpdatesBadge $type="info" />}
        </ToolbarIconButton> */}
        {/* <PinButton
          ref={outlineTriggerRef as $IntentionalAny}
          onClick={() => {
            const prev = val(getStudio().atomP.ahistoric.pinDetails)
            getStudio().transaction(({stateEditors}) => {
              stateEditors.studio.ahistoric.setPinDetails(!(prev ?? true))
            })
          }}
          icon={<Details />}
          pinHintIcon={<DoubleChevronLeft />}
          unpinHintIcon={<DoubleChevronRight />}
          pinned={detailsPinned}
        /> */}
      </SubContainer>
    </Container>
  )
}

export default GlobalToolbar
