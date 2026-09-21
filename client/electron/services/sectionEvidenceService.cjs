const { UNKNOWN_PLACEHOLDER, similarity } = require('./bidPlanningService.cjs');

function uniqueStrings(value, limit = Infinity) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean))].slice(0, limit);
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function bigrams(value) {
  const text = normalizeText(value);
  if (text.length < 2) return text ? [text] : [];
  return Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2));
}

function termOverlap(query, text) {
  const terms = new Set(bigrams(query));
  const target = new Set(bigrams(text));
  if (!terms.size || !target.size) return 0;
  return [...terms].filter((term) => target.has(term)).length / terms.size;
}

function inferRetrievalScope(section, brief) {
  const text = `${section?.title || ''} ${(brief?.must_cover || []).join(' ')} ${(brief?.evidence_needed || []).join(' ')}`;
  if (/公司简介|企业概况|组织机构|企业能力/.test(text)) return ['company'];
  if (/业绩|案例|类似项目|历史项目/.test(text)) return ['historical_project', 'project'];
  if (/售后|维保|培训|服务响应|质保/.test(text)) return ['service', 'company'];
  if (/项目理解|现场条件|实施范围|本项目/.test(text)) return ['project', 'product'];
  if (/设备|产品|机构|结构|电气|控制|安全|制造|焊接|参数|供货/.test(text)) return ['product', 'technical', 'project'];
  return ['project', 'company'];
}

function topicMatchesSection(topic, section) {
  const explicit = new Set(section?.technical_topic_ids || []);
  if (explicit.has(topic.id)) return true;
  const sectionText = `${section?.title || ''} ${section?.description || ''}`;
  return Math.max(
    similarity(topic.title, sectionText),
    similarity(topic.recommended_section, sectionText),
    ...topic.keywords.map((keyword) => similarity(keyword, sectionText)),
  ) >= 0.48;
}

function createSectionBrief({ section, parentChapters = [], bidPlan, parameterRegistry, projectFacts = [] }) {
  const topics = (bidPlan?.technical_topics || []).filter((topic) => topicMatchesSection(topic, section));
  const tenderRequirements = topics.flatMap((topic) => topic.requirements.map((requirement) => ({
    topic_id: topic.id,
    text: requirement.text,
    source_refs: requirement.source_refs || topic.source_refs || [],
  })));
  const technicalEntities = uniqueStrings([
    ...(bidPlan?.procurement_targets || []).map((target) => target.name),
    ...topics.flatMap((topic) => topic.keywords),
  ], 16);
  const parameters = parameterRegistry?.parameters || [];
  const knownFacts = parameters
    .filter((item) => item.status === 'CONFIRMED')
    .map((item) => ({ key: item.key, label: item.label, value: item.bid_value, source_refs: item.source_refs || [] }));
  const unknowns = uniqueStrings([
    ...parameters.filter((item) => item.status !== 'CONFIRMED').map((item) => `${item.label || item.key}：${UNKNOWN_PLACEHOLDER}`),
    ...(bidPlan?.unknowns || []),
  ], 20);
  const mustCover = uniqueStrings([
    ...tenderRequirements.map((item) => item.text),
    ...topics.map((topic) => topic.title),
  ], 24);
  const title = String(section?.title || '未命名章节');
  const brief = {
    section_id: String(section?.id || ''),
    title,
    purpose: String(section?.description || '').trim() || `完整响应“${title}”相关招标要求，并给出可执行的专业方案。`,
    parent_path: parentChapters.map((item) => String(item?.title || '')).filter(Boolean),
    tender_requirements: tenderRequirements,
    must_cover: mustCover,
    nice_to_cover: uniqueStrings(topics.flatMap((topic) => topic.evidence_categories), 10),
    technical_entities: technicalEntities,
    evidence_needed: uniqueStrings(topics.flatMap((topic) => topic.evidence_categories), 10),
    recommended_tables: (bidPlan?.required_tables || [])
      .filter((table) => /参数|偏离|供货|响应/.test(title) || table.type === 'technical_parameter_response' && /技术|产品|设备/.test(title))
      .map((table) => table.type),
    known_facts: [...knownFacts, ...projectFacts],
    unknowns,
    avoid: ['无证据的企业事实', '无证据的产品实际参数', '与本章无关的公司介绍', '重复项目背景', '把招标最低要求写成已确认投标值'],
    technical_topic_ids: topics.map((topic) => topic.id),
  };
  brief.retrieval_scope = inferRetrievalScope(section, brief);
  return brief;
}

function buildSectionQueries(brief, options = {}) {
  const maxQueries = Math.max(1, Math.min(4, Number(options.maxQueries || 4)));
  const queries = [];
  const entities = uniqueStrings(brief?.technical_entities, 5).join(' ');
  queries.push(`${brief?.title || ''} ${entities}`.trim());
  const mustCover = uniqueStrings(brief?.must_cover, 12);
  for (let index = 0; index < mustCover.length && queries.length < maxQueries; index += 3) {
    queries.push(`${brief?.title || ''} ${mustCover.slice(index, index + 3).join(' ')}`.trim());
  }
  return uniqueStrings(queries, maxQueries);
}

function inferItemCategory(item, document) {
  const text = `${document?.file_name || ''} ${item.title || ''} ${item.resume || ''}`;
  if (/公司简介|企业概况|组织机构|资质|证书/.test(text)) return 'company';
  if (/业绩|案例|项目经验|类似项目/.test(text)) return 'historical_project';
  if (/售后|服务|维保|培训|质保/.test(text)) return 'service';
  if (/产品|设备|参数|机构|结构|电气|制造|安装|调试/.test(text)) return 'product';
  return 'project';
}

function flattenKnowledgeReferences(references) {
  return (Array.isArray(references) ? references : []).flatMap((reference) => {
    const document = reference?.document || {};
    if (document.status && document.status !== 'success') return [];
    return (Array.isArray(reference?.items) ? reference.items : []).map((item) => ({
      document_id: String(document.id || ''),
      document_name: String(document.file_name || ''),
      item_id: String(item?.id || ''),
      id: `${document.id || ''}::${item?.id || ''}`,
      title: String(item?.title || ''),
      resume: String(item?.resume || ''),
      content: String(item?.content || ''),
      content_hash: String(item?.content_hash || ''),
      source_block_ids: uniqueStrings(item?.source_block_ids),
      category: inferItemCategory(item || {}, document),
    })).filter((item) => item.document_id && item.item_id && item.content);
  });
}

function scoreKnowledgeItem(item, queries, scopes) {
  const titleText = `${item.title} ${item.resume}`;
  const contentText = `${titleText} ${item.content}`;
  const queryScores = queries.map((query) => Math.max(
    termOverlap(query, titleText) * 1.15,
    termOverlap(query, contentText),
    similarity(query, titleText) * 0.8,
  ));
  const best = Math.max(0, ...queryScores);
  const scopeBoost = scopes.includes(item.category) ? 0.16 : 0;
  return Math.min(1, best + scopeBoost);
}

function isDuplicateCandidate(candidate, selected) {
  const normalized = normalizeText(candidate.content);
  return selected.some((item) => {
    if (candidate.content_hash && item.content_hash && candidate.content_hash === item.content_hash) return true;
    const other = normalizeText(item.content);
    if (!normalized || !other) return false;
    if (normalized === other) return true;
    const shorter = normalized.length < other.length ? normalized : other;
    const longer = normalized.length < other.length ? other : normalized;
    return shorter.length > 80 && longer.includes(shorter) && shorter.length / longer.length >= 0.82;
  });
}

function buildEvidencePack({ section, brief, references, topK = 6, characterBudget = 12000, threshold = 0.2 }) {
  const queries = buildSectionQueries(brief);
  const scopes = brief?.retrieval_scope || inferRetrievalScope(section, brief);
  const ranked = flattenKnowledgeReferences(references)
    .map((item) => ({ ...item, relevance: scoreKnowledgeItem(item, queries, scopes) }))
    .filter((item) => item.relevance >= threshold)
    .sort((left, right) => right.relevance - left.relevance);
  const selected = [];
  let usedCharacters = 0;
  for (const candidate of ranked) {
    if (selected.length >= Math.max(1, topK) || isDuplicateCandidate(candidate, selected)) continue;
    const remaining = characterBudget - usedCharacters;
    if (remaining <= 0) break;
    const content = candidate.content.slice(0, remaining);
    if (!content.trim()) continue;
    selected.push({ ...candidate, content });
    usedCharacters += content.length;
  }
  return {
    section: { id: String(section?.id || ''), title: String(section?.title || '') },
    queries,
    scopes,
    sources: selected.map((item) => ({
      document_id: item.document_id,
      document_name: item.document_name,
      chunk_id: item.item_id,
      category: item.category,
      relevance: Number(item.relevance.toFixed(3)),
      title: item.title,
      content: item.content,
      source_block_ids: item.source_block_ids,
    })),
    facts: selected.map((item) => ({
      statement: item.resume || item.title,
      source: { document_id: item.document_id, chunk_id: item.item_id },
    })),
    unknowns: uniqueStrings(brief?.unknowns, 20),
    budget: { top_k: topK, character_budget: characterBudget, used_characters: usedCharacters, threshold },
  };
}

module.exports = {
  createSectionBrief,
  buildSectionQueries,
  inferRetrievalScope,
  flattenKnowledgeReferences,
  buildEvidencePack,
  scoreKnowledgeItem,
};
