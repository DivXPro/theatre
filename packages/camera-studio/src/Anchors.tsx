// packages/camera-studio/src/Anchors.tsx
/**
 * 独立锚点(空物体):顶栏按钮添加,浅蓝轴线交叉(Blender Plain
 * Axes 式:过原点的 ±X/±Y/±Z 三根线)+ 轴心小圆点。线条恒定普通色
 * 不变;选中(画布/大纲)时只有圆点变橙高亮,demand 帧手动补一帧。
 * 可点选、可拖(gizmo)、右键删除;可被相机瞄准,可绑定父级。
 * 仅编辑视角可见。线段拾取有 three 默认阈值,轴线附近点击即选中
 * (与相机视锥线一致),圆点是最精准的命中区。
 */
import {editable as e} from '@dreamerbird/r3f'
import {getStudioSync, types as t, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {MutableRefObject} from 'react'
import {BufferGeometry, Float32BufferAttribute, Vector3} from 'three'
import type {Group, Mesh, MeshBasicMaterial} from 'three'
import {invalidate, useFrame} from '@react-three/fiber'
import type {ThreeEvent} from '@react-three/fiber'
import {translate} from '@dreamerbird/studio/i18n'
import {registerEditorOnly} from './editorOnly'
import {useSelectionGizmoTarget} from './PlacementManager'
import {consumeAnchorSeed, useAnchorsList} from './anchorsRegistry'
import {
  anchorParentOptionsFor,
  detachAnchorMesh,
  localOffsetForParent,
  needsParentEstablish,
  registerAnchorObject,
  resolveAnchorParent,
  shouldClearMissingParent,
  subscribeTargetRegistry,
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

/** 轴线臂长:对齐旧线框方块/小球的视觉尺寸(总跨距 0.5) */
const ANCHOR_AXES_ARM = 0.25

/** 锚点普通色:与相机视锥默认同款浅蓝。线条恒定此色,不随选中变 */
const ANCHOR_COLOR = 0x6fb7ff
/** 选中高亮色(锚点橙):只落在轴心圆点上 */
const ANCHOR_HIGHLIGHT = 0xffb020
/** 轴心小圆点半径:兼任最精准的点击命中区 */
const ANCHOR_DOT_RADIUS = 0.06

/** Blender Plain Axes 式几何:过原点的三根轴线(±X/±Y/±Z),6 顶点 */
function createAnchorAxesGeometry(): BufferGeometry {
  const a = ANCHOR_AXES_ARM
  const geo = new BufferGeometry()
  geo.setAttribute(
    'position',
    new Float32BufferAttribute(
      [-a, 0, 0, a, 0, 0, 0, -a, 0, 0, a, 0, 0, 0, -a, 0, 0, a],
      3,
    ),
  )
  return geo
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
  // 锚点节点:Group 包一根线段几何(Plain Axes 视觉);挂载/脱离/
  // gizmo 附着只认 Object3D,不挑几何类型
  const nodeRef = useRef<Group>(null!)
  // 轴线几何:随组件建,卸载释放(6 顶点线段,极轻)
  const axesGeo = useMemo(createAnchorAxesGeometry, [])
  useEffect(() => () => axesGeo.dispose(), [axesGeo])
  const dotRef = useRef<Mesh>(null!)
  const setObjRef = (obj: ISheetObject<any> | null) => {
    objRef.current = obj ?? undefined
  }

  // 选中高亮:只有轴心圆点变色(浅蓝→橙),轴线恒定普通色。对齐
  // ShotCamera 的订阅模式;值不变 setState 自动跳过,无关切换不重渲染;
  // demand 帧模式下换色不重画,手动 invalidate 补一帧
  const [selected, setSelected] = useState(false)
  useEffect(() => {
    const studio = getStudioSync()
    if (!studio) return
    const sync = () =>
      setSelected((studio.selection as unknown[]).includes(objRef.current))
    sync()
    return studio.onSelectionChange(sync)
  }, [objRef])
  useEffect(() => {
    const mat = dotRef.current?.material as MeshBasicMaterial | undefined
    mat?.color.set(selected ? ANCHOR_HIGHLIGHT : ANCHOR_COLOR)
    invalidate()
  }, [selected])

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
  // 体内先捕获 node:passive cleanup 执行时 React 已把 ref 置 null
  // (复审实测 React 19.2.8;layout cleanup 才仍 non-null),cleanup 里
  // 读 nodeRef.current 是空操作,幽灵网格原样残留
  useEffect(() => {
    const node = nodeRef.current
    registerAnchorObject(anchorKey, node)
    return () => {
      registerAnchorObject(anchorKey, null)
      // fiber v9 卸载按 JSX 父实例 remove,对命令式换父后的网格是 no-op:
      // 已绑到骨骼/模型上的锚点被删时,必须显式脱离当前父级(捕获值),
      // 否则网格残留在场景里,可见不可选,绑骨骼上还会跟动画
      detachAnchorMesh(node)
      objRef.current = undefined
    }
  }, [anchorKey])
  // 锚点有自己的选中高亮(轴心圆点变橙),不再画包围盒
  useSelectionGizmoTarget(objRef, nodeRef, true, {boxHighlight: false})
  useEffect(() => registerEditorOnly(nodeRef.current), [])

  // 响应式读 parent 属性(复用 ShotCamera 的 useObjPropScalar)
  const parentId = useObjPropScalar<string>(objRef, 'parent', '')

  // 场景树父子:parent 变化 → 解析目标 → 真挂载;位置属性自动成为
  // 相对父级的局部偏移。绑定/解绑/父级消失的"画面不跳"定格见下。
  const prevParentRef = useRef<string | null>(null)
  // 本会话绑定成功过的父级:看护"父级消失→清除"的闸,也是重试循环的
  // 去重标记(纯判定在 aimTargets.shouldClearMissingParent /
  // needsParentEstablish,可单测)
  const boundParentRef = useRef<{parentId: string} | null>(null)
  const tmpWorld = useRef(new Vector3())
  useLayoutEffect(() => {
    const node = nodeRef.current
    if (!node) return
    const prev = prevParentRef.current
    if (prev === null) {
      // 挂载首次:持久态恢复,场景位置由包装器按属性恢复,不干预。
      // 但要快照持久 parent 值把游标推过去:下一次提交 parentId 从
      // fallback '' 变回持久值时,若持久父级非空,恢复绑定走"只挂不换算"
      // (此刻 position 属性是相对父级的局部偏移,不能当世界坐标换算),
      // 由 useFrame 重试循环建立;推进后那次提交在此等价 no-op
      prevParentRef.current = parentId
      try {
        const obj = objRef.current
        const persisted = obj
          ? (val(obj.props.parent) as string | undefined) ?? ''
          : ''
        if (persisted) prevParentRef.current = persisted
      } catch {
        // 对象未就绪:维持 fallback,行为退化为重试兜底
      }
      return
    }
    if (prev === parentId) return
    const studio = getStudioSync()
    const obj = objRef.current
    if (!studio || !obj) return
    // 先定格世界坐标进属性(一次事务),再换挂载点:
    // 挂到父级下时属性=局部偏移;解绑时属性=世界坐标。两者同式:
    // 换父后的"属性应取值" = 新父(根则恒等)矩阵逆 × 世界坐标
    if (parentId === '') {
      // 解绑(下拉选「无」/看护清除后的跟随):挂回娘家,属性=世界坐标
      const world = node.getWorldPosition(tmpWorld.current).clone()
      homeRef.current?.add(node)
      const scrub = studio.scrub()
      scrub.capture(({set}) =>
        set(obj.props.position, {x: world.x, y: world.y, z: world.z}),
      )
      scrub.commit()
      prevParentRef.current = ''
      boundParentRef.current = null
      return
    }
    const newParentObj = resolveAnchorParent(parentId)
    if (!newParentObj) {
      // 解析失败(异步目标还在加载/对端时序):不写不推进,原样返回——
      // 由 useFrame 重试循环以"只挂不换算"建立,成功前游标停在 prev
      return
    }
    const world = node.getWorldPosition(tmpWorld.current).clone()
    newParentObj.add(node)
    node.updateWorldMatrix(true, false)
    const local = localOffsetForParent(world, newParentObj, tmpWorld.current)
    const scrub = studio.scrub()
    scrub.capture(({set}) =>
      set(obj.props.position, {x: local.x, y: local.y, z: local.z}),
    )
    scrub.commit()
    // 游标推进放在成功路径之后:解析失败时下次提交还会走到这里重试,
    // 不会出现"推进了却什么都没做"的假成功
    prevParentRef.current = parentId
    boundParentRef.current = {parentId}
  }, [parentId])

  // 绑定重试循环:异步目标(放置模型/骨骼锚点,Suspense 加载完才注册)
  // 在刷新/撤销恢复绑定时,上面的 effect 解析失败不推进,由这里每帧补建。
  // useFrame 闭包每渲染刷新,读到的是最新 parentId;默认优先级 0——
  // 不传正优先级,正优先级订阅者会让 R3F 关掉按需渲染(Hud 同款坑)。
  // 恢复场景 position 属性已是相对父级的局部偏移,只挂载不换算、不写
  // 属性(换算会把持久局部偏移误当世界坐标再逆变换,锚点静默错位)
  useFrame(() => {
    const id = parentId
    if (!needsParentEstablish(boundParentRef.current?.parentId ?? null, id))
      return
    const newParentObj = resolveAnchorParent(id)
    if (!newParentObj) return // 目标还没加载出来,下一帧再试
    const node = nodeRef.current
    if (!node) return
    newParentObj.add(node)
    prevParentRef.current = id
    boundParentRef.current = {parentId: id}
  })

  // 父级消失看护:parentId 非空、本会话绑定成功过、此刻解析不到 →
  // 挂回 root 并把世界坐标定格进属性(对齐 Blender 父级消失;一次事务)。
  // 闸(shouldClearMissingParent):从未绑定成功过的父级(刷新恢复/
  // 加载中)不清不定格,交给上面的重试循环——否则异步目标加载完成前
  // 的空窗会被误当"父级消失",持久绑定被清掉(Critical-1 回归)
  // 目标登记表(bones/placedInstances)变更订阅:undo/对端删除模型不
  // 触发本组件重渲染,下面的看护(无依赖、每次渲染跑)靠这里的 bump
  // 才能及时检查到 model:/bone: 父级消失(对齐 ShotCamera 的订阅)
  const [, bumpParentCheck] = useState(0)
  useEffect(
    () => subscribeTargetRegistry(() => bumpParentCheck((n) => n + 1)),
    [],
  )
  useEffect(() => {
    if (
      !shouldClearMissingParent(
        boundParentRef.current?.parentId ?? null,
        parentId,
        resolveAnchorParent(parentId) !== null,
      )
    )
      return
    const obj = objRef.current
    const node = nodeRef.current
    const studio = getStudioSync()
    if (!obj || !node || !studio) return
    const world = node.getWorldPosition(new Vector3())
    homeRef.current?.add(node)
    const scrub = studio.scrub()
    scrub.capture(({set}) => {
      set(obj.props.parent, '')
      set(obj.props.position, {x: world.x, y: world.y, z: world.z})
    })
    scrub.commit()
  })
  // 无依赖数组:每次渲染后检查,幂等——闸不满足或解析得到就 return

  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const studio = getStudioSync()
    if (studio && objRef.current) studio.setSelection([objRef.current])
  }

  return (
    <e.group
      theatreKey={anchorKey}
      objRef={setObjRef}
      ref={nodeRef}
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
      <lineSegments geometry={axesGeo}>
        <lineBasicMaterial color={ANCHOR_COLOR} />
      </lineSegments>
      <mesh ref={dotRef}>
        <sphereGeometry args={[ANCHOR_DOT_RADIUS, 16, 16]} />
        <meshBasicMaterial color={ANCHOR_COLOR} />
      </mesh>
    </e.group>
  )
}
