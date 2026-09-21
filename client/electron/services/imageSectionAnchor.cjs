// 图片章节锚点采集：从解析后的 markdown 中还原「每张图归属哪个目录章节」。
//
// 背景：旧版投标文件通常没有 Word Heading 样式，解析后既没有 `#` 标记也没有
// 结构化标题，导致知识块的 heading_path 全为空、图片也无法按章节回填。
//
// 观察（赛鼎 技术文件0818.docx）：标题全部是「整行加粗」形态，且编号书写极不统一 ——
// `1 ．响应函`（全角点无空格）、`4\. 申请人资格声明`（转义点 + 空格）、
// `11.生产企业简介`（半角点无空格）、`3.4** **质量保证能力证明`（粗体被拆开）。
// 单靠标点形态推断层级不可靠，因此本模块先从文档自带的「目录」区块采集真实章节名，
// 用它作为层级基准；目录里没有的加粗行一律视为章内小标题（三级）。

const MAX_TITLE_CHARS = 60;
const CONTEXT_TEXT_CHARS = 120;
const TOC_SCAN_LINES = 120;
const HEADING_MARKER_RE = /^(#{1,6})\s+(.+)$/;
const IMAGE_URL_RE = /yibiao-asset:\/\/imported-images\/([^/\s)]+)\/([^\s)]+)/g;
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const BOLD_ONLY_RE = /^\*\*\s*([^*]{2,60}?)\s*\*\*$/;
// 解析器把被拆开的粗体写成 `**3.4** **质量保证能力证明**`，需把同行多段粗体拼回一个标题。
const SPLIT_BOLD_RE = /^\*\*\s*([^*]+?)\s*\*\*(?:\s*\*\*\s*([^*]+?)\s*\*\*)+$/;
const ALL_BOLD_RUNS_RE = /\*\*\s*([^*]+?)\s*\*\*/g;
// 标题里不该出现的收尾标点，用于排除整行加粗的正文句。
const SENTENCE_TAIL_RE = /[。；;，,：:！!？?]$/;
// 明显是正文而非标题的短词（整行加粗但语义不是章节名）。
const NON_TITLE_WORDS = new Set(['不适用', '无', '略', '备注', '注', '说明', '合计', '小计']);
// 解析器会把编号里的全角点转义成 `\.`，还原后再判断标题。
const ESCAPED_DOT_RE = /\\\./g;
// 目录条目：标题 + 可选页码。页码用于把目录条目与正文标题区分开。
const TOC_ENTRY_RE = /^(.*?)[\s.．·]*(\d{1,4})\s*$/;
// 编号前缀：`1`、`3.1`、`3 ．`、`4.` 等。
const NUMBER_PREFIX_RE = /^(\d+(?:\s*[.．、]\s*\d+)*)\s*[.．、]?\s*(.*)$/;

function collapseSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// 归一化标题文本：还原转义点号、收敛空白。
function normalizeHeadingText(value) {
  return collapseSpaces(String(value || '').replace(ESCAPED_DOT_RE, '.'));
}

// 章节标题比对用的 key：忽略空白与标点差异（`3. 1` 与 `3.1` 等价）。
function sectionTitleKey(value) {
  return collapseSpaces(value).replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}

// 编号归一化：`3 ．` → `3`，`3 . 1` → `3.1`。
function normalizeSectionNumber(value) {
  const match = NUMBER_PREFIX_RE.exec(collapseSpaces(value));
  if (!match) return '';
  const digits = match[1].replace(/\s+/g, '').replace(/[．、]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
  return digits;
}

// 取「编号 + 标题文字」的主体，剥掉页码。
function stripPageNumber(text) {
  const match = TOC_ENTRY_RE.exec(collapseSpaces(text));
  if (!match) return collapseSpaces(text);
  const body = match[1].trim();
  // 主体为空或过短时说明末段不是页码而是标题正文，保留原文。
  if (!body || body.length < 2) return collapseSpaces(text);
  return body;
}

// 从文档前部采集目录条目，得到「真实一级/二级章节」的 key 集合。
// 目录区特征：连续多行都以数字结尾（页码），且首行附近出现「目录」字样。
function harvestTableOfContents(lines) {
  const level1Keys = new Set();
  const level2Keys = new Set();
  const level1Numbers = new Set();
  const limit = Math.min(lines.length, TOC_SCAN_LINES);
  let tocStart = -1;

  for (let i = 0; i < limit; i += 1) {
    // 目录标题常被解析成 `**目** **录**`，先去掉粗体标记再判断。
    const plain = collapseSpaces(lines[i]).replace(/\*/g, '');
    if (/^目\s*录$/.test(plain)) {
      tocStart = i;
      break;
    }
  }
  if (tocStart === -1) return { level1Keys, level2Keys, level1Numbers, tocStart: -1 };

  for (let i = tocStart + 1; i < limit; i += 1) {
    const raw = collapseSpaces(lines[i]);
    if (!raw) continue;
    // 目录条目必须以数字结尾（页码）；遇到正文起点则停止。
    if (!TOC_ENTRY_RE.test(raw)) {
      const numbered = NUMBER_PREFIX_RE.exec(normalizeHeadingText(raw));
      // 形如 `**1 ．响应函**` 的正文标题标志目录已结束。
      if (numbered && raw.startsWith('**')) break;
      continue;
    }
    const body = stripPageNumber(normalizeHeadingText(raw));
    const number = normalizeSectionNumber(body);
    if (!number) continue;
    const key = sectionTitleKey(body);
    if (!key) continue;
    const isSub = /\./.test(number);
    if (isSub) {
      level2Keys.add(key);
    } else {
      level1Keys.add(key);
      level1Numbers.add(number);
    }
  }

  return { level1Keys, level2Keys, level1Numbers, tocStart };
}

// 判断一行是否为标题，返回 { level, title } 或 null。
// toc 为 harvestTableOfContents 的结果；未提供时退化为「有编号即一级」的宽松策略。
function parseHeadingLine(rawLine, toc) {
  const line = String(rawLine || '').trim();
  if (!line) return null;

  const markerMatch = HEADING_MARKER_RE.exec(line);
  if (markerMatch) {
    return { level: markerMatch[1].length, title: normalizeHeadingText(markerMatch[2]) };
  }

  let text = '';
  const bold = BOLD_ONLY_RE.exec(line);
  if (bold) {
    text = normalizeHeadingText(bold[1]);
  } else if (SPLIT_BOLD_RE.test(line)) {
    text = normalizeHeadingText([...line.matchAll(ALL_BOLD_RUNS_RE)].map((item) => item[1]).join(' '));
  } else {
    return null;
  }

  if (!text || text.length > MAX_TITLE_CHARS) return null;
  if (text.includes('yibiao-asset://')) return null;
  if (SENTENCE_TAIL_RE.test(text)) return null;
  if (NON_TITLE_WORDS.has(text)) return null;

  const number = normalizeSectionNumber(text);
  const key = sectionTitleKey(text);

  // 层级判定优先级：目录命中 > 编号形态。
  const inTocL2 = toc?.level2Keys?.has(key);
  const inTocL1 = toc?.level1Keys?.has(key);

  if (/\./.test(number)) {
    // `3.1` 这类二级编号：目录命中则确认二级；目录未命中但确有二级编号，仍按二级处理。
    return { level: inTocL2 || !toc?.level1Keys?.size ? 2 : 3, title: text };
  }
  if (number) {
    // 一级编号：必须命中目录，或（无目录可参考时）编号形态像章节才认。
    if (inTocL1) return { level: 1, title: text };
    if (toc?.level1Keys?.size) return { level: 3, title: text };
    return { level: 1, title: text };
  }

  // 无编号的整行加粗：目录命中则按目录层级，否则视为章内小标题。
  if (inTocL2) return { level: 2, title: text };
  return { level: 3, title: text };
}

// 收集一行里引用的图片文件名（可能多个）。
function collectImageFileNames(line) {
  const names = [];
  IMAGE_URL_RE.lastIndex = 0;
  let match;
  while ((match = IMAGE_URL_RE.exec(line)) !== null) {
    names.push(decodeURIComponent(match[2]));
  }
  if (!names.length) {
    MARKDOWN_IMAGE_RE.lastIndex = 0;
    while ((match = MARKDOWN_IMAGE_RE.exec(line)) !== null) {
      const url = match[1];
      if (!url.startsWith('yibiao-asset://')) continue;
      const fileName = url.split('/').pop();
      if (fileName) names.push(decodeURIComponent(fileName));
    }
  }
  return names;
}

// 取该图紧邻上文的文本片段，用于生成图注与判断多图是否成组。
function buildContextText(lines, lineIndex, toc) {
  const parts = [];
  for (let i = lineIndex - 1; i >= 0 && parts.length < 3; i -= 1) {
    const text = collapseSpaces(lines[i]);
    if (!text) continue;
    if (text.includes('yibiao-asset://')) continue;
    if (parseHeadingLine(text, toc)) break;
    parts.unshift(text.replace(/^\*+|\*+$/g, '').trim());
  }
  return parts.join(' ').slice(0, CONTEXT_TEXT_CHARS);
}

// 扫描整份 markdown，返回每张图的章节归属记录。
// records: [{ file_name, position_index, section_level1, section_level2, section_path, context_text }]
function collectImageSectionAnchors(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const toc = harvestTableOfContents(lines);
  const headingStack = [];
  const records = [];
  const seen = new Set();
  let bodyStarted = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    // 目录区块内的行不参与标题栈构建，避免把目录条目当成正文标题。
    if (toc.tocStart !== -1 && lineIndex > toc.tocStart && lineIndex < toc.tocStart + 80) {
      const raw = collapseSpaces(lines[lineIndex]);
      if (raw && TOC_ENTRY_RE.test(normalizeHeadingText(raw)) && !raw.startsWith('**')) continue;
    }

    const heading = parseHeadingLine(lines[lineIndex], toc);
    if (heading) {
      headingStack.splice(heading.level - 1);
      headingStack[heading.level - 1] = heading.title;
      // 第一个一级章节出现即视为正文开始，用于排除封面与目录页。
      if (!bodyStarted && heading.level === 1) bodyStarted = true;
      continue;
    }

    const fileNames = collectImageFileNames(lines[lineIndex]);
    if (!fileNames.length) continue;
    if (!bodyStarted) continue;

    const sectionPath = headingStack.filter(Boolean);
    const contextText = buildContextText(lines, lineIndex, toc);
    for (const fileName of fileNames) {
      if (seen.has(fileName)) continue;
      seen.add(fileName);
      records.push({
        file_name: fileName,
        position_index: records.length,
        section_level1: sectionPath[0] || '',
        section_level2: sectionPath[1] || '',
        section_path: sectionPath,
        context_text: contextText,
      });
    }
  }

  return records;
}

// 把 markdown 里的图片引用与锚点记录按文件名对齐，产出可直接落库的图片记录。
function mergeAnchorsIntoDocumentImages(documentImages, anchors) {
  const anchorByName = new Map();
  for (const anchor of anchors) {
    if (!anchor?.file_name) continue;
    if (!anchorByName.has(anchor.file_name)) anchorByName.set(anchor.file_name, anchor);
  }
  return (Array.isArray(documentImages) ? documentImages : []).map((image, index) => {
    const anchor = anchorByName.get(image.file_name);
    return {
      ...image,
      position_index: anchor ? anchor.position_index : index,
      section_level1: anchor?.section_level1 || null,
      section_level2: anchor?.section_level2 || null,
      section_path_json: anchor?.section_path?.length ? JSON.stringify(anchor.section_path) : null,
      context_text: anchor?.context_text || null,
    };
  });
}

module.exports = {
  collectImageSectionAnchors,
  mergeAnchorsIntoDocumentImages,
  harvestTableOfContents,
  normalizeSectionNumber,
  sectionTitleKey,
  parseHeadingLine,
};
