// packages/playground/src/shared/camera/Anchors.tsx
/**
 * 独立锚点(空物体):顶栏按钮添加,橙色线框小方块(沿用旧 Target
 * 视觉)。可点选、可拖(gizmo)、右键删除;可被相机瞄准,可绑定父级
 * (Task 7)。仅编辑视角可见。
 */
import {editable as e} from '@dreamerbird/r3f'
import {getStudioSync} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import React, {useEffect, useLayoutEffect, useRef} from 'react'
import type {MutableRefObject} from 'react'
import type {Mesh} from 'three'
import type {ThreeEvent} from '@react-three/fiber'
import {registerEditorOnly} from './editorOnly'
import {useSelectionGizmoTarget} from './PlacementManager'
import {consumeAnchorSeed, useAnchorsList} from './anchorsRegistry'
import {registerAnchorObject} from './aimTargets'

export function Anchors({sheet, shotView}: {sheet: ISheet; shotView: boolean}) {
  const anchorKeys = useAnchorsList(sheet)
  // 锚点网格的"娘家":r3f 原挂载点,解绑/父级消失时挂回这里
  const homeRef = useRef<React.ElementRef<'group'>>(null!)
  return (
    <group ref={homeRef}>
      {anchorKeys.map((key) => (
        <AnchorObject
          key={key}
          anchorKey={key}
          shotView={shotView}
          homeRef={homeRef}
        />
      ))}
    </group>
  )
}

function AnchorObject({
  anchorKey,
  shotView,
  homeRef,
}: {
  anchorKey: string
  shotView: boolean
  homeRef: MutableRefObject<import('three').Group | null>
}) {
  const meshRef = useRef<Mesh>(null!)
  const objRef = useRef<ISheetObject<any> | undefined>(undefined)
  const setObjRef = (obj: ISheetObject<any> | null) => {
    objRef.current = obj ?? undefined
  }

  // 新锚点落地:消费位置种子(顶栏添加时从导演视角捕获)
  useLayoutEffect(() => {
    const seed = consumeAnchorSeed(anchorKey)
    const obj = objRef.current
    if (!seed || !obj) return
    const studio = getStudioSync()
    if (!studio) return
    const scrub = studio.scrub()
    scrub.capture(({set}) => set(obj.props.position, seed.position))
    scrub.commit()
  }, [anchorKey])

  // 登记运行时对象(瞄准解析 anchor:)与选中 gizmo;卸载清理
  useEffect(() => {
    registerAnchorObject(anchorKey, meshRef.current)
    return () => {
      registerAnchorObject(anchorKey, null)
      objRef.current = undefined
    }
  }, [anchorKey])
  useSelectionGizmoTarget(objRef, meshRef, true)
  useEffect(() => registerEditorOnly(meshRef.current), [])

  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const studio = getStudioSync()
    if (studio && objRef.current) studio.setSelection([objRef.current])
  }

  return (
    <e.mesh
      theatreKey={anchorKey}
      objRef={setObjRef}
      ref={meshRef}
      position={[0, 1, 0]}
      visible={!shotView}
      onClick={select}
      onContextMenu={(event) => {
        event.stopPropagation()
        event.nativeEvent.preventDefault()
        select(event)
        // 菜单由 App 弹:经自定义事件透传坐标,避免层层 props
        window.dispatchEvent(
          new CustomEvent('pg:anchor-context-menu', {
            detail: {
              key: anchorKey,
              x: event.nativeEvent.clientX,
              y: event.nativeEvent.clientY,
            },
          }),
        )
      }}
    >
      <boxGeometry args={[0.25, 0.25, 0.25]} />
      <meshBasicMaterial color="#ffb020" wireframe />
    </e.mesh>
  )
}
