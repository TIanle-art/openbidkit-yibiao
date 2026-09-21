const test = require('node:test');
const assert = require('node:assert/strict');

const {
  UNKNOWN_PLACEHOLDER,
  classifyProject,
  normalizeBidPlan,
  calculateOutlineCoverage,
  createResponseTables,
  renderResponseTableMarkdown,
  populateResponseTableOutline,
  buildParameterRegistry,
  extractProcurementTargetsFromText,
} = require('./bidPlanningService.cjs');

function cranePlan() {
  return normalizeBidPlan({
    project_type: { primary: 'equipment_procurement', secondary: ['installation_service'] },
    procurement_targets: [{ name: 'MG200T门式起重机', quantity: 4, unit: '台', category: 'crane' }],
    technical_topics: [
      { id: 'T001', title: '总体设计', requirements: ['门式起重机总体设计要求'], importance: 'critical' },
      { id: 'T002', title: '起升机构', requirements: ['起升机构、钢丝绳、卷筒和制动要求'], importance: 'critical' },
      { id: 'T003', title: '电气控制', requirements: ['PLC、变频与电气保护要求'], importance: 'critical' },
      { id: 'T004', title: '防风与防碰撞', requirements: ['防风地锚、防风铁鞋及大车防碰撞要求'], importance: 'critical' },
    ],
    required_tables: [
      { type: 'technical_parameter_response' },
      { type: 'technical_deviation' },
      { type: 'supply_scope' },
    ],
  }, { sourceText: '起重机设备采购及安装，技术偏离表、供货范围表' });
}

test('项目分类识别设备采购并保留安装服务副类型', () => {
  assert.deepEqual(classifyProject('门式起重机设备采购、安装、调试和培训'), {
    primary: 'equipment_procurement',
    secondary: ['installation_service'],
  });
});

test('设备清单回退提取过滤非定量模板行', () => {
  const targets = extractProcurementTargetsFromText(`
| 序号 | 设备名称 | 规格型号 | 数量 | 单位 |
|---|---|---|---|---|
| 1 | 门式起重机 | MG200T | 4 | 台 |
| 2 | 安装费 | / | 待填 | 项 |
`);
  assert.deepEqual(targets, [{
    name: 'MG200T 门式起重机', model: 'MG200T', quantity: '4', unit: '台', category: 'equipment', source_refs: [{ label: '招标文件设备/货物清单' }],
  }]);
});

test('设备类规划将过度粗粒度参数主题稳定深化为专业维度', () => {
  const equipmentRequirements = `设备采购及安装。型号规格、额定能力和工作级别。
钢结构主梁、支腿和材质。起升机构、钢丝绳、卷筒和制动。大车小车运行机构与轨道。
供配电、电气、PLC、变频与控制柜。限位、超载、防风、防撞和联锁。双机联动、视频、安全监控、ERP接口和信息化。
制造、焊接、无损探伤和防腐涂装。质量检测、出厂试验和联合试运转。供货范围、包装、运输和称重。
施工组织、吊装与现场安装。调试、试运行与交付。载荷试验、静载、动载与验收。人员培训和技术资料。售后、质保期、响应时间与备品备件。`;
  const plan = normalizeBidPlan({
    project_type: { primary: 'equipment_procurement', secondary: ['installation', 'manufacturing'] },
    technical_topics: [{ id: 'T001', title: '设备技术规格', requirements: [equipmentRequirements] }],
  }, { sourceText: equipmentRequirements.repeat(12) });
  assert.deepEqual(plan.project_type.secondary, ['installation_service']);
  assert.ok(plan.technical_topics.length >= 14);
  assert.ok(plan.technical_topics.some((topic) => topic.title.includes('主要结构')));
  assert.ok(plan.technical_topics.some((topic) => topic.title.includes('安全保护')));
  assert.ok(plan.technical_topics.some((topic) => topic.title.includes('售后服务')));
});

test('技术主题保留多个要求及来源而不拆成参数章节', () => {
  const plan = normalizeBidPlan({ technical_topics: [{
    id: 'T001',
    title: '安全保护系统',
    requirements: [
      { text: '配置超载保护', source_refs: [{ page: 31 }] },
      { text: '配置限位和防碰撞', source_refs: [{ section: '第二章 4.8' }] },
    ],
  }] }, { sourceText: '设备采购' });
  assert.equal(plan.technical_topics.length, 1);
  assert.equal(plan.technical_topics[0].requirements.length, 2);
  assert.equal(plan.technical_topics[0].requirements[0].source_refs[0].page, '31');
});

test('目录覆盖优先使用 technical_topic_ids 精确计算', () => {
  const plan = cranePlan();
  const coverage = calculateOutlineCoverage(plan, { outline: [{
    id: '6', title: '技术方案', description: '技术响应', children: [
      { id: '6.1', title: '总体技术方案', description: '', technical_topic_ids: ['T001'], content_mode: 'ai-generate' },
      { id: '6.2', title: '起升机构', description: '', technical_topic_ids: ['T002'], content_mode: 'ai-generate' },
      { id: '6.3', title: '电气控制系统', description: '', technical_topic_ids: ['T003'], content_mode: 'ai-generate' },
      { id: '6.4', title: '安全保护系统', description: '包含防风与防碰撞', technical_topic_ids: ['T004'], content_mode: 'ai-generate' },
    ],
  }] });
  assert.equal(coverage.coverage_score, 100);
  assert.equal(coverage.missing_topics.length, 0);
});

test('旧目录可稳定复现低于 80% 的技术覆盖缺陷', () => {
  const coverage = calculateOutlineCoverage(cranePlan(), { outline: [{
    id: '6', title: '技术方案', description: '', children: [
      { id: '6.1', title: '施工组织方案', description: '设备供应和现场安装', content_mode: 'ai-generate' },
      { id: '6.2', title: '售后服务方案', description: '培训和售后', content_mode: 'ai-generate' },
    ],
  }] });
  assert.ok(coverage.coverage_score < 80, `实际覆盖率 ${coverage.coverage_score}%`);
  assert.ok(coverage.missing_topics.length >= 3);
});

test('响应表在没有企业证据时一律待确认而非完全满足', () => {
  const tables = createResponseTables(cranePlan());
  assert.ok(tables.technical_parameter_response.rows.length > 0);
  assert.ok(tables.technical_parameter_response.rows.every((row) => row.response.status === 'UNKNOWN' && row.response.value === UNKNOWN_PLACEHOLDER));
  assert.ok(tables.supply_scope.rows.every((row) => row.status === 'UNKNOWN'));
});

test('参数注册表不把招标最低要求当作投标确认值，并遵守覆盖优先级', () => {
  const plan = cranePlan();
  const registry = buildParameterRegistry(plan, [
    { key: 'lifting_height', label: '起升高度', value: '12m', source_type: 'company_evidence' },
  ], [
    { key: 'lifting_height', label: '起升高度', value: '12.5m', source_type: 'user_override' },
  ]);
  assert.ok(registry.parameters.filter((item) => item.source_type === 'tender_requirement').every((item) => item.status === 'UNKNOWN' && item.bid_value === UNKNOWN_PLACEHOLDER));
  assert.equal(registry.parameters.find((item) => item.key === 'lifting_height').bid_value, '12.5m');
});

test('结构化响应表可点对点填入目录且未知值统一待确认', () => {
  const tables = createResponseTables(cranePlan());
  const markdown = renderResponseTableMarkdown(tables.technical_parameter_response);
  assert.match(markdown, /\| 技术要求 \| 投标响应 \|/);
  assert.match(markdown, /待确认/);
  const result = populateResponseTableOutline({ outline: [
    { id: '1', title: '技术参数响应表', description: '', content_mode: 'template-fill' },
    { id: '2', title: '技术偏离表', description: '', content_mode: 'template-fill' },
    { id: '3', title: '成套设备供货清单', description: '', content_mode: 'template-fill' },
  ] }, tables);
  assert.deepEqual(result.populated_types.sort(), ['supply_scope', 'technical_deviation', 'technical_parameter_response']);
  assert.ok(result.outlineData.outline.every((item) => item.content.includes('待确认')));
});

test('招标模板列顺序优先保留并按列语义回填', () => {
  const plan = cranePlan();
  plan.required_tables[0].columns = ['序号', '参数名称', '招标技术要求', '投标响应值', '偏离说明'];
  const markdown = renderResponseTableMarkdown(createResponseTables(plan).technical_parameter_response);
  assert.match(markdown, /\| 序号 \| 参数名称 \| 招标技术要求 \| 投标响应值 \| 偏离说明 \|/);
  assert.match(markdown, /\| 1 \| 总体设计 \| 门式起重机总体设计要求 \| 待确认 \| 待确认 \|/);
});

test('只有已确认参数才能回填响应表', () => {
  const plan = normalizeBidPlan({
    technical_topics: [{ id: 'T001', title: '起升性能', requirements: ['起升高度不低于 11.5m'] }],
    parameter_candidates: [{ key: 'lifting_height', label: '起升高度', tender_requirement: '不低于 11.5m' }],
    required_tables: [{ type: 'technical_parameter_response' }],
  }, { sourceText: '设备采购技术参数响应' });
  const registry = buildParameterRegistry(plan, [{ key: 'lifting_height', label: '起升高度', value: '12m', source_type: 'company_evidence', source_refs: [{ chunk_id: 'K1' }] }]);
  const row = createResponseTables(plan, registry).technical_parameter_response.rows[0];
  assert.equal(row.response.status, 'CONFIRMED');
  assert.equal(row.response.value, '12m');
  assert.equal(row.deviation, '无偏离');
});
