const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runBidQualityCheck,
  findParameterConflicts,
  findUnsupportedClaims,
  checkResponseSectionCoverage,
  extractResponseSections,
  sectionMatchesNode,
} = require('./bidQualityService.cjs');
const { calculateOutlineCoverage } = require('./bidPlanningService.cjs');

test('质量检查报告参数冲突而不覆盖人工正文', () => {
  const outlineData = { outline: [{ id: '1', title: '技术参数', technical_topic_ids: ['T1'], content: '起升高度为13m。', content_mode: 'ai-generate' }] };
  const conflicts = findParameterConflicts(outlineData, { parameters: [{ key: 'lifting_height', label: '起升高度', bid_value: '12m', status: 'CONFIRMED' }] });
  assert.equal(conflicts.length, 1);
  assert.equal(outlineData.outline[0].content, '起升高度为13m。');
});

test('无 Evidence Pack 的具体企业资产声明标记 UNSUPPORTED', () => {
  const findings = findUnsupportedClaims({ outline: [{ id: '1', content: '我公司拥有大型加工设备20台。' }] }, { 1: { plan: { evidence_pack: { sources: [] } } } });
  assert.equal(findings[0].status, 'UNSUPPORTED');
});

test('证据同时包含资质等级和认证时允许合理改写', () => {
  const outlineData = { outline: [{ id: '1', title: '服务', content: '我公司拥有特种设备制造许可证（含安装、修理、改造）A级资质，通过ISO9001认证。' }] };
  const contentPlans = { 1: { plan: { evidence_pack: { sources: [{ content: '类型：特种设备制造许可证(含安装、修理、改造) 等级：A。公司较早通过了 ISO9001 国际质量体系认证。' }] } } } };
  assert.deepEqual(findUnsupportedClaims(outlineData, contentPlans), []);
});

test('响应文件要求解析出章节清单并标记必须提供项', () => {
  const sections = extractResponseSections([
    '# 响应文件要求',
    '## 响应文件组成',
    '1. 投标函（必须提供）',
    '2. 近两年财务状况表（必须提供）',
    '3. 近五年同类物资供货业绩表（必须提供）',
    '4. 联合体协议书（如适用）',
  ].join('\n'));
  // 标题类行「响应文件要求/响应文件组成」不是章节，必须被过滤掉。
  assert.deepEqual(sections.map((item) => item.name), ['投标函', '近两年财务状况表', '近五年同类物资供货业绩表', '联合体协议书']);
  assert.deepEqual(sections.map((item) => item.required), [true, true, true, false]);
  assert.equal(sections[1].category, 'financial');
  assert.equal(sections[2].category, 'performance');
});

test('响应章节覆盖点名招标要求但目录缺失的合规章节', () => {
  const responseFileRequirements = [
    '# 响应文件要求',
    '1. 投标函（必须提供）',
    '2. 法定代表人身份证明（必须提供）',
    '3. 近两年财务状况表（必须提供）',
    '4. 近五年同类物资供货业绩表（必须提供）',
    '5. 技术偏离表（必须提供）',
  ].join('\n');
  const outlineData = { outline: [
    { id: '1', title: '投标函', content: '投'.repeat(300) },
    { id: '2', title: '法定代表人身份证明', content: '证'.repeat(300) },
    { id: '3', title: '技术偏离表', content: '待补充' },
  ] };
  const coverage = checkResponseSectionCoverage(responseFileRequirements, outlineData);
  assert.equal(coverage.computable, true);
  assert.equal(coverage.required_total, 5);
  assert.equal(coverage.covered_count, 3);
  assert.equal(coverage.coverage_score, 60);
  assert.deepEqual(coverage.missing_required.map((item) => item.name), ['近两年财务状况表', '近五年同类物资供货业绩表']);
  assert.deepEqual(coverage.by_category.financial.missing, ['近两年财务状况表']);
  // 标题在但正文过薄：这是「写到了但没形成证据链」的合规章节。
  assert.deepEqual(coverage.thin_sections.map((item) => item.name), ['技术偏离表']);
});

test('响应文件要求里带附件号的章节能与目录标题对上', () => {
  assert.ok(sectionMatchesNode('附件3 投标函', '投标函'));
  assert.ok(sectionMatchesNode('近两年财务状况表', '第二章 近两年财务状况表（格式）'));
  assert.ok(!sectionMatchesNode('近五年同类物资供货业绩表', '技术偏离表'));
});

test('未提取到响应文件章节时标记为不可计算而不是零缺陷', () => {
  const coverage = checkResponseSectionCoverage('', { outline: [] });
  assert.equal(coverage.computable, false);
  assert.equal(coverage.required_total, 0);
  assert.match(coverage.reason, /未从 Step02/);
});

test('未提取到技术主题时覆盖率不再报 100%', () => {
  const coverage = calculateOutlineCoverage({ technical_topics: [] }, { outline: [] });
  assert.equal(coverage.computable, false);
  assert.equal(coverage.coverage_score, 0);
});

test('未佐证事实能识别注册资金、信用代码与体系认证编号', () => {
  const findings = findUnsupportedClaims({
    outline: [{ id: '1', content: '我公司注册资金10088万元，统一社会信用代码91410728399587428N，已通过ISO 45001认证。' }],
  }, {});
  const claims = findings.map((item) => item.claim);
  assert.ok(claims.some((claim) => /注册资金/.test(claim)), `实际命中：${claims.join(' | ')}`);
  assert.ok(claims.some((claim) => /统一社会信用代码/.test(claim)));
  assert.ok(claims.some((claim) => /ISO 45001/.test(claim)));
});

test('招标原文本身就是合法出处，不算编造', () => {
  const findings = findUnsupportedClaims(
    { outline: [{ id: '1', content: '注册资金10088万元。' }] },
    {},
    '招标文件要求投标人注册资金10088万元。',
  );
  assert.deepEqual(findings, []);
});

test('全文质量检查把响应章节覆盖与技术主题覆盖一起报出', () => {
  const result = runBidQualityCheck({
    bidPlan: { technical_topics: [], required_tables: [] },
    outlineData: { outline: [{ id: '1', title: '投标函', content: '投'.repeat(300) }] },
    responseTables: {},
    parameterRegistry: { parameters: [] },
    contentPlans: {},
    responseFileRequirements: '1. 投标函（必须提供）\n2. 近两年财务状况表（必须提供）',
  });
  assert.equal(result.response_section_coverage.computable, true);
  assert.deepEqual(result.response_section_coverage.missing_required.map((item) => item.name), ['近两年财务状况表']);
  assert.equal(result.technical_coverage.computable, false);
});

test('全文质量检查同时输出五类直接制作检查', () => {
  const result = runBidQualityCheck({
    bidPlan: { technical_topics: [{ id: 'T1', title: '电气控制', recommended_section: '电气控制', keywords: ['PLC'], requirements: [] }], required_tables: [{ type: 'technical_parameter_response' }] },
    outlineData: { outline: [{ id: '1', title: '电气控制', technical_topic_ids: ['T1'], content: 'PLC控制方案。', content_mode: 'ai-generate' }] },
    responseTables: {},
    parameterRegistry: { parameters: [] },
    contentPlans: {},
  });
  assert.equal(result.technical_coverage.coverage_score, 100);
  assert.deepEqual(result.missing_tables, ['technical_parameter_response']);
  assert.ok(Array.isArray(result.parameter_conflicts));
  assert.ok(Array.isArray(result.duplicate_sections));
  assert.ok(Array.isArray(result.unsupported_claims));
});
