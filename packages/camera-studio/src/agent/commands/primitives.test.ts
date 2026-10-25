import {getProject, types as t, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {globals} from '@dreamerbird/core/globals'
import {PLACEMENTS_REGISTRY_KEY} from '../../PlacementManager'
import type {PrimitiveKind} from '../../primitives'
import {createCameraStudioApi} from '../api'
import {formatSceneObjectId} from '../objectIds'
import {AgentCommandRegistry} from '../registry'
import {createAgentRuntime} from '../runtime'
import {
  registerSceneSheetObject,
  unregisterSceneSheetObject,
} from '../runtime/objectRuntime'
import type {Vec3} from '../types'
import {registerPrimitiveCommands} from './primitives'

let projectSeq = 0

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const POSITION: Vec3 = {x: 0, y: 0, z: 0}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return {promise, resolve}
}

function setup() {
  const project = getProject(`agent-primitives-${++projectSeq}`, {
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
  const sheet = project.sheet('Scene')
  let notifyHistoric: () => void = () => {}
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => undefined,
    subscribeHistoric: (listener) => {
      notifyHistoric = listener
      return () => {}
    },
  })
  const controller = createCameraStudioApi({
    buildRegistry: (currentRuntime) => {
      const registry = new AgentCommandRegistry()
      registerPrimitiveCommands(registry, currentRuntime)
      return registry
    },
  })
  controller.activate(runtime)
  cleanups.push(() => controller.dispose())
  const createPrimitive = jest.fn()
  return {
    api: controller.api,
    controller,
    sheet,
    runtime,
    createPrimitive,
    notifyHistoric: () => notifyHistoric(),
  }
}

function bindCreatePrimitive(
  controller: ReturnType<typeof setup>['controller'],
  createPrimitive: jest.Mock,
  key: string,
  persisted: Promise<void>,
) {
  createPrimitive.mockReturnValue({key, persisted})
  const unbind = controller.bindSceneHandlers({
    createPrimitive: (args: {kind: PrimitiveKind; position: Vec3}) =>
      createPrimitive(args),
  })!
  cleanups.push(unbind)
}

function mountPrimitive(sheet: ISheet, key: string) {
  const registryObj = sheet.object(
    PLACEMENTS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
  registryObj.initialValue = {
    list: JSON.stringify([{key, primitive: 'box', position: POSITION}]),
  }
  const obj = sheet.object(key, {
    position: t.compound({x: t.number(0), y: t.number(0), z: t.number(0)}),
  }) as ISheetObject<any>
  const id = formatSceneObjectId('model', key)
  registerSceneSheetObject(id, obj)
  cleanups.push(() => unregisterSceneSheetObject(id, obj))
}

async function untilCreatePrimitiveCalled(createPrimitive: jest.Mock) {
  for (let i = 0; i < 50 && createPrimitive.mock.calls.length === 0; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  expect(createPrimitive).toHaveBeenCalled()
}

test('api.primitives.create resolves after mounting and persists the primitive entry', async () => {
  const {api, controller, sheet, createPrimitive, notifyHistoric} = setup()
  const mount = deferred()
  bindCreatePrimitive(controller, createPrimitive, 'Box', mount.promise)
  await api.ready

  let resolved = false
  const promise = api.primitives
    .create({kind: 'box', position: POSITION})
    .then((result) => {
      resolved = true
      return result
    })

  await untilCreatePrimitiveCalled(createPrimitive)
  expect(createPrimitive).toHaveBeenCalledWith({
    kind: 'box',
    position: POSITION,
  })
  expect(resolved).toBe(false)

  mountPrimitive(sheet, 'Box')
  notifyHistoric()
  mount.resolve()

  await expect(promise).resolves.toEqual({
    objectId: 'model:Box',
    revision: 2,
  })
  const registryObj = sheet.object(PLACEMENTS_REGISTRY_KEY, {
    list: t.string('[]'),
  })
  expect(JSON.parse(val(registryObj.props.list) as string)).toEqual([
    {key: 'Box', primitive: 'box', position: POSITION},
  ])
})

test('api.primitives.create rejects an unknown kind before any handler call', async () => {
  const {api, controller, createPrimitive} = setup()
  bindCreatePrimitive(controller, createPrimitive, 'Box', Promise.resolve())
  await api.ready

  await expect(
    api.primitives.create({kind: 'cone' as PrimitiveKind, position: POSITION}),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  expect(createPrimitive).not.toHaveBeenCalled()
})
