/**
 * 出标书产物的保真与格式校验。
 *
 * 三件事：
 *   1. 流程完整性——目录里的每个章节是否真的落进了 Word，顺序是否正确。
 *   2. 模板保真——各类章节插入的内容是否与来源一致，逐段逐字（代码块除外，它们会被转成图片）。
 *   3. 格式一致——正文段落的字体/字号/对齐/缩进/行距是否与导出格式声明一致。
 *
 * 实现约束：Open XML 的命名空间标签用「按 localName 递归遍历」处理，不用 CSS 选择器。
 * `w:p` 这类选择器在 JS 字符串里对反斜杠转义极为脆弱，写错一个字符就会静默匹配不到。
 *
 * 只读：本模块不写任何文件。
 */

const AdmZip = require('adm-zip');
const cheerio = require('cheerio');

const SIZE_TO_HALF_PT = {
  '初号': 84, '小初': 72, '一号': 52, '小一': 48, '二号': 44, '小二': 36,
  '三号': 32, '小三': 30, '四号': 28, '小四': 24, '五号': 21, '小五': 18,
  '六号': 15, '小六': 13,
};
const ALIGN_MAP = {
  '居中对齐': 'center',
  '两端对齐': 'both',
  '左对齐': 'left',
  '右对齐': 'right',
};

function chineseSizeToHalfPt(sizeName) {
  if (typeof sizeName === 'number') return sizeName;
  return SIZE_TO_HALF_PT[sizeName] || 24;
}

function charsToTwips(chars, bodySizeHalfPt = 24) {
  const safeChars = Math.max(0, Number(chars) || 0);
  const safeHalfPt = Math.max(1, Number(bodySizeHalfPt) || 24);
  return Math.round(safeChars * safeHalfPt * 10);
}

/** 取元素的 localName（去掉 w: / a: 之类前缀）。 */
function localName(node) {
  const name = node?.name || '';
  const index = name.indexOf(':');
  return index >= 0 ? name.slice(index + 1) : name;
}

function childrenOf(node) {
  return (node?.children || []).filter((child) => child.type === 'tag');
}

function findChild(node, name) {
  return childrenOf(node).find((child) => localName(child) === name) || null;
}

function findAll(node, name, out = []) {
  for (const child of childrenOf(node)) {
    if (localName(child) === name) out.push(child);
    findAll(child, name, out);
  }
  return out;
}

function textOf(node) {
  let text = '';
  for (const child of node?.children || []) {
    if (child.type === 'text') text += child.data || '';
    else if (child.type === 'tag') text += textOf(child);
  }
  return text;
}

function attr(node, name) {
  return node?.attribs?.[name] ?? '';
}

/** 去掉全部空白，用于逐字比对。 */
function squeeze(value) {
  return String(value || '').replace(/\s+/g, '');
}

/** 去掉章节标题的自动编号前缀（第一章 / 1. / 1.2 等）。 */
function stripNumbering(title) {
  return String(title || '')
    .replace(/^第[一二三四五六七八九十百0-9]+[章节]\s*/, '')
    .replace(/^[0-9]+(\.[0-9]+)*[.、）)]?\s*/, '')
    .trim();
}

function isMarkdownTableLine(line) {
  return String(line || '').trim().startsWith('|');
}

/** 去掉行内 Markdown 标记：加粗、斜体、行内代码、链接、删除线、HTML 实体与标签。 */
function stripInlineMarkdown(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/__([^_]*)__/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/~~([^~]*)~~/g, '$1')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&emsp;|&ensp;|&nbsp;|&#160;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * 抽出围栏代码块的内容行，用于「这些行会被转成图片，不应期待以文字出现」的判断。
 * 同时返回去掉代码块后的正文，避免把 mermaid 源码当成丢失的正文。
 */
function splitFencedCode(content) {
  const lines = String(content || '').split(/\r?\n/);
  const text = [];
  const code = [];
  let inFence = false;
  let fenceLang = '';
  for (const line of lines) {
    const fence = line.trim().match(/^```+\s*([A-Za-z0-9+-]*)/);
    if (fence) {
      if (!inFence) { inFence = true; fenceLang = (fence[1] || '').toLowerCase(); }
      else { inFence = false; fenceLang = ''; }
      continue;
    }
    if (inFence) code.push({ line, lang: fenceLang });
    else text.push(line);
  }
  return { textLines: text, codeLines: code, hasCode: code.length > 0 };
}

/** 把内容拆成可逐段比对的片段（不含代码块）。 */
function contentFragments(content) {
  const { textLines } = splitFencedCode(content);
  return textLines
    .map((line) => line.trim())
    .filter((line) => line && !isMarkdownTableLine(line))
    .map((line) => line.replace(/^#+\s*/, '').replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+[.、)]\s+/, ''))
    .map(stripInlineMarkdown)
    .map(squeeze)
    .filter((line) => line.length >= 4);
}

/**
 * 文档侧全文，按与源片段完全相同的口径归一化。
 *
 * 源片段经过 stripInlineMarkdown（会去掉 `<制造厂企业全称>` 这类占位符），
 * 文档侧若原样保留 `<...>`，逐段比对就会产生大量假丢失。两侧必须同口径。
 */
function normalizedDocText(parsed) {
  return squeeze(
    stripInlineMarkdown(
      parsed.blocks.filter((b) => b.kind === 'p').map((b) => b.text).join(''),
    ),
  );
}

/** Markdown 表格单元格文本，导出后会成为 w:tbl 单元格。 */
function tableCellFragments(content) {
  const { textLines } = splitFencedCode(content);
  const cells = [];
  for (const line of textLines) {
    const t = line.trim();
    if (!isMarkdownTableLine(t)) continue;
    if (/^\|[\s:|-]+\|$/.test(t)) continue;
    for (const cell of t.replace(/^\|/, '').replace(/\|$/, '').split('|')) {
      const text = squeeze(stripInlineMarkdown(cell));
      if (text.length >= 4) cells.push(text);
    }
  }
  return cells;
}

/** 解析 DOCX，按文档流顺序抽出段落。 */
function parseDocx(docxPath) {
  const zip = new AdmZip(docxPath);
  const xml = zip.readAsText('word/document.xml');
  const $ = cheerio.load(xml, { xmlMode: true });
  const root = $.root().get(0);

  const documentNode = findAll(root, 'document')[0] || root;
  const bodyNode = findChild(documentNode, 'body') || documentNode;

  const blocks = [];
  const walkNodes = (nodes, inTable) => {
    for (const node of childrenOf({ children: nodes })) {
      const name = localName(node);
      if (name === 'p') {
        const pPr = findChild(node, 'pPr');
        const pStyle = pPr ? attr(findChild(pPr, 'pStyle'), 'w:val') : '';
        const jc = pPr ? attr(findChild(pPr, 'jc'), 'w:val') : '';
        const ind = pPr ? findChild(pPr, 'ind') : null;
        const spacing = pPr ? findChild(pPr, 'spacing') : null;
        const runs = [];
        for (const r of findAll(node, 'r')) {
          const text = findAll(r, 't').map((t) => textOf(t)).join('');
          const rPr = findChild(r, 'rPr');
          const fonts = rPr ? findChild(rPr, 'rFonts') : null;
          const sz = rPr ? findChild(rPr, 'sz') : null;
          const color = rPr ? findChild(rPr, 'color') : null;
          runs.push({
            text,
            eastAsia: fonts ? attr(fonts, 'w:eastAsia') : '',
            ascii: fonts ? attr(fonts, 'w:ascii') : '',
            size: Number(sz ? attr(sz, 'w:val') : 0) || 0,
            bold: Boolean(rPr && findChild(rPr, 'b')),
            color: String(color ? attr(color, 'w:val') : '').toUpperCase(),
          });
        }
        const visibleRuns = runs.filter((r) => r.text);
        blocks.push({
          kind: 'p',
          inTable,
          style: pStyle,
          alignment: jc,
          firstLine: ind ? attr(ind, 'w:firstLine') : '',
          lineSpacing: spacing ? attr(spacing, 'w:line') : '',
          text: squeeze(visibleRuns.map((r) => r.text).join('')),
          runs: visibleRuns,
        });
        continue;
      }
      if (name === 'tbl') {
        walkNodes(childrenOf(node).flatMap((row) => childrenOf(row)), true);
        continue;
      }
      if (name === 'sdt' || name === 'sdtContent' || name === 'body') {
        walkNodes(childrenOf(node), inTable);
        continue;
      }
      const kids = childrenOf(node);
      if (kids.length && name !== 'sectPr') walkNodes(kids, inTable);
    }
  };
  walkNodes(childrenOf(bodyNode), false);

  const entries = zip.getEntries().map((entry) => entry.entryName);
  return {
    blocks,
    headerCount: entries.filter((name) => /^word\/header\d*\.xml$/.test(name)).length,
    footerCount: entries.filter((name) => /^word\/footer\d*\.xml$/.test(name)).length,
    mediaCount: entries.filter((name) => name.startsWith('word/media/')).length,
    drawingCount: findAll(bodyNode, 'drawing').length + findAll(bodyNode, 'pict').length,
  };
}

/** 把文档流切成「章节 -> 段落」的映射。 */
function segmentByHeadings(parsed, outline) {
  const headingEntries = outline.map((item) => ({
    id: String(item.id),
    title: stripNumbering(item.title),
    level: Number(item.level) || 1,
    item,
  }));

  const sections = [];
  let current = null;
  for (const block of parsed.blocks) {
    if (block.kind !== 'p' || block.inTable) continue;
    if (/^heading[1-6]$/i.test(block.style)) {
      const key = squeeze(stripNumbering(block.text));
      let matched = null;
      for (const entry of headingEntries) {
        if (entry.title && block.text.includes(squeeze(entry.title))) { matched = entry; break; }
      }
      current = { heading: block.text, headingKey: key, style: block.style, entry: matched, paragraphs: [] };
      sections.push(current);
      continue;
    }
    if (current) current.paragraphs.push(block);
  }
  return sections;
}

/** 1. 流程完整性：目录是否完整、按序落进 Word。 */
function checkOutlinePresence(parsed, outline) {
  const flatHeadings = parsed.blocks
    .filter((block) => block.kind === 'p' && !block.inTable && /^heading[1-6]$/i.test(block.style))
    .map((block) => block.text);
  // 比对文本包含表格单元格：Markdown 表格在导出后就是 w:tbl，同样属于交付内容。
  const docText = normalizedDocText(parsed);

  const missing = [];
  let lastIndex = -1;
  let outOfOrder = 0;
  for (const item of outline) {
    const key = squeeze(stripNumbering(item.title));
    if (!key) continue;
    const index = flatHeadings.findIndex((text) => text.includes(key));
    if (index < 0) { missing.push(item.title); continue; }
    if (index < lastIndex) outOfOrder += 1;
    lastIndex = index;
  }

  const leafWithContent = [];
  const walk = (items) => {
    for (const item of items || []) {
      if (item.children?.length) { walk(item.children); continue; }
      if (String(item.content || '').trim()) leafWithContent.push(item);
    }
  };
  walk(outline);

  const lostContent = [];
  for (const item of leafWithContent) {
    const fragments = [...contentFragments(item.content), ...tableCellFragments(item.content)];
    const lost = fragments.filter((fragment) => !docText.includes(fragment));
    if (lost.length) {
      lostContent.push({
        title: item.title,
        lost: lost.length,
        total: fragments.length,
        sample: lost.slice(0, 3),
      });
    }
  }

  return { flatHeadings, missing, outOfOrder, leafWithContent: leafWithContent.length, lostContent, docText };
}

/** 2. 模板保真：各类章节插入的内容必须与来源逐段一致。 */
function checkTemplateFidelity(parsed, outline) {
  const docText = normalizedDocText(parsed);
  const sections = segmentByHeadings(parsed, outline);
  const results = [];
  const candidates = [];
  const walk = (items) => {
    for (const item of items || []) {
      if (item.children?.length) { walk(item.children); continue; }
      const content = String(item.content || '');
      if (!content.trim()) continue;
      candidates.push({ item, mode: item.content_mode || '', content });
    }
  };
  walk(outline);

  for (const { item, mode, content } of candidates) {
    const key = squeeze(stripNumbering(item.title));
    const section = sections.find((entry) => entry.heading.includes(key));
    const sectionText = section
      ? squeeze(stripInlineMarkdown(section.paragraphs.map((p) => p.text).join('')))
      : '';
    const fragments = contentFragments(content);
    const tableCells = tableCellFragments(content);
    const { codeLines } = splitFencedCode(content);
    const lost = fragments.filter((fragment) => !sectionText.includes(fragment) && !docText.includes(fragment));
    const lostTableCells = tableCells.filter((cell) => !docText.includes(cell));
    results.push({
      title: item.title,
      mode,
      fragments: fragments.length,
      lostFragments: lost.length,
      lostSample: lost.slice(0, 3),
      tableCells: tableCells.length,
      lostTableCells: lostTableCells.length,
      tableCellSample: lostTableCells.slice(0, 3),
      codeLines: codeLines.length,
      exportedChars: sectionText.length,
      sourceChars: squeeze(content).length,
    });
  }
  return results;
}

/** 代码块使用的等宽字体；这类段落按设计有别于正文格式。 */
const CODE_FONT_PATTERN = /consolas|courier|monaco|menlo|monospace/i;
/** 制表线框字符；出现即说明该段来自 ASCII 线框/表格代码块。 */
const BOX_DRAWING_PATTERN = /[┌┐└┘├┤┬┴┼─│╔╗╚╝║═]/;

function isCodeLikeParagraph(block) {
  if (BOX_DRAWING_PATTERN.test(block.text)) return true;
  return block.runs.some(
    (run) => CODE_FONT_PATTERN.test(run.eastAsia || '') || CODE_FONT_PATTERN.test(run.ascii || ''),
  );
}

/** 3. 格式一致：正文段落的字体/字号/对齐/缩进/行距是否与导出格式声明一致。 */
function checkBodyFormat(parsed, exportFormat) {
  const bodyStyle = exportFormat?.body_text || null;
  if (!bodyStyle) return { applicable: false, examined: 0, violations: [] };

  const expectFont = bodyStyle.font || '宋体';
  const expectSize = chineseSizeToHalfPt(bodyStyle.size || '小四');
  const expectAlign = ALIGN_MAP[bodyStyle.alignment] || 'both';
  const expectIndent = bodyStyle.first_line_indent_chars > 0
    ? String(charsToTwips(bodyStyle.first_line_indent_chars, expectSize))
    : '';
  const expectLine = String(Math.round(240 * (bodyStyle.line_spacing_multiple || 1.2)));

  const violations = [];
  let examined = 0;
  let seenHeading = false;
  for (const block of parsed.blocks) {
    if (block.kind !== 'p' || block.inTable) continue;
    if (/^heading[1-6]$/i.test(block.style)) { seenHeading = true; continue; }
    // 封面、目录域在第一个标题之前，使用封面专用字号/对齐，不参与正文格式判断。
    if (!seenHeading) continue;
    // 代码块（mermaid 源码、ASCII 线框）按设计使用等宽字体与行距，不参与正文格式判断。
    if (isCodeLikeParagraph(block)) continue;
    // 只看有正文长度的段落，落款/图注不参与判断。
    if (block.text.length < 40) continue;
    examined += 1;
    const reasons = [];
    const runs = block.runs.filter((r) => /[\u4e00-\u9fa5A-Za-z0-9]/.test(r.text));
    for (const run of runs) {
      if (run.eastAsia && run.eastAsia !== expectFont) reasons.push(`字体 ${run.eastAsia}≠${expectFont}`);
      if (run.size && run.size !== expectSize) reasons.push(`字号 ${run.size}≠${expectSize}`);
    }
    if (block.alignment && block.alignment !== expectAlign) reasons.push(`对齐 ${block.alignment}≠${expectAlign}`);
    if (expectIndent && block.firstLine && block.firstLine !== expectIndent) reasons.push(`首行缩进 ${block.firstLine}≠${expectIndent}`);
    if (block.lineSpacing && block.lineSpacing !== expectLine) reasons.push(`行距 ${block.lineSpacing}≠${expectLine}`);
    if (reasons.length) {
      violations.push({ text: block.text.slice(0, 36), reasons: [...new Set(reasons)] });
    }
  }
  return {
    applicable: true,
    examined,
    violations,
    expect: { font: expectFont, size: expectSize, align: expectAlign, indent: expectIndent, line: expectLine },
  };
}

/**
 * 抽出文档里的表格结构（列宽 + 每行的单元格文本与跨列数）。
 *
 * 单独一个遍历、不复用 parseDocx 的扁平化：列宽校验需要保留「行 -> 单元格」的归属，
 * 而 parseDocx 会把单元格里的段落直接摊进文档流。
 */
function parseTables(docxPath) {
  const zip = new AdmZip(docxPath);
  const xml = zip.readAsText('word/document.xml');
  const $ = cheerio.load(xml, { xmlMode: true });
  const root = $.root().get(0);
  const documentNode = findAll(root, 'document')[0] || root;
  const bodyNode = findChild(documentNode, 'body') || documentNode;

  return findAll(bodyNode, 'tbl').map((tbl) => {
    const widths = findAll(tbl, 'gridCol').map((col) => Number(attr(col, 'w:w')) || 0);
    const rows = childrenOf(tbl).filter((node) => localName(node) === 'tr').map((tr) => ({
      cells: childrenOf(tr).filter((node) => localName(node) === 'tc').map((tc) => {
        const tcPr = findChild(tc, 'tcPr');
        const span = Number(attr(findChild(tcPr, 'gridSpan'), 'w:val')) || 1;
        return { span, text: squeeze(textOf(tc)) };
      }),
    })).filter((row) => row.cells.length);
    return { widths, rows };
  });
}

/**
 * 列宽是否按各列自身的文本量分配。
 *
 * 这里刻意用导出服务同一套权重口径（每列最长「只占一列」的文本长度，clamp 8-60）反推
 * 每列应得的宽度占比，再要求实际占比不低于应得占比的一半。
 *
 * 为什么需要这条：跨列单元格（末列吸收补齐列，例如一条跨 3 列的 117 字长备注）曾经被
 * 按「只占一列」计入列宽需求，于是第 2 列被撑到全表一半、其余列被压成一条窄缝，
 * 渲染出来是一列一列竖着排的字。判据留了 0.5 的余量，只要不是明显失衡就不会误报。
 */
function checkTableColumnWidths(tables, options = {}) {
  const minShareRatio = Number.isFinite(options.minShareRatio) ? options.minShareRatio : 0.5;
  const MAX_CHARS = 60;
  const MIN_CHARS = 8;
  const violations = [];

  tables.forEach((table, tableIndex) => {
    const totalWidth = table.widths.reduce((sum, width) => sum + width, 0);
    if (!totalWidth || !table.widths.length) return;

    const colCharLengths = Array.from({ length: table.widths.length }, () => 0);
    for (const row of table.rows) {
      let colIdx = 0;
      for (const [cellIndex, cell] of row.cells.entries()) {
        const remainingSpan = cellIndex === row.cells.length - 1 ? table.widths.length - row.cells.length : 0;
        const effectiveSpan = cell.span + Math.max(0, remainingSpan);
        if (effectiveSpan === 1 && colIdx < table.widths.length) {
          colCharLengths[colIdx] = Math.max(colCharLengths[colIdx], cell.text.length);
        }
        colIdx += Math.max(1, effectiveSpan);
      }
    }

    const weights = colCharLengths.map((len) => Math.min(MAX_CHARS, Math.max(MIN_CHARS, len)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    weights.forEach((weight, columnIndex) => {
      const actualShare = table.widths[columnIndex] / totalWidth;
      const demandShare = weight / totalWeight;
      if (actualShare < demandShare * minShareRatio - 1e-9) {
        violations.push({
          table: tableIndex + 1,
          column: columnIndex + 1,
          width: table.widths[columnIndex],
          actualShare: Number(actualShare.toFixed(4)),
          demandShare: Number(demandShare.toFixed(4)),
          longestText: colCharLengths[columnIndex],
        });
      }
    });
  });

  return { examined: tables.length, violations };
}

/**
 * 大纲占满 1-3 级，正文小标题只能落在 4 级及更深。
 *
 * 目录域只收 1-3 级，而目录条目完全由大纲生成，所以「1-3 级标题数」应当等于
 * 「TOC1-3 条目数」。正文自己的 `###`/`####` 小标题必须整体下移到 4 级以外，否则
 * 「本节需人工准备的材料清单」这类正文小标题会混进目录，章节结构也会出现
 * H1 直接跳 H3 的断档。
 *
 * 这条断言把「目录只列大纲」这个取向固定住，顺带守住目录非空：
 * 目录若没写进缓存条目 → TOC 计数为 0 → 立刻报错；正文标题若被挪回 1-3 级 →
 * 标题计数超过目录条目数 → 也立刻报错。
 */
function checkContentHeadingLevels(parsed) {
  const countByStyle = (pattern) => {
    const counts = {};
    for (const block of parsed.blocks) {
      const match = pattern.exec(block.style || '');
      if (!match) continue;
      const level = Number(match[1]);
      counts[level] = (counts[level] || 0) + 1;
    }
    return counts;
  };

  const docByLevel = countByStyle(/^heading([1-6])$/i);
  const tocByLevel = countByStyle(/^toc([1-6])$/i);

  const mismatches = [];
  for (let level = 1; level <= 3; level += 1) {
    const expected = tocByLevel[level] || 0;
    const actual = docByLevel[level] || 0;
    if (expected !== actual) mismatches.push({ level, expected, actual });
  }

  return {
    docByLevel,
    tocByLevel,
    mismatches,
    tocEntryCount: [1, 2, 3].reduce((sum, level) => sum + (tocByLevel[level] || 0), 0),
    contentHeadingCount: [4, 5, 6].reduce((sum, level) => sum + (docByLevel[level] || 0), 0),
  };
}

module.exports = {
  parseDocx,
  parseTables,
  checkTableColumnWidths,
  checkContentHeadingLevels,
  segmentByHeadings,
  checkOutlinePresence,
  checkTemplateFidelity,
  checkBodyFormat,
  contentFragments,
  tableCellFragments,
  normalizedDocText,
  isCodeLikeParagraph,
  splitFencedCode,
  stripInlineMarkdown,
  squeeze,
  stripNumbering,
  chineseSizeToHalfPt,
  charsToTwips,
  localName,
  findChild,
  findAll,
  textOf,
  attr,
};
