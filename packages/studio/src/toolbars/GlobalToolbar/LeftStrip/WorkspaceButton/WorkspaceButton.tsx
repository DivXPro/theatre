import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import getStudio from '@dreamerbird/studio/getStudio'
import DropdownChevron from '@dreamerbird/studio/uiComponents/icons/DropdownChevron'
import {useVal} from '@dreamerbird/react'
import React, {useEffect, useRef, useState} from 'react'
import styled from 'styled-components'

const Container = styled.div<{$clickable: boolean}>`
  display: flex;
  align-items: center;
  gap: 4px;
  text-wrap: nowrap;
  padding: 0 10px;
  height: 100%;
  font-weight: 500;
  ${pointerEventsAutoInNormalMode};
  cursor: default;
  ${(props) => (props.$clickable ? 'cursor: pointer;' : '')}
  position: relative;
  &:hover {
    --chevron-down: 1;
    background: rgba(255, 255, 255, 0.08);
  }
`

const Team = styled.span`
  color: rgba(255, 255, 255, 0.38);
`
const Separator = styled.span`
  color: rgba(255, 255, 255, 0.38);
`
const WorkspaceName = styled.span``

const IconContainer = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;

  svg {
    width: 14px;
    height: 14px;
    display: block;
  }
`

// 简单下拉菜单:点击按钮开合,点菜单外或按 Escape 收起
const Menu = styled.ul`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  margin: 0;
  padding: 4px;
  list-style: none;
  min-width: 140px;
  border-radius: 4px;
  background: var(--theatre-panel-bg-95, rgba(30, 32, 35, 0.95));
  backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.48);
  z-index: 10;
`

const MenuItem = styled.li`
  padding: 4px 8px;
  border-radius: 2px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;

  &:hover {
    background: rgba(59, 63, 69, 0.9);
  }
`

const WorkspaceButton: React.FC<{}> = (props) => {
  const config = useVal(getStudio().ephemeralAtom.pointer.workspaceButton)
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // 点菜单外任意处 / 按 Escape 收起
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  // 未传配置:保持默认占位外观,不可点击
  if (config === undefined) {
    return (
      <Container $clickable={false}>
        <Team>Team Freight</Team>
        <Separator>{`/`}</Separator>
        <WorkspaceName>Solar Play</WorkspaceName>
        <DropdownChevron />
      </Container>
    )
  }

  const {team, name, icon, menu} = config
  const clickable = menu !== undefined && menu.length > 0

  return (
    <Container
      $clickable={clickable}
      ref={rootRef}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation()
              setMenuOpen((open) => !open)
            }
          : undefined
      }
    >
      {icon != null && (
        // core 与 studio 的 @types/react 版本不同,ReactNode 不互认,消费侧收窄
        <IconContainer>{icon as React.ReactNode}</IconContainer>
      )}
      {team !== undefined && <Team>{team}</Team>}
      {team !== undefined && name !== undefined && <Separator>{`/`}</Separator>}
      {name !== undefined && <WorkspaceName>{name}</WorkspaceName>}
      <DropdownChevron />
      {menuOpen &&
        clickable &&
        menu !== undefined && ( // eslint-disable-line @typescript-eslint/no-unnecessary-condition
          <Menu>
            {menu.map((item, i) => (
              <MenuItem
                key={i}
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(false)
                  item.onClick()
                }}
              >
                {item.label}
              </MenuItem>
            ))}
          </Menu>
        )}
    </Container>
  )
}

export default WorkspaceButton
