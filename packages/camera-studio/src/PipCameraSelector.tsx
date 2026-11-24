import React, {useEffect, useRef, useState} from 'react'
import type {CameraEntry} from './cameraRegistry'
import {cameraDisplayName} from './cameraRegistry'

/**
 * 画中画左上角的相机选择器:显示当前相机名,点击弹下拉列表,
 * 点选 = 设为活动相机(画中画/镜头视角/导出联动)。点外部/Escape 收起。
 */
export function PipCameraSelector({
  cameras,
  activeKey,
  onSelect,
  visible,
}: {
  cameras: readonly CameraEntry[]
  activeKey: string
  onSelect: (cameraKey: string) => void
  /** hover 到画中画时由外层置 true;菜单展开期间即使移出也保持可见 */
  visible: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // hover 离开画中画时,菜单展开期间不隐藏(否则菜单项点不到)
  const show = visible || open

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    // 画中画边框层是 pointerEvents:none,这里单独放开接收点击;
    // 非 hover 且菜单收起时整体隐藏(淡入淡出)
    <div
      ref={rootRef}
      className="cs-preview-selector"
      data-visible={show ? '' : undefined}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {cameraDisplayName(activeKey)}
        <span className="cs-preview-chevron">▾</span>
      </button>
      {open && (
        <ul className="cs-preview-camera-menu">
          {cameras.map((entry) => (
            <li
              key={entry.cameraKey}
              onClick={() => {
                setOpen(false)
                onSelect(entry.cameraKey)
              }}
            >
              {entry.cameraKey === activeKey ? '✓ ' : '　'}
              {cameraDisplayName(entry.cameraKey)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
