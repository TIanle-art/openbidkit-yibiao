# 标书制作能力 — 功能矩阵（BID_CREATION_FEATURE_MATRIX）

> 状态：WORKING / PARTIAL / BROKEN / MISSING / UNTESTED
> 判断以实际运行为准（本项目为 Electron 桌面客户端，通过 headless Electron 驱动真实 services 实测）。

| 功能 | 状态 | 是否实测 | 备注 |
|---|---|---|---|
| 创建项目 | WORKING | 是 | 单工作区技术方案；打开即用，导入招标文件即创建 |
| 上传招标文件 | WORKING | 是 | 导入真实《招标书.pdf》→ 合并 `tender.md`（77800字） |
| PDF解析 | WORKING | 是 | 本地解析成功（`tender-files/*.pdf.md`，30088→77800字） |
| 项目理解 | WORKING | 是 | `projectOverview` 生成准确：项目名/编号/预算/工期/交货地点 |
| 招标要求提取 | WORKING | 是 | 6 项 bid_items success：项目概述/技术评分/项目信息/甲方/交货服务/响应文件要求 |
| 标书类型识别 | PARTIAL | 是 | 有 `outline_mode`(aligned/response-file/standalone-technical)，但仅影响目录锚定方式，未输出显式"类型"字段；对本采购+安装类项目未针对性区分 |
| 目录生成 | PARTIAL | 是 | aligned 模式生成 6 个一级+9 叶；但技术分支仅"施工组织方案+售后服务方案"，缺产品设计/钢结构/起升机构/电气/安全保护/制造/调试/验收等（P1） |
| 目录编辑 | UNTESTED | 否 | 未测目录结构编辑（增删/移动/重命名）；仅确认目录树可读 |
| 知识库绑定 | WORKING | 是 | outline 任务传入 `reference_knowledge_document_ids`，已绑定 1 个知识库文档 |
| RAG检索 | PARTIAL | 是 | 内容计划按章节分配 `knowledge.item_ids`（安装→K000006 安装、售后→K000008、培训→K000008+），但"设备供应"被分配到空集，漏配包装运输类条目；非按查询检索 |
| 章节生成 | WORKING | 是 | 4 个 ai-generate 章节生成成功，内容具体专业（含真实参数+多张表） |
| 章节保存 | WORKING | 是 | `saveChapterContent({nodeId,content})` 保存成功 |
| 章节编辑 | WORKING | 是 | 对 6.1.1 追加"双机联动控制逻辑"人工段，重载后完整保留（len 6532） |
| 章节重新生成 | WORKING | 是 | 对 6.1.2 独立重生成（23s），按指令"增加安装风险+压字数"；未覆盖已人工编辑的 6.1.1 |
| 全文生成 | PARTIAL | 是 | 4 章正文+一致性审计完成；模板填充章节（技术偏离表/供货清单/主要部件表/易损件/随机工具清单）内容为空（依赖投标模板提取，本轮未启用） |
| 一致性检查 | PARTIAL | 是 | `enableConsistencyAudit` 已运行；全局事实落库并注入 `facts.titles`；未做人工全文逐项核对 |
| 标书预览 | UNTESTED | 否 | 未测 Renderer 预览 |
| DOCX导出 | WORKING | 是 | 导出成功（31.6KB）；Heading1/2/3、8 表、378 正文段，合法 Word 2007+ |
| PDF导出 | MISSING | 否 | 仅 `exportWord`，无 PDF 导出能力（按要求跳过） |

## 汇总
- 主链路（真实招标PDF → 解析 → 理解 → 目录 → 知识库 → 章节生成 → 编辑 → 局部重生成 → 一致性校验 → DOCX）**全部跑通**。
- 关键短板：目录生成对本"设备采购+安装"项目技术覆盖不足；模板填充类章节为空；RAG 非按查询、部分章节漏配知识条目。
