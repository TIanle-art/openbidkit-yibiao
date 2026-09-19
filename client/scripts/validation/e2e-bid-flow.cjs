#!/usr/bin/env electron
/**
 * 出标书全流程端到端驱动（真实链路，非模拟）。
 *
 * 目标：用产品自己的服务，从已有工作区状态走完「技术方案 → 导出 Word」，并对三件事取证：
 *   1. 流程能否走完（每一阶段是否有致命失败）
 *   2. 模板类章节插入的内容是否与来源一致（保真）
 *   3. 其余需要编写的内容是否与导出格式口径一致（格式）
 *
 * 运行方式（必须在 Electron 主进程下跑，better-sqlite3 是按 Electron ABI 编译的）：
 *   node_modules/electron/dist/electron.exe scripts/validation/e2e-bid-flow.cjs
 *
 * 硬约束：真实工作区只读。所有读写都发生在隔离副本里（R5 / AC7）。
 */

const fs = require('node:fs');
const path = require('node:path');

const CLIENT_DIR = path.resolve(__dirname, '..', '..');
const APP_DIR = path.resolve(CLIENT_DIR, '..');
const REPO_ROOT = path.resolve(APP_DIR, '..', '..');

const DEFAULT_OUT = path.join(
  REPO_ROOT,
  '.trellis',
  'tasks',
  '09-17-openbid-recovery-acceptance',
  'validation',
);

const REAL_USER_DATA = path.join(process.env.APPDATA || process.env.HOME || '', 'yibiao-client');

function parseArgs() {
  const out = process.argv.find((arg) => arg.startsWith('--out='));
  const target = out
    ? path.resolve(out.slice('--out='.length))
    : path.join(DEFAULT_OUT, `e2e-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  if (target.includes(path.join('docs', 'ai_generated'))) {
    throw new Error('禁止把验证输出写入 docs/ai_generated');
  }
  fs.mkdirSync(target, { recursive: true });
  return target;
}

const OUT_DIR = parseArgs();
// 每轮跑在自己的运行目录里，避免依赖删除操作（本机 fs.rmSync 被安全删除 shim 接管）。
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const ISO_USER_DATA = path.join(OUT_DIR, 'runs', RUN_ID, 'userdata');
const ISO_WORKSPACE = path.join(ISO_USER_DATA, 'workspace');
const OUT_ARTIFACTS = path.join(OUT_DIR, 'runs', RUN_ID, 'artifacts');

const report = {
  generated_at: new Date().toISOString(),
  output_dir: OUT_DIR,
  stages: [],
  assertions: [],
  evidence: {},
  errors: [],
};

function stage(name, status, detail) {
  report.stages.push({ name, status, detail: detail || '', at: new Date().toISOString() });
  process.stdout.write(`[stage] ${name} -> ${status}${detail ? ` :: ${detail}` : ''}\n`);
}

function assertion(name, expected, actual, pass, note) {
  report.assertions.push({ name, expected, actual, pass: Boolean(pass), note: note || '' });
  process.stdout.write(`  ${pass ? 'PASS' : 'FAIL'} ${name} (期望 ${expected} / 实际 ${actual})\n`);
  return Boolean(pass);
}

/** 复制真实工作区的必要子集到隔离目录，源目录只读。 */
function prepareIsolatedWorkspace() {
  fs.mkdirSync(ISO_WORKSPACE, { recursive: true });

  const configSrc = path.join(REAL_USER_DATA, 'user_config.json');
  if (fs.existsSync(configSrc)) {
    fs.copyFileSync(configSrc, path.join(ISO_USER_DATA, 'user_config.json'));
  }

  const copyTargets = ['yibiao.sqlite', 'technical-plan', 'generated-images', 'imported-images', 'image-library', 'past-bid-templates'];
  const copied = [];
  for (const name of copyTargets) {
    const src = path.join(REAL_USER_DATA, 'workspace', name);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(ISO_WORKSPACE, name);
    fs.cpSync(src, dst, { recursive: true, force: true });
    copied.push(name);
  }
  report.evidence.isolated_copy = { user_data: ISO_USER_DATA, copied };
  return copied;
}

/** 把数据库里的扁平大纲重建为导出所需的树。 */
function buildOutlineTree(db) {
  const rows = db
    .prepare('SELECT node_id, parent_node_id, sort_order, level, title, description, content_mode, content_mode_note, content FROM technical_plan_outline_nodes ORDER BY sort_order, rowid')
    .all();
  const byId = new Map();
  const roots = [];
  for (const row of rows) {
    const node = {
      id: String(row.node_id),
      title: String(row.title || ''),
      description: row.description || '',
      level: Number(row.level) || 1,
      content_mode: row.content_mode || undefined,
      content_mode_note: row.content_mode_note || undefined,
      content: row.content || '',
      children: [],
    };
    byId.set(node.id, node);
  }
  for (const row of rows) {
    const node = byId.get(String(row.node_id));
    const parentId = row.parent_node_id == null ? null : String(row.parent_node_id);
    if (parentId && byId.has(parentId)) byId.get(parentId).children.push(node);
    else roots.push(node);
  }
  const strip = (list) => list.map((node) => {
    const next = { ...node };
    if (!next.children.length) delete next.children;
    else next.children = strip(next.children);
    return next;
  });
  return strip(roots);
}

function loadJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const { app } = require('electron');
  if (!app?.setPath) {
    throw new Error('必须在 Electron 主进程下运行（不要设置 ELECTRON_RUN_AS_NODE=1）');
  }
  // 隔离优先：先改 userData，再加载任何会解析路径的服务。
  app.setPath('userData', ISO_USER_DATA);
  await app.whenReady();

  // ---- Stage 1: 隔离环境 ----
  const copied = prepareIsolatedWorkspace();
  stage('01-isolate-workspace', copied.length ? 'ok' : 'failed', copied.join(','));
  if (!copied.length) throw new Error('隔离工作区复制失败：真实工作区不存在');

  const { createSqliteDatabase } = require(path.join(CLIENT_DIR, 'electron', 'services', 'sqliteDatabase.cjs'));
  const { createTaskLogStore } = require(path.join(CLIENT_DIR, 'electron', 'services', 'taskLogStore.cjs'));
  const { createTechnicalPlanStore } = require(path.join(CLIENT_DIR, 'electron', 'services', 'technicalPlanStore.cjs'));
  const { buildDocxResult } = require(path.join(CLIENT_DIR, 'electron', 'services', 'exportService.cjs'));
  const { evaluateContaminationGate } = require(path.join(CLIENT_DIR, 'electron', 'services', 'contaminationGuard.cjs'));

  const { db } = createSqliteDatabase(app);
  const taskLogStore = createTaskLogStore({ app, db });
  const store = createTechnicalPlanStore({
    app,
    db,
    taskLogStore,
    fileService: {},
    agentService: {},
  });

  // ---- Stage 2: 读取技术方案状态 ----
  let plan;
  try {
    plan = store.loadTechnicalPlan();
    stage('02-load-technical-plan', 'ok', `step=${plan.step}`);
  } catch (error) {
    stage('02-load-technical-plan', 'failed', error.message);
    throw error;
  }

  const outline = plan.outlineData?.outline || [];
  assertion('技术方案可加载', 'true', String(Boolean(plan)), Boolean(plan));
  assertion('大纲节点非空', '> 0', String(outline.length), outline.length > 0);

  const countLeaves = (items) => items.reduce(
    (sum, item) => sum + (item.children?.length ? countLeaves(item.children) : 1),
    0,
  );
  const leafTotal = countLeaves(outline);
  const dbLeafCount = db
    .prepare('SELECT COUNT(*) AS c FROM technical_plan_outline_nodes WHERE content_mode IS NOT NULL')
    .get().c;
  assertion('树重建后的叶子数与库内可填充节点数一致', String(dbLeafCount), String(leafTotal), dbLeafCount === leafTotal);

  const emptyLeaves = [];
  const walk = (items) => {
    for (const item of items) {
      if (item.children?.length) { walk(item.children); continue; }
      if (!String(item.content || '').trim()) emptyLeaves.push(item.title);
    }
  };
  walk(outline);
  report.evidence.empty_leaves = emptyLeaves;

  // ---- Stage 3: 导出格式与元信息 ----
  const config = loadJsonIfExists(path.join(ISO_USER_DATA, 'user_config.json')) || {};
  const exportFormat = config.export_format || null;
  assertion('存在导出格式配置', '非空', exportFormat ? 'ok' : '空', Boolean(exportFormat));

  const payload = {
    outline,
    export_format: exportFormat,
    global_facts: plan.globalFacts,
    bid_analysis_tasks: plan.bidAnalysisTasks,
    project_overview: plan.projectOverview,
  };
  if (plan.outlineData?.project_name) payload.project_name = plan.outlineData.project_name;

  // ---- Stage 4: 污染闸门（导出前置条件）----
  const contamination = evaluateContaminationGate(outline, {
    projectName: payload.project_name || '',
  });
  report.evidence.contamination = {
    blocked: contamination.blocked,
    reason: contamination.reason,
    blockers: (contamination.details?.blockers || []).slice(0, 20),
  };
  stage('04-contamination-gate', contamination.blocked ? 'blocked' : 'ok', contamination.reason || '');

  // ---- Stage 5: 真实导出 ----
  fs.mkdirSync(OUT_ARTIFACTS, { recursive: true });
  const warnings = [];
  let buildResult;
  try {
    buildResult = await buildDocxResult(payload, { warnings });
    stage('05-export-docx', 'ok', `${buildResult.buffer.length} bytes`);
  } catch (error) {
    stage('05-export-docx', 'failed', `${error.message}\n${error.stack || ''}`);
    throw error;
  }

  const docxPath = path.join(OUT_ARTIFACTS, '出标书流程_端到端产出.docx');
  fs.writeFileSync(docxPath, buildResult.buffer);
  report.evidence.docx = {
    path: docxPath,
    bytes: buildResult.buffer.length,
    stats: buildResult.stats,
    warnings,
  };
  assertion('导出产物已落盘', '> 0', String(buildResult.buffer.length), buildResult.buffer.length > 0);
  assertion('导出无警告', '0', String(warnings.length), warnings.length === 0, warnings.slice(0, 5).join(' | '));

  // ---- Stage 6: 产物校验（流程 / 模板保真 / 格式一致）----
  const {
    parseDocx,
    parseTables,
    checkTableColumnWidths,
    checkContentHeadingLevels,
    checkOutlinePresence,
    checkTemplateFidelity,
    checkBodyFormat,
  } = require('./docxVerify.cjs');

  const parsed = parseDocx(docxPath);
  report.evidence.docx.parsed = {
    blocks: parsed.blocks.length,
    headers: parsed.headerCount,
    footers: parsed.footerCount,
    media: parsed.mediaCount,
    drawings: parsed.drawingCount,
  };
  stage('06-parse-docx', 'ok', `段落块 ${parsed.blocks.length} 媒体 ${parsed.mediaCount} 图形 ${parsed.drawingCount}`);

  const presence = checkOutlinePresence(parsed, outline);
  report.evidence.outline_presence = { ...presence, docText: undefined };
  assertion('目录章节全部落进 Word', '0 缺失', String(presence.missing.length), presence.missing.length === 0,
    presence.missing.slice(0, 5).join('、'));
  assertion('章节顺序与目录一致', '0 处倒序', String(presence.outOfOrder), presence.outOfOrder === 0);
  const lostTotal = presence.lostContent.reduce((sum, item) => sum + item.lost, 0);
  assertion('有内容章节的正文未在导出中丢失', '0 段', `${lostTotal} 段`, lostTotal === 0,
    presence.lostContent.slice(0, 3).map((item) => `${item.title}(${item.lost}/${item.total}): ${item.sample[0]}`).join(' | '));
  report.evidence.outline_presence.lostContent = presence.lostContent;

  const fidelity = checkTemplateFidelity(parsed, outline);
  report.evidence.template_fidelity = fidelity;
  const totalFragments = fidelity.reduce((sum, item) => sum + item.fragments, 0);
  const lostFragments = fidelity.reduce((sum, item) => sum + item.lostFragments, 0);
  const lostCells = fidelity.reduce((sum, item) => sum + item.lostTableCells, 0);
  const templateFilled = fidelity.filter((item) => item.mode === 'template-fill');
  assertion('模板类章节逐段与原内容一致', '0 段丢失',
    `${lostFragments}/${totalFragments} 段丢失`, lostFragments === 0,
    fidelity.flatMap((item) => item.lostSample.map((s) => `${item.title}: ${s}`)).slice(0, 3).join(' | '));
  assertion('表格单元格未在导出中丢失', '0 格', `${lostCells} 格`, lostCells === 0);
  report.evidence.template_fill_sections = templateFilled.length;

  const tableWidths = checkTableColumnWidths(parseTables(docxPath));
  report.evidence.table_column_widths = tableWidths;
  assertion('表格列宽未明显失衡', '0 列', `${tableWidths.violations.length}/${tableWidths.examined} 表失衡`,
    tableWidths.violations.length === 0,
    tableWidths.violations.slice(0, 3).map((v) => `表${v.table} 第${v.column}列 宽${v.width} 占比${v.actualShare}<应得${v.demandShare}`).join(' | '));

  const headingLevels = checkContentHeadingLevels(parsed);
  report.evidence.heading_levels = headingLevels;
  assertion('目录条目已写入(目录非空)', '> 0 条', `${headingLevels.tocEntryCount} 条`, headingLevels.tocEntryCount > 0);
  assertion('1-3 级只由大纲占据(正文小标题不入目录)', '0 级不符',
    headingLevels.mismatches.length
      ? headingLevels.mismatches.map((m) => `L${m.level} 目录${m.expected}/标题${m.actual}`).join(' ')
      : `正文小标题 ${headingLevels.contentHeadingCount} 个全在 4 级及更深`,
    headingLevels.mismatches.length === 0,
    headingLevels.mismatches.map((m) => `L${m.level} 目录${m.expected} 条但标题${m.actual} 个`).join(' | '));

  const format = checkBodyFormat(parsed, exportFormat);
  report.evidence.body_format = format;
  assertion('正文段落格式与导出格式一致', '0 处不符',
    format.applicable ? `${format.violations.length}/${format.examined} 段不符` : '无导出格式声明',
    !format.applicable || format.violations.length === 0,
    format.violations.slice(0, 3).map((v) => `${v.text} -> ${v.reasons.join(';')}`).join(' | '));

  // ---- Stage 7: 报告 ----
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), renderMarkdown(), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, '.gitignore'), '*\n', 'utf8');
  process.stdout.write(`\n产物：${docxPath}\n报告：${OUT_DIR}\n`);
  app.exit(report.assertions.every((item) => item.pass) ? 0 : 2);
}

function renderMarkdown() {
  const lines = [];
  lines.push('# 出标书全流程端到端执行结果');
  lines.push('');
  lines.push(`- 生成时间：${report.generated_at}`);
  lines.push(`- 输出目录：${report.output_dir}`);
  const passed = report.assertions.filter((item) => item.pass).length;
  lines.push(`- 断言：PASS ${passed} / FAIL ${report.assertions.length - passed}`);
  lines.push('');
  lines.push('## 阶段');
  lines.push('');
  lines.push('| 阶段 | 状态 | 说明 |');
  lines.push('| --- | --- | --- |');
  for (const item of report.stages) lines.push(`| ${item.name} | ${item.status} | ${String(item.detail || '').split('\n')[0].slice(0, 160)} |`);
  lines.push('');
  lines.push('## 断言');
  lines.push('');
  lines.push('| 断言 | 期望 | 实际 | 结果 |');
  lines.push('| --- | --- | --- | --- |');
  for (const item of report.assertions) {
    lines.push(`| ${item.name} | ${item.expected} | ${item.actual} | ${item.pass ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('');
  const fidelity = report.evidence.template_fidelity || [];
  if (fidelity.length) {
    lines.push('## 章节保真明细');
    lines.push('');
    lines.push('| 章节 | 模式 | 来源段数 | 丢失段数 | 表格格数 | 丢格数 | 导出字符 | 来源字符 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const item of fidelity) {
      lines.push(`| ${item.title} | ${item.mode || '-'} | ${item.fragments} | ${item.lostFragments} | ${item.tableCells} | ${item.lostTableCells} | ${item.exportedChars} | ${item.sourceChars} |`);
    }
    lines.push('');
  }
  const format = report.evidence.body_format;
  if (format?.violations?.length) {
    lines.push('## 格式不一致样例（前 20 条）');
    lines.push('');
    for (const item of format.violations.slice(0, 20)) lines.push(`- 「${item.text}」 ${item.reasons.join('；')}`);
    lines.push('');
  }
  if (report.errors.length) {
    lines.push('## 错误');
    lines.push('');
    for (const item of report.errors) lines.push('```', item, '```');
  }
  return lines.join('\n');
}

main().catch((error) => {
  report.errors.push(String(error?.stack || error?.message || error));
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(path.join(OUT_DIR, '.gitignore'), '*\n', 'utf8');
  } catch {}
  process.stderr.write(`fatal: ${error?.stack || error}\n`);
  const { app } = require('electron');
  app.exit(1);
});
