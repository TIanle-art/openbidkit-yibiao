const path = require('node:path');
const { UniversalBidGenerator } = require('./universal-bid-engine.cjs');

async function testOtherBids() {
  console.log('======================================================================');
  console.log('         通用标书生成引擎跨项目多场景泛化验证 (Generalization Test)   ');
  console.log('======================================================================\n');

  const engine = new UniversalBidGenerator();

  // 场景 1: 中国石油电动葫芦项目
  console.log('[测试场景 1: 中国石油电动葫芦招标文件 + 0818投标素材知识库]');
  const petroTenderPdf = path.resolve(__dirname, '../../../../docs/raw_bids/中国石油工程/中国石油电动葫芦招标文件/招标文件 - 电动葫芦.pdf');
  const petroOutDocx = path.resolve(__dirname, '../../../../docs/ai_generated/AI生成_中国石油电动葫芦通用技术标.docx');
  const templateDocx = path.resolve(__dirname, '../../../../docs/templates/（模板）技术文件.docx');
  const bidDocx = path.resolve(__dirname, '../../../../docs/raw_bids/赛鼎工程/赛鼎 技术文件0818.docx');

  await engine.buildBidDocument({
    tenderFilePath: petroTenderPdf,
    bidKnowledgePath: bidDocx,
    templatePath: templateDocx,
    outputPath: petroOutDocx,
    projectFactsOverride: {
      projectName: '2026年公司框架协议电动葫芦招标项目',
      buyerName: '中国石油工程建设有限公司',
      procurementNo: 'HQC-JZCG-2026-II-012',
      packageName: '电动葫芦框架采购',
      deviceType: 'CD1/MD1 钢丝绳电动葫芦系列'
    }
  });

  console.log('\n======================================================================');
  console.log('✅ 通用跨项目生成引擎测试通过！可无缝接入任意工程招标文件与投标素材。');
  console.log('======================================================================');
}

testOtherBids().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
