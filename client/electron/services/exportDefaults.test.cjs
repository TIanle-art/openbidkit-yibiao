const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { defaultExportFormat } = require('./configStore.cjs');

const EXPORT_FORMAT_TS = path.resolve(__dirname, '../../src/shared/types/exportFormat.ts');
const EXPORT_PRESETS_TS = path.resolve(__dirname, '../../src/features/export-format/exportFormatPresets.ts');
const EXPORT_SERVICE_CJS = path.resolve(__dirname, 'exportService.cjs');

function readBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `未找到标记：${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start) : source.indexOf('\n};', start);
  assert.ok(end > start, `未找到结束标记：${endMarker || '\\n};'}`);
  return source.slice(start, end);
}

// 只解析由字符串/数字/布尔组成的字面量对象，避免为了一个漂移检查引入 TS 编译步骤。
function parseLiteralObject(block) {
  const result = {};
  const pattern = /(\w+):\s*(?:'([^']*)'|"([^"]*)"|(true|false)|(-?\d+(?:\.\d+)?)),/g;
  let match;
  while ((match = pattern.exec(block))) {
    const [, key, single, double, bool, num] = match;
    if (bool) result[key] = bool === 'true';
    else if (single !== undefined) result[key] = single;
    else if (double !== undefined) result[key] = double;
    else result[key] = Number(num);
  }
  return result;
}

test('默认导出格式必须是可提交的投标文档：有页眉、有页码', () => {
  const page = defaultExportFormat.page;
  assert.equal(page.header_enabled, true);
  assert.equal(page.footer_enabled, true);
  assert.equal(page.page_number_enabled, true);
  // 页眉必须能显示项目名，否则导出件页眉退化成一个光秃秃的「投标文件」。
  assert.match(page.header_text, /\{project\}/);
  assert.equal(page.first_page_different, true);
});

test('后端默认值与前端 DEFAULT_PAGE_SETUP 不允许再次分家', () => {
  const source = fs.readFileSync(EXPORT_FORMAT_TS, 'utf8');
  const frontendPage = parseLiteralObject(readBlock(source, 'const DEFAULT_PAGE_SETUP'));
  const backendPage = defaultExportFormat.page;
  const alignedKeys = [
    'first_page_different',
    'header_enabled',
    'header_text',
    'footer_enabled',
    'page_number_enabled',
    'page_number_format',
  ];
  for (const key of alignedKeys) {
    assert.ok(key in frontendPage, `前端 DEFAULT_PAGE_SETUP 缺少 ${key}`);
    assert.deepEqual(
      { [key]: backendPage[key] },
      { [key]: frontendPage[key] },
      `${key} 在 configStore.cjs 与 exportFormat.ts 之间已不一致`,
    );
  }
});

test('每个版面预设都必须明确页眉页脚，不能悄悄退回无页眉', () => {
  const source = fs.readFileSync(EXPORT_PRESETS_TS, 'utf8');
  const furniture = parseLiteralObject(readBlock(source, 'const BID_PAGE_FURNITURE'));
  assert.equal(furniture.header_enabled, true);
  assert.equal(furniture.footer_enabled, true);
  assert.match(furniture.header_text, /\{project\}/);

  const layoutBlock = readBlock(source, 'export const EXPORT_LAYOUT_PRESETS', 'export const EXPORT_THEME_PRESETS');
  const presetCount = (layoutBlock.match(/^\s{4}page: \{/gm) || []).length;
  const withFurniture = (layoutBlock.match(/\.\.\.BID_PAGE_FURNITURE,/g) || []).length;
  assert.ok(presetCount > 0, '未找到任何版面预设');
  assert.equal(withFurniture, presetCount, `${presetCount} 个版面预设里只有 ${withFurniture} 个声明了页眉页脚`);
});

test('页眉、页脚与文件名都走同一份元信息解析，不回退到裸取 payload.project_name', () => {
  const source = fs.readFileSync(EXPORT_SERVICE_CJS, 'utf8');
  assert.match(source, /buildWordHeaders\(pageSetup, bidMetadata\.projectName\)/);
  assert.match(source, /buildWordFooters\(pageSetup, bidMetadata\.projectName\)/);
  assert.doesNotMatch(source, /buildWordHeaders\(pageSetup, payload\.project_name\)/);
  assert.doesNotMatch(source, /buildWordFooters\(pageSetup, payload\.project_name\)/);
  assert.match(source, /sanitizeFilename\(exportProjectName\)/);
  assert.doesNotMatch(source, /sanitizeFilename\(payload\.project_name/);
});

test('占位项目名不能塞进页眉变成「投标技术文件 投标文件」', () => {
  const source = fs.readFileSync(EXPORT_SERVICE_CJS, 'utf8');
  assert.match(source, /const UNRESOLVED_PROJECT_NAME = '投标技术文件';/);
  assert.match(source, /function substituteProjectPlaceholder\(/);
});
