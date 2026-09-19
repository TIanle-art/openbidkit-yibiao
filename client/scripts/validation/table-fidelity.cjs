#!/usr/bin/env electron
/**
 * Markdown 表格导出保真回归脚本。
 *
 * 背景：生成内容里经常出现「表头 2 列、数据行 4 列」的写法（例如《申请人基本情况表》）。
 * GFM 规定数据行超出表头列数的单元格会被直接丢弃，导出后这些内容会凭空消失。
 * 本脚本锁定三类行为：
 *   1. 列数不一致的表格，导出后单元格不得丢失；
 *   2. 补齐列数产生的尾部空单元格要并成跨列，不能变成空框；
 *   3. 规范表格与围栏代码块不受影响（回归保护）。
 *
 * 运行方式（必须在 Electron 主进程下跑，exportService 依赖 electron 模块）：
 *   node_modules/electron/dist/electron.exe scripts/validation/table-fidelity.cjs
 *
 * 硬约束：输出只落在隔离目录，绝不写入 docs/ai_generated（R5 / AC7）。
 */

const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');

const CLIENT_DIR = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(CLIENT_DIR, '..', '..', '..');
const DEFAULT_OUT = path.join(
  REPO_ROOT,
  '.trellis',
  'tasks',
  '09-17-openbid-recovery-acceptance',
  'validation',
  'table-fidelity',
);

const { parseDocx, normalizedDocText, squeeze, stripInlineMarkdown } = require('./docxVerify.cjs');

function resolveOutDir() {
  const arg = process.argv.find((entry) => entry.startsWith('--out='));
  const target = arg
    ? path.resolve(arg.slice('--out='.length))
    : path.join(DEFAULT_OUT, new Date().toISOString().replace(/[:.]/g, '-'));
  if (target.includes(path.join('docs', 'ai_generated'))) {
    throw new Error('禁止把验证输出写入 docs/ai_generated');
  }
  fs.mkdirSync(target, { recursive: true });
  return target;
}

const OUT_DIR = resolveOutDir();

const CASES = [
  {
    id: 'ragged-columns',
    title: '表头 2 列 / 数据行 4 列 的表格不得丢单元格',
    content: [
      '| 申请人名称 | 待补充：投标单位企业全称 |',
      '| :--- | :--- |',
      '| 注册地址 | 待补充：营业执照载明的注册地址 | 邮政编码 | 待补充：注册地邮政编码 |',
      '| 联系人 | 待补充：投标指定联系人姓名 | 电 话 | 待补充：联系人联系电话/手机 |',
      '| 传 真 | 待补充：企业传真号码 | 网址/电子邮箱 | 待补充：企业官方网址及电子邮箱 |',
      '| 组织结构 | 待补充：企业组织架构形式（如有限责任公司、股份有限公司等） |',
      '| 法定代表人 | 姓名：待补充：法定代表人姓名 | 技术职称：待补充：职称名称 | 电话：待补充：联系电话 |',
      '| 成立时间 | 待补充：企业成立日期（年月日） | 员工总人数：待补充：在册员工总人数 人 |',
    ].join('\n'),
    expectContains: [
      '申请人名称',
      '待补充：投标单位企业全称',
      '注册地址',
      '邮政编码',
      '待补充：注册地邮政编码',
      '联系人',
      '待补充：联系人联系电话/手机',
      '网址/电子邮箱',
      '待补充：企业官方网址及电子邮箱',
      '组织结构',
      '待补充：企业组织架构形式（如有限责任公司、股份有限公司等）',
      '技术职称：待补充：职称名称',
      '员工总人数：待补充：在册员工总人数人',
    ],
    expectUniformColumns: 4,
  },
  {
    id: 'uniform-table',
    title: '规范表格（列数一致）行为不变',
    content: [
      '| 序号 | 名称 | 数量 |',
      '| :---: | :--- | :---: |',
      '| 1 | 电动单梁起重机 | 1 |',
      '| 2 | 电动葫芦 | 2 |',
    ].join('\n'),
    expectContains: ['序号', '电动单梁起重机', '电动葫芦'],
    expectUniformColumns: 3,
  },
  {
    id: 'trailing-padding-merged',
    title: '补齐列数产生的尾部空单元格应并成跨列',
    content: [
      '| A | B | C |',
      '| :--- | :--- | :--- |',
      '| only-two | value |',
    ].join('\n'),
    expectContains: ['only-two', 'value'],
    expectMergedLastCell: { row: 1, span: 2 },
  },
];

const FENCE_CASE = {
  id: 'fenced-code-not-a-table',
  title: '围栏代码块里的管道符不得被当成表格',
  content: ['```', '| a | b |', '| --- | --- |', '| 1 | 2 |', '```'].join('\n'),
  expectContains: ['| a | b |', '| --- | --- |', '| 1 | 2 |'],
};

function readTableSpans(docxPath) {
  const zip = new AdmZip(docxPath);
  const xml = zip.readAsText('word/document.xml');
  return [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((rowMatch) => (
    [...rowMatch[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((cellMatch) => {
      const span = /<w:gridSpan w:val="(\d+)"/.exec(cellMatch[0]);
      const text = [...cellMatch[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('');
      return { span: span ? Number(span[1]) : 1, text };
    })
  ));
}

async function renderCase(buildDocxResult, testCase, fileName) {
  const warnings = [];
  const result = await buildDocxResult(
    {
      project_name: '表格保真回归',
      outline: [{
        id: testCase.id,
        title: testCase.id,
        level: 1,
        content_mode: 'ai-generate',
        content: testCase.content,
        children: [],
      }],
      export_format: {},
      global_facts: {},
      bid_analysis_tasks: [],
      project_overview: {},
    },
    { warnings },
  );
  const docxPath = path.join(OUT_DIR, fileName);
  fs.writeFileSync(docxPath, result.buffer);
  return { docxPath, warnings, bytes: result.buffer.length };
}

async function main() {
  const { app } = require('electron');
  if (!app?.setPath) {
    throw new Error('必须在 Electron 主进程下运行（不要设置 ELECTRON_RUN_AS_NODE=1）');
  }
  app.setPath('userData', path.join(OUT_DIR, 'userdata'));
  await app.whenReady();

  const { buildDocxResult } = require(path.join(CLIENT_DIR, 'electron', 'services', 'exportService.cjs'));

  const assertions = [];
  const record = (name, pass, expected, actual) => {
    assertions.push({ name, pass, expected, actual });
    process.stdout.write(`  ${pass ? 'PASS' : 'FAIL'} ${name} (期望 ${expected} / 实际 ${actual})\n`);
  };

  for (const testCase of CASES) {
    process.stdout.write(`\n[case] ${testCase.id} :: ${testCase.title}\n`);
    const { docxPath, warnings } = await renderCase(buildDocxResult, testCase, `${testCase.id}.docx`);
    const parsed = parseDocx(docxPath);
    const docText = normalizedDocText(parsed);

    const missing = testCase.expectContains.filter(
      (fragment) => !docText.includes(squeeze(stripInlineMarkdown(fragment))),
    );
    record(`${testCase.id} 内容无丢失`, missing.length === 0, '0 处丢失', missing.length ? missing.join('、') : '0 处丢失');

    if (testCase.expectUniformColumns) {
      const spans = readTableSpans(docxPath);
      const widths = [...new Set(spans.map((row) => row.reduce((sum, cell) => sum + cell.span, 0)))];
      const ok = widths.length === 1 && widths[0] === testCase.expectUniformColumns;
      record(
        `${testCase.id} 各行列数一致`,
        ok,
        String(testCase.expectUniformColumns),
        widths.join('/'),
      );
    }

    if (testCase.expectMergedLastCell) {
      const { row, span } = testCase.expectMergedLastCell;
      const spans = readTableSpans(docxPath);
      const target = spans[row];
      const lastSpan = target ? target[target.length - 1].span : 0;
      const blankCells = target ? target.filter((cell) => !cell.text.trim()).length : -1;
      record(`${testCase.id} 尾部空格并入跨列`, lastSpan === span && blankCells === 0, `span ${span} 且无空格`, `span ${lastSpan}、空格 ${blankCells} 个`);
    }

    record(`${testCase.id} 导出无警告`, warnings.length === 0, '0', String(warnings.length));
  }

  process.stdout.write(`\n[case] ${FENCE_CASE.id} :: ${FENCE_CASE.title}\n`);
  const fenced = await renderCase(buildDocxResult, FENCE_CASE, `${FENCE_CASE.id}.docx`);
  const fencedParsed = parseDocx(fenced.docxPath);
  const fencedText = normalizedDocText(fencedParsed);
  const fenceMissing = FENCE_CASE.expectContains.filter((line) => !fencedText.includes(squeeze(line)));
  record('围栏代码块原文保留', fenceMissing.length === 0, '0 处丢失', fenceMissing.length ? fenceMissing.join('、') : '0 处丢失');
  const tableBlocks = fencedParsed.blocks.filter((block) => block.inTable).length;
  record('围栏代码块不得被渲染成表格', tableBlocks === 0, '0 个表格段落', `${tableBlocks} 个表格段落`);

  const failed = assertions.filter((entry) => !entry.pass);
  const report = {
    generated_at: new Date().toISOString(),
    output_dir: OUT_DIR,
    assertions,
    failed: failed.length,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, '.gitignore'), '*\n', 'utf8');

  const lines = ['# Markdown 表格导出保真回归', '', `- 生成时间：${report.generated_at}`, `- 输出目录：${OUT_DIR}`, `- 断言：PASS ${assertions.length - failed.length} / FAIL ${failed.length}`, '', '| 断言 | 期望 | 实际 | 结果 |', '| --- | --- | --- | --- |'];
  for (const entry of assertions) {
    lines.push(`| ${entry.name} | ${entry.expected} | ${entry.actual} | ${entry.pass ? 'PASS' : 'FAIL'} |`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), `${lines.join('\n')}\n`, 'utf8');

  process.stdout.write(`\n断言：PASS ${assertions.length - failed.length} / FAIL ${failed.length}\n报告：${OUT_DIR}\n`);
  app.exit(failed.length ? 2 : 0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
