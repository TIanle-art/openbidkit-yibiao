#!/usr/bin/env node
/**
 * 模板待填候选的「分类环节」工具链脚本（electron 主进程）。
 *
 * 它把 openxmlhelper 的扫描结果过一遍分类器，产出白名单，再交给
 * apply-template-fields 生成带内容控件的最终模板。也就是说，
 * 「扫描 → 分类 → 填字段」这条链在这里第一次真正连起来。
 *
 * 运行（必须 Electron 主进程，且 PATH 里要有 .NET SDK）：
 *   export DOTNET_ROOT="C:\\Users\\Admin\\.dotnet"
 *   export PATH="/c/Users/Admin/.dotnet:/usr/bin:/bin:$PATH"
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     --disable-gpu --no-sandbox scripts/classify-template-fields.cjs
 *
 * 输出目录：.trellis/tasks/09-17-openbid-recovery-acceptance/validation/template-field-classification/<时间戳>/
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
  'template-field-classification',
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
  {
    key: 'contentTemplate',
    label: '历史标书内容模板（要点清单 + {{占位符}}）',
    from: path.join(WORKSPACE_ROOT, 'docs', 'raw_bids', '赛鼎工程', '赛鼎 宁波 历史标书内容模板.docx'),
  },
];

const HEADINGS = {
  tenderer_fill: '投标人待填',
  buyer_info: '招标人信息',
  ignore: '忽略',
};

// 三类来源必须分开显示：把 profile 显示成 AI，会让「姓名/性别/年龄」看起来该由模型撰写，
// 而 profile 的语义恰恰是「取自企业资料库，取不到就留空，不得编造」。
const FILL_BY_LABELS = {
  copy: '照抄招标文件',
  manual: '人工签署',
  profile: '资料库',
  ai: 'AI撰写',
};
const fillByLabel = (fillBy) => FILL_BY_LABELS[fillBy] || `未知(${fillBy})`;

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

function cut(value, size) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, size);
}

/** 把分类结果写成便于人工复核的表格。 */
function renderClassificationMarkdown(sourceLabel, classification) {
  const lines = [
    `# 模板待填候选分类（${sourceLabel}）`,
    '',
    `- 文档：\`${classification.source}\``,
    `- 候选总数：${classification.summary.total}`,
    `- 投标人待填：${classification.summary.tenderer_fill}`,
    `- 招标人信息：${classification.summary.buyer_info}`,
    `- 忽略：${classification.summary.ignore}`,
    `- 需人工复核：${classification.summary.needs_review}（多为取不到标签的空位）`,
    `- 其中人工签署/盖章：${classification.summary.manual}`,
    `- 响应文件格式分区起点：块 ${classification.response_section_start}`,
    '',
    '## 白名单（生成字段）',
    '',
    '| 字段名 | 所在小节 | 类别 | 填写方式 | 依据 |',
    '|---|---|---|---|---|',
  ];

  for (const item of classification.items) {
    if (item.category === 'ignore') continue;
    lines.push(
      `| ${item.name || item.suggested_name} | ${item.section || '-'} | ${HEADINGS[item.category]} | `
      + `${fillByLabel(item.fill_by)} | ${item.reason} |`,
    );
  }

  lines.push('', '## 忽略清单', '', '| 候选 | 小节 | 建议名 | 依据 |', '|---|---|---|---|');
  for (const item of classification.items) {
    if (item.category !== 'ignore') continue;
    lines.push(
      `| ${item.candidate_id} | ${item.section || '-'} | ${item.suggested_name || '（无）'} | ${item.reason} |`,
    );
  }

  lines.push('', '## 需人工复核', '', '| 候选 | 小节 | 上下文 | 依据 |', '|---|---|---|---|');
  for (const item of classification.items) {
    if (!item.needs_review) continue;
    lines.push(`| ${item.candidate_id} | ${item.section || '-'} | ${cut(item.context, 60)} | ${item.reason} |`);
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const { app } = require('electron');
  if (!app?.setPath) throw new Error('必须在 Electron 主进程下运行');

  const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'classify-template-'));
  const isoWorkspace = path.join(iso, 'workspace');
  // 助手只按 workspace 相对路径解析我们拷进去的 docx，空目录就够。
  // （openxml-helper.cjs 曾把整个 workspace 复制过来，535MB × 十几次写满过 C 盘。）
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
  const {
    buildApplyRequest,
    scanAndClassify,
  } = require(path.join(CLIENT_DIR, 'electron', 'services', 'templateFieldClassifier.cjs'));
  const service = createOpenXmlHelperService({ app });

  const reports = [];
  try {
    for (const source of SOURCES) {
      const rel = placed[source.key];
      if (!rel) continue;
      process.stdout.write(`\n[stage] ${source.label}\n`);

      const { candidates, classification } = await scanAndClassify(service, rel);
      process.stdout.write(
        `  候选 ${candidates.length} 个 → 待填 ${classification.summary.tenderer_fill} / `
        + `招标方信息 ${classification.summary.buyer_info} / 忽略 ${classification.summary.ignore}，`
        + `需复核 ${classification.summary.needs_review}，人工签署 ${classification.summary.manual}\n`,
      );

      const request = buildApplyRequest(classification);
      process.stdout.write(`  白名单字段 ${request.fields.length} 个，忽略 ${request.ignored_candidate_ids.length} 个\n`);

      const prefix = `${sourceDir}/${source.key}`;
      const applied = await service.runJob({
        action: 'apply-template-fields',
        request: {
          input: rel,
          output: `${prefix}-classified.docx`,
          fields_output: `${prefix}-fields.json`,
          fields: request.fields,
          ignored_candidate_ids: request.ignored_candidate_ids,
        },
        timeoutMs: 300000,
      });

      const docxPath = path.join(isoWorkspace, `${prefix}-classified.docx`);
      const fieldsPath = path.join(isoWorkspace, `${prefix}-fields.json`);
      if (fs.existsSync(docxPath)) fs.copyFileSync(docxPath, path.join(outDir, `${source.key}-classified.docx`));
      if (fs.existsSync(fieldsPath)) fs.copyFileSync(fieldsPath, path.join(outDir, `${source.key}-fields.json`));
      fs.writeFileSync(
        path.join(outDir, `${source.key}-classification.json`),
        `${JSON.stringify(classification, null, 2)}\n`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(outDir, `${source.key}-classification.md`),
        renderClassificationMarkdown(source.label, classification),
        'utf8',
      );

      reports.push({
        key: source.key,
        label: source.label,
        applied_ok: applied?.ok === true,
        block_count: applied?.blockCount ?? 0,
        summary: classification.summary,
        response_section_start: classification.response_section_start,
        field_count: request.fields.length,
        ignored_count: request.ignored_candidate_ids.length,
      });

      // 打印白名单，便于一眼核对分得对不对
      for (const item of classification.items.slice(0, 200)) {
        if (item.category === 'ignore') continue;
        process.stdout.write(
          `    [${HEADINGS[item.category]}/${fillByLabel(item.fill_by)}] `
          + `${item.name || item.suggested_name}  ← ${item.section || '-'}\n`,
        );
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
