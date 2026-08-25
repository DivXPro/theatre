import {
  editable as e,
  RefreshSnapshot,
  SheetProvider,
  PerspectiveCamera,
} from '@toy-box/r3f'
import {
  Stars,
  OrbitControls,
  GizmoHelper,
  GizmoViewport,
} from '@react-three/drei'
import {getProject, getStudioSync} from '@toy-box/core'
import type {IScrub, ISheetObject} from '@toy-box/core'
import React, {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {Canvas, useFrame, useThree} from '@react-three/fiber'
import type {ThreeEvent} from '@react-three/fiber'
import {useGLTF} from '@react-three/drei'
import sceneGLB from './scene.glb'
import {MOUSE, Spherical, Vector3} from 'three'
import type {Mesh, Object3D} from 'three'

document.body.style.backgroundColor = '#171717'

function Model({url}: {url: string}) {
  const {nodes} = useGLTF(url) as any
  const thingyObjRef = useRef<ISheetObject<any> | undefined>(undefined)

  // 主画面点选:r3f 对网格做射线检测,点击任意子网格会冒泡到分组。
  // 拖拽转视角后松手不算点击(r3f 的 delta 判定),两者不冲突。
  const selectThingy = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const studio = getStudioSync()
    if (studio && thingyObjRef.current) {
      studio.setSelection([thingyObjRef.current])
    }
  }

  // scene.glb 里 planet.001 是不带几何体的空分组节点,
  // 真正有几何体的是 planet.002 / planet.003 两个子节点。
  // 因此 Thingy 挂在分组上(e.group),拖动它即拖动整个模型。
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, -7, 0]} scale={7}>
      <e.group
        theatreKey="Example Namespace / Thingy"
        objRef={thingyObjRef}
        onClick={selectThingy}
        rotation={[Math.PI / 13.5, -Math.PI / 5.8, Math.PI / 5.6]}
      >
        <e.mesh
          theatreKey="Example Namespace / Thingy / Debris 2"
          receiveShadow
          castShadow
          geometry={nodes.planet002.geometry}
          material={nodes.planet002.material}
        />
        <e.mesh
          theatreKey="Example Namespace / Thingy / Debris 1"
          geometry={nodes.planet003.geometry}
          material={nodes.planet003.material}
        />
      </e.group>
    </group>
  )
}

/**
 * 主画面的视角控制,操作方式与 Blender 默认键位一致:
 *   中键拖动 = 旋转视角;Shift+中键 = 平移;Ctrl/Cmd+中键 = 平滑缩放;
 *   滚轮 = 缩放;左键不驱动视角(留给点选,和 Blender 的分工一致)。
 * 场景的语义是"相机始终对准 Camera / Target 对象"(PerspectiveCamera 每帧
 * lookAt),因此平移实现为:把 OrbitControls 的新瞄准点写回 Target 对象的
 * 位置属性,让 Target 网格跟着走——不打架,还能持久化和同步。
 * 拖拽过程中把相机位置和瞄准点实时写回 theatre,studio 里的数据和画面
 * 保持一致,没有 studio 时(发布的应用)只在本地生效。
 */
function MainOrbitControls({
  targetRef,
  cameraObjRef,
  targetObjRef,
}: {
  targetRef: React.MutableRefObject<Object3D>
  cameraObjRef: React.MutableRefObject<ISheetObject<any> | undefined>
  targetObjRef: React.MutableRefObject<ISheetObject<any> | undefined>
}) {
  // 用 state 而不是 ref 持有控制器:默认相机切换(makeDefault)时 drei 会
  // 重建 OrbitControls 实例,ref 回调会再次触发,监听才能挂到活着的实例上
  const [controls, setControls] = useState<any>(null)
  // 拖拽期间(尤其平移)不把 Target 网格位置同步回瞄准点:平移刚写完
  // theatre,网格位置要等下一拍才更新,此时回读会把瞄准点拽回旧值
  const draggingRef = useRef(false)

  // 瞄准点跟随 Target 对象的位置(Target 在编辑器里被拖动时也能跟上)
  useFrame(() => {
    const target = targetRef.current
    if (
      controls &&
      target &&
      !draggingRef.current &&
      !controls.target.equals(target.position)
    ) {
      controls.target.copy(target.position)
      controls.update()
    }
  })

  useLayoutEffect(() => {
    if (!controls) return

    let scrub: IScrub | undefined

    const onStart = () => {
      draggingRef.current = true
      const studio = getStudioSync()
      if (!studio) return
      scrub = studio.scrub()
    }
    const onChange = () => {
      const cameraObj = cameraObjRef.current
      if (!scrub || !cameraObj) return
      const p = controls.object.position
      const t = controls.target
      scrub.capture(({set}) => {
        set(cameraObj.props.position, {x: p.x, y: p.y, z: p.z})
        const targetObj = targetObjRef.current
        if (targetObj) {
          set(targetObj.props.position, {x: t.x, y: t.y, z: t.z})
        }
      })
    }
    const onEnd = () => {
      draggingRef.current = false
      scrub?.commit()
      scrub = undefined
    }

    controls.addEventListener('start', onStart)
    controls.addEventListener('change', onChange)
    controls.addEventListener('end', onEnd)
    return () => {
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('change', onChange)
      controls.removeEventListener('end', onEnd)
      scrub?.discard()
    }
  }, [controls, cameraObjRef, targetObjRef])

  // Ctrl/Cmd 按住期间把中键从"旋转"临时切换为"缩放"(Blender 的 Ctrl+中键);
  // OrbitControls 只内置了"旋转+修饰键→平移",不支持修饰键切缩放,所以自己换
  useLayoutEffect(() => {
    if (!controls) return
    const toDolly = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        controls.mouseButtons.MIDDLE = MOUSE.DOLLY
      }
    }
    const toRotate = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        controls.mouseButtons.MIDDLE = MOUSE.ROTATE
      }
    }
    // 窗口失焦时复位,避免 Ctrl 在窗外松开导致中键一直停在缩放
    const reset = () => {
      controls.mouseButtons.MIDDLE = MOUSE.ROTATE
    }
    window.addEventListener('keydown', toDolly)
    window.addEventListener('keyup', toRotate)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', toDolly)
      window.removeEventListener('keyup', toRotate)
      window.removeEventListener('blur', reset)
    }
  }, [controls])

  // 触控板手势对齐 Blender:双指滑动=旋转视角,捏合=缩放,鼠标滚轮保持缩放。
  // 浏览器里三者都是 wheel 事件,区分方式:
  //   捏合     —— 事件带 ctrlKey(macOS 的 Chrome/Safari 都这么报),放行给 OrbitControls 缩放
  //   鼠标滚轮 —— delta 是大的整数值(Chrome 约 ±100 的倍数,Firefox 用行距模式),放行缩放
  //   双指滑动 —— 小而密的像素 delta(常带小数),拦下来自己转成旋转。
  // 启发式不是 100% 可靠:触控板快速甩动偶尔会被当成滚轮(变成缩放),可接受。
  useLayoutEffect(() => {
    if (!controls) return
    const element = controls.domElement as HTMLElement
    const spherical = new Spherical()
    const offset = new Vector3()
    const panOffset = new Vector3()
    const EPS = 0.000001

    const isMouseWheel = (e: WheelEvent) =>
      e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
      (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50)

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || isMouseWheel(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()

      // Shift+双指滑动 = 平移(Blender 的 Shift+中键):相机和瞄准点一起移,
      // 换算与 OrbitControls 内部的 panLeft/panUp 一致,但方向取反——
      // Blender 是"视角跟着鼠标方向走",OrbitControls 默认是"内容跟着鼠标走"
      if (e.shiftKey) {
        if (controls.enablePan === false) return
        const camera = controls.object
        offset.copy(camera.position).sub(controls.target)
        const targetDistance =
          offset.length() * Math.tan(((camera.fov / 2) * Math.PI) / 180)
        const panX = (2 * e.deltaX * targetDistance) / element.clientHeight
        const panY = (2 * e.deltaY * targetDistance) / element.clientHeight
        panOffset
          .setFromMatrixColumn(camera.matrix, 0)
          .multiplyScalar(panX)
          .add(
            offset.setFromMatrixColumn(camera.matrix, 1).multiplyScalar(-panY),
          )
        if (panOffset.lengthSq() < EPS) return

        controls.dispatchEvent({type: 'start'})
        camera.position.add(panOffset)
        controls.target.add(panOffset)
        controls.update()
        controls.dispatchEvent({type: 'end'})
        return
      }

      if (controls.enableRotate === false) return

      // 与 OrbitControls 内部 rotateLeft/rotateUp 相同的换算(都除以高度)
      const rotateSpeed = controls.rotateSpeed ?? 1
      const theta =
        ((2 * Math.PI * e.deltaX) / element.clientHeight) * rotateSpeed
      const phi =
        ((2 * Math.PI * e.deltaY) / element.clientHeight) * rotateSpeed

      offset.copy(controls.object.position).sub(controls.target)
      spherical.setFromVector3(offset)
      spherical.theta -= theta
      spherical.phi -= phi
      spherical.phi = Math.max(
        controls.minPolarAngle + EPS,
        Math.min(controls.maxPolarAngle - EPS, spherical.phi),
      )
      offset.setFromSpherical(spherical).add(controls.target)

      // 触控板惯性流里混着大量零增量事件;位置没变化就不派生 start/end,
      // 否则每次都提交一个空 scrub,控制台被 "Scrub is empty" 刷屏
      if (offset.distanceToSquared(controls.object.position) < EPS) return

      // 走和拖拽一样的事件流:start/end 包住 change,写回 theatre 的逻辑直接复用
      controls.dispatchEvent({type: 'start'})
      controls.object.position.copy(offset)
      controls.update()
      controls.dispatchEvent({type: 'end'})
    }

    // capture + stopImmediatePropagation:抢在 OrbitControls 自己的 wheel 监听之前拦下
    element.addEventListener('wheel', onWheel, {passive: false, capture: true})
    return () =>
      element.removeEventListener('wheel', onWheel, {capture: true} as any)
  }, [controls])

  return (
    <OrbitControls
      ref={setControls}
      makeDefault // 让 GizmoHelper 能读到 controls.target 并在吸附动画后复位 camera.up
      enableDamping={false}
      zoomSpeed={0.5} // 默认 1 每步缩放 5%,调低一档,滚轮/捏合/Ctrl+中键共用
      // 平移方向对齐 Blender("视角跟着鼠标走"),与 OrbitControls 默认相反;
      // panSpeed 取负即方向反转、速度不变,Shift+中键拖动走这里
      panSpeed={-1}
      // 旋转同理取反对齐 Blender;触控板 wheel 旋转的公式里直接引用
      // controls.rotateSpeed,两条路径一起翻
      rotateSpeed={-1}
      mouseButtons={{
        LEFT: -1 as MOUSE, // 左键留给点选,不驱动视角
        MIDDLE: MOUSE.ROTATE, // 中键旋转(Shift+中键平移由内置修饰键逻辑提供)
        RIGHT: -1 as MOUSE, // 右键不驱动视角
      }}
    />
  )
}

/**
 * 视图右上角的方向轴部件(Blender 的导航 gizmo):点击轴头把视角吸附到
 * 对应的正/反轴向视图(前/后/左/右/顶/底),XYZ 对应红绿蓝。
 * 吸附是 GizmoHelper 内部逐帧的补间动画,onUpdate 每帧触发:首帧开 scrub、
 * 逐帧 capture、动画停 200ms 后 commit,整个吸附合成一步可撤销记录。
 * 相机的朝向不用写回——PerspectiveCamera 每帧 lookAt Target,位置对了朝向就对。
 */
function GizmoNav({
  cameraObjRef,
}: {
  cameraObjRef: React.MutableRefObject<ISheetObject<any> | undefined>
}) {
  const camera = useThree((s) => s.camera)
  const scrubRef = useRef<IScrub | undefined>(undefined)
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  const onUpdate = useCallback(() => {
    const studio = getStudioSync()
    const cameraObj = cameraObjRef.current
    if (!studio || !cameraObj) return
    if (!scrubRef.current) scrubRef.current = studio.scrub()
    const p = camera.position
    scrubRef.current.capture(({set}) => {
      set(cameraObj.props.position, {x: p.x, y: p.y, z: p.z})
    })
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    commitTimerRef.current = setTimeout(() => {
      scrubRef.current?.commit()
      scrubRef.current = undefined
    }, 200)
  }, [camera, cameraObjRef])

  useEffect(
    () => () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    },
    [],
  )

  return (
    // 右上角往左让出属性面板的位置,避免轴臂被面板遮住。
    // key=相机:默认相机切换(或热更新后状态老化)时强制 gizmo 重建,
    // 防止它内部缓存了旧相机导致朝向冻结
    <GizmoHelper
      key={camera.uuid}
      alignment="top-right"
      margin={[340, 70]}
      onUpdate={onUpdate}
    >
      <GizmoViewport labelColor="white" />
    </GizmoHelper>
  )
}

function App() {
  const bgs = ['#272730', '#b7c5d1']
  const [bgIndex, setBgIndex] = useState(0)
  const bg = bgs[bgIndex]
  const cameraTargetRef = useRef<Mesh>(null!)
  const cameraObjRef = useRef<ISheetObject<any> | undefined>(undefined)
  const targetObjRef = useRef<ISheetObject<any> | undefined>(undefined)
  const sheet = getProject('Space').sheet('Scene')

  return (
    <div
      onClick={() => {
        // return setBgIndex((bgIndex) => (bgIndex + 1) % bgs.length)
      }}
      style={{
        height: '100vh',
      }}
    >
      <Canvas
        dpr={[1.5, 2]}
        linear
        shadows="percentage"
        gl={{preserveDrawingBuffer: true}}
        frameloop="demand"
      >
        <SheetProvider sheet={sheet}>
          <MainOrbitControls
            targetRef={cameraTargetRef}
            cameraObjRef={cameraObjRef}
            targetObjRef={targetObjRef}
          />
          <GizmoNav cameraObjRef={cameraObjRef} />
          <fog attach="fog" args={[bg, 16, 30]} />
          <color attach="background" args={[bg]} />
          <ambientLight intensity={0.75} />
          <PerspectiveCamera
            theatreKey="Camera / Camera"
            objRef={cameraObjRef}
            makeDefault
            position={[0, 0, 16]}
            fov={75}
            lookAt={cameraTargetRef}
          >
            <e.pointLight
              theatreKey="Light 1"
              intensity={1}
              position={[-10, -25, -10]}
            />
            <e.spotLight
              theatreKey="Light 2"
              castShadow
              intensity={2.25}
              angle={0.2}
              penumbra={1}
              position={[-25, 20, -15]}
              shadow-mapSize={[1024, 1024]}
              shadow-bias={-0.0001}
            />
            <e.directionalLight theatreKey="Light 3" />
          </PerspectiveCamera>
          <e.mesh
            ref={cameraTargetRef}
            theatreKey="Camera / Target"
            objRef={targetObjRef}
            position={[0, 0, 0]}
            visible="editor"
          >
            <boxGeometry attach="geometry" />
            <meshPhongMaterial attach="material" color="red" />
          </e.mesh>
          <Suspense fallback={null}>
            <RefreshSnapshot />
            <Model url={sceneGLB} />
          </Suspense>
          <Stars radius={500} depth={50} count={1000} factor={10} />
        </SheetProvider>
      </Canvas>
    </div>
  )
}

export default App
