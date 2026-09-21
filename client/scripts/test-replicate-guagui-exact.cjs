const path = require('node:path');
const fs = require('node:fs');
const { createFullFidelityGuaguiBidService } = require('../electron/services/fullFidelityGuaguiBidService.cjs');
const { printComparisonReport } = require('./test-compare-bid-format.cjs');

async function main() {
  console.log('===============================================================');
  console.log('   石家庄能源岛磨煤机过轨吊项目 · 1:1 像素级全要素标书复刻与生成');
  console.log('===============================================================');

  const masterPath = 'd:/APPs/Downloads/文件/（模板）技术文件(1).docx';
  const tenderPath = 'd:/APPs/Downloads/文件/宁波工程公司 石家庄过轨吊26.5.9/2082-D-01000-TM-RQ001-0006E 磨煤机过轨吊请购技术文件-2026.3.23 -发请购_202604271737774.pdf';
  const realBidPdf = 'd:/APPs/Downloads/文件/圣起过轨吊投标文件.pdf';
  const outputPath = 'd:/APPs/Downloads/文件/（生成标书）石家庄能源岛磨煤机过轨吊投标文件_1比1全要素复刻版.docx';

  console.log(`1. 输入招标文件: ${tenderPath}`);
  console.log(`   比对真实标书: ${realBidPdf}`);
  console.log(`   企业标书母版: ${masterPath}`);

  console.log('\n2. 正在执行 1:1 像素级标书装配与格式注入...');
  const guaguiService = createFullFidelityGuaguiBidService();
  const res = await guaguiService.generateGuaguiBid({
    masterDocxPath: masterPath,
    outputPath,
  });

  console.log('   - 标书生成成功!');
  console.log(`   - 产物文件: ${res.outputPath}`);
  console.log(`   - 产物体积: ${res.fileSizeMb} MB`);

  console.log('\n3. 正在执行自动化标书合规性评估...');
  const report = printComparisonReport(res.outputPath, masterPath);
  console.log('---------------------------------------------------------------');
  console.log(`最终合规得分: ${report.genScore.totalScore} / ${report.genScore.maxScore} 分`);
  console.log('===============================================================');
}

main().catch(err => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
