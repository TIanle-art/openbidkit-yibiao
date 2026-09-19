const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { app, dialog, nativeImage } = require('electron');
const cheerio = require('cheerio');
const { imageSize } = require('image-size');
const { compactLogError, createDeveloperLogger, textMetrics } = require('../utils/developerLog.cjs');
const { getMermaidCacheEntry, saveMermaidCacheImage } = require('../utils/mermaidCache.cjs');
const { getGeneratedImagesDir, getImageLibraryDir, getImportedImagesDir } = require('../utils/paths.cjs');
const { REMOTE_IMAGE_RETRY_ATTEMPTS, REMOTE_IMAGE_RETRY_DELAY_MS } = require('../utils/remoteImageRetry.cjs');
const { renderMarkdownHtml } = require('../utils/renderMarkdownHtml.cjs');
const { getLocalImageRenderService } = require('./localImageRenderService.cjs');
const { evaluateContaminationGate } = require('./contaminationGuard.cjs');
const {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeightRule,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LevelSuffix,
  Packer,
  PageNumber,
  PageBreak,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TableOfContents,
  TextRun,
  UnderlineType,
  VerticalAlignTable,
  WidthType,
} = require('docx');

const MAX_IMAGE_WIDTH = 520;
const MAX_IMAGE_HEIGHT_PERCENT = 90;
const NUMBERING_REFERENCE_PREFIX = 'technical-plan-numbering';
const HEADING_NUMBERING_REFERENCE = 'technical-plan-heading-numbering';
const DOCX_TABLE_WIDTH_TWIPS = 9000;
const CHAPTER_LEAF_TITLE_WIDTH_TWIPS = 1800;
const CHAPTER_LEAF_CONTENT_WIDTH_TWIPS = DOCX_TABLE_WIDTH_TWIPS - CHAPTER_LEAF_TITLE_WIDTH_TWIPS;
const DEFAULT_HEADING_BORDER_CELL_COLORS = ['#e0ecff', '#e9f1ff', '#f2f7ff', '#f8fbff', '#ffffff', '#ffffff'];
const DEFAULT_TABLE_STYLE = {
  border_width: 1,
  border_color: '#dcdff6',
  cell_padding_pt: 6,
  full_width: true,
  header_row: { font: '黑体', size: '小五', alignment: '居中对齐', text_color: '#243048', background_color: '#eef5ff' },
  first_column: { font: '宋体', size: '小五', alignment: '左对齐', text_color: '#243048', background_color: '#ffffff' },
  body_cell: { font: '宋体', size: '小五', alignment: '左对齐', text_color: '#243048', background_color: '#ffffff' },
};
const DEFAULT_IMAGE_STYLE = {
  max_width_percent: 90,
  alignment: '居中对齐',
  caption_font: '宋体',
  caption_size: '小五',
  caption_alignment: '居中对齐',
  caption_bold: false,
  caption_italic: false,
};
const UNORDERED_LIST_MARKERS = {
  disc: { text: '•', font: 'Arial', sizeScale: 0.75 },
  circle: { text: '○', font: 'Arial', sizeScale: 0.82 },
  square: { text: '■', font: 'Arial', sizeScale: 0.72 },
  diamond: { text: '◆', font: 'Arial', sizeScale: 0.72 },
  dash: { text: '–', font: 'Arial', sizeScale: 0.9 },
  check: { text: '✓', font: 'Segoe UI Symbol', sizeScale: 0.85 },
  arrow: { text: '➢', font: 'Segoe UI Symbol', sizeScale: 0.88 },
  sparkle: { text: '✧', font: 'Segoe UI Symbol', sizeScale: 0.9 },
};
const ORDERED_LIST_WORD_STYLES = {
  'decimal-dot': { format: LevelFormat.DECIMAL, text: (level) => `%${level + 1}.` },
  'decimal-paren': { format: LevelFormat.DECIMAL, text: (level) => `%${level + 1}）` },
  'decimal-full-paren': { format: LevelFormat.DECIMAL, text: (level) => `（%${level + 1}）` },
  'chinese-dot': { format: LevelFormat.CHINESE_COUNTING, text: (level) => `%${level + 1}、` },
  'chinese-paren': { format: LevelFormat.CHINESE_COUNTING, text: (level) => `（%${level + 1}）` },
  'lower-alpha': { format: LevelFormat.LOWER_LETTER, text: (level) => `%${level + 1}.` },
  'upper-alpha': { format: LevelFormat.UPPER_LETTER, text: (level) => `%${level + 1}.` },
  'lower-roman': { format: LevelFormat.LOWER_ROMAN, text: (level) => `%${level + 1}.` },
  'upper-roman': { format: LevelFormat.UPPER_ROMAN, text: (level) => `%${level + 1}.` },
};

// 纸张尺寸 mm（portrait 模式 width × height），与 Renderer exportFormat.ts 保持一致
const PAPER_DIMENSIONS_MM = {
  a4: { width: 210, height: 297 },
  a3: { width: 297, height: 420 },
  a5: { width: 148, height: 210 },
  b4: { width: 250, height: 353 },
  b5: { width: 176, height: 250 },
  letter: { width: 215.9, height: 279.4 },
  legal: { width: 215.9, height: 355.6 },
  '16k': { width: 184, height: 260 },
};

function mmToTwips(mm) {
  return Math.round(mm * 56.6929); // 1mm = 1440 twips ÷ 25.4 mm/inch
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPercent(value) {
  return Math.max(0, Math.min(Math.round(Number(value) || 0), 100));
}

function reportProgress(context, progress, message, extra = {}) {
  if (!context?.onProgress) return;
  try {
    context.onProgress({
      phase: extra.phase || 'running',
      progress: clampPercent(progress),
      message,
      warnings: [...(context.warnings || [])],
      ...extra,
    });
  } catch (error) {
    console.warn('[export-word] progress callback failed', error);
  }
}

function reportConversionProgress(context, message) {
  const stats = context?.stats || {};
  const total = Math.max(1, (stats.leafCount || 0) + (stats.mermaidCount || 0));
  const done = Math.min(total, (context.convertedLeafCount || 0) + (context.convertedMermaidCount || 0));
  reportProgress(context, 10 + (done / total) * 78, message);
}

function writeExportLog(context, event, payload = {}) {
  if (!context?.developerLogger?.enabled) return;
  context.developerLogger.write(event, payload);
}

function addWarning(context, message) {
  if (context?.warnings) {
    context.warnings.push(message);
  }
  writeExportLog(context, 'export.warning', { message });
  console.warn(`[export-word] ${message}`);
}

function addUnsupportedHtmlWarning(context, tagName) {
  const tag = String(tagName || '').toLowerCase();
  if (!tag) return;
  if (!context.unsupportedHtmlTags) {
    context.unsupportedHtmlTags = new Set();
  }
  if (context.unsupportedHtmlTags.has(tag)) {
    return;
  }
  context.unsupportedHtmlTags.add(tag);
  addWarning(context, `HTML 标签 <${tag}> 导出时已降级，请核对 Word 内容。`);
}

function compactText(value, maxLength = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function countMermaidBlocks(content) {
  return (String(content || '').match(/```mermaid[\s\S]*?```/gi) || []).length;
}

function countOutlineStats(items = []) {
  let leafCount = 0;
  let mermaidCount = 0;

  for (const item of items || []) {
    if (item.children?.length) {
      const childStats = countOutlineStats(item.children);
      leafCount += childStats.leafCount;
      mermaidCount += childStats.mermaidCount;
    } else {
      leafCount += 1;
      mermaidCount += countMermaidBlocks(item.content);
    }
  }

  return { leafCount, mermaidCount };
}

function buildPendingContentModeParagraph(item) {
  if (String(item?.content || '').trim()) return null;
  let message = '';
  if (item?.content_mode === 'template-fill') {
    message = '待补充：本节需按招标文件模板填写，知识库/资料中暂未生成内容。';
  } else if (item?.content_mode === 'point-to-point') {
    message = '待补充：本节为点对点应答表，需在正文完成并确定 Word 页码后回填。';
  } else if (item?.content_mode === 'other') {
    message = `待补充：${String(item?.content_mode_note || '').trim() || '本节内容知识库/资料中暂缺'}，请补充后重新生成。`;
  }
  return message
    ? paragraph([textRun(`[${message}]`, { color: '8A650B', italics: true })], { after: 120 })
    : null;
}

function collectOutlineContents(items = []) {
  const contents = [];
  for (const item of items || []) {
    if (item.children?.length) {
      contents.push(...collectOutlineContents(item.children));
    } else {
      contents.push(String(item.content || ''));
    }
  }
  return contents;
}

function countOutlineContentMetrics(items = []) {
  const contents = collectOutlineContents(items);
  return {
    ...textMetrics(contents.join('\n\n')),
    leaf_content_count: contents.filter((content) => content.trim()).length,
  };
}

function loadDeveloperConfig(configStore) {
  try {
    return configStore?.load?.() || {};
  } catch {
    return {};
  }
}

function sanitizeFilename(value) {
  return String(value || '标书文档')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '标书文档';
}

function formatExportTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatChineseDate(date = new Date()) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function cleanText(value) {
  return String(value || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function normalizeDocxColor(value, fallback = '536176') {
  const raw = String(value || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return raw.split('').map((char) => `${char}${char}`).join('').toUpperCase();
  }
  return fallback;
}

function textRun(text, options = {}) {
  return new TextRun({
    text: cleanText(text),
    font: options.font || '宋体',
    size: options.size || 24,
    bold: options.bold,
    italics: options.italics,
    strike: options.strike,
    color: options.color,
    underline: options.underline ? { type: UnderlineType.SINGLE } : undefined,
  });
}

function lineBreakRun() {
  return new TextRun({ break: 1 });
}

function textRunsWithBreaks(value, options = {}) {
  const parts = String(value || '').split(/<br\s*\/?\s*>/gi);
  const runs = [];

  parts.forEach((part, index) => {
    if (index > 0) {
      runs.push(lineBreakRun());
    }
    if (part) {
      runs.push(textRun(part, options));
    }
  });

  return runs;
}

function paragraph(children, options = {}) {
  return new Paragraph({
    children: children?.length ? children : [textRun('')],
    heading: options.heading,
    pageBreakBefore: options.pageBreakBefore,
    alignment: options.alignment,
    bullet: options.bullet,
    numbering: options.numbering,
    spacing: { before: options.before || 0, after: options.after ?? 160, line: options.line || 360 },
    indent: options.indent,
    border: options.border,
    shading: options.shading,
  });
}

function pageBreakParagraph() {
  return paragraph([new PageBreak()], { after: 0, line: 0 });
}

function isLevel1PageBreakEnabled(exportFormat) {
  return exportFormat?.heading_level1_page_break_before === true;
}

function isFooterEnabled(pageSetup) {
  return pageSetup ? pageSetup.footer_enabled !== false : true;
}

function isPageNumberEnabled(pageSetup) {
  return pageSetup ? pageSetup.page_number_enabled !== false : true;
}

function getChapterFrameConfig(exportFormat) {
  const frame = exportFormat?.heading_border;
  if (!frame?.enabled) return null;
  const color = normalizeDocxColor(frame.border_color || '#2174fd', '2174FD');
  const levelCellColors = Array.isArray(frame.level_cell_colors) ? frame.level_cell_colors : [];
  return {
    color,
    minHeadingLeftEnabled: frame.min_heading_left_enabled === true,
    fills: DEFAULT_HEADING_BORDER_CELL_COLORS.map((fill, index) => {
      const fallback = normalizeDocxColor(fill, 'FFFFFF');
      return normalizeDocxColor(levelCellColors[index] || fill, fallback);
    }),
  };
}

function chapterHeadingRowStyle(level) {
  const horizontal = 0;
  const table = [
    { height: 520, top: 120, bottom: 120, left: horizontal, right: horizontal },
    { height: 430, top: 100, bottom: 100, left: horizontal, right: horizontal },
    { height: 360, top: 80, bottom: 80, left: horizontal, right: horizontal },
    { height: 320, top: 70, bottom: 70, left: horizontal, right: horizontal },
    { height: 290, top: 60, bottom: 60, left: horizontal, right: horizontal },
    { height: 270, top: 55, bottom: 55, left: horizontal, right: horizontal },
  ];
  return table[Math.max(0, Math.min(level - 1, table.length - 1))];
}

function buildChapterHeadingRow(exportFormat, headingParagraph, level) {
  const frame = getChapterFrameConfig(exportFormat);
  if (!frame) return undefined;
  const border = { style: BorderStyle.SINGLE, size: 6, color: frame.color };
  const none = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' };
  const rowStyle = chapterHeadingRowStyle(level);
  const columnSpan = frame.minHeadingLeftEnabled ? 2 : undefined;

  return new TableRow({
    cantSplit: true,
    height: { value: rowStyle.height, rule: HeightRule.ATLEAST },
    children: [new TableCell({
      children: [headingParagraph],
      shading: { type: ShadingType.CLEAR, fill: frame.fills[Math.max(0, Math.min(level - 1, 5))] || 'FFFFFF' },
      margins: { top: rowStyle.top, bottom: rowStyle.bottom, left: rowStyle.left, right: rowStyle.right },
      columnSpan,
      width: { size: DOCX_TABLE_WIDTH_TWIPS, type: WidthType.DXA },
      borders: { top: border, left: border, right: border, bottom: border },
    })],
  });
}

function buildChapterContentRow(exportFormat, bodyChildren) {
  const frame = getChapterFrameConfig(exportFormat);
  if (!frame) return undefined;
  const border = { style: BorderStyle.SINGLE, size: 6, color: frame.color };
  const none = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' };
  const body = bodyChildren?.length ? bodyChildren : [paragraph([textRun('')], { after: 0 })];
  const columnSpan = frame.minHeadingLeftEnabled ? 2 : undefined;

  return new TableRow({
    cantSplit: true,
    children: [new TableCell({
      children: body,
      margins: { top: 200, bottom: 220, left: 260, right: 260 },
      columnSpan,
      width: { size: DOCX_TABLE_WIDTH_TWIPS, type: WidthType.DXA },
      borders: { top: none, left: border, right: border, bottom: border },
    })],
  });
}

function buildChapterLeafRow(exportFormat, titleParagraph, bodyChildren, level) {
  const frame = getChapterFrameConfig(exportFormat);
  if (!frame) return undefined;
  const border = { style: BorderStyle.SINGLE, size: 6, color: frame.color };
  const body = bodyChildren?.length ? bodyChildren : [paragraph([textRun('')], { after: 0 })];
  const fill = frame.fills[Math.max(0, Math.min(level - 1, 5))] || 'FFFFFF';

  return new TableRow({
    cantSplit: true,
    children: [
      new TableCell({
        children: [titleParagraph],
        shading: { type: ShadingType.CLEAR, fill },
        margins: { top: 160, bottom: 160, left: 160, right: 160 },
        verticalAlign: VerticalAlignTable.CENTER,
        width: { size: CHAPTER_LEAF_TITLE_WIDTH_TWIPS, type: WidthType.DXA },
        borders: { top: border, left: border, right: border, bottom: border },
      }),
      new TableCell({
        children: body,
        margins: { top: 200, bottom: 220, left: 260, right: 260 },
        width: { size: CHAPTER_LEAF_CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
        borders: { top: border, left: border, right: border, bottom: border },
      }),
    ],
  });
}

function buildChapterFrameTable(exportFormat, rows) {
  const frame = getChapterFrameConfig(exportFormat);
  if (!frame) return undefined;
  const border = { style: BorderStyle.SINGLE, size: 6, color: frame.color };
  const none = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' };

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: frame.minHeadingLeftEnabled ? [CHAPTER_LEAF_TITLE_WIDTH_TWIPS, CHAPTER_LEAF_CONTENT_WIDTH_TWIPS] : [DOCX_TABLE_WIDTH_TWIPS],
    layout: TableLayoutType.FIXED,
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: none,
    },
  });
}

function createPageNumberRuns(format, runOptions) {
  const parts = String(format || '第{page}页').split(/(\{page\}|\{total\})/);
  const runs = [];

  for (const part of parts) {
    if (part === '{page}') {
      runs.push(new TextRun({ ...runOptions, children: [PageNumber.CURRENT] }));
    } else if (part === '{total}') {
      runs.push(new TextRun({ ...runOptions, children: [PageNumber.TOTAL_PAGES] }));
    } else if (part) {
      runs.push(new TextRun({ ...runOptions, text: cleanText(part) }));
    }
  }

  return runs;
}

// 元信息完全无法解析时 resolveBidMetadata 会给出这个占位项目名。
// 它只适合出现在封面，不适合塞进页眉变成「投标技术文件 投标文件」。
const UNRESOLVED_PROJECT_NAME = '投标技术文件';

function substituteProjectPlaceholder(template, projectName) {
  const name = String(projectName || '').trim();
  const usable = name === UNRESOLVED_PROJECT_NAME ? '' : name;
  return String(template || '').replace(/\{project\}/g, usable);
}

function buildWordHeaders(pageSetup, projectName) {
  const enabled = pageSetup ? pageSetup.header_enabled === true : false;
  const headerText = cleanText(substituteProjectPlaceholder(pageSetup?.header_text, projectName)).trim();
  if (!enabled || !headerText) return undefined;

  const runOptions = {
    font: pageSetup?.header_font || '宋体',
    size: chineseSizeToHalfPt(pageSetup?.header_size || '小五'),
    color: normalizeDocxColor(pageSetup?.header_color || '#536176'),
  };
  const borderColor = normalizeDocxColor(pageSetup?.header_color || '#B0B8C8', 'B0B8C8');

  return {
    default: new Header({
      children: [
        new Paragraph({
          alignment: alignmentToWordType(pageSetup?.header_alignment || '居中对齐'),
          border: {
            bottom: {
              color: borderColor,
              space: 4,
              style: BorderStyle.SINGLE,
              size: 6,
            },
          },
          children: [new TextRun({ ...runOptions, text: headerText })],
        }),
      ],
    }),
    first: new Header({ children: [] }),
  };
}

function buildWordFooters(pageSetup, projectName) {
  const footerEnabled = isFooterEnabled(pageSetup);
  const footerText = footerEnabled ? cleanText(substituteProjectPlaceholder(pageSetup?.footer_text, projectName)).trim() : '';
  const pageNumberEnabled = isPageNumberEnabled(pageSetup);
  if (!footerText && !pageNumberEnabled) return undefined;

  const runOptions = {
    font: pageSetup?.footer_font || '宋体',
    size: chineseSizeToHalfPt(pageSetup?.footer_size || '小五'),
    color: normalizeDocxColor(pageSetup?.footer_color || '#536176'),
  };
  const footerChildren = [];

  if (footerText) {
    footerChildren.push(new TextRun({ ...runOptions, text: footerText }));
  }
  if (footerText && pageNumberEnabled) {
    footerChildren.push(new TextRun({ ...runOptions, text: '    ' }));
  }
  if (pageNumberEnabled) {
    footerChildren.push(...createPageNumberRuns(pageSetup?.page_number_format || '第{page}页 共{total}页', runOptions));
  }

  return {
    default: new Footer({
      children: [
        new Paragraph({
          alignment: alignmentToWordType(footerEnabled ? (pageSetup?.footer_alignment || '居中对齐') : '居中对齐'),
          children: footerChildren,
        }),
      ],
    }),
    first: new Footer({ children: [] }),
  };
}

function getTableStyle(context) {
  return context?.exportFormat?.table || DEFAULT_TABLE_STYLE;
}

function getTableCellStyle(context, { isHeader = false, isFirstColumn = false } = {}) {
  const table = getTableStyle(context);
  if (isHeader) return table.header_row;
  if (isFirstColumn) return table.first_column;
  return table.body_cell;
}

function tableBorderSize(context) {
  const width = Number(getTableStyle(context).border_width) || 0;
  if (width <= 0) return 0;
  return Math.max(1, Math.round(width * 6));
}

function tableBorders(context) {
  const size = tableBorderSize(context);
  if (size <= 0) {
    const none = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' };
    return {
      top: none,
      bottom: none,
      left: none,
      right: none,
      insideHorizontal: none,
      insideVertical: none,
    };
  }

  const border = {
    style: BorderStyle.SINGLE,
    size,
    color: normalizeDocxColor(getTableStyle(context).border_color, 'DCDFF6'),
  };
  return {
    top: border,
    bottom: border,
    left: border,
    right: border,
    insideHorizontal: border,
    insideVertical: border,
  };
}

function tableCellMargins(context) {
  const padding = Math.max(0, Number(getTableStyle(context).cell_padding_pt) || 0);
  const twips = Math.round(padding * 20);
  return { top: twips, bottom: twips, left: twips, right: twips };
}

function tableCellRunMarks(style) {
  return {
    font: style?.font || DEFAULT_TABLE_STYLE.body_cell.font,
    size: chineseSizeToHalfPt(style?.size || DEFAULT_TABLE_STYLE.body_cell.size),
    color: normalizeDocxColor(style?.text_color || DEFAULT_TABLE_STYLE.body_cell.text_color, '243048'),
  };
}

function tableCellParagraphOptions(style) {
  return {
    before: 0,
    after: 0,
    alignment: alignmentToWordType(style?.alignment || DEFAULT_TABLE_STYLE.body_cell.alignment),
  };
}

function getPageContentWidthTwips(context) {
  const pageSetup = context?.exportFormat?.page || {};
  const dims = PAPER_DIMENSIONS_MM[pageSetup.paper_size] || PAPER_DIMENSIONS_MM.a4;
  const pageWidthMm = pageSetup.orientation === 'landscape' ? dims.height : dims.width;
  const pageWidthTwips = mmToTwips(pageWidthMm);
  const marginLeftTwips = cmToTwips(pageSetup.margin_left_cm ?? 2);
  const marginRightTwips = cmToTwips(pageSetup.margin_right_cm ?? 2);
  return Math.max(1000, pageWidthTwips - marginLeftTwips - marginRightTwips);
}

function tableColumnWidths(columnCount, context) {
  const tableWidth = getPageContentWidthTwips(context);
  const safeCount = Math.max(1, columnCount || 1);
  const base = Math.floor(tableWidth / safeCount);
  const widths = Array.from({ length: safeCount }, () => base);
  widths[widths.length - 1] += tableWidth - (base * safeCount);
  return widths;
}

function tableCellWidth(columnSpan, totalColumns, context) {
  const tableWidth = getPageContentWidthTwips(context);
  const safeTotal = Math.max(1, totalColumns || 1);
  const safeSpan = Math.max(1, columnSpan || 1);
  return Math.round((tableWidth * safeSpan) / safeTotal);
}

function createTableCell({ children, context, isHeader = false, isFirstColumn = false, columnSpan = 1, widthTwips = undefined, totalColumns = 1 }) {
  const safeSpan = Math.max(1, columnSpan || 1);
  const table = getTableStyle(context);
  const cellStyle = getTableCellStyle(context, { isHeader, isFirstColumn });
  const fullWidth = table.full_width !== false;
  const computedWidth = widthTwips || tableCellWidth(safeSpan, totalColumns, context);
  return new TableCell({
    children,
    verticalAlign: VerticalAlignTable.CENTER,
    shading: { type: ShadingType.CLEAR, fill: normalizeDocxColor(cellStyle?.background_color, 'FFFFFF') },
    margins: tableCellMargins(context),
    columnSpan: safeSpan > 1 ? safeSpan : undefined,
    width: fullWidth ? { size: computedWidth, type: WidthType.DXA } : undefined,
  });
}

function createDocxTable(rows, columnCount, context, customColumnWidths) {
  const table = getTableStyle(context);
  const fullWidth = table.full_width !== false;
  const colWidths = customColumnWidths || tableColumnWidths(columnCount, context);
  const options = {
    rows,
    width: fullWidth ? { size: 100, type: WidthType.PERCENTAGE } : { size: 0, type: WidthType.AUTO },
    layout: fullWidth ? TableLayoutType.FIXED : TableLayoutType.AUTOFIT,
    borders: tableBorders(context),
  };
  if (fullWidth) {
    options.columnWidths = colWidths;
  }
  return new Table(options);
}

function getImageStyle(context) {
  return context?.exportFormat?.image || DEFAULT_IMAGE_STYLE;
}

function getPageContentWidthPx(context) {
  const pageSetup = context?.exportFormat?.page || {};
  const dims = PAPER_DIMENSIONS_MM[pageSetup.paper_size] || PAPER_DIMENSIONS_MM.a4;
  const pageWidthMm = pageSetup.orientation === 'landscape' ? dims.height : dims.width;
  const pageWidthTwips = mmToTwips(pageWidthMm);
  const marginLeftTwips = cmToTwips(pageSetup.margin_left_cm ?? 2);
  const marginRightTwips = cmToTwips(pageSetup.margin_right_cm ?? 2);
  const contentWidthTwips = Math.max(1, pageWidthTwips - marginLeftTwips - marginRightTwips);
  return Math.round(contentWidthTwips / 15);
}

// 按当前纸张、方向和页边距计算 Word 正文区域可用高度。
function getPageContentHeightPx(context) {
  const pageSetup = context?.exportFormat?.page || {};
  const dims = PAPER_DIMENSIONS_MM[pageSetup.paper_size] || PAPER_DIMENSIONS_MM.a4;
  const pageHeightMm = pageSetup.orientation === 'landscape' ? dims.width : dims.height;
  const pageHeightTwips = mmToTwips(pageHeightMm);
  const marginTopTwips = cmToTwips(pageSetup.margin_top_cm ?? 2);
  const marginBottomTwips = cmToTwips(pageSetup.margin_bottom_cm ?? 2);
  const contentHeightTwips = Math.max(1, pageHeightTwips - marginTopTwips - marginBottomTwips);
  return Math.round(contentHeightTwips / 15);
}

function getImageMaxWidth(context) {
  const image = getImageStyle(context);
  const percent = Math.max(1, Math.min(100, Number(image.max_width_percent) || DEFAULT_IMAGE_STYLE.max_width_percent));
  return Math.max(1, Math.round(getPageContentWidthPx(context) * percent / 100));
}

function getImageMaxHeight(context) {
  return Math.max(1, Math.round(getPageContentHeightPx(context) * MAX_IMAGE_HEIGHT_PERCENT / 100));
}

function getImageParagraphOptions(context) {
  const image = getImageStyle(context);
  return { alignment: alignmentToWordType(image.alignment || DEFAULT_IMAGE_STYLE.alignment) };
}

function getCaptionRunMarks(context) {
  const image = getImageStyle(context);
  const marks = {
    font: image.caption_font || DEFAULT_IMAGE_STYLE.caption_font,
    size: chineseSizeToHalfPt(image.caption_size || DEFAULT_IMAGE_STYLE.caption_size),
  };
  if (image.caption_bold === true) {
    marks.bold = true;
  }
  if (image.caption_italic === true) {
    marks.italics = true;
  }
  return marks;
}

function getCaptionParagraphOptions(context) {
  const image = getImageStyle(context);
  return {
    alignment: alignmentToWordType(image.caption_alignment || DEFAULT_IMAGE_STYLE.caption_alignment),
    after: context?.bodyAfterSpacing ?? 160,
    line: context?.bodyLineSpacing,
    indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
  };
}

function normalizeColumnSpan(value) {
  const span = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(span) && span > 1 ? span : 1;
}

function isMarkdownTableRowLine(line) {
  return /^\s*\|.*\|\s*$/.test(String(line || ''));
}

function isMarkdownTableDelimiterLine(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line || ''));
}

function splitMarkdownTableCells(line) {
  let source = String(line || '').trim();
  if (!source.includes('|')) {
    return [];
  }
  if (source.startsWith('|')) {
    source = source.slice(1);
  }
  if (source.endsWith('|')) {
    source = source.slice(0, -1);
  }

  const cells = [];
  let current = '';
  let escaped = false;
  for (const char of source) {
    if (char === '|' && !escaped) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
    escaped = char === '\\' && !escaped;
  }
  cells.push(current.trim());
  return cells;
}

function isMarkdownTableDelimiterCell(cell) {
  return /^:?-{3,}:?$/.test(String(cell || '').trim());
}

function markdownTableRowIndent(line) {
  const match = /^(\s*)\|/.exec(String(line || ''));
  return match ? match[1] : '';
}

function formatMarkdownTableRow(cells, indent = '') {
  return `${indent}| ${cells.map((cell) => String(cell || '').trim()).join(' | ')} |`;
}

function expandCompressedMarkdownTableRows(headerLine, nextLine) {
  if (!isMarkdownTableRowLine(headerLine) || !isMarkdownTableRowLine(nextLine)) {
    return null;
  }

  const headerCells = splitMarkdownTableCells(headerLine);
  const nextCells = splitMarkdownTableCells(nextLine);
  const columnCount = headerCells.length;
  if (columnCount < 2 || nextCells.length <= columnCount) {
    return null;
  }

  const delimiterCells = nextCells.slice(0, columnCount);
  if (!delimiterCells.every(isMarkdownTableDelimiterCell)) {
    return null;
  }

  // 模型有时会把分隔行和后续数据行压成同一行，这里按表头列数拆回 GFM 表格。
  const indent = markdownTableRowIndent(headerLine);
  const lines = [formatMarkdownTableRow(headerCells, indent), formatMarkdownTableRow(delimiterCells, indent)];
  const remainingCells = nextCells.slice(columnCount);
  while (remainingCells.length) {
    if (remainingCells.length > columnCount && !remainingCells[0] && remainingCells.length % columnCount !== 0) {
      remainingCells.shift();
      continue;
    }
    const rowCells = remainingCells.splice(0, columnCount);
    if (rowCells.some((cell) => String(cell || '').trim())) {
      lines.push(formatMarkdownTableRow(rowCells, indent));
    }
  }

  return lines;
}

function expandInlineMarkdownTableRows(line) {
  const source = String(line || '');
  if (!/\|\s*:?-{3,}:?\s*\|/.test(source)) {
    return [source];
  }

  const firstPipeIndex = source.indexOf('|');
  if (firstPipeIndex < 0) {
    return [source];
  }

  const prefix = source.slice(0, firstPipeIndex);
  const isIndentedTableLine = /^\s*$/.test(prefix);
  const tableText = source.slice(firstPipeIndex).trim();
  const tableRows = tableText
    .replace(/\|\s+\|/g, '|\n|')
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean);

  if (isIndentedTableLine) {
    return tableRows.map((row) => `${prefix}${row}`);
  }

  return [prefix.trimEnd(), ...tableRows];
}

/**
 * 把一段 Markdown 表格的所有行补齐到同一列数。
 *
 * 生成内容里常见「表头 2 列、数据行 4 列」的写法（例如《申请人基本情况表》），
 * 而 GFM 规定数据行超出表头列数的单元格会被直接丢弃——导出后这些内容会凭空消失。
 * 这里先把每行补齐到该表格的最大列数，再交给渲染器，确保不丢单元格。
 *
 * 注意：分隔行必须补齐为合法的 `---`，空格会导致渲染器直接放弃表格识别。
 */
function padMarkdownTableBlocks(lines) {
  const result = [];
  let insideFence = false;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*```+/.test(line)) {
      insideFence = !insideFence;
      result.push(line);
      index += 1;
      continue;
    }
    if (insideFence || !isMarkdownTableRowLine(line)) {
      result.push(line);
      index += 1;
      continue;
    }

    let lastIndex = index;
    while (lastIndex + 1 < lines.length && isMarkdownTableRowLine(lines[lastIndex + 1])) {
      lastIndex += 1;
    }

    const block = lines.slice(index, lastIndex + 1);
    const cellsPerRow = block.map((rowLine) => splitMarkdownTableCells(rowLine));
    const maxColumns = Math.max(...cellsPerRow.map((cells) => cells.length));

    block.forEach((rowLine, rowOffset) => {
      const cells = cellsPerRow[rowOffset];
      if (maxColumns < 2 || cells.length >= maxColumns) {
        result.push(rowLine);
        return;
      }
      const filler = isMarkdownTableDelimiterLine(rowLine) ? '---' : '';
      const padded = cells.slice();
      while (padded.length < maxColumns) padded.push(filler);
      result.push(formatMarkdownTableRow(padded, markdownTableRowIndent(rowLine)));
    });

    index = lastIndex + 1;
  }

  return result;
}

function normalizeMarkdownTablesForDocx(content) {
  const expandedLines = String(content || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap(expandInlineMarkdownTableRows);
  const lines = [];

  for (let index = 0; index < expandedLines.length; index += 1) {
    const line = expandedLines[index];
    const nextLine = expandedLines[index + 1] || '';
    const compressedTableRows = expandCompressedMarkdownTableRows(line, nextLine);
    const startsCompressedTable = Boolean(compressedTableRows);
    const startsTable = isMarkdownTableRowLine(line) && isMarkdownTableDelimiterLine(nextLine);
    const previousLine = lines[lines.length - 1] || '';

    if ((startsTable || startsCompressedTable) && previousLine.trim() && !isMarkdownTableRowLine(previousLine)) {
      lines.push('');
    }
    if (compressedTableRows) {
      lines.push(...compressedTableRows);
      index += 1;
      continue;
    }
    lines.push(line);
  }

  return padMarkdownTableBlocks(lines).join('\n');
}

function normalizeMarkdownListMarkersForDocx(content) {
  return String(content || '').split('\n').map((line) => {
    const match = line.match(/^(\s*)[•●○◦▪▫■□◆◇‣➢➤✓✔✧–－]\s+(.*)$/u);
    if (!match) return line;
    return `${match[1]}- ${match[2]}`;
  }).join('\n');
}

function createListReference(context, ordered) {
  const bodyStyle = context.exportFormat?.body_text || {};
  if (!ordered && bodyStyle.list_style === 'none') {
    return null;
  }
  if (!context.numberingReferences) {
    context.numberingReferences = [];
  }
  context.numberingIndex = (context.numberingIndex || 0) + 1;
  const reference = `${NUMBERING_REFERENCE_PREFIX}-${context.numberingIndex}`;
  context.numberingReferences.push({
    reference,
    ordered,
    unorderedListStyle: bodyStyle.list_style || 'disc',
    orderedListStyle: bodyStyle.ordered_list_style || 'decimal-dot',
    listIndentChars: typeof bodyStyle.list_indent_chars === 'number' ? bodyStyle.list_indent_chars : 2,
    bodyRunFont: context.bodyRunFont || '宋体',
    bodyRunSize: context.bodyRunSize || 24,
  });
  return reference;
}

function createOrderedListReference(context) {
  return createListReference(context, true);
}

function createUnorderedListReference(context) {
  return createListReference(context, false);
}

function headingLevel(level) {
  if (level <= 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  if (level === 3) return HeadingLevel.HEADING_3;
  if (level === 4) return HeadingLevel.HEADING_4;
  if (level === 5) return HeadingLevel.HEADING_5;
  return HeadingLevel.HEADING_6;
}

// ── 导出格式工具函数 ────────────────────────────

const SIZE_TO_HALF_PT = {
  '初号': 84, '小初': 72, '一号': 52, '小一': 48, '二号': 44, '小二': 36,
  '三号': 32, '小三': 30, '四号': 28, '小四': 24, '五号': 21, '小五': 18,
  '六号': 15, '小六': 13,
};

function chineseSizeToHalfPt(sizeName) {
  return SIZE_TO_HALF_PT[sizeName] || 24;
}

function charsToTwips(chars, bodySizeHalfPt = 24) {
  const safeChars = Math.max(0, Number(chars) || 0);
  const safeHalfPt = Math.max(1, Number(bodySizeHalfPt) || 24);
  return Math.round(safeChars * safeHalfPt * 10);
}

function cmToTwips(cm) {
  return Math.round((cm || 0) * 567);
}

function alignmentToWordType(align) {
  const map = {
    '居中对齐': AlignmentType.CENTER,
    '两端对齐': AlignmentType.JUSTIFIED,
    '左对齐': AlignmentType.LEFT,
    '右对齐': AlignmentType.RIGHT,
  };
  return map[align] || AlignmentType.JUSTIFIED;
}

function numberToChinese(num) {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const tens = ['', '十', '二十', '三十', '四十', '五十', '六十', '七十', '八十', '九十'];
  const n = Math.max(1, Math.min(9999, Math.floor(Number(num) || 1)));
  if (n <= 9) return digits[n];
  if (n <= 19) return `十${n === 10 ? '' : digits[n - 10]}`;
  if (n <= 99) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return `${tens[t]}${o ? digits[o] : ''}`;
  }
  if (n <= 999) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return `${digits[h]}百${r === 0 ? '' : r <= 9 ? `零${digits[r]}` : r <= 19 ? `一${numberToChinese(r)}` : numberToChinese(r)}`;
  }
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  return `${digits[th]}千${r === 0 ? '' : r < 100 ? `零${numberToChinese(r)}` : numberToChinese(r)}`;
}

function numberToCircled(num) {
  const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
  return circled[num - 1] || String(num);
}

function numberToAlpha(num, upper = false) {
  let n = Math.max(1, Math.floor(Number(num) || 1));
  let value = '';
  while (n > 0) {
    n -= 1;
    value = String.fromCharCode(97 + (n % 26)) + value;
    n = Math.floor(n / 26);
  }
  return upper ? value.toUpperCase() : value;
}

function numberToRoman(num, upper = false) {
  let n = Math.max(1, Math.min(3999, Math.floor(Number(num) || 1)));
  const pairs = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
    [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let value = '';
  pairs.forEach(([amount, symbol]) => {
    while (n >= amount) {
      value += symbol;
      n -= amount;
    }
  });
  return upper ? value.toUpperCase() : value;
}

function outlineNumberParts(id) {
  return String(id || '')
    .split('.')
    .map((part) => parseInt(part, 10))
    .filter((part) => Number.isFinite(part) && part > 0);
}

function formatOutlineNumber(id, headingStyle) {
  const parts = outlineNumberParts(id);
  if (!parts.length) return '';

  if (headingStyle?.numbering_format === 'outline-decimal') {
    return parts.join('.');
  }

  if (headingStyle?.numbering_format !== 'custom') return '';

  const lastPart = parts[parts.length - 1];
  const cn = numberToChinese(lastPart);
  const tail = (parts.length >= 3 ? parts.slice(2) : [lastPart]).join('.');
  return String(headingStyle.numbering_template || '')
    .replace(/\{tail(\d+)\}/g, (_, level) => {
      const startLevel = Number(level);
      if (!Number.isFinite(startLevel) || startLevel < 1 || startLevel > 6 || startLevel > parts.length) return '';
      return parts.slice(startLevel - 1).join('.');
    })
    .replace(/\{zh\}/g, cn)
    .replace(/\{num\}/g, String(lastPart))
    .replace(/\{tail\}/g, tail)
    .replace(/\{full\}/g, parts.join('.'))
    .replace(/\{circled\}/g, numberToCircled(lastPart))
    .replace(/\{alpha\}/g, numberToAlpha(lastPart))
    .replace(/\{ALPHA\}/g, numberToAlpha(lastPart, true))
    .replace(/\{roman\}/g, numberToRoman(lastPart))
    .replace(/\{ROMAN\}/g, numberToRoman(lastPart, true))
    .trim();
}

function shouldInsertSpaceAfterNumber(prefix) {
  return !/[、，。；：）)】\]》〉]$/.test(prefix);
}

function formatOutlineTitle(id, title, headingStyle) {
  const prefix = formatOutlineNumber(id, headingStyle);
  if (!prefix) return String(title || '');
  return `${prefix}${shouldInsertSpaceAfterNumber(prefix) ? ' ' : ''}${title || ''}`;
}

function getHeadingStyle(exportFormat, level) {
  const headings = (exportFormat && Array.isArray(exportFormat.headings)) ? exportFormat.headings : [];
  const idx = Math.min(level - 1, 5);
  return headings[idx] || null;
}

function usesNativeHeadingNumbering(headingStyle) {
  return false;
}

function imageTypeFromMime(mime) {
  if (!mime) return null;
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('bmp')) return 'bmp';
  if (mime.includes('webp')) return 'webp';
  return null;
}

function imageTypeFromPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase().replace('.', '');
  if (ext === 'jpeg') return 'jpg';
  return ['png', 'jpg', 'gif', 'bmp', 'webp'].includes(ext) ? ext : null;
}

function describeImageSourceForLog(source) {
  const value = String(source || '').trim();
  if (!value) return { kind: 'empty' };
  if (/^data:/i.test(value)) return { kind: 'data-url' };
  try {
    const url = new URL(value);
    if (url.protocol === 'yibiao-asset:') {
      return { kind: 'asset', host: url.hostname, extension: path.extname(url.pathname || '').toLowerCase() };
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { kind: 'remote', protocol: url.protocol.replace(':', ''), host: url.hostname, extension: path.extname(url.pathname || '').toLowerCase() };
    }
    if (url.protocol === 'file:') {
      return { kind: 'local-file-url', extension: path.extname(url.pathname || '').toLowerCase() };
    }
    return { kind: 'url', protocol: url.protocol.replace(':', '') };
  } catch {
    return { kind: path.isAbsolute(value) ? 'local-path' : 'relative-path', extension: path.extname(value).toLowerCase() };
  }
}

function normalizeImageForDocx(loaded) {
  if (!loaded?.buffer || !loaded.type) {
    return loaded;
  }

  if (loaded.type !== 'webp') {
    return loaded;
  }

  const image = nativeImage?.createFromBuffer ? nativeImage.createFromBuffer(loaded.buffer) : null;
  if (!image || image.isEmpty()) {
    throw new Error('WebP 图片转换失败');
  }

  return { buffer: image.toPNG(), type: 'png' };
}

function resolveAssetImagePath(url) {
  if (!app?.getPath) return null;

  const assetUrl = new URL(url);
  const assetRoots = {
    'generated-images': getGeneratedImagesDir(app),
    'imported-images': getImportedImagesDir(app),
    'image-library': getImageLibraryDir(app),
  };
  const rootDir = assetRoots[assetUrl.hostname];
  if (!rootDir) return null;

  const relativePath = decodeURIComponent(assetUrl.pathname.replace(/^\/+/, ''));
  if (!relativePath) return null;

  const baseDir = path.resolve(rootDir);
  const resolvedPath = path.resolve(baseDir, relativePath);
  if (resolvedPath !== baseDir && !resolvedPath.startsWith(`${baseDir}${path.sep}`)) {
    return null;
  }

  return resolvedPath;
}

async function loadImage(source, context = {}) {
  const url = String(source || '').trim();
  if (!url) return null;

  const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/i.exec(url);
  if (dataUrlMatch) {
    return {
      buffer: Buffer.from(dataUrlMatch[2], 'base64'),
      type: imageTypeFromMime(dataUrlMatch[1]),
    };
  }

  if (/^yibiao-asset:\/\//i.test(url)) {
    const assetPath = resolveAssetImagePath(url);
    if (!assetPath || !fs.existsSync(assetPath)) {
      return null;
    }

    return {
      buffer: fs.readFileSync(assetPath),
      type: imageTypeFromPath(assetPath),
    };
  }

  if (/^https?:\/\//i.test(url)) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`图片下载失败：${url}`);
    }
    const type = imageTypeFromMime(response.headers.get('content-type')) || imageTypeFromPath(new URL(url).pathname);
    return { buffer: Buffer.from(await response.arrayBuffer()), type };
  }

  const fileUrlPrefix = 'file://';
  let rawPath = url;
  if (url.startsWith(fileUrlPrefix)) {
    try {
      rawPath = fileURLToPath(url);
    } catch {
      rawPath = decodeURIComponent(url.slice(fileUrlPrefix.length));
      if (/^\/[a-zA-Z]:/.test(rawPath)) rawPath = rawPath.slice(1);
    }
  }
  const resolvedPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(context.baseDir || process.cwd(), rawPath);

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return {
    buffer: fs.readFileSync(resolvedPath),
    type: imageTypeFromPath(resolvedPath),
  };
}

async function loadImageWithRetry(source, context = {}, options = {}) {
  const retryAttempts = Math.max(0, Number(options.retryAttempts) || 0);
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs) || 0);
  let attempt = 0;

  while (attempt <= retryAttempts) {
    try {
      return await loadImage(source, context);
    } catch (error) {
      if (attempt >= retryAttempts) {
        throw error;
      }

      attempt += 1;
      if (typeof options.onRetry === 'function') {
        options.onRetry(attempt, error);
      }
      if (retryDelayMs > 0) {
        await delay(retryDelayMs);
      }
    }
  }

  return null;
}

async function resolveMermaidImageForExport(code, context = {}, options = {}) {
  const cacheEntry = options.cacheEntry || getMermaidCacheEntry(app, code);
  if (cacheEntry.exists) {
    return {
      source: cacheEntry.assetUrl,
      cacheHit: true,
      cacheHash: cacheEntry.hash,
    };
  }

  const retryAttempts = Math.max(0, Number(options.loadRetry?.retryAttempts ?? REMOTE_IMAGE_RETRY_ATTEMPTS) || 0);
  const retryDelayMs = Math.max(0, Number(options.loadRetry?.retryDelayMs ?? REMOTE_IMAGE_RETRY_DELAY_MS) || 0);
  let attempt = 0;
  let lastError = null;
  let loaded = null;

  while (attempt <= retryAttempts) {
    try {
      const rendered = await getLocalImageRenderService().renderMermaidToPng(cacheEntry.code);
      if (!rendered?.buffer?.length) {
        throw new Error('Mermaid 本地转换未生成有效图片');
      }
      loaded = {
        buffer: rendered.buffer,
        type: 'png',
        width: rendered.width,
        height: rendered.height,
      };
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt > retryAttempts) break;
      if (typeof options.loadRetry?.onRetry === 'function') {
        options.loadRetry.onRetry(attempt, error);
      }
      if (retryDelayMs > 0) await delay(retryDelayMs);
    }
  }

  if (!loaded?.buffer?.length) {
    throw lastError || new Error('Mermaid 本地转换失败');
  }

  try {
    saveMermaidCacheImage(app, cacheEntry.hash, loaded.buffer);
  } catch (error) {
    writeExportLog(context, 'export.mermaid.cache_write_failed', {
      cache_hash: cacheEntry.hash,
      error: compactLogError(error),
    });
  }

  return {
    source: cacheEntry.assetUrl,
    loaded,
    cacheHit: false,
    cacheHash: cacheEntry.hash,
  };
}

// 读取高分辨率截图携带的像素密度，版面尺寸仍按设计像素计算。
function getImagePixelDensity(source) {
  try {
    const url = new URL(String(source || ''));
    const isInternalRenderAsset = url.protocol === 'yibiao-asset:'
      && url.hostname === 'generated-images'
      && (url.pathname.startsWith('/mermaid-cache/')
        || url.pathname.startsWith('/technical-plan/illustrations/'));
    if (!isInternalRenderAsset) return 1;
    const value = Number(url.searchParams.get('pixel-density'));
    return Number.isFinite(value) && value >= 1 ? value : 1;
  } catch {
    return 1;
  }
}

async function imageRunFromNode(node, context, options = {}) {
  let loaded = null;
  const imageLabel = compactText(node.alt || node.url || '未知图片');
  const imageIndex = (context.imageCount || 0) + 1;
  context.imageCount = imageIndex;
  writeExportLog(context, 'export.image.started', {
    image_index: imageIndex,
    label: imageLabel,
    source: describeImageSourceForLog(node.url),
  });
  try {
    loaded = Object.prototype.hasOwnProperty.call(options, 'loadedImage')
      ? options.loadedImage
      : await loadImageWithRetry(node.url, context, options.loadRetry);
  } catch (error) {
    const message = `图片无法导出：${imageLabel}，${compactText(error.message || '下载失败', 120)}`;
    addWarning(context, message);
    writeExportLog(context, 'export.image.error', {
      image_index: imageIndex,
      label: imageLabel,
      phase: 'load',
      error: compactLogError(error),
    });
    return textRun(`[${message}]`, { color: 'C83220' });
  }
  if (!loaded?.buffer || !loaded.type) {
    const message = `图片无法导出：${imageLabel}，未找到可用图片数据`;
    addWarning(context, message);
    writeExportLog(context, 'export.image.error', {
      image_index: imageIndex,
      label: imageLabel,
      phase: 'load',
      reason: 'missing_image_data',
    });
    return textRun(`[${message}]`, { color: 'C83220' });
  }

  try {
    loaded = normalizeImageForDocx(loaded);
  } catch (error) {
    const message = `图片无法导出：${imageLabel}，${error.message || '图片格式转换失败'}`;
    addWarning(context, message);
    writeExportLog(context, 'export.image.error', {
      image_index: imageIndex,
      label: imageLabel,
      phase: 'normalize',
      source_type: loaded.type,
      error: compactLogError(error),
    });
    return textRun(`[${message}]`, { color: 'C83220' });
  }

  let size;
  try {
    size = imageSize(loaded.buffer);
  } catch (error) {
    const message = `图片无法导出：${imageLabel}，图片尺寸识别失败`;
    addWarning(context, message);
    writeExportLog(context, 'export.image.error', {
      image_index: imageIndex,
      label: imageLabel,
      phase: 'size',
      type: loaded.type,
      bytes: loaded.buffer.length,
      error: compactLogError(error),
    });
    return textRun(`[${message}]`, { color: 'C83220' });
  }
  const pixelDensity = getImagePixelDensity(node.url);
  const sourceWidth = (size.width || MAX_IMAGE_WIDTH) / pixelDensity;
  const sourceHeight = (size.height || Math.round(MAX_IMAGE_WIDTH * 0.62)) / pixelDensity;
  const maxWidth = getImageMaxWidth(context);
  const maxHeight = getImageMaxHeight(context);
  const ratio = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * ratio));
  const height = Math.max(1, Math.round(sourceHeight * ratio));
  context.imageSuccessCount = (context.imageSuccessCount || 0) + 1;
  writeExportLog(context, 'export.image.completed', {
    image_index: imageIndex,
    label: imageLabel,
    type: loaded.type,
    bytes: loaded.buffer.length,
    source_width: sourceWidth,
    source_height: sourceHeight,
    pixel_density: pixelDensity,
    max_width: maxWidth,
    max_height: maxHeight,
    scale_ratio: ratio,
    output_width: width,
    output_height: height,
  });

  return new ImageRun({
    type: loaded.type,
    data: loaded.buffer,
    transformation: { width, height },
    altText: {
      title: cleanText(node.alt || '图片'),
      description: cleanText(node.alt || node.url || 'Markdown 图片'),
      name: cleanText(node.alt || 'image'),
    },
  });
}

async function imageParagraphFromSource(source, alt, context, options = {}) {
  return paragraph([await imageRunFromNode({ url: source, alt }, context, options)], getImageParagraphOptions(context));
}

async function imageParagraphFromLoadedImage(source, alt, loadedImage, context, options = {}) {
  return paragraph([
    await imageRunFromNode({ url: source, alt }, context, { ...options, loadedImage }),
  ], getImageParagraphOptions(context));
}

function isHtmlBrNode(node) {
  return node?.type === 'tag' && htmlTagName(node) === 'br';
}

function htmlInlineGroupHasContent($, nodes = []) {
  return nodes.some((node) => {
    if (!node) return false;
    if (node.type === 'text') return Boolean(String(node.data || '').trim());
    if (node.type === 'tag') return htmlTagName(node) !== 'br' || Boolean($(node).text().trim());
    return false;
  });
}

function splitHtmlInlineNodesByBreaks($, nodes = []) {
  const groups = [];
  let current = [];
  let hasBreak = false;

  for (const node of nodes) {
    if (isHtmlBrNode(node)) {
      hasBreak = true;
      groups.push(current);
      current = [];
      continue;
    }
    current.push(node);
  }
  groups.push(current);

  if (!hasBreak) return [nodes];
  return groups.filter((group) => htmlInlineGroupHasContent($, group));
}

function htmlTagName(node) {
  return String(node?.name || '').toLowerCase();
}

function hasBlockHtmlChildren($, node) {
  return $(node).contents().toArray().some((child) => ['table', 'ul', 'ol', 'blockquote', 'pre', 'div', 'section', 'article', 'img', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(htmlTagName(child)));
}

async function htmlInlineRuns($, nodes = [], context = {}, marks = {}) {
  // 正文样式作为基础，调用方显式传入的 font/size 覆盖
  if (context.bodyRunFont && !('font' in marks)) {
    marks = { font: context.bodyRunFont, ...marks };
  }
  if (context.bodyRunSize && !('size' in marks)) {
    marks = { size: context.bodyRunSize, ...marks };
  }
  const runs = [];

  for (const node of nodes) {
    if (node.type === 'text') {
      runs.push(...textRunsWithBreaks(node.data || '', marks));
      continue;
    }

    if (node.type !== 'tag') {
      continue;
    }

    const tag = htmlTagName(node);
    if (tag === 'br') {
      runs.push(lineBreakRun());
    } else if (tag === 'strong' || tag === 'b') {
      runs.push(...await htmlInlineRuns($, $(node).contents().toArray(), context, { ...marks, bold: true }));
    } else if (tag === 'em' || tag === 'i') {
      runs.push(...await htmlInlineRuns($, $(node).contents().toArray(), context, { ...marks, italics: true }));
    } else if (tag === 'del' || tag === 's' || tag === 'strike') {
      runs.push(...await htmlInlineRuns($, $(node).contents().toArray(), context, { ...marks, strike: true }));
    } else if (tag === 'code') {
      runs.push(new TextRun({ text: cleanText($(node).text()), font: 'Consolas', size: 22, color: '155BD7' }));
    } else if (tag === 'a') {
      const href = $(node).attr('href') || '';
      const children = await htmlInlineRuns($, $(node).contents().toArray(), context, { ...marks, color: '2174FD', underline: true });
      if (href) {
        runs.push(new ExternalHyperlink({ link: href, children }));
      } else {
        runs.push(...children);
      }
    } else if (tag === 'img') {
      runs.push(await imageRunFromNode({ url: $(node).attr('src'), alt: $(node).attr('alt') || 'HTML 图片' }, context));
    } else if (tag === 'input' && String($(node).attr('type') || '').toLowerCase() === 'checkbox') {
      runs.push(textRun($(node).attr('checked') == null ? '☐ ' : '☑ ', { ...marks, font: 'Segoe UI Symbol' }));
    } else {
      if (!['p', 'span', 'label', 'small', 'sub', 'sup', 'mark'].includes(tag)) {
        addUnsupportedHtmlWarning(context, tag);
      }
      runs.push(...await htmlInlineRuns($, $(node).contents().toArray(), context, marks));
    }
  }

  return runs;
}

async function htmlTableToDocx($, tableNode, context) {
  const rows = [];
  const rowDescriptors = $(tableNode).find('tr').toArray().map((rowNode) => {
    const cells = $(rowNode).children('th,td').toArray().map((cellNode) => ({
      node: cellNode,
      text: $(cellNode).text().trim(),
      columnSpan: normalizeColumnSpan($(cellNode).attr('colspan')),
    }));
    return {
      cells,
      columnCount: cells.reduce((sum, cell) => sum + cell.columnSpan, 0),
    };
  }).filter((row) => row.cells.length);
  const maxColumns = Math.max(1, ...rowDescriptors.map((row) => row.columnCount));

  // Markdown 表格为对齐列数补齐出来的尾部空单元格，不应在 Word 里显示成多余空框：
  // 直接并入该行最后一个有内容的单元格（等价于跨列），空行则保持原样。
  for (const row of rowDescriptors) {
    let lastFilled = row.cells.length - 1;
    while (
      lastFilled >= 0
      && !String(row.cells[lastFilled].text || '').trim()
      && !$(row.cells[lastFilled].node).children().length
    ) {
      lastFilled -= 1;
    }
    if (lastFilled < 0 || lastFilled === row.cells.length - 1) continue;
    row.columnCount -= row.cells.length - 1 - lastFilled;
    row.cells = row.cells.slice(0, lastFilled + 1);
  }

  // 基于各列文本长度计算更合理的列宽比例（使短内容如“序号”紧凑，长内容充分展开）。
  //
  // 关键：末列单元格会吸收补齐出来的列（见下方渲染逻辑），真实跨度是 effectiveSpan 而不是
  // columnSpan。只有「真实只占一列」的单元格才算进列宽需求——跨列单元格的文字量不属于任何
  // 单一列，否则一条跨 3 列的长备注（例如 117 字的“本表后附…”）会把第 2 列撑到全表一半，
  // 其余各列被压成一条窄缝，导出件里就表现为列宽严重失衡、文字一列一列地竖着排。
  const tableWidthTwips = getPageContentWidthTwips(context);
  const colCharLengths = Array.from({ length: maxColumns }, () => 0);
  for (const row of rowDescriptors) {
    let colIdx = 0;
    for (const [cellIndex, cell] of row.cells.entries()) {
      const remainingSpan = cellIndex === row.cells.length - 1 ? maxColumns - row.columnCount : 0;
      const effectiveSpan = cell.columnSpan + Math.max(0, remainingSpan);
      if (effectiveSpan === 1 && colIdx < maxColumns) {
        colCharLengths[colIdx] = Math.max(colCharLengths[colIdx], String(cell.text || '').trim().length);
      }
      colIdx += Math.max(1, effectiveSpan);
    }
  }
  // 列宽 = 「先给每列一个绝对保底宽度，再把剩余宽度按内容长度比例分掉」。
  //
  // 只按比例分是不够的：short 列（「序号」「系统/部件名称」）即使把权重下限写成 8，
  // 只要同表里有一列 48 字的规格栏，8/(8+9+48+8+36) 只剩表宽的 7% ≈ 11mm，
  // 连 2 个汉字都排不下，导出件里就是「一字一行」的竖排。
  // 权重下限是**相对**下限，管不住这种情况；必须落到**绝对宽度**上。
  const colWeights = colCharLengths.map((len) => Math.min(60, Math.max(8, len)));
  const totalWeight = colWeights.reduce((sum, w) => sum + w, 0);

  const CHAR_WIDTH_TWIPS = 240;   // 小四(12pt) 全角字符宽度
  const MIN_COL_CHARS = 4;        // 每列至少排得下 4 个汉字
  const rawFloors = colCharLengths.map(
    (len) => Math.min(Math.max(len, 2), MIN_COL_CHARS) * CHAR_WIDTH_TWIPS,
  );
  // 保底总宽超过表宽 60% 时整体等比压缩，避免多列表格把比例分配挤成 0。
  const floorTotal = rawFloors.reduce((sum, w) => sum + w, 0);
  const floorScale = floorTotal > tableWidthTwips * 0.6 ? (tableWidthTwips * 0.6) / floorTotal : 1;
  const floors = rawFloors.map((w) => Math.round(w * floorScale));
  const floorSum = floors.reduce((sum, w) => sum + w, 0);
  const distributable = Math.max(0, tableWidthTwips - floorSum);

  const columnWidths = colWeights.map(
    (w, index) => floors[index] + Math.round((distributable * w) / totalWeight),
  );
  const sumWidths = columnWidths.reduce((sum, w) => sum + w, 0);
  columnWidths[columnWidths.length - 1] += (tableWidthTwips - sumWidths);

  for (const [rowIndex, row] of rowDescriptors.entries()) {
    const cells = [];
    let currentColumn = 0;
    for (const [cellIndex, cell] of row.cells.entries()) {
      const cellNode = cell.node;
      const isHeader = rowIndex === 0 || htmlTagName(cellNode) === 'th';
      const isFirstColumn = !isHeader && cellIndex === 0;
      const cellStyle = getTableCellStyle(context, { isHeader, isFirstColumn });
      const remainingSpan = cellIndex === row.cells.length - 1 ? maxColumns - row.columnCount : 0;
      const effectiveSpan = cell.columnSpan + Math.max(0, remainingSpan);

      const cellWidthTwips = columnWidths.slice(currentColumn, currentColumn + effectiveSpan).reduce((a, b) => a + b, 0);
      currentColumn += effectiveSpan;

      const cellParaOpts = tableCellParagraphOptions(cellStyle);
      const alignAttr = $(cellNode).attr('align');
      if (alignAttr) {
        cellParaOpts.alignment = alignmentToWordType(alignAttr);
      }

      cells.push(createTableCell({
        children: [paragraph(
          await htmlInlineRuns($, $(cellNode).contents().toArray(), context, tableCellRunMarks(cellStyle)),
          cellParaOpts,
        )],
        context,
        isHeader,
        isFirstColumn,
        columnSpan: effectiveSpan,
        widthTwips: cellWidthTwips,
        totalColumns: maxColumns,
      }));
    }
    rows.push(new TableRow({
      children: cells,
      cantSplit: true,
      tableHeader: rowIndex === 0 ? true : undefined,
    }));
  }

  if (!rows.length) {
    return [];
  }

  return [createDocxTable(rows, maxColumns, context, columnWidths)];
}

function buildListParagraphOptions(context, reference, level, itemIndex, totalItems, options = {}) {
  const paragraphOptions = reference ? { numbering: { reference, level } } : {};
  if (!reference && options.manualListIndent) {
    const indent = getManualUnorderedListLevelIndent(context, level);
    if (indent) paragraphOptions.indent = indent;
  } else if (!reference && options.manualIndent) {
    const indent = getTaskListLevelIndent(context, level);
    if (indent) paragraphOptions.indent = indent;
  }
  if (context.bodyLineSpacing) paragraphOptions.line = context.bodyLineSpacing;
  if (context.bodyAlignment) paragraphOptions.alignment = context.bodyAlignment;
  if (itemIndex === 0 && context.bodyBeforeSpacing) paragraphOptions.before = context.bodyBeforeSpacing;
  paragraphOptions.after = itemIndex === totalItems - 1 ? (context.bodyAfterSpacing ?? 0) : 0;
  return paragraphOptions;
}

function isWhitespaceHtmlTextNode(node) {
  return node?.type === 'text' && !String(node.data || '').trim();
}

function isCheckboxInputNode($, node) {
  return htmlTagName(node) === 'input' && String($(node).attr('type') || '').toLowerCase() === 'checkbox';
}

function hasClassName($, node, className) {
  return String($(node).attr('class') || '').split(/\s+/).includes(className);
}

function isTaskListItem($, itemNode, inlineNodes = []) {
  if (hasClassName($, itemNode, 'task-list-item')) return true;
  return inlineNodes.some((node) => {
    if (isCheckboxInputNode($, node)) return true;
    return htmlTagName(node) === 'p' && $(node).children('input[type="checkbox"]').length > 0;
  });
}

async function htmlListToDocx($, listNode, context, options = {}) {
  const blocks = [];
  const ordered = htmlTagName(listNode) === 'ol';
  const unorderedListWithoutMarker = !ordered && context.bodyListStyle === 'none';
  let numberingReference = null;
  const listItems = $(listNode).children('li').toArray();

  for (const [itemIndex, itemNode] of listItems.entries()) {
    const inlineNodes = $(itemNode).contents().toArray()
      .filter((child) => !['ul', 'ol'].includes(htmlTagName(child)))
      .filter((child) => !isWhitespaceHtmlTextNode(child));
    const isTaskItem = isTaskListItem($, itemNode, inlineNodes);
    if (!isTaskItem && numberingReference == null && !unorderedListWithoutMarker) {
      numberingReference = ordered ? createOrderedListReference(context) : createUnorderedListReference(context);
    }
    const listOptions = buildListParagraphOptions(
      context,
      isTaskItem ? null : numberingReference,
      Math.min(options.listLevel || 0, 2),
      itemIndex,
      listItems.length,
      { manualIndent: isTaskItem, manualListIndent: !isTaskItem && unorderedListWithoutMarker },
    );
    blocks.push(paragraph(await htmlInlineRuns($, inlineNodes, context), listOptions));

    for (const childList of $(itemNode).children('ul,ol').toArray()) {
      blocks.push(...await htmlListToDocx($, childList, context, { ...options, listLevel: (options.listLevel || 0) + 1 }));
    }
  }

  return blocks;
}

/** 从 context 提取正文段落选项，供 HTML 正文段落使用 */
function buildHtmlBodyParaOpts(context) {
  const opts = {};
  if (context.bodyAfterSpacing != null) opts.after = context.bodyAfterSpacing;
  if (context.bodyLineSpacing) opts.line = context.bodyLineSpacing;
  if (context.bodyAlignment) opts.alignment = context.bodyAlignment;
  if (context.bodyIndent) opts.indent = context.bodyIndent;
  if (context.bodyBeforeSpacing) opts.before = context.bodyBeforeSpacing;
  return opts;
}

async function mermaidCodeToDocxBlocks(code, context) {
  const value = String(code || '').trim();
  if (!value) return [];

  const nextIndex = (context.convertedMermaidCount || 0) + 1;
  const total = context.stats?.mermaidCount || nextIndex;
  let cacheEntry = null;

  try {
    // 导出阶段不拦截语法：正文已有代码块则直接尝试本地渲染。
    cacheEntry = getMermaidCacheEntry(app, value);
    writeExportLog(context, 'export.mermaid.started', {
      mermaid_index: nextIndex,
      total,
      cache_hash: cacheEntry.hash,
      cache_hit: cacheEntry.exists,
      code_metrics: textMetrics(value),
    });
    reportConversionProgress(context, cacheEntry.exists
      ? `Mermaid 图 ${nextIndex}/${total} 已命中本地缓存。`
      : `正在本地转换 Mermaid 图 ${nextIndex}/${total}。`);
    const loadRetry = {
      retryAttempts: REMOTE_IMAGE_RETRY_ATTEMPTS,
      retryDelayMs: REMOTE_IMAGE_RETRY_DELAY_MS,
      onRetry: (attempt) => {
        reportConversionProgress(context, `Mermaid 图 ${nextIndex}/${total} 转换失败，3 秒后第 ${attempt} 次重试。`);
      },
    };
    const mermaidImage = await resolveMermaidImageForExport(value, context, { cacheEntry, loadRetry });
    const block = mermaidImage.loaded === undefined
      ? await imageParagraphFromSource(mermaidImage.source, 'Mermaid 图', context)
      : await imageParagraphFromLoadedImage(mermaidImage.source, 'Mermaid 图', mermaidImage.loaded, context);
    writeExportLog(context, 'export.mermaid.completed', {
      mermaid_index: nextIndex,
      total,
      cache_hash: mermaidImage.cacheHash,
      cache_hit: mermaidImage.cacheHit,
    });
    reportConversionProgress(context, mermaidImage.cacheHit
      ? `Mermaid 图 ${nextIndex}/${total} 已使用本地缓存。`
      : `Mermaid 图 ${nextIndex}/${total} 已转换并缓存。`);
    return [block];
  } catch (error) {
    const message = `Mermaid 图无法导出：${compactText(error.message || '转换失败', 120)}`;
    addWarning(context, message);
    writeExportLog(context, 'export.mermaid.error', {
      mermaid_index: nextIndex,
      total,
      cache_hash: cacheEntry?.hash || '',
      error: compactLogError(error),
    });
    reportConversionProgress(context, `Mermaid 图 ${nextIndex}/${total} 转换失败。`);
    return [paragraph([textRun(`[${message}]`, { color: 'C83220' })], { alignment: AlignmentType.CENTER })];
  } finally {
    context.convertedMermaidCount = nextIndex;
  }
}

function isMermaidCodeElement($, codeNode) {
  const className = String($(codeNode).attr('class') || '').toLowerCase();
  return /\blanguage-mermaid\b/.test(className) || /\bmermaid\b/.test(className);
}

/**
 * 取正文 Markdown 标题的层级范围（只看行首 ATX `#`，跳过围栏代码块内的一行）。
 * 没有标题时返回 null。
 */
function markdownHeadingRange(content) {
  let min = 0;
  let max = 0;
  let inFence = false;
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const match = /^(#{1,6})\s+\S/.exec(line);
    if (!match) continue;
    const depth = match[1].length;
    if (!min || depth < min) min = depth;
    if (depth > max) max = depth;
  }
  return min ? { min, max } : null;
}

/**
 * 正文小标题相对 Markdown 原层级要下移几级。
 *
 * 目录只收 1-3 级，正文小标题因此至少从 4 级起，避免「本节需人工准备的材料清单」这类
 * 正文小标题混进目录、也避免 H1 直接跳到 H3 的断档；再按所属小节层级整体下移，
 * 让更深的小节里的正文标题看起来更靠下。上限用 `6 - 相对深度` 兜住，
 * 否则正文自己用到两级标题时（`###` + `####`）会被 6 级上限挤成同一级。
 */
function contentHeadingOffset(content, level) {
  const range = markdownHeadingRange(content);
  if (!range) return 0;
  const span = range.max - range.min;
  const targetTop = Math.min(Math.max(level + 3, 4), Math.max(4, 6 - span));
  return targetTop - range.min;
}

function contentHeadingLevel(mdLevel, context) {
  const depth = Math.min(Math.max(Number(mdLevel) || 1, 1), 6);
  const offset = Number(context?.contentHeadingLevelOffset) || 0;
  return Math.min(Math.max(depth + offset, 1), 6);
}

async function htmlHeadingToDocxBlocks($, node, context) {
  const mdLevel = contentHeadingLevel(parseInt(htmlTagName(node).slice(1), 10) || 1, context);
  const style = getHeadingStyle(context.exportFormat, mdLevel);
  const headingOpts = {
    heading: headingLevel(mdLevel),
    before: style ? style.spacing_before_pt * 20 : (mdLevel === 1 ? 280 : 180),
    after: style ? style.spacing_after_pt * 20 : 120,
    indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
  };
  if (style) {
    headingOpts.alignment = alignmentToWordType(style.alignment);
    if (style.line_spacing) {
      headingOpts.line = 240 * style.line_spacing;
    }
  }
  const runMarks = {};
  if (style) {
    runMarks.font = style.font || '黑体';
    runMarks.size = chineseSizeToHalfPt(style.size || '小四');
    runMarks.bold = false;
  } else {
    runMarks.bold = true;
  }
  return [paragraph(await htmlInlineRuns($, $(node).contents().toArray(), context, runMarks), headingOpts)];
}

async function htmlNodeToDocxBlocks($, node, context, options = {}) {
  if (node.type === 'text') {
    const text = String(node.data || '').trim();
    if (!text) return [];
    const runOpts = {};
    if (context.bodyRunFont) runOpts.font = context.bodyRunFont;
    if (context.bodyRunSize) runOpts.size = context.bodyRunSize;
    const paraOpts = buildHtmlBodyParaOpts(context);
    return [paragraph([textRun(text, runOpts)], paraOpts)];
  }

  if (node.type !== 'tag') {
    return [];
  }

  const tag = htmlTagName(node);
  if (/^h[1-6]$/.test(tag)) {
    return htmlHeadingToDocxBlocks($, node, context);
  }
  if (tag === 'table') {
    return htmlTableToDocx($, node, context);
  }
  if (tag === 'img') {
    return [await imageParagraphFromSource($(node).attr('src'), $(node).attr('alt') || 'HTML 图片', context)];
  }
  if (tag === 'ul' || tag === 'ol') {
    return htmlListToDocx($, node, context, options);
  }
  if (tag === 'blockquote') {
    const text = String($(node).text() || '').trim();
    if (context.feasibility && text.includes('📸') && text.includes('【插图指引】')) {
      return buildDocxImageGuidanceBox($, node);
    }
    return [paragraph(await htmlInlineRuns($, $(node).contents().toArray(), context, { color: '536176' }), {
      indent: { left: 360 },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: '2174FD' } },
      shading: { type: ShadingType.CLEAR, fill: 'F6F9FF' },
    })];
  }
  if (tag === 'pre') {
    const codeNode = $(node).children('code').first();
    if (codeNode.length && isMermaidCodeElement($, codeNode[0])) {
      return mermaidCodeToDocxBlocks(codeNode.text(), context);
    }
    return [paragraph([new TextRun({ text: cleanText($(node).text()), font: 'Consolas', size: 21, color: '243048' })], {
      shading: { type: ShadingType.CLEAR, fill: 'F6F9FF' },
      indent: { left: 260, right: 260 },
    })];
  }
  if (tag === 'br') {
    return [paragraph([lineBreakRun()])];
  }
  if (tag === 'hr') {
    return [paragraph([textRun('────────────────────────', { color: 'DCDFF6' })], { alignment: AlignmentType.CENTER })];
  }
  if (['div', 'section', 'article'].includes(tag) && hasBlockHtmlChildren($, node)) {
    return htmlNodesToDocxBlocks($, $(node).contents().toArray(), context, options);
  }
  if (tag === 'p' && hasBlockHtmlChildren($, node)) {
    return htmlNodesToDocxBlocks($, $(node).contents().toArray(), context, options);
  }
  if (['p', 'div', 'section', 'article', 'span', 'strong', 'b', 'em', 'i', 'del', 's', 'strike', 'a', 'code', 'label', 'small', 'sub', 'sup', 'mark'].includes(tag)) {
    const isFigureCaption = /^(?:图\s*\d*(?:[-—_·.]\d+)*[:：\s]|图[:：])/.test($(node).text().trim());
    if (isFigureCaption) {
      return [paragraph([textRun($(node).text().trim(), getCaptionRunMarks(context))], getCaptionParagraphOptions(context))];
    }
    const htmlParaOpts = buildHtmlBodyParaOpts(context);
    const groups = splitHtmlInlineNodesByBreaks($, $(node).contents().toArray());
    const paragraphs = [];
    for (const [index, group] of groups.entries()) {
      const paraOpts = { ...htmlParaOpts };
      if (groups.length > 1 && index < groups.length - 1) {
        paraOpts.after = 0;
      }
      if (index > 0) {
        delete paraOpts.before;
      }
      paragraphs.push(paragraph(await htmlInlineRuns($, group, context), paraOpts));
    }
    return paragraphs;
  }

  addUnsupportedHtmlWarning(context, tag);
  return htmlNodesToDocxBlocks($, $(node).contents().toArray(), context, options);
}

async function htmlNodesToDocxBlocks($, nodes = [], context = {}, options = {}) {
  const blocks = [];
  for (const node of nodes) {
    blocks.push(...await htmlNodeToDocxBlocks($, node, context, options));
  }
  return blocks;
}

async function htmlToDocxBlocks(html, context = {}, options = {}) {
  const source = String(html || '').trim();
  if (!source) {
    return [];
  }

  const $ = cheerio.load(source, null, false);
  const blocks = await htmlNodesToDocxBlocks($, $.root().contents().toArray(), context, options);
  if (!blocks.length) {
    addWarning(context, '部分 HTML 内容未能导出，请核对 Word 内容。');
  }
  return blocks;
}

async function markdownToDocxBlocks(content, context = {}) {
  const markdown = normalizeMarkdownTablesForDocx(normalizeMarkdownListMarkersForDocx(content));
  // breaks: true —— 生成内容按「一行一条」书写，单换行必须保留为换行，
  // 否则标题/条目会与正文粘成一段（导出件里表现为「一、响应意向与供货范围我方愿按照…」）。
  const html = await renderMarkdownHtml(markdown, { allowRawHtml: true, enableGfm: true, breaks: true });
  return htmlToDocxBlocks(html, context);
}

async function addMarkdownContent(children, content, context) {
  children.push(...await markdownToDocxBlocks(content, context));
}

/** 渲染某个大纲小节的内容，并把正文小标题的层级基准设为该小节的层级。 */
async function addLeafContent(target, item, context, level) {
  if (!String(item.content || '').trim()) {
    const pendingParagraph = buildPendingContentModeParagraph(item);
    if (pendingParagraph) target.push(pendingParagraph);
    return;
  }

  const previousOffset = context.contentHeadingLevelOffset;
  context.contentHeadingLevelOffset = contentHeadingOffset(item.content, level);
  try {
    await addMarkdownContent(target, item.content, context);
  } finally {
    context.contentHeadingLevelOffset = previousOffset;
  }
}

const FEASIBILITY_ACCENT = '1A5F7A';
const FEASIBILITY_TABLE_WIDTH = 9000;

function readFeasibilityExportContext(payload) {
  const options = payload?.feasibility_options;
  if (!options || typeof options !== 'object') return null;
  const projectInfo = options.project_info && typeof options.project_info === 'object' ? options.project_info : {};
  return {
    options,
    projectInfo,
    includeCover: options.includeCover !== false,
    includeNotes: options.includePreparationNotes !== false,
    includeAppendix: options.includeAppendixTables !== false,
  };
}

function formatFeasibilityYearMonth(date = new Date()) {
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月`;
}

function displayFeasibilityAppendixValue(value) {
  const text = String(value || '').trim();
  return text || '—';
}

function buildFeasibilityTableCell(text, options = {}) {
  const colWidth = options.width || Math.floor(FEASIBILITY_TABLE_WIDTH / (options.columnCount || 4));
  return new TableCell({
    children: [paragraph(
      [textRun(text, {
        bold: options.header === true,
        size: options.header ? 20 : 19,
        color: options.header ? 'FFFFFF' : '333333',
      })],
      { alignment: AlignmentType.CENTER, after: 40 },
    )],
    shading: options.header ? { fill: FEASIBILITY_ACCENT, type: ShadingType.CLEAR } : undefined,
    width: { size: colWidth, type: WidthType.DXA },
  });
}

function buildFeasibilityTableRow(values, options = {}) {
  const columnCount = values.length;
  return new TableRow({
    cantSplit: true,
    tableHeader: options.header ? true : undefined,
    children: values.map((value) => buildFeasibilityTableCell(value, { ...options, columnCount })),
  });
}

function buildFeasibilityNativeTable(header, rows) {
  return new Table({
    width: { size: FEASIBILITY_TABLE_WIDTH, type: WidthType.DXA },
    rows: [buildFeasibilityTableRow(header, { header: true }), ...rows.map((row) => buildFeasibilityTableRow(row))],
  });
}

function buildDocxImageGuidanceBox($, node) {
  const fullText = String($(node).text() || '').trim();
  const titleMatch = fullText.match(/(?:📸\s*)?(【[^】]+】[^\n*]*)/);
  const titleText = titleMatch ? titleMatch[1].trim() : '【插图指引】：此处建议插入工程项目图纸/照片';
  let descText = fullText
    .replace(/📸\s*/g, '')
    .replace(/(?:📸\s*)?【[^】]+】[^\n*]*/g, '')
    .replace(/^\s*[*_说明：:\s]*/g, '')
    .trim();
  if (!descText) {
    descText = '此处请插入相关的工程效果图、现场实景照片、总平面布置图、工艺流程示意图或实施进度甘特图。';
  }

  const cell = new TableCell({
    children: [
      paragraph([
        textRun('📸 ', { font: 'Segoe UI Emoji', size: 21 }),
        textRun(titleText, { bold: true, size: 21, color: FEASIBILITY_ACCENT }),
      ], { after: 100, alignment: AlignmentType.LEFT }),
      paragraph([
        textRun(`规格建议：横版 16:9 / 建议居中排版 插图说明：${descText}`, { size: 18, color: '475569', italics: true }),
      ], { after: 60, alignment: AlignmentType.LEFT }),
    ],
    shading: { fill: 'F0F6FF', type: ShadingType.CLEAR },
    margins: { top: 120, bottom: 120, left: 200, right: 200 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: 'C7DCEA' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C7DCEA' },
      left: { style: BorderStyle.SINGLE, size: 18, color: FEASIBILITY_ACCENT },
      right: { style: BorderStyle.SINGLE, size: 6, color: 'C7DCEA' },
    },
  });

  return [
    new Table({
      width: { size: FEASIBILITY_TABLE_WIDTH, type: WidthType.DXA },
      rows: [new TableRow({ children: [cell], cantSplit: true })],
    }),
    paragraph([textRun('', { size: 12 })], { after: 150 }),
  ];
}

function buildFeasibilityCoverParagraphs(payload, feasibility) {
  const { options, projectInfo } = feasibility;
  const projectName = String(payload.project_name || projectInfo.projectName || '项目可行性研究报告').trim();
  const constructionUnit = String(projectInfo.constructionUnit || '').trim();
  const preparationUnit = String(options.preparationUnit || constructionUnit || '可行性研究报告编制中心').trim();
  const documentCode = String(options.documentCode || '').trim();
  return [
    paragraph(
      [textRun(String(options.securityLevel || '').trim() || '内部资料 / 普通', { bold: true, size: 20, color: '666666' })],
      { alignment: AlignmentType.RIGHT, after: 600 },
    ),
    paragraph(
      [textRun(projectName, { bold: true, size: 40, color: FEASIBILITY_ACCENT })],
      { alignment: AlignmentType.CENTER, after: 300 },
    ),
    paragraph(
      [textRun('可行性研究报告', { bold: true, size: 32, color: '333333' })],
      { alignment: AlignmentType.CENTER, after: 600 },
    ),
    paragraph(
      [textRun(`（所属行业：${String(projectInfo.industry || '').trim() || '国家标准大纲'}）`, { italics: true, size: 22, color: '666666' })],
      { alignment: AlignmentType.CENTER, after: 2000 },
    ),
    paragraph(
      [textRun(`项目建设单位：${constructionUnit}`, { size: 24, bold: true })],
      { alignment: AlignmentType.CENTER, after: 180 },
    ),
    paragraph(
      [textRun(`报告编制单位：${preparationUnit}`, { size: 24 })],
      { alignment: AlignmentType.CENTER, after: 180 },
    ),
    paragraph(
      [textRun(`文档识别编号：${documentCode}`, { size: 22, color: '666666' })],
      { alignment: AlignmentType.CENTER, after: 180 },
    ),
    paragraph(
      [textRun(`编制出版日期：${formatFeasibilityYearMonth()}`, { size: 22, color: '666666' })],
      { alignment: AlignmentType.CENTER, after: 400 },
    ),
    pageBreakParagraph(),
  ];
}

function buildFeasibilityNotesParagraphs(payload, feasibility) {
  const { projectInfo } = feasibility;
  const projectName = String(payload.project_name || projectInfo.projectName || '').trim();
  const signatureTable = buildFeasibilityNativeTable(
    ['编制角色', '人员姓名', '专业职称 / 职务', '签章 / 审核状态'],
    [
      ['项目总负责人', '', '', ''],
      ['技术审定人', '', '', ''],
      ['主要校核人', '', '', ''],
      ['报告主编人', '', '', ''],
    ],
  );

  return [
    paragraph([textRun('一、可行性研究报告编制说明', { bold: true, size: 28, color: FEASIBILITY_ACCENT })], { after: 200 }),
    paragraph(
      [textRun(`1. 本可行性研究报告系针对“${projectName}”项目进行全面技术、经济、社会与生态可行性论证而编制。`, { size: 22 })],
      { after: 150 },
    ),
    paragraph(
      [textRun('2. 编制依据包括国家发改委《投资项目可行性研究报告编写指南》、行业技术规范、项目单位提供的原始资料以及现场调研数据。', { size: 22 })],
      { after: 300 },
    ),
    paragraph([textRun('二、项目编制人员责任签发表', { bold: true, size: 28, color: FEASIBILITY_ACCENT })], { after: 200 }),
    signatureTable,
    paragraph([textRun('', { size: 20 })], { after: 400 }),
    pageBreakParagraph(),
  ];
}

function buildFeasibilityAppendixParagraphs(feasibility) {
  const { projectInfo } = feasibility;
  const constructionPeriod = String(projectInfo.constructionPeriodYears || '').trim();
  const operationPeriod = String(projectInfo.operationPeriodYears || '').trim();
  const table = buildFeasibilityNativeTable(
    ['指标名称', '数值 / 内容', '单位', '备注说明'],
    [
      ['项目名称', displayFeasibilityAppendixValue(projectInfo.projectName), '—', '立项全称'],
      ['建设单位', displayFeasibilityAppendixValue(projectInfo.constructionUnit), '—', '申报主体'],
      ['建设地点', displayFeasibilityAppendixValue(projectInfo.location), '—', '建设区域'],
      ['建设规模', displayFeasibilityAppendixValue(projectInfo.constructionContent), '—', '产能/建设面积'],
      ['建设工期', constructionPeriod ? `${constructionPeriod} 年` : '—', constructionPeriod ? '年' : '—', '施工与调试'],
      ['运营期限', operationPeriod ? `${operationPeriod} 年` : '—', operationPeriod ? '年' : '—', '运营评价期'],
      ['估算总投资', displayFeasibilityAppendixValue(projectInfo.totalInvestment), '万元', '含建设投资及流动资金'],
      ['资金来源', displayFeasibilityAppendixValue(projectInfo.fundingSource), '—', '资本金及融资结构'],
    ],
  );

  return [
    pageBreakParagraph(),
    paragraph([textRun('可研报告附表汇总', { bold: true, size: 30, color: FEASIBILITY_ACCENT })], { after: 300 }),
    paragraph([textRun('附表 1：项目基本情况汇总表', { bold: true, size: 24, color: '333333' })], { after: 150 }),
    table,
    paragraph([textRun('', { size: 18 })], { after: 300 }),
  ];
}

/** 目录条目的书签锚点：与标题段落上的书签一一对应，保证目录可点击跳转。 */
function tocBookmarkName(id) {
  return `_Toc_${String(id ?? '').replace(/[^0-9A-Za-z_]/g, '_')}`;
}

/**
 * 预置目录条目。
 *
 * docx 的目录域默认不写缓存结果，Word 要按 F9、预览器则一律显示空白——用户看到的就是「目录为空」。
 * 这里按大纲生成 1-3 级条目写进域结果，任何阅读器都能立刻看到目录；
 * 页码留空，由 Word/WPS 打开时按 updateFields 自动刷新为真实页码。
 */
function buildTableOfContentsEntries(outline, exportFormat) {
  const entries = [];
  const walk = (items, level) => {
    for (const item of items || []) {
      if (level <= 3) {
        entries.push({
          level,
          title: formatOutlineTitle(item.id, item.title, getHeadingStyle(exportFormat, level)),
          href: tocBookmarkName(item.id),
        });
      }
      if (item.children?.length) walk(item.children, level + 1);
    }
  };
  walk(outline, 1);
  return entries;
}

function buildOutlineHeadingParagraph(item, context, level, options = {}) {
  const style = getHeadingStyle(context.exportFormat, level);
  const nativeHeadingNumbering = usesNativeHeadingNumbering(style) && !options.manualNumbering && !options.omitNumbering;
  const displayTitle = options.omitNumbering
    ? String(item.title || '')
    : (nativeHeadingNumbering ? String(item.title || '') : formatOutlineTitle(item.id, item.title, style));

  const runOptions = { bold: false };
  if (style) {
    runOptions.font = style.font || '黑体';
    runOptions.size = chineseSizeToHalfPt(style.size || '小四');
    runOptions.bold = style.bold === true;
    runOptions.color = normalizeDocxColor(style.text_color || '#243048', '243048');
  } else {
    runOptions.bold = true;
  }

  const paraOptions = {
    heading: headingLevel(level),
    pageBreakBefore: level === 1 && isLevel1PageBreakEnabled(context.exportFormat) && !options.disablePageBreakBefore,
    alignment: style ? alignmentToWordType(style.alignment) : undefined,
    before: options.compact ? 0 : (style ? style.spacing_before_pt * 20 : (level === 1 ? 320 : 200)),
    after: options.compact ? 0 : (style ? style.spacing_after_pt * 20 : 120),
    line: style ? 240 * (style.line_spacing || 1) : undefined,
  };
  paraOptions.indent = { left: 0, right: 0, firstLine: 0, hanging: 0 };
  if (nativeHeadingNumbering) {
    context.usesHeadingNumbering = true;
    paraOptions.numbering = { reference: HEADING_NUMBERING_REFERENCE, level: Math.min(level - 1, 5) };
  }

  return paragraph(
    [new Bookmark({ id: tocBookmarkName(item.id), children: [textRun(displayTitle, runOptions)] })],
    paraOptions,
  );
}

async function addChapterFrameRows(rows, items, context, level = 1) {
  for (const item of items || []) {
    const isLeaf = !item.children?.length;
    const useLeafColumns = isLeaf && context.exportFormat?.heading_border?.min_heading_left_enabled === true;
    if (useLeafColumns) {
      const bodyChildren = [];
      await addLeafContent(bodyChildren, item, context, level);
      rows.push(buildChapterLeafRow(
        context.exportFormat,
        buildOutlineHeadingParagraph(item, context, level, { compact: true, manualNumbering: true, disablePageBreakBefore: true, omitNumbering: true }),
        bodyChildren,
        level,
      ));
      context.convertedLeafCount = (context.convertedLeafCount || 0) + 1;
      reportConversionProgress(context, `已处理 ${context.convertedLeafCount}/${context.stats?.leafCount || context.convertedLeafCount} 个正文小节。`);
      continue;
    }

    rows.push(buildChapterHeadingRow(
      context.exportFormat,
      buildOutlineHeadingParagraph(item, context, level, { compact: true, disableIndent: true, manualNumbering: true, disablePageBreakBefore: true }),
      level,
    ));

    if (isLeaf) {
      const bodyChildren = [];
      await addLeafContent(bodyChildren, item, context, level);
      rows.push(buildChapterContentRow(context.exportFormat, bodyChildren));
      context.convertedLeafCount = (context.convertedLeafCount || 0) + 1;
      reportConversionProgress(context, `已处理 ${context.convertedLeafCount}/${context.stats?.leafCount || context.convertedLeafCount} 个正文小节。`);
      continue;
    }

    await addChapterFrameRows(rows, item.children, context, level + 1);
  }
}

async function addOutlineItems(children, items, context, level = 1) {
  for (const item of items || []) {
    const useChapterFrame = level === 1 && getChapterFrameConfig(context.exportFormat);
    if (useChapterFrame) {
      const rows = [];
      await addChapterFrameRows(rows, [item], context, level);
      if (isLevel1PageBreakEnabled(context.exportFormat)) {
        children.push(pageBreakParagraph());
      }
      children.push(buildChapterFrameTable(context.exportFormat, rows));
      continue;
    }

    children.push(buildOutlineHeadingParagraph(item, context, level));

    if (!item.children?.length) {
      await addLeafContent(children, item, context, level);
      context.convertedLeafCount = (context.convertedLeafCount || 0) + 1;
      reportConversionProgress(context, `已处理 ${context.convertedLeafCount}/${context.stats?.leafCount || context.convertedLeafCount} 个正文小节。`);
      continue;
    }

    await addOutlineItems(children, item.children, context, level + 1);
  }
}

function createHeadingNumberingConfig() {
  return {
    reference: HEADING_NUMBERING_REFERENCE,
    levels: [0, 1, 2, 3, 4, 5].map((level) => ({
      level,
      format: LevelFormat.DECIMAL,
      start: 1,
      text: Array.from({ length: level + 1 }, (_, index) => `%${index + 1}`).join('.'),
      alignment: AlignmentType.START,
      suffix: LevelSuffix.TAB,
      style: {
        paragraph: {
          indent: { left: 360 + level * 360, hanging: 360 },
        },
      },
    })),
  };
}

function getOrderedListWordStyle(style) {
  return ORDERED_LIST_WORD_STYLES[style] || ORDERED_LIST_WORD_STYLES['decimal-dot'];
}

function getTaskListLevelIndent(context, level) {
  const bodyStyle = context.exportFormat?.body_text || {};
  const safeLevel = Math.max(0, Math.min(Number(level) || 0, 2));
  if (safeLevel <= 0) return null;
  const listIndentChars = typeof bodyStyle.list_indent_chars === 'number' ? bodyStyle.list_indent_chars : 2;
  return { left: Math.round(charsToTwips(listIndentChars, context.bodyRunSize || 24) * safeLevel) };
}

function getManualUnorderedListLevelIndent(context, level) {
  const safeLevel = Math.max(0, Math.min(Number(level) || 0, 2));
  const listIndentChars = typeof context.bodyListIndentChars === 'number' ? context.bodyListIndentChars : 2;
  const left = Math.round(charsToTwips(listIndentChars, context.bodyRunSize || 24) * (safeLevel + 1));
  return left > 0 ? { left } : null;
}

function getListLevelIndent(referenceConfig, level) {
  const baseIndent = charsToTwips(referenceConfig.listIndentChars, referenceConfig.bodyRunSize);
  const left = Math.round(baseIndent * (level + 1));
  const hanging = Math.min(left, charsToTwips(1, referenceConfig.bodyRunSize));
  return { left, hanging };
}

function createListNumberingLevel(referenceConfig, level) {
  const ordered = referenceConfig.ordered === true;
  const orderedStyle = getOrderedListWordStyle(referenceConfig.orderedListStyle);
  const marker = UNORDERED_LIST_MARKERS[referenceConfig.unorderedListStyle] || UNORDERED_LIST_MARKERS.disc;
  const markerSize = Math.max(1, Math.round((referenceConfig.bodyRunSize || 24) * (marker.sizeScale || 1)));
  return {
    level,
    format: ordered ? orderedStyle.format : LevelFormat.BULLET,
    text: ordered ? orderedStyle.text(level) : marker.text,
    alignment: AlignmentType.START,
    suffix: LevelSuffix.TAB,
    style: {
      run: {
        font: ordered ? (referenceConfig.bodyRunFont || '宋体') : marker.font,
        size: ordered ? (referenceConfig.bodyRunSize || 24) : markerSize,
      },
      paragraph: {
        indent: getListLevelIndent(referenceConfig, level),
      },
    },
  };
}

function createNumberingConfig(context) {
  const references = context.numberingReferences || [];
  if (!references.length && !context.usesHeadingNumbering) {
    return undefined;
  }

  const config = [];
  if (context.usesHeadingNumbering) {
    config.push(createHeadingNumberingConfig());
  }
  config.push(...references.map((referenceConfig) => ({
    reference: referenceConfig.reference,
    levels: [0, 1, 2].map((level) => createListNumberingLevel(referenceConfig, level)),
  })));

  return {
    config,
  };
}

function buildHeadingParagraphStyles(exportFormat) {
  const styles = [];
  const names = ['Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6'];
  const ids = ['Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6'];

  for (let i = 0; i < 6; i += 1) {
    const style = getHeadingStyle(exportFormat, i + 1);
    if (!style) {
      styles.push({
        id: ids[i],
        name: names[i],
        basedOn: 'Normal',
        run: { bold: false },
        paragraph: { spacing: { before: 200, after: 120 } },
      });
      continue;
    }

    const halfPt = chineseSizeToHalfPt(style.size);
    const lineSpacing = 240 * (style.line_spacing || 1);
    styles.push({
      id: ids[i],
      name: names[i],
      basedOn: 'Normal',
      run: {
        font: style.font || 'SimHei',
        size: halfPt,
        bold: false,
      },
      paragraph: {
        spacing: {
          before: (style.spacing_before_pt || 10) * 20,
          after: (style.spacing_after_pt || 10) * 20,
          line: lineSpacing,
        },
        alignment: alignmentToWordType(style.alignment),
        indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
      },
    });
  }

  return styles;
}

/**
 * 目录条目样式（TOC1–TOC3）。
 *
 * docx 生成的缓存目录条目会引用 `TOC{level}` 段落样式；样式缺失时条目会退化成
 * 正文默认格式，缩进与行距都不像目录。这里按正文口径补齐三级缩进。
 */
function buildTocParagraphStyles(exportFormat) {
  const bodyStyle = exportFormat?.body_text || {};
  const font = bodyStyle.font || '宋体';
  const size = chineseSizeToHalfPt(bodyStyle.size || '小四');

  return [1, 2, 3].map((level) => ({
    id: `TOC${level}`,
    name: `toc ${level}`,
    basedOn: 'Normal',
    run: { font, size, bold: false },
    paragraph: {
      spacing: { before: 0, after: 0, line: 240 * (bodyStyle.line_spacing_multiple || 1) },
      indent: { left: (level - 1) * 240, right: 0, firstLine: 0, hanging: 0 },
    },
  }));
}

function extractFactValue(facts, keywords) {
  if (!facts) return '';
  if (typeof facts === 'object' && !Array.isArray(facts)) {
    for (const [k, v] of Object.entries(facts)) {
      for (const kw of keywords) {
        if (k.toLowerCase().includes(kw.toLowerCase()) || kw.toLowerCase().includes(k.toLowerCase())) {
          if (v && typeof v === 'string') return v.trim();
        }
      }
    }
  }
  const factArray = Array.isArray(facts) ? facts : [];
  for (const group of factArray) {
    const groupText = `${group?.title || ''} ${group?.name || ''} ${group?.content || ''}`;
    const items = Array.isArray(group?.facts) ? group.facts : Array.isArray(group?.items) ? group.items : [];
    for (const kw of keywords) {
      const regex = new RegExp(`${kw}[：:\\s]+([^\\n\\r，,；;]+)`, 'i');
      const match = regex.exec(groupText);
      if (match && match[1]?.trim()) return match[1].trim();
    }
    for (const item of items) {
      const itemText = typeof item === 'string' ? item : `${item?.label || item?.key || ''} ${item?.value || item?.content || ''}`;
      for (const kw of keywords) {
        if (itemText.includes(kw)) {
          const regex = new RegExp(`${kw}[：:\\s]+([^\\n\\r，,；;]+)`, 'i');
          const match = regex.exec(itemText);
          if (match && match[1]?.trim()) return match[1].trim();
          if (item?.value) return String(item.value).trim();
        }
      }
    }
  }
  return '';
}

function parseBidAnalysisJsonTask(item) {
  if (!item?.content) return {};
  try {
    return typeof item.content === 'string' ? JSON.parse(item.content) : (item.content || {});
  } catch {
    return {};
  }
}

// 项目 / 招标 / 投标元信息的唯一解析入口。封面、页眉页脚、导出文件名都必须走这里，
// 否则同一份导出文件里会出现「封面有项目名、页眉退化成『投标文件』」这种口径不一致。
function resolveBidMetadata(payload) {
  const globalFacts = payload.global_facts || payload.globalFacts || [];
  const analysisTasks = payload.bid_analysis_tasks || payload.bidAnalysisTasks || {};
  const projectInfoTask = parseBidAnalysisJsonTask(analysisTasks.projectInfo);
  const partAInfoTask = parseBidAnalysisJsonTask(analysisTasks.partAInfo);

  const buyerName = String(
    payload.buyer_name
    || payload.buyerName
    || payload.owner_name
    || (typeof globalFacts === 'object' && !Array.isArray(globalFacts) ? (globalFacts.buyer_name || globalFacts.buyerName || globalFacts.owner_name) : '')
    || extractFactValue(globalFacts, ['招标人', '买方', '建设单位', '业主单位', '采购人', '招标单位', '业主'])
    || (partAInfoTask.company_name && partAInfoTask.company_name !== '公司名称' && partAInfoTask.company_name !== '没有提及' ? partAInfoTask.company_name : '')
    || ''
  ).trim();

  const projectName = String(
    payload.project_name
    || payload.projectName
    || (typeof globalFacts === 'object' && !Array.isArray(globalFacts) ? (globalFacts.project_name || globalFacts.projectName) : '')
    || extractFactValue(globalFacts, ['项目名称', '工程名称'])
    || (projectInfoTask.project_name && projectInfoTask.project_name !== '项目名称' && projectInfoTask.project_name !== '没有提及' ? projectInfoTask.project_name : '')
    || '投标技术文件'
  ).trim();

  const procurementNo = String(
    payload.procurement_no
    || payload.procurementNo
    || (typeof globalFacts === 'object' && !Array.isArray(globalFacts) ? (globalFacts.procurement_no || globalFacts.procurementNo || globalFacts.tender_no) : '')
    || extractFactValue(globalFacts, ['采购编号', '招标编号', '标书编号', '项目编号'])
    || (projectInfoTask.project_number && projectInfoTask.project_number !== '项目编号' && projectInfoTask.project_number !== '没有提及' ? projectInfoTask.project_number : '')
    || ''
  ).trim();

  const packageName = String(
    payload.package_name
    || payload.packageName
    || (typeof globalFacts === 'object' && !Array.isArray(globalFacts) ? (globalFacts.package_name || globalFacts.packageName) : '')
    || extractFactValue(globalFacts, ['标段名称', '标包名称', '分包名称', '标段（包）名称', '招标包', '标段', '标包'])
    || ''
  ).trim();

  const bidderName = String(
    payload.bidder_name
    || payload.bidderName
    || payload.applicant_name
    || (typeof globalFacts === 'object' && !Array.isArray(globalFacts) ? (globalFacts.bidder_name || globalFacts.bidderName || globalFacts.applicant_name) : '')
    || extractFactValue(globalFacts, ['投标人', '申请人', '卖方', '投标单位', '供应商'])
    || ''
  ).trim();

  const representativeName = String(
    payload.representative_name
    || payload.representativeName
    || (typeof globalFacts === 'object' && !Array.isArray(globalFacts) ? (globalFacts.representative_name || globalFacts.representativeName) : '')
    || extractFactValue(globalFacts, ['法定代表人', '委托代理人', '代理人', '代表'])
    || ''
  ).trim();

  const bidDate = String(
    payload.bid_date
    || payload.bidDate
    || (typeof globalFacts === 'object' && !Array.isArray(globalFacts) ? (globalFacts.bid_date || globalFacts.bidDate) : '')
    || extractFactValue(globalFacts, ['投标日期', '响应日期', '编制日期', '签署日期', '日期'])
    || ''
  ).trim();

  return { buyerName, projectName, procurementNo, packageName, bidderName, representativeName, bidDate };
}

function buildBidDocumentCoverParagraphs(payload, context) {
  const { buyerName, projectName, procurementNo, packageName, bidderName, representativeName, bidDate } = resolveBidMetadata(payload);

  const isResponse = /响应/.test(projectName) || /响应/.test(payload.document_title || '');
  const docTitle = payload.document_title || (isResponse ? '响 应 文 件' : '投 标 文 件');

  const children = [];

  // 1. 顶部招标人/业主名称
  if (buyerName) {
    children.push(paragraph([
      textRun(buyerName, { bold: true, size: 32, font: '黑体' }),
    ], { alignment: AlignmentType.CENTER, spacing: { before: 360, after: 240 } }));
  } else {
    children.push(paragraph([], { spacing: { before: 400 } }));
  }

  // 2. 项目工程全称
  children.push(paragraph([
    textRun(projectName, { bold: true, size: 36, font: '黑体' }),
  ], { alignment: AlignmentType.CENTER, spacing: { before: 180, after: 400 } }));

  // 3. 标书大标题（加粗特大号，居中排版）
  children.push(paragraph([
    textRun(docTitle, { bold: true, size: 56, font: '黑体' }),
  ], { alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 1200 } }));

  // 4. 采购编号与标段包信息
  if (procurementNo) {
    children.push(paragraph([
      textRun(`采购编号：${procurementNo}`, { bold: true, size: 28, font: '宋体' }),
    ], { alignment: AlignmentType.CENTER, spacing: { after: 160 } }));
  }
  if (packageName && packageName !== projectName) {
    children.push(paragraph([
      textRun(`标段（包）名称：${packageName}`, { bold: true, size: 28, font: '宋体' }),
    ], { alignment: AlignmentType.CENTER, spacing: { after: 240 } }));
  }

  // 5. 空段下推到底部落款签章区域
  children.push(paragraph([], { spacing: { before: 3000 } }));

  // 6. 申请人 / 投标人与签字盖章位
  const applicantDisplay = bidderName ? `申请人：${bidderName}  （盖单位章）` : '申请人：____________________  （盖单位章）';
  children.push(paragraph([
    textRun(applicantDisplay, { size: 28, font: '宋体' }),
  ], { alignment: AlignmentType.CENTER, spacing: { after: 180 } }));

  const repDisplay = representativeName
    ? `法定代表人或其委托代理人：${representativeName}  （签字）`
    : '法定代表人或其委托代理人：                （签字）';
  children.push(paragraph([
    textRun(repDisplay, { size: 28, font: '宋体' }),
  ], { alignment: AlignmentType.CENTER, spacing: { after: 240 } }));

  children.push(paragraph([
    textRun(`日期：${bidDate || formatChineseDate()}`, { size: 28, font: '宋体' }),
  ], { alignment: AlignmentType.CENTER, spacing: { after: 120 } }));

  // 7. 分页符独立成页
  children.push(new Paragraph({ children: [new PageBreak()], spacing: { after: 0 } }));

  return children;
}

async function buildDocxResult(payload, options = {}) {
  const exportFormat = (payload && (payload.export_format || payload.export_format_config)) || null;
  const stats = countOutlineStats(payload.outline || []);
  const context = {
    baseDir: payload.base_dir || payload.baseDir,
    onProgress: options.onProgress,
    warnings: options.warnings || [],
    stats,
    convertedLeafCount: 0,
    convertedMermaidCount: 0,
    imageCount: 0,
    imageSuccessCount: 0,
    numberingReferences: [],
    numberingIndex: 0,
    usesHeadingNumbering: false,
    unsupportedHtmlTags: new Set(),
    developerLogger: options.developerLogger,
    exportFormat,
    feasibility: readFeasibilityExportContext(payload),
  };
  writeExportLog(context, 'export.docx.build.started', {
    stats,
    content_metrics: countOutlineContentMetrics(payload.outline || []),
  });

  // 正文默认样式
  const bodyStyle = (exportFormat && exportFormat.body_text) ? exportFormat.body_text : null;
  const bodyFont = bodyStyle ? (bodyStyle.font || '宋体') : '宋体';
  const bodySizeHalfPt = bodyStyle ? chineseSizeToHalfPt(bodyStyle.size || '小四') : 24;
  const bodyLineSpacing = bodyStyle ? 240 * (bodyStyle.line_spacing_multiple || 1.2) : 360;
  const bodyAfterSpacing = bodyStyle ? (bodyStyle.spacing_after_pt || 0) * 20 : 160;

  // 注入正文样式到 context，供正文段落/文本渲染时使用
  context.bodyRunFont = bodyFont;
  context.bodyRunSize = bodySizeHalfPt;
  context.bodyLineSpacing = bodyLineSpacing;
  context.bodyAfterSpacing = bodyAfterSpacing;
  context.bodyListStyle = bodyStyle ? (bodyStyle.list_style || 'disc') : 'disc';
  context.bodyOrderedListStyle = bodyStyle ? (bodyStyle.ordered_list_style || 'decimal-dot') : 'decimal-dot';
  context.bodyListIndentChars = bodyStyle ? (bodyStyle.list_indent_chars ?? 2) : 2;
  if (bodyStyle) {
    context.bodyAlignment = alignmentToWordType(bodyStyle.alignment);
    if (bodyStyle.first_line_indent_chars > 0) {
      context.bodyIndent = { firstLine: charsToTwips(bodyStyle.first_line_indent_chars, bodySizeHalfPt) };
    }
    if (bodyStyle.spacing_before_pt > 0) {
      context.bodyBeforeSpacing = bodyStyle.spacing_before_pt * 20;
    }
  }

  const children = [];
  const feasibility = context.feasibility;
  if (feasibility?.includeCover) {
    children.push(...buildFeasibilityCoverParagraphs(payload, feasibility));
  } else {
    children.push(...buildBidDocumentCoverParagraphs(payload, context));
  }
  if (feasibility?.includeNotes) {
    children.push(...buildFeasibilityNotesParagraphs(payload, feasibility));
  }

  // 目录页（仅非可研导出且开启 include_toc 时插入）
  if (!feasibility && exportFormat && exportFormat.include_toc !== false) {
    const tocEntries = buildTableOfContentsEntries(payload.outline || [], exportFormat);
    children.push(
      new Paragraph({
        children: [new TextRun({ text: '目  录', bold: true, size: 32, font: '黑体' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 360 },
      }),
      new TableOfContents('目录', {
        hyperlink: true,
        headingStyleRange: '1-3',
        // 无缓存结果时目录在任何阅读器里都是空白，必须预置条目。
        ...(tocEntries.length ? { cachedEntries: tocEntries } : {}),
      }),
      new Paragraph({ children: [new PageBreak()], spacing: { after: 0 } }),
    );
  }

  reportProgress(context, 10, stats.mermaidCount
    ? `准备导出正文，并转换 ${stats.mermaidCount} 张 Mermaid 图。`
    : '准备导出正文。');
  await addOutlineItems(children, payload.outline || [], context);
  if (feasibility?.includeAppendix) {
    children.push(...buildFeasibilityAppendixParagraphs(feasibility));
  }
  reportProgress(context, 90, '正在生成 Word 文件。');

  // 页面设置
  const pageSetup = (exportFormat && exportFormat.page) ? exportFormat.page : null;
  const pageMargin = pageSetup ? {
    top: cmToTwips(pageSetup.margin_top_cm ?? 2),
    bottom: cmToTwips(pageSetup.margin_bottom_cm ?? 2),
    left: cmToTwips(pageSetup.margin_left_cm ?? 2),
    right: cmToTwips(pageSetup.margin_right_cm ?? 2),
    footer: cmToTwips(pageSetup.footer_distance_cm ?? 1.75),
  } : { top: 1440, right: 1440, bottom: 1440, left: 1440, footer: cmToTwips(1.75) };
  const firstPageDifferent = pageSetup ? pageSetup.first_page_different === true : false;

  // 纸张尺寸与方向
  const pageSizeConfig = {};
  if (pageSetup && pageSetup.paper_size) {
    const dims = PAPER_DIMENSIONS_MM[pageSetup.paper_size];
    if (dims) {
      const isLandscape = pageSetup.orientation === 'landscape';
      pageSizeConfig.size = {
        width: mmToTwips(dims.width),
        height: mmToTwips(dims.height),
        orientation: isLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
      };
    }
  }

  // 页眉 / 页脚 / 页码
  const sectionChildren = [...children];
  const pageNumberEnabled = isPageNumberEnabled(pageSetup);
  const pageNumberStart = Math.max(1, Math.floor(Number(pageSetup ? pageSetup.page_number_start : 1) || 1));
  // 页眉页脚与封面共用同一份元信息解析（含 Step02 解析结果与全局事实回退），
  // 否则 payload.project_name 为空时页眉会退化成只有「投标文件」。
  const bidMetadata = resolveBidMetadata(payload);
  const headers = buildWordHeaders(pageSetup, bidMetadata.projectName);
  const footers = buildWordFooters(pageSetup, bidMetadata.projectName);

  const numbering = createNumberingConfig(context);
  const headingStyles = [...buildHeadingParagraphStyles(exportFormat), ...buildTocParagraphStyles(exportFormat)];
  const sectionProperties = {
    page: {
      margin: pageMargin,
      ...pageSizeConfig,
      ...(pageNumberEnabled ? { pageNumbers: { start: pageNumberStart } } : {}),
    },
    titlePage: true,
  };
  const doc = new Document({
    ...(numbering ? { numbering } : {}),
    // 目录域预置了条目但页码留空，打开时让 Word/WPS 自动刷新成真实页码。
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: bodyFont, size: bodySizeHalfPt },
          paragraph: { spacing: { line: bodyLineSpacing, after: bodyAfterSpacing } },
        },
      },
      paragraphStyles: headingStyles,
    },
    sections: [{
      properties: sectionProperties,
      headers,
      footers,
      children: sectionChildren,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  writeExportLog(context, 'export.docx.build.completed', {
    stats,
    warning_count: context.warnings.length,
    converted_leaf_count: context.convertedLeafCount,
    converted_mermaid_count: context.convertedMermaidCount,
    image_count: context.imageCount,
    image_success_count: context.imageSuccessCount,
    image_failure_count: Math.max(0, context.imageCount - context.imageSuccessCount),
    buffer_bytes: buffer.length,
  });
  return { buffer, warnings: context.warnings, stats };
}

async function buildDocxBuffer(payload, options = {}) {
  const result = await buildDocxResult(payload, options);
  return result.buffer;
}

function createExportService({ configStore } = {}) {
  return {
    async exportWord(payload = {}, onProgress) {
      const stats = countOutlineStats(Array.isArray(payload.outline) ? payload.outline : []);
      // 文件名也走元信息解析链，否则目录未回填项目名时导出件会变成「标书文档_时间.docx」。
      const resolvedProjectName = resolveBidMetadata(payload).projectName;
      // 可研导出在完全解析不到项目名时保留原有兜底文件名。
      const exportProjectName = resolvedProjectName === UNRESOLVED_PROJECT_NAME && payload.feasibility_options
        ? '可行性研究报告'
        : resolvedProjectName;
      const developerLogger = createDeveloperLogger({
        app,
        config: loadDeveloperConfig(configStore),
        moduleName: 'export',
        name: 'word-export',
        meta: {
          project_name: sanitizeFilename(exportProjectName),
          stats,
        },
      });
      developerLogger.write('export.word.started', {
        project_name: sanitizeFilename(exportProjectName),
        stats,
        content_metrics: countOutlineContentMetrics(Array.isArray(payload.outline) ? payload.outline : []),
      });
      if (!Array.isArray(payload.outline) || !payload.outline.length) {
        const error = new Error('没有可导出的目录内容');
        developerLogger.write('export.word.error', { error: compactLogError(error) });
        throw error;
      }

      // 交付闸门：历史项目事实污染在导出前一律拦截，不能事后靠人工在 Word 里找。
      const contamination = evaluateContaminationGate(payload.outline, {
        projectName: resolvedProjectName,
        packageName: payload.packageName || payload.package_name || '',
        tenderName: payload.tenderName || payload.tender_name || '',
      });
      if (contamination.blocked) {
        const hits = contamination.details.blockers.slice(0, 5)
          .map((item) => `「${item.term}」出现在 ${item.section_title || item.section_id || '正文'}`)
          .join('；');
        const error = new Error(`${contamination.reason}：${hits}。请清理这些历史项目事实后再导出。`);
        error.code = 'CROSS_PROJECT_CONTAMINATION';
        error.details = contamination.details;
        developerLogger.write('export.word.error', { error: compactLogError(error), blockers: contamination.details.blockers });
        throw error;
      }

      const progressContext = { onProgress, warnings: [], stats };
      reportProgress(progressContext, 2, stats.mermaidCount
        ? `检测到 ${stats.mermaidCount} 张 Mermaid 图，导出时会转换为 Word 图片。`
        : '正在准备 Word 导出。');
      const defaultFilename = `${sanitizeFilename(exportProjectName)}_${formatExportTimestamp()}.docx`;
      const defaultDir = app?.getPath ? app.getPath('downloads') : process.env.USERPROFILE || process.cwd();
      const result = await dialog.showSaveDialog({
        title: '导出 Word 文档',
        defaultPath: path.join(defaultDir, defaultFilename),
        filters: [{ name: 'Word 文档', extensions: ['docx'] }],
      });

      if (result.canceled || !result.filePath) {
        reportProgress(progressContext, 0, '已取消导出。', { phase: 'canceled' });
        developerLogger.write('export.word.canceled', { stats });
        return { success: false, canceled: true, message: '已取消导出' };
      }

      try {
        const warnings = [];
        const buildResult = await buildDocxResult(payload, { onProgress, warnings, developerLogger });
        reportProgress({ onProgress, warnings: buildResult.warnings, stats: buildResult.stats }, 96, '正在写入 Word 文件。');
        developerLogger.write('export.word.write.started', {
          output_file_name: path.basename(result.filePath),
          output_extension: path.extname(result.filePath).toLowerCase(),
          buffer_bytes: buildResult.buffer.length,
        });
        fs.writeFileSync(result.filePath, buildResult.buffer);
        const message = buildResult.warnings.length
          ? `Word 已导出，但有 ${buildResult.warnings.length} 处图片未能插入，请打开文档核对。`
          : 'Word 已导出，请打开文档核对图片、表格和版式。';
        reportProgress({ onProgress, warnings: buildResult.warnings, stats: buildResult.stats }, 100, message, { phase: 'success' });
        developerLogger.write('export.word.completed', {
          output_file_name: path.basename(result.filePath),
          output_extension: path.extname(result.filePath).toLowerCase(),
          buffer_bytes: buildResult.buffer.length,
          warning_count: buildResult.warnings.length,
          stats: buildResult.stats,
        });
        return { success: true, path: result.filePath, message, warnings: buildResult.warnings };
      } catch (error) {
        developerLogger.write('export.word.error', {
          output_file_name: path.basename(result.filePath),
          output_extension: path.extname(result.filePath).toLowerCase(),
          error: compactLogError(error),
        });
        throw error;
      }
    },
  };
}

module.exports = {
  buildDocxBuffer,
  buildDocxResult,
  createExportService,
};
