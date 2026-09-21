const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');

const TARGET_DOCX = path.resolve(__dirname, '../../../../docs/templates/（模板）技术文件.docx');

function inspectDocx(docxPath) {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`文件不存在: ${docxPath}`);
  }
  const zip = new AdmZip(docxPath);
  const docXml = zip.readAsText('word/document.xml');
  const stylesXml = zip.getEntry('word/styles.xml') ? zip.readAsText('word/styles.xml') : '';
  
  const $ = cheerio.load(docXml, { xmlMode: true });
  const $s = stylesXml ? cheerio.load(stylesXml, { xmlMode: true }) : null;

  // 1. 封面检查
  const firstSection = $('w\\:body > w\\:p, w\\:body > w\\:tbl').slice(0, 35);
  const fullText = $('w\\:body').text();
  const coverText = firstSection.text();
  const hasAiWatermark = fullText.includes('内容由 AI 生成') || fullText.includes('AI 生成');
  
  const hasDocTitle = /响\s*应\s*文\s*件|投\s*标\s*文\s*件/.test(coverText);
  const hasProcurementNo = /采购编号|招标编号|项目编号/.test(coverText);
  const hasPackageName = /标段|标包|包名称/.test(coverText);
  const hasApplicant = /申请人|投标人|单位名称/.test(coverText);
  const hasSignatureOrSeal = /盖章|签字|印章/.test(coverText);
  const hasChineseDate = /\d{4}\s*年\s*\d{1,2}\s*月/.test(coverText);

  // 2. 页面设置与分节
  const sectPrList = $('w\\:sectPr');
  const lastSectPr = sectPrList.last();
  const pgMar = lastSectPr.find('w\\:pgMar');
  const topCm = pgMar.attr('w:top') ? Math.round(Number(pgMar.attr('w:top')) / 567 * 10) / 10 : null;
  const bottomCm = pgMar.attr('w:bottom') ? Math.round(Number(pgMar.attr('w:bottom')) / 567 * 10) / 10 : null;
  const leftCm = pgMar.attr('w:left') ? Math.round(Number(pgMar.attr('w:left')) / 567 * 10) / 10 : null;
  const rightCm = pgMar.attr('w:right') ? Math.round(Number(pgMar.attr('w:right')) / 567 * 10) / 10 : null;
  const hasTitlePg = $('w\\:titlePg').length > 0;

  // 3. 页眉与页脚
  const headerEntries = zip.getEntries().filter(e => e.entryName.startsWith('word/header') && e.entryName.endsWith('.xml'));
  const footerEntries = zip.getEntries().filter(e => e.entryName.startsWith('word/footer') && e.entryName.endsWith('.xml'));
  let footerHasPageNumber = false;
  let footerHasTotalPages = false;
  let headerHasSeparator = false;

  for (const h of headerEntries) {
    const txt = zip.readAsText(h.entryName);
    if (txt.includes('w:bottom') || txt.includes('w:bdr') || txt.includes('w:pBdr')) {
      headerHasSeparator = true;
    }
  }

  for (const f of footerEntries) {
    const txt = zip.readAsText(f.entryName);
    if (txt.includes('PAGE')) footerHasPageNumber = true;
    if (txt.includes('NUMPAGES') || txt.includes('共') || txt.includes('total')) footerHasTotalPages = true;
  }

  // 4. 表格规范检查
  const tables = $('w\\:tbl');
  let totalRows = 0;
  let cantSplitRows = 0;
  let headerRows = 0;
  let shadedHeaders = 0;

  tables.each((i, tbl) => {
    const rows = $(tbl).find('w\\:tr');
    rows.each((ri, r) => {
      totalRows += 1;
      if ($(r).find('w\\:cantSplit').length > 0) {
        cantSplitRows += 1;
      }
      if (ri === 0) {
        if ($(r).find('w\\:tblHeader').length > 0) {
          headerRows += 1;
        }
        if ($(r).find('w\\:shd').length > 0) {
          shadedHeaders += 1;
        }
      }
    });
  });

  // 5. 正文段落与标题
  const paragraphs = $('w\\:p');
  let indentedParagraphs = 0;
  let totalContentParagraphs = 0;
  paragraphs.each((i, p) => {
    const t = $(p).text().trim();
    if (t.length > 30) {
      totalContentParagraphs += 1;
      const ind = $(p).find('w\\:ind');
      if (ind.attr('w:firstLine') || ind.attr('w:firstLineChars')) {
        indentedParagraphs += 1;
      }
    }
  });

  // 6. 配图与图题检查
  const drawings = $('w\\:drawing, a\\:blip, w\\:pict');
  let hasImageCaptions = /图\s*\d+[-—_·.]\d+|图\s*\d+|架构图|附图|示意图|流程图/.test(fullText);

  return {
    file_name: path.basename(docxPath),
    total_paragraphs: paragraphs.length,
    total_tables: tables.length,
    total_rows: totalRows,
    cant_split_ratio: totalRows > 0 ? (cantSplitRows / totalRows) : 1,
    table_header_ratio: tables.length > 0 ? (headerRows / tables.length) : 1,
    shaded_header_ratio: tables.length > 0 ? (shadedHeaders / tables.length) : 1,
    total_images: drawings.length,
    has_image_captions: hasImageCaptions,
    has_ai_watermark: hasAiWatermark,
    cover: {
      has_doc_title: hasDocTitle,
      has_procurement_no: hasProcurementNo,
      has_package_name: hasPackageName,
      has_applicant: hasApplicant,
      has_signature_or_seal: hasSignatureOrSeal,
      has_chinese_date: hasChineseDate,
    },
    page_layout: {
      top_cm: topCm,
      bottom_cm: bottomCm,
      left_cm: leftCm,
      right_cm: rightCm,
      first_page_different: hasTitlePg,
    },
    header_footer: {
      header_count: headerEntries.length,
      footer_count: footerEntries.length,
      header_has_separator: headerHasSeparator,
      footer_has_page_num: footerHasPageNumber,
      footer_has_total_pages: footerHasTotalPages,
    },
    typography: {
      content_paragraphs: totalContentParagraphs,
      indent_ratio: totalContentParagraphs > 0 ? (indentedParagraphs / totalContentParagraphs) : 1,
    },
  };
}

function calculateComplianceScore(result) {
  let score = 0;
  const items = [];

  function check(name, weight, pass, detail) {
    const earned = pass ? weight : 0;
    score += earned;
    items.push({ name, weight, pass, earned, detail });
  }

  // 封面规范 (25分)
  check('无 AI 水印声明', 5, !result.has_ai_watermark, result.has_ai_watermark ? '包含 AI 生成水印' : '无水印');
  check('封面大标题（响应/投标文件）', 4, result.cover.has_doc_title, result.cover.has_doc_title ? '通过' : '缺失');
  check('采购/招标编号', 4, result.cover.has_procurement_no, result.cover.has_procurement_no ? '通过' : '缺失');
  check('标段/包名称', 4, result.cover.has_package_name, result.cover.has_package_name ? '通过' : '缺失');
  check('投标人/申请人名称', 4, result.cover.has_applicant, result.cover.has_applicant ? '通过' : '缺失');
  check('签字盖章区与中文日期', 4, result.cover.has_signature_or_seal && result.cover.has_chinese_date, (result.cover.has_signature_or_seal && result.cover.has_chinese_date) ? '通过' : '缺失盖章或日期');

  // 页面设置与页眉页脚 (25分)
  const marginsOk = result.page_layout.left_cm >= 2.2 && result.page_layout.left_cm <= 3.2;
  check('标准工程页边距（装订留白）', 5, marginsOk, `左边距: ${result.page_layout.left_cm}cm`);
  check('首页规范分节与全真页眉呈现', 5, result.page_layout.first_page_different || result.header_footer.header_count > 0, '通过 (已配置真实页眉)');
  check('页眉下划线/分隔线', 5, result.header_footer.header_has_separator, result.header_footer.header_has_separator ? '通过' : '未检测到');
  check('页码域（第 X 页）', 5, result.header_footer.footer_has_page_num, result.header_footer.footer_has_page_num ? '通过' : '缺失');
  check('总页数域与页码标识', 5, result.header_footer.footer_has_total_pages || result.header_footer.footer_has_page_num, (result.header_footer.footer_has_total_pages || result.header_footer.footer_has_page_num) ? '通过' : '缺失');

  // 表格工程规范 (30分)
  check('表格跨页表头重复 (tblHeader)', 10, result.table_header_ratio >= 0.8, `${Math.round(result.table_header_ratio * 100)}% 表格支持`);
  check('表格行防断裂截断 (cantSplit)', 10, result.cant_split_ratio >= 0.8, `${Math.round(result.cant_split_ratio * 100)}% 行已开启`);
  check('表头底色与边框清晰', 10, result.shaded_header_ratio >= 0.7, `${Math.round(result.shaded_header_ratio * 100)}% 表头有底色`);

  // 排版与配图 (20分)
  check('正文首行缩进（2字符规范）', 10, result.typography.indent_ratio >= 0.6, `${Math.round(result.typography.indent_ratio * 100)}% 满足缩进`);
  check('工程配图与图题规范', 10, result.has_image_captions || result.total_images === 0, result.has_image_captions ? '具备规范图题' : '无图或缺题注');

  return { totalScore: score, maxScore: 100, items };
}

function printComparisonReport(generatedPath, targetPath = TARGET_DOCX) {
  console.log('===============================================================');
  console.log('        易标投标工具箱 · 标书格式标准对齐度评估报告');
  console.log('===============================================================');
  console.log(`生成文件: ${generatedPath}`);
  console.log(`标杆文件: ${targetPath}`);
  console.log('---------------------------------------------------------------');

  const genResult = inspectDocx(generatedPath);
  const genScore = calculateComplianceScore(genResult);

  let targetScore = null;
  if (fs.existsSync(targetPath)) {
    const tarResult = inspectDocx(targetPath);
    targetScore = calculateComplianceScore(tarResult);
    console.log(`标杆标准得分: ${targetScore.totalScore} / ${targetScore.maxScore}`);
  }

  console.log(`生成标书得分: ${genScore.totalScore} / ${genScore.maxScore}`);
  console.log('---------------------------------------------------------------');
  console.log('详细合规指标清单:');
  for (const it of genScore.items) {
    const status = it.pass ? ' [PASS] ' : ' [FAIL] ';
    console.log(`${status} ${it.name.padEnd(28, ' ')} 得分: ${it.earned}/${it.weight}  (${it.detail})`);
  }
  console.log('===============================================================');
  return { genResult, genScore, targetScore };
}

module.exports = {
  inspectDocx,
  calculateComplianceScore,
  printComparisonReport,
};

if (require.main === module) {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.log('用法: node test-compare-bid-format.cjs <待测试的docx路径> [标杆docx路径]');
    console.log('若不传文件，默认自检标杆标书: ' + TARGET_DOCX);
    if (fs.existsSync(TARGET_DOCX)) {
      printComparisonReport(TARGET_DOCX, TARGET_DOCX);
    }
  } else {
    printComparisonReport(fileArg, process.argv[3] || TARGET_DOCX);
  }
}
