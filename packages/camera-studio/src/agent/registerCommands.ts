/**
 * 全量 Agent 命令注册(2026-10-19,Task 15):按 Task 4–14 落地顺序
 * 注册全部 18 个命令组(spec §9 命令面,71 条命令),供生产会话与
 * 契约测试共用同一个注册入口。
 *
 * 重复命令兜底:registry.register 本身按名拒重(INVALID_STATE),注册
 * 结束后再断言一次清单无重名——任何一个 register 模块被误注册两次
 * (或将来合并模块时漏改名)都在这里立即炸,不带病运行。
 */
import {AgentApiError} from './errors'
import type {AgentCommandRegistry} from './registry'
import type {AgentRuntime} from './runtime'
// Task 4:场景查询与选择(scene.getSnapshot / objects.list / objects.get)
import {registerSceneCommands} from './commands/scene'
import {registerSelectionCommands} from './commands/selection'
// Task 5 + Task 14:静态属性更新(objects.update)与统一删除(objects.delete)
import {registerObjectCommands} from './commands/objects'
// Task 6:sequence 播放/定位/时长 + history 撤销重做
import {registerSequenceCommands} from './commands/sequence'
import {registerHistoryCommands} from './commands/history'
// Task 7:显式关键帧
import {registerKeyframeCommands} from './commands/keyframes'
// Task 8:模型创建 + 资产管理 + 任务查询/取消
import {registerModelCommands} from './commands/models'
import {registerAssetCommands} from './commands/assets'
import {registerJobCommands} from './commands/jobs'
// Task 9:姿势/手势 + 动画
import {registerPoseCommands} from './commands/poses'
import {registerAnimationCommands} from './commands/animations'
// Task 10:相机 + 锚点
import {registerCameraCommands} from './commands/cameras'
import {registerAnchorCommands} from './commands/anchors'
// Task 11:路径预设/控制点/编辑会话
import {registerPathCommands} from './commands/paths'
// Task 12:视图 + UI + 项目导出
import {registerViewCommands} from './commands/view'
import {registerUiCommands} from './commands/ui'
import {registerProjectCommands} from './commands/project'
// Task 13:视频导出任务
import {registerExportCommands} from './commands/exports'

/**
 * 注册全部 Agent 命令。每个执行代次一份注册表(命令闭包绑定该代次的
 * runtime facade:handlers 是代次级 live 视图,assertCurrent 按代次判定),
 * 换代由调用方重建。
 */
export function registerAllAgentCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  // Task 4
  registerSceneCommands(registry, runtime)
  registerSelectionCommands(registry, runtime)
  // Task 5 + Task 14
  registerObjectCommands(registry, runtime)
  // Task 6
  registerSequenceCommands(registry, runtime)
  registerHistoryCommands(registry, runtime)
  // Task 7
  registerKeyframeCommands(registry, runtime)
  // Task 8
  registerModelCommands(registry, runtime)
  registerAssetCommands(registry, runtime)
  registerJobCommands(registry, runtime)
  // Task 9
  registerPoseCommands(registry, runtime)
  registerAnimationCommands(registry, runtime)
  // Task 10
  registerCameraCommands(registry, runtime)
  registerAnchorCommands(registry, runtime)
  // Task 11
  registerPathCommands(registry, runtime)
  // Task 12
  registerViewCommands(registry, runtime)
  registerUiCommands(registry, runtime)
  registerProjectCommands(registry, runtime)
  // Task 13
  registerExportCommands(registry, runtime)

  const names = registry.describe().commands.map((command) => command.name)
  if (new Set(names).size !== names.length) {
    throw new AgentApiError('INVALID_STATE', '命令注册表存在重复命令名')
  }
}
