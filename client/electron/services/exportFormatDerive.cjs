const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');

// ── 数值与单位换算 ─────────────────────────────────
function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
function halfPointsToPt(halfPoints) {
  return Number.isFinite(halfPoints) ? halfPoints / 2 : undefined;
}
function twipsToPt(twips) {
  return Number.isFinite(twips) ? round(twips / 20, 1) : undefined;
}
function twipsToCm(twips) {
  return Number.isFinite(twips) ? round(twips / 567, 2) : undefined;
}

// ── 中文字号名（按 pt 就近匹配） ────────────────────
const SIZE_NAME_BY_PT = [
  { pt: 42, name: '初号' },
  { pt: 36, name: '小初' },
  { pt: 26, name: '一号' },
  { pt: 24, name: '小一' },
  { pt: 22, name: '二号' },
  { pt: 18, name: '小二' },
  { pt: 16, name: '三号' },
  { pt: 15, name: '小三' },
  { pt: 14, name: '四号' },
  { pt: 12, name: '小四' },
  { pt: 10.5, name: '五号' },
  { pt: 9, name: '小五' },
  { pt: 7.5, name: '六号' },
  { pt: 6.5, name: '小六' },
];
function ptToSizeName(pt) {
  if (!Number.isFinite(pt) || pt <= 0) return undefined;
  let best = SIZE_NAME_BY_PT[0];
  for (const item of SIZE_NAME_BY_PT) {
    if (Math.abs(item.pt - pt) < Math.abs(best.pt - pt)) best = item;
  }
  return best.name;
}

// ── 字体名映射（OOXML 英文/中文 → 项目字体标签） ──────
const FONT_LABEL_BY_NAME = {
  simsun: '宋体',
  nsimsun: '新宋体',
  simhei: '黑体',
  kaiti: '楷体',
  fangsong: '仿宋',
  'microsoft yahei': '微软雅黑',
  dengxian: '等线',
  lisu: '隶书',
  youyuan: '幼圆',
  stsong: '宋体',
  stheiti: '黑体',
  stkaiti: '楷体',
  stfangsong: '仿宋',
  'pingfang sc': 'PingFang SC',
  'source han serif sc': 'Source Han Serif SC',
  'source han sans sc': 'Source Han Sans SC',
  宋体: '宋体',
  新宋体: '新宋体',
  黑体: '黑体',
  楷体: '楷体',
  仿宋: '仿宋',
  微软雅黑: '微软雅黑',
  等线: '等线',
  隶书: '隶书',
  幼圆: '幼圆',
};
function fontNameToLabel(name) {
  const text = String(name || '').trim();
  if (!text) return undefined;
  const byLower = FONT_LABEL_BY_NAME[text.toLowerCase()];
  if (byLower) return byLower;
  return text; // 未知字体原样保留，FontPicker 支持自定义字体
}

// ── 对齐 ──────────────────────────────────────────
const ALIGNMENT_BY_JC = {
  center: '居中对齐',
  both: '两端对齐',
  distribute: '两端对齐',
  left: '左对齐',
  start: '左对齐',
  right: '右对齐',
  end: '右对齐',
};
function jcToAlignment(jc) {
  return jc ? ALIGNMENT_BY_JC[jc] : undefined;
}

function hexColor(value) {
  const text = String(value || '').trim().replace(/^#/, '');
  if (!text || text.toLowerCase() === 'auto') return undefined;
  return /^[0-9a-fA-F]{6}$/.test(text) ? `#${text}` : undefined;
}

// ── 默认导出格式（与 src/shared/types/exportFormat.ts 的 DEFAULT_EXPORT_FORMAT 对齐） ──
function buildDefaultExportFormat() {
  return {
    template_name: '导入模版',
    include_toc: true,
    page: {
      paper_size: 'a4',
      orientation: 'portrait',
      first_page_different: true,
      margin_top_cm: 2,
      margin_bottom_cm: 2,
      margin_left_cm: 2,
      margin_right_cm: 2,
      header_enabled: true,
      header_text: '{project} 投标文件',
      header_font: '宋体',
      header_size: '小五',
      header_alignment: '居中对齐',
      header_color: '#536176',
      footer_enabled: true,
      footer_text: '',
      footer_distance_cm: 1.75,
      footer_font: '宋体',
      footer_size: '小五',
      footer_alignment: '居中对齐',
      footer_color: '#536176',
      page_number_enabled: true,
      page_number_format: '第{page}页 共{total}页',
      page_number_start: 1,
    },
    heading_level1_page_break_before: true,
    heading_border: {
      enabled: false,
      min_heading_left_enabled: false,
      border_color: '#c3d3f0',
      level_cell_colors: ['#eef5ff', '#f3f7ff', '#f8fbff', '#fbfdff', '#ffffff', '#ffffff'],
      structure: '上下结构',
    },
    headings: [
      { font: '黑体', size: '小二', alignment: '居中对齐', bold: false, text_color: '#243048', spacing_before_pt: 10, spacing_after_pt: 10, first_line_indent_chars: 0, line_spacing: 1, numbering_format: 'custom', numbering_template: '{zh}、' },
      { font: '黑体', size: '三号', alignment: '居中对齐', bold: false, text_color: '#243048', spacing_before_pt: 10, spacing_after_pt: 10, first_line_indent_chars: 0, line_spacing: 1, numbering_format: 'custom', numbering_template: '（{zh}）' },
      { font: '黑体', size: '四号', alignment: '居中对齐', bold: false, text_color: '#243048', spacing_before_pt: 10, spacing_after_pt: 10, first_line_indent_chars: 0, line_spacing: 1, numbering_format: 'custom', numbering_template: '{tail}' },
      { font: '楷体', size: '小四', alignment: '两端对齐', bold: false, text_color: '#243048', spacing_before_pt: 5, spacing_after_pt: 5, first_line_indent_chars: 0, line_spacing: 1, numbering_format: 'custom', numbering_template: '{tail}' },
      { font: '黑体', size: '小四', alignment: '两端对齐', bold: false, text_color: '#243048', spacing_before_pt: 5, spacing_after_pt: 5, first_line_indent_chars: 0, line_spacing: 1, numbering_format: 'custom', numbering_template: '{tail}' },
      { font: '宋体', size: '小四', alignment: '两端对齐', bold: false, text_color: '#243048', spacing_before_pt: 0, spacing_after_pt: 0, first_line_indent_chars: 0, line_spacing: 1, numbering_format: 'custom', numbering_template: '{tail}' },
    ],
    body_text: {
      font: '宋体',
      size: '小四',
      alignment: '两端对齐',
      spacing_before_pt: 0,
      spacing_after_pt: 0,
      first_line_indent_chars: 2,
      line_spacing_multiple: 1.5,
      list_style: 'disc',
      ordered_list_style: 'decimal-dot',
      list_indent_chars: 2,
    },
    table: {
      border_width: 1,
      border_color: '#dcdff6',
      cell_padding_pt: 6,
      full_width: true,
      header_row: { font: '黑体', size: '小五', alignment: '居中对齐', text_color: '#243048', background_color: '#eef5ff' },
      first_column: { font: '宋体', size: '小五', alignment: '左对齐', text_color: '#243048', background_color: '#ffffff' },
      body_cell: { font: '宋体', size: '小五', alignment: '左对齐', text_color: '#243048', background_color: '#ffffff' },
    },
    image: {
      max_width_percent: 90,
      alignment: '居中对齐',
      caption_font: '宋体',
      caption_size: '小五',
      caption_alignment: '居中对齐',
      caption_bold: false,
      caption_italic: false,
    },
  };
}

// ── XML 读取 ────────────────────────────────────────
function readZipText(zip, entryName) {
  const entry = zip.getEntry(entryName);
  return entry ? entry.getData().toString('utf8') : '';
}

function definedOnly(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

function parseRPr($rPr, $) {
  const out = {};
  if (!$rPr.length) return out;
  const $fonts = $rPr.find('w\\:rFonts').first();
  if ($fonts.length) {
    out.font = $fonts.attr('w:eastAsia') || $fonts.attr('w:ascii') || $fonts.attr('w:hAnsi') || undefined;
  }
  const $sz = $rPr.find('w\\:sz').first();
  if ($sz.length) out.sizeHalfPoints = Number($sz.attr('w:val'));
  const $color = $rPr.find('w\\:color').first();
  if ($color.length) out.color = $color.attr('w:val');
  const $b = $rPr.find('w\\:b').first();
  if ($b.length) out.bold = $b.attr('w:val') !== 'false' && $b.attr('w:val') !== '0';
  return out;
}

function parsePPr($pPr, $) {
  const out = {};
  if (!$pPr.length) return out;
  const $jc = $pPr.find('w\\:jc').first();
  if ($jc.length) out.jc = $jc.attr('w:val');
  const $spacing = $pPr.find('w\\:spacing').first();
  if ($spacing.length) {
    out.before = numAttr($spacing, 'w:before');
    out.after = numAttr($spacing, 'w:after');
    out.line = numAttr($spacing, 'w:line');
    out.lineRule = $spacing.attr('w:lineRule');
  }
  const $ind = $pPr.find('w\\:ind').first();
  if ($ind.length) {
    out.firstLine = numAttr($ind, 'w:firstLine');
    out.firstLineChars = numAttr($ind, 'w:firstLineChars');
  }
  const $outline = $pPr.find('w\\:outlineLvl').first();
  if ($outline.length) out.outlineLvl = Number($outline.attr('w:val'));
  return out;
}

function numAttr($el, name) {
  const raw = $el.attr(name);
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseStyles(stylesXml) {
  const byId = {};
  if (!stylesXml) return byId;
  const $ = cheerio.load(stylesXml, { xmlMode: true });
  $('w\\:style').each((_, el) => {
    const $el = $(el);
    if (($el.attr('w:type') || '') !== 'paragraph') return;
    const styleId = $el.attr('w:styleId');
    if (!styleId) return;
    byId[styleId] = {
      styleId,
      name: $el.children('w\\:name').attr('w:val') || '',
      basedOn: $el.children('w\\:basedOn').attr('w:val') || null,
      rPr: parseRPr($el.children('w\\:rPr'), $),
      pPr: parsePPr($el.children('w\\:pPr'), $),
    };
  });
  return byId;
}

function resolveStyle(byId, styleId, depth = 0) {
  const style = byId[styleId];
  if (!style || depth > 10) return { rPr: {}, pPr: {} };
  const base = style.basedOn ? resolveStyle(byId, style.basedOn, depth + 1) : { rPr: {}, pPr: {} };
  return {
    rPr: { ...base.rPr, ...definedOnly(style.rPr) },
    pPr: { ...base.pPr, ...definedOnly(style.pPr) },
  };
}

function findStyleIdForLevel(byId, level) {
  const outlineTarget = level - 1;
  const nameCandidates = [`heading ${level}`, `标题 ${level}`, `标题${level}`];
  for (const style of Object.values(byId)) {
    const resolved = resolveStyle(byId, style.styleId);
    if (Number.isFinite(resolved.pPr.outlineLvl) && resolved.pPr.outlineLvl === outlineTarget) {
      return style.styleId;
    }
  }
  for (const style of Object.values(byId)) {
    const name = (style.name || '').toLowerCase();
    if (nameCandidates.some((candidate) => name === candidate)) return style.styleId;
  }
  const idCandidates = [`heading${level}`, `heading_${level}`, `title${level}`, `bt${level}`, `a${level}`];
  for (const style of Object.values(byId)) {
    const idLower = (style.styleId || '').toLowerCase();
    if (idCandidates.includes(idLower)) return style.styleId;
  }
  return null;
}

function findNormalStyleId(byId) {
  for (const style of Object.values(byId)) {
    if ((style.name || '').toLowerCase() === 'normal' || style.name === '正文') return style.styleId;
  }
  return byId.Normal ? 'Normal' : null;
}

// ── document.xml：页面设置 + 正文抽样 ────────────────
function parsePageSetup(documentXml) {
  const out = {};
  if (!documentXml) return out;
  const $ = cheerio.load(documentXml, { xmlMode: true });
  const $sect = $('w\\:sectPr').last();
  if (!$sect.length) return out;
  const $pgSz = $sect.find('w\\:pgSz').first();
  if ($pgSz.length) {
    const widthTwips = numAttr($pgSz, 'w:w');
    const heightTwips = numAttr($pgSz, 'w:h');
    if (Number.isFinite(widthTwips) && Number.isFinite(heightTwips)) {
      const widthMm = round(widthTwips / 56.7, 1);
      const heightMm = round(heightTwips / 56.7, 1);
      out.orientation = widthMm > heightMm ? 'landscape' : 'portrait';
      const pw = out.orientation === 'landscape' ? heightMm : widthMm;
      const ph = out.orientation === 'landscape' ? widthMm : heightMm;
      out.paper_size = matchPaperSize(pw, ph);
    }
  }
  const $pgMar = $sect.find('w\\:pgMar').first();
  if ($pgMar.length) {
    out.margin_top_cm = twipsToCm(numAttr($pgMar, 'w:top'));
    out.margin_bottom_cm = twipsToCm(numAttr($pgMar, 'w:bottom'));
    out.margin_left_cm = twipsToCm(numAttr($pgMar, 'w:left'));
    out.margin_right_cm = twipsToCm(numAttr($pgMar, 'w:right'));
  }
  return definedOnly(out);
}

function matchPaperSize(widthMm, heightMm) {
  const candidates = {
    a4: [210, 297],
    a3: [297, 420],
    a5: [148, 210],
    b4: [250, 353],
    b5: [176, 250],
    letter: [215.9, 279.4],
    legal: [215.9, 355.6],
    '16k': [184, 260],
  };
  let best = 'a4';
  let bestScore = Infinity;
  for (const [key, [w, h]] of Object.entries(candidates)) {
    const score = Math.abs(w - widthMm) + Math.abs(h - heightMm);
    if (score < bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return bestScore <= 20 ? best : 'a4';
}

// 抽样正文段落的直接 rPr/pPr（统计多个正文段落求众数，避免命中封面特大标题）
function sampleBodyParagraph(documentXml, headingStyleIds) {
  if (!documentXml) return {};
  const $ = cheerio.load(documentXml, { xmlMode: true });
  const samples = [];

  $('w\\:body > w\\:p').each((_, el) => {
    if (samples.length >= 100) return false;
    const $p = $(el);
    const $pStyle = $p.find('> w\\:pPr > w\\:pStyle').first();
    const styleId = $pStyle.attr('w:val');
    if (styleId && headingStyleIds.has(styleId)) return true; // 跳过标题段落
    const text = $p.find('w\\:t').text().trim();
    if (text.length < 25) return true; // 跳过封面短语、空行或简单编号
    if ($p.find('w\\:hyperlink').length > 0 || $p.find('w\\:instrText').text().includes('HYPERLINK')) return true; // 跳过目录超链接段落

    const $pPr = $p.find('> w\\:pPr').first();
    const pPr = parsePPr($pPr, $);

    // 从有文本的 run 中提取最具代表性的字体与字号
    let runRPr = {};
    $p.find('w\\:r').each((_, rEl) => {
      const $r = $(rEl);
      if ($r.find('w\\:t').text().trim().length > 0) {
        const parsed = parseRPr($r.find('w\\:rPr'), $);
        if (parsed.font || parsed.sizeHalfPoints) {
          runRPr = { ...runRPr, ...definedOnly(parsed) };
        }
      }
    });

    const rPr = {
      ...parseRPr($pPr.find('> w\\:rPr'), $),
      ...runRPr,
    };
    samples.push({ styleId, pPr, rPr });
  });

  if (!samples.length) return {};
  if (samples.length === 1) return samples[0];

  // 统计字号频次，选取正文最典型的众数字号
  const sizeFreq = new Map();
  for (const s of samples) {
    const sz = s.rPr?.sizeHalfPoints;
    if (sz) sizeFreq.set(sz, (sizeFreq.get(sz) || 0) + 1);
  }

  let modeSize = null;
  let maxCount = 0;
  for (const [sz, count] of sizeFreq.entries()) {
    if (count > maxCount) {
      maxCount = count;
      modeSize = sz;
    }
  }

  // 优先选取符合众数字号的样本，其次取后部正文
  const bestSample = samples.find((s) => s.rPr?.sizeHalfPoints === modeSize) || samples[samples.length - 1];
  return bestSample || {};
}

// ── 映射为 ExportFormatConfig 字段 ──────────────────
function styleToHeadingFields(resolved) {
  const rPr = resolved.rPr || {};
  const pPr = resolved.pPr || {};
  const sizePt = halfPointsToPt(rPr.sizeHalfPoints);
  const fields = {
    font: fontNameToLabel(rPr.font),
    size: ptToSizeName(sizePt),
    alignment: jcToAlignment(pPr.jc),
    bold: rPr.bold === undefined ? undefined : Boolean(rPr.bold),
    text_color: hexColor(rPr.color),
    spacing_before_pt: twipsToPt(pPr.before),
    spacing_after_pt: twipsToPt(pPr.after),
    first_line_indent_chars: firstLineIndentChars(pPr, sizePt),
    line_spacing: lineSpacingMultiple(pPr, sizePt),
  };
  return definedOnly(fields);
}

function styleToBodyFields(resolved) {
  const rPr = resolved.rPr || {};
  const pPr = resolved.pPr || {};
  const sizePt = halfPointsToPt(rPr.sizeHalfPoints);
  const fields = {
    font: fontNameToLabel(rPr.font),
    size: ptToSizeName(sizePt),
    alignment: jcToAlignment(pPr.jc),
    spacing_before_pt: twipsToPt(pPr.before),
    spacing_after_pt: twipsToPt(pPr.after),
    first_line_indent_chars: firstLineIndentChars(pPr, sizePt),
    line_spacing_multiple: lineSpacingMultiple(pPr, sizePt),
  };
  return definedOnly(fields);
}

function firstLineIndentChars(pPr, fontSizePt) {
  if (Number.isFinite(pPr.firstLineChars)) return round(pPr.firstLineChars / 100, 1);
  if (Number.isFinite(pPr.firstLine) && Number.isFinite(fontSizePt) && fontSizePt > 0) {
    return round((pPr.firstLine / 20) / fontSizePt, 1);
  }
  return undefined;
}

function lineSpacingMultiple(pPr, fontSizePt) {
  if (!Number.isFinite(pPr.line)) return undefined;
  if (pPr.lineRule === 'exact' || pPr.lineRule === 'atLeast') {
    if (Number.isFinite(fontSizePt) && fontSizePt > 0) return round(pPr.line / 20 / fontSizePt, 2);
    return undefined;
  }
  return round(pPr.line / 240, 2);
}

// ── PDF 启发式推导（无语义样式，仅从文字层的字号/位置近似） ──
async function deriveExportFormatFromPdf(filePath) {
  const buffer = await fs.promises.readFile(filePath);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // 显式指定与当前 pdfjs-dist 版本匹配的 worker，避免与 pdf-parse 内嵌旧版 worker 的版本不一致告警。
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true });
  const document = await loadingTask.promise;

  let pageWidth = 0;
  let pageHeight = 0;
  const items = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      if (!pageWidth) {
        pageWidth = viewport.width || 0;
        pageHeight = viewport.height || 0;
      }
      const content = await page.getTextContent();
      for (const item of content.items || []) {
        const text = String(item.str || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const transform = Array.isArray(item.transform) ? item.transform : [];
        const fontSize = Number(item.height) || Math.hypot(Number(transform[2]) || 0, Number(transform[3]) || 0);
        items.push({
          text,
          x: Number(transform[4]) || 0,
          width: Number(item.width) || 0,
          fontSize,
          fontName: String(item.fontName || ''),
        });
      }
    }
  } finally {
    await document.destroy().catch(() => undefined);
  }

  if (!items.length) {
    throw new Error('该 PDF 未检测到可选中文字层，可能是扫描件，请先 OCR 或改用 docx 标书');
  }

  const config = buildDefaultExportFormat();
  const derivedPage = derivePdfPageSetup(pageWidth, pageHeight, items);
  config.page = { ...config.page, ...derivedPage };

  const { bodySizeName, headingSizes, bodyFont, headingAlignments } = analyzePdfTextStyles(items, pageWidth);
  if (bodySizeName) config.body_text.size = bodySizeName;
  if (bodyFont) config.body_text.font = bodyFont;
  config.headings = config.headings.map((heading, index) => {
    const next = { ...heading };
    const sizeName = headingSizes[index];
    if (sizeName) next.size = sizeName;
    if (headingAlignments[index]) next.alignment = headingAlignments[index];
    return next;
  });

  const summary = {
    paper: `${config.page.paper_size}${config.page.orientation === 'landscape' ? '（横向）' : ''}`,
    marginsCm: [config.page.margin_top_cm, config.page.margin_bottom_cm, config.page.margin_left_cm, config.page.margin_right_cm],
    headingFont: config.headings[0]?.font,
    headingSize: config.headings[0]?.size,
    bodyFont: config.body_text.font,
    bodySize: config.body_text.size,
    derivedHeadingLevels: headingSizes.filter(Boolean).length,
    note: 'PDF 无语义样式，纸张/边距/字号为近似值，建议保存后在「我的模板」里微调',
  };

  return { config, summary };
}

function derivePdfPageSetup(pageWidthPt, pageHeightPt, items) {
  const out = {};
  if (pageWidthPt > 0 && pageHeightPt > 0) {
    const widthMm = round((pageWidthPt * 25.4) / 72, 1);
    const heightMm = round((pageHeightPt * 25.4) / 72, 1);
    out.orientation = widthMm > heightMm ? 'landscape' : 'portrait';
    const pw = out.orientation === 'landscape' ? heightMm : widthMm;
    const ph = out.orientation === 'landscape' ? widthMm : heightMm;
    out.paper_size = matchPaperSize(pw, ph);

    // 边距近似：用文字层包围盒相对页面的偏移
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const item of items) {
      minX = Math.min(minX, item.x);
      maxX = Math.max(maxX, item.x + item.width);
      minY = Math.min(minY, item.y);
      maxY = Math.max(maxY, item.y + (item.fontSize || 0));
    }
    if (isFinite(minX) && isFinite(maxX) && isFinite(minY) && isFinite(maxY)) {
      // PDF 坐标原点在左下；top = 页面高 - 文字最高点，bottom = 文字最低点
      const leftPt = Math.max(minX, 0);
      const rightPt = Math.max(pageWidthPt - maxX, 0);
      const topPt = Math.max(pageHeightPt - maxY, 0);
      const bottomPt = Math.max(minY, 0);
      const clampCm = (pt) => round(twipsToCmBrute(pt), 2);
      out.margin_left_cm = clampCm(leftPt);
      out.margin_right_cm = clampCm(rightPt);
      out.margin_top_cm = clampCm(topPt);
      out.margin_bottom_cm = clampCm(bottomPt);
    }
  }
  return definedOnly(out);
}

function twipsToCmBrute(pt) {
  // pt → cm（PDF 用点；1pt = 25.4/72 mm）
  return (pt * 25.4) / 72 / 10;
}

function analyzePdfTextStyles(items, pageWidthPt) {
  const sizes = items
    .map((item) => round(item.fontSize, 1))
    .filter((size) => size >= 6 && size <= 40);
  if (!sizes.length) return { bodySizeName: undefined, headingSizes: [], headingAlignments: [] };

  const freq = new Map();
  for (const size of sizes) freq.set(size, (freq.get(size) || 0) + 1);
  let bodySize = sizes[0];
  let bodyCount = 0;
  for (const [size, count] of freq) {
    if (count > bodyCount) {
      bodyCount = count;
      bodySize = size;
    }
  }

  const bodySizeName = ptToSizeName(bodySize);

  // 标题字号：取明显大于正文、且不超过正文 2.5 倍（排除封面大标题）的字号，按 ≥1.4pt 容差聚簇为一档
  const headingReps = clusterHeadingSizes(freq, bodySize);
  const headingSizes = headingReps.map((size) => ptToSizeName(size));
  for (let index = headingSizes.length; index < 6; index += 1) {
    headingSizes.push(undefined);
  }

  const fontFreq = new Map();
  for (const item of items) {
    const name = subsetFontToLabel(item.fontName);
    if (name) fontFreq.set(name, (fontFreq.get(name) || 0) + 1);
  }
  let bodyFont;
  let bodyCount2 = 0;
  for (const [name, count] of fontFreq) {
    if (count > bodyCount2) {
      bodyCount2 = count;
      bodyFont = name;
    }
  }
  // 内嵌字体内部名（如 g_d0_f1）解析不出真实字体时，按中文标书惯例回退宋体
  if (/(^|[^A-Za-z])[a-z0-9_]+$/i.test(String(bodyFont || '')) || /g_d\d+_f\d+/i.test(String(bodyFont || ''))) {
    bodyFont = '宋体';
  }

  // 标题对齐：标题字号行的水平居中率
  const headingAlignments = [];
  const pageHalf = pageWidthPt / 2;
  for (const size of headingReps) {
    if (!size) {
      headingAlignments.push(undefined);
      continue;
    }
    const targetSize = round(size, 1);
    const candidates = items.filter((item) => Math.abs(round(item.fontSize, 1) - targetSize) < 0.5);
    const centered = candidates.some((item) => Number.isFinite(pageHalf) && pageHalf > 0 && Math.abs(item.x + item.width / 2 - pageHalf) < 30);
    headingAlignments.push(centered ? '居中对齐' : undefined);
  }

  return {
    bodySizeName,
    headingSizes,
    bodyFont,
    headingAlignments,
  };
}

function clusterHeadingSizes(freq, bodySize) {
  if (!bodySize) return [];
  const candidates = [...freq.keys()]
    .filter((size) => size > bodySize * 1.08 && size <= bodySize * 2.5)
    .sort((a, b) => b - a);
  const buckets = [];
  for (const size of candidates) {
    const last = buckets[buckets.length - 1];
    if (last && Math.abs(last.rep - size) <= 1.4) {
      last.items.push(size);
      last.rep = round(last.items.reduce((sum, item) => sum + item, 0) / last.items.length, 1);
    } else {
      buckets.push({ rep: size, items: [size] });
    }
  }
  return buckets.map((bucket) => bucket.rep);
}

function subsetFontToLabel(fontName) {
  const trimmed = String(fontName || '').replace(/^[A-Z]{6}\+/, '').trim();
  return fontNameToLabel(trimmed);
}

// ── 主入口 ──────────────────────────────────────────
/** 根据文件扩展名选择推导路径：.docx 精确读样式，.pdf 用文字层近似。 */
async function deriveExportFormatFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    return deriveExportFormatFromPdf(filePath);
  }
  if (ext === '.docx') {
    return deriveExportFormatFromDocx(filePath);
  }
  throw new Error(`暂不支持该文件格式（.${ext.replace('.', '')}），请使用 .docx 或 .pdf 标书`);
}

/** 从一份 .docx 推导导出排版配置（ExportFormatConfig）。仅支持 docx。 */
function deriveExportFormatFromDocx(filePath) {
  const zip = new AdmZip(filePath);
  const stylesXml = readZipText(zip, 'word/styles.xml');
  const documentXml = readZipText(zip, 'word/document.xml');
  if (!documentXml) {
    throw new Error('未能从该文件读取文档内容，请确认是有效的 .docx 文件');
  }

  const byId = parseStyles(stylesXml);
  const headingStyleIds = new Set();
  const derivedHeadings = [];
  for (let level = 1; level <= 6; level += 1) {
    const styleId = findStyleIdForLevel(byId, level);
    if (styleId) headingStyleIds.add(styleId);
    const resolved = styleId ? resolveStyle(byId, styleId) : { rPr: {}, pPr: {} };
    derivedHeadings.push(styleToHeadingFields(resolved));
  }

  const normalStyleId = findNormalStyleId(byId);
  const normalResolved = normalStyleId ? resolveStyle(byId, normalStyleId) : { rPr: {}, pPr: {} };
  const bodySample = sampleBodyParagraph(documentXml, headingStyleIds);
  const bodyStyleResolved = bodySample.styleId ? resolveStyle(byId, bodySample.styleId) : normalResolved;
  const bodyResolved = {
    rPr: { ...definedOnly(normalResolved.rPr), ...definedOnly(bodyStyleResolved.rPr), ...definedOnly(bodySample.rPr) },
    pPr: { ...definedOnly(normalResolved.pPr), ...definedOnly(bodyStyleResolved.pPr), ...definedOnly(bodySample.pPr) },
  };
  const derivedBody = styleToBodyFields(bodyResolved);
  const derivedPage = parsePageSetup(documentXml);

  const config = buildDefaultExportFormat();
  config.page = { ...config.page, ...definedOnly(derivedPage) };
  config.headings = config.headings.map((heading, index) => ({ ...heading, ...derivedHeadings[index] }));
  config.body_text = { ...config.body_text, ...definedOnly(derivedBody) };

  const summary = {
    paper: `${config.page.paper_size}${config.page.orientation === 'landscape' ? '（横向）' : ''}`,
    marginsCm: [config.page.margin_top_cm, config.page.margin_bottom_cm, config.page.margin_left_cm, config.page.margin_right_cm],
    headingFont: config.headings[0]?.font,
    headingSize: config.headings[0]?.size,
    bodyFont: config.body_text.font,
    bodySize: config.body_text.size,
    derivedHeadingLevels: derivedHeadings.filter((item) => Object.keys(item).length > 0).length,
  };

  return { config, summary };
}

module.exports = {
  buildDefaultExportFormat,
  deriveExportFormatFromDocx,
  deriveExportFormatFromFile,
};
