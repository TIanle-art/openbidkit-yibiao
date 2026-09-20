#!/usr/bin/env node
/**
 * 模板待填点「填值环节」端到端脚本（electron 主进程）。
 *
 * 它把这条链第一次真正跑到底：
 *   扫描（scan-template-fields）→ 分类（classify）→ 抽事实（tender facts）
 *   → 填值（企业资料库 / 招标文件原文）→ 写入（apply-template-fields）→ 出 filled.docx
 *
 * 与 classify-template-fields.cjs 的分工：那边只标出待填点，这边往待填点里写真值。
 *
 * 运行（必须 Electron 主进程，且 PATH 里要有 .NET SDK）：
 *   export DOTNET_ROOT="C:\\Users\\Admin\\.dotnet"
 *   export PATH="/c/Users/Admin/.dotnet:/usr/bin:/bin:$PATH"
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     --disable-gpu --no-sandbox scripts/fill-template-fields.cjs
 *
 * 输出目录：.trellis/tasks/09-17-openbid-recovery-acceptance/validation/template-field-filling/<时间戳>/
 * 硬约束：绝不写入 docs/ai_generated。
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
  'template-field-filling',
);

const SOURCES = [
  {
    key: 'tender',
    label: '招标文件（含各章节空白格式表）',
    from: path.join(
      WORKSPACE_ROOT,
      'docs',
      'raw_bids',
      '赛鼎工程',
      '赛鼎 宁波',
      'NC2060.EQP.P01.90-037 起重设备',
      'NC2060.EQP.P01.90-037 起重设备谈判采购文件_已签章.docx',
    ),
  },
];

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

async function main() {
  const { app } = require('electron');
  if (!app?.setPath) throw new Error('必须在 Electron 主进程下运行');
  // 先把应用真实 userData 记下来：下面会把它改指向临时目录，
  // 而 AI 配置（user_config.json）只在真实目录里，晚读就读不到了。
  // 直接用 electron.exe 跑脚本时，应用名还没被 setName 改过来，getPath 会退回
  // 「…/AppData/Roaming/Electron」，那里面没有配置——这种情况回退到 yibiao-client。
  let realUserData = process.env.YIBIAO_REAL_USER_DATA || app.getPath('userData');
  if (path.basename(realUserData).toLowerCase() === 'electron') {
    realUserData = path.join(app.getPath('appData'), 'yibiao-client');
  }

  const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'fill-template-'));
  const isoWorkspace = path.join(iso, 'workspace');
  fs.mkdirSync(isoWorkspace, { recursive: true });
  cleanOnExit.push(iso);

  const sourceDir = 'diag-sources';
  fs.mkdirSync(path.join(isoWorkspace, sourceDir), { recursive: true });
  const placed = {};
  for (const source of SOURCES) {
    if (!fs.existsSync(source.from)) {
      process.stdout.write(`  SKIP ${source.label}（源文件不存在）\n`);
      continue;
    }
    const rel = `${sourceDir}/${path.basename(source.from)}`;
    fs.copyFileSync(source.from, path.join(isoWorkspace, rel));
    placed[source.key] = rel;
  }

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

  const { createOpenXmlHelperService } = require(
    path.join(CLIENT_DIR, 'electron', 'services', 'openXmlHelperService.cjs'),
  );
  const { scanAndClassify } = require(
    path.join(CLIENT_DIR, 'electron', 'services', 'templateFieldClassifier.cjs'),
  );
  const { extractTenderFacts } = require(
    path.join(CLIENT_DIR, 'electron', 'services', 'tenderFactExtractor.cjs'),
  );
  const { createCompanyProfileStore } = require(
    path.join(CLIENT_DIR, 'electron', 'services', 'companyProfileStore.cjs'),
  );
  const { createTemplateFieldFiller, renderFillingMarkdown } = require(
    path.join(CLIENT_DIR, 'electron', 'services', 'templateFieldFiller.cjs'),
  );

  // AI 撰写通道：读应用真实配置（user_config.json）。
  // 注意填值脚本把 userData 指到了临时目录，所以配置要用「指向真实 userData 的桩 app」读，
  // 否则只能读到空配置，模型名和 key 都是空的。
  const { createConfigStore } = require(path.join(CLIENT_DIR, 'electron', 'services', 'configStore.cjs'));
  const { createAiService } = require(path.join(CLIENT_DIR, 'electron', 'services', 'aiService.cjs'));
  const configStore = createConfigStore({ getPath: () => realUserData });
  const config = configStore.load?.() || {};
  const aiReady = !!(config.api_key && config.model_name && config.base_url);
  const ai = aiReady ? createAiService({ app, configStore }) : null;
  process.stdout.write(
    `[stage] AI 撰写：${aiReady ? `已接通 ${config.model_name}` : '未配置（ai 类字段标 pending_ai）'}`
    + `（userData=${realUserData}）\n`,
  );

  const service = createOpenXmlHelperService({ app });

  const reports = [];
  try {
    // 企业资料库：优先用仓库里那份真实资料建库，没有才退成空模板。
    // 真实使用时资料在应用 userData，由用户逐项补；补不到的一律留空，不编。
    const profileStore = createCompanyProfileStore({ app });
    const seeded = profileStore.ensureTemplate({
      seedFile: path.join(CLIENT_DIR, 'userData', 'company-profile.json'),
    });
    process.stdout.write(
      `[stage] 企业资料库：${seeded.source === 'seed' ? '从仓库种子建库' : seeded.source === 'existing' ? '沿用已有' : '空模板'}`
      + `，业绩台账 ${profileStore.performanceRows().length} 行\n`,
    );

    for (const source of SOURCES) {
      const rel = placed[source.key];
      if (!rel) continue;
      process.stdout.write(`\n[stage] ${source.label}\n`);

      const { runTemplateFieldFilling } = require(
        path.join(CLIENT_DIR, 'electron', 'services', 'templateFieldPipeline.cjs'),
      );
      const { facts, evidence, candidates, classification, filling, applied } =
        await runTemplateFieldFilling({
          openXmlHelperService: service,
          input: rel,
          output: `${sourceDir}/${source.key}-filled.docx`,
          fieldsOutput: `${sourceDir}/${source.key}-filled-fields.json`,
          profileStore,
          chat: aiReady && ai ? (request) => ai.chat(request) : null,
        });

      process.stdout.write(
        `  候选 ${candidates.length} → 待填 ${classification.summary.tenderer_fill} / `
        + `招标方 ${classification.summary.buyer_info} / 忽略 ${classification.summary.ignore}\n`,
      );
      process.stdout.write(`  抓到事实 ${Object.keys(facts).length} 条：${JSON.stringify(facts)}\n`);
      for (const item of evidence) {
        process.stdout.write(`    ${item.fact} = ${item.value}  ← 块 ${item.block}\n`);
      }
      const result = filling;
      process.stdout.write(
        `  填值：真值 ${result.stats.filled}（原文 ${result.stats.by_source.tender_fact || 0}`
        + ` / 资料库 ${result.stats.by_source.company_profile || 0}）`
        + `，留空 ${result.stats.left_blank}，待接 AI ${result.stats.pending_ai}\n`,
      );

      const prefix = `${sourceDir}/${source.key}`;

      const docxPath = path.join(isoWorkspace, `${prefix}-filled.docx`);
      if (fs.existsSync(docxPath)) fs.copyFileSync(docxPath, path.join(outDir, `${source.key}-filled.docx`));
      fs.writeFileSync(
        path.join(outDir, `${source.key}-facts.json`),
        `${JSON.stringify({ facts, evidence }, null, 2)}\n`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(outDir, `${source.key}-filling.json`),
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(outDir, `${source.key}-filling.md`),
        renderFillingMarkdown(source.label, facts, result),
        'utf8',
      );

      reports.push({
        key: source.key,
        applied_ok: applied?.ok === true,
        block_count: applied?.blockCount ?? 0,
        summary: classification.summary,
        facts,
        filling_stats: result.stats,
        missing_profile_count: result.missing_profile.length,
      });

      for (const entry of result.fields) {
        if (!entry.value) continue;
        process.stdout.write(`    ✓ ${entry.name} = ${entry.value}  ← ${entry.value_source}\n`);
      }
    }

    fs.writeFileSync(
      path.join(outDir, 'report.json'),
      `${JSON.stringify({ generated_at: new Date().toISOString(), reports }, null, 2)}\n`,
      'utf8',
    );
    process.stdout.write(`\n报告：${outDir}\n`);
  } finally {
    await service.close().catch(() => {});
  }

  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
