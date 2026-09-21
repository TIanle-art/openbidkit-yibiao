const PROJECT_TYPES = new Set([
  'equipment_procurement',
  'goods_procurement',
  'engineering',
  'service',
  'software_it',
  'mixed',
]);

const REQUIRED_TABLE_TYPES = new Set([
  'technical_parameter_response',
  'technical_deviation',
  'supply_scope',
]);

const UNKNOWN_PLACEHOLDER = '待确认';

function uniqueStrings(value, limit = Infinity) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean))].slice(0, limit);
}

function normalizeSourceRefs(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      if (typeof item === 'string') return { label: item.trim() };
      if (!item || typeof item !== 'object') return null;
      return {
        ...(item.source_id ? { source_id: String(item.source_id) } : {}),
        ...(item.page ? { page: String(item.page) } : {}),
        ...(item.section ? { section: String(item.section) } : {}),
        ...(item.chunk_id ? { chunk_id: String(item.chunk_id) } : {}),
        ...(item.label ? { label: String(item.label) } : {}),
      };
    })
    .filter((item) => item && Object.keys(item).length);
}

function normalizeRequirement(value) {
  if (typeof value === 'string') return { text: value.trim(), source_refs: [] };
  if (!value || typeof value !== 'object') return null;
  const text = String(value.text || value.requirement || value.content || '').trim();
  if (!text) return null;
  return { text, source_refs: normalizeSourceRefs(value.source_refs || value.sources) };
}

function classifyProject(input) {
  const text = String(input || '').toLowerCase();
  const hasSoftware = /软件|信息化|平台|系统开发|it\b|saas|网络安全/.test(text);
  const hasEngineering = /施工总承包|工程建设|土建|改造工程|装饰工程|建筑工程/.test(text);
  const hasService = /咨询|运维|服务采购|培训服务|监理|审计|设计服务/.test(text);
  const hasEquipment = /设备采购|设备供货|机械设备|机电设备|起重机|安装调试|成套设备/.test(text);
  const hasGoods = /货物采购|物资采购|材料采购|商品采购|供货/.test(text);
  const flags = [hasSoftware, hasEngineering, hasService, hasEquipment || hasGoods].filter(Boolean).length;
  let primary = 'service';
  if (flags > 1 && !hasEquipment) primary = 'mixed';
  else if (hasEquipment) primary = 'equipment_procurement';
  else if (hasGoods) primary = 'goods_procurement';
  else if (hasEngineering) primary = 'engineering';
  else if (hasSoftware) primary = 'software_it';
  const secondary = [];
  if ((hasEquipment || hasGoods) && /安装|调试|培训|售后|维保/.test(text)) secondary.push('installation_service');
  if (primary !== 'engineering' && hasEngineering) secondary.push('engineering');
  if (primary !== 'service' && hasService) secondary.push('service');
  if (primary !== 'software_it' && hasSoftware) secondary.push('software_it');
  return { primary, secondary: uniqueStrings(secondary) };
}

function normalizeSecondaryTypes(value, inferred = [], primary = '') {
  const aliases = new Map([
    ['installation', 'installation_service'],
    ['installation_service', 'installation_service'],
    ['installation-and-commissioning', 'installation_service'],
    ['安装', 'installation_service'],
    ['安装服务', 'installation_service'],
    ['engineering', 'engineering'],
    ['service', 'service'],
    ['software_it', 'software_it'],
  ]);
  const inferredValues = primary === 'equipment_procurement'
    ? inferred.filter((item) => item === 'installation_service')
    : inferred;
  return uniqueStrings([...(Array.isArray(value) ? value : []), ...inferredValues]
    .map((item) => aliases.get(String(item || '').trim().toLowerCase()))
    .filter(Boolean));
}

function splitSourceClauses(sourceText) {
  return uniqueStrings(String(sourceText || '')
    .split(/\r?\n|[。；;]/)
    .flatMap((line) => line.length > 260 ? line.split(/[，,]/) : [line])
    .map((line) => line.replace(/^\s*(?:[-*#>|]+|\d+[.、）)])\s*/, '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 6 && line.length <= 420));
}

function extractProcurementTargetsFromText(sourceText) {
  const lines = String(sourceText || '').split(/\r?\n/);
  const targets = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    if (!/^\s*\|/.test(header) || !/(?:设备|货物|采购内容).*名称/.test(header) || !/数量/.test(header)) continue;
    const columns = header.split('|').slice(1, -1).map((item) => item.trim());
    const nameIndex = columns.findIndex((item) => /名称/.test(item));
    const modelIndex = columns.findIndex((item) => /规格|型号/.test(item));
    const quantityIndex = columns.findIndex((item) => /数量/.test(item));
    const unitIndex = columns.findIndex((item) => /单位/.test(item));
    for (let rowIndex = index + 2; rowIndex < lines.length && /^\s*\|/.test(lines[rowIndex]); rowIndex += 1) {
      const cells = lines[rowIndex].split('|').slice(1, -1).map((item) => item.trim());
      const clean = (value) => String(value || '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
      const name = clean(cells[nameIndex]);
      if (!name || /^[-:]+$/.test(name)) continue;
      const modelValue = modelIndex >= 0 ? clean(cells[modelIndex]) : '';
      const model = modelValue === '/' ? '' : modelValue;
      const quantity = quantityIndex >= 0 ? clean(cells[quantityIndex]) : '';
      if (!/^\d+(?:\.\d+)?$/.test(quantity)) continue;
      targets.push({
        name: model && !name.includes(model) ? `${model} ${name}` : name,
        model,
        quantity,
        unit: unitIndex >= 0 ? String(cells[unitIndex] || '').trim() : '',
        category: 'equipment',
        source_refs: [{ label: '招标文件设备/货物清单' }],
      });
    }
  }
  return targets.filter((item, index) => targets.findIndex((candidate) => candidate.name === item.name && candidate.quantity === item.quantity) === index);
}

const EQUIPMENT_TOPIC_TAXONOMY = [
  { key: 'overall', title: '总体技术方案与性能指标', pattern: /总体|总体设计|型号|规格|额定|工作级别|跨度|生产能力|整车重量/ },
  { key: 'structure', title: '主要结构与材料设计', pattern: /钢结构|主梁|支腿|门架|桁架|钢材|材质|材料|吊具|车轮/, keywords: ['钢结构', '主梁', '支腿', '门架'] },
  { key: 'functional_mechanism', title: '核心功能机构与传动系统', pattern: /起升|吊钩|钢丝绳|卷筒|制动|葫芦|传动机构/, keywords: ['起升机构', '钢丝绳', '卷筒', '制动'] },
  { key: 'travel', title: '运行机构与轨道系统', pattern: /大车|小车|运行机构|行走|轨道|轨型|减速器/, keywords: ['大车运行', '小车运行', '轨道'] },
  { key: 'electrical_control', title: '供配电、电气与自动控制', pattern: /电气|电控|电源|电动机|电机|变频|PLC|控制柜|动力柜|滑触线|电缆|遥控/i, keywords: ['电气系统', 'PLC', '变频控制', '控制柜'] },
  { key: 'safety', title: '安全保护、防风与防碰撞', pattern: /安全保护|限位|超载|防风|防撞|地锚|夹轮|铁鞋|缆风|联锁/, keywords: ['限位', '超载保护', '防风', '防碰撞'] },
  { key: 'monitoring', title: '联动控制、安全监控与信息化', pattern: /双机联动|视频|安全监控|物联网|ERP|数据传输|信息化|智慧工厂|接口/i, keywords: ['双机联动', '安全监控', '视频监控', 'ERP接口'] },
  { key: 'manufacturing', title: '制造工艺、焊接与防腐涂装', pattern: /制造|焊接|无损|探伤|涂装|防腐|喷砂|冲砂|工艺评定|机加工/, keywords: ['制造工艺', '焊接', '无损检测', '防腐涂装'] },
  { key: 'inspection', title: '质量保证、检测与出厂试验', pattern: /质量保证|质量控制|检验|检测|试验|测试|出厂|联合试运转/ },
  { key: 'supply_transport', title: '供货范围、包装与运输', pattern: /供货范围|供货清单|采购清单|配套设备|包装|运输|发运|称重/ },
  { key: 'installation', title: '现场施工、吊装与安装', pattern: /施工组织|吊装|安装方案|现场安装|现场组装|安装工程/ },
  { key: 'commissioning', title: '调试、试运行与交付', pattern: /调试|试运行|试运转|联调|交付/ },
  { key: 'acceptance', title: '载荷试验与验收', pattern: /验收|载荷试验|静载|动载|检测合格|验收证书/ },
  { key: 'training', title: '人员培训与技术资料', pattern: /培训|操作人员|维修人员|培训教材|操作维修手册|技术资料/ },
  { key: 'service', title: '售后服务、质保与备品备件', pattern: /售后|质保期|响应时间|巡检|维保|维护|备件|备品|易损件|专用工具/ },
];

function enrichEquipmentTopics(topics, sourceText) {
  if (String(sourceText || '').length < 1500) return topics;
  const clauses = splitSourceClauses(sourceText);
  const derived = EQUIPMENT_TOPIC_TAXONOMY.map((definition, index) => {
    const matches = clauses.filter((clause) => definition.pattern.test(clause)).slice(0, 8);
    if (!matches.length) return null;
    return {
      id: `T${String(index + 1).padStart(3, '0')}`,
      title: definition.title,
      requirements: matches.map((text) => ({ text, source_refs: [{ label: '招标原文语义提取' }] })),
      source_refs: [{ label: '招标原文语义提取' }],
      importance: ['safety', 'inspection', 'acceptance'].includes(definition.key) ? 'critical' : 'high',
      recommended_section: definition.title,
      evidence_categories: [definition.key, 'technical'],
      keywords: uniqueStrings([
        definition.title,
        ...(definition.keywords || []).filter((keyword) => String(sourceText).toLowerCase().includes(keyword.toLowerCase())),
        ...matches.flatMap((text) => text.match(/[A-Za-z]+|[\u4e00-\u9fa5]{2,8}/g) || []),
      ], 16),
    };
  }).filter(Boolean);
  return derived.length >= 8 ? derived : topics;
}

function normalizeTechnicalTopics(value) {
  const topics = [];
  const seenIds = new Set();
  (Array.isArray(value) ? value : []).forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    let id = String(raw.id || `T${String(index + 1).padStart(3, '0')}`).trim();
    if (!/^T[0-9A-Za-z_-]+$/.test(id) || seenIds.has(id)) id = `T${String(index + 1).padStart(3, '0')}`;
    const title = String(raw.title || raw.topic || '').trim();
    if (!title) return;
    seenIds.add(id);
    const requirements = (Array.isArray(raw.requirements) ? raw.requirements : raw.source_requirements || [])
      .map(normalizeRequirement)
      .filter(Boolean);
    topics.push({
      id,
      title,
      requirements,
      source_refs: normalizeSourceRefs(raw.source_refs),
      importance: ['critical', 'high', 'medium', 'low'].includes(raw.importance) ? raw.importance : 'medium',
      recommended_section: String(raw.recommended_section || title).trim() || title,
      evidence_categories: uniqueStrings(raw.evidence_categories || []),
      keywords: uniqueStrings([title, ...(raw.keywords || [])], 12),
    });
  });
  return topics;
}

function normalizeRequiredTables(value, context = {}) {
  const tables = [];
  const seen = new Set();
  (Array.isArray(value) ? value : []).forEach((raw) => {
    const type = typeof raw === 'string' ? raw : raw?.type;
    if (!REQUIRED_TABLE_TYPES.has(type) || seen.has(type)) return;
    seen.add(type);
    tables.push({
      type,
      required: raw?.required !== false,
      template_preferred: raw?.template_preferred !== false,
      template_title: String(raw?.template_title || '').trim(),
      columns: uniqueStrings(raw?.columns || []),
      source_refs: normalizeSourceRefs(raw?.source_refs),
      reason: String(raw?.reason || '').trim(),
    });
  });
  const add = (type, reason) => {
    if (seen.has(type)) return;
    seen.add(type);
    tables.push({ type, required: true, template_preferred: true, template_title: '', columns: [], source_refs: [], reason });
  };
  const sourceText = String(context.sourceText || '');
  if (context.technicalTopicCount > 0 || /技术参数|技术响应/.test(sourceText)) add('technical_parameter_response', '存在需要逐项响应的技术要求');
  if (/技术偏离|偏差表|偏离表/.test(sourceText)) add('technical_deviation', '招标文件要求技术偏离响应');
  if (context.procurementTargetCount > 0 || /供货范围|供货清单|采购清单|成套设备/.test(sourceText)) add('supply_scope', '存在设备或货物供货范围');
  return tables;
}

function normalizeBidPlan(value, context = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const inferredClassification = classifyProject(context.sourceText || JSON.stringify(raw));
  const rawPrimary = String(raw.project_type?.primary || raw.project_type || '').trim();
  const projectType = {
    primary: PROJECT_TYPES.has(rawPrimary) ? rawPrimary : inferredClassification.primary,
    secondary: normalizeSecondaryTypes(raw.project_type?.secondary, inferredClassification.secondary, PROJECT_TYPES.has(rawPrimary) ? rawPrimary : inferredClassification.primary),
  };
  const rawTargets = Array.isArray(raw.procurement_targets) && raw.procurement_targets.length
    ? raw.procurement_targets
    : extractProcurementTargetsFromText(context.sourceText);
  const procurementTargets = rawTargets
    .map((item) => ({
      name: String(item?.name || '').trim(),
      model: String(item?.model || '').trim(),
      quantity: item?.quantity === undefined || item?.quantity === null ? UNKNOWN_PLACEHOLDER : String(item.quantity).trim(),
      unit: String(item?.unit || '').trim(),
      category: String(item?.category || '').trim(),
      source_refs: normalizeSourceRefs(item?.source_refs),
    }))
    .filter((item) => item.name);
  const normalizedTopics = normalizeTechnicalTopics(raw.technical_topics);
  const technicalTopics = projectType.primary === 'equipment_procurement'
    ? enrichEquipmentTopics(normalizedTopics, context.sourceText)
    : normalizedTopics;
  return {
    schema_version: 1,
    project_type: projectType,
    procurement_targets: procurementTargets,
    project_characteristics: uniqueStrings(raw.project_characteristics),
    technical_topics: technicalTopics,
    parameter_candidates: (Array.isArray(raw.parameter_candidates) ? raw.parameter_candidates : [])
      .map((item, index) => ({
        key: String(item?.key || `parameter_${index + 1}`).trim(),
        label: String(item?.label || item?.name || '').trim(),
        tender_requirement: String(item?.tender_requirement || item?.requirement || '').trim(),
        bid_value: UNKNOWN_PLACEHOLDER,
        status: 'UNKNOWN',
        source_refs: normalizeSourceRefs(item?.source_refs),
      })).filter((item) => item.label && item.tender_requirement),
    service_topics: uniqueStrings(raw.service_topics),
    required_tables: normalizeRequiredTables(raw.required_tables, {
      sourceText: context.sourceText,
      technicalTopicCount: technicalTopics.length,
      procurementTargetCount: procurementTargets.length,
    }),
    evaluation_topics: (Array.isArray(raw.evaluation_topics) ? raw.evaluation_topics : [])
      .map((item) => ({
        topic: String(item?.topic || '').trim(),
        score: String(item?.score || '').trim(),
        requirement: String(item?.requirement || '').trim(),
        source_refs: normalizeSourceRefs(item?.source_refs),
      })).filter((item) => item.topic),
    proposal_parts: uniqueStrings(raw.proposal_parts),
    unknowns: uniqueStrings(raw.unknowns),
    call_stats: { bid_planning_llm_calls: 1 },
  };
}

function validateBidPlan(plan) {
  if (!PROJECT_TYPES.has(plan?.project_type?.primary)) throw new Error('Bid Plan 缺少有效项目主类型');
  if (!Array.isArray(plan?.technical_topics) || !plan.technical_topics.length) throw new Error('Bid Plan 未提取到技术主题');
  const ids = new Set();
  for (const topic of plan.technical_topics) {
    if (!topic.id || ids.has(topic.id)) throw new Error(`Bid Plan 技术主题 id 无效或重复：${topic.id || '空'}`);
    if (!topic.title) throw new Error(`Bid Plan 技术主题 ${topic.id} 缺少标题`);
    ids.add(topic.id);
  }
}

function buildBidPlanningMessages({ tenderMarkdown, bidAnalysisTasks = {} }) {
  const analysis = Object.fromEntries(Object.entries(bidAnalysisTasks)
    .filter(([, item]) => item?.status === 'success' && String(item.content || '').trim())
    .map(([id, item]) => [id, item.content]));
  return [
    {
      role: 'system',
      content: `你是标书规划器。你的任务不是写正文，而是完整判断这份招标文件最终要求投标文件写什么。只依据招标原文与已提取事实；把多个相关要求聚类为专业技术主题，禁止一个参数一个章节，也禁止把所有设备参数笼统并为一个“设备技术规格”主题。设备类项目应按原文实际要求区分总体方案、结构材料、功能机构、运行/传动、电气控制、安全保护、监控信息化、制造检验、供货实施、调试验收和服务等专业层次。禁止根据文件名或单一项目写死目录。只输出 JSON。`,
    },
    {
      role: 'user',
      content: `已提取事实：\n${JSON.stringify(analysis, null, 2)}\n\n招标文件原文：\n${String(tenderMarkdown || '')}`,
    },
    {
      role: 'user',
      content: `生成 Bid Plan JSON，顶层字段必须为：project_type、procurement_targets、project_characteristics、technical_topics、parameter_candidates、service_topics、required_tables、evaluation_topics、proposal_parts、unknowns。

project_type.primary 只能是 equipment_procurement、goods_procurement、engineering、service、software_it、mixed；secondary 是数组。technical_topics 每项必须包含 id（T001 起）、title、requirements（数组，每项含 text 与 source_refs）、source_refs、importance、recommended_section、evidence_categories、keywords。主题必须覆盖设备/系统组成、功能、安全、制造、实施、调试、验收、培训、售后等招标原文实际要求，但应专业聚类。parameter_candidates 用结构化条目提取跨章节必须一致的技术参数，字段为 key、label、tender_requirement、source_refs；只写招标要求，不推断 bid_value。required_tables.type 只使用 technical_parameter_response、technical_deviation、supply_scope，并在招标存在模板时填写 template_title、columns、source_refs、template_preferred=true。所有来源尽量保留章节、页码、表格或原文标签。未知事实写入 unknowns，不得把招标最低要求当成投标确认值。`,
    },
  ];
}

async function generateBidPlan({ aiService, tenderMarkdown, bidAnalysisTasks }) {
  const sourceText = `${tenderMarkdown || ''}\n${JSON.stringify(bidAnalysisTasks || {})}`;
  return aiService.requestJson({
    messages: buildBidPlanningMessages({ tenderMarkdown, bidAnalysisTasks }),
    progressLabel: '标书规划',
    failureMessage: '标书规划结果不是有效 JSON',
    logTitle: '招标解析-Bid Planning',
    normalizer: (value) => normalizeBidPlan(value, { sourceText }),
    validator: validateBidPlan,
  });
}

function normalizeForMatch(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function bigrams(value) {
  const text = normalizeForMatch(value);
  if (text.length < 2) return text ? [text] : [];
  return Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2));
}

function similarity(left, right) {
  const a = new Set(bigrams(left));
  const b = new Set(bigrams(right));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return (2 * intersection) / (a.size + b.size);
}

function flattenOutline(items, parentTitles = [], result = []) {
  for (const item of items || []) {
    const path = [...parentTitles, item.title || ''];
    result.push({
      id: String(item.id || ''),
      text: `${path.join(' ')} ${item.description || ''}`,
      technical_topic_ids: uniqueStrings(item.technical_topic_ids || item.source_topic_ids || []),
    });
    flattenOutline(item.children, path, result);
  }
  return result;
}

function calculateOutlineCoverage(bidPlan, outlineData) {
  const nodes = flattenOutline(outlineData?.outline || []);
  const topics = bidPlan?.technical_topics || [];
  const results = topics.map((topic) => {
    const exactNodes = nodes.filter((node) => node.technical_topic_ids.includes(topic.id));
    if (exactNodes.length) return { topic_id: topic.id, title: topic.title, status: 'covered', node_ids: exactNodes.map((node) => node.id), score: 1 };
    const candidates = nodes.map((node) => ({ node, score: Math.max(
      similarity(topic.title, node.text),
      similarity(topic.recommended_section, node.text),
      ...topic.keywords.map((keyword) => similarity(keyword, node.text)),
    ) })).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const status = best?.score >= 0.72 ? 'covered' : best?.score >= 0.38 ? 'partial' : 'missing';
    return { topic_id: topic.id, title: topic.title, status, node_ids: status === 'missing' ? [] : [best.node.id], score: Number((best?.score || 0).toFixed(3)) };
  });
  const covered = results.filter((item) => item.status === 'covered');
  const partial = results.filter((item) => item.status === 'partial');
  const missing = results.filter((item) => item.status === 'missing');
  const weighted = covered.length + partial.length * 0.5;
  return {
    covered_topics: covered,
    partially_covered_topics: partial,
    missing_topics: missing,
    // 没有技术主题时不能报 "100% 覆盖"：那是提取失败，而不是覆盖完美。
    // computable=false 时 coverage_score 固定为 0，调用方必须据此区分"未提取到主题"与"主题全部覆盖"。
    computable: topics.length > 0,
    coverage_score: topics.length ? Number((weighted / topics.length * 100).toFixed(1)) : 0,
    covered_count: covered.length,
    total_count: topics.length,
  };
}

function createResponseTables(bidPlan, parameterRegistry) {
  const tables = {};
  const parametersByKey = new Map((parameterRegistry?.parameters || []).map((item) => [item.key, item]));
  for (const spec of bidPlan?.required_tables || []) {
    if (spec.type === 'technical_parameter_response') {
      tables[spec.type] = {
        type: spec.type,
        title: spec.template_title || '技术参数响应表',
        source: spec.source_refs,
        columns: spec.columns.length ? spec.columns : ['技术要求', '投标响应', '偏离情况', '证据'],
        rows: (bidPlan.parameter_candidates?.length
          ? bidPlan.parameter_candidates.map((parameter) => ({ topic: null, parameter, title: parameter.label, requirement: { text: parameter.tender_requirement, source_refs: parameter.source_refs } }))
          : (bidPlan.technical_topics || []).flatMap((topic) => topic.requirements.map((requirement) => ({ topic, title: topic.title, requirement }))))
          .map(({ topic, parameter, title, requirement }) => {
          const registered = parameter?.key ? parametersByKey.get(parameter.key) : null;
          const confirmed = registered?.status === 'CONFIRMED';
          return {
          parameter_key: parameter?.key || '',
          topic_id: topic?.id || '',
          requirement: { name: title, value: requirement.text, source: requirement.source_refs },
          response: {
            value: confirmed ? registered.bid_value : UNKNOWN_PLACEHOLDER,
            evidence: confirmed ? registered.source_refs || [] : [],
            status: confirmed ? 'CONFIRMED' : 'UNKNOWN',
          },
          deviation: confirmed ? '无偏离' : UNKNOWN_PLACEHOLDER,
        };
        }),
      };
    } else if (spec.type === 'technical_deviation') {
      tables[spec.type] = {
        type: spec.type,
        title: spec.template_title || '技术偏离表',
        source: spec.source_refs,
        columns: spec.columns.length ? spec.columns : ['序号', '招标要求', '投标响应', '偏离说明'],
        rows: (bidPlan.technical_topics || []).flatMap((topic) => topic.requirements.map((requirement, index) => ({
          sequence: index + 1,
          topic_id: topic.id,
          tender_requirement: requirement.text,
          response: UNKNOWN_PLACEHOLDER,
          status: 'UNKNOWN',
          deviation: UNKNOWN_PLACEHOLDER,
          evidence: [],
        }))),
      };
    } else if (spec.type === 'supply_scope') {
      tables[spec.type] = {
        type: spec.type,
        title: spec.template_title || '供货范围表',
        source: spec.source_refs,
        columns: spec.columns.length ? spec.columns : ['设备名称', '型号', '数量', '单位', '供货范围', '备注'],
        rows: (bidPlan.procurement_targets || []).map((target) => ({
          equipment_name: target.name,
          model: target.model || UNKNOWN_PLACEHOLDER,
          quantity: target.quantity || UNKNOWN_PLACEHOLDER,
          unit: target.unit || UNKNOWN_PLACEHOLDER,
          supply_scope: UNKNOWN_PLACEHOLDER,
          status: 'UNKNOWN',
          evidence: [],
          note: UNKNOWN_PLACEHOLDER,
        })),
      };
    }
  }
  return tables;
}

function markdownCell(value) {
  const text = value === undefined || value === null || value === '' ? UNKNOWN_PLACEHOLDER : String(value);
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function responseCellForColumn(table, row, column, index) {
  const name = String(column || '');
  if (/序号|编号/.test(name)) return row.sequence || index + 1;
  if (table.type === 'technical_parameter_response') {
    if (/参数名|指标名|项目|名称/.test(name) && !/设备/.test(name)) return row.requirement?.name;
    if (/招标|要求|标准|技术参数/.test(name) && !/投标|响应/.test(name)) return row.requirement?.value;
    if (/投标|响应/.test(name)) return row.response?.value;
    if (/偏离|偏差/.test(name)) return row.deviation;
    if (/证据|依据|来源/.test(name)) return row.response?.evidence?.length ? row.response.evidence.map((item) => item.label || item.section || item.page || item.chunk_id || '').filter(Boolean).join('；') : UNKNOWN_PLACEHOLDER;
  }
  if (table.type === 'technical_deviation') {
    if (/招标|要求|条款/.test(name)) return row.tender_requirement;
    if (/投标|响应/.test(name)) return row.response;
    if (/偏离|偏差|说明/.test(name)) return row.deviation;
  }
  if (table.type === 'supply_scope') {
    if (/设备|货物|名称/.test(name)) return row.equipment_name;
    if (/型号|规格/.test(name)) return row.model;
    if (/数量/.test(name)) return row.quantity;
    if (/单位/.test(name)) return row.unit;
    if (/范围|配置|组成/.test(name)) return row.supply_scope;
    if (/备注|说明/.test(name)) return row.note;
  }
  return UNKNOWN_PLACEHOLDER;
}

function renderResponseTableMarkdown(table) {
  if (!table?.columns?.length) return '';
  const header = `| ${table.columns.map(markdownCell).join(' | ')} |`;
  const divider = `| ${table.columns.map(() => '---').join(' | ')} |`;
  const rows = (table.rows || []).map((row, index) => {
    const cells = table.columns.map((column) => responseCellForColumn(table, row, column, index));
    return `| ${cells.map(markdownCell).join(' | ')} |`;
  });
  return [header, divider, ...rows].join('\n');
}

function responseTableTypeForTitle(title) {
  const value = String(title || '');
  if (/技术参数.*响应|参数响应表|产品技术性能.*响应/.test(value)) return 'technical_parameter_response';
  if (/技术偏离|技术偏差/.test(value)) return 'technical_deviation';
  if (/供货范围|成套设备供货|设备供货清单/.test(value)) return 'supply_scope';
  return '';
}

function populateResponseTableOutline(outlineData, responseTables) {
  const populatedTypes = new Set();
  const map = (items) => (items || []).map((item) => {
    if (item?.children?.length) return { ...item, children: map(item.children) };
    const type = responseTableTypeForTitle(item?.title);
    const table = type ? responseTables?.[type] : null;
    if (!table) return item;
    populatedTypes.add(type);
    return {
      ...item,
      content_mode: item.content_mode || 'template-fill',
      content: renderResponseTableMarkdown(table),
    };
  });
  return {
    outlineData: { ...outlineData, outline: map(outlineData?.outline || []) },
    populated_types: [...populatedTypes],
  };
}

function buildParameterRegistry(bidPlan, companyFacts = [], userOverrides = []) {
  const entries = new Map();
  const set = (key, value) => {
    const existing = entries.get(key);
    const priority = { tender_requirement: 1, company_evidence: 2, project_confirmed: 3, user_override: 4 }[value.source_type] || 0;
    const existingPriority = existing ? ({ tender_requirement: 1, company_evidence: 2, project_confirmed: 3, user_override: 4 }[existing.source_type] || 0) : -1;
    if (!existing || priority >= existingPriority) entries.set(key, value);
  };
  (bidPlan?.parameter_candidates?.length ? bidPlan.parameter_candidates : (bidPlan?.technical_topics || []).flatMap((topic) => topic.requirements.map((requirement, index) => ({
    key: `tender_${topic.id}_${index + 1}`,
    label: topic.title,
    tender_requirement: requirement.text,
    source_refs: requirement.source_refs,
  })))).forEach((parameter) => {
    const key = String(parameter.key || '').trim();
    set(key, {
      key,
      label: parameter.label,
      tender_requirement: parameter.tender_requirement,
      bid_value: UNKNOWN_PLACEHOLDER,
      status: 'UNKNOWN',
      source_type: 'tender_requirement',
      source_refs: parameter.source_refs,
      confidence: 1,
    });
  });
  for (const fact of [...companyFacts, ...userOverrides]) {
    const key = String(fact?.key || '').trim();
    if (!key) continue;
    const confirmed = String(fact?.value || '').trim();
    set(key, {
      key,
      label: String(fact.label || key),
      tender_requirement: String(fact.tender_requirement || ''),
      bid_value: confirmed || UNKNOWN_PLACEHOLDER,
      status: confirmed ? 'CONFIRMED' : 'UNKNOWN',
      source_type: fact.source_type || (userOverrides.includes(fact) ? 'user_override' : 'company_evidence'),
      source_refs: normalizeSourceRefs(fact.source_refs),
      confidence: Number(fact.confidence ?? (confirmed ? 1 : 0)),
    });
  }
  return { schema_version: 1, unknown_placeholder: UNKNOWN_PLACEHOLDER, parameters: [...entries.values()] };
}

module.exports = {
  PROJECT_TYPES,
  REQUIRED_TABLE_TYPES,
  UNKNOWN_PLACEHOLDER,
  classifyProject,
  extractProcurementTargetsFromText,
  enrichEquipmentTopics,
  normalizeBidPlan,
  validateBidPlan,
  buildBidPlanningMessages,
  generateBidPlan,
  calculateOutlineCoverage,
  createResponseTables,
  renderResponseTableMarkdown,
  populateResponseTableOutline,
  buildParameterRegistry,
  similarity,
};
