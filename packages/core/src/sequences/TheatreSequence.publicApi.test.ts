import {getProject} from '@dreamerbird/core'
import {globals} from '@dreamerbird/core/globals'

/**
 * 公开 API 透传回归:ISequence.closestGridPosition 必须在 TheatreSequence
 * 包装器上真实存在(摆姿势会话挂载链依赖它;曾经靠 as-unknown 局部断言
 * 骗过类型检查、运行时直接崩)。默认网格 = 30 sub-units/unit,步长 1/30,
 * 与 theatre 写关键帧贴的网格是同一个。
 */
test('sheet.sequence.closestGridPosition 是函数且吸附到默认网格', () => {
  const project = getProject('test-seq-closest-grid-position', {
    state: {
      definitionVersion: globals.currentProjectStateDefinitionVersion,
      sheetsById: {},
    },
  })
  const sheet = project.sheet('Sheet')
  const sequence = sheet.sequence

  expect(typeof sequence.closestGridPosition).toBe('function')
  // 默认 30 sub-units/unit → 网格步长 1/30
  expect(sequence.closestGridPosition(2.001)).toBe(2)
  expect(sequence.closestGridPosition(2.017)).toBe(2.033) // 60.51 → 61 格
  expect(sequence.closestGridPosition(0.5)).toBe(0.5) // 恰好落在格点上
  expect(sequence.closestGridPosition(0)).toBe(0)
})
