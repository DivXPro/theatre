import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import useChordial from '@dreamerbird/studio/uiComponents/chordial/useChodrial'
import React from 'react'
import styled from 'styled-components'
import logo from '@dreamerbird/studio/assets/logo.png'
import DropdownChevron from '@dreamerbird/studio/uiComponents/icons/DropdownChevron'
import BaseMenu from '@dreamerbird/studio/uiComponents/simpleContextMenu/ContextMenu/BaseMenu'
import {
  getLanguage,
  getRegisteredLanguages,
  languageDisplayName,
  setLanguage,
  translate,
} from '@dreamerbird/studio/i18n'

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
    background: rgba(255, 255, 255, 0.08);
  }
`

const Logo = styled.img`
  width: 16px;
  height: 15px;
`

const appButtonTitle = 'Theatre.js 0.8'
const AppButton: React.FC<{}> = (props) => {
  const s = useChordial(() => {
    return {
      items: [],
      title: appButtonTitle,
      invoke: {
        type: 'popover',
        render: ({close}) => {
          // 菜单在点开时才渲染:这里读的语言/词条列表是打开那一刻的最新值
          const languages = getRegisteredLanguages()
          const current = getLanguage()
          const languageItems =
            languages.length > 1
              ? [
                  {type: 'separator' as const},
                  // 当前语言打勾;显示名按当前语言给(中文界面看「简体中文」)
                  ...languages.map((lang) => ({
                    label: `${
                      lang === current ? '✓ ' : '  '
                    }${languageDisplayName(lang, current)}`,
                    callback: () => {
                      // 用户手动选择:写入持久化偏好,下次启动优先
                      setLanguage(lang)
                    },
                  })),
                ]
              : []
          return (
            <BaseMenu
              onRequestClose={close}
              items={[
                {label: translate('menu.whatsNew'), callback: () => {}},
                {type: 'separator'},
                {label: translate('menu.chatWithUs'), callback: () => {}},
                {label: translate('menu.help'), callback: () => {}},
                {label: translate('menu.changelog'), callback: () => {}},
                {type: 'separator'},
                {label: translate('menu.github'), callback: () => {}},
                {label: translate('menu.discord'), callback: () => {}},
                {label: translate('menu.twitter'), callback: () => {}},
                ...languageItems,
                {type: 'separator'},
                {label: translate('menu.settings'), callback: () => {}},
              ]}
              displayName={appButtonTitle}
            />
          )
        },
      },
    }
  })
  return (
    <>
      <Container ref={s.targetRef}>
        <Logo src={logo} />
        <DropdownChevron />
      </Container>
    </>
  )
}

export default AppButton
