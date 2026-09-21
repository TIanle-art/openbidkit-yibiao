// 原件回填：把源标书里「某章节下的原件扫描件」按目录章节一一对应地插入新标书正文。
//
// 与「插图编排」的区别：
// - 插图编排（contentIllustrationPlanning.cjs）是「挑几张图美化排版」，有上限、单节一图、同图只用一次。
// - 原件回填是「按位置全量回填证据」，某章节有几张就插几张，且允许同一张图在多个章节复用。
// 两者语义相反，因此这里完全绕开编排引擎的限流逻辑，作为独立步骤运行。

const ROOT_PARENT_ID = '__root__';
const EVIDENCE_MARKER = 'origin-evidence';

function singleLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// 与 imageSectionAnchor.sectionTitleKey 保持一致：忽略空白与标点差异。
function titleKey(value) {
  return singleLine(value).replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}

function normalizeSectionNumber(value) {
  const match = /^(\d+(?:\s*[.．、]\s*\d+)*)/.exec(singleLine(value));
  if (!match) return '';
  return match[1].replace(/\s+/g, '').replace(/[．、]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
}

// 解析 source_section_path_json 字段，容错非法值。
function parseSectionPath(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

// 遍历目录树，收集叶子小节（可插入正文的最小单位）。
function collectLeafNodes(outlineItems) {
  const leaves = [];
  function visit(items, parentId = ROOT_PARENT_ID, depth = 1) {
    for (const item of Array.isArray(items) ? items : []) {
      const id = String(item?.id || '').trim();
      if (!id) continue;
      const children = Array.isArray(item?.children) ? item.children : [];
      if (children.length) {
        visit(children, id, depth + 1);
        continue;
      }
      leaves.push({
        id,
        parentId,
        depth,
        title: singleLine(item?.title),
        titleKey: titleKey(item?.title),
        number: normalizeSectionNumber(item?.title),
      });
    }
  }
  visit(outlineItems);
  return leaves;
}

// 为每个叶子小节建立「章节编号 → 叶子」「标题 key → 叶子」两套索引。
function buildLeafIndex(leaves) {
  const byKey = new Map();
  const byNumber = new Map();
  for (const leaf of leaves) {
    if (leaf.titleKey && !byKey.has(leaf.titleKey)) byKey.set(leaf.titleKey, leaf);
    if (leaf.number && !byNumber.has(leaf.number)) byNumber.set(leaf.number, leaf);
  }
  return { byKey, byNumber };
}

// 把源章节归属匹配到新标书的叶子小节。
// 匹配优先级：二级标题 key → 二级编号 → 一级标题 key → 一级编号。
// 匹配不上时返回 null，由调用方决定降级策略（默认丢弃，不硬塞到错误章节）。
function matchLeafForAnchor(anchor, leafIndex) {
  const path = anchor.sectionPath || [];
  const level2 = path[1] || '';
  const level1 = path[0] || '';

  for (const candidate of [level2, level1]) {
    if (!candidate) continue;
    const key = titleKey(candidate);
    if (key && leafIndex.byKey.has(key)) return leafIndex.byKey.get(key);
    const number = normalizeSectionNumber(candidate);
    if (number && leafIndex.byNumber.has(number)) return leafIndex.byNumber.get(number);
  }
  return null;
}

// 归一化图片记录：支持直接传 image_library_images 行或已 map 的对象。
function normalizeImageRecord(image) {
  const assetUrl = image?.asset_url || image?.assetUrl || '';
  if (!assetUrl) return null;
  return {
    assetId: image.imageId || image.image_id || '',
    assetUrl,
    caption: singleLine(image.name || image.title || image.originalName || image.original_name || ''),
    description: singleLine(image.description || ''),
    contextText: singleLine(image.sourceContextText || image.source_context_text || ''),
    sectionPath: parseSectionPath(image.sourceSectionPathJson || image.source_section_path_json),
    positionIndex: Number.isFinite(image.sourcePositionIndex)
      ? image.sourcePositionIndex
      : (Number.isFinite(image.source_position_index) ? image.source_position_index : 0),
  };
}

// 生成图注：优先用图片语义名，其次用其在源文档中的短上下文（如「营业执照（三证合一）」）。
// 上下文若是整段正文（含句末标点且偏长），说明这张图没有独立小标题，改用章节名兜底。
function resolveCaption(image, index, sectionTitle) {
  for (const candidate of [image.caption, image.contextText]) {
    const text = singleLine(candidate);
    if (!text) continue;
    // 整段正文不适合做图注：含句末标点且长度超过 30 字时跳过。
    if (/[。；;]$/.test(text) && text.length > 30) continue;
    return text.length > 24 ? `${text.slice(0, 24)}…` : text;
  }
  const fallback = singleLine(sectionTitle);
  if (fallback) return `${fallback} 原件 ${index + 1}`;
  return `原件材料 ${index + 1}`;
}

// 构造单个回填块的 markdown。沿用插图编排的标记格式，以便导出与 strip 逻辑复用。
function buildEvidenceIllustrationMarkdown({ itemId, assetUrl, caption }) {
  const text = singleLine(caption);
  if (!assetUrl) return '';
  const formattedCaption = /^(?:图\s*\d*(?:[-—_·.]\d+)*[:：\s]|图[:：])/.test(text) ? text : `图：${text}`;
  const body = `![${text}](${assetUrl})\n\n*${formattedCaption}*`;
  return `<!-- yibiao-illustration:start id="${itemId}" -->\n${body}\n<!-- yibiao-illustration:end -->`;
}

// 清除上一次回填的证据块（只清自己插入的，不动插图编排结果）。
function stripEvidenceIllustrations(content) {
  const pattern = new RegExp(
    `<!-- yibiao-illustration:start\\b[^>]*data-source="${EVIDENCE_MARKER}"[^>]*-->[\\s\\S]*?<!-- yibiao-illustration:end -->`,
    'gi',
  );
  return String(content || '').replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripEvidenceIllustrationsFromDocument(outlineData, sections) {
  const nextSections = { ...(sections || {}) };
  for (const [itemId, section] of Object.entries(nextSections)) {
    nextSections[itemId] = { ...section, content: stripEvidenceIllustrations(section?.content || '') };
  }
  return { sections: nextSections, outlineData };
}

// 主入口：把图片按章节锚点全量回填到正文小节末尾。
// options:
//   - maxPerSection: 单节上限，0 或负数表示不限（默认 0 = 全量）
//   - onlySuccessSections: 仅回填 status==='success' 的小节（默认 true）
function buildSourceEvidenceBackfill({ outlineData, sections, images, options = {} }) {
  const maxPerSection = Number.isFinite(Number(options.maxPerSection)) ? Number(options.maxPerSection) : 0;
  const onlySuccessSections = options.onlySuccessSections !== false;

  const leaves = collectLeafNodes(outlineData?.outline || []);
  const leafIndex = buildLeafIndex(leaves);

  // 按匹配到的叶子小节分组，组内按源文档顺序保序。
  const grouped = new Map();
  let skippedUnmatched = 0;
  let totalImages = 0;

  for (const raw of Array.isArray(images) ? images : []) {
    const image = normalizeImageRecord(raw);
    if (!image) continue;
    totalImages += 1;
    if (!image.sectionPath.length) {
      skippedUnmatched += 1;
      continue;
    }
    const leaf = matchLeafForAnchor({ sectionPath: image.sectionPath }, leafIndex);
    if (!leaf) {
      skippedUnmatched += 1;
      continue;
    }
    if (!grouped.has(leaf.id)) grouped.set(leaf.id, []);
    grouped.get(leaf.id).push(image);
  }

  let inserted = 0;
  const perSection = [];
  const stripped = stripEvidenceIllustrationsFromDocument(outlineData, sections);
  const nextSections = stripped.sections;

  for (const [sectionId, group] of grouped) {
    const section = nextSections[sectionId];
    if (!section) continue;
    if (onlySuccessSections && section.status !== 'success') continue;

    const limited = maxPerSection > 0 ? group.slice(0, maxPerSection) : group;
    const sectionTitle = leaves.find((leaf) => leaf.id === sectionId)?.title || '';
    const blocks = [];
    limited.forEach((image, index) => {
      const itemId = `evidence-${sectionId}-${String(index + 1).padStart(3, '0')}`;
      const block = buildEvidenceIllustrationMarkdown({
        itemId,
        assetUrl: image.assetUrl,
        caption: resolveCaption(image, index, sectionTitle),
      });
      if (!block) return;
      // 把 data-source 标记打进 start 注释，供 strip 时精确识别（不影响插图编排的结果）。
      blocks.push(block.replace(
        /<!-- yibiao-illustration:start id="([^"]+)" -->/,
        `<!-- yibiao-illustration:start id="$1" data-source="${EVIDENCE_MARKER}" -->`,
      ));
    });
    if (!blocks.length) continue;

    const current = String(section.content || '').trim();
    const content = `${current}\n\n${blocks.join('\n\n')}`.trim();
    nextSections[sectionId] = { ...section, content, updated_at: new Date().toISOString() };
    inserted += blocks.length;
    perSection.push({ sectionId, title: sectionTitle, count: blocks.length });
  }

  // 同步 outlineData 上的 content，保持与 sections 一致。
  const contentById = new Map(Object.entries(nextSections).map(([id, section]) => [id, section?.content || '']));
  function mapOutline(items) {
    return (Array.isArray(items) ? items : []).map((item) => ({
      ...item,
      ...(contentById.has(item.id) ? { content: contentById.get(item.id) } : {}),
      ...(item.children?.length ? { children: mapOutline(item.children) } : {}),
    }));
  }

  return {
    sections: nextSections,
    outlineData: outlineData ? { ...outlineData, outline: mapOutline(outlineData.outline) } : outlineData,
    stats: {
      total_images: totalImages,
      inserted,
      skipped_unmatched: skippedUnmatched,
      touched_sections: perSection.length,
      per_section: perSection.sort((a, b) => b.count - a.count),
    },
  };
}

module.exports = {
  buildSourceEvidenceBackfill,
  stripEvidenceIllustrations,
  stripEvidenceIllustrationsFromDocument,
  collectLeafNodes,
  matchLeafForAnchor,
  EVIDENCE_MARKER,
};
