const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { PDFParse } = require('pdf-parse');

/**
 * 企业资质与多媒体资产提取服务
 * 从现有真实标书（PDF / Docx）中无损抽取并索引工程图纸、资质扫描件、财务报告与设备业绩表
 */
function createEnterpriseAssetExtractor({ storageDir } = {}) {
  const assetCacheDir = storageDir || path.resolve(__dirname, '../../userData/asset_cache');

  function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 从 docx 文件抽取所有媒体文件并分类保存
   */
  function extractMediaFromDocx(docxPath, targetSubdir = 'docx_media') {
    if (!fs.existsSync(docxPath)) {
      throw new Error(`找不到 docx 文件: ${docxPath}`);
    }
    const zip = new AdmZip(docxPath);
    const entries = zip.getEntries();
    const mediaEntries = entries.filter(e => e.entryName.startsWith('word/media/'));

    const outDir = path.join(assetCacheDir, targetSubdir);
    ensureDir(outDir);

    const mediaList = [];
    for (const entry of mediaEntries) {
      const fileName = path.basename(entry.entryName);
      const outPath = path.join(outDir, fileName);
      if (!fs.existsSync(outPath)) {
        fs.writeFileSync(outPath, entry.getData());
      }
      mediaList.push({
        fileName,
        filePath: outPath,
        sizeBytes: entry.header.size,
      });
    }

    return {
      sourceFile: docxPath,
      totalCount: mediaList.length,
      outDir,
      mediaList,
    };
  }

  /**
   * 从 PDF 文件中提取结构化文本和关键章节
   */
  async function extractTextFromPdf(pdfPath) {
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`找不到 PDF 文件: ${pdfPath}`);
    }
    const buf = fs.readFileSync(pdfPath);
    const parser = new PDFParse({ data: buf });
    const res = await parser.getText();
    const text = res.text || '';
    const pages = text.split(/--\s*\d+\s*of\s*\d+\s*--/);

    return {
      sourceFile: pdfPath,
      pageCount: pages.length,
      fullText: text,
      pages,
    };
  }

  return {
    extractMediaFromDocx,
    extractTextFromPdf,
    assetCacheDir,
  };
}

module.exports = {
  createEnterpriseAssetExtractor,
};
