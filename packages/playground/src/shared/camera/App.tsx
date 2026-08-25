import {
  editable as e,
  RefreshSnapshot,
  SheetProvider,
  PerspectiveCamera,
} from '@toy-box/r3f'
import {Stars, OrbitControls} from '@react-three/drei'
import {getProject, getStudioSync} from '@toy-box/core'
import type {IScrub, ISheetObject} from '@toy-box/core'
import React, {Suspense, useLayoutEffect, useRef, useState} from 'react'
import {Canvas, useFrame} from '@react-three/fiber'
import {useGLTF} from '@react-three/drei'
import sceneGLB from './scene.glb'
import type {Mesh, Object3D} from 'three'

document.body.style.backgroundColor = '#171717'

function Model({url}: {url: string}) {
  const {nodes} = useGLTF(url) as any

  // scene.glb 里 planet.001 是不带几何体的空分组节点,
  // 真正有几何体的是 planet.002 / planet.003 两个子节点。
  // 因此 Thingy 挂在分组上(e.group),拖动它即拖动整个模型。
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, -7, 0]} scale={7}>
      <e.group
        theatreKey="Example Namespace / Thingy"
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
 * 主画面的视角控制:左键旋转、滚轮缩放、右键平移。
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

  return <OrbitControls ref={setControls} enableDamping={false} />
}

function App() {
  const bgs = ['#272730', '#b7c5d1']
  const [bgIndex, setBgIndex] = useState(0)
  const bg = bgs[bgIndex]
  const cameraTargetRef = useRef<Mesh>(null!)
  const cameraObjRef = useRef<ISheetObject<any>>()
  const targetObjRef = useRef<ISheetObject<any>>()
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
