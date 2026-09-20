#!/usr/bin/env node
/**
 * 「填值环节」断言（纯 node，可进 run-all）。
 *
 * 断言设计遵循本任务踩出来的规矩：**必须拿已知有缺陷的产物反测**。
 * 对正常产物全绿谁都会，发现不了缺陷的断言等于没有。所以这里带
 * --selftest：把填值清单故意改坏（给 copy 字段塞编造值、给 manual
 * 字段塞真值），断言必须报红，否则断言本身不合格。
 *
 * 用法（纯 node）：
 *   node scripts/validation/template-field-filling.cjs \
 *     --source <源 docx> --dir <fill-template-fields 的输出目录>
 *   node scripts/validation/template-field-filling.cjs --selftest --dir <同上> --source <同上>
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');

function readDocxPart(docxPath, part) {
  const zip = new AdmZip(docxPath);
  const entry = zip.getEntry(part);
  return entry ? entry.getData().toString('utf8') : '';
}

function listDocxParts(docxPath) {
  return new AdmZip(docxPath).getEntries().map((entry) => entry.entryName);
}

const PLACEHOLDER_RED = 'FCE8E6';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key.startsWith('--')) args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

/** 占位符形态：【人工】/【待填】/【字段名】。有文本但不是真值——这条线分不清，
 *  「已填 115 个」和「一个都没填」会看起来一样，AC-F2/AC-F5 全部失真。 */
function isPlaceholderText(text) {
  return /^【[^】]*】$/.test(String(text || '').trim());
}

/** 提取字段级内容控件（w:sdt 且带 yibiao:field tag）。 */
function extractFieldSdts(documentXml) {
  const sdts = [];
  const re = /<w:sdt>(?:(?!<w:sdt>)[\s\S])*?<\/w:sdt>/g;
  for (const match of documentXml.matchAll(re)) {
    const xml = match[0];
    const tag = /<w:tag w:val="([^"]*)"/.exec(xml)?.[1] || '';
    if (!tag.startsWith('yibiao:field:')) continue;
    const alias = /<w:alias w:val="([^"]*)"/.exec(xml)?.[1] || '';
    // 注意：<w:t[^>]*> 会把 <w:tag ...> 一起匹配进去（前缀相同），
    // 抽出来的"文本"就成了 XML 标记。必须要求 w:t 后紧跟空白或闭合。
    const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((item) => item[1])
      .join('');
    sdts.push({
      tag,
      alias,
      text,
      hasValue: !!text.trim() && !isPlaceholderText(text),
      shadedRed: xml.includes(PLACEHOLDER_RED),
    });
  }
  return sdts;
}

function buildChecks({ sourceDocx, filledDocx, filling }) {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

  // AC-F1 版式部件零增减（页眉/页脚/部件总数与源一致）——版式不动的第一道硬门。
  const sourceParts = listDocxParts(sourceDocx);
  const filledParts = listDocxParts(filledDocx);
  const countOf = (names, kw) => names.filter((n) => n.includes(kw)).length;
  check(
    'AC-F1a 部件总数与源一致',
    sourceParts.length === filledParts.length,
    `源 ${sourceParts.length} / 产物 ${filledParts.length}`,
  );
  check(
    'AC-F1b 页眉页脚与源一致',
    countOf(sourceParts, 'header') === countOf(filledParts, 'header')
      && countOf(sourceParts, 'footer') === countOf(filledParts, 'footer'),
    `页眉 ${countOf(sourceParts, 'header')}/${countOf(filledParts, 'header')}，`
      + `页脚 ${countOf(sourceParts, 'footer')}/${countOf(filledParts, 'footer')}`,
  );

  // AC-F2 颜色语义：有值必须无淡红底，无值必须带淡红底。红=待处理是给人看的，
  // 如果已填的还红着，用户会手填一遍；没填的不红，用户会漏填。
  const documentXml = readDocxPart(filledDocx, 'word/document.xml');
  const sdts = extractFieldSdts(documentXml);
  const badRed = sdts.filter((s) => s.hasValue && s.shadedRed);
  const badPlain = sdts.filter((s) => !s.hasValue && !s.shadedRed);
  check(
    'AC-F2a 已填字段不带淡红底',
    badRed.length === 0,
    badRed.length ? `仍红：${badRed.map((s) => s.alias).join('、')}` : `已填 ${sdts.filter((s) => s.hasValue).length} 个全正常`,
  );
  check(
    'AC-F2b 空位字段带淡红底',
    badPlain.length === 0,
    badPlain.length ? `不红：${badPlain.map((s) => s.alias).join('、')}` : `空位 ${sdts.filter((s) => !s.text).length} 个全标红`,
  );

  // AC-F3 真值必须来自招标文件原文：value_source=tender_fact 的值必须在 facts 里。
  // 反例就是编造——「看起来像编号」的值比空格危险得多。
  const facts = readJson(path.join(filling.dir, 'tender-facts.json'))?.facts || {};
  const factValues = new Set(Object.values(facts));
  const fabricated = (filling.fields || []).filter(
    (field) => field.value && field.value_source === 'tender_fact' && !factValues.has(field.value),
  );
  check(
    'AC-F3 copy 值全部来自原文',
    fabricated.length === 0,
    fabricated.length ? `编造值：${fabricated.map((f) => `${f.name}=${f.value}`).join('、')}` : `copy 填充 ${factValues.size} 个事实键`,
  );

  // AC-F4 签字段绝不能被写值：写值 = 伪造签章。
  const manualFilled = (filling.fields || []).filter((f) => f.fill_by === 'manual' && f.value);
  check(
    'AC-F4 manual 字段全部留空',
    manualFilled.length === 0,
    manualFilled.length ? `被写值：${manualFilled.map((f) => `${f.name}=${f.value}`).join('、')}` : `manual ${(filling.fields || []).filter((f) => f.fill_by === 'manual').length} 个全留空`,
  );

  // AC-F5 产物里占位符清单与填值清单一致（防「清单说空着、文档里却有字」）。
  const docxFilledNames = new Set(sdts.filter((s) => s.hasValue).map((s) => s.alias));
  const jsonFilledNames = new Set((filling.fields || []).filter((f) => f.value).map((f) => f.name));
  const onlyInDocx = [...docxFilledNames].filter((n) => !jsonFilledNames.has(n));
  const onlyInJson = [...jsonFilledNames].filter((n) => !docxFilledNames.has(n));
  check(
    'AC-F5 清单与文档一致',
    onlyInDocx.length === 0 && onlyInJson.length === 0,
    onlyInDocx.length || onlyInJson.length
      ? `只在文档：${onlyInDocx.join('、')}｜只在清单：${onlyInJson.join('、')}`
      : `文档 ${docxFilledNames.size} / 清单 ${jsonFilledNames.size}`,
  );

  return checks;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function report(checks) {
  for (const item of checks) {
    process.stdout.write(`${item.pass ? '  ✓' : '  ✗'} ${item.name}  ${item.detail}\n`);
  }
  const failed = checks.filter((item) => !item.pass).length;
  process.stdout.write(`\n断言 ${checks.length} 条，失败 ${failed} 条\n`);
  return failed;
}

function selftest({ sourceDocx, dir }) {
  const fillingFile = path.join(dir, 'tender-filling.json');
  const original = JSON.parse(fs.readFileSync(fillingFile, 'utf8'));
  const facts = readJson(path.join(dir, 'tender-facts.json'))?.facts || {};
  const realCopyValue = Object.values(facts)[0];

  // 反测 1：给 copy 字段塞一个「看起来像编号」的编造值 → AC-F3 必须红。
  // （真实事故就是这种：模型顺手编了个编号，人眼极难发现。）
  const corrupted = structuredClone(original);
  const copyField = corrupted.fields.find((f) => f.fill_by === 'copy');
  copyField.value = `FAKE-${Date.now()}`;
  const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), 'fill-assert-bad-'));
  fs.writeFileSync(path.join(tmp1, 'tender-filling.json'), JSON.stringify(corrupted), 'utf8');
  fs.copyFileSync(path.join(dir, 'tender-facts.json'), path.join(tmp1, 'tender-facts.json'));
  const bad1 = JSON.parse(fs.readFileSync(path.join(tmp1, 'tender-filling.json'), 'utf8'));
  const checks1 = buildChecks({ sourceDocx, filledDocx: path.join(dir, 'tender-filled.docx'), filling: { ...bad1, dir: tmp1 } });
  const caughtFabricated = checks1.find((c) => c.name === 'AC-F3 copy 值全部来自原文');

  // 反测 2：给 manual 字段塞真值 → AC-F4 必须红。
  const corrupted2 = structuredClone(original);
  const manualField = corrupted2.fields.find((f) => f.fill_by === 'manual');
  manualField.value = realCopyValue || '张三';
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fill-assert-bad2-'));
  fs.writeFileSync(path.join(tmp2, 'tender-filling.json'), JSON.stringify(corrupted2), 'utf8');
  fs.copyFileSync(path.join(dir, 'tender-facts.json'), path.join(tmp2, 'tender-facts.json'));
  const bad2 = JSON.parse(fs.readFileSync(path.join(tmp2, 'tender-filling.json'), 'utf8'));
  const checks2 = buildChecks({ sourceDocx, filledDocx: path.join(dir, 'tender-filled.docx'), filling: { ...bad2, dir: tmp2 } });
  const caughtManual = checks2.find((c) => c.name === 'AC-F4 manual 字段全部留空');

  for (const tmp of [tmp1, tmp2]) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录 */ }
  }

  process.stdout.write(`反测 1（编造 copy 值 → AC-F3 应红）：${caughtFabricated && !caughtFabricated.pass ? '✓ 拦下了' : '✗ 断言失效'}\n`);
  process.stdout.write(`反测 2（manual 被写值 → AC-F4 应红）：${caughtManual && !caughtManual.pass ? '✓ 拦下了' : '✗ 断言失效'}\n`);
  return caughtFabricated && !caughtFabricated.pass && caughtManual && !caughtManual.pass ? 0 : 1;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.selftest) {
    process.exit(selftest({ sourceDocx: args.source, dir: args.dir }));
  }
  if (!args.source || !args.dir) {
    process.stderr.write('需要 --source <源 docx> --dir <填值输出目录>\n');
    process.exit(2);
  }
  const filledDocx = path.join(args.dir, 'tender-filled.docx');
  const filling = readJson(path.join(args.dir, 'tender-filling.json'));
  if (!filling) {
    process.stderr.write(`缺 ${args.dir}/tender-filling.json\n`);
    process.exit(2);
  }
  const failed = report(buildChecks({ sourceDocx: args.source, filledDocx, filling: { ...filling, dir: args.dir } }));
  process.exit(failed ? 1 : 0);
}

main();
