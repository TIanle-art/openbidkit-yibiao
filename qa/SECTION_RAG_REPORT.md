# Section-aware RAG Report

## 数据流

```text
Bid Plan + Outline + Project Facts + Parameter Registry
  → Section Brief
  → Query Builder (1–4)
  → Scope selection
  → Rank + threshold + dedup + budget
  → Evidence Pack
  → Section Generation + Quality Check
```

Section Brief 实际参与 Query Builder 和 Generation Prompt，不是只生成后存档。Content plan 持久化 `section_brief` 和 `evidence_pack`，页面卸载不影响后台生成。

## 真实跑测

| 指标 | 结果 |
|---|---:|
| 生成正文叶子 | 12 |
| Section Brief | 12 |
| Retrieval queries | 45 |
| 平均 queries/章 | 3.75 |
| 有 Evidence Pack source 的章节 | 12/12 |
| Top-1 relevance 最低 | 0.638 |
| Top-1 relevance 最高 | 0.760 |
| Top-1 relevance 平均 | 0.690 |
| 阈值达标率 | 100% |

Top-K 证据样本：

| 章节 | 证据数 | Top-1 relevance |
|---|---:|---:|
| 总体技术方案与性能指标 | 1 | 0.716 |
| 主要结构与材料设计 | 1 | 0.680 |
| 功能机构与运行系统 | 1 | 0.680 |
| 供配电、电气与自动控制 | 1 | 0.737 |
| 安全保护与信息化 | 1 | 0.660 |
| 制造工艺、焊接与防腐涂装 | 2（去重后） | 0.641 |
| 质量保证、检测与出厂试验 | 1 | 0.641 |
| 供货范围、包装与运输 | 1 | 0.720 |
| 安装施工与调试 | 1 | 0.638 |
| 载荷试验与验收 | 1 | 0.682 |
| 培训与售后服务 | 1 | 0.725 |

## Scope 与预算

- 公司类：`company`
- 业绩类：`historical_project`, `project`
- 售后/培训：`service`, `company`
- 产品机构/电气/安全/制造：`product`, `technical`, `project`
- 项目特殊实施：`project`, `product`

默认预算：Top-K=6，12,000 字符，threshold=0.20。对相同 content hash 和高度包含文本去重。低相关时允许空 Evidence Pack，不会因为“必须用 RAG”而塞入无关材料。

## 生成事实边界

Prompt 将上下文分成：

- Tender Facts：本项目招标事实和目标
- Company Evidence：企业/产品可陈述事实
- Unknowns：统一“待确认”

最终全文复核：unsupported company claims = 0。一般工程方法和流程可以由模型组织，但企业资产、客户、证书编号、业绩和产品实际参数必须被 Evidence Pack 支持。

## 限制

当前仓库没有 RAGFlow 或 embedding 运行时实现。本次在现有知识文档/条目模型上完成 query-aware 词法排序。当知识库规模扩大或有同词义词差异时，仍需要 embedding/hybrid retrieval 提高召回。
