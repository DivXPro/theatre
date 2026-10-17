/**
 * Studio stateEditors 时长适配(2026-10-17,Task 6 初版;同日修正):
 * sequence.setLength 的唯一 stateEditors 通道,与 TransportBar.tsx:152-157
 * 完全同路径(`stateEditors.coreByProject.historic.sheetsById.sequence.setLength`),
 * 把 Studio 内部能力隔离在这一处(spec:sequence.setLength 只能经内部适配层
 * 完成并配套行为测试)。Studio 不可用抛 SCENE_UNAVAILABLE(spec 8.3)。
 *
 * Studio 访问必须用内部 `@dreamerbird/studio/getStudio`(TransportBar 先例):
 * 只有内部 Studio 的事务 api(ITransactionPrivateApi)携带 stateEditors;
 * 公开 TheatreStudio.transaction 的回调 api 只有 set/unset/sequenceProp 等
 * (TheatreStudio.ts:202-209),经 getStudioSync() 拿公开 api 再类型断言出
 * stateEditors 在生产上是 undefined 而抛错——初版即踩此坑。
 */
import type {ISheet} from '@dreamerbird/core'
import getStudio from '@dreamerbird/studio/getStudio'
import {AgentApiError} from './errors'

/**
 * 在单个历史事务里把 sheet 的 sequence 时长改为 length(秒)。
 * length 的正数/有限校验由调用方(命令 validate)在事务之前完成。
 */
export function setSequenceLength(sheet: ISheet, length: number): void {
  const studio = getStudio()
  if (!studio) {
    throw new AgentApiError(
      'SCENE_UNAVAILABLE',
      'Studio 不可用,无法设置序列时长',
    )
  }
  studio.transaction(({stateEditors}) => {
    stateEditors.coreByProject.historic.sheetsById.sequence.setLength({
      ...sheet.address,
      length,
    })
  })
}
