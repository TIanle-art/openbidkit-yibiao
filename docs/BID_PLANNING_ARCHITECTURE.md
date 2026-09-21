# Bid Planning 与证据驱动生成架构

## 目标与边界

本次升级保留原有招标解析、目录编辑、章节持久化、局部重生成和 Word 导出链路，只在招标解析与目录之间增加 Bid Planning 中间层，并将其向后传递到章节检索和生成。

```text
Tender Markdown
  → Bid Analysis
  → Bid Plan（一次 structured LLM）
  → Parameter Registry + Required Response Tables
  → Outline（格式骨架 + 技术主题 + 评分点 + 项目类型）
  → Coverage Check
      └─ < 90% 时最多修正一次；修正后 < 80% 失败
  → Section Brief
  → 1–4 Scoped Queries
  → Top-K / Threshold / Dedup / Budget
  → Evidence Pack
  → Section Generation
  → Full-document Quality Check
  → DOCX
```

## Bid Plan

`electron/services/bidPlanningService.cjs` 负责一次性从全文和已解析事实中生成规划。其核心字段为：

- `project_type`：支持 `equipment_procurement` / `goods_procurement` / `engineering` / `service` / `software_it` / `mixed`，设备供货且需安装的项目可将 `installation_service` 作为副类型。
- `procurement_targets`：设备或服务标的、数量、单位和来源。
- `technical_topics`：按专业主题聚类多个 requirement，保留 `source_refs`、重要性、建议章节、证据类别和检索关键词。
- `parameter_candidates`：仅记录招标要求，初始投标值始终是 `UNKNOWN`。
- `required_tables`：本期支持技术参数响应表、技术偏离表和供货范围表，保留招标模板标题、列顺序和来源。
- `evaluation_topics` / `proposal_parts` / `unknowns`：分别提供评分强调、文件分册和未确认事实。

项目分类不只用于展示：它与 technical topics 共同作为目录专业结构和章节检索 scope 的输入。

## 目录覆盖

每个目录节点可持久化 `technical_topic_ids`。覆盖计算先使用 ID 精确对应；为兼容旧项目目录，没有 ID 时再使用标题、描述和关键词相似度判断 `covered` / `partial` / `missing`。

```text
coverage = (covered + 0.5 × partial) / total × 100
```

响应文件格式仍是强约束骨架，但不再是技术内容的唯一权威；Bid Plan 决定骨架下必须展开的技术内容。目录修正最多一次，防止 Agent 无限循环。

## 结构化响应表与未知值

响应表先生成结构化 rows，再在目录的对应模板叶节点渲染为 Markdown 表格。若招标文件提取出列名和顺序，则按列语义点对点回填，不另造替代表。

统一未知值常量为：

```text
待确认
```

技术参数行只有在 Parameter Registry 中是 `CONFIRMED` 时才回填投标值和“无偏离”。招标下限或招标给定值不会被自动冒充为企业实际参数。

## Section Brief 与 Evidence Pack

`electron/services/sectionEvidenceService.cjs` 在每个章节生成前组装 Section Brief，仅使用当前目录节点、Bid Plan 主题、招标要求、项目事实和 Parameter Registry。Brief 中的 `must_cover`、`technical_entities`、`evidence_needed`、`unknowns` 同时供 Query Builder 和生成 Prompt 使用。

Query Builder 每章产生 1–4 个查询。章节目标自动选择 `company`、`product` / `technical`、`project`、`historical_project` 或 `service` scope。当前知识模型不增表，在现有 document/item 上以标题、摘要和正文做查询相关度排序。

Evidence Pack 默认限制：

- Top-K: 6
- 字符预算: 12,000
- 低相关阈值: 0.20
- 相同 content hash 或高度包含文本去重
- 允许空 Evidence Pack；空证据时只可写方案性内容

生成 Prompt 明确区分 Tender Facts、Company Evidence 和 Unknowns。通用工程方法可由模型组织，企业资产、业绩、证书、客户和产品实际参数不得超出 Evidence Pack。

## Parameter Registry

参数优先级为：

```text
user_override
  > project_confirmed
  > company_evidence
  > tender_requirement
```

`tender_requirement` 始终保持 `UNKNOWN`；后续有企业证据或用户确认时，可以同 key 高优先级值覆盖。章节生成和响应表使用同一 Registry，避免各章独立猜测。

## 全文直接质量检查

`electron/services/bidQualityService.cjs` 输出：

- `technical_coverage`
- `parameter_conflicts`
- `duplicate_sections`
- `missing_tables`
- `unsupported_claims`

参数冲突和无证据声明只报告，不自动覆盖用户手改正文。

## SQLite v31 与兼容性

v31 增加：

- `technical_plan_outline_nodes.technical_topic_ids_json`
- `technical_plan_bid_plan`
- `technical_plan_response_tables`
- `technical_plan_parameter_registry`
- `technical_plan_quality_check`

迁移是向前增量的，旧目录没有 topic IDs 时依靠语义覆盖检查兼容。运行时 schema 与根目录 `sql/workspace_schema.sql` 同步。

## 调用数控制

全文阶段的目标调用数是 1 次 Bid Planning + 1 次 Outline + 必要时 1 次 Outline Repair。Section Brief 为确定性本地组装，不额外调用 LLM；每章仅做 1–4 个本地 scoped query 和 1 次正文生成。
