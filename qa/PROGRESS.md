# 执行过程记录（PROGRESS）

> 只记录关键阶段、发现、修复与下一步。不做流水账。

## 环境与基线
- 项目非 git 仓库；Electron 桌面包，主链路在 `client/electron/services/`（`technical-plan` 功能）。
- AI 配置：deepseek（api.deepseek.com / deepseek-v4-flash-vision-exp），连通正常。
- 真实招标文件已导入并解析成功：台州湾新区……起重机（含配套设备）设备采购及安装（项目编号 台交所招〔2024〕8 号），含 MG200T/MHE20T/LDA10T 起重机、双机联动、防风、防撞、视频监控等。
- 为不污染用户真实数据，使用隔离测试 userData（`/tmp/yb-e2e-userdata`），复制真实工作区。
- DOCX 导出用 `docx` 纯 JS 库，不依赖本机 .NET（本机无 dotnet，导出仍可用）。

## 已跑通阶段
- 启动 headless Electron harness 驱动真实 services（configStore/aiService/agentService/taskService/technicalPlanStore/knowledgeBaseService/exportService）。
- 招标解析（bid-items success，6 项：项目概述/技术评分要求/项目信息/甲方信息/交货和服务要求/响应文件要求）——复用真实解析结果。
- 目录生成（aligned 模式）：15 候选 → 默认选 6 → 完整目录 = 6 个一级 + 9 个叶子。

## 发现并修复的问题
1. **`agent_auto_answer_enabled=false` 导致目录 Agent 在 `ask-user` 卡死约 25 分钟**。
   - 症状：outline agent 在 score-planning 调 `ask-user` 等待"评分项安排在哪个层级"，无应答而挂起。
   - 修复：测试配置开启 `agent_auto_answer_enabled=true`（仅测试副本），autoConfirmationService 自动选推荐项；清理卡死 agent session 后重跑成功。
2. 后台 shell 默认 600s 超时误杀慢任务 → 改用 `disable_timeout=true` 后台运行。

## 关键质量发现（待填报告）
- **目录生成（aligned 模式）对招标"技术需求"体现不足**：`技术方案` 分支仅含 `施工组织方案`（设备供应与现场就位/安装调试与验收交付）+ `售后服务方案`（售后与维护/培训），缺 项目理解/总体设计/钢结构/起升机构/电气/安全保护/制造/安装/调试/验收/质保/备件 等章节。属目录质量 P1/P2 风险。

## 下一步
- 等待全局事实生成完成。
- 启动全章节正文生成；观察 RAG（知识库条目）是否被正确使用。
- 模拟编辑一个章节 + 局部重新生成。
- 导出 DOCX 到 `qa/artifacts/TEST_GENERATED_BID.docx` 并校验内容/结构。
- 视时间决定是否改用 `standalone-technical` 模式生成更丰满的技术标目录。

## 编辑与重新生成测试（已测）
- **编辑保存 PASS**：对 `6.1.1 设备供应与现场就位方案` 追加"双机联动控制逻辑"人工段落并 `saveChapterContent` 保存；重载后 len=6532、人工段/标记完整保留。-> 人工编辑可靠持久化。
- 局部重新生成（正在进行）：对 `6.1.2` 单独下发"增加安装风险及控制措施、1200字、减少套话"指令重生成，验证不覆盖已人工编辑的 `6.1.1`。

## 正文内容质量（已生成章节）
- 已生成 4 个技术标章节（设备供应与现场就位/安装调试与验收交付/售后维护/培训），质量**具体且专业**：引用真实参数（MG200T/106t/30kW/Q355B/40Cr/施耐德·西门子·ABB/三合一减速器/洛轴LYC）、含 4 张表（供货范围/运输清单/吊装设备/作业顺序）、方法具体（吊装安全系数≥1.25、四点吊装、防振包装、无损检测）。内容写作 NOT generic filler。
- **覆盖度不足（P1）**：技术标正文仅 4 章，缺 项目理解/总体设计/产品设计/钢结构/起升机构/电气/安全保护(限位·超载·防风·防撞)/双机联动/视频监控/制造/调试/验收 等核心章节——源于 aligned 目录太薄（技术分支仅有 施工组织方案+售后服务方案）。
