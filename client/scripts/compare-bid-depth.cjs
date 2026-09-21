const path = require('node:path');
const fs = require('node:fs');
const docx = require('docx');
const JSZip = require('jszip');

async function inspectDocx(docxPath) {
  if (!fs.existsSync(docxPath)) return null;
  const buf = fs.readFileSync(docxPath);
  const zip = await JSZip.loadAsync(buf);
  
  const docXml = await zip.files['word/document.xml'].async('string');
  const mediaFiles = Object.keys(zip.files).filter(k => k.startsWith('word/media/'));
  const headerFiles = Object.keys(zip.files).filter(k => k.startsWith('word/header'));
  const tablesCount = (docXml.match(/<w:tbl[\s>]/g) || []).length;
  const pCount = (docXml.match(/<w:p[\s>]/g) || []).length;
  const drawingsCount = (docXml.match(/<w:drawing[\s>]/g) || []).length;
  
  // 提取文字
  const textMatches = docXml.match(/<w:t[\s>][^<]*<\/w:t>/g) || [];
  const fullText = textMatches.map(m => m.replace(/<[^>]+>/g, '')).join('');

  return {
    path: docxPath,
    size: buf.length,
    pCount,
    tablesCount,
    mediaCount: mediaFiles.length,
    drawingsCount,
    headerCount: headerFiles.length,
    textLength: fullText.length,
    mediaFiles,
    fullText
  };
}

async function compareDocs(targetPath, baselinePath) {
  console.log('======================================================================');
  console.log('                 标书复刻度与质量多维深度对比评估                      ');
  console.log('======================================================================');
  
  const baseline = await inspectDocx(baselinePath);
  const target = await inspectDocx(targetPath);

  if (!baseline) {
    console.error(`基准文件不存在: ${baselinePath}`);
    return;
  }
  if (!target) {
    console.error(`目标生成文件不存在: ${targetPath}`);
    return;
  }

  console.log(`基准标书 (0818真实标书): ${path.basename(baselinePath)}`);
  console.log(`  - 文件大小: ${Math.round(baseline.size / 1024 / 1024 * 10) / 10} MB`);
  console.log(`  - 段落总数: ${baseline.pCount}`);
  console.log(`  - 表格总数: ${baseline.tablesCount}`);
  console.log(`  - 媒体素材: ${baseline.mediaCount} 个`);
  console.log(`  - 总字数:   ${baseline.textLength} 字\n`);

  console.log(`生成标书 (AI生成版本):   ${path.basename(targetPath)}`);
  console.log(`  - 文件大小: ${Math.round(target.size / 1024 / 1024 * 10) / 10} MB`);
  console.log(`  - 段落总数: ${target.pCount}`);
  console.log(`  - 表格总数: ${target.tablesCount}`);
  console.log(`  - 媒体素材: ${target.mediaCount} 个`);
  console.log(`  - 总字数:   ${target.textLength} 字\n`);

  // 核心章节覆盖核对
  const requiredChapters = [
    '响应函',
    '法定代表人身份证明',
    '授权委托书',
    '申请人基本情况表',
    '生产能力证明',
    '质量保证能力证明',
    '同类物资供货业绩',
    '履约信用证明',
    '制造厂资格声明',
    '生产组织供应能力',
    '应急保障',
    '包装运输',
    '物资技术规格书',
    '主要生产设备',
    '检验设备',
    '保护措施和要求',
    '谈判承诺书',
    '生产企业简介',
    '技术偏离表'
  ];

  console.log('--- 核心章节与业务模块覆盖率 ---');
  let coveredCount = 0;
  for (const ch of requiredChapters) {
    const inTarget = target.fullText.includes(ch);
    if (inTarget) coveredCount++;
    console.log(`  ${inTarget ? '✅ 覆盖' : '❌ 缺失'} : ${ch}`);
  }
  const chCoverage = Math.round((coveredCount / requiredChapters.length) * 100);
  console.log(`章节覆盖率: ${chCoverage}%\n`);

  // 抗污染检查
  console.log('--- 跨项目抗污染 Gate 检查 ---');
  const pollutionWords = ['磨煤机', '过轨吊', '球磨机', '直吹式制粉', '锅炉稳燃', '石家庄项目'];
  let pollutionPassed = true;
  for (const w of pollutionWords) {
    const c = (target.fullText.match(new RegExp(w, 'g')) || []).length;
    if (c > 0) {
      console.log(`  ❌ 发现污染词【${w}】: 出现 ${c} 次`);
      pollutionPassed = false;
    } else {
      console.log(`  ✅ 干净【${w}】: 0 命中`);
    }
  }

  // 关键参数一致性检查
  console.log('\n--- 核心项目事实与技术参数检查 ---');
  const factChecks = [
    { label: '项目采购编号 NC2060.EQP.P01.90-037', ok: target.fullText.includes('NC2060.EQP.P01.90-037') },
    { label: '项目名称 230吨/年高端碳材料项目', ok: target.fullText.includes('230') && target.fullText.includes('高端碳材料') },
    { label: '投标实体 河南省中原奥起实业有限公司', ok: target.fullText.includes('中原奥起') },
    { label: '设备型号 LD5t-16.5m', ok: target.fullText.includes('LD5t-16.5m') },
    { label: '表面除锈 Sa2.5 级', ok: target.fullText.includes('Sa2.5') || target.fullText.includes('Sa2') },
    { label: '试验台 5-50T 性能试验台', ok: target.fullText.includes('试验台') }
  ];
  for (const fc of factChecks) {
    console.log(`  ${fc.ok ? '✅' : '❌'} ${fc.label}`);
  }

  console.log('\n======================================================================');
  return {
    chCoverage,
    pollutionPassed,
    pRatio: target.pCount / baseline.pCount,
    tblRatio: target.tablesCount / baseline.tablesCount
  };
}

if (require.main === module) {
  const target = process.argv[2] || path.resolve(__dirname, '../../../../docs/ai_generated/AI生成_赛鼎起重设备高保真技术标_知识库精准填充版_对齐目录.docx');
  const baseline = process.argv[3] || path.resolve(__dirname, '../../../../docs/raw_bids/赛鼎工程/赛鼎 技术文件0818.docx');
  compareDocs(target, baseline);
}

module.exports = { compareDocs, inspectDocx };
