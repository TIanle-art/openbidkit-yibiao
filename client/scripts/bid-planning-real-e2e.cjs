const fs = require('node:fs');
const path = require('node:path');

const { createConfigStore } = require('../electron/services/configStore.cjs');
const { createAiService } = require('../electron/services/aiService.cjs');
const { createSqliteDatabase } = require('../electron/services/sqliteDatabase.cjs');
const { createTaskLogStore } = require('../electron/services/taskLogStore.cjs');
const { createTechnicalPlanStore } = require('../electron/services/technicalPlanStore.cjs');
const {
  UNKNOWN_PLACEHOLDER,
  generateBidPlan,
  calculateOutlineCoverage,
  createResponseTables,
  populateResponseTableOutline,
  buildParameterRegistry,
} = require('../electron/services/bidPlanningService.cjs');
const { createSectionBrief, buildEvidencePack } = require('../electron/services/sectionEvidenceService.cjs');
const { runBidQualityCheck } = require('../electron/services/bidQualityService.cjs');
const { buildDocxBuffer } = require('../electron/services/exportService.cjs');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    args[String(argv[index] || '').replace(/^--/, '')] = argv[index + 1];
  }
  return args;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeOutlineNode(raw, fallbackId) {
  const children = (Array.isArray(raw?.children) ? raw.children : [])
    .map((item, index) => normalizeOutlineNode(item, `${fallbackId}.${index + 1}`));
  return {
    id: String(raw?.id || fallbackId),
    title: String(raw?.title || '未命名章节').trim(),
    description: String(raw?.description || '').trim(),
    content_mode: children.length ? 'ai-generate' : (raw?.content_mode === 'template-fill' ? 'template-fill' : 'ai-generate'),
    technical_topic_ids: uniqueStrings(raw?.technical_topic_ids),
    content: String(raw?.content || ''),
    ...(children.length ? { children } : {}),
  };
}

function normalizeOutline(value) {
  const raw = Array.isArray(value) ? value : value?.outline;
  return { outline: (Array.isArray(raw) ? raw : []).map((item, index) => normalizeOutlineNode(item, String(index + 1))) };
}

function validateOutline(value) {
  if (!value?.outline?.length) throw new Error('真实 E2E 目录生成结果为空');
  const ids = new Set();
  const visit = (items) => {
    for (const item of items || []) {
      if (!item.id || ids.has(item.id)) throw new Error(`目录 id 空或重复：${item.id || '空'}`);
      ids.add(item.id);
      visit(item.children);
    }
  };
  visit(value.outline);
}

function collectLeaves(items, parents = [], result = []) {
  for (const item of items || []) {
    if (item.children?.length) collectLeaves(item.children, [...parents, item], result);
    else result.push({ item, parents });
  }
  return result;
}

function buildOutlineMessages({ bidPlan, responseFormat, missingTopics }) {
  const repair = Array.isArray(missingTopics) && missingTopics.length;
  return [
    {
      role: 'system',
      content: `你是投标文件目录规划 Agent。招标响应格式是强约束骨架，Bid Plan 是技术内容覆盖的权威清单。禁止一个参数一章，应把相关主题聚合为专业章节。只输出 JSON。`,
    },
    {
      role: 'user',
      content: `Bid Plan：\n${JSON.stringify(bidPlan, null, 2)}\n\n招标文件规定的响应格式：\n${String(responseFormat || '未提取到明确格式')}`,
    },
    {
      role: 'user',
      content: repair
        ? `这是唯一一次目录修正。将以下未覆盖主题合理并入现有专业章节：${missingTopics.map((item) => `${item.topic_id}:${item.title}`).join('；')}。重新输出全部目录。`
        : `生成完整的技术标目录。每个 Bid Plan technical_topic id 必须精确写入某个末级节点 technical_topic_ids；允许多个主题合并到一章。技术正文末级章节控制在 8–12 个。如 Bid Plan 要求 technical_parameter_response、technical_deviation、supply_scope，必须各有一个独立末级表格节点，标题使用标准中文名，content_mode=template-fill。`,
    },
    {
      role: 'user',
      content: `JSON 格式：{"outline":[{"id":"1","title":"...","description":"...","content_mode":"ai-generate","technical_topic_ids":[],"children":[]}]} 。非末级节点 children 非空；末级节点不写 children。`,
    },
  ];
}

function buildGenerationMessages({ brief, evidencePack, registry }) {
  return [
    {
      role: 'system',
      content: `你是技术标章节编写 Agent。以招标要求为目标，企业或产品具体事实只能来自 Company Evidence，一般工程原理、方法、流程和质量控制可使用专业常识组织。未确认参数统一写“待确认”，禁止无证据写“完全满足”或编造企业资产、业绩、证书、客户和产品实际参数。`,
    },
    { role: 'user', content: `Section Brief：\n${JSON.stringify(brief, null, 2)}` },
    { role: 'user', content: `Company Evidence：\n${JSON.stringify(evidencePack, null, 2)}` },
    { role: 'user', content: `Parameter Registry：\n${JSON.stringify(registry, null, 2)}` },
    { role: 'user', content: `输出本章 Markdown 正文，约 900–1300 中文字，应逐项覆盖 must_cover，使用小标题、步骤或表格提高可执行性，不要重复输出本章一级标题。` },
  ];
}

function loadKnowledgeReferences(db, referenceIds) {
  const allowed = new Set(referenceIds || []);
  const documents = db.prepare('SELECT document_id, file_name, status FROM knowledge_documents ORDER BY created_at').all();
  const itemsStatement = db.prepare('SELECT item_id, title, resume, content, content_hash FROM knowledge_items WHERE document_id = ? ORDER BY sort_order');
  return documents.filter((document) => !allowed.size || allowed.has(document.document_id)).map((document) => ({
    document: { id: document.document_id, file_name: document.file_name, status: document.status },
    items: itemsStatement.all(document.document_id).map((item) => ({
      id: item.item_id,
      title: item.title,
      resume: item.resume,
      content: item.content,
      content_hash: item.content_hash,
    })),
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  const userDataDir = path.resolve(args['user-data-dir'] || '');
  const outputDir = path.resolve(args['output-dir'] || '');
  if (!userDataDir || !fs.existsSync(path.join(userDataDir, 'workspace', 'yibiao.sqlite'))) throw new Error('需要 --user-data-dir 指向隔离测试工作区');
  if (!outputDir) throw new Error('需要 --output-dir');
  fs.mkdirSync(outputDir, { recursive: true });

  const app = {
    getPath(name) {
      if (name === 'userData') return userDataDir;
      if (name === 'downloads') return outputDir;
      return userDataDir;
    },
    once() {},
  };
  const configStore = createConfigStore(app);
  const aiService = createAiService({ app, configStore });
  const workspace = createSqliteDatabase(app);
  const taskLogStore = createTaskLogStore({ db: workspace.db });
  const technicalPlanStore = createTechnicalPlanStore({
    app,
    db: workspace.db,
    agentService: { deletePersistentTask() {} },
    taskLogStore,
  });

  try {
    const initialState = technicalPlanStore.loadTechnicalPlan();
    const tenderMarkdown = technicalPlanStore.readTenderMarkdown();
    if (!tenderMarkdown.trim()) throw new Error('隔离工作区没有真实招标解析文本');
    const callStats = { bid_planning_llm_calls: 0, outline_llm_calls: 0, outline_repair_calls: 0, section_brief_calls: 0, retrieval_calls: 0, generation_calls: 0 };

    const bidPlan = await generateBidPlan({ aiService, tenderMarkdown, bidAnalysisTasks: initialState.bidAnalysisTasks || {} });
    callStats.bid_planning_llm_calls += 1;
    const parameterRegistry = buildParameterRegistry(bidPlan);
    const responseTables = createResponseTables(bidPlan, parameterRegistry);

    let outlineData = await aiService.requestJson({
      messages: buildOutlineMessages({ bidPlan, responseFormat: initialState.bidAnalysisTasks?.responseFileRequirements?.content }),
      logTitle: '真实E2E-BidPlan目录',
      normalizer: normalizeOutline,
      validator: validateOutline,
    });
    callStats.outline_llm_calls += 1;
    let coverage = calculateOutlineCoverage(bidPlan, outlineData);
    if (coverage.coverage_score < 90) {
      outlineData = await aiService.requestJson({
        messages: buildOutlineMessages({ bidPlan, responseFormat: initialState.bidAnalysisTasks?.responseFileRequirements?.content, missingTopics: [...coverage.missing_topics, ...coverage.partially_covered_topics] }),
        logTitle: '真实E2E-目录覆盖修正',
        normalizer: normalizeOutline,
        validator: validateOutline,
      });
      callStats.outline_repair_calls += 1;
      coverage = calculateOutlineCoverage(bidPlan, outlineData);
    }
    if (coverage.coverage_score < 80) throw new Error(`目录技术覆盖率 ${coverage.coverage_score}% 低于失败线 80%`);

    const populated = populateResponseTableOutline(outlineData, responseTables);
    outlineData = populated.outlineData;
    technicalPlanStore.updateTechnicalPlanWithoutReload({ bidPlan, responseTables, parameterRegistry, outlineData, qualityCheck: { technical_coverage: coverage } });

    const references = loadKnowledgeReferences(workspace.db, initialState.referenceKnowledgeDocumentIds || []);
    const contentPlans = {};
    const generatedLeaves = collectLeaves(outlineData.outline).filter(({ item }) => item.content_mode === 'ai-generate');
    for (let index = 0; index < generatedLeaves.length; index += 1) {
      const { item, parents } = generatedLeaves[index];
      const brief = createSectionBrief({ section: item, parentChapters: parents, bidPlan, parameterRegistry });
      callStats.section_brief_calls += 1;
      const evidencePack = buildEvidencePack({ section: item, brief, references, topK: 6, characterBudget: 12000, threshold: 0.2 });
      callStats.retrieval_calls += evidencePack.queries.length;
      const content = await aiService.chat({
        messages: buildGenerationMessages({ brief, evidencePack, registry: parameterRegistry }),
        logTitle: `真实E2E-章节-${item.id}-${item.title}`,
      });
      callStats.generation_calls += 1;
      technicalPlanStore.saveChapterContent({ nodeId: item.id, content: String(content || '').trim() });
      contentPlans[item.id] = { plan: { section_brief: brief, evidence_pack: evidencePack } };
      process.stdout.write(`[e2e] section ${index + 1}/${generatedLeaves.length}: ${item.title}, evidence=${evidencePack.sources.length}\n`);
    }

    let reloaded = technicalPlanStore.loadTechnicalPlan();
    const finalLeaves = collectLeaves(reloaded.outlineData.outline).filter(({ item }) => item.content_mode === 'ai-generate');
    const editTarget = finalLeaves[0]?.item;
    const regenerateTarget = finalLeaves[1]?.item;
    const editMarker = '\n\n> E2E 人工编辑保留标记：BID-PLAN-V2';
    if (editTarget) technicalPlanStore.saveChapterContent({ nodeId: editTarget.id, content: `${editTarget.content}${editMarker}` });
    reloaded = technicalPlanStore.loadTechnicalPlan();
    const editedBeforeRegeneration = collectLeaves(reloaded.outlineData.outline).find(({ item }) => item.id === editTarget?.id)?.item.content || '';
    let regenerationPassed = true;
    if (regenerateTarget) {
      const plan = contentPlans[regenerateTarget.id]?.plan;
      const regenerated = await aiService.chat({
        messages: [...buildGenerationMessages({ brief: plan.section_brief, evidencePack: plan.evidence_pack, registry: parameterRegistry }), { role: 'user', content: '局部重生成：增强风险控制和验收可执行性，不改动其他章节。' }],
        logTitle: `真实E2E-局部重生成-${regenerateTarget.id}`,
      });
      callStats.generation_calls += 1;
      technicalPlanStore.saveChapterContent({ nodeId: regenerateTarget.id, content: String(regenerated || '').trim() });
      const after = technicalPlanStore.loadTechnicalPlan();
      const editedAfterRegeneration = collectLeaves(after.outlineData.outline).find(({ item }) => item.id === editTarget?.id)?.item.content || '';
      regenerationPassed = editedAfterRegeneration === editedBeforeRegeneration && editedAfterRegeneration.includes('BID-PLAN-V2');
    }

    reloaded = technicalPlanStore.loadTechnicalPlan();
    const qualityCheck = runBidQualityCheck({ bidPlan, outlineData: reloaded.outlineData, responseTables, parameterRegistry, contentPlans });
    technicalPlanStore.updateTechnicalPlanWithoutReload({ qualityCheck });
    const docxPath = path.join(outputDir, 'TEST_GENERATED_BID_V2.docx');
    const docxBuffer = await buildDocxBuffer({
      project_name: initialState.projectOverview?.match(/\*\*项目名称\*\*：([^\n]+)/)?.[1]?.trim() || '台州湾新区起重机设备采购及安装项目',
      outline: reloaded.outlineData.outline,
    });
    fs.writeFileSync(docxPath, docxBuffer);

    const evidenceResults = Object.entries(contentPlans).map(([sectionId, entry]) => ({
      section_id: sectionId,
      title: entry.plan.section_brief.title,
      queries: entry.plan.evidence_pack.queries,
      scopes: entry.plan.evidence_pack.scopes,
      top_k: entry.plan.evidence_pack.sources.map((source) => ({ chunk_id: source.chunk_id, title: source.title, relevance: source.relevance })),
    }));
    const confirmedParameters = parameterRegistry.parameters.filter((item) => item.status === 'CONFIRMED');
    const unknownParameters = parameterRegistry.parameters.filter((item) => item.status !== 'CONFIRMED');
    const summary = {
      source: { tender_file: initialState.tenderFile?.fileName, tender_chars: tenderMarkdown.length, project_number: '台交所招〔2024〕8号' },
      schema_version: workspace.schemaVersion,
      project_type: bidPlan.project_type,
      topic_count: bidPlan.technical_topics.length,
      technical_topics: bidPlan.technical_topics.map((item) => ({ id: item.id, title: item.title, requirement_count: item.requirements.length })),
      required_tables: bidPlan.required_tables.map((item) => item.type),
      populated_tables: populated.populated_types,
      coverage,
      generated_section_count: generatedLeaves.length,
      evidence: {
        sections: evidenceResults.length,
        sections_with_sources: evidenceResults.filter((item) => item.top_k.length).length,
        top_k_relevance_pass_rate: evidenceResults.length ? Number((evidenceResults.filter((item) => item.top_k[0]?.relevance >= 0.2).length / evidenceResults.length * 100).toFixed(1)) : 0,
      },
      parameters: { confirmed: confirmedParameters.length, unknown: unknownParameters.length, placeholder: UNKNOWN_PLACEHOLDER },
      quality_check: qualityCheck,
      regressions: { editing: editedBeforeRegeneration.includes('BID-PLAN-V2'), local_regeneration_preserved_other_section: regenerationPassed, docx: fs.existsSync(docxPath) && fs.statSync(docxPath).size > 0 },
      call_stats: callStats,
      artifact: docxPath,
    };
    fs.writeFileSync(path.join(outputDir, 'bid-plan.json'), `${JSON.stringify(bidPlan, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(outputDir, 'outline.json'), `${JSON.stringify(reloaded.outlineData, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(outputDir, 'section-evidence.json'), `${JSON.stringify(evidenceResults, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(outputDir, 'quality-check.json'), `${JSON.stringify(qualityCheck, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    process.stdout.write(`[e2e] completed: ${JSON.stringify(summary)}\n`);
  } finally {
    workspace.close();
  }
}

main().catch((error) => {
  console.error('[e2e] failed:', error?.stack || error);
  process.exitCode = 1;
});
