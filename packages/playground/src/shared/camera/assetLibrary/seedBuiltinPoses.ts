// packages/playground/src/shared/camera/assetLibrary/seedBuiltinPoses.ts
/**
 * 随包内置姿势播种(2026-10-02 内置姿势管线):把构建期产物 seedPoses.ts
 * 写进资产库,姿势选择框开箱即有 12 个基础姿势。
 *
 * 与模型播种(seedBuiltinModels)同模式:模块级幂等,失败只告警不阻塞。
 * rig 关联族代表 Y Bot 的模型条目(姿势是 Mixamo 骨架骨向换算产物);
 * 模型播种是异步的,这里轮询等它出现,超时放弃(下回挂载再试——
 * started 只在成功后置位)。
 */
import {getLibrary} from './library'
import type {Library} from './library'
import {seedPoses} from './seedPoses'
import type {ModelEntry} from './types'

const SEED_RIG_MODEL_NAME = 'Y Bot'
const MAX_WAIT_MS = 15000
const RETRY_MS = 500

type Lib = Pick<Library, 'backend' | 'putEntry'>

let started = false

export function seedBuiltinPoses(): void {
  if (started) return
  started = true
  void seedBuiltinPosesInto(getLibrary())
    .then((count) => {
      // 失败(如 Y Bot 始终未播种)允许下次挂载重试
      if (count === 0) started = false
    })
    .catch((err) => {
      started = false
      console.warn('[assetLibrary] 内置姿势播种失败', err)
    })
}

/**
 * 播种核心(可注入,测试直接驱动):返回播种条数,0=未找到族代表模型。
 * 条目 id 稳定(seed-pose-<key>),putEntry upsert 语义,重复播种安全。
 */
export async function seedBuiltinPosesInto(
  lib: Lib,
  opts: {
    retryMs?: number
    maxWaitMs?: number
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<number> {
  const {retryMs = RETRY_MS, maxWaitMs = MAX_WAIT_MS} = opts
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const deadline = Date.now() + maxWaitMs
  let rig: string | undefined
  while (Date.now() <= deadline) {
    const models = (await lib.backend.listEntries('model')) as ModelEntry[]
    rig = models.find((m) => m.name === SEED_RIG_MODEL_NAME)?.rig
    if (rig) break
    await sleep(retryMs)
  }
  if (!rig) {
    console.warn(
      `[assetLibrary] 未找到 ${SEED_RIG_MODEL_NAME} 模型条目,内置姿势跳过播种`,
    )
    return 0
  }
  for (const p of seedPoses) {
    await lib.putEntry({
      id: 'seed-pose-' + p.key,
      kind: 'pose',
      name: p.name,
      rig,
      bones: p.bones,
      createdAt: Date.now(),
    })
  }
  return seedPoses.length
}
