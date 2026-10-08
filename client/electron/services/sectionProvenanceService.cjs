const crypto = require('node:crypto');
const fs = require('node:fs');

const hash = (text) => crypto.createHash('sha256').update(Buffer.isBuffer(text) ? text : String(text || '')).digest('hex');
const key = (text) => String(text || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();

function findNode(items, id) {
  for (const item of items || []) {
    if (item.id === id) return item;
    const found = findNode(item.children, id);
    if (found) return found;
  }
  return null;
}

function imageUrls(markdown) {
  const text = String(markdown || '');
  const urls = [...text.matchAll(/!\[[^\]]*\]\(\s*<?(yibiao-asset:\/\/[^\s)"'<>]+)/g)].map((match) => match[1]);
  for (const match of text.matchAll(/<img\b[^>]*\bsrc=["'](yibiao-asset:\/\/[^"']+)["']/gi)) urls.push(match[1]);
  return [...new Set(urls)];
}

function sectionExcerpt(markdown, title) {
  const lines = String(markdown || '').split(/\r?\n/);
  const wanted = key(title).replace(/^[一二三四五六七八九十百\d]+/, '');
  if (!wanted) return null;
  const hits = lines.flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    return match && key(match[2]).replace(/^[一二三四五六七八九十百\d]+/, '') === wanted
      ? [{ index, level: match[1].length, title: match[2] }] : [];
  });
  // 同名目录与正文或多个同名小节不能自动选第一次命中。
  if (hits.length !== 1) return null;
  const hit = hits[0];
  let end = hit.index + 1;
  while (end < lines.length) {
    const heading = /^(#{1,6})\s/.exec(lines[end]);
    if (heading && heading[1].length <= hit.level) break;
    end += 1;
  }
  return { excerpt: lines.slice(hit.index, end).join('\n'), section: hit.title, line: hit.index + 1 };
}

function parsePath(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

function readSectionProvenance({ nodeId, technicalPlanStore, knowledgeBaseService, imageLibraryService }) {
  const state = technicalPlanStore.loadTechnicalPlan();
  const node = findNode(state.outlineData?.outline, nodeId);
  if (!node) throw new Error('当前目录中未找到该小节');
  const plan = state.contentGenerationPlans?.[nodeId]?.plan || {};
  const pack = plan.evidence_pack || {};
  const brief = plan.section_brief || {};
  const snapshotSources = pack.sources || [];
  const linkedIds = [...new Set([...(node.knowledge_item_ids || []), ...(plan.knowledge?.item_ids || [])])];
  const library = imageLibraryService.listImages();
  const bodyImages = imageUrls(node.content);
  const docs = [...new Set([
    ...(state.referenceKnowledgeDocumentIds || []),
    ...snapshotSources.map((source) => source.document_id),
    ...linkedIds.map((id) => String(id).split('::')[0]),
    ...knowledgeBaseService.findImageDocuments(bodyImages),
    ...library.filter((image) => bodyImages.includes(image.asset_url)).map((image) => image.sourceDocumentId),
  ].filter(Boolean))];
  const references = knowledgeBaseService.readReferences(docs, { includeBlocks: true, includeImages: true });
  const byDocument = new Map(references.map((ref) => [ref.document.id, ref]));
  const entries = [];
  const warnings = [];
  const outputChanged = Boolean(pack.output_hash && pack.output_hash !== hash(node.content));
  if (outputChanged) warnings.push('正文已变更：以下生成参考对应旧正文，需重新核对。');
  if (state.contentGenerationSections?.[nodeId]?.status === 'error') warnings.push('该小节生成失败：编排参考不能证明现有正文的出处。');
  if (!pack.output_hash && node.content) warnings.push('旧记录未绑定正文版本：只能确认已保存的参考，不能证明当前逐句出处。');
  const tenderChanged = Boolean(pack.tender_hash && pack.tender_hash !== state.tenderFile?.contentHash);
  if (tenderChanged) warnings.push('招标依据已变化：来源引用对应旧版本，需重新核对。');

  function add(kind, values) {
    const stableId = hash(JSON.stringify([kind, values.source_locator, values.title, values.block_ids, values.images, values.excerpt])).slice(0, 20);
    const duplicate = entries.filter((item) => item.id.startsWith(`${kind}-${stableId}`)).length;
    const entry = { id: `${kind}-${stableId}-${duplicate}`, kind, title: '', file_name: '', section: '', page: '',
      block_ids: [], excerpt: '', images: [], status: 'recorded', association: 'reference', message: '', ...values };
    entries.push(entry);
    return entry;
  }

  const tenderFiles = state.tenderFiles || [];
  const tenderTexts = new Map();
  const readTender = (file) => {
    if (!tenderTexts.has(file.id)) tenderTexts.set(file.id, technicalPlanStore.readTenderSourceMarkdown(file.id));
    return tenderTexts.get(file.id);
  };
  const requirements = [...(brief.tender_requirements || [])];
  if (!requirements.length) {
    for (const topic of state.bidPlan?.technical_topics || []) {
      if ((node.technical_topic_ids || []).includes(topic.id)) requirements.push(...topic.requirements);
    }
  }
  for (const requirement of requirements) {
    const refs = requirement.source_refs?.length ? requirement.source_refs : [{}];
    for (const ref of refs) {
      const files = tenderFiles.filter((file) => file.id === ref.source_id || file.fileName === ref.source_id);
      const file = files.length === 1 ? files[0] : tenderFiles.length === 1 ? tenderFiles[0] : null;
      const located = file && sectionExcerpt(readTender(file), ref.section || '');
      add('requirement', { title: ref.label || '招标要求', file_name: file?.fileName || '来源文件待定位',
        section: ref.section || '', page: ref.page || '', block_ids: ref.chunk_id ? [ref.chunk_id] : [],
        source_locator: file ? { kind: 'tender', id: file.id } : undefined,
        excerpt: located?.excerpt || requirement.text || '', images: imageUrls(located?.excerpt),
        status: tenderChanged ? 'changed' : located ? 'recorded' : 'unlocated', association: 'requirement',
        message: located ? `解析原文行 ${located.line}；引用页码须核原件` : '已保存要求引用，原文位置待核',
      });
    }
  }
  if (pack.tender_excerpt) add('requirement', { title: '模板填写依据快照', file_name: pack.tender_file,
    excerpt: pack.tender_excerpt, images: imageUrls(pack.tender_excerpt), snapshot_hash: pack.tender_hash,
    status: pack.tender_hash && state.tenderFile?.contentHash !== pack.tender_hash ? 'changed' : 'recorded',
    association: 'requirement', message: '生成时使用的招标摘录；物理页待定位',
  });
  if (!requirements.length && !pack.tender_excerpt) {
    const title = node.source_requirement_title || node.title;
    let found = false;
    for (const file of tenderFiles) {
      const located = sectionExcerpt(readTender(file), title);
      if (!located) continue;
      found = true;
      add('requirement', { title: node.source_requirement_title || '同名招标章节候选', file_name: file.fileName,
        section: located.section, excerpt: located.excerpt, images: imageUrls(located.excerpt),
        association: 'candidate', status: 'candidate', message: `同名章节候选 / 解析原文行 ${located.line} / 待人工确认`,
      });
    }
    if (!found) add('requirement', { title: node.source_requirement_title || '招标依据', status: 'missing',
      association: 'requirement', message: '未保存可定位依据；请补文件、章节及原页',
    });
  }

  function addKnowledge(source, association) {
    const reference = byDocument.get(source.document_id);
    const item = reference?.items.find((value) => value.id === source.chunk_id);
    const blocks = (reference?.blocks || []).filter((block) => (source.source_block_ids || item?.source_block_ids || []).includes(block.id));
    const changed = Boolean(item && source.content_hash && source.content_hash !== item.content_hash)
      || Boolean(reference && source.document_hash && source.document_hash !== reference.document.markdown_hash);
    const unavailable = !item || reference.document.status !== 'success';
    const excerpt = source.content || item?.content || '';
    add('content', { title: source.title || item?.title || source.chunk_id,
      file_name: source.document_name || reference?.document.file_name || '来源文件缺失',
      document_id: source.document_id, section: [...new Set(blocks.flatMap((block) => block.heading_path || []))].join(' / '),
      source_locator: reference ? { kind: 'knowledge', id: source.document_id } : undefined,
      block_ids: source.source_block_ids || item?.source_block_ids || [], excerpt, images: imageUrls(excerpt),
      source_blocks: blocks, snapshot_hash: source.content_hash || '', current_hash: item?.content_hash || '', association,
      status: unavailable ? 'missing' : changed ? 'changed' : association === 'candidate' ? 'candidate' : 'recorded',
      message: unavailable ? '源条目已删除或解析未完成；保留生成时摘录' : changed ? '源内容已变化；保留快照，须重新核对' : association === 'candidate' ? '目录关联候选；不证明正文实际采用' : '生成参考已记录；逐句采用情况待核',
    });
  }
  for (const source of snapshotSources) addKnowledge(source, 'reference');
  const snapIds = new Set(snapshotSources.map((source) => `${source.document_id}::${source.chunk_id}`));
  for (const id of linkedIds.filter((value) => !snapIds.has(value))) {
    const [documentId, itemId] = id.split('::');
    const item = byDocument.get(documentId)?.items.find((value) => value.id === itemId);
    addKnowledge({ document_id: documentId, chunk_id: itemId, title: item?.title, source_block_ids: item?.source_block_ids }, 'candidate');
  }
  if (plan.original_material?.source_ids?.length) {
    const titles = plan.original_material.source_titles || [];
    const original = technicalPlanStore.readOriginalPlanMarkdown();
    const located = titles.map((title) => sectionExcerpt(original, title)).filter(Boolean);
    const excerpt = located.map((part) => part.excerpt).join('\n\n');
    // 三个数组分别去重过，不能按下标把片段ID、标题、哈希强行配对。
    add('content', { title: '原方案还原参考', file_name: state.originalPlanFile?.fileName || '原方案',
      section: titles.join(' / '), excerpt, images: imageUrls(excerpt),
      source_locator: { kind: 'original', id: 'original' },
      block_ids: plan.original_material.source_ids, association: 'reference', status: 'unlocated',
      message: '片段ID与哈希已记录；展示同名章节候选，原始片段位置待核',
      snapshot_hash: (plan.original_material.source_hashes || []).join(' / '),
    });
  }
  for (const title of plan.facts?.titles || []) {
    const group = state.globalFacts?.find((fact) => fact.title === title);
    add('content', { title, file_name: '项目全局事实', excerpt: group?.content || '', images: imageUrls(group?.content),
      status: group ? 'unlocated' : 'missing', association: 'reference',
      message: group ? '已关联全局事实；原始文件及页码待补，不视为已验证事实' : '关联的全局事实已不可用',
    });
  }
  if (!entries.some((entry) => entry.kind === 'content')) add('content', { title: '内容来源', status: 'missing',
    message: '该小节未保存内容参考；历史生成记录无法自动补证',
  });

  const documentImages = references.flatMap((ref) => (ref.images || []).map((image) => ({ ...image, document: ref.document })));
  for (const url of bodyImages) {
    const imported = documentImages.find((image) => image.asset_url === url);
    const image = library.find((value) => value.asset_url === url);
    const generated = state.contentIllustrationPlan?.items?.find((value) => value.generation?.asset_url === url);
    const document = imported?.document || byDocument.get(image?.sourceDocumentId)?.document;
    const tenderCandidates = document ? [] : tenderFiles.filter((file) => imageUrls(readTender(file)).includes(url));
    const tenderOrigin = tenderCandidates.length === 1 ? tenderCandidates[0] : null;
    const originalOrigin = !document && !tenderOrigin && state.originalPlanFile
      && imageUrls(technicalPlanStore.readOriginalPlanMarkdown()).includes(url) ? state.originalPlanFile : null;
    const sections = parsePath(imported?.section_path_json || image?.sourceSectionPathJson);
    add('image', { title: image?.name || generated?.title || imported?.file_name || '正文图片',
      file_name: document?.file_name || tenderOrigin?.fileName || originalOrigin?.fileName || (generated ? '本项目生成图' : '来源文件待补'),
      document_id: document?.id, section: Array.isArray(sections) ? sections.join(' / ') : '',
      source_locator: document ? { kind: 'knowledge', id: document.id } : tenderOrigin ? { kind: 'tender', id: tenderOrigin.id } : originalOrigin ? { kind: 'original', id: 'original' } : undefined,
      excerpt: imported?.context_text || image?.sourceContextText || generated?.generation?.code || '', images: [url],
      snapshot_hash: image?.contentHash || '', association: generated ? 'generated' : 'embedded',
      status: imported || document || tenderOrigin || originalOrigin ? 'recorded' : generated ? 'generated' : 'missing',
      message: generated ? `${generated.kind} 生成图；工程参数与适用性待核` : imported || document || tenderOrigin || originalOrigin ? '正文实际图片；物理页及证件有效性待核' : image ? '图片库有图，但未保存来源文件；请补来源' : '正文实际图片；未找到唯一图源记录',
    });
  }
  for (const evidence of (plan.supplemental_evidence || []).filter((item) => !item.superseded)) {
    let filePath = evidence.stored_file ? technicalPlanStore.resolveEvidencePath(evidence.stored_file) : '';
    if (evidence.method === 'pdf-text') {
      try { filePath = knowledgeBaseService.resolveSourcePath(evidence.source_locator.id); }
      catch { filePath = '__missing_source__'; }
    }
    const available = !filePath || fs.existsSync(filePath);
    const currentFileHash = filePath && available ? hash(fs.readFileSync(filePath)) : '';
    const fileChanged = filePath && available && currentFileHash !== evidence.file_hash;
    const sourceFile = evidence.source_locator?.kind === 'tender' ? tenderFiles.find((file) => file.id === evidence.source_locator.id) : null;
    const changed = evidence.content_hash !== hash(node.content) || fileChanged || (evidence.source_hash && evidence.source_hash !== sourceFile?.contentHash);
    const status = !available ? 'missing' : changed ? 'changed' : evidence.confirmed ? 'recorded' : 'candidate';
    const values = { id: `supplement-${evidence.id}`, evidence_id: evidence.id, target_entry_id: evidence.target_entry_id, title: evidence.title,
      file_name: evidence.file_name, section: evidence.section, page: evidence.physical_page ? String(evidence.physical_page) : '',
      physical_page: evidence.physical_page, printed_page: evidence.printed_page, line: evidence.line,
      excerpt: evidence.excerpt, images: evidence.preview_url ? [evidence.preview_url] : [], block_ids: [],
      snapshot_hash: evidence.file_hash || evidence.source_hash, current_hash: currentFileHash || sourceFile?.contentHash,
      source_locator: evidence.stored_file ? { kind: 'attachment', id: evidence.stored_file } : evidence.source_locator,
      status, association: 'reference',
      message: !available ? '补充原件缺失' : changed ? '正文或来源变化；需重新核对' : evidence.confirmed ? '人工已核来源；内容适用性仍需审核' : evidence.method === 'unique-text' ? `唯一原文命中 / 解析行 ${evidence.line} / 待核原件` : evidence.method === 'pdf-text' ? 'PDF 唯一摘录命中 / 待核原页' : '人工补充原件 / 待核来源',
    };
    const target = entries.findIndex((entry) => entry.id === evidence.target_entry_id);
    if (target >= 0 && status === 'recorded') {
      entries[target] = { ...entries[target], ...values, kind: evidence.kind, original_status: entries[target].status };
    } else add(evidence.kind, values);
  }
  return { node_id: node.id, title: node.title, content_hash: hash(node.content), recorded_at: pack.recorded_at || '',
    output_changed: outputChanged, warnings, entries,
    summary: { total: entries.length, missing: entries.filter((entry) => entry.status === 'missing').length,
      candidates: entries.filter((entry) => entry.status === 'candidate').length,
      changed: entries.filter((entry) => entry.status === 'changed').length,
      pages_pending: entries.filter((entry) => !entry.page && entry.status !== 'generated').length },
  };
}

module.exports = { readSectionProvenance };
