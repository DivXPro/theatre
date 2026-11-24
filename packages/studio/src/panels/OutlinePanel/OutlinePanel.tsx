import React, {useEffect, useLayoutEffect} from 'react'
import styled from 'styled-components'
import {panelZIndexes} from '@dreamerbird/studio/panels/BasePanel/common'
import ProjectsList from './ProjectsList/ProjectsList'
import {useVal} from '@dreamerbird/react'
import getStudio from '@dreamerbird/studio/getStudio'
import useHotspot from '@dreamerbird/studio/uiComponents/useHotspot'
import {Atom, prism, val} from '@dreamerbird/dataverse'
import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import {useT} from '@dreamerbird/studio/i18n'

const headerHeight = `44px`

const Container = styled.div<{$pin: boolean; $dockTop?: number}>`
  ${pointerEventsAutoInNormalMode};
  background-color: var(--theatre-panel-bg-95);
  border: 1px solid var(--theatre-panel-border);
  border-radius: var(--theatre-panel-radius);
  position: absolute;
  left: 12px;
  width: min(220px, 29vw);
  z-index: ${panelZIndexes.outlinePanel};

  --outliner-top: calc(${headerHeight} + 8px);
  top: var(--outliner-top);
  height: fit-content;
  --outliner-available-height: ${({$dockTop}) =>
    $dockTop === undefined
      ? 'calc(100% - var(--outliner-top) - 52px)'
      : `max(0px, calc(${$dockTop - 12}px - var(--outliner-top)))`};
  max-height: var(--outliner-available-height);
  overflow-y: scroll;
  overflow-x: hidden;
  padding: 0 5px 5px;
  box-sizing: border-box;
  user-select: none;

  &::-webkit-scrollbar {
    display: none;
  }

  scrollbar-width: none;

  display: ${({$pin}) => ($pin ? 'block' : 'none')};

  &:hover {
    display: block;
  }

  @media (max-width: 859px) {
    --outliner-top: 94px;
  }

  :host([data-camera-workspace]) & {
    --outliner-top: var(--theatre-camera-panel-top);
    left: var(--theatre-camera-panel-inset);
    width: var(--theatre-camera-sidebar-width);
    height: var(--outliner-available-height);
    padding: var(--theatre-camera-project-row-height) 0 0;
    overflow: hidden;
    box-shadow:
      0 1px 1px var(--theatre-shadow-color),
      0 2px 6px rgba(0, 0, 0, 0.15);
  }
`

const Content = styled.div`
  :host([data-camera-workspace]) & {
    height: 100%;
    overflow: auto;
    padding-inline: 5px;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  // Create a small buffer on the bottom to aid selecting the bottom item in a long, scrolling list
  &::after {
    content: '';
    display: block;
    height: 20px;
  }
`

const Header = styled.div`
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  min-height: 35px;
  margin: 0 -5px 5px;
  padding: 0 10px;
  color: var(--theatre-text-primary);
  font-weight: 600;
  background: var(--theatre-panel-bg-95);
  border-bottom: 1px solid var(--theatre-panel-border);
`

const OutlinePanel: React.FC<{sequenceDockTop?: number}> = ({
  sequenceDockTop,
}) => {
  const t = useT()
  const pin = useVal(getStudio().atomP.ahistoric.pinOutline) ?? true
  const show = useVal(shouldShowOutlineD)
  const active = useHotspot('left')
  const hidden = useVal(getStudio().ephemeralAtom.pointer.hiddenPanels.outline)

  useLayoutEffect(() => {
    isOutlinePanelHotspotActiveB.set(active)
  }, [active])

  // cleanup
  useEffect(() => {
    return () => {
      isOutlinePanelHoveredB.set(false)
      isOutlinePanelHotspotActiveB.set(false)
    }
  }, [])

  if (hidden) return null

  return (
    <Container
      role="region"
      aria-label={t('workspace.objects')}
      $pin={pin || show}
      $dockTop={sequenceDockTop}
      onMouseEnter={() => {
        isOutlinePanelHoveredB.set(true)
      }}
      onMouseLeave={() => {
        isOutlinePanelHoveredB.set(false)
      }}
    >
      <Content>
        <Header>{t('workspace.objects')}</Header>
        <ProjectsList />
      </Content>
    </Container>
  )
}

export default OutlinePanel

const isOutlinePanelHotspotActiveB = new Atom<boolean>(false)
const isOutlinePanelHoveredB = new Atom<boolean>(false)

export const shouldShowOutlineD = prism<boolean>(() => {
  const isHovered = val(isOutlinePanelHoveredB.prism)
  const isHotspotActive = val(isOutlinePanelHotspotActiveB.prism)

  return isHovered || isHotspotActive
})
