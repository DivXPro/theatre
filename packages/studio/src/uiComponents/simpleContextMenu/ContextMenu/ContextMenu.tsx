import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import type {ContextMenuItem as ItemDefinition} from '@dreamerbird/studio/uiComponents/chordial/chordialInternals'
import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import {PortalContext} from 'reakit'
import React, {useContext, useEffect, useLayoutEffect, useRef} from 'react'
import styled from 'styled-components'

const ContextMenuContent = styled(ContextMenuPrimitive.Content)`
  z-index: 10000;
  box-sizing: border-box;
  min-width: 190px;
  max-width: var(--radix-context-menu-content-available-width);
  max-height: var(--radix-context-menu-content-available-height);
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--theatre-panel-border, #1f1f1f);
  border-radius: 6px;
  outline: none;
  background: var(--theatre-panel-bg, #282b2f);
  color: var(--theatre-text-primary, #ffffff);
  box-shadow: 0 4px 16px rgb(0 0 0 / 30%);
  font-family: var(--theatre-font-family, system-ui, sans-serif);
  font-size: var(--theatre-font-size, 11px);
  ${pointerEventsAutoInNormalMode};
`

const ContextMenuLabel = styled(ContextMenuPrimitive.Label)`
  padding: 6px 8px;
  color: var(--theatre-text-secondary, #cccccc);
  font-weight: 600;
`

const ContextMenuItem = styled(ContextMenuPrimitive.Item)`
  display: flex;
  align-items: center;
  min-height: 28px;
  padding: 4px 8px;
  border-radius: 4px;
  outline: none;
  cursor: default;
  user-select: none;

  &[data-highlighted] {
    background: var(--theatre-selected-bg, #363d43);
  }

  &[data-disabled] {
    color: var(--theatre-text-muted, #888888);
    pointer-events: none;
  }
`

const ContextMenuSeparator = styled(ContextMenuPrimitive.Separator)`
  height: 1px;
  margin: 4px 0;
  background: var(--theatre-panel-border, #1f1f1f);
`

const pointerDistanceThreshold = 20

export type IContextMenuItemCustomNodeRenderFn = (controls: {
  closeMenu(): void
}) => React.ReactElement

export type IContextMenuItemsValue = ItemDefinition[] | (() => ItemDefinition[])

export type ContextMenuProps = {
  items: IContextMenuItemsValue
  displayName?: React.ReactNode
  clickPoint?: {clientX: number; clientY: number}
  onRequestClose: () => void
  closeOnPointerLeave?: boolean
}

export default function ContextMenu({
  items,
  displayName,
  clickPoint,
  onRequestClose,
  closeOnPointerLeave = true,
}: ContextMenuProps) {
  const trigger = useRef<HTMLSpanElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const portalLayer = useContext(PortalContext)
  const {clientX, clientY} = clickPoint ?? {clientX: 0, clientY: 0}

  // Canvas hit testing and Studio overlays supply a point, even when there
  // is no DOM element to use as a trigger.
  useLayoutEffect(() => {
    trigger.current?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX,
        clientY,
      }),
    )
  }, [clientX, clientY])

  useEffect(() => {
    if (!closeOnPointerLeave) return
    const handlePointerMove = (event: MouseEvent) => {
      const menu = content.current?.getBoundingClientRect()
      if (!menu) return
      if (
        event.clientX < menu.left - pointerDistanceThreshold ||
        event.clientX > menu.right + pointerDistanceThreshold ||
        event.clientY < menu.top - pointerDistanceThreshold ||
        event.clientY > menu.bottom + pointerDistanceThreshold
      ) {
        onRequestClose()
      }
    }
    window.addEventListener('mousemove', handlePointerMove)
    return () => window.removeEventListener('mousemove', handlePointerMove)
  }, [closeOnPointerLeave, onRequestClose])

  const menuItems = Array.isArray(items) ? items : items()

  return (
    <ContextMenuPrimitive.Root
      modal={false}
      onOpenChange={(open) => {
        if (!open) onRequestClose()
      }}
    >
      <ContextMenuPrimitive.Trigger
        ref={trigger}
        hidden
        aria-hidden="true"
        onContextMenu={(event) => event.stopPropagation()}
      />
      <ContextMenuPrimitive.Portal container={portalLayer}>
        <ContextMenuContent ref={content} collisionPadding={8}>
          {displayName && <ContextMenuLabel>{displayName}</ContextMenuLabel>}
          {menuItems.length === 0 && (
            <ContextMenuItem disabled>
              {typeof displayName === 'string' && displayName
                ? `No actions for ${displayName}`
                : 'No actions found'}
            </ContextMenuItem>
          )}
          {menuItems.map((item, index) =>
            item.type === 'separator' ? (
              <ContextMenuSeparator key={index} />
            ) : (
              <ContextMenuItem
                key={item.key ?? index}
                disabled={item.enabled === false}
                onClick={item.callback}
              >
                <>{item.label}</>
              </ContextMenuItem>
            ),
          )}
        </ContextMenuContent>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  )
}
