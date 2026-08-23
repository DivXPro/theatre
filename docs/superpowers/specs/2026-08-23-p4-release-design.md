# P4 发布设计:Theatre.js 1.0 发布就绪

> 状态:已确认设计,待 writing-plans 出实施计划。
> 上级设计:[2026-08-21-theatre-1.0-release-design.md](2026-08-21-theatre-1.0-release-design.md) 的「P4 发布」段。

## 目标与边界

把仓库推进到「**1.0.0 发布就绪**」状态:文档(CHANGELOG/迁移指南)定稿、compat-tests 在新 scope 下本地验证通过、版本对齐 1.0.0、发布脚本可调用。**本次不实际 publish 到 npm**——出口标准是发布就绪,不是已发布。

关键背景:fork 在 main 分支开发(不用 worktree),npm scope 已全部改为 `@toy-box/*`,版本仍停在 `0.7.0`。上游 CHANGELOG 停在 0.4.5,fork 的 P0-P3 改动尚未记录。

### 已确认的关键决策(brainstorming 结论)

| 决策点 | 结论 |
|---|---|
| 发布策略 | 先 rc 后正式;rc 用 verdaccio/pack tarball 本地做,不打 npm |
| 发布执行 | **发布就绪但不发**:脚本写成可调用形态,本次不 publish、不打 npm |
| CHANGELOG | 单条 `1.0.0` 综合条目,迁移细节进迁移指南 |
| compat-tests | 本地验证(静态核对 + 代表性 fixture 跑通);CI 的 `if: false` 暂不解禁 |
| 迁移指南 | 两段式:用户迁移 + 内部架构说明 |
| 任务拆分 | 按交付物拆 4 单元(W1-W4),W1/W2/W3 独立可并行,W4 依赖 W3 |
| 版本对齐 | 9 个 `0.7.0` 可发布包 bump `1.0.0`;`app`/`sync-server` 跟上但不发;`*-dev` 包不动 |

## 总体架构

四个工作单元按交付物拆,各自独立可测:

```
W1 文档 ──────────────┐
W2 compat-tests 适配 ─┼─ 互不依赖,可并行
W3 版本对齐 ──────────┘
        │
        ▼ (W4 依赖 W3:版本定了才能打 tarball)
W4 发布脚本 + dry-run dogfood
```

## W1 文档

### CHANGELOG.md(现有文件顶部插入,保留 0.4.5 及以前历史)

单条 `## 1.0.0` 综合条目,按用户可见面分组,每条一行并指向迁移指南对应节,不展开代码:

- **Breaking**:`@theatre/*` → `@toy-box/*` scope 改名;`init()` 流程定稿(`getStudio()` 前必须先 `init()`)
- **协作**:自托管 sync-server minimal loop(`AUTH_DISABLED`)、直连 ws、断线徽标
- **内部**:saaz 同步引擎桥、StudioStore 后端可选

### MIGRATION.md(新建,根级)

两段式:

- **Part 1 用户迁移**:scope 改名(install/导入 diff 示例)、`init()` 流程变化(before/after)、被删/改的 API 清单 + 替代、常见问题
- **Part 2 内部架构说明**(面向 fork 贡献者):saaz 桥、StudioStore 后端可选、直连 ws 分流、`connectionStatus`/ephemeralAtom、鉴权可关

### README.md

不动现有 0.4.5 说明(避免范围蔓延),只在顶部加一句指向 MIGRATION.md。

**出口标准**:文档 lint 过、内部链接有效。

## W2 compat-tests 本地适配

现状:fixtures 已是 `@toy-box` scope + `0.0.1-COMPAT.1` 占位版本;CI 里 Compatibility-Tests job `if: false` 禁用(注释「skip until the new API is ready」,现 API 已 ready)。

**步骤**:
1. 静态核对:确认 8 个 fixtures 的 import/依赖指向 `@toy-box`、无残留 `@theatre`
2. 跑 `yarn test:compat:install`(verdaccio 本地发 workspace 包 → 装进 fixtures),验证发布链路在新 scope 下通
3. 跑代表性 fixture:`basic-vite4`(纯 core+studio,最快)+ `r3f-react18`(含 r3f,覆盖三栈)
4. 若因 `init()` 定稿 / 新 API 挂 → 改 fixture 源码适配(这是真适配工作)

**不做**:跑全部 8 个、解禁 CI(`if: false` 保持)、清 fixtures 里的 `.cache` 垃圾。

**出口标准**:代表性 fixture(`basic-vite4` + `r3f-react18`)本地绿。

## W3 版本对齐

**方案**:9 个 `0.7.0` 可发布包(`core`/`dataverse`/`studio`/`r3f`/`react`/`utils`/`saaz`/`theatric`/`browser-bundles`)统一 bump `1.0.0`;`app`/`sync-server`(0.1.0)升至 `1.0.0` 但保持 private 不发;`benchmarks`/`playground`/`dataverse-experiments`(已是 `1.0.0-dev`)不动。

内部依赖用 `workspace:*` 协议,bump 版本号无需改引用。

**出口标准**:`yarn typecheck` + 全量 jest 全绿;包名/版本一致(脚本校验)。

## W4 发布脚本 + dry-run dogfood

**发布脚本** `scripts/release.ts`(`yarn tsx` 跑),默认 dry-run:

1. 跑 build + 全量 test
2. 校验全包版本一致且 = `1.0.0`
3. `yarn workspaces foreach pack` 出 tarball 到 `dist/tarballs/`
4. 默认只到打包;publish 逻辑写好但被 `--dry-run` 默认挡住,要真发需显式 `--publish`(本次不触发)

**dry-run dogfood**(本地版 rc,不 publish):用 verdaccio 本地 registry 或直接装 tarball 到干净工程,验证能 import 核心 API(`getProject`/`init`/`getStudio`)并跑通最小流程。

**出口标准**:发布脚本 dry-run 跑通;tarball 装进干净工程能 import 核心 API。

## 全局约束

- 不实际 publish 到 npm(本次)
- CI 的 Compatibility-Tests `if: false` 保持禁用
- `benchmarks`/`playground`/`dataverse-experiments` 版本不动(保持 `1.0.0-dev`)
- 内部依赖 `workspace:*` 不改
- 用户 WIP(`examples/*`、`.claude/`、`AGENTS.md`、`opencode.json`、`.ignore`、`.mcp.json`、`examples/dom-cra/src/react-app-env.d.ts`)不进 commit;显式 per-file `git add`,不用 `git add -u`

## 出口标准(整个 P4)

W1-W4 全部达成 = 1.0.0 发布就绪:文档定稿、compat-tests 本地验证通过、版本对齐 1.0.0、发布脚本可一键复跑(dry-run)。真正 publish 留待用户另行拍板。
