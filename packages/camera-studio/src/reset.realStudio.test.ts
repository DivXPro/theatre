/*
 * @jest-environment node
 */
import {getStudioSync, types as t, val} from '@dreamerbird/core'
import {globals} from '@dreamerbird/core/globals'
import {getCoreRafDriver} from '@dreamerbird/core/coreTicker'
import getStudio from '@dreamerbird/studio/getStudio'
jest.doMock('jose', () => ({decodeJwt: jest.fn()}))

let bootstrap: typeof import('./bootstrap')
let renderSpy: jest.SpyInstance
beforeAll(async () => {
  bootstrap = await import('./bootstrap')
  const {default: UI} = await import('@dreamerbird/studio/UI/UI')
  renderSpy = jest.spyOn(UI.prototype, 'render').mockImplementation(() => {})
})
afterAll(() => {
  renderSpy.mockRestore()
  getCoreRafDriver().stop?.()
})

function sceneState(value: number) {
  return {
    definitionVersion: globals.currentProjectStateDefinitionVersion,
    sheetsById: {
      Scene: {
        staticOverrides: {byObject: {Only: {value}}},
        sequence: {
          type: 'PositionalSequence',
          length: 10,
          subUnitsPerUnit: 30,
          tracksByObject: {},
        },
      },
    },
  } as never
}

test('opens after loading host state and reopens with fresh state in the shared Studio', async () => {
  const projectId = 'camera-studio-reset-real'
  const initialState = await new Promise<unknown>((resolve) => {
    setTimeout(() => resolve(sceneState(1)), 500)
  })
  expect(getStudio() === undefined).toBe(true)

  const first = await bootstrap.initCameraStudio({
    project: projectId,
    storage: false,
    state: {initialState, onStateChange: () => {}},
  })
  const firstProject = first.sceneProps.project
  await firstProject.ready
  const studio = getStudioSync(true)
  expect(studio).toBe(getStudio().publicApi)
  expect(
    val(
      firstProject.sheet('Scene').object('Only', {value: t.number(0)}).props
        .value,
    ),
  ).toBe(1)
  await bootstrap.disposeCameraStudio(first)
  await bootstrap.resetCameraStudio()

  const second = await bootstrap.initCameraStudio({
    project: projectId,
    storage: false,
    state: {initialState: sceneState(2), onStateChange: () => {}},
  })
  const secondProject = second.sceneProps.project
  await secondProject.ready
  expect(getStudioSync(true)).toBe(studio)
  expect(secondProject).not.toBe(firstProject)
  expect(
    val(
      secondProject.sheet('Scene').object('Only', {value: t.number(0)}).props
        .value,
    ),
  ).toBe(2)

  await bootstrap.disposeCameraStudio(second)
  await bootstrap.resetCameraStudio()
})
