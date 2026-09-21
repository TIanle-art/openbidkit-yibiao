# Bid Planning 阶段验收报告

## 结论

```text
BEFORE SCORE:
68 / 100

AFTER SCORE:
90 / 100
```

**Grade: A- / Functional PASS with explicit human-confirmation and visual-QA caveats**

| 项目 | Before | After |
|---|---|---|
| Technical Coverage | 旧目录对核心检查清单明显低于 80% | Bid Plan 15/15，Outline Coverage 100% |
| Outline | 6 个一级 + 9 个叶子，仅 4 个技术正文章 | 11 个聚合技术正文叶子 + 资格骨架 + 3 张必需响应表 |
| RAG | 章节分配知识条目，3/4 章使用 | 12/12 章主动构造 1–4 个 query 并命中 Evidence，Top-1 阈值通过率 100% |
| Required Tables | 技术偏离/供货清单等模板节点为空 | 3/3 检出且 3/3 结构化填入 |
| E2E | PARTIAL | **PASS（改动范围的功能全链路）** |

> DOCX 已经通过 OOXML/ZIP、Heading 和表格结构检查。当前机器没有 LibreOffice/`soffice`，因此不把“逐页 PNG 视觉验证”写成 PASS。

## Before：根因

旧数据流是：

```text
Tender + 响应文件格式
  → Outline Agent
  → 章节知识条目分配
  → Section Generation
```

目录 Prompt 将“响应文件格式”当成几乎唯一权威，技术需求和评分要求只是弱上下文。因此 AI 可以把 200T 门式起重机章节写得专业，但它没有一份可检查的“最终应写内容”清单，导致目录与正文整体缺项。

## After：实现

### 1. Bid Planning

在招标解析后增加一次 structured planning，持久化：

- 项目主类型 `equipment_procurement`
- 副类型 `installation_service`
- 10 项定量采购标的（含 MG200T / MHE20T / LDA10T 及配套设备）
- 15 个专业技术主题，每个主题保留要求和来源
- 33 个跨章参数候选
- 3 张必需响应表

真实跑测第一轮暴露模型把 `procurement_targets` 输出为空、把所有设备参数压成 8 个过粗主题。最终实现不依赖第二次 LLM：

- 从招标 Markdown 表头和定量行恢复设备清单，过滤“待填”等模板行。
- 对设备采购类按通用专业维度和原文信号深化过粗主题；没有文件名匹配、起重机项目 if/else 或固定目录。

### 2. Outline + Coverage

目录节点增加 `technical_topic_ids`。目录同时使用响应格式骨架、Bid Plan、评分点和项目类型。覆盖检查先做 ID 精确匹配，旧项目才回退到语义相似度。

- 最终覆盖：15/15 = 100%
- 未覆盖：0
- 部分覆盖：0
- 目录修正调用：0（首次已达标）
- 保护线：<90% 修正一次；修正后 <80% 直接失败

### 3. Required Tables

- `technical_parameter_response`：33 行
- `technical_deviation`：120 行
- `supply_scope`：10 行

表格标题和招标模板列顺序优先保留，再按列语义回填。真实项目没有可安全确认为本次投标产品实际值的企业参数，所以 33/33 参数响应保持 `UNKNOWN / 待确认`，没有自动写“完全满足”。

### 4. Section-aware RAG

- Section Brief：12 个
- Retrieval queries：45，平均 3.75/章
- 每章 query 限制：1–4
- 有 Evidence 的章节：12/12
- Top-1 相关度范围：0.638–0.760
- Top-1 平均：0.690
- 低阈值强行塞入：0

Evidence Pack 使用 Top-K=6、12,000 字符预算、0.20 阈值和 content hash/高包含去重。

### 5. Parameter Registry 与 Quality Check

参数优先级已落实：

```text
user_override > project_confirmed > company_evidence > tender_requirement
```

招标要求不再被当成投标实际值。全文质量检查复核结果：

- parameter conflicts: 0
- duplicate sections: 0
- missing tables: 0
- unsupported company claims: 0

对“资质 + ISO 认证”的合理改写，检查器从“必须整句相等”修正为“数值/编号精确 + 中文语义覆盖”，防止将真实 Evidence 误报为无证据。

## 真实 E2E

输入为上一轮隔离 userData 中的真实《招标书.pdf》解析件：

- 项目：台州湾新区绿色智慧建材制造基地起重机设备采购及安装
- 编号：台交所招〔2024〕8号
- 解析文本：30,089 字符
- 知识库：原验收工作区的 26 条知识条目
- 隔离工作区：全新 `/tmp/yb-bid-v2-final.*`，没有写入用户正式库

调用统计：

| 调用 | 数量 |
|---|---:|
| Bid Planning LLM | 1 |
| Outline LLM | 1 |
| Outline Repair | 0 |
| Section Brief | 12（本地确定性组装） |
| Retrieval query | 45 |
| Generation | 13（12 章 + 1 次局部重生成） |

回归：

- 人工编辑持久化：PASS
- 局部重生成不覆盖其他章节：PASS
- DOCX 生成：PASS（65KB）
- Heading 1 / 2 / 3：8 / 18 / 56
- Word 表格：16
- DOCX ZIP/OOXML 完整性：PASS

## 验收指标

| Metric | Target | Result |
|---|---:|---:|
| Technical Topic Extraction | ≥90% | 关键专业清单 20/20 = 100% |
| Outline Technical Coverage | ≥90% | 100% |
| Required Table Detection | 100% | 3/3 = 100% |
| Confirmed Parameter Fill Accuracy | ≥95% | 单测 1/1 = 100%；真实项目无可确认样本，N/A |
| Unsupported Parameter Fabrication | 0 | 0 |
| Section RAG Relevant Top-K | ≥80% | 12/12 = 100%（阈值口径） |
| Section Generation Quality | ≥4/5 | 内部内容规则审计通过；未进行独立人工 5 分量表打分 |
| Editing Regression | PASS | PASS |
| Regeneration Regression | PASS | PASS |
| DOCX Regression | PASS | PASS（结构），视觉未验 |
| Full E2E | PASS | PASS（本阶段功能链路） |

## Known Limitations

1. 隔离库仅保留真实 PDF 的解析 Markdown，本次复用上轮已 PASS 的上传/解析结果，未重新上传 PDF 二进制文件。
2. 真实知识库没有能安全点对点确认本次三种投标型号实际参数的证据，因此确认值填充准确率只有单测，真实样本为 N/A。这是宁可留“待确认”也不冒充实际值的有意结果。
3. 当前仓库没有 RAGFlow/向量检索实现；本次是在现有 knowledge document/item 模型上增加 query-aware 词法排序、scope、阈值、去重和预算。
4. 设备采购类有确定性专业深化保护；其他项目类型已可分类，但深化质量仍主要依赖 Bid Planning LLM。
5. 招标模板优先保留标题和列语义，但尚未还原原 Word/PDF 表格的精确样式与合并单元格。
6. 本机无 LibreOffice/`soffice`，不能完成逐页 PNG 渲染门禁；DOCX 仅完成结构和压缩包完整性审计。
7. 仓库目录本身不是 Git worktree，`git status` 返回 `not a git repository`，因此无法提供基于 Git 的变更清单。
