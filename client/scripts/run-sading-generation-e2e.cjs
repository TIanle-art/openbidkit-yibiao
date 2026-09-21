const path = require('node:path');
const fs = require('node:fs');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const { createFullFidelitySadingBidService } = require('../electron/services/fullFidelitySadingBidService.cjs');
const { printComparisonReport } = require('./test-compare-bid-format.cjs');

async function main() {
  console.log('===============================================================');
  console.log('     赛鼎起重设备项目 · 全流程端到端标书生成与合规抗污染验证');
  console.log('===============================================================');

  const rootDir = path.resolve(__dirname, '../../../..');
  const masterPath = path.join(rootDir, 'docs/templates/（模板）技术文件.docx');
  const tenderPdfPath = path.join(rootDir, 'docs/raw_bids/赛鼎工程/赛鼎 宁波/NC2060.EQP.P01.90-037 起重设备/NC2060.EQP.P01.90-037 起重设备谈判采购文件_已签章.pdf');
  const outputDocxPath = path.join(rootDir, 'docs/ai_generated/AI生成_赛鼎起重设备高保真技术标_合规验证版.docx');

  console.log(`\n[步骤 1] 校验输入文件:`);
  console.log(` - 规范模板: ${masterPath} (存在: ${fs.existsSync(masterPath)})`);
  console.log(` - 招标文件: ${tenderPdfPath} (存在: ${fs.existsSync(tenderPdfPath)})`);
  console.log(` - 输出路径: ${outputDocxPath}`);

  if (!fs.existsSync(masterPath)) {
    throw new Error(`母版文件未找到: ${masterPath}`);
  }

  // 确保输出目录存在
  const outputDir = path.dirname(outputDocxPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\n[步骤 2] 执行端到端高保真标书装配与生成...`);
  const sadingService = createFullFidelitySadingBidService();
  const genResult = await sadingService.generateSadingNingboBid({
    masterDocxPath: masterPath,
    outputPath: outputDocxPath,
  });

  console.log(` ✔ 标书生成成功: ${genResult.outputPath}`);
  console.log(` ✔ 生成体积: ${genResult.fileSizeMb} MB`);

  console.log(`\n[步骤 3] 执行标书格式与合规性评估...`);
  const formatReport = printComparisonReport(outputDocxPath, masterPath);
  console.log(`格式对齐得分: ${formatReport.genScore.totalScore} / ${formatReport.genScore.maxScore} 分`);

  console.log(`\n[步骤 4] 自动化合规与跨项目抗污染严格断言...`);
  
  // 1. 读取 DOCX 中所有文本
  const targetSavedPath = genResult.outputPath;
  const zip = new AdmZip(targetSavedPath);
  const docXml = zip.readAsText('word/document.xml');
  const $ = cheerio.load(docXml, { xmlMode: true });
  const allText = $('w\\:body').text();
  const headerXmls = zip.getEntries()
    .filter(e => e.entryName.startsWith('word/header') && e.entryName.endsWith('.xml'))
    .map(e => zip.readAsText(e.entryName))
    .join('\n');
  const footerXmls = zip.getEntries()
    .filter(e => e.entryName.startsWith('word/footer') && e.entryName.endsWith('.xml'))
    .map(e => zip.readAsText(e.entryName))
    .join('\n');

  const assertions = [];
  function assertRule(title, condition, detail) {
    assertions.push({ title, pass: Boolean(condition), detail });
    if (condition) {
      console.log(`  [PASS] ${title} - ${detail}`);
    } else {
      console.error(`  [FAIL] ${title} - ${detail}`);
    }
  }

  // 断言 1: 项目名称与采购编号一致
  const hasProjectName = allText.includes('中国化学赛鼎宁波工程有限公司') || allText.includes('230 吨/年高端碳材料项目') || allText.includes('230吨/年高端碳材料项目');
  assertRule('项目名称一致性', hasProjectName, '包含赛鼎宁波230吨/年高端碳材料项目名称');

  const hasProcurementNo = allText.includes('NC2060.EQP.P01.90-037');
  assertRule('采购编号一致性', hasProcurementNo, '采购编号严格为 NC2060.EQP.P01.90-037');

  // 断言 2: 设备清单严格符合赛鼎招标（LD5t 电动单梁桥式起重机等）
  const hasValidEquipment = allText.includes('LD5t-16.5m') || allText.includes('电动单梁桥式起重机') || allText.includes('LD5t');
  assertRule('设备型号与清单匹配', hasValidEquipment, '包含赛鼎起重设备清单中 LD5t 桥式起重机规范');

  // 断言 3: 制造商与企业事实锁定（中原奥起）
  const hasManufacturer = allText.includes('河南省中原奥起实业有限公司') || allText.includes('中原奥起');
  assertRule('投标实体与企业事实锁定', hasManufacturer, '制造商确认为中原奥起');

  // 断言 4: 跨项目污染词严格为 0
  const forbiddenKeywords = ['磨煤机', '过轨吊', '球磨机', '直吹式制粉', '锅炉稳燃', '石家庄项目'];
  let totalPollutionCount = 0;
  const pollutionDetails = [];

  for (const kw of forbiddenKeywords) {
    const matches = (allText.match(new RegExp(kw, 'g')) || []).length;
    if (matches > 0) {
      totalPollutionCount += matches;
      pollutionDetails.push(`${kw} (${matches}次)`);
    }
  }

  assertRule(
    '跨项目污染词严格为0 (Anti-Hallucination Gate)',
    totalPollutionCount === 0,
    totalPollutionCount === 0 ? '未检测到任何过轨吊/磨煤机等跨项目残留词汇' : `发现污染词: ${pollutionDetails.join(', ')}`
  );

  // 断言 5: 3 张关键响应表与偏离表存在性
  const hasDeviationTable = allText.includes('技术偏离表') || allText.includes('偏离情况') || allText.includes('偏离说明');
  const hasSpecOrScope = allText.includes('技术规格') || allText.includes('规格') || allText.includes('供货') || allText.includes('起重设备');
  assertRule('关键技术响应表完整性', hasDeviationTable && hasSpecOrScope, '包含技术规格/偏离表与设备响应内容');

  // 断言 6: DOCX 结构完整与页眉 Logo 浮动锚点
  const hasAnchorDrawing = headerXmls.includes('wp:anchor') || docXml.includes('wp:anchor') || headerXmls.includes('w:drawing') || docXml.includes('w:drawing');
  assertRule('页眉与图形锚点保真', hasAnchorDrawing, '包含规范页眉图形/浮动锚点');

  const allPassed = assertions.every(a => a.pass);
  console.log('\n===============================================================');
  if (allPassed) {
    console.log('🎉 验收测试全部通过！AI 标书生成与合规抗污染验证完成！');
    console.log('===============================================================');
  } else {
    console.error('❌ 验收测试存在失败项，请检查上述日志。');
    console.log('===============================================================');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('执行失败:', err);
  process.exit(1);
});
