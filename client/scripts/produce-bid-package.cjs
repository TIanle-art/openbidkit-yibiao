#!/usr/bin/env node
/**
 * 真·出标书：把一次投标要交的东西整套产出来。
 *
 * 流程（应用内是同一条链，见 templateFieldPipeline.cjs）：
 *   招标文件 → 扫描待填点 → 分类 → 抽招标原文事实 → 查企业资料库 → AI 撰写自述
 *   → 原位写入（版式不动）→ 抽出「响应文件格式」整章成册 → 配上技术文件
 *
 * 产物（输出目录下）：
 *   响应文件.docx   —— 商务/响应册，从招标文件第六章抽出，78 处待填点已填真值
 *   技术文件.docx   —— 技术册，沿用本项目自家真实技术文件
 *   *.json/*.md     —— 填值清单与事实，便于人工复核
 *
 * 运行（必须 Electron 主进程，且 PATH 里要有 .NET SDK）：
 *   export DOTNET_ROOT="C:\\Users\\Admin\\.dotnet"
 *   export PATH="/c/Users/Admin/.dotnet:/usr/bin:/bin:$PATH"
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     --disable-gpu --no-sandbox scripts/produce-bid-package.cjs
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLIENT_DIR = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(CLIENT_DIR, '..', '..', '..');
const OUT_BASE = path.join(
  WORKSPACE_ROOT,
  '.trellis',
  'tasks',
  '09-17-openbid-recovery-acceptance',
  'validation',
  'bid-package',
);

const DEFAULT_TENDER_DOCX = path.join(
  WORKSPACE_ROOT,
  'docs',
  'raw_bids',
  '赛鼎工程',
  '赛鼎 宁波',
  'NC2060.EQP.P01.90-037 起重设备',
  'NC2060.EQP.P01.90-037 起重设备谈判采购文件_已签章.docx',
);

// 技术册沿用本项目自家真实技术文件（中原奥起 2026-08 为同一采购编号提交的版本）。
const DEFAULT_TECHNICAL_DOCX = path.join(WORKSPACE_ROOT, 'docs', 'raw_bids', '赛鼎工程', '赛鼎 技术文件0818.docx');

/** 响应册要抽的那一章。 */
const DEFAULT_CHAPTER_TITLE = '第六章 响应文件格式';

/** 命令行覆盖：--tender <招标文件> --tech <技术文件> --chapter <章标题> */
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--tender') opts.tender = argv[(i += 1)];
    else if (a === '--tech') opts.tech = argv[(i += 1)];
    else if (a === '--chapter') opts.chapter = argv[(i += 1)];
  }
  return opts;
}
const CLI = parseArgs(process.argv.slice(2));
const TENDER_DOCX = CLI.tender ? path.resolve(CLI.tender) : DEFAULT_TENDER_DOCX;
const TECHNICAL_DOCX = CLI.tech ? path.resolve(CLI.tech) : DEFAULT_TECHNICAL_DOCX;
const RESPONSE_CHAPTER_TITLE = CLI.chapter || DEFAULT_CHAPTER_TITLE;

const cleanOnExit = [];
process.on('exit', () => {
  for (const dir of cleanOnExit) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响结论 */
    }
  }
});

function blockText(block) {
  return String(block?.text || '').replace(/\s+/g, ' ').trim();
}

/**
 * 在块列表里定位「第六章 响应文件格式」的起止块号。
 * 起点 = 该标题所在块；终点 = 文档最后一个非空块（这一章在招标文件末尾）。
 */
function locateResponseChapter(blocks) {
  let start = -1;
  let last = -1;
  for (const block of blocks) {
    const index = Number.isInteger(block?.index) ? block.index : -1;
    if (index < 0) continue;
    const text = blockText(block);
    if (!text) continue;
    last = index;
    if (start < 0 && text.replace(/\s+/g, '') === RESPONSE_CHAPTER_TITLE.replace(/\s+/g, '')) {
      start = index;
    }
  }
  return { start, end: last >= 0 ? last + 1 : -1 };
}

/**
 * 抽出来的章有两处页码遗留：
 *   ① 起始页码继承原文档（第 59 页起）→ 给第一个 sectPr 加 pgNumType start=1；
 *   ② 这份招标文件的页码根本不是字段，是**写死的文本**（footer59.xml 里就是"59"，
 *      每页一个 footer 部件）→ 把页脚里纯数字的死文本换成真正的 PAGE 字段，
 *      否则每一页都印着同一个页码。
 * 注意 pgNumType 在 schema 里必须排在 cols 之前，插错位置 Word 会报文档损坏。
 */
function resetPageNumber(docxPath) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(docxPath);
  const entry = zip.getEntry('word/document.xml');
  let xml = entry.getData().toString('utf8');
  let changed = false;

  if (!xml.includes('w:pgNumType')) {
    const first = xml.indexOf('<w:sectPr');
    const colsAt = xml.indexOf('<w:cols', first);
    if (first >= 0 && colsAt >= 0) {
      xml = `${xml.slice(0, colsAt)}<w:pgNumType w:start="1" />${xml.slice(colsAt)}`;
      changed = true;
    }
  }
  zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));

  for (const part of zip.getEntries()) {
    if (!/^word\/footer\d+\.xml$/.test(part.entryName)) continue;
    let footer = part.getData().toString('utf8');
    const next = footer.replace(
      /<w:r>((?:(?!<w:r>|<\/w:r>)[\s\S])*?)<w:t(?:\s[^>]*)?>(\d{1,3})<\/w:t><\/w:r>/g,
      (_m, rpr, digits) => {
        if (!digits) return _m;
        const field = (inner) => `<w:r>${rpr}${inner}</w:r>`;
        return [
          field('<w:fldChar w:fldCharType="begin" />'),
          field('<w:instrText xml:space="preserve"> PAGE </w:instrText>'),
          field('<w:fldChar w:fldCharType="separate" />'),
          field('<w:t>1</w:t>'),
          field('<w:fldChar w:fldCharType="end" />'),
        ].join('');
      },
    );
    if (next !== footer) {
      zip.updateFile(part.entryName, Buffer.from(next, 'utf8'));
      changed = true;
    }
  }

  if (changed) zip.writeZip(docxPath);
  return changed;
}

async function main() {
  const { app } = require('electron');
  if (!app?.setPath) throw new Error('必须在 Electron 主进程下运行');
  let realUserData = process.env.YIBIAO_REAL_USER_DATA || app.getPath('userData');
  if (path.basename(realUserData).toLowerCase() === 'electron') {
    realUserData = path.join(app.getPath('appData'), 'yibiao-client');
  }

  const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-package-'));
  const workspace = path.join(iso, 'workspace');
  fs.mkdirSync(path.join(workspace, 'sources'), { recursive: true });
  cleanOnExit.push(iso);

  if (!fs.existsSync(TENDER_DOCX)) throw new Error(`找不到招标文件：${TENDER_DOCX}`);
  const relTender = `sources/${path.basename(TENDER_DOCX)}`;
  fs.copyFileSync(TENDER_DOCX, path.join(workspace, relTender));

  fs.mkdirSync(OUT_BASE, { recursive: true });
  const outDir = path.join(OUT_BASE, new Date().toISOString().replace(/[:.]/g, '-'));
  if (outDir.includes(path.join('docs', 'ai_generated'))) {
    throw new Error('禁止把输出写入 docs/ai_generated');
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '.gitignore'), '*\n');
  process.stdout.write(`[stage] 输出目录 -> ${outDir}\n`);

  app.setPath('userData', iso);
  await app.whenReady();

  const { createOpenXmlHelperService } = require(path.join(CLIENT_DIR, 'electron', 'services', 'openXmlHelperService.cjs'));
  const { createCompanyProfileStore } = require(path.join(CLIENT_DIR, 'electron', 'services', 'companyProfileStore.cjs'));
  const { runTemplateFieldFilling } = require(path.join(CLIENT_DIR, 'electron', 'services', 'templateFieldPipeline.cjs'));
  const { renderFillingMarkdown } = require(path.join(CLIENT_DIR, 'electron', 'services', 'templateFieldFiller.cjs'));
  const { createConfigStore } = require(path.join(CLIENT_DIR, 'electron', 'services', 'configStore.cjs'));
  const { createAiService } = require(path.join(CLIENT_DIR, 'electron', 'services', 'aiService.cjs'));

  const configStore = createConfigStore({ getPath: () => realUserData });
  const config = configStore.load?.() || {};
  const aiReady = !!(config.api_key && config.model_name && config.base_url);
  const ai = aiReady ? createAiService({ app, configStore }) : null;
  process.stdout.write(`[stage] AI 撰写：${aiReady ? `已接通 ${config.model_name}` : '未配置'}\n`);

  const service = createOpenXmlHelperService({ app });
  const profileStore = createCompanyProfileStore({ app });
  profileStore.ensureTemplate({ seedFile: path.join(CLIENT_DIR, 'userData', 'company-profile.json') });

  try {
    // ① 填值：招标原文事实 + 企业资料库 + AI 自述，全部原位写入，版式不动。
    const filled = await runTemplateFieldFilling({
      openXmlHelperService: service,
      input: relTender,
      output: 'sources/filled.docx',
      fieldsOutput: 'sources/filled-fields.json',
      profileStore,
      chat: aiReady && ai ? (request) => ai.chat(request) : null,
    });
    process.stdout.write(
      `[stage] 填值：真值 ${filled.filling.stats.filled}（原文 ${filled.filling.stats.by_source.tender_fact || 0}`
      + ` / 资料库 ${filled.filling.stats.by_source.company_profile || 0}`
      + ` / AI ${filled.filling.stats.by_source.ai || 0}）`
      + `，留空 ${filled.filling.stats.left_blank}\n`,
    );

    // ② 定位并抽出「响应文件格式」整章 —— 这一步才把它从「招标文件」变成「可交的响应文件」。
    const blockResult = await service.runJob({
      action: 'list-blocks',
      request: { sources: ['sources/filled.docx'] },
      timeoutMs: 300000,
    });
    const blocks = require(path.join(blockResult.jobDir, 'blocks.json'))?.sources?.[0]?.blocks || [];
    const { start, end } = locateResponseChapter(blocks);
    if (start < 0 || end <= start) throw new Error(`没能定位到「${RESPONSE_CHAPTER_TITLE}」（start=${start}, end=${end}）`);
    process.stdout.write(`[stage] 响应章块区间：${start} → ${end}（共 ${blocks.length} 块）\n`);

    const extracted = await service.runJob({
      action: 'extract-chapters',
      request: {
        sources: ['sources/filled.docx'],
        output: 'sources/response.docx',
        chapters: [
          {
            // 助手的 JSON 命名策略是 camelCase（JsonOptions.File），写 start_block 会被忽略。
            id: 'response',
            title: '响应文件',
            sourceTitle: RESPONSE_CHAPTER_TITLE,
            source: 'sources/filled.docx',
            startBlock: start,
            endBlock: end,
          },
        ],
      },
      timeoutMs: 300000,
    });
    process.stdout.write(`[stage] 抽章：${extracted?.ok === true ? '成功' : '失败'}，块 ${extracted?.blockCount ?? '-'}\n`);

    // ③ 产物落盘
    const responseOut = path.join(outDir, '响应文件.docx');
    const responseSrc = path.join(workspace, 'sources', 'response.docx');
    if (fs.existsSync(responseSrc)) {
      fs.copyFileSync(responseSrc, responseOut);
      resetPageNumber(responseOut);
      process.stdout.write(`  ✓ 响应文件 ${(fs.statSync(responseOut).size / 1024 / 1024).toFixed(2)} MB（页码已从 1 重编）\n`);
    } else {
      throw new Error('抽章没有产出 response.docx');
    }

    if (fs.existsSync(TECHNICAL_DOCX)) {
      const techOut = path.join(outDir, '技术文件.docx');
      fs.copyFileSync(TECHNICAL_DOCX, techOut);
      process.stdout.write(`  ✓ 技术文件 ${(fs.statSync(techOut).size / 1024 / 1024).toFixed(2)} MB\n`);
    } else {
      process.stdout.write(`  SKIP 技术文件（源文件不存在）\n`);
    }

    fs.writeFileSync(
      path.join(outDir, '填值清单.json'),
      `${JSON.stringify({ facts: filled.facts, ...filled.filling }, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(outDir, '填值清单.md'),
      renderFillingMarkdown(path.basename(TENDER_DOCX), filled.facts, filled.filling),
      'utf8',
    );
    fs.writeFileSync(
      path.join(outDir, 'report.json'),
      `${JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          tender: TENDER_DOCX,
          technical: fs.existsSync(TECHNICAL_DOCX) ? TECHNICAL_DOCX : null,
          response_chapter: { title: RESPONSE_CHAPTER_TITLE, start_block: start, end_block: end },
          classification: filled.classification.summary,
          facts: filled.facts,
          filling: filled.filling.stats,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    process.stdout.write(`\n标书已产出：${outDir}\n`);
  } finally {
    await service.close().catch(() => {});
  }

  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
