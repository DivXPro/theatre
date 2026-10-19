# 发布指南（npm stable）

本仓库的 `@dreamerbird` 包通过 GitHub Actions 自动发布到 npm。触发方式是推送版本 tag。

## 发布范围

`scripts/publishablePackages.mjs` 是唯一清单。当前包含 10 个包：dataverse、saaz、core、studio、react、r3f、theatric、browser-bundles、camera-studio、camera-studio-bridge。

标了 `private: true` 的包发布脚本会直接报错，不会静默跳过。

## 发版步骤

1. 决定版本号，手动 bump 对应包的 `package.json`（核心包固定模式共用同一版本；camera-studio / camera-studio-bridge 版本独立演进）。
2. 提交 bump，确认工作区干净。
3. 本地演练（只读，不发布）：

   ```bash
   node scripts/stable-release.mjs --dry-run --tag v1.0.0
   ```

   检查输出的 `publishing` 清单是否符合预期；已存在于 npm 的版本会列入 `skipping`。

4. 打 tag 并推送：

   ```bash
   git tag v1.0.0
   git push origin main --tags
   ```

5. 在 GitHub Actions 的 `Release` 工作流盯结果。流水线：安装 → 全量构建 → typecheck → agent 相关包测试 → 发布。

## 语义保证

- **tag 校验**：tag 必须是 `v主.次.补丁` 且至少匹配一个待发包的版本号，否则工作流直接失败——打错 tag 不会发出任何东西。
- **幂等**：发布前逐一查询 npm，已存在的版本跳过。发布中途失败时修复后重跑同一 tag 即可，已成功的包不会重发。
- **失败止步**：任一包发布失败，工作流失败并列出本次已发布的包。

## 前置配置（一次性）

- 仓库 secret `NPM_TOKEN`：npm 的 Automation 类型 token，需要对 `@dreamerbird` scope 有发布权限。配置方式：`gh secret set NPM_TOKEN` 或仓库 Settings → Secrets。
- npm 上 scoped 包首次发布为 public 由脚本的 `--access public` 处理，无需手动设置。

## 其他发布通道

- **insiders 预发布**：`.github/workflows/release-insiders.yml`（PR 评论 `/release insiders`）。注意：它引用的 `scripts/prerelease.mjs` 目前不存在于本 fork，且使用 buildjet 运行器——该通道在当前仓库处于不可用状态，需要时另行修复。
- 正式发布不使用 insiders 的版本号机制（`-insiders.<hash>` 后缀），stable 版本号永远是干净的 `x.y.z`。

## 本地手动发布（应急）

CI 不可用时的后门：

```bash
cat .github/.yarnrc.publish.yml >> .yarnrc.yml
export NODE_AUTH_TOKEN=<npm token>
node scripts/stable-release.mjs   # 无 --dry-run
```

完成后撤销 `.yarnrc.yml` 的追加（`git checkout -- .yarnrc.yml`），避免 token 配置留在工作区。
