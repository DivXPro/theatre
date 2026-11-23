import {
  DragTarget,
  TransformControlsDriver,
} from '@dreamerbird/threeik/controls'
import type {DragControl} from '@dreamerbird/threeik/controls'
import {
  BoxGeometry,
  Object3D,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import type {Camera} from 'three'
import type {PoseManipulatorMode} from './poseSession'
import {solveIK} from './fullbodySolver'
import type {IKConstraint} from './fullbodySolver'
import type {FullbodyPointSpec, resolveFullbodyRig} from './fullbodyPoints'

const MARKER_RADII = {primary: 0.029, joint: 0.017, detail: 0.011}
const MARKER_COLOR = 0x7dd3c0
const SETTLE_FRAMES = 8

type Point = {
  spec: FullbodyPointSpec
  effector: Object3D
  target: DragTarget
  positionEnabled: boolean
  rotationEnabled: boolean
}

export function createFullbodyControls({
  rig,
  scene,
  camera,
  dom,
  scale,
  dragControl,
  invalidate,
  onEdit,
}: {
  rig: NonNullable<ReturnType<typeof resolveFullbodyRig>>
  scene: Object3D
  camera: Camera
  dom: HTMLCanvasElement
  scale: number
  dragControl: DragControl
  invalidate: () => void
  onEdit: () => void
}) {
  const driver = new TransformControlsDriver(camera, scene, dom, dragControl)
  const points = rig.points.map((spec): Point => {
    const effector = spec.offset ? new Object3D() : spec.bone
    if (spec.offset) {
      effector.position.copy(spec.offset)
      spec.bone.add(effector)
    }
    const radius = MARKER_RADII[spec.tier] * scale
    const target = new DragTarget(
      camera,
      dom,
      effector.getWorldPosition(new Vector3()),
      MARKER_COLOR,
      dragControl,
      radius,
    )
    effector.getWorldQuaternion(target.quaternion)
    target.name = spec.id
    if (!spec.rotation) {
      target.ball.geometry.dispose()
      const size = 1.6 * radius
      target.ball.geometry = new BoxGeometry(size, size, size)
    }
    scene.add(target)
    return {
      spec,
      effector,
      target,
      positionEnabled: spec.positionEnabled,
      rotationEnabled: false,
    }
  })
  const support = points.filter(
    ({spec: {id}}) => id === 'legL' || id === 'legR' || id.endsWith(':toe'),
  )
  const anchors = [rig.hips, rig.chest].map((effector) => ({
    effector,
    root: rig.hips,
    target: effector.getWorldPosition(new Vector3()),
    targetRot: effector.getWorldQuaternion(new Quaternion()),
  }))
  const captureTorso = () => {
    for (const anchor of anchors) {
      anchor.effector.getWorldPosition(anchor.target)
      anchor.effector.getWorldQuaternion(anchor.targetRot)
    }
  }
  let selected: Point | null = null
  let mode: PoseManipulatorMode = 'move'
  let editingTorso = false
  let pendingInput = false
  let remainingFrames = 0
  let blankPress: Vector2 | null = null
  let restoreGizmo = false
  const raycaster = new Raycaster()
  const ndc = new Vector2()
  const world = new Vector3()
  const cameraPosition = new Vector3()
  const controlMode = (point: Point | null) =>
    point?.spec.rotation === false ? 'move' : mode

  const refresh = () => {
    const target = selected?.target ?? null
    if (driver.attachedTo !== target) driver.attach(target, {size: 0.7})
    driver.setMode(controlMode(selected))
    driver.controls.setSpace('world')
    for (const point of points) {
      point.target.setVisible(
        point.spec.tier !== 'detail' ||
          point.spec.group === selected?.spec.group,
      )
      point.target.setMarkerMode(controlMode(point) === 'rotate')
      point.target.setExternalManipulator(point === selected)
      point.target.setSelected(point === selected)
    }
    invalidate()
  }
  const select = (point: Point | null) => {
    blankPress = null
    selected = point
    refresh()
  }
  const recordEdit = (point: Point) => {
    const torso = rig.torso.has(point.spec.bone)
    if (editingTorso && !torso) captureTorso()
    editingTorso = torso
    pendingInput = true
    remainingFrames = SETTLE_FRAMES
    onEdit()
    invalidate()
  }

  for (const point of points) {
    point.target.onPress = () => select(point)
    point.target.onMoved = () => {
      point.positionEnabled = true
      recordEdit(point)
    }
  }

  driver.onDragStart = () => {
    blankPress = null
    selected?.target.beginExternalDrag()
    for (const {target} of points) target.setInteractive(false)
  }
  driver.onDragChange = () => {
    if (!selected) return
    if (controlMode(selected) === 'move') selected.target.reclamp()
    else {
      selected.rotationEnabled = true
      recordEdit(selected)
    }
  }
  driver.onDragEnd = () => selected?.target.endExternalDrag()

  const pickNearest = (event: PointerEvent) => {
    blankPress =
      event.button === 0 ? new Vector2(event.clientX, event.clientY) : null
    const rect = dom.getBoundingClientRect()
    ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    )
    raycaster.setFromCamera(ndc, camera)
    camera.getWorldPosition(cameraPosition)
    let nearest: DragTarget | null = null
    let distance = Infinity
    if (event.button === 0) {
      for (const {target} of points) {
        if (!target.ball.visible) continue
        target.getWorldPosition(world)
        const next = raycaster.ray.distanceToPoint(world)
        const tolerance =
          target.ballRadius + cameraPosition.distanceTo(world) * 0.011
        if (next <= tolerance && next < distance) {
          nearest = target
          distance = next
        }
      }
    }
    restoreGizmo =
      nearest !== null &&
      nearest !== driver.attachedTo &&
      distance <= nearest.ballRadius &&
      driver.controls.enabled
    if (restoreGizmo) driver.controls.enabled = false
    for (const {target} of points) target.setInteractive(target === nearest)
  }
  const restorePicking = () => {
    if (restoreGizmo) driver.controls.enabled = true
    restoreGizmo = false
    for (const {target} of points) target.setInteractive(true)
  }
  const onPointerUp = (event: PointerEvent) => {
    const press = blankPress
    blankPress = null
    if (
      press &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5
    )
      select(null)
  }
  const onPointerCancel = () => {
    blankPress = null
    selected?.target.endExternalDrag()
    if (driver.controls.dragging) driver.controls.pointerUp(null)
    dragControl.unlock()
  }
  dom.addEventListener('pointerdown', pickNearest, true)
  dom.addEventListener('pointerdown', restorePicking)
  dom.addEventListener('pointerup', onPointerUp)
  dom.addEventListener('pointercancel', onPointerCancel)
  refresh()

  const update = () => {
    if (remainingFrames > 0) {
      remainingFrames--
      pendingInput = false
      const constraints: IKConstraint[] = []
      for (const {
        effector,
        target,
        positionEnabled,
        rotationEnabled,
      } of points) {
        if (positionEnabled || rotationEnabled)
          constraints.push({
            effector,
            root: rig.hips,
            target: target.position,
            targetRot: target.quaternion,
            posWeight: Number(positionEnabled),
            rotWeight: Number(rotationEnabled),
          })
      }
      const stability = editingTorso ? 0 : 0.4
      if (stability > 0) {
        constraints.push(
          {
            ...anchors[0],
            posWeight: 2 * stability,
            rotWeight: 0.65 * stability,
          },
          {...anchors[1], posWeight: stability, rotWeight: 0.8 * stability},
        )
      }
      const supportPositions = support.map(
        ({spec, target, positionEnabled}) => {
          return !spec.offset && positionEnabled
            ? target.position
            : spec.bone.getWorldPosition(new Vector3())
        },
      )
      solveIK(constraints, 6, 0.12, {
        scale,
        rootStep: 0.15 * (1 - 0.3 * stability),
        rootClamp: 0.06,
        comSupport: supportPositions,
        comGain: 0.03 * (1 - stability),
        rotGain: 0.5,
      })
    }
    for (const {effector, target, positionEnabled, rotationEnabled} of points) {
      if (target.isDragging) continue
      if (!positionEnabled) effector.getWorldPosition(target.position)
      if (!rotationEnabled) effector.getWorldQuaternion(target.quaternion)
    }
    if (remainingFrames > 0) invalidate()
  }

  return {
    targets: points.map(({target}) => target),
    getSelected: () => selected?.spec.id ?? null,
    getSelectionModes: () => ({
      move: true,
      rotate: selected?.spec.rotation ?? true,
    }),
    setManipulatorMode(next: PoseManipulatorMode) {
      mode = next
      refresh()
    },
    update,
    flush() {
      if (pendingInput) update()
    },
    dispose() {
      dom.removeEventListener('pointerdown', pickNearest, true)
      dom.removeEventListener('pointerdown', restorePicking)
      dom.removeEventListener('pointerup', onPointerUp)
      dom.removeEventListener('pointercancel', onPointerCancel)
      driver.dispose()
      for (const {spec, effector, target} of points) {
        if (spec.offset) effector.removeFromParent()
        target.dispose()
        target.removeFromParent()
        target.ball.geometry.dispose()
        const materials = target.ball.material
        for (const material of Array.isArray(materials)
          ? materials
          : [materials]) {
          material.dispose()
        }
      }
    },
  }
}
