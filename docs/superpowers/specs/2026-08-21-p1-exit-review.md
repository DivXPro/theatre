# P1 出口评审记录

日期:2026-08-21
计划:docs/superpowers/plans/2026-08-21-theatre-1.0-p0-p1.md(Tasks 1-13 全部完成)
范围:P0(基线/改名/fork 身份)+ P1(单人可用性关键路径)

## 出口标准验证

| 标准 | 结果 | 证据 |
|---|---|---|
| 1. 刷新不丢状态 | ✅ | Task 12 集成测试(packages/studio/src/integration-tests/persistence.test.ts):编辑 → 模拟 reload(同 IDB 名重建全栈)→ 状态存活;mutation check(错库名→失败)证明断言真实;确定性 prism 等待,无 flake。**另加 initRestoreGate.test.ts 回归防护**(见下"最终审查阻塞项") |
| 2. 零网络依赖 | ✅ | `grep -rn "new AppLink\|new SyncServerLink\|new Auth" packages/studio/src` 三处全部在 `serverUrl !== undefined` 分支内(Studio.ts:213/224/243);packages/studio/src 下 `app.theatrejs.com` / `updates.theatrejs.com` / `checkForUpdates` 零匹配(Task 10 审查实证) |
| 3. undo/redo 正常 | 🟡 部分 | jest 全绿(29 套件/269 测试)含既有 undo/redo 覆盖;**playground 手动冒烟待用户执行**(见下) |

## 回退触发器检查

**未触发。** 触发需要:(1) P1 实现类任务全部完成 — 已满足;(2) 三个出口标准在约 2 个修复里程碑后仍不能全部达成 — 自动化标准全部通过,无需修复里程碑。手动冒烟结果若暴露问题,按 spec 进入修复里程碑计数,仍不自动回退。

## 最终全分支审查阻塞项与修复(2026-08-22 收口)

**阻塞项:restore 与 initialiseProjectState 竞态。** `Studio._init` 不等 saaz 恢复完成就置 `initialized`;`Project.attachToStudio` 在 `delay(0)` 后读 store,若恢复落后,排队的 `setProjectState` 会在恢复落地后重放并把恢复出的项目覆盖为空 — 真实浏览器刷新下概率性违反出口标准 1。T12 测试绕过 Studio/Project 层因此不可见。

**修复(commit `0a72ebb`):**
1. `StudioStore` 新增 `ready` getter,返回 `_saaz.ready`(即 SaazFront 恢复完成的 `_initializedPromise`)。
2. `Studio._init` 在置 `initialized` 前 `await this._store.ready`。
3. 回归测试 `packages/studio/src/integration-tests/initRestoreGate.test.ts`:`jest.doMock`(jest-esbuild 不提升 `jest.mock`,必须运行时注册)+ `jest.resetModules` + `DelayedFrontMemoryAdapter`(30ms/事务)+ `SharedBackMemoryAdapter`(单例),确定性拉大恢复与 initialized 的差距。

**验证:**
- 红绿验证:移除门 → 红(`Expected: "restored"` / `Received: undefined`);恢复门 → 绿(618ms)。
- 全量 30 套件 / 270 测试通过,typecheck exit 0。
- scoped 复查(sonnet)结论 **APPROVED_WITH_NITS**,3 个 nit 均非阻塞:① 恢复抛错时 initialized 永久挂起(强化既有 P2 项 IDB 失败降级);② 未等 backend 首轮同步(仅云/多 tab 相关 → P3);③ 范围确认。

## 过程中修复的 saaz 真实 bug(超出计划原文,均经审查 revert 实证)

1. FrontStorage.getMostRecentlySyncedSessionState 缺 await(cached 恢复路径此前是死代码)
2. FrontMemoryAdapter.getAll 返回已吊销 immer proxy
3. _loadClosedSessions 接管会话时硬编码 lastIncorporatedPeerClock: null(双重应用已确认更新)
4. getAllExistingSessionIds 读错 key(崩溃会话从未被发现)
5. _reflectOptimisticUpdatesToStorage 的 pluck 方向反了(崩溃丢数据 + acked 更新泄漏)
6. SaazBack 完全不落盘(无 BackStorage 持久化)

## 遗留项(均不阻塞 P1,带往后续阶段)

- SaazBack save 为 fire-and-forget、load/save 拒绝未处理 → 最终全分支审查定夺是否序列化
- 会话锁 unlock 从未调用(可能是持锁至 tab 关闭的设计意图)→ 最终审查定夺
- IDB adapter 无 close()(jest open-handle 警告)
- teardown 期 in-flight reflection 的 console.error
- node 环境无 navigator.locks,崩溃恢复路径(未推送更新的接管)无集成测试覆盖
- updateChecker 死 UI 残留 → P2/P4 清理
- clearPersistentStorageFor 的 deleteDB 无 blocked 处理 → 文档注明调用时机

## 手动冒烟(用户执行)

```
yarn playground
# 浏览器打开 playground,选择 dom-basic 场景:
# 1. 编辑几个属性(如拖拽改数值)
# 2. Cmd+Z / Cmd+Shift+Z 确认 undo/redo
# 3. 刷新页面,确认编辑保留
# 4. DevTools Network 面板确认无任何外部请求(无 app.theatrejs.com / updates.theatrejs.com)
```

## 下一步

P2(API 稳定化 + 0.7.x state fixture 迁移 + theatric 审查)、P3(协作最小闭环)、P4(发布)各自单独立计划。
