/* eslint-disable import/no-extraneous-dependencies */
/**
 * 绑定/父级切换命令的撤销取证(2026-10-19,F1 修复):
 * anchors.setParent / anchors.clearParent / cameras.unbindPath /
 * cameras.setAimTarget(解除)必须把「属性 + 坐标定格」折进同一事务——
 * 否则组件看护 effect 会再补一笔定格提交,两步撤销,undo 一次只回属性
 * 不回定格,对象跳变(撤销陷阱,同 removeAnchor/removePathFromRegistry
 * 注释)。
 *
 * 本文件用真实 Studio(同 keyframes.realStudio.test.ts 的引导方式)+
 * 真实 three 节点(登记进 aimTargets/pathRuntime/objectRuntime 运行时表,
 * 模拟组件已挂载)验证:
 *   1. 命令只产生一个撤销步骤(undoStack +1);
 *   2. 定格值正确:持久 position/rotation == 命令时刻的世界坐标换算;
 *   3. 一次 undo 同时回退属性与定格;
 *   4. 看守卫 no-op 前提:模拟包装器应用持久值后,节点世界坐标 == 命令前
 *      世界坐标(看护 effect 的同值守卫据此跳过提交)。
 *
 * 与 anchors.test.ts / cameras.test.ts(假事务,验写入形状)互补。
 */
import '@dreamerbird/studio'
import theatre, {getProject, types as t, val} from '@dreamerbird/core'
import {globals} from '@dreamerbird/core/globals'
import type {ISheetObject} from '@dreamerbird/core'
import getStudio from '@dreamerbird/studio/getStudio'
import {getCoreTicker} from '@dreamerbird/core/coreTicker'
import {Group, Object3D, Vector3} from 'three'
import {registerAnchorHome, registerAnchorObject} from '../../aimTargets'
import {ANCHORS_REGISTRY_KEY} from '../../anchorsRegistry'
import {
  CAMERAS_REGISTRY_KEY,
  registerShotCameraObject,
} from '../../cameraRegistry'
import {AgentCommandRegistry} from '../registry'
import {createAgentRuntime} from '../runtime'
import * as objectRuntime from '../runtime/objectRuntime'
import {registerPathSampler} from '../runtime/pathRuntime'
import type {CommandContext} from '../types'
import {registerAnchorCommands} from './anchors'
import {registerCameraCommands} from './cameras'

const studio = getStudio()!
void theatre.init({studio: true, usePersistentStorage: false})

let projectSeq = 0

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

/** 探 saaz 撤销栈(私有路径,同 keyframes.realStudio.test.ts 的取证方式) */
const undoStackOf = (): unknown[] => {
  const s = studio as unknown as {_store?: {_saaz?: unknown}; _saaz?: unknown}
  const saaz = (s._store?._saaz ?? s._saaz) as
    | {_atom?: {get?: () => {undoRedo?: {stack?: unknown[]}}}}
    | undefined
  return saaz?._atom?.get?.()?.undoRedo?.stack ?? []
}

const vec3 = (v: unknown) => v as {x: number; y: number; z: number}
const expectVec3Close = (
  actual: {x: number; y: number; z: number},
  expected: {x: number; y: number; z: number},
) => {
  expect(actual.x).toBeCloseTo(expected.x, 5)
  expect(actual.y).toBeCloseTo(expected.y, 5)
  expect(actual.z).toBeCloseTo(expected.z, 5)
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function setup() {
  const project = getProject(`agent-bindings-real-${++projectSeq}`, {
    state: {
      definitionVersion: globals.currentProjectStateDefinitionVersion,
      sheetsById: {
        Scene: {
          staticOverrides: {byObject: {}},
          sequence: {
            type: 'PositionalSequence',
            length: 10,
            subUnitsPerUnit: 30,
            tracksByObject: {},
          },
        },
      },
    } as never,
  })
  getCoreTicker().tick()
  const sheet = project.sheet('Scene')
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => studio as never,
    subscribeHistoric: () => () => {},
  })
  const registry = new AgentCommandRegistry()
  registerAnchorCommands(registry, runtime)
  registerCameraCommands(registry, runtime)

  const anchorKeys: string[] = []
  const cameraEntries: Array<{cameraKey: string}> = []
  /** 注册表清单落账(命令的存在性底账读它;同生产的 add*ToRegistry) */
  function flushRegistries() {
    const anchorsRegistry = sheet.object(
      ANCHORS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    anchorsRegistry.initialValue = {list: JSON.stringify(anchorKeys)}
    const camerasRegistry = sheet.object(
      CAMERAS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    camerasRegistry.initialValue = {list: JSON.stringify(cameraEntries)}
  }

  /** 锚点 SheetObject + three 节点 + 双登记(模拟 AnchorObject 已挂载) */
  function mountAnchor(
    key: string,
    node: Object3D,
    initial: {position: {x: number; y: number; z: number}; parent?: string},
  ) {
    const obj = sheet.object(key, {
      position: t.compound({x: t.number(0), y: t.number(0), z: t.number(0)}),
      parent: t.string(''),
    }) as ISheetObject<any>
    obj.initialValue = initial
    anchorKeys.push(key)
    const id = `anchor:${key}` as const
    objectRuntime.registerSceneSheetObject(id, obj)
    registerAnchorObject(key, node)
    cleanups.push(() => {
      objectRuntime.unregisterSceneSheetObject(id, obj)
      registerAnchorObject(key, null)
    })
    return obj
  }

  /** 相机 SheetObject + three 相机 + 双登记(模拟 ShotCamera 已挂载) */
  function mountCamera(
    key: string,
    cam: Object3D,
    initial: {
      position: {x: number; y: number; z: number}
      aimTarget?: string
      pathKey?: string
    },
  ) {
    const obj = sheet.object(key, {
      position: t.compound({x: t.number(0), y: t.number(0), z: t.number(0)}),
      rotation: t.compound({x: t.number(0), y: t.number(0), z: t.number(0)}),
      aimTarget: t.string(''),
      pathKey: t.string(''),
    }) as ISheetObject<any>
    obj.initialValue = initial
    cameraEntries.push({cameraKey: key})
    const id = `camera:${key}` as const
    objectRuntime.registerSceneSheetObject(id, obj)
    registerShotCameraObject(key, cam)
    cleanups.push(() => {
      objectRuntime.unregisterSceneSheetObject(id, obj)
      registerShotCameraObject(key, null)
    })
    return obj
  }

  const home = new Group()
  registerAnchorHome(home)
  cleanups.push(() => registerAnchorHome(null))

  return {
    project,
    sheet,
    registry,
    home,
    mountAnchor,
    mountCamera,
    flushRegistries,
  }
}

test('anchors.setParent:parent 与局部偏移定格一步撤销;undo 同时回退;世界坐标不跳', async () => {
  const {project, registry, home, mountAnchor, flushRegistries} = setup()
  await project.ready
  // Anchor 1 在娘家下,世界坐标 (1,2,3);Anchor 2(父级)在 (10,0,0)
  const nodeA = new Object3D()
  nodeA.position.set(1, 2, 3)
  home.add(nodeA)
  const nodeB = new Object3D()
  nodeB.position.set(10, 0, 0)
  const objA = mountAnchor('Anchor 1', nodeA, {position: {x: 1, y: 2, z: 3}})
  mountAnchor('Anchor 2', nodeB, {position: {x: 10, y: 0, z: 0}})
  flushRegistries()
  const worldBefore = nodeA.getWorldPosition(new Vector3()).clone()

  const stackBefore = undoStackOf().length
  await registry.execute(
    'anchors.setParent',
    {objectId: 'anchor:Anchor 1', parent: 'anchor:Anchor 2'},
    ctx(),
  )

  // 一步撤销;持久值 = parent + 局部偏移定格(-9,2,3)
  expect(undoStackOf().length).toBe(stackBefore + 1)
  expect(val(objA.props.parent)).toBe('anchor:Anchor 2')
  expectVec3Close(vec3(val(objA.props.position)), {x: -9, y: 2, z: 3})
  // 同步换父:包装器应用局部偏移前节点已在新父之下
  expect(nodeA.parent).toBe(nodeB)
  // 看护 no-op 前提:模拟包装器应用持久值后,世界坐标 == 命令前
  nodeA.position.set(
    vec3(val(objA.props.position)).x,
    vec3(val(objA.props.position)).y,
    vec3(val(objA.props.position)).z,
  )
  expectVec3Close(vec3(nodeA.getWorldPosition(new Vector3())), {
    x: worldBefore.x,
    y: worldBefore.y,
    z: worldBefore.z,
  })

  // 一次 undo:属性与定格一并回退
  studio.undo()
  expect(val(objA.props.parent)).toBe('')
  expectVec3Close(vec3(val(objA.props.position)), {x: 1, y: 2, z: 3})
})

test('anchors.clearParent:parent 清空与世界坐标定格一步撤销;undo 同时回退;挂回娘家', async () => {
  const {project, registry, home, mountAnchor, flushRegistries} = setup()
  await project.ready
  // Anchor 1 绑在 Anchor 2(10,0,0)下,局部偏移 (1,1,1) → 世界 (11,1,1)
  const nodeB = new Object3D()
  nodeB.position.set(10, 0, 0)
  const nodeA = new Object3D()
  nodeA.position.set(1, 1, 1)
  nodeB.add(nodeA)
  const objA = mountAnchor('Anchor 1', nodeA, {
    position: {x: 1, y: 1, z: 1},
    parent: 'anchor:Anchor 2',
  })
  mountAnchor('Anchor 2', nodeB, {position: {x: 10, y: 0, z: 0}})
  flushRegistries()
  const worldBefore = nodeA.getWorldPosition(new Vector3()).clone()

  const stackBefore = undoStackOf().length
  await registry.execute(
    'anchors.clearParent',
    {objectId: 'anchor:Anchor 1'},
    ctx(),
  )

  expect(undoStackOf().length).toBe(stackBefore + 1)
  expect(val(objA.props.parent)).toBe('')
  expectVec3Close(vec3(val(objA.props.position)), {x: 11, y: 1, z: 1})
  expect(nodeA.parent).toBe(home)
  // 看护 no-op 前提:模拟包装器应用持久值后,世界坐标 == 命令前
  const persisted = vec3(val(objA.props.position))
  nodeA.position.set(persisted.x, persisted.y, persisted.z)
  expectVec3Close(vec3(nodeA.getWorldPosition(new Vector3())), {
    x: worldBefore.x,
    y: worldBefore.y,
    z: worldBefore.z,
  })

  studio.undo()
  expect(val(objA.props.parent)).toBe('anchor:Anchor 2')
  expectVec3Close(vec3(val(objA.props.position)), {x: 1, y: 1, z: 1})
})

test('cameras.unbindPath:pathKey 与驱动机位定格一步撤销;undo 同时回退', async () => {
  const {project, registry, sheet, mountCamera, flushRegistries} = setup()
  await project.ready
  // 相机绑定 Path 1,持久机位是过期手动值;驱动机位 = 路径当前进度采样
  const cam = new Object3D()
  cam.position.set(7, 8, 9) // 帧驱动镜像:此刻相机本体就在采样点上
  const camObj = mountCamera('Shot Camera', cam, {
    position: {x: 1, y: 2, z: 3},
    pathKey: 'Path 1',
  })
  const pathObj = sheet.object('Path 1', {
    progress: t.number(0.5),
  }) as ISheetObject<any>
  objectRuntime.registerSceneSheetObject('path:Path 1', pathObj)
  const unbindSampler = registerPathSampler('Path 1', (_u, out) => {
    out.set(7, 8, 9)
    return true
  })
  cleanups.push(() => {
    unbindSampler()
    objectRuntime.unregisterSceneSheetObject('path:Path 1', pathObj)
  })
  flushRegistries()

  const stackBefore = undoStackOf().length
  await registry.execute(
    'cameras.unbindPath',
    {objectId: 'camera:Shot Camera'},
    ctx(),
  )

  expect(undoStackOf().length).toBe(stackBefore + 1)
  expect(val(camObj.props.pathKey)).toBe('')
  // 定格 = 驱动机位(与看护读 drivenPosRef 同源同值)
  expectVec3Close(vec3(val(camObj.props.position)), {x: 7, y: 8, z: 9})

  studio.undo()
  expect(val(camObj.props.pathKey)).toBe('Path 1')
  expectVec3Close(vec3(val(camObj.props.position)), {x: 1, y: 2, z: 3})
})

test('cameras.setAimTarget 解除:aimTarget 与朝向定格一步撤销;undo 同时回退', async () => {
  const {project, registry, mountAnchor, mountCamera, flushRegistries} = setup()
  await project.ready
  // 相机在 (1,2,3) 瞄准 Anchor 1(0,0,-5);持久朝向是过期手动值
  const targetNode = new Object3D()
  targetNode.position.set(0, 0, -5)
  mountAnchor('Anchor 1', targetNode, {position: {x: 0, y: 0, z: -5}})
  const cam = new Object3D()
  cam.position.set(1, 2, 3)
  const camObj = mountCamera('Shot Camera', cam, {
    position: {x: 1, y: 2, z: 3},
    aimTarget: 'anchor:Anchor 1',
  })
  flushRegistries()
  const rotationBefore = vec3(val(camObj.props.rotation))

  const stackBefore = undoStackOf().length
  await registry.execute(
    'cameras.setAimTarget',
    {objectId: 'camera:Shot Camera', target: ''},
    ctx(),
  )

  expect(undoStackOf().length).toBe(stackBefore + 1)
  expect(val(camObj.props.aimTarget)).toBe('')
  // 定格朝向 = lookAt(机位, 目标) 的 XYZ 欧拉角;相机按它渲染时
  // 指向目标(看护 no-op 前提:同值守卫看到 persisted==换算结果)
  const frozen = vec3(val(camObj.props.rotation))
  cam.rotation.set(frozen.x, frozen.y, frozen.z)
  cam.updateMatrixWorld(true)
  const forward = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
  const toTarget = new Vector3(0, 0, -5).sub(new Vector3(1, 2, 3)).normalize()
  expect(forward.dot(toTarget)).toBeCloseTo(1, 5)

  studio.undo()
  expect(val(camObj.props.aimTarget)).toBe('anchor:Anchor 1')
  expectVec3Close(vec3(val(camObj.props.rotation)), {
    x: rotationBefore.x,
    y: rotationBefore.y,
    z: rotationBefore.z,
  })
})
