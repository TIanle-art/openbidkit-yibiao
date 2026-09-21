# Regression Report V2

## 自动化验证

| 验证 | 结果 |
|---|---|
| Electron 全部 `*.test.cjs` | 39 passed / 0 failed |
| Bid Planning + Evidence 新增/定向用例 | 26 passed / 0 failed（包含于 39） |
| Fake RAG 集成链路 | PASS |
| TypeScript `tsc --noEmit` | PASS |
| Vite production build | PASS |
| Electron native smoke | PASS（Electron 41.10.2 / Node 24.18.0 / ABI 145） |
| SQLite v28 → v31 migration | PASS |
| SQLite foreign key check | PASS |

Vite 仅输出仓库已知的 chunk >500KB 警告，命令退出码为 0。Electron test 输出 macOS `task_name_for_pid` 代码签名日志，不影响 39 个用例通过。

## 覆盖的新能力

- project classification 及 secondary 规范化
- 招标设备表回退提取
- 设备类技术主题深化和来源保留
- outline exact/semantic coverage
- <80% 旧目录失败复现
- required table detection and template-column semantic fill
- unknown parameter and confirmed-value fill
- parameter source priority
- Section Brief
- 1–4 query builder
- scope selection
- Evidence Pack ranking, threshold, budget and dedup
- parameter conflicts, duplicate sections, missing tables and unsupported claims
- Tender → BidPlan → Outline → Brief → Retrieval → Generate fake integration
- SQLite v31 迁移与 Bid Plan/表格/Registry/Quality/topic IDs 往返

## 真实工作流回归

| 项目 | 结果 | 证据 |
|---|---|---|
| 人工编辑保存 | PASS | 写入 `BID-PLAN-V2` 标记后重载保留 |
| 局部重生成 | PASS | 重生成另一章后，人工标记章逐字未变 |
| DOCX 生成 | PASS | 65KB，不是空文件 |
| DOCX ZIP/OOXML | PASS | `unzip -t` 无错 |
| Word headings | PASS | H1=8, H2=18, H3=56 |
| Word tables | PASS | 16 |
| 逐页视觉渲染 | UNVERIFIED | 本机无 LibreOffice/`soffice` |

## 兼容性

- v31 是增量迁移，没有删除旧列或旧表。
- 旧项目没有 `technical_topic_ids` 时使用语义 coverage fallback。
- 仍使用原有 outline/content store、章节编辑和 export service。
- preload / IPC 公开面未增加新 Node 访问权限。

## Git 状态

按任务要求执行 `git status --short --branch`，但当前目录没有 `.git`：

```text
fatal: not a git repository (or any of the parent directories): .git
```

因此本报告不声称“工作树干净”或“已 commit”。
