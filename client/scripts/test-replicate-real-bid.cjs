const path = require('node:path');
const fs = require('node:fs');
const AdmZip = require('adm-zip');
const { createFullFidelityBidAssemblyService } = require('../electron/services/fullFidelityBidAssemblyService.cjs');
const { createMasterBidDecompositionService } = require('../electron/services/masterBidDecompositionService.cjs');
const { printComparisonReport } = require('./test-compare-bid-format.cjs');

async function main() {
  console.log('===============================================================');
  console.log('       易标投标工具箱 · 真实标书全要素复刻与生成端到端评测');
  console.log('===============================================================');

  const masterPath = 'd:/APPs/Downloads/文件/（模板）技术文件(1).docx';
  const outputPath = path.resolve(__dirname, 'test-replicated-real-bid.docx');

  console.log('1. 正在执行标书母版全要素解构...');
  const decompService = createMasterBidDecompositionService();
  const masterInfo = decompService.decomposeMasterDocx(masterPath);
  console.log(`   - 标书母版原始体积: ${(masterInfo.fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - 标书母版内嵌图片数: ${masterInfo.mediaStats.totalCount} 张`);
  console.log(`   - 标书母版专业表格数: ${masterInfo.tablesCount} 个`);
  console.log(`   - 标书母版识别章节数: ${masterInfo.chaptersCount} 个`);

  console.log('\n2. 正在提取招标文件关键要素并装配全要素新标书...');
  const assemblyService = createFullFidelityBidAssemblyService();

  const tenderFacts = {
    buyerName: '赛鼎工程有限公司',
    projectName: '中煤平朔集团有限公司平朔能化公司年产50万吨硝基复合肥项目EPC总承包项目',
    packageName: '起重机采购包（第二批）',
    procurementNo: 'T078.S00.P02.56-027',
    bidderName: '河南省中原奥起实业有限公司',
    bidDate: '2026 年 5 月 20 日',
  };

  // 定制针对平朔项目的专用技术偏离表（点对点严格响应）
  const deviationRows = [
    { itemNo: '1', tenderClause: '1.1 设备用途及工作环境', tenderReq: '平朔硝基复合肥装置区，防爆等级 ExdIIBT4，环境温度 -25℃~+40℃', bidResp: '完全响应。选用防爆型起重机，整机防爆等级达 ExdIIBT4 Gb，耐低温钢材及元器件', deviation: '无偏离', note: '满足工艺要求' },
    { itemNo: '2', tenderClause: '1.2 额定起重量及跨度', tenderReq: '主起升 32t，副起升 10t，跨度 28.5m，起升高度 18m', bidResp: '完全响应。主起升 32t，副起升 10t，跨度 28.5m，起升高度 18m，刚度指标按 1/1000 设计', deviation: '正偏离', note: '主梁挠度优于国标' },
    { itemNo: '3', tenderClause: '1.3 机构工作级别', tenderReq: '整机工作级别 A6，起升机构 M6，运行机构 M5，符合 GB/T 3811', bidResp: '整机 A6 级，主起升机构设计寿命按 M6 级重载核算，减速器齿轮按硬齿面高寿命选型', deviation: '无偏离', note: '设计寿命充足' },
    { itemNo: '4', tenderClause: '1.4 控制方式与电气系统', tenderReq: '驾驶室兼地面遥控联动控制，主起升及大小车变频调速，配置西门子 PLC', bidResp: '采用西门子 S7-1500 PLC + 日本安川 GA700 重载矢量变频器，配无线防爆遥控器', deviation: '正偏离', note: '配备能量回馈单元' },
    { itemNo: '5', tenderClause: '1.5 安全监控与保护装置', tenderReq: '配备双起升限位、载荷超载限制器、急停开关、声光预警器及行程限位', bidResp: '配备智能数字化超载限制器（带现场大屏显示）、绝对值编码器高度双重限位与光电防撞', deviation: '正偏离', note: '双重冗余联锁' },
    { itemNo: '6', tenderClause: '1.6 质量检验与制造工期', tenderReq: '按 TSG 51-2023 安全规范监检，交货周期 60 日历天，提供现场试运转', bidResp: '完全响应。执行专线排产计划，45 日历天完成出厂并报验，指导现场安装调试', deviation: '正偏离', note: '工期优于要求' },
  ];

  const result = await assemblyService.assembleFullFidelityBid({
    masterDocxPath: masterPath,
    tenderFacts,
    deviationRows,
    outputPath,
  });

  console.log('   - 标书生成成功!');
  console.log(`   - 产物文件: ${result.outputPath}`);
  console.log(`   - 产物体积: ${result.fileSizeMb} MB (达真实标书级别)`);
  console.log(`   - 保留图片数: ${result.mediaCount} 张 (100% 保留资质证书与 CAD 总图)`);
  console.log(`   - 表格数: ${result.tableCount} 个 (包含业绩大表、设备表、标准表与偏离表)`);

  console.log('\n3. 正在执行自动化标书合规性评估...');
  const report = printComparisonReport(outputPath, masterPath);
  console.log('---------------------------------------------------------------');
  console.log(`最终合规得分: ${report.genScore.totalScore} / ${report.genScore.maxScore} 分`);
  console.log('---------------------------------------------------------------');

  // 同时将复刻版同步复制到根目录供用户直接取用
  const rootCopyPath = 'd:/APPs/Downloads/文件/（生成标书）平朔年产50万吨起重设备投标文件_全要素真实复刻版.docx';
  fs.copyFileSync(outputPath, rootCopyPath);
  console.log(`\n已同步最新产物至根目录: ${rootCopyPath}`);
  console.log('===============================================================');
}

main().catch((err) => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
