# AI 开发工作流（AI Dev Workflow）

> 本文是**唯一**的 AI 协作流程入口，复用并补充 `AGENTS.md` / `ROADMAP.md` / `CURRENT.md` / `PROGRESS.md`，不再新建重复的记忆文件。
> 工具真实安装状态见本地盘点报告 `reports/ai-tool-inventory/INVENTORY.md`（本机实测，非宣传页）。

## 0. 角色与工具职责（以真实能力为依据）

| 工具 | 角色 | 何时用 | 边界 |
| --- | --- | --- | --- |
| **DSH** | 主协调 / 项目理解 / 跨模块实现 / 执行与验收 | 默认主力；需要理解多模块、跑命令、验收时 | 不越权改供应商/凭据 |
| **Magpie** | 模型与供应商路由 / 配额 / 多 Agent 配置管理 | 切换模型、额度 failover、统一 provider | 是路由/配置层，不负责编码编排 |
| **Cursor** | 交互式开发 / UI 调试 | 前端交互、可视调试 | 一个任务只做只读审查或独立 worktree |
| **Codex / OpenCode / Pi** | 独立实现 / 第二意见 | 需要并行实现或复核时 | 必须在独立 worktree，避免与主写入者冲突 |
| **Git worktree** | 代码任务隔离 | 任何会写文件的改动 | 见 §3 |
| **Orca** | 独立服务 / 容器 / 运行实例 | 仅在需要独立运行环境时 | 不用于普通改码 |
| **CDP 真实界面回归（run-ui-regression.cjs）** | 浏览器/界面交互与回归验收 | 前端变更验收 | 单命令 `npm run test:ui`，驱动真实 Electron+CDP；Playwright 浏览器二进制缺失，暂不需要 |
| **GitHub Actions / CI** | 自动化质量门禁 | 提交/合并前 | 新增 `.github/workflows/ci.yml`（typecheck+unit） |
| **Paseo** | 候选控制台 | 先验证再采用 | 见 §7，未纳入主流程前不接入凭据 |

**铁律：一个任务只能有一个主要写入者**；其他 Agent 默认只读审查，或在**独立 worktree** 工作。绝不让两个 Agent 同时改同一工作目录。

## 1. 任务如何进入工作流

1. 用户提出需求 → 主 Agent（DSH）先**只读理解**：读 `AGENTS.md`、`client/开发说明.md`、`CURRENT.md`、`ROADMAP.md`、`PROGRESS.md` 与相关代码。
2. 产出 3 行以内的执行计划（范围 / 涉及模块 / 验收方式）；涉及新范围先确认，再进入实现。
3. 记录基线：`git status --porcelain`、`git rev-parse HEAD`、`git worktree list`（写仓库前**必须**先记录）。
4. 落实现：默认在**独立 worktree + 独立分支**（§3）。

## 2. 主力与辅助 Agent 的选择

- 单模块、需本项目深上下文：**DSH 主力**。
- 需要第二实现/第二意见：Codex / OpenCode / Pi，**各自独立 worktree**，产出后由 DSH 复核合并。
- 前端 UI 调试：Cursor（只读或独立 worktree）。
- 模型/额度问题：先经 Magpie 排查，不改项目凭据。

## 3. 何时使用独立 worktree 与 Orca

- **worktree**：任何会写文件的代码改动都用。示例：`git worktree add ../OpenBidKit_Yibiao-<topic> -b <type>/<topic> HEAD`；完成后 `git worktree remove`。
- **Orca**：仅当任务需要独立服务/容器/运行实例（如并行跑独立后端、隔离依赖环境）时参与；普通改码**不用**。

## 4. 测试 → 审查 → 构建 → 合并 顺序

1. **类型检查**：`cd client && npm run typecheck`（= `tsc --noEmit`）。
2. **单元测试**：`npm run test:unit`（Electron 运行时 `ELECTRON_RUN_AS_NODE=1` 跑全部 `*.test.cjs`，另用 node 跑 `src/**/*.test.mjs`；当前 **43+2=45 文件 / 334 用例**）。
3. **e2e**：`npm run test:e2e`（**清除** `ELECTRON_RUN_AS_NODE`，真实 GUI 主进程，三条脚本）。
4. **真实界面回归**：`npm run test:ui`（启动真实 Electron GUI，CDP 驱动真实点击，回读 SQLite，输出 `report.json` + 截图，17 条断言；GitHub `ui-regression` 工作流等价）。
5. **一键**：`npm run verify`（= typecheck + unit + e2e + ui）。
6. **独立复核**：由未参与实施的 Agent / 人复核；对照 `ROADMAP.md` 门禁，需 `DECISIONS.md` + `TEST_EVIDENCE.md` 原始输出。
7. **构建**：`npm run build`（tsc + vite）；打包 `npm run dist:win`。
8. **合并**：通过门禁后由主写入者合并；不推无关改动。

## 5. 记忆与进度更新

- 进度写 `PROGRESS.md` / `CURRENT.md`；重要决策写 `DECISIONS.md`；**交付证据写 `TEST_EVIDENCE.md`（贴原始输出，不口头概括）**。
- 不新增重复记忆文件；需要时在既有文件增量更新。

## 6. 失败、回滚与未解决问题

- **回滚**：worktree 改动未合并前 `git worktree remove <path> --force`；分支删除 `git branch -D <branch>`。**禁止**在未备份时对主工作树 `reset --hard` / `clean -fd`。
- **失败留证**：保留失败命令、原始 stdout/stderr、退出码；不隐瞒 SKIP 项。
- **未知项**：登记到本节或 `KNOWN_ISSUES.md`，标 已验证 / 文档声称 / 尚未验证。
- 当前已知缺口：Playwright 浏览器二进制未安装（`ms-playwright` 缺失）；`licenseService/updateService/pluginService` 与 26 个 IPC 覆盖低；真实模型/真实解析用桩；打包态未自动化；CI 尚未在真实远程运行（无远程工作流环境，且本地分支含 109 个未发布的既有提交，按边界不推送）。
- 应用运行期会请求远程公告/更新：`client/src/shared/remoteNotice.ts:1` 指向 `https://analytics.agnet.top/notice`，`UpdateNotifier.tsx:128` 轮询。UI 回归用 `--host-resolver-rules=MAP * ~NOTFOUND` 隔离网络，保证不弹线上公告（含赞助商内容）、结果可重复；该隔离只影响测试进程，不改应用代码。

## 7. Paseo（候选，未纳入主流程）

- 官方稳定版 v0.13.2 支持 Windows / Android，原生支持 Codex / OpenCode / Pi；**无官方第一方 DSH provider**（社区插件 geoqiao/deepseek-harness beta、Jecvay/paseo-dsh-direct）。
- 采用前需在**独立测试仓库、无敏感数据、不导入 Magpie 凭据**的条件隔离试用；不得改 DSH/Web/QQ-IM/全局配置。

## 8. 每次交付必须提供的实证

- `git rev-parse HEAD`、`git status --porcelain`、变更文件清单。
- 关键命令与**原始输出**（typecheck / 单测通过数 / e2e PASS·FAIL·SKIP / 构建 exit code）。
- 未完成项、风险与准确回滚方式。
- 不用星数/宣传/口头报告代替本机证据。
