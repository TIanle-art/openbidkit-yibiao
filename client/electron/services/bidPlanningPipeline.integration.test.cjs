const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateBidPlan,
  createResponseTables,
  buildParameterRegistry,
  calculateOutlineCoverage,
} = require('./bidPlanningService.cjs');
const { createSectionBrief, buildEvidencePack } = require('./sectionEvidenceService.cjs');

test('fake RAG 完整链路：Tender → BidPlan → Outline → Brief → Retrieval → Generate', async () => {
  const tender = `设备采购及安装项目。采购 MG200T 门式起重机 4 台。技术要求包括总体设计、钢结构、起升机构、PLC 变频控制、防风防碰撞、双机联动、视频监控、制造焊接、安装调试、验收培训和售后。须提交技术参数响应表、技术偏离表、供货范围表。`;
  const fakePlanningPayload = {
    project_type: { primary: 'equipment_procurement', secondary: ['installation_service'] },
    procurement_targets: [{ name: 'MG200T门式起重机', quantity: 4, unit: '台', category: 'crane' }],
    project_characteristics: ['heavy_equipment', 'installation_required'],
    technical_topics: [
      { id: 'T001', title: '总体设计与钢结构', requirements: [{ text: '总体设计、钢结构要求', source_refs: [{ section: '技术要求' }] }], keywords: ['主梁', '支腿'], evidence_categories: ['product'] },
      { id: 'T002', title: '起升机构', requirements: [{ text: '起升机构要求' }], keywords: ['钢丝绳', '卷筒'], evidence_categories: ['product', 'technical'] },
      { id: 'T003', title: '电气与安全控制', requirements: [{ text: 'PLC、变频、防风、防碰撞和双机联动要求' }], keywords: ['PLC', '变频', '双机联动'], evidence_categories: ['technical'] },
      { id: 'T004', title: '制造安装与验收服务', requirements: [{ text: '制造、安装、调试、验收、培训与售后要求' }], keywords: ['焊接', '调试', '售后'], evidence_categories: ['service', 'technical'] },
    ],
    parameter_candidates: [{ key: 'capacity', label: '额定起重量', tender_requirement: '200t', source_refs: [{ section: '设备清单' }] }],
    service_topics: ['installation', 'commissioning', 'training', 'after_sales'],
    required_tables: [{ type: 'technical_parameter_response' }, { type: 'technical_deviation' }, { type: 'supply_scope' }],
    evaluation_topics: [],
    proposal_parts: ['technical', 'service'],
    unknowns: ['投标产品实际起升高度待确认'],
  };
  const aiService = {
    async requestJson(request) {
      const normalized = request.normalizer(fakePlanningPayload);
      request.validator(normalized);
      return normalized;
    },
  };
  const bidPlan = await generateBidPlan({ aiService, tenderMarkdown: tender, bidAnalysisTasks: {} });
  const responseTables = createResponseTables(bidPlan);
  const registry = buildParameterRegistry(bidPlan);
  const outlineData = { outline: [{ id: '6', title: '技术响应', description: '技术方案', children: [
    { id: '6.1', title: '总体设计与钢结构', description: '', technical_topic_ids: ['T001'], content_mode: 'ai-generate' },
    { id: '6.2', title: '起升机构', description: '', technical_topic_ids: ['T002'], content_mode: 'ai-generate' },
    { id: '6.3', title: '电气与安全控制', description: '', technical_topic_ids: ['T003'], content_mode: 'ai-generate' },
    { id: '6.4', title: '制造安装与验收服务', description: '', technical_topic_ids: ['T004'], content_mode: 'ai-generate' },
  ] }] };
  const coverage = calculateOutlineCoverage(bidPlan, outlineData);
  assert.equal(coverage.coverage_score, 100);
  assert.deepEqual(Object.keys(responseTables).sort(), ['supply_scope', 'technical_deviation', 'technical_parameter_response']);
  assert.equal(registry.parameters[0].status, 'UNKNOWN');

  const section = outlineData.outline[0].children[1];
  const brief = createSectionBrief({ section, parentChapters: [outlineData.outline[0]], bidPlan, parameterRegistry: registry });
  const evidencePack = buildEvidencePack({
    section,
    brief,
    references: [{ document: { id: 'product-doc', file_name: '门式起重机产品资料', status: 'success' }, items: [
      { id: 'K1', title: '起升机构', resume: '钢丝绳卷筒与制动器设计', content: '起升机构采用钢丝绳卷筒系统，并设置工作制动与安全制动。' },
      { id: 'K2', title: '员工制度', resume: '员工考勤', content: '员工每日打卡。' },
    ] }],
  });
  assert.deepEqual(evidencePack.sources.map((source) => source.chunk_id), ['K1']);

  const generated = `${brief.title}应响应：${brief.must_cover.join('；')}。企业证据：${evidencePack.sources.map((source) => source.content).join('；')}。未知投标参数统一标记：待确认。`;
  assert.match(generated, /钢丝绳卷筒/);
  assert.match(generated, /待确认/);
  assert.doesNotMatch(generated, /完全满足/);
});
