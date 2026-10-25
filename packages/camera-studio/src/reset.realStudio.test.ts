/*
 * @jest-environment node
 */
import {types as t, val} from '@dreamerbird/core'
import {globals} from '@dreamerbird/core/globals'
import {getCoreRafDriver} from '@dreamerbird/core/coreTicker'
import getStudio from '@dreamerbird/studio/getStudio'
jest.doMock('jose', () => ({decodeJwt: jest.fn()}))

let bootstrap: typeof import('./bootstrap')
let renderSpy: jest.SpyInstance
beforeAll(async () => {
  bootstrap = await import('./bootstrap')
  renderSpy = jest.spyOn(getStudio().ui, 'render').mockImplementation(() => {})
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

test('reset restores a same-named project from its new initialState with real core/studio', async () => {
  const projectId = 'camera-studio-reset-real'
  const first = await bootstrap.initCameraStudio({
    project: projectId,
    storage: false,
    state: {initialState: sceneState(1), onStateChange: () => {}},
  })
  const firstProject = first.sceneProps.project
  await firstProject.ready
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
