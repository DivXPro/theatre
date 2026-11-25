import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import useChordial from '@dreamerbird/studio/uiComponents/chordial/useChodrial'
import React from 'react'
import styled from 'styled-components'
import logo from '@dreamerbird/studio/assets/logo.png'
import DropdownChevron from '@dreamerbird/studio/uiComponents/icons/DropdownChevron'
import BaseMenu from '@dreamerbird/studio/uiComponents/simpleContextMenu/ContextMenu/BaseMenu'
import {useT} from '@dreamerbird/studio/i18n'

const Container = styled.div`
  height: 100%;
  width: 42px;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  ${pointerEventsAutoInNormalMode};
  &:hover {
    --chevron-down: 1;
    background: var(--theatre-ui-hover, rgba(255, 255, 255, 0.08));
  }
`

const Logo = styled.img`
  width: 16px;
  height: 15px;
  filter: var(--theatre-ui-logo-filter, none);
`

const appButtonTitle = 'Theatre.js 0.8'
const AppButton: React.FC<{}> = () => {
  const t = useT()
  const s = useChordial(() => {
    return {
      items: [],
      title: appButtonTitle,
      invoke: {
        type: 'popover',
        render: ({close}) => (
          <BaseMenu
            onRequestClose={close}
            items={[
              {label: t('menu.whatsNew'), callback: () => {}},
              {type: 'separator'},
              {label: t('menu.chatWithUs'), callback: () => {}},
              {label: t('menu.help'), callback: () => {}},
              {label: t('menu.changelog'), callback: () => {}},
              {type: 'separator'},
              {label: t('menu.github'), callback: () => {}},
              {label: t('menu.discord'), callback: () => {}},
              {label: t('menu.twitter'), callback: () => {}},
              {type: 'separator'},
              {label: t('menu.settings'), callback: () => {}},
            ]}
            displayName={appButtonTitle}
          />
        ),
      },
    }
  })
  return (
    <>
      <Container className="cs-studio-app-button" ref={s.targetRef}>
        <Logo src={logo} />
        <DropdownChevron />
      </Container>
    </>
  )
}

export default AppButton
