// packages/playground/src/shared/camera/Anchors.tsx
/**
 * 独立锚点(空物体):顶栏按钮添加,橙色线框小方块(沿用旧 Target
 * 视觉)。可点选、可拖(gizmo)、右键删除;可被相机瞄准,可绑定父级
 * (Task 7)。仅编辑视角可见。
 */
import {editable as e} from '@dreamerbird/r3f'
import {getStudioSync, types as t} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import React, {useEffect, useLayoutEffect, useRef} from 'react'
import type {MutableRefObject} from 'react'
import {Vector3} from 'three'
import type {Mesh} from 'three'
import type {ThreeEvent} from '@react-three/fiber'
import {translate} from '@dreamerbird/studio/i18n'
import {registerEditorOnly} from './editorOnly'
import {useSelectionGizmoTarget} from './PlacementManager'
import {consumeAnchorSeed, useAnchorsList} from './anchorsRegistry'
import {
  anchorParentOptionsFor,
  localOffsetForParent,
  registerAnchorObject,
  resolveAnchorParent,
} from './aimTargets'
import {useObjPropScalar} from './ShotCamera'

/**
 * 「父级」下拉属性配置(模块级,按 key 缓存,对齐 ShotCamera 的
 * shotCameraAdditionalProps:sheet.object 重复调用要求配置 deep-equal,
 * 函数按引用比,每次 render 新建会在热更新后炸)。label/选项都是函数
 * 形式,语言切换后面板重渲染即生效。
 */
const anchorPropsCache = new Map<string, Record<string, any>>()
function anchorPropsFor(key: string) {
  let config = anchorPropsCache.get(key)
  if (!config) {
    config = {
      parent: t.stringLiteral('', () => anchorParentOptionsFor(key), {
        label: () => translate('pg.props.anchorParent'),
        as: 'menu',
      }),
    }
    anchorPropsCache.set(key, config)
  }
  return config
}

export function Anchors({
  sheet,
  shotView,
  getAnchorRef,
}: {
  sheet: ISheet
  shotView: boolean
  /** 每个锚点一个 objRef(App 持有的映射,仿相机 shotRefsMapRef;右键
   * 删除时经它取对象做真删——forgetObject 清持久数据) */
  getAnchorRef: (
    anchorKey: string,
  ) => MutableRefObject<ISheetObject<any> | undefined>
}) {
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
          objRef={getAnchorRef(key)}
        />
      ))}
    </group>
  )
}

function AnchorObject({
  anchorKey,
  shotView,
  homeRef,
  objRef,
}: {
  anchorKey: string
  shotView: boolean
  homeRef: MutableRefObject<import('three').Group | null>
  objRef: MutableRefObject<ISheetObject<any> | undefined>
}) {
  const meshRef = useRef<Mesh>(null!)
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

  // 响应式读 parent 属性(复用 ShotCamera 的 useObjPropScalar)
  const parentId = useObjPropScalar<string>(objRef, 'parent', '')

  // 场景树父子:parent 变化 → 解析目标 → 真挂载;位置属性自动成为
  // 相对父级的局部偏移。绑定/解绑/父级消失的"画面不跳"定格见下。
  const prevParentRef = useRef<string | null>(null)
  const tmpWorld = useRef(new Vector3())
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const prev = prevParentRef.current
    prevParentRef.current = parentId
    if (prev === null) {
      // 挂载首次:持久态恢复,场景位置由包装器按属性恢复,不干预
      return
    }
    if (prev === parentId) return
    const studio = getStudioSync()
    const obj = objRef.current
    if (!studio || !obj) return
    const world = mesh.getWorldPosition(tmpWorld.current).clone()
    const newParentObj = parentId ? resolveAnchorParent(parentId) : null
    if (parentId && !newParentObj) return // 目标暂不可解析(对端时序),下帧 effect 重试
    // 先定格世界坐标进属性(一次事务),再换挂载点:
    // 挂到父级下时属性=局部偏移;解绑时属性=世界坐标。两者同式:
    // 换父后的"属性应取值" = 新父(根则恒等)矩阵逆 × 世界坐标
    if (newParentObj) newParentObj.add(mesh)
    else homeRef.current?.add(mesh)
    mesh.updateWorldMatrix(true, false)
    const local = newParentObj
      ? localOffsetForParent(world, newParentObj, tmpWorld.current)
      : world
    const scrub = studio.scrub()
    scrub.capture(({set}) =>
      set(obj.props.position, {x: local.x, y: local.y, z: local.z}),
    )
    scrub.commit()
  }, [parentId])

  // 父级消失看护:parentId 非空但解析失败 → 挂回 root 并把世界
  // 坐标定格进属性(对齐 Blender 父级消失;一次事务)
  useEffect(() => {
    if (!parentId) return
    const obj = objRef.current
    if (!obj) return
    if (resolveAnchorParent(parentId)) return
    const mesh = meshRef.current
    const studio = getStudioSync()
    if (!mesh || !studio) return
    const world = mesh.getWorldPosition(new Vector3())
    homeRef.current?.add(mesh)
    const scrub = studio.scrub()
    scrub.capture(({set}) => {
      set(obj.props.parent, '')
      set(obj.props.position, {x: world.x, y: world.y, z: world.z})
    })
    scrub.commit()
  })
  // 无依赖数组:每次渲染后检查,幂等——解析得到就 return

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
      additionalProps={anchorPropsFor(anchorKey)}
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
