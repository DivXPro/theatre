/**
 * Studio stateEditors 时长适配(2026-10-17,Task 6):sequence.setLength 的
 * 唯一 stateEditors 通道,与 TransportBar.tsx 的 commitLength 完全同路径
 * (`stateEditors.coreByProject.historic.sheetsById.sequence.setLength`),把
 * Studio 内部能力隔离在这一处(spec:sequence.setLength 只能经内部适配层
 * 完成并配套行为测试)。Studio 不可用抛 SCENE_UNAVAILABLE(spec 8.3)。
 */
import {getStudioSync} from '@dreamerbird/core'
import type {ISheet, SheetAddress} from '@dreamerbird/core'
import {AgentApiError} from './errors'

/**
 * studio 公开 ITransactionAPI 不暴露 stateEditors(Studio 内部能力);
 * 按 TransportBar 的实际用法声明本适配需要的最小形状。
 */
type TransactionApiWithStateEditors = {
  stateEditors: {
    coreByProject: {
      historic: {
        sheetsById: {
          sequence: {
            setLength(args: SheetAddress & {length: number}): void
          }
        }
      }
    }
  }
}

/**
 * 在单个历史事务里把 sheet 的 sequence 时长改为 length(秒)。
 * length 的正数/有限校验由调用方(命令 validate)在事务之前完成。
 */
export function setSequenceLength(sheet: ISheet, length: number): void {
  const studio = getStudioSync()
  if (!studio) {
    throw new AgentApiError(
      'SCENE_UNAVAILABLE',
      'Studio 不可用,无法设置序列时长',
    )
  }
  studio.transaction((api) => {
    const {stateEditors} = api as typeof api & TransactionApiWithStateEditors
    stateEditors.coreByProject.historic.sheetsById.sequence.setLength({
      ...sheet.address,
      length,
    })
  })
}
