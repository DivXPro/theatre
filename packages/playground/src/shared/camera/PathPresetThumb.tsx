/**
 * 路径预设卡片的 SVG 动画缩略图:3/4 轴测投影 + 地面网格 +
 * 高度投影虚线,俯视摄像机图标沿路径运动、取景锥始终咬住主体。
 * 颜色与场景里的路径线(0xa78bfa)同色系,所见即所得。
 */
import React, {useEffect, useMemo, useRef} from 'react'
import type {PathPreset} from './pathPresets'
import {buildPresetThumb, THUMB_VH, THUMB_VW} from './presetThumbGeometry'

// 与预览稿一致的三角色:轨迹紫 / 摄像机青 / 主体琥珀
const COLOR_TRACK = '#a78bfa'
const COLOR_CAM = '#22d3ee'
const COLOR_CAM_CONE = 'rgba(34, 211, 238, 0.28)'
const COLOR_SUBJECT = '#f59e0b'
const COLOR_GRID = '#232a36'
const COLOR_SHADOW = '#2c3542'

const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function PathPresetThumb({preset}: {preset: PathPreset}) {
  const thumb = useMemo(() => buildPresetThumb(preset), [preset])
  const trackRef = useRef<SVGPathElement>(null)
  const shadowRef = useRef<SVGPathElement>(null)
  const camRef = useRef<SVGGElement>(null)
  const camShadowRef = useRef<SVGEllipseElement>(null)
  const dropLineRef = useRef<SVGLineElement>(null)

  useEffect(() => {
    const track = trackRef.current
    const cam = camRef.current
    if (!track || !cam) return
    const shadow = shadowRef.current
    const camShadow = camShadowRef.current
    const dropLine = dropLineRef.current
    // 各卡片错开相位,整版面不会齐步走
    const phase = Math.random()
    let raf = 0

    const apply = (now: number) => {
      const len = track.getTotalLength()
      let t = (now / 1000 / preset.durSeconds + phase) % 1
      // 开放路径 ping-pong:推近→拉远→推近,正好表达往返语义
      if (!preset.closed) t = t < 0.5 ? t * 2 : (1 - t) * 2
      const pos = track.getPointAtLength(t * len)
      const ang =
        (Math.atan2(thumb.subject[1] - pos.y, thumb.subject[0] - pos.x) * 180) /
        Math.PI
      cam.setAttribute(
        'transform',
        `translate(${pos.x} ${pos.y}) rotate(${ang})`,
      )
      // 有高度:影子落在地面投影上,垂线连接;纯平面:影子贴在机身下
      let gx = pos.x
      let gy = pos.y
      if (shadow) {
        const gpos = shadow.getPointAtLength(t * shadow.getTotalLength())
        gx = gpos.x
        gy = gpos.y
      }
      camShadow?.setAttribute('cx', String(gx))
      camShadow?.setAttribute('cy', String(gy))
      dropLine?.setAttribute('x1', String(pos.x))
      dropLine?.setAttribute('y1', String(pos.y))
      dropLine?.setAttribute('x2', String(gx))
      dropLine?.setAttribute('y2', String(gy))
    }

    if (REDUCED) {
      apply(0) // 静帧:摆在小圈起点即可
      return
    }
    const loop = (now: number) => {
      apply(now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [thumb, preset.closed, preset.durSeconds])

  const [sx, sy] = thumb.subject
  return (
    <svg
      viewBox={`0 0 ${THUMB_VW} ${THUMB_VH}`}
      style={{display: 'block', width: '100%', height: '100%'}}
    >
      <path d={thumb.gridD} fill="none" stroke={COLOR_GRID} strokeWidth={0.6} />
      {thumb.groundD && (
        <path
          ref={shadowRef}
          d={thumb.groundD}
          fill="none"
          stroke={COLOR_SHADOW}
          strokeWidth={1}
          strokeDasharray="2.5 2.5"
        />
      )}
      <path
        ref={trackRef}
        d={thumb.d}
        fill="none"
        stroke={COLOR_TRACK}
        strokeWidth={0.8}
      />
      <g stroke={COLOR_SUBJECT} strokeWidth={1} opacity={0.9}>
        <line x1={sx - 3.5} y1={sy} x2={sx + 3.5} y2={sy} />
        <line x1={sx} y1={sy - 3.5} x2={sx} y2={sy + 3.5} />
      </g>
      <line
        ref={dropLineRef}
        stroke={COLOR_SHADOW}
        strokeWidth={0.8}
        strokeDasharray="1.5 2"
      />
      <ellipse
        ref={camShadowRef}
        rx={2.4}
        ry={1.2}
        fill={COLOR_CAM}
        opacity={0.35}
      />
      <g ref={camRef}>
        <path
          d="M 1.4 -1.6 L 8 -3.6 L 8 3.6 L 1.4 1.6 Z"
          fill={COLOR_CAM_CONE}
        />
        <circle r={2} fill={COLOR_CAM} />
        <circle r={0.7} fill="#0e1116" />
      </g>
    </svg>
  )
}
