const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDeliveryReadinessReport, LEVELS } = require('./deliveryReadiness.cjs');

const PROJECT = { projectName: '赛鼎 NC2060 起重设备采购', packageName: 'NC2060.EQP.P01.90-037' };

const RESPONSE_REQUIREMENTS = [
  '# 响应文件要求',
  '1. 投标函（必须提供）',
  '2. 法定代表人身份证明（必须提供）',
  '3. 技术偏离表（必须提供）',
].join('\n');

function baseInput(overrides = {}) {
  return {
    bidPlan: {
      technical_topics: [{ id: 'T1', title: '起升机构', recommended_section: '', keywords: ['起升'] }],
      required_tables: ['technical_deviation'],
    },
    outlineData: { outline: [
      { id: '1', title: '投标函', technical_topic_ids: [], content: '投'.repeat(300) },
      { id: '2', title: '法定代表人身份证明', technical_topic_ids: [], content: '证'.repeat(300) },
      { id: '3', title: '技术偏离表', technical_topic_ids: ['T1'], content: '起升'.repeat(200) },
    ] },
    responseTables: { technical_deviation: { rows: [] } },
    parameterRegistry: { parameters: [] },
    contentPlans: {},
    responseFileRequirements: RESPONSE_REQUIREMENTS,
    tenderMarkdown: '起升机构技术要求。',
    project: PROJECT,
    ...overrides,
  };
}

function codes(report, level) {
  return report.levels[level].map((item) => item.code);
}

test('干净输入可导出，且始终保留 DOCX 视觉人工确认项', () => {
  const report = buildDeliveryReadinessReport(baseInput());
  assert.equal(report.gate.can_export, true);
  assert.equal(report.gate.blocked, false);
  assert.equal(report.counts.blocker, 0);
  assert.ok(report.gate.requires_manual_confirmation);
  assert.ok(codes(report, 'manual_confirmation').includes('docx_visual_fidelity'));
});

test('混入历史项目事实词时阻断导出', () => {
  const report = buildDeliveryReadinessReport(baseInput({
    outlineData: { outline: [
      { id: '1', title: '投标函', technical_topic_ids: [], content: '投'.repeat(300) },
      { id: '2', title: '法定代表人身份证明', technical_topic_ids: [], content: '证'.repeat(300) },
      { id: '3', title: '技术偏离表', technical_topic_ids: ['T1'], content: '配套球磨机一台，满足制粉要求。'.repeat(20) },
    ] },
  }));
  assert.ok(codes(report, 'blocker').includes('cross_project_contamination'));
  assert.equal(report.gate.can_export, false);
  assert.equal(report.gate.blocked, true);
  assert.match(report.gate.reasons.join(';'), /cross_project_contamination/);
});

test('必备响应章节缺失时阻断导出', () => {
  const report = buildDeliveryReadinessReport(baseInput({
    outlineData: { outline: [{ id: '3', title: '技术偏离表', technical_topic_ids: ['T1'], content: '起升'.repeat(200) }] },
  }));
  assert.ok(codes(report, 'blocker').includes('missing_required_section'));
  assert.equal(report.gate.can_export, false);
});

test('参数与确认值冲突时阻断导出', () => {
  const report = buildDeliveryReadinessReport(baseInput({
    outlineData: { outline: [
      { id: '1', title: '投标函', technical_topic_ids: [], content: '投'.repeat(300) },
      { id: '2', title: '法定代表人身份证明', technical_topic_ids: [], content: '证'.repeat(300) },
      { id: '3', title: '技术偏离表', technical_topic_ids: ['T1'], content: '起升高度为13m，满足要求。'.repeat(20) },
    ] },
    parameterRegistry: { parameters: [{ key: 'lifting_height', label: '起升高度', bid_value: '12m', status: 'CONFIRMED' }] },
  }));
  assert.ok(codes(report, 'blocker').includes('parameter_conflict'));
  assert.equal(report.gate.can_export, false);
});

test('无证据的企业事实主张阻断导出', () => {
  const report = buildDeliveryReadinessReport(baseInput({
    contentPlans: { 3: { plan: { evidence_pack: { sources: [] } } } },
    outlineData: { outline: [
      { id: '1', title: '投标函', technical_topic_ids: [], content: '投'.repeat(300) },
      { id: '2', title: '法定代表人身份证明', technical_topic_ids: [], content: '证'.repeat(300) },
      { id: '3', title: '技术偏离表', technical_topic_ids: ['T1'], content: '我公司拥有大型加工设备20台，满足起升要求。' } ] },
  }));
  assert.ok(codes(report, 'blocker').includes('unsupported_claim'));
});

test('待确认占位与待定废标风险归入人工确认档', () => {
  const report = buildDeliveryReadinessReport(baseInput({
    outlineData: { outline: [
      { id: '1', title: '投标函', technical_topic_ids: [], content: '投'.repeat(300) },
      { id: '2', title: '法定代表人身份证明', technical_topic_ids: [], content: '证'.repeat(300) },
      { id: '3', title: '技术偏离表', technical_topic_ids: ['T1'], content: '证书编号待确认，起升方案满足要求。'.repeat(20) },
    ] },
    rejectionRisks: [{ title: '是否构成废标项待定', status: 'pending' }],
  }));
  assert.ok(codes(report, 'manual_confirmation').includes('pending_facts'));
  assert.ok(codes(report, 'manual_confirmation').includes('pending_rejection_risks'));
  // 人工确认不阻断导出，但必须被标记
  assert.equal(report.gate.can_export, true);
  assert.equal(report.gate.requires_manual_confirmation, true);
});

test('技术主题覆盖率偏低归入警告档而非阻断', () => {
  const report = buildDeliveryReadinessReport(baseInput({
    bidPlan: {
      technical_topics: [
        { id: 'T1', title: '起升机构', recommended_section: '', keywords: ['起升'] },
        { id: 'T2', title: '防爆电气系统', recommended_section: '', keywords: ['防爆'] },
      ],
      required_tables: [],
    },
  }));
  assert.ok(codes(report, 'warning').includes('low_technical_coverage'));
  assert.equal(report.gate.can_export, true);
});

test('报告只输出三档且计数与条目一致', () => {
  const report = buildDeliveryReadinessReport(baseInput());
  assert.deepEqual(Object.keys(report.levels).sort(), [...LEVELS].sort());
  for (const level of LEVELS) {
    assert.equal(report.counts[level], report.levels[level].length);
  }
});
