const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSectionBrief,
  buildSectionQueries,
  inferRetrievalScope,
  buildEvidencePack,
} = require('./sectionEvidenceService.cjs');

const bidPlan = {
  procurement_targets: [{ name: 'MG200T门式起重机' }],
  technical_topics: [{
    id: 'T002',
    title: '起升机构',
    recommended_section: '起升机构设计',
    keywords: ['钢丝绳', '卷筒', '制动器'],
    evidence_categories: ['product', 'technical'],
    requirements: [{ text: '起升机构应配置钢丝绳、卷筒和工作制动器', source_refs: [{ page: '42' }] }],
  }],
  required_tables: [{ type: 'technical_parameter_response' }],
  unknowns: ['实际钢丝绳型号未确认'],
};

test('Section Brief 只聚合本章 Bid Plan 主题、招标要求和已知参数', () => {
  const brief = createSectionBrief({
    section: { id: '6.3', title: '起升机构设计', description: '说明起升系统', technical_topic_ids: ['T002'] },
    bidPlan,
    parameterRegistry: { parameters: [
      { key: 'capacity', label: '额定起重量', bid_value: '200t', status: 'CONFIRMED', source_refs: [{ label: '用户确认' }] },
      { key: 'rope_model', label: '钢丝绳型号', bid_value: '待确认', status: 'UNKNOWN' },
    ] },
  });
  assert.deepEqual(brief.technical_topic_ids, ['T002']);
  assert.match(brief.must_cover.join(' '), /钢丝绳/);
  assert.equal(brief.known_facts[0].value, '200t');
  assert.ok(brief.unknowns.some((item) => item.includes('钢丝绳型号')));
});

test('Query Builder 每章限制 1 到 4 条查询', () => {
  const brief = createSectionBrief({ section: { id: '6.3', title: '起升机构', technical_topic_ids: ['T002'] }, bidPlan });
  const queries = buildSectionQueries(brief);
  assert.ok(queries.length >= 1 && queries.length <= 4);
  assert.match(queries.join(' '), /起升机构/);
});

test('Scope 根据章节目标选择产品技术域', () => {
  assert.deepEqual(inferRetrievalScope({ title: '起升机构' }, { must_cover: ['卷筒与制动器'], evidence_needed: [] }), ['product', 'technical', 'project']);
});

test('Evidence Pack 排序命中相关条目、过滤低相关并去重', () => {
  const brief = createSectionBrief({ section: { id: '6.3', title: '起升机构', technical_topic_ids: ['T002'] }, bidPlan });
  const references = [{
    document: { id: 'doc-1', file_name: '起重机产品技术资料', status: 'success' },
    items: [
      { id: 'K1', title: '起升机构设计', resume: '钢丝绳、卷筒和制动器设计', content: '起升机构采用钢丝绳卷筒系统，并配置工作制动器。', content_hash: 'same' },
      { id: 'K2', title: '重复起升资料', resume: '卷筒制动', content: '起升机构采用钢丝绳卷筒系统，并配置工作制动器。', content_hash: 'same' },
      { id: 'K3', title: '公司食堂管理', resume: '食堂卫生制度', content: '每日检查食堂卫生。' },
    ],
  }];
  const pack = buildEvidencePack({ section: { id: '6.3', title: '起升机构' }, brief, references, threshold: 0.2 });
  assert.equal(pack.sources.length, 1);
  assert.equal(pack.sources[0].chunk_id, 'K1');
  assert.ok(pack.sources[0].relevance >= 0.8);
  assert.ok(pack.budget.used_characters <= pack.budget.character_budget);
});

test('低相关知识允许返回空 Evidence Pack', () => {
  const brief = createSectionBrief({ section: { id: '6.3', title: '起升机构', technical_topic_ids: ['T002'] }, bidPlan });
  const pack = buildEvidencePack({
    section: { id: '6.3', title: '起升机构' },
    brief,
    references: [{ document: { id: 'd', status: 'success' }, items: [{ id: 'x', title: '员工考勤', resume: '请假制度', content: '员工请假制度。' }] }],
    threshold: 0.5,
  });
  assert.deepEqual(pack.sources, []);
});
