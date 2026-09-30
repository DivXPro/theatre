import React, {useEffect, useRef, useState} from 'react'
import type {CameraEntry} from './cameraRegistry'
import {cameraDisplayName} from './cameraRegistry'

// 与 studio UI 同款字体(令牌在 shadow DOM 里,到不了这里,用静态值)
const UI_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe Editor', HelveticaNeue-Light, Ubuntu, 'Droid Sans', sans-serif"

/**
 * 画中画左上角的相机选择器:显示当前相机名,点击弹下拉列表,
 * 点选 = 设为活动相机(画中画/镜头视角/导出联动)。点外部/Escape 收起。
 * 颜色取 studio UI 同款静态值(shadow DOM 令牌到不了这里)。
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
      style={{
        position: 'absolute',
        top: 4,
        left: 6,
        opacity: show ? 1 : 0,
        transition: 'opacity 0.15s ease-out',
        pointerEvents: show ? 'auto' : 'none',
      }}
    >
      {' '}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '1px 6px',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: 3,
          background: 'rgba(24,24,28,0.6)',
          color: '#cccccc',
          fontFamily: UI_FONT,
          fontSize: 11,
          lineHeight: '16px',
          cursor: 'pointer',
        }}
      >
        {cameraDisplayName(activeKey)}
        <span style={{fontSize: 8, opacity: 0.7}}>▾</span>
      </button>
      {open && (
        <ul
          style={{
            position: 'absolute',
            top: 'calc(100% + 2px)',
            left: 0,
            margin: 0,
            padding: 4,
            listStyle: 'none',
            minWidth: 120,
            borderRadius: 4,
            background: 'rgba(30,32,35,0.95)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 8px 16px -4px rgba(0,0,0,0.48)',
            fontFamily: UI_FONT,
            zIndex: 10,
          }}
        >
          {cameras.map((entry) => (
            <li
              key={entry.cameraKey}
              onClick={() => {
                setOpen(false)
                onSelect(entry.cameraKey)
              }}
              style={{
                padding: '3px 8px',
                borderRadius: 2,
                fontSize: 11,
                color: '#cccccc',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(59,63,69,0.9)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
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
