const { calculateOutlineCoverage, similarity } = require('./bidPlanningService.cjs');

function normalize(value) {
  return String(value || '').replace(/\s+/g, '').replace(/[，。；：、“”‘’（）()\[\]【】]/g, '');
}

function collectLeaves(items, result = []) {
  for (const item of items || []) {
    if (item?.children?.length) collectLeaves(item.children, result);
    else result.push(item);
  }
  return result;
}

function collectAllNodes(items, result = []) {
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    result.push(item);
    collectAllNodes(item.children, result);
  }
  return result;
}

function findDuplicateSections(outlineData) {
  const leaves = collectLeaves(outlineData?.outline || []).filter((item) => String(item.content || '').trim());
  const duplicates = [];
  for (let leftIndex = 0; leftIndex < leaves.length; leftIndex += 1) {
    const leftParagraphs = new Set(String(leaves[leftIndex].content).split(/\n{2,}/).map(normalize).filter((text) => text.length >= 80));
    for (let rightIndex = leftIndex + 1; rightIndex < leaves.length; rightIndex += 1) {
      const rightParagraphs = new Set(String(leaves[rightIndex].content).split(/\n{2,}/).map(normalize).filter((text) => text.length >= 80));
      const shared = [...leftParagraphs].filter((text) => rightParagraphs.has(text));
      if (shared.length) duplicates.push({ left_section_id: leaves[leftIndex].id, right_section_id: leaves[rightIndex].id, duplicate_paragraphs: shared.length });
    }
  }
  return duplicates;
}

function findParameterConflicts(outlineData, parameterRegistry) {
  const content = collectLeaves(outlineData?.outline || []).map((item) => ({ id: item.id, content: String(item.content || '') }));
  const conflicts = [];
  for (const parameter of parameterRegistry?.parameters || []) {
    if (parameter.status !== 'CONFIRMED' || !parameter.label || !parameter.bid_value) continue;
    const escapedLabel = parameter.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const values = [];
    for (const section of content) {
      const pattern = new RegExp(`${escapedLabel}[^。；，,\\n]{0,20}?([0-9]+(?:\\.[0-9]+)?\\s*(?:t|m|mm|kW|V|天|年|个月|小时)?)`, 'gi');
      for (const match of section.content.matchAll(pattern)) values.push({ section_id: section.id, value: match[1].replace(/\s+/g, '') });
    }
    const confirmed = normalize(parameter.bid_value).toLowerCase();
    const mismatches = values.filter((item) => normalize(item.value).toLowerCase() !== confirmed);
    if (mismatches.length) conflicts.push({ key: parameter.key, label: parameter.label, confirmed_value: parameter.bid_value, occurrences: mismatches });
  }
  return conflicts;
}

// 企业/产品的可举证事实模式。这些内容都必须能在证据包或招标原文中找到出处，
// 否则属于「无证据的直接事实主张」，导出后就是评审眼里的编造。
const COMPANY_PREFIX = '(?:我公司|本公司|我司|本单位|我方|公司)';
const CLAIM_PATTERNS = [
  // 设备、人员、业绩数量类主张
  new RegExp(`${COMPANY_PREFIX}(?:现有|拥有|具备|配置|配备|下设)[^。；\\n]{0,80}(?:\\d|台|项|名|人|套|条)`, 'g'),
  new RegExp(`${COMPANY_PREFIX}(?:曾|已|先后|累计)(?:完成|实施|承建|承接|供货|提供|销售)[^。；\\n]{5,100}`, 'g'),
  // 证书 / 资质 / 专利编号
  /(?:证书|资质|专利)(?:编号|号)?[:：]?\s*[A-Za-z0-9-]{4,}/g,
  // 注册资本 / 实收资本
  /(?:注册资金|注册资本|实收资本)[:：]?\s*[\d,.]+\s*(?:万|亿)?元?/g,
  // 统一社会信用代码
  /统一社会信用代码[:：]?\s*[0-9A-Z]{8,}/g,
  // 体系认证 / 产品认证 / 许可类编号
  /(?:ISO|IEC|CE|CCC|GB\/T|TSG?|UL|API|EN)\s?\d{3,5}(?:[-–—]\d+)?/g,
  // 具名责任人（编造人名最常见的落点）
  /(?:法定代表人|法人代表|项目经理|技术负责人|总工程师|销售总监)[:：为是]?\s*([\u4e00-\u9fa5]{2,4})(?!身份|证明|授权|委托|声明)/g,
];

function findUnsupportedClaims(outlineData, contentPlans, referenceText = '') {
  const findings = [];
  const normalizedReference = normalize(referenceText);
  const isSupported = (claim, evidenceText) => {
    const normalizedClaim = normalize(claim.replace(/^(我公司|本公司|我司|本单位|我方)/, ''));
    const normalizedEvidence = normalize(evidenceText);
    if (!normalizedClaim) return false;
    // 招标原文本身就是合法出处：招标文件里的参数、名称、编号不算编造。
    if (normalizedReference && normalizedReference.includes(normalizedClaim)) return true;
    if (!normalizedEvidence) return false;
    if (normalizedEvidence.includes(normalizedClaim)) return true;
    const exactTokens = claim.match(/[A-Za-z]+[A-Za-z0-9-]*|\d+(?:\.\d+)?/g) || [];
    if (exactTokens.some((token) => !evidenceText.toLowerCase().includes(token.toLowerCase()) && !normalizedReference.includes(token.toLowerCase()))) return false;
    const bigrams = new Set(Array.from({ length: Math.max(0, normalizedClaim.length - 1) }, (_item, index) => normalizedClaim.slice(index, index + 2)));
    if (!bigrams.size) return false;
    const matched = [...bigrams].filter((token) => normalizedEvidence.includes(token) || normalizedReference.includes(token)).length;
    return matched / bigrams.size >= 0.55;
  };
  for (const item of collectLeaves(outlineData?.outline || [])) {
    const plan = contentPlans?.[item.id]?.plan || contentPlans?.[item.id] || {};
    const evidenceText = (plan.evidence_pack?.sources || []).map((source) => source.content || '').join('\n');
    const content = String(item.content || '');
    for (const pattern of CLAIM_PATTERNS) {
      // 每条模式可能带捕获组（如人名），有捕获组时以捕获组作为主张主体。
      for (const match of content.matchAll(pattern)) {
        const group = match[1];
        // 具名责任人：只有出现具体人名才构成主张，避免把「法定代表人身份证明」当成事实。
        const claim = (group && group.length >= 2 && !/身份|证明|授权|委托|声明/.test(group) ? group : match[0]).trim();
        if (!claim) continue;
        if (!isSupported(claim, evidenceText)) {
          findings.push({
            section_id: item.id,
            claim,
            matched_text: match[0].trim(),
            has_evidence: Boolean(evidenceText.trim()),
            status: 'UNSUPPORTED',
          });
        }
      }
    }
  }
  return findings;
}

function checkMissingTables(bidPlan, responseTables, outlineData) {
  const titleText = collectLeaves(outlineData?.outline || []).map((item) => item.title || '').join(' ');
  const titlePatterns = {
    technical_parameter_response: /技术参数.*响应|参数响应表|产品技术性能.*响应/,
    technical_deviation: /技术偏离|技术偏差/,
    supply_scope: /供货范围|成套设备供货|设备供货清单/,
  };
  return (bidPlan?.required_tables || []).map((item) => item.type).filter((type) => (
    !responseTables?.[type] || !titlePatterns[type]?.test(titleText)
  ));
}

// ── 响应文件章节覆盖 ─────────────────────────────────────────────
// 招标文件自己规定的「响应文件应包含哪些部分」才是投标文件的合规骨架。
// 技术主题覆盖再高，也不能替代这份骨架；这里把它做成可检查、可点名的清单。

const SECTION_CATEGORIES = [
  { category: 'legal_person', label: '法定代表人/授权', pattern: /法定代表人|法人代表|授权委托|委托书|身份证明/ },
  { category: 'financial', label: '财务状况', pattern: /财务|审计报告|资产负债|银行资信|纳税|社保|资金证明/ },
  { category: 'performance', label: '业绩', pattern: /业绩|同类项目|供货业绩|合同业绩|销售业绩/ },
  { category: 'certification', label: '认证与许可', pattern: /认证|体系|专利|许可证|生产许可|制造许可|检测报告/ },
  { category: 'qualification', label: '资格与执照', pattern: /资格|营业执照|主体资格|信用|资信|经营范围/ },
  { category: 'deviation', label: '偏离与响应表', pattern: /偏离|偏差|响应表|应答表|一览表|对照表/ },
  { category: 'commitment', label: '函件与承诺', pattern: /函|承诺|声明|保证/ },
  { category: 'commercial', label: '商务与报价', pattern: /报价|商务|保证金|价格|付款|分值/ },
  { category: 'technical', label: '技术响应', pattern: /技术|方案|供货范围|服务|运输|安装|售后|培训/ },
];

const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const MARKDOWN_LIST_ITEM = /^\s*(?:[-*+•]|\d+[.、)）])\s+(.+?)\s*$/;
const MARKDOWN_BOLD_LINE = /^\s*\*\*(.+?)\*\*\s*[:：]?\s*$/;
const OPTIONAL_MARKER = /如适用|若适用|如有|可选|非必须|非强制|视情况|如需要/;
const REQUIRED_MARKER = /必须提供|应当提供|须提供|应提供|必须提交|应提交|强制|必备/;
const IGNORED_SECTION_TITLE = /^(?:响应文件要求|响应文件组成|响应文件格式|投标文件格式|响应文件|投标文件|格式要求|填写要求|编制要求|装订要求|其他要求|其他说明|说明|备注|未提取到|未找到明确响应文件要求|不存在|无)$/;
// 目录里只有标题、没有实质内容的合规章节会命中这个阈值。
const THIN_SECTION_CHARS = 200;

function cleanSectionTitle(raw) {
  return String(raw || '')
    .replace(/^\s*(?:\d+(?:\.\d+)*\s*[.、)）]?|[（(]\s*\d+\s*[)）]|[一二三四五六七八九十]+\s*[、.）)])\s*/, '')
    .replace(/^\s*(?:[-*+•])\s*/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/[（(][^）)]{0,20}[）)]\s*$/, '')
    .replace(/\s*[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyResponseSection(title) {
  const text = String(title || '');
  const hit = SECTION_CATEGORIES.find((item) => item.pattern.test(text));
  return hit ? { category: hit.category, label: hit.label } : { category: 'other', label: '其他' };
}

function isPlausibleSectionTitle(title) {
  if (!title) return false;
  if (title.length < 3 || title.length > 40) return false;
  if (IGNORED_SECTION_TITLE.test(title)) return false;
  if (/[。；]/.test(title)) return false;
  return true;
}

// 解析 Step02「响应文件要求」的 Markdown，得到招标文件规定的章节清单。
// 输入是自由格式 Markdown，所以只认标题行、列表项和加粗独立行，不强行套模板。
function extractResponseSections(responseFileRequirements) {
  const lines = String(responseFileRequirements || '').split(/\r?\n/);
  const sections = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !line.trim()) continue;
    const heading = line.match(MARKDOWN_HEADING);
    const listItem = heading ? null : line.match(MARKDOWN_LIST_ITEM);
    const boldLine = heading || listItem ? null : line.match(MARKDOWN_BOLD_LINE);
    const rawTitle = heading?.[1] ?? listItem?.[1] ?? boldLine?.[1];
    if (!rawTitle) continue;
    const title = cleanSectionTitle(rawTitle);
    if (!isPlausibleSectionTitle(title)) continue;
    // 紧邻的下文用于判断「必须提供 / 如适用」，因为标记常写在条目的续行里。
    const context = [line, lines[index + 1] || '', lines[index + 2] || ''].join(' ');
    const optional = OPTIONAL_MARKER.test(context) && !REQUIRED_MARKER.test(context);
    const key = normalize(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const { category, label } = classifyResponseSection(title);
    sections.push({ name: title, required: !optional, category, category_label: label });
  }
  return sections;
}

function normalizeSectionName(value) {
  return String(value || '')
    .replace(/^附件\s*\d*[.、)）]?\s*/, '')
    .replace(/[（(][^）)]{0,20}[）)]/g, '')
    .replace(/[\s、,，.。:：;；\-—_/\\]/g, '')
    .replace(/^(?:第[一二三四五六七八九十百\d]+[章节部分])/, '')
    .trim();
}

function sectionMatchesNode(sectionName, nodeTitle) {
  const section = normalizeSectionName(sectionName);
  const node = normalizeSectionName(nodeTitle);
  if (!section || !node) return false;
  if (section === node) return true;
  const shorter = section.length <= node.length ? section : node;
  const longer = section.length <= node.length ? node : section;
  if (shorter.length >= 3 && longer.includes(shorter)) return true;
  return similarity(sectionName, nodeTitle) >= 0.6;
}

function checkResponseSectionCoverage(responseFileRequirements, outlineData) {
  const sections = extractResponseSections(responseFileRequirements);
  const nodes = collectAllNodes(outlineData?.outline || []);
  const requiredSections = sections.filter((item) => item.required);
  if (!sections.length) {
    return {
      computable: false,
      reason: '未从 Step02「响应文件要求」中解析出章节清单',
      required_total: 0,
      optional_total: 0,
      covered_count: 0,
      coverage_score: 0,
      missing_required: [],
      thin_sections: [],
      by_category: {},
    };
  }

  const missingRequired = [];
  const thinSections = [];
  const byCategory = {};
  let coveredCount = 0;

  for (const section of requiredSections) {
    const bucket = byCategory[section.category] || (byCategory[section.category] = {
      label: section.category_label,
      total: 0,
      covered: 0,
      missing: [],
    });
    bucket.total += 1;
    const matched = nodes.find((node) => sectionMatchesNode(section.name, node.title));
    if (!matched) {
      missingRequired.push({ name: section.name, category: section.category, category_label: section.category_label });
      bucket.missing.push(section.name);
      continue;
    }
    coveredCount += 1;
    bucket.covered += 1;
    // 标题在、正文空或过短：这是「写到了但没形成证据链」的合规章节。
    const contentChars = String(matched.content || '').trim().length;
    if (contentChars < THIN_SECTION_CHARS) {
      thinSections.push({
        name: section.name,
        category: section.category,
        category_label: section.category_label,
        node_id: String(matched.id || ''),
        node_title: String(matched.title || ''),
        content_mode: String(matched.content_mode || ''),
        content_chars: contentChars,
      });
    }
  }

  return {
    computable: true,
    required_total: requiredSections.length,
    optional_total: sections.length - requiredSections.length,
    covered_count: coveredCount,
    coverage_score: requiredSections.length ? Number((coveredCount / requiredSections.length * 100).toFixed(1)) : 0,
    missing_required: missingRequired,
    thin_sections: thinSections,
    by_category: byCategory,
  };
}

function runBidQualityCheck({ bidPlan, outlineData, responseTables, parameterRegistry, contentPlans, responseFileRequirements, tenderMarkdown }) {
  return {
    technical_coverage: calculateOutlineCoverage(bidPlan, outlineData),
    response_section_coverage: checkResponseSectionCoverage(responseFileRequirements, outlineData),
    parameter_conflicts: findParameterConflicts(outlineData, parameterRegistry),
    duplicate_sections: findDuplicateSections(outlineData),
    missing_tables: checkMissingTables(bidPlan, responseTables, outlineData),
    unsupported_claims: findUnsupportedClaims(outlineData, contentPlans, tenderMarkdown),
  };
}

module.exports = {
  runBidQualityCheck,
  findDuplicateSections,
  findParameterConflicts,
  findUnsupportedClaims,
  checkMissingTables,
  checkResponseSectionCoverage,
  extractResponseSections,
  sectionMatchesNode,
  classifyResponseSection,
};
