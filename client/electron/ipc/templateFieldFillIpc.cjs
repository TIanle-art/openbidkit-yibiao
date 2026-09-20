'use strict';

/**
 * 「模板待填点自动填值」应用内入口。
 *
 * 输入一份招标/响应 docx，跑完整条链：扫描 → 分类 → 抽招标事实 →
 * 查企业资料库 → （可选）AI 撰写自述栏 → 原位写入内容控件，版式不动。
 *
 * 设计要点：
 *   - openxmlhelper 只认 workspace 相对路径，所以先搭一个**隔离临时工作区**
 *     把源文件拷进去，跑完再把产物拷回用户指定的位置。隔离目录用唯一名，
 *     绝不做递归删除（fs.rmSync 在本机被安全删除 shim 接管，会 ETIMEDOUT）。
 *   - 企业资料库优先用应用 userData 里用户手补的那份；没有就从仓库种子
 *     （client/userData/company-profile.json）建库，保证开箱就有真实数据。
 *   - AI 撰写用应用已配置的文本模型；没配模型时 ai 类字段标 pending_ai 留空，
 *     绝不因为缺模型就报错或编内容。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ipcMain } = require('electron');

const CLIENT_DIR = path.resolve(__dirname, '..', '..');
const SEED_PROFILE_PATH = path.join(CLIENT_DIR, 'userData', 'company-profile.json');

function registerTemplateFieldFillIpc({ app, openXmlHelperService, aiService }) {
  ipcMain.handle('templates:fill-template-fields', async (_event, payload = {}) => {
    const inputPath = String(payload.inputPath || '').trim();
    if (!inputPath || !fs.existsSync(inputPath)) {
      return { success: false, message: '请先选择一份存在的 .docx 文件' };
    }
    if (path.extname(inputPath).toLowerCase() !== '.docx') {
      return { success: false, message: '自动填值目前只支持 .docx' };
    }

    // 临时工作区：唯一目录，退出时只登记不删（见上，本机删目录会卡死）。
    const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-fill-'));
    const workspace = path.join(iso, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    const relInput = `sources/${path.basename(inputPath)}`;
    fs.mkdirSync(path.join(workspace, 'sources'), { recursive: true });
    fs.copyFileSync(inputPath, path.join(workspace, relInput));

    // 企业资料库：用户手补的优先，其次仓库种子，最后空模板（取不到就留空）。
    const { createCompanyProfileStore } = require('../services/companyProfileStore.cjs');
    const profileStore = createCompanyProfileStore({ app });
    const seeded = profileStore.ensureTemplate({ seedFile: SEED_PROFILE_PATH });

    // AI：应用已配置的文本模型；没配就留空等人工。
    const chat = aiService && typeof aiService.chat === 'function' ? (request) => aiService.chat(request) : null;

    try {
      const { runTemplateFieldFilling, buildCompanyBrief } = require('../services/templateFieldPipeline.cjs');
      const result = await runTemplateFieldFilling({
        openXmlHelperService,
        input: relInput,
        output: 'sources/filled.docx',
        fieldsOutput: 'sources/filled-fields.json',
        profileStore,
        chat,
      });

      // 产物落盘：默认与源文件同目录，加 -filled 后缀；也可由调用方指定。
      const outDir = path.dirname(inputPath);
      const base = path.basename(inputPath, path.extname(inputPath));
      const docxOut = payload.outputPath || path.join(outDir, `${base}-filled.docx`);
      const reportOut = payload.reportPath || path.join(outDir, `${base}-filled-填值清单.json`);
      const mdOut = payload.markdownPath || path.join(outDir, `${base}-filled-填值清单.md`);

      const filledDocx = path.join(workspace, 'sources', 'filled.docx');
      if (fs.existsSync(filledDocx)) fs.copyFileSync(filledDocx, docxOut);

      const { renderFillingMarkdown } = require('../services/templateFieldFiller.cjs');
      const { facts } = result;
      const report = {
        generated_at: new Date().toISOString(),
        input: inputPath,
        output: docxOut,
        profile_source: seeded.source,
        facts,
        company_brief: buildCompanyBrief(profileStore.load(), facts),
        ...result.filling,
      };
      fs.writeFileSync(reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      fs.writeFileSync(mdOut, renderFillingMarkdown(path.basename(inputPath), facts, result.filling), 'utf8');

      return {
        success: true,
        output: docxOut,
        report: reportOut,
        markdown: mdOut,
        summary: {
          candidates: result.candidates.length,
          classification: result.classification.summary,
          facts,
          filling: result.filling.stats,
          missing_profile: result.filling.missing_profile,
          missing_facts: result.filling.missing_facts,
          applied_ok: result.applied?.ok === true,
          block_count: result.applied?.blockCount ?? 0,
        },
      };
    } catch (error) {
      return { success: false, message: error?.message || String(error) };
    }
  });
}

module.exports = { registerTemplateFieldFillIpc, SEED_PROFILE_PATH };
