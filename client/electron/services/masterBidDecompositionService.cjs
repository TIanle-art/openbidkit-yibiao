const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 标书母版解构服务
 * 负责对真实工业标书母版（如230页标杆标书）进行全要素深度解构，
 * 提取并索引全部图片资产、工程大表与章节块结构。
 */
function createMasterBidDecompositionService({ app, logger } = {}) {
  /**
   * 解构标书母版
   * @param {string} masterDocxPath 母版 Word 文档路径
   * @returns {object} 解构结果元数据
   */
  function decomposeMasterDocx(masterDocxPath) {
    if (!fs.existsSync(masterDocxPath)) {
      throw new Error(`找不到标书母版文件：${masterDocxPath}`);
    }

    const zip = new AdmZip(masterDocxPath);
    const entries = zip.getEntries();

    // 1. 提取所有媒体资产 (word/media/*)
    const mediaEntries = entries.filter((e) => e.entryName.startsWith('word/media/') && !e.isDirectory);
    const mediaStats = {
      totalCount: mediaEntries.length,
      images: mediaEntries.map((e) => ({
        entryName: e.entryName,
        fileName: path.basename(e.entryName),
        sizeBytes: e.header.size,
        ext: path.extname(e.entryName).toLowerCase(),
      })),
      totalBytes: mediaEntries.reduce((sum, e) => sum + e.header.size, 0),
    };

    // 2. 解析 document.xml
    const docXml = zip.readAsText('word/document.xml');
    const $ = cheerio.load(docXml, { xmlMode: true });

    // 3. 提取全部段落与章节
    const chapters = [];
    $('w\\:p').each((idx, p) => {
      const style = $(p).find('w\\:pStyle').attr('w:val');
      const text = $(p).find('w\\:t').map((_, t) => $(t).text()).get().join('').trim();
      if (!text) return;

      // 识别大章节标题
      const isMajorChapter = style === '1' || style === '2' || style === '3' ||
        /^第[一二三四五六七八九十]+[部分章节卷]/.test(text) ||
        /^[一二三四五六七八九十]+[、.]\s*/.test(text) ||
        /^\d+(\.\d+)*\s+/.test(text);

      if (isMajorChapter && text.length <= 80) {
        chapters.push({
          paragraphIndex: idx,
          style,
          title: text,
        });
      }
    });

    // 4. 提取全部表格定位与表头特征
    const tables = [];
    $('w\\:tbl').each((idx, tbl) => {
      const rowCount = $(tbl).find('w\\:tr').length;
      const firstRow = $(tbl).find('w\\:tr').first();
      const headers = firstRow.find('w\\:tc')
        .map((_, tc) => $(tc).find('w\\:t').map((__, t) => $(t).text()).get().join('').trim())
        .get();

      // 判断表格业务类型
      const headerStr = headers.join(' | ');
      let tableCategory = 'general';
      if (/基本情况|投标人名称|法定代表人/.test(headerStr)) {
        tableCategory = 'basic_info';
      } else if (/业绩|产品名称.*型号.*工作.*级别|台/.test(headerStr)) {
        tableCategory = 'past_performance';
      } else if (/装备名称|设备名称.*规格型号.*性能/.test(headerStr)) {
        tableCategory = 'machinery_equipment';
      } else if (/检测|探伤|硬度|试验/.test(headerStr)) {
        tableCategory = 'testing_equipment';
      } else if (/偏离|偏差|招标文件要求/.test(headerStr)) {
        tableCategory = 'technical_deviation';
      } else if (/配套件|外协|生产厂家|品牌/.test(headerStr)) {
        tableCategory = 'component_bom';
      } else if (/检验试验计划|ITP|见证点|停检点/.test(headerStr)) {
        tableCategory = 'itp_quality_plan';
      } else if (/标准号|规范|国家标准/.test(headerStr)) {
        tableCategory = 'standards';
      }

      tables.push({
        tableIndex: idx,
        rowCount,
        headers,
        category: tableCategory,
      });
    });

    return {
      masterPath: masterDocxPath,
      fileSizeBytes: fs.statSync(masterDocxPath).size,
      mediaStats,
      chaptersCount: chapters.length,
      sampleChapters: chapters.slice(0, 30),
      tablesCount: tables.length,
      tables,
    };
  }

  return {
    decomposeMasterDocx,
  };
}

module.exports = {
  createMasterBidDecompositionService,
};
