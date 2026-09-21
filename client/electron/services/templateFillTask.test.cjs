const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPrompt,
  buildProjectFactsText,
  buildSourceContext,
  buildNodeEvidence,
  cancelTemplateFill,
  isTemplateFillRunning,
  loadKnowledgeReferences,
  retrievalOptionsForNode,
  runTemplateFillTask,
} = require('./templateFillTask.cjs');

function fakeKnowledgeReferences() {
  return [{
    document: { id: 'doc-1', file_name: '投标文件材料.docx', status: 'success' },
    items: [
      {
        id: 'k1',
        title: '营业执照',
        resume: '统一社会信用代码与注册资金',
        content: '营业执照：统一社会信用代码 91410728399587428N，注册资金 10088 万元。',
      },
      {
        id: 'k2',
        title: '近五年同类供货业绩',
        resume: '某化工项目起重设备供货合同',
        content: '2023 年签订 LD5t-16.5m 起重机供货合同，金额 320 万元。',
      },
      {
        id: 'k3',
        title: '公司食堂管理制度',
        resume: '食堂卫生要求',
        content: '员工每日打卡，食堂每日检查卫生。',
      },
    ],
  }];
}

const emptyPlanningContext = {
  bidPlan: { technical_topics: [], procurement_targets: [] },
  parameterRegistry: { parameters: [] },
};

test('提示词不再写死本项目的人名、项目名和采购编号', () => {
  const prompt = buildPrompt({
    title: '技术响应函',
    description: '',
    content_mode: 'template-fill',
    content_mode_note: '',
    _sourceMarkdown: '',
    _projectFactsText: '## 项目信息\n{"project_name":"某真实项目"}',
  });
  assert.doesNotMatch(prompt, /付国涛/);
  assert.doesNotMatch(prompt, /赛鼎/);
  assert.doesNotMatch(prompt, /NC2060/);
  // 事实只能来自注入的项目事实，不能来自写死的示例。
  assert.match(prompt, /某真实项目/);
});

test('合规章节要求未提供的企业信息写成待补充而不是编造', () => {
  const prompt = buildPrompt({
    title: '法定代表人身份证明',
    description: '',
    content_mode: 'template-fill',
    content_mode_note: '',
    _sourceMarkdown: '',
    _projectFactsText: '',
  });
  assert.match(prompt, /待补充/);
  assert.match(prompt, /不得编造/);
  assert.match(prompt, /企业自有信息一律写/);
  // 没有事实来源时不得暗示可以自行补齐。
  assert.doesNotMatch(prompt, /写明完整合规的响应文本/);
});

test('表格类章节在无资料时同样禁止虚构证书号与业绩', () => {
  const prompt = buildPrompt({
    title: '技术偏离表',
    description: '',
    content_mode: 'template-fill',
    content_mode_note: '',
    _sourceMarkdown: '',
    _projectFactsText: '',
  });
  assert.match(prompt, /待补充/);
  assert.match(prompt, /不得虚构/);
});

test('项目事实按 Step02 解析结果与全局事实汇总', () => {
  const text = buildProjectFactsText({
    projectOverview: '本项目为某起重设备采购。',
    bidAnalysisTasks: {
      projectInfo: { status: 'success', content: '{"project_name":"甲项目"}' },
      partAInfo: { status: 'error', content: '{"company_name":"失败结果不应出现"}' },
    },
    globalFacts: [{ id: 'g1', title: '投标人信息', content: '- 投标人：某某装备有限公司' }],
  });
  assert.match(text, /甲项目/);
  assert.match(text, /某某装备有限公司/);
  assert.match(text, /本项目为某起重设备采购/);
  // status 不是 success 的解析结果不能作为事实来源。
  assert.doesNotMatch(text, /失败结果不应出现/);
});

test('没有事实来源时不注入任何企业背景', () => {
  assert.equal(buildProjectFactsText({}), '');
  assert.equal(buildProjectFactsText({ bidAnalysisTasks: { projectInfo: { status: 'success', content: '' } } }), '');
});

test('依据定位取命中标题的整个分节，而不是固定行数窗口', () => {
  const markdown = [
    '# 第一章 总则',
    '本章说明适用范围。',
    '# 第二章 资格证明',
    '须提交营业执照。',
    '须提交财务报表。',
    '# 第三章 技术规格',
    '起重量 5t。',
  ].join('\n');
  const context = buildSourceContext(markdown, '第二章 资格证明');
  assert.match(context, /须提交营业执照/);
  assert.match(context, /须提交财务报表/);
  // 固定窗口会把相邻章节的要求串进来，这正是合规章节张冠李戴的来源。
  assert.doesNotMatch(context, /起重量 5t/);
  assert.doesNotMatch(context, /本章说明适用范围/);
});

test('招标原文没有规范标题结构时退化为段落窗口', () => {
  const markdown = [
    '一、资格要求',
    '投标人须具备独立法人资格。',
    '二、技术要求',
    '起重量 5t。',
  ].join('\n');
  const context = buildSourceContext(markdown, '资格要求');
  assert.match(context, /须具备独立法人资格/);
  assert.doesNotMatch(context, /起重量 5t/);
});

test('合规章节按关键词召回营业执照与业绩材料', () => {
  const evidence = buildNodeEvidence(
    { id: '1', title: '资格审查资料', description: '' },
    { references: fakeKnowledgeReferences(), ...emptyPlanningContext },
  );
  assert.ok(evidence, '合规章节应当检索到材料');
  const text = evidence.sources.map((source) => source.content).join('\n');
  // 章节标题「资格审查资料」与条目「营业执照」几乎没有词面重合，
  // 靠语义相似度会把最该引用的材料排到阈值之外，所以这里断言关键词召回生效。
  assert.match(text, /91410728399587428N/);
  assert.match(text, /供货合同/);
  assert.doesNotMatch(text, /食堂/);
});

test('非合规章节走默认检索，不会把无关合规材料当成证据', () => {
  const evidence = buildNodeEvidence(
    { id: '9', title: '公司食堂管理制度', description: '' },
    { references: fakeKnowledgeReferences(), ...emptyPlanningContext },
  );
  const text = (evidence?.sources || []).map((source) => source.content).join('\n');
  assert.match(text, /食堂/);
  assert.doesNotMatch(text, /91410728399587428N/);
});

test('合规章节与非合规章节使用不同的召回策略', () => {
  assert.equal(retrievalOptionsForNode({ title: '近两年财务状况表' }).compliance, true);
  assert.equal(retrievalOptionsForNode({ title: '法定代表人身份证明' }).compliance, true);
  assert.equal(retrievalOptionsForNode({ title: '售后服务方案' }).compliance, false);
});

test('知识库素材带出处写入提示词，便于人工核对', () => {
  const prompt = buildPrompt({
    title: '资格审查资料',
    description: '',
    content_mode: 'template-fill',
    content_mode_note: '',
    _sourceMarkdown: '',
    _projectFactsText: '',
    _evidenceText: '### company · 营业执照（出处：投标文件材料.docx）\n统一社会信用代码 91410728399587428N',
  });
  assert.match(prompt, /知识库素材/);
  assert.match(prompt, /唯一来源/);
  assert.match(prompt, /91410728399587428N/);
  assert.match(prompt, /出处：投标文件材料.docx/);
  assert.match(prompt, /不得编造/);
});

test('检索不到知识库素材时明确要求写待补充', () => {
  const prompt = buildPrompt({
    title: '资格审查资料',
    description: '',
    content_mode: 'template-fill',
    content_mode_note: '',
    _sourceMarkdown: '',
    _projectFactsText: '## 项目信息\n{"project_name":"某项目"}',
    _evidenceText: '',
  });
  assert.match(prompt, /未检索到知识库素材/);
  assert.match(prompt, /一律写「待补充」/);
});

test('未选择知识库或服务不可用时报出明确原因', () => {
  assert.match(loadKnowledgeReferences(null, []).reason, /未选择参考知识库/);
  assert.match(loadKnowledgeReferences({}, ['doc-1']).reason, /知识库读取服务不可用/);
  assert.match(loadKnowledgeReferences({ readReferences() { throw new Error('boom'); } }, ['doc-1']).reason, /boom/);
});

test('模板填写把知识库材料带进合规章节，并把无证据章节点名', async () => {
  const prompts = {};
  const saved = {};
  const workspaceStore = {
    loadTechnicalPlan: () => ({
      outlineData: { outline: [
        { id: '1', title: '资格审查资料', content_mode: 'template-fill' },
        { id: '2', title: '售后服务方案', content_mode: 'template-fill' },
      ] },
      referenceKnowledgeDocumentIds: ['doc-1'],
      projectOverview: '本项目为起重设备采购。',
      ...emptyPlanningContext,
    }),
    readTenderMarkdown: () => '# 资格审查资料\n须提交营业执照与财务报表。\n# 技术规格\n起重量 5t。',
    saveChapterContent: ({ nodeId, content }) => { saved[nodeId] = content; },
  };
  const aiService = {
    async chat({ messages }) {
      const prompt = messages[0].content;
      if (prompt.includes('资格审查资料')) prompts.qualification = prompt;
      else prompts.service = prompt;
      return '正文内容';
    },
  };

  const result = await runTemplateFillTask({
    aiService,
    workspaceStore,
    knowledgeBaseService: { readReferences: () => fakeKnowledgeReferences() },
  });

  assert.equal(result.filled, 2);
  assert.equal(result.knowledge_references, 1);
  // 合规章节必须真的拿到知识库里的营业执照与业绩，而不是只有招标条文。
  assert.match(prompts.qualification, /91410728399587428N/);
  assert.match(prompts.qualification, /投标文件材料.docx/);
  // 招标依据按分节取，不能把技术规格串进资格审查。
  assert.match(prompts.qualification, /须提交营业执照与财务报表/);
  assert.doesNotMatch(prompts.qualification, /起重量 5t/);
  assert.equal(saved['1'], '正文内容');
  // 无证据章节必须被点名，否则用户会以为「模板填写完成」等于材料齐了。
  assert.deepEqual(result.no_evidence_sections, ['售后服务方案']);
  assert.equal(result.evidence_section_count, 1);
  assert.match(result.message, /未检索到知识库素材/);
});

test('未选择知识库时模板填写给出可操作提示', async () => {
  const workspaceStore = {
    loadTechnicalPlan: () => ({
      outlineData: { outline: [{ id: '1', title: '资格审查资料', content_mode: 'template-fill' }] },
      referenceKnowledgeDocumentIds: [],
      ...emptyPlanningContext,
    }),
    readTenderMarkdown: () => '',
    saveChapterContent: () => {},
  };
  const result = await runTemplateFillTask({
    aiService: { async chat() { return '正文'; } },
    workspaceStore,
    knowledgeBaseService: { readReferences: () => [] },
  });
  assert.equal(result.filled, 1);
  assert.deepEqual(result.no_evidence_sections, ['资格审查资料']);
  assert.match(result.message, /未选择参考知识库/);
  assert.match(result.message, /请(?:在目录步骤)?勾选投标文件知识库/);
});

function createFillStore(titles) {
  const saved = {};
  const store = {
    loadTechnicalPlan: () => ({
      outlineData: { outline: titles.map((title, index) => ({ id: String(index + 1), title, content_mode: 'template-fill' })) },
      referenceKnowledgeDocumentIds: [],
      ...emptyPlanningContext,
    }),
    readTenderMarkdown: () => '',
    saveChapterContent: ({ nodeId, content }) => { saved[nodeId] = content; },
  };
  return { store, saved };
}

// 16 个章节是 16 次串行 AI 请求，没有进度事件时界面在用户看来就是「无响应」。
test('模板填写逐章节回传进度', async () => {
  const { store } = createFillStore(['资格审查资料', '售后服务方案']);
  const events = [];
  const result = await runTemplateFillTask({
    aiService: { async chat() { return '正文'; } },
    workspaceStore: store,
    knowledgeBaseService: { readReferences: () => [] },
    onProgress: (progress) => events.push(progress),
  });
  assert.deepEqual(events.map((event) => event.phase), ['start', 'section', 'section', 'done']);
  assert.equal(events[0].total, 2);
  assert.equal(events[1].index, 1);
  assert.equal(events[1].title, '资格审查资料');
  assert.equal(events[3].index, 2);
  assert.equal(result.total_sections, 2);
  assert.equal(result.processed_sections, 2);
  assert.ok(Number.isFinite(result.elapsed_ms));
});

test('模板填写给每个章节请求设置超时与取消信号', async () => {
  const { store } = createFillStore(['资格审查资料']);
  const requests = [];
  await runTemplateFillTask({
    aiService: { async chat(request) { requests.push(request); return '正文'; } },
    workspaceStore: store,
    knowledgeBaseService: { readReferences: () => [] },
  });
  assert.equal(requests.length, 1);
  // 不显式传超时就会退回 AI_REQUEST_TIMEOUT_MS（10 分钟），这是卡死观感的直接来源。
  assert.equal(requests[0].timeout_ms, 240000);
  assert.match(requests[0].timeout_message, /生成超时/);
  assert.ok(requests[0].signal, '必须传入取消信号，否则无法中断在途请求');
});

test('模板填写可取消，未处理章节保持原状', async () => {
  const { store, saved } = createFillStore(['资格审查资料', '售后服务方案', '技术偏离表']);
  const result = await runTemplateFillTask({
    aiService: {
      async chat() {
        // 第一章开始后立即请求取消。
        cancelTemplateFill();
        return '正文内容';
      },
    },
    workspaceStore: store,
    knowledgeBaseService: { readReferences: () => [] },
  });
  assert.equal(result.status, 'canceled');
  assert.equal(result.canceled, true);
  assert.equal(result.processed_sections, 1);
  assert.equal(result.total_sections, 3);
  assert.deepEqual(Object.keys(saved), ['1']);
  assert.match(result.message, /已取消/);
  // 取消后必须释放活动任务，否则后续无法再次运行。
  assert.equal(isTemplateFillRunning(), false);
});

test('模板填写互斥：重复点击不会叠加并发的串行请求', async () => {
  const { store } = createFillStore(['资格审查资料']);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const aiService = { async chat() { await gate; return '正文内容'; } };
  const running = runTemplateFillTask({ aiService, workspaceStore: store, knowledgeBaseService: { readReferences: () => [] } });
  assert.equal(isTemplateFillRunning(), true);
  const second = await runTemplateFillTask({ aiService, workspaceStore: store, knowledgeBaseService: { readReferences: () => [] } });
  assert.equal(second.status, 'busy');
  assert.equal(second.filled, 0);
  assert.match(second.message, /正在进行中/);
  release();
  const first = await running;
  assert.equal(first.status, 'success');
  assert.equal(first.filled, 1);
  assert.equal(isTemplateFillRunning(), false);
});
