/**
 * 画布右键菜单的统一出口：studio ContextMenu 的薄封装。
 * 样式/定位/点外关闭/Esc 关闭全部交给 studio 实现，
 * 这里只把"光标位置 + 菜单项 + 关闭回调"对齐过去。
 */
import React from 'react'
import ContextMenu from '@toy-box/studio/uiComponents/simpleContextMenu/ContextMenu/ContextMenu'
import type {ContextMenuItem} from '@toy-box/studio/uiComponents/chordial/chordialInternals'

export function CanvasContextMenu({
  position,
  items,
  onClose,
}: {
  position: {x: number; y: number}
  items: ContextMenuItem[]
  onClose: () => void
}) {
  return (
    <ContextMenu
      items={items}
      clickPoint={{clientX: position.x, clientY: position.y}}
      onRequestClose={onClose}
    />
  )
}
