// 模板填写：为 content 为空的模板类叶子节点（template-fill / point-to-point / other）
// 生成填充内容并写回节点 content，使导出不再显示「待补充」占位。
//
// 数据源（按可信度排序）：
//   1. 参考知识库（文档知识库）——企业营业执照、资质证书、业绩合同、财务资料等真实材料的唯一来源
//   2. Step02 关键解析结果 + 全局事实 + 项目概述
//   3. 招标文件工作副本（tender.md）——用于理解本节要响应什么
//
// 重要约束：本任务主要覆盖响应函、资格声明、业绩表、财务表、偏离表等**合规章节**。
// 这些章节里的企业名称、注册号、证书号、业绩、财务数据、人员姓名都必须是可举证的既有事实，
// 不允许由模型补齐。资料里没有的，一律写「待补充」并列出人工需准备的材料清单。
//
// 注意：正文（ai-generate）走 contentGenerationTask，它一直有知识库权限；
// 本任务以前只读招标文件与全局事实，因此合规章节完全读不到企业真实材料，只能编——这是本文件的核心修正。
const {
  createSectionBrief,
  buildSectionQueries,
  flattenKnowledgeReferences,
  scoreKnowledgeItem,
  buildEvidencePack,
} = require('./sectionEvidenceService.cjs');
const { classifyResponseSection } = require('./bidQualityService.cjs');

const TEMPLATE_FILL_CONTENT_MODES = new Set(['template-fill', 'point-to-point', 'other']);
const MAX_SOURCE_CHARS_PER_NODE = 3500;
const MAX_GLOBAL_FACTS_CHARS = 1500;
const MAX_SOURCE_SECTION_LINES = 80;

// 合规章节需要的是「完整性」而不是「最相关的 6 条」：营业执照、业绩合同、财务资料
// 分散在知识库不同位置，任何一条漏掉都会变成编造。所以合规章节放宽召回。
const COMPLIANCE_CATEGORIES = new Set(['qualification', 'financial', 'performance', 'certification', 'legal_person']);
const COMPLIANCE_RETRIEVAL = {
  topK: 12,
  characterBudget: 16000,
  threshold: 0.15,
  scopes: ['company', 'historical_project', 'project'],
};
const DEFAULT_RETRIEVAL = { topK: 6, characterBudget: 8000, threshold: 0.2 };

// 单章节生成超时。不传 timeout_ms 时 aiService 会退回 AI_REQUEST_TIMEOUT_MS（10 分钟），
// 16 个合规章节最坏情况就是 160 分钟没有任何反馈——这正是「卡死」的观感来源。
const TEMPLATE_FILL_TIMEOUT_SECONDS = 240;
const TEMPLATE_FILL_TIMEOUT_MS = TEMPLATE_FILL_TIMEOUT_SECONDS * 1000;

// 合规章节的标题（「资格审查资料」）与知识库条目（「营业执照」）之间几乎没有词面重合，
// 单靠语义相似度会把最该引用的材料排到阈值之外。所以合规章节改用关键词召回：
// 先按「什么算合规材料」把候选捞全，再用相似度只做排序，不用它当门槛。
const COMPLIANCE_ITEM_PATTERN = /营业执照|统一社会信用代码|注册码|注册资金|注册资本|实收资本|资质|资格证书|许可证|生产许可|制造许可|体系认证|认证证书|ISO|CE认证|CCC|专利|业绩|供货合同|中标|财务|审计报告|资产负债|银行资信|纳税|社保|法定代表人|授权委托|检测报告|质检报告|荣誉|奖项|企业简介|公司简介|企业概况|组织机构/;

// 送达 Step02 关键解析结果的条目，按「响应文件编制最需要」的顺序排列。
const PROJECT_FACT_ITEMS = [
  ['projectInfo', '项目信息'],
  ['partAInfo', '招标人/甲方信息'],
  ['keyInfo', '投标关键节点与时间'],
  ['marginInfo', '投标保证金要求'],
  ['deliveryAndServiceRequirements', '交货和服务要求'],
  ['procurementList', '采购需求与规格清单摘要'],
  ['responseFileRequirements', '响应文件编制与组成要求'],
  ['qualificationReview', '资格性审查要求'],
];

const MARKDOWN_HEADING_LINE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
// 没有 Markdown 标题时用来识别「疑似新分节」：短行、无句读的编号标题才算，
// 避免把「1. 投标人须具备……」这类正文条款误当成分节边界。
const LOOSE_SECTION_LINE = /^\s*(?:[一二三四五六七八九十]{1,3}[、.）)]|（[一二三四五六七八九十]{1,3}）|\d+(?:\.\d+)*[、.）)])\s*[^。；]{0,30}$/;

function singleLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function textMetricsForNode(node) {
  const title = singleLine(node?.title || '未命名章节');
  const description = singleLine(node?.description || '');
  const note = singleLine(node?.content_mode_note || '');
  return { title, description, note };
}

function sectionKeyword(title) {
  return String(title || '').replace(/[第0-9一二三四五六七八九十章\s、.（）()·]+/g, '').trim();
}

// 在招标原文中按节点标题定位依据文本。
// 优先取「标题行命中的整个分节」，而不是固定 ±N 行的窗口——固定窗口会把相邻章节的要求串进来，
// 这正是合规章节被写出张冠李戴内容的来源之一。
function buildSourceContext(tenderMarkdown, title) {
  const source = String(tenderMarkdown || '');
  if (!source) return '';
  const keyword = sectionKeyword(title);
  if (!keyword) return '';
  const lines = source.split(/\r?\n/);

  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(MARKDOWN_HEADING_LINE);
    if (match) headings.push({ index, level: match[1].length });
  }
  const headingHit = headings.find((item) => lines[item.index].includes(keyword));
  if (headingHit) {
    const next = headings.find((item) => item.index > headingHit.index && item.level <= headingHit.level);
    const end = Math.min(next ? next.index : lines.length, headingHit.index + MAX_SOURCE_SECTION_LINES);
    return lines.slice(headingHit.index, end).join('\n').trim().slice(0, MAX_SOURCE_CHARS_PER_NODE);
  }

  // 招标 Markdown 没有规范标题结构时，用「疑似新分节行」当边界，
  // 至少保留标题后 1 行，确保不会把下一节的要求串进来。
  const index = lines.findIndex((line) => line.includes(keyword));
  if (index < 0) return '';
  let end = Math.min(lines.length, index + MAX_SOURCE_SECTION_LINES);
  for (let cursor = index + 2; cursor < end; cursor += 1) {
    if (LOOSE_SECTION_LINE.test(lines[cursor])) {
      end = cursor;
      break;
    }
  }
  const start = Math.max(0, index - 1);
  return lines.slice(start, end).join('\n').trim().slice(0, MAX_SOURCE_CHARS_PER_NODE);
}

function buildGlobalFactsText(globalFacts) {
  const groups = (Array.isArray(globalFacts) ? globalFacts : [])
    .map((group) => {
      const title = singleLine(group?.title);
      const content = String(group?.content || '').trim();
      return title && content ? `## ${title}\n${content}` : '';
    })
    .filter(Boolean);
  if (!groups.length) return '';
  return groups.join('\n\n').slice(0, MAX_GLOBAL_FACTS_CHARS);
}

// 汇总编制合规章节真正需要的项目事实，替代原来写死在 prompt 里的示例。
function buildProjectFactsText(storedPlan) {
  const blocks = [];
  const overview = String(storedPlan?.projectOverview || '').trim();
  if (overview) blocks.push(`## 项目概述\n${overview}`);
  for (const [itemId, label] of PROJECT_FACT_ITEMS) {
    const item = storedPlan?.bidAnalysisTasks?.[itemId];
    const content = item?.status === 'success' ? String(item.content || '').trim() : '';
    if (content) blocks.push(`## ${label}\n${content}`);
  }
  const facts = buildGlobalFactsText(storedPlan?.globalFacts);
  if (facts) blocks.push(`## 全局事实变量\n${facts}`);
  return blocks.join('\n\n');
}

function normalizeReferenceDocumentIds(storedPlan) {
  const raw = storedPlan?.referenceKnowledgeDocumentIds ?? [];
  return Array.isArray(raw)
    ? [...new Set(raw.map((id) => String(id || '').trim()).filter(Boolean))]
    : [];
}

// 从文档知识库读取正文素材。返回原样 references 交给 buildEvidencePack 做按章节排序。
function loadKnowledgeReferences(knowledgeBaseService, documentIds) {
  if (!documentIds.length) return { references: [], reason: '未选择参考知识库' };
  if (!knowledgeBaseService?.readReferences) return { references: [], reason: '知识库读取服务不可用' };
  try {
    const references = knowledgeBaseService.readReferences(documentIds);
    return { references: Array.isArray(references) ? references : [] };
  } catch (error) {
    return { references: [], reason: `读取参考知识库失败：${error?.message || String(error)}` };
  }
}

function retrievalOptionsForNode(node) {
  const { category } = classifyResponseSection(String(node?.title || ''));
  return COMPLIANCE_CATEGORIES.has(category)
    ? { ...COMPLIANCE_RETRIEVAL, compliance: true, category }
    : { ...DEFAULT_RETRIEVAL, compliance: false, category };
}

// 合规章节取证：关键词召回 + 相似度排序 + 字符预算裁剪。
// 不设相关度阈值——漏掉一条营业执照就会变成编造，宁可多给材料让模型自己筛。
function buildComplianceEvidence({ section, brief, references }) {
  const all = flattenKnowledgeReferences(references);
  const complianceItems = all.filter((item) => COMPLIANCE_ITEM_PATTERN.test(`${item.title} ${item.resume} ${item.content}`));
  const pool = complianceItems.length ? complianceItems : all;
  const queries = buildSectionQueries(brief);
  const ranked = pool
    .map((item) => ({ ...item, relevance: scoreKnowledgeItem(item, queries, COMPLIANCE_RETRIEVAL.scopes) }))
    .sort((left, right) => right.relevance - left.relevance);

  const sources = [];
  let usedCharacters = 0;
  for (const item of ranked) {
    if (sources.length >= COMPLIANCE_RETRIEVAL.topK) break;
    const remaining = COMPLIANCE_RETRIEVAL.characterBudget - usedCharacters;
    if (remaining <= 0) break;
    const content = item.content.slice(0, remaining);
    if (!content.trim()) continue;
    sources.push({
      document_id: item.document_id,
      document_name: item.document_name,
      chunk_id: item.item_id,
      category: item.category,
      relevance: Number(item.relevance.toFixed(3)),
      title: item.title,
      content,
      source_block_ids: item.source_block_ids,
    });
    usedCharacters += content.length;
  }
  return sources.length ? { sources } : null;
}

// 按章节从知识库检索材料。非合规章节复用正文生成同一套检索实现，保证两处口径一致。
function buildNodeEvidence(node, { references, bidPlan, parameterRegistry }) {
  if (!references.length) return null;
  const options = retrievalOptionsForNode(node);
  const section = { id: node.id, title: node.title, description: node.description };
  const brief = createSectionBrief({ section, bidPlan, parameterRegistry });
  if (options.compliance) return buildComplianceEvidence({ section, brief, references });
  const evidencePack = buildEvidencePack({
    section,
    brief,
    references,
    topK: options.topK,
    characterBudget: options.characterBudget,
    threshold: options.threshold,
  });
  return evidencePack.sources.length ? evidencePack : null;
}

// 知识库素材是合规章节里企业自有信息的唯一合法来源，因此要带出处，便于人工核对。
function formatEvidenceForPrompt(evidencePack) {
  if (!evidencePack?.sources?.length) return '';
  return evidencePack.sources
    .map((source) => {
      const label = [source.category, source.title].filter(Boolean).join(' · ');
      const origin = source.document_name ? `（出处：${source.document_name}）` : '';
      return `### ${label || '知识库素材'}${origin}\n${source.content}`;
    })
    .join('\n\n');
}

const COMPLIANCE_RULES = `合规章节编写铁律（违反即视为无效内容）：
1. 企业名称、统一社会信用代码、注册资金、证书编号、资质等级、业绩项目、财务报表数据、人员姓名与职务，只能取自下方「知识库素材」与「项目事实」，不得推测、不得套用常见值、不得编造。
2. 下方材料中没有的信息，必须在该处写「待补充：<需要人工提供什么材料>」，并在本节末尾用列表列出需人工准备的材料清单。
3. 不得声称已获得材料中未列明的资质、认证、专利、奖项或供货业绩。
4. 不得使用「完全满足」「完全响应」等绝对化表述代替具体响应内容。`;

const TABLE_RULES = `表格规范与要求：
1. 必须使用标准 Markdown 管道表格输出（包含表头及对齐分割线，如 | :---: | :--- | :--- | ），行数不少于 3 行真实业务数据。
2. 单元格内容要严谨具体，与当前项目技术规格书深度贴合，不得使用泛化空洞套话。
3. 需要在表格中填入企业自有数据（证书号、业绩、财务、人员）时，一律从下方「知识库素材」与「项目事实」中取；取不到的填「待补充」并说明需要哪份材料，不得虚构。`;

function buildPrompt(item) {
  const { title, description, note } = textMetricsForNode(item);
  const contentMode = item.content_mode;
  const isTableCandidate = /偏离|应答|清单|一览表|配置表|检验表|计划表|矩阵|对照表|明细|主要部件|零部件|设备表/.test(title);
  const modeHint = contentMode === 'point-to-point'
    ? '本节为「点对点应答表」，需按招标文件技术要求/商务要求逐条应答，必须使用标准 Markdown 表格输出。'
    : contentMode === 'other'
      ? `本节为特殊内容：${note || '按知识库/资料情况说明'}`
      : isTableCandidate
        ? '本节为明细/表格类内容，需按工程技术规范使用标准 Markdown 表格输出。'
        : '本节为「模板填写」，需按招标/投标模板填写对应的材料或说明。';

  const evidenceText = item._evidenceText || '';
  const projectFactsText = item._projectFactsText || '';

  const lines = [
    '你是工业工程投标文件编制专家。请为当前投标方案目录中的这一节编写专业、完整、可直接放入投标文件的正文内容。只输出正文内容，不要输出章节标题或过程解释。',
    `章节：${title}`,
    description ? `章节说明：${description}` : '',
    `填写方式：${modeHint}`,
    contentMode === 'point-to-point' || isTableCandidate ? TABLE_RULES : COMPLIANCE_RULES,
  ];

  const sourceContext = buildSourceContext(item._sourceMarkdown, title);
  if (sourceContext) {
    lines.push('招标文件相关要求：');
    lines.push(sourceContext);
  }
  if (evidenceText) {
    lines.push('知识库素材（企业自有材料的唯一来源，引用时必须与原文一致，不得改写数字、编号与名称）：');
    lines.push(evidenceText);
  }
  if (projectFactsText) {
    lines.push('项目事实与企业背景：');
    lines.push(projectFactsText);
  }
  if (!evidenceText && !projectFactsText) {
    lines.push('未提供任何知识库素材与项目事实，企业自有信息一律写「待补充」，不得编造，并在本节末尾列出需人工准备的材料清单。');
  } else if (!evidenceText) {
    lines.push('本节未检索到知识库素材：凡涉及企业自有资质、证书、业绩、财务或人员的信息，一律写「待补充」，不得编造。');
  }

  return lines.filter((line) => line !== '').join('\n\n');
}

// 遍历目录树，收集 content 为空的模板类叶子节点，并挂上数据源上下文。
function collectTemplateFillNodes(outlineData, tenderMarkdown, projectFactsText, evidenceContext) {
  const nodes = [];
  const visit = (items) => {
    for (const item of items || []) {
      if (item?.children?.length) {
        visit(item.children);
        continue;
      }
      // 允许对 template-fill、point-to-point、other 甚至未填写的空节点进行填充
      if (item?.content_mode && !TEMPLATE_FILL_CONTENT_MODES.has(item.content_mode)) continue;
      if (String(item?.content || '').trim()) continue;
      const node = {
        id: String(item.id || ''),
        nodeId: String(item.id || ''),
        title: singleLine(item.title || ''),
        description: singleLine(item.description || ''),
        content_mode: item.content_mode || 'template-fill',
        content_mode_note: item.content_mode_note || '',
        _sourceMarkdown: tenderMarkdown,
        _projectFactsText: projectFactsText,
      };
      const evidencePack = evidenceContext
        ? buildNodeEvidence(node, evidenceContext)
        : null;
      node._evidenceText = formatEvidenceForPrompt(evidencePack);
      node._evidence_source_count = evidencePack?.sources?.length || 0;
      nodes.push(node);
    }
  };
  visit(outlineData?.outline || []);
  return nodes;
}

// 模板填写是一串按章节顺序执行的 AI 请求：没有互斥时重复点击会叠加成两倍请求，
// 界面既看不到进度也无法中断。把并发与取消都收在这里，只有一个活动任务。
let activeTemplateFill = null;

function isTemplateFillRunning() {
  return Boolean(activeTemplateFill);
}

function cancelTemplateFill() {
  if (!activeTemplateFill) {
    return { canceled: false, message: '当前没有正在执行的模板填写任务' };
  }
  activeTemplateFill.abort();
  return { canceled: true, message: '已请求取消模板填写，正在停止当前章节…' };
}

async function runTemplateFillTask({ aiService, workspaceStore, knowledgeBaseService, onProgress, signal } = {}) {
  if (activeTemplateFill) {
    return {
      status: 'busy',
      message: '模板填写正在进行中，请等待当前任务结束，或先点「取消模板填写」。',
      filled: 0,
      skipped: 0,
    };
  }

  const storedPlan = workspaceStore?.loadTechnicalPlan?.() || {};
  if (!storedPlan?.outlineData?.outline?.length) {
    return { status: 'skipped', message: '尚未生成目录', filled: 0, skipped: 0 };
  }
  const tenderMarkdown = workspaceStore?.readTenderMarkdown?.() || '';
  const projectFactsText = buildProjectFactsText(storedPlan);

  const documentIds = normalizeReferenceDocumentIds(storedPlan);
  const { references, reason: knowledgeReason } = loadKnowledgeReferences(knowledgeBaseService, documentIds);
  const evidenceContext = references.length
    ? {
      references,
      bidPlan: storedPlan.bidPlan,
      parameterRegistry: storedPlan.parameterRegistry,
    }
    : null;

  const nodes = collectTemplateFillNodes(storedPlan.outlineData, tenderMarkdown, projectFactsText, evidenceContext);
  if (!nodes.length) {
    return { status: 'skipped', message: '没有需要模板填写的空章节', filled: 0, skipped: 0 };
  }
  if (!aiService?.chat) {
    throw new Error('AI 服务尚未初始化，无法生成模板填写内容');
  }

  const controller = new AbortController();
  activeTemplateFill = controller;
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener?.('abort', () => controller.abort(), { once: true });
  }

  const startedAt = Date.now();
  let filled = 0;
  let failed = 0;
  let canceled = false;
  let processed = 0;
  const errors = [];
  const nodesWithEvidence = [];
  const nodesWithoutEvidence = [];
  onProgress?.({ phase: 'start', total: nodes.length, index: 0, filled, failed });

  try {
    for (const item of nodes) {
      if (controller.signal.aborted) {
        canceled = true;
        break;
      }
      processed += 1;
      if (item._evidence_source_count) nodesWithEvidence.push(item.title);
      else nodesWithoutEvidence.push(item.title);
      // 每个章节开始前都报一次进度：没有进度事件时，16 次串行请求在界面上就是「无响应」。
      onProgress?.({ phase: 'section', index: processed, total: nodes.length, title: item.title, filled, failed });
      try {
        const prompt = buildPrompt(item);
        const content = await aiService.chat({
          messages: [{ role: 'user', content: prompt }],
          temperature_enabled: false,
          timeout_ms: TEMPLATE_FILL_TIMEOUT_MS,
          timeout_message: `模板填写：「${item.title}」生成超时（超过 ${TEMPLATE_FILL_TIMEOUT_SECONDS} 秒），已中止该章节。常见原因是模型过慢或上下文过大，可减少参考知识库文档后重试。`,
          signal: controller.signal,
        });
        const nextContent = String(content || '').trim();
        if (!nextContent) {
          failed += 1;
          errors.push(`${item.title}：生成内容为空`);
          continue;
        }
        workspaceStore.saveChapterContent({ nodeId: item.nodeId, content: nextContent });
        filled += 1;
      } catch (error) {
        // 取消时请求队列抛出的同样是普通错误，信号已中止就按「已取消」处理，不要报成失败。
        if (controller.signal.aborted) {
          canceled = true;
          break;
        }
        failed += 1;
        errors.push(`${item.title}：${error?.message || String(error)}`);
      }
    }
  } finally {
    activeTemplateFill = null;
  }

  // 合规章节没有企业材料就只能整段待补充——这是流程缺陷而不是生成成功，必须显式提示，
  // 否则用户会以为「模板填写完成」等于「材料齐了」。
  const warnings = [];
  if (canceled) {
    warnings.push(`已取消：本次处理了 ${processed}/${nodes.length} 个章节，未处理的章节保持原状。`);
  }
  if (!projectFactsText) {
    warnings.push('未找到项目事实与企业背景（Step02 关键解析结果/全局事实均为空），合规章节只能输出待补充内容；请先完成标书解析或补充全局事实。');
  }
  if (!references.length && documentIds.length) {
    warnings.push(`${knowledgeReason || '参考知识库未返回可用素材'}，合规章节只能输出待补充内容。`);
  } else if (!documentIds.length) {
    warnings.push('本次未选择参考知识库，企业自有材料无从取证，合规章节只能输出待补充内容；请在目录步骤勾选投标文件知识库后重跑模板填写。');
  }
  if (nodesWithoutEvidence.length) {
    warnings.push(`${nodesWithoutEvidence.length} 个章节未检索到知识库素材，已要求写「待补充」：${nodesWithoutEvidence.join('、')}。`);
  }

  const summary = canceled
    ? `已取消模板填写，本次完成 ${filled} 个章节`
    : errors.length
      ? errors.join('；')
      : `已为 ${filled} 个章节填写模板内容`;
  const result = {
    status: canceled ? 'canceled' : failed ? (filled ? 'partial' : 'error') : 'success',
    message: [summary, ...warnings].filter(Boolean).join('；'),
    filled,
    skipped: nodes.length - filled,
    failed,
    errors,
    facts_available: Boolean(projectFactsText),
    knowledge_documents: documentIds.length,
    knowledge_references: references.length,
    evidence_section_count: nodesWithEvidence.length,
    no_evidence_sections: nodesWithoutEvidence,
    total_sections: nodes.length,
    processed_sections: processed,
    canceled,
    elapsed_ms: Date.now() - startedAt,
  };
  onProgress?.({ phase: 'done', total: nodes.length, index: processed, filled, failed, canceled });
  return result;
}

module.exports = {
  runTemplateFillTask,
  cancelTemplateFill,
  isTemplateFillRunning,
  buildProjectFactsText,
  buildSourceContext,
  buildPrompt,
  loadKnowledgeReferences,
  buildNodeEvidence,
  formatEvidenceForPrompt,
  retrievalOptionsForNode,
};
