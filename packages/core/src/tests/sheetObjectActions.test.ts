import {privateAPI} from '@toy-box/core/privateAPIs'
import {getProject} from '@toy-box/core'
import {globals} from '@toy-box/core/globals'

test('sheet.object 重复调用带 actions 会更新模板上的 actions', () => {
  const project = getProject('test-sheet-obj-actions', {
    state: {
      definitionVersion: globals.currentProjectStateDefinitionVersion,
      sheetsById: {},
    },
  })
  const sheet = project.sheet('Sheet')

  const config = {n: 0}
  const obj = sheet.object('obj', config)
  const template = privateAPI(obj).template
  expect(template._temp_actions).toEqual({})

  const actionA = jest.fn()
  sheet.object('obj', config, {
    __actions__THIS_API_IS_UNSTABLE_AND_WILL_CHANGE_IN_THE_NEXT_VERSION: {
      动作A: actionA,
    },
  })
  expect(Object.keys(template._temp_actions ?? {})).toEqual(['动作A'])

  sheet.object('obj', config, {
    __actions__THIS_API_IS_UNSTABLE_AND_WILL_CHANGE_IN_THE_NEXT_VERSION: {
      动作B: jest.fn(),
    },
  })
  expect(Object.keys(template._temp_actions ?? {})).toEqual(['动作B'])
})
