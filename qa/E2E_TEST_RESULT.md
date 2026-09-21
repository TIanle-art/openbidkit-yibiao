# 全流程 E2E 测试结果（E2E_TEST_RESULT）

> 以"真实招标 PDF → 完整标书 → DOCX"为准，headless Electron 驱动真实 services 实测。

| 步骤 | 结果 | 说明 |
|---|---|---|
| 创建项目 | PASS | 打开技术方案工作区即创建；导入招标文件后创建成功 |
| 上传招标文件 | PASS | 导入真实《招标书.pdf》，合并为 `tender.md`（77800 字） |
| 等待解析 | PASS | `bid-analysis` task status=success |
| 复核信息 | PASS | `projectOverview` 完整准确（项目名/编号/预算1106.2580万/工期2个月/交货地点） |
| 生成目录 | PARTIAL | aligned 模式生成 6 个一级+9 叶，但技术分支偏薄（见 OUTLINE 报告）；期间修好 agent 卡死 |
| 编辑目录 | UNTESTED | 未测目录结构的增删/移动/重命名（本轮聚焦正文编辑） |
| 准备知识库 | PASS | outline 任务成功绑定 `reference_knowledge_document_ids`（26 条知识条目） |
| 生成章节 | PARTIAL | 4 个 ai-generate 章节生成，质量高；技术偏离表/供货清单等模板章节为空 |
| 编辑章节 | PASS | 对 6.1.1 追加人工段并保存，重载完整保留 |
| 重新生成章节 | PASS | 对 6.1.2 独立重生成（23s），按指令重写，未覆盖 6.1.1 |
| 复核整书 | PARTIAL | 一致性审计运行；全文人工一致性/重复未逐项比对（见一致性与重复控制） |
| 导出 DOCX | PASS | 成功导出 31.6KB，Heading1/2/3、8 表、378 段，合法 Word |

**全链路判定：PARTIAL**（所有关键环节可跑通并产出真实 Word，但内容覆盖度不足、模板类章节为空、部分环节（目录编辑/预览/PDF/一致性逐项）未测或未完成。）

## 流程阻力观察（真实体验/代码层面）
- 状态清楚：任务有 status/progress/log，后台任务可恢复（task 持久化到 DB）→ 好。
- 长任务进度：目录/正文都有多阶段 progress 消息 → 好。
- 失败原因可见：任务 error 字段保留（如全局事实 "上次全局事实设定未完成"）→ 好。
- **阻力点**：
  1. 目录生成 Agent 会在关键决策处 `ask-user` 等待确认；默认 `agent_auto_answer_enabled=false` 会**长时间静默等待**，用户（或自动化）若不知情会误以为卡死（实测近 25 分钟）→ 体验差。
  2. `exportWord` 弹出系统"另存为"对话框；headless 下无 UI 会挂起（真实桌面正常）。
  3. 生成结果需到对应页面查看；若自动切换到后台任务页用户能找到，但入口依赖页面状态。
  4. 模板填充类章节（技术偏离表等）内容为空，需额外"投标模板提取"步骤或手动填写，用户易得出"没生成"的观感。

## 异常恢复（基于任务模型，未全部实测）
- 单章节生成失败：任务按 node 独立生成，可单独 `retryFailedSections`/`targetItemId` 重生成 → 支持。
- LLM 暂时失败：任务进入 error，可重新 `startContentGeneration` 续跑 → 支持（paging/resume 语义）。
- RAG 失败：正文生成读取绑定文档条目；若无绑定/条目为空则按招标+模型知识生成，未见明显"无依据编造企业事实"。→ 没有专门 error 提示 RAG 失败，属于可改进点。
