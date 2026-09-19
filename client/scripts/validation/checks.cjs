/**
 * AC1–AC9 验收检查（确定性、可重复，不调用外部模型，不启动 Electron）
 *
 * 每条检查返回固定结构：
 *   { ac, title, status, method, assertions: [{name, expected, actual, pass}], evidence, notes }
 * status: PASS / FAIL / PARTIAL / MANUAL-REQUIRED / BLOCKED
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SERVICES = path.resolve(__dirname, '..', '..', 'electron', 'services');

const {
  detectContamination,
  evaluateContaminationGate,
} = require(path.join(SERVICES, 'contaminationGuard.cjs'));
const { buildDeliveryReadinessReport } = require(path.join(SERVICES, 'deliveryReadiness.cjs'));
const { findParameterConflicts } = require(path.join(SERVICES, 'bidQualityService.cjs'));
const { isVisionUnsupportedError, toVisionFallbackError } = require(path.join(SERVICES, 'visionFallback.cjs'));
const {
  extractProcurementTargetsFromText,
  normalizeBidPlan,
  calculateOutlineCoverage,
} = require(path.join(SERVICES, 'bidPlanningService.cjs'));

const {
  PROJECT,
  GUAGUI_PROJECT,
  TENDER_MARKDOWN,
  RESPONSE_FILE_REQUIREMENTS,
  buildOutline,
  buildBidPlan,
  buildParameterRegistry,
  buildContentPlans,
  listDeliverableDocx,
} = require('./fixtures.cjs');

function assertion(name, expected, actual, pass) {
  return { name, expected: String(expected), actual: String(actual), pass: Boolean(pass) };
}

function finish(status, ac, title, method, assertions, notes = [], evidence = []) {
  return { ac, title, status, method, assertions, notes, evidence };
}

function statusFrom(assertions, { partialOnAnyFail = true } = {}) {
  const failed = assertions.filter((item) => !item.pass);
  if (!failed.length) return 'PASS';
  return partialOnAnyFail ? 'PARTIAL' : 'FAIL';
}

// ── DOCX 只读解析（zip + XML 文本抽取） ──────────────────────────
function readZipEntries(filePath) {
  const buffer = fs.readFileSync(filePath);
  const entries = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.slice(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = buffer.slice(dataStart, dataStart + compressedSize);
    entries.push({ name, method, data });
    offset = dataStart + compressedSize;
  }
  return entries;
}

function inflateEntry(entry) {
  if (entry.method === 0) return entry.data;
  if (entry.method === 8) return zlib.inflateRawSync(entry.data);
  return null;
}

function extractDocxText(xml) {
  return [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join('')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function inspectDocx(filePath) {
  const entries = readZipEntries(filePath);
  const parts = [];
  let parseErrors = 0;
  for (const entry of entries) {
    if (!/\.xml$|\.rels$/i.test(entry.name)) continue;
    try {
      const content = inflateEntry(entry);
      if (!content) { parseErrors += 1; continue; }
      parts.push({ name: entry.name, xml: content.toString('utf8') });
    } catch (error) {
      parseErrors += 1;
    }
  }
  const main = parts.find((item) => item.name === 'word/document.xml');
  const headers = parts.filter((item) => /word\/header\d*\.xml$/i.test(item.name));
  const footers = parts.filter((item) => /word\/footer\d*\.xml$/i.test(item.name));
  const anchors = main ? (main.xml.match(/<wp:anchor\b/g) || []).length : 0;
  const inlineDrawings = main ? (main.xml.match(/<wp:inline\b/g) || []).length : 0;
  return {
    file: filePath,
    parts: parts.length,
    parse_errors: parseErrors,
    has_document: Boolean(main),
    sect_pr: main ? (main.xml.match(/<w:sectPr\b/g) || []).length : 0,
    headers: headers.length,
    footers: footers.length,
    floating_anchors: anchors,
    inline_drawings: inlineDrawings,
    text: main ? extractDocxText(main.xml) : '',
  };
}

// ── AC1 ────────────────────────────────────────────────────────
function checkAc1() {
  const method = 'extractProcurementTargetsFromText(招标原文) → 逐条检查 source_refs 是否可回溯定位';
  const targets = extractProcurementTargetsFromText(TENDER_MARKDOWN);
  const locatable = ['page', 'section', 'chunk_id', 'source_id'];
  const traceable = targets.filter((item) => (item.source_refs || []).some((ref) => locatable.some((key) => ref[key])));
  const assertions = [
    assertion('提取到采购标的', '> 0', targets.length, targets.length > 0),
    assertion('每条标的都携带 source_refs', `${targets.length}/${targets.length}`, targets.filter((item) => (item.source_refs || []).length).length, targets.length > 0 && targets.every((item) => (item.source_refs || []).length)),
    assertion('每条标的都能定位到页/节/块', `${targets.length}/${targets.length}`, `${traceable.length}/${targets.length}`, targets.length > 0 && traceable.length === targets.length),
  ];
  const notes = [];
  if (traceable.length < targets.length) {
    notes.push('source_refs 目前只有 label（如「招标文件设备/货物清单」），不含 page/section/chunk_id，无法跳转到原文位置；AC1 的「按条定位来源」只满足一半。');
  }
  return finish(statusFrom(assertions), 'AC1', '结构化需求清单 + 逐条来源定位', method, assertions, notes,
    targets.map((item) => ({ name: item.name, quantity: item.quantity, source_refs: item.source_refs })));
}

// ── AC2 ────────────────────────────────────────────────────────
function checkAc2() {
  const method = 'contaminationGuard 扫描现有交付件 + 注入污染样本，验证通用拦截（不再依赖硬编码脚本）';
  const assertions = [];
  const evidence = [];

  const injected = evaluateContaminationGate([
    { id: 'inj-1', title: '技术方案', content: '本设备配套球磨机与直吹式制粉系统。' },
  ], PROJECT);
  assertions.push(assertion('注入污染样本被阻断', 'blocked', injected.blocked, injected.blocked === true));

  const guaguiSelf = evaluateContaminationGate([
    { id: 'self-1', title: '设备描述', content: '中速磨煤机用过轨起重机，石家庄能源岛项目。' },
  ], GUAGUI_PROJECT);
  assertions.push(assertion('石家庄项目自身复刻不被误伤', 'clean', guaguiSelf.blocked, guaguiSelf.blocked === false));

  const docxFiles = listDeliverableDocx();
  const dirty = [];
  for (const item of docxFiles) {
    try {
      const info = inspectDocx(item.file);
      const result = detectContamination(info.text, item.context);
      if (!result.clean) dirty.push({ file: item.name, terms: [...new Set(result.blockers.map((entry) => entry.term))] });
      evidence.push({
        file: item.name,
        chars: info.text.length,
        blockers: result.blockers.length,
        terms: [...new Set(result.blockers.map((entry) => entry.term))],
        first_hit_context: result.blockers[0]?.context || '',
        context: item.context.projectName,
      });
    } catch (error) {
      evidence.push({ file: item.name, error: String(error.message) });
    }
  }
  assertions.push(assertion('现有交付件无历史项目事实污染', '0 处', `${dirty.length} 处（扫描 ${docxFiles.length} 份）`, dirty.length === 0));

  const exportSource = path.join(SERVICES, 'exportService.cjs');
  const exportText = fs.existsSync(exportSource) ? fs.readFileSync(exportSource, 'utf8') : '';
  const wired = /require\(['"]\.\/contaminationGuard\.cjs['"]\)/.test(exportText)
    && /evaluateContaminationGate\(payload\.outline/.test(exportText)
    && /CROSS_PROJECT_CONTAMINATION/.test(exportText);
  assertions.push(assertion('导出链路已接入污染阻断', 'true', wired, wired === true));

  const notes = [];
  if (!docxFiles.length) notes.push('docs/ai_generated 下未找到可读 DOCX，交付件扫描未执行。');
  if (dirty.length) {
    notes.push(`检出污染的交付件：${dirty.map((entry) => `${entry.file}（${entry.terms.join('、')}）`).join('；')}。按 AC 要求，出现任一词即阻断交付。`);
  }
  return finish(statusFrom(assertions, { partialOnAnyFail: false }), 'AC2', '设备与参数匹配、无跨项目污染', method, assertions, notes, evidence);
}

// ── AC3 ────────────────────────────────────────────────────────
function checkAc3() {
  const method = '目录覆盖率计算 + 必备响应章节缺失时的交付阻断';
  const assertions = [];

  const report = buildDeliveryReadinessReport({
    bidPlan: buildBidPlan(),
    outlineData: buildOutline(),
    responseTables: { technical_deviation: { rows: [] } },
    parameterRegistry: buildParameterRegistry(),
    contentPlans: buildContentPlans(),
    responseFileRequirements: RESPONSE_FILE_REQUIREMENTS,
    tenderMarkdown: TENDER_MARKDOWN,
    project: PROJECT,
  });
  const coverage = calculateOutlineCoverage(buildBidPlan(), buildOutline());
  assertions.push(assertion('技术主题覆盖率可计算', 'true', coverage.computable, coverage.computable === true));
  assertions.push(assertion('完整目录可通过交付闸门', 'can_export', report.gate.can_export, report.gate.can_export === true));

  const incomplete = buildOutline({ outline: [{ id: '4', title: '技术偏离表', technical_topic_ids: ['T1'], content: '起升高度 12m。'.repeat(20) }] });
  const blockedReport = buildDeliveryReadinessReport({
    bidPlan: buildBidPlan(),
    outlineData: incomplete,
    responseTables: {},
    parameterRegistry: buildParameterRegistry(),
    contentPlans: buildContentPlans(),
    responseFileRequirements: RESPONSE_FILE_REQUIREMENTS,
    tenderMarkdown: TENDER_MARKDOWN,
    project: PROJECT,
  });
  assertions.push(assertion('缺失必备章节时阻断交付', 'blocked', blockedReport.gate.blocked, blockedReport.gate.blocked === true));
  assertions.push(assertion('阻断原因为必备章节缺失', 'missing_required_section',
    blockedReport.levels.blocker.map((item) => item.code).join(','),
    blockedReport.levels.blocker.some((item) => item.code === 'missing_required_section')));

  return finish(statusFrom(assertions), 'AC3', '目录覆盖度与废标项阻断', method, assertions, [], {
    coverage_score: coverage.coverage_score,
    blocked_codes: blockedReport.levels.blocker.map((item) => item.code),
  });
}

// ── AC4 ────────────────────────────────────────────────────────
function checkAc4() {
  const method = 'findParameterConflicts：正文参数与已确认投标值比对';
  const outline = buildOutline({ outline: [{ id: '4', title: '技术偏离表', technical_topic_ids: ['T1'], content: '起升高度为13m，满足要求。' }] });
  const conflicts = findParameterConflicts(outline, buildParameterRegistry());
  const cleanConflicts = findParameterConflicts(
    buildOutline({ outline: [{ id: '4', title: '技术偏离表', technical_topic_ids: ['T1'], content: '起升高度为12m，满足要求。' }] }),
    buildParameterRegistry(),
  );
  const assertions = [
    assertion('冲突参数被检出', '1 条', conflicts.length, conflicts.length === 1),
    assertion('一致参数不误报', '0 条', cleanConflicts.length, cleanConflicts.length === 0),
    assertion('冲突项带上确认值与位置', 'confirmed_value + occurrences',
      conflicts[0] ? `${conflicts[0].confirmed_value}/${conflicts[0].occurrences.length}` : 'none',
      Boolean(conflicts[0]?.confirmed_value && conflicts[0]?.occurrences?.length)),
  ];
  return finish(statusFrom(assertions), 'AC4', '项目事实与参数冲突报告', method, assertions, [], conflicts);
}

// ── AC5 ────────────────────────────────────────────────────────
function checkAc5() {
  const method = '静态取证：检查生成阶段是否持久化到可恢复的存储；端到端 kill/relaunch 需 Electron + SQLite';
  const assertions = [];
  const notes = [];
  const evidence = [];

  const sqliteSource = path.join(SERVICES, 'sqliteDatabase.cjs');
  const taskSource = path.join(SERVICES, 'taskService.cjs');
  const sqliteText = fs.existsSync(sqliteSource) ? fs.readFileSync(sqliteSource, 'utf8') : '';
  const taskText = fs.existsSync(taskSource) ? fs.readFileSync(taskSource, 'utf8') : '';

  const persistedTables = [...sqliteText.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map((match) => match[1]);
  const hasTaskState = /status|stage|progress/i.test(taskText) && /UPDATE\s+\w+\s+SET/i.test(taskText);
  assertions.push(assertion('存在任务/阶段持久化表', '> 0', persistedTables.length, persistedTables.length > 0));
  assertions.push(assertion('任务服务可更新阶段状态', 'true', hasTaskState, hasTaskState));
  evidence.push({ sqlite_tables: persistedTables.slice(0, 12) });

  notes.push('端到端「中断后恢复」需要真实关闭并重启 Electron 进程，且 better-sqlite3 本机 ABI 与 Electron(145) 不一致、系统 Node(137) 下 4 个 SQLite 测试失败，因此该场景本次不可执行。');
  notes.push('静态取证只能证明「存在持久化机制」，不能证明「中断后续跑结果正确」，故本项保持 BLOCKED。');

  return finish('BLOCKED', 'AC5', '生成中断后可恢复', method, assertions, notes, evidence);
}

// ── AC6 ────────────────────────────────────────────────────────
function checkAc6() {
  const method = 'OpenXML 只读结构检查（parts / sectPr / 页眉页脚 / 浮动锚点）；视觉渲染人工确认';
  const items = listDeliverableDocx();
  const assertions = [];
  const evidence = [];
  if (!items.length) {
    return finish('BLOCKED', 'AC6', 'DOCX 模板保真', method, [assertion('找到交付件', '> 0', 0, false)], ['docs/ai_generated 下未找到 DOCX，无法执行结构检查。']);
  }
  let xmlOk = 0;
  let structureOk = 0;
  for (const item of items) {
    try {
      const info = inspectDocx(item.file);
      if (info.has_document && info.parse_errors === 0) xmlOk += 1;
      if (info.sect_pr > 0 && info.headers > 0 && info.footers > 0) structureOk += 1;
      evidence.push({
        file: item.name,
        parts: info.parts,
        parse_errors: info.parse_errors,
        sect_pr: info.sect_pr,
        headers: info.headers,
        footers: info.footers,
        floating_anchors: info.floating_anchors,
        inline_drawings: info.inline_drawings,
      });
    } catch (error) {
      evidence.push({ file: item.name, error: String(error.message) });
    }
  }
  assertions.push(assertion('所有包内 XML 可解析', `${items.length}/${items.length}`, `${xmlOk}/${items.length}`, xmlOk === items.length));
  assertions.push(assertion('保留节/页眉/页脚结构', `${items.length}/${items.length}`, `${structureOk}/${items.length}`, structureOk === items.length));

  const notes = ['结构检查只证明 OpenXML 部件存在且可解析；页眉页脚内容、分页、样式观感与浮动对象实际位置必须在 Word/WPS 打开确认，脚本无法替代。'];
  return finish('MANUAL-REQUIRED', 'AC6', 'DOCX 模板保真与可打开', method, assertions, notes, evidence);
}

// ── AC7 ────────────────────────────────────────────────────────
function checkAc7() {
  const method = '待确认占位检测 + 无证据事实主张拦截';
  const pendingOutline = buildOutline({ outline: [
    { id: '1', title: '投标函', technical_topic_ids: [], content: '投标函正文。'.repeat(20) },
    { id: '2', title: '法定代表人身份证明', technical_topic_ids: [], content: '法定代表人身份证明。'.repeat(20) },
    { id: '3', title: '近两年财务状况表', technical_topic_ids: [], content: '财务状况表。'.repeat(20) },
    { id: '4', title: '技术偏离表', technical_topic_ids: ['T1'], content: '证书编号待确认，业绩数量待确认，起升高度 12m。'.repeat(10) },
  ] });
  const report = buildDeliveryReadinessReport({
    bidPlan: buildBidPlan(),
    outlineData: pendingOutline,
    responseTables: { technical_deviation: { rows: [] } },
    parameterRegistry: buildParameterRegistry(false),
    contentPlans: buildContentPlans(),
    responseFileRequirements: RESPONSE_FILE_REQUIREMENTS,
    tenderMarkdown: TENDER_MARKDOWN,
    project: PROJECT,
  });
  const manualCodes = report.levels.manual_confirmation.map((item) => item.code);
  const assertions = [
    assertion('待确认项进入人工确认档', 'pending_facts', manualCodes.join(','), manualCodes.includes('pending_facts')),
    assertion('待确认不阻断生成但要求人工处理', 'requires_manual_confirmation', report.gate.requires_manual_confirmation, report.gate.requires_manual_confirmation === true),
  ];

  const fabricatedOutline = buildOutline({ outline: [
    { id: '4', title: '技术偏离表', technical_topic_ids: ['T1'], content: '我公司拥有大型加工设备20台并通过ISO9001认证。'.repeat(6) },
  ] });
  const fabricated = buildDeliveryReadinessReport({
    bidPlan: buildBidPlan(),
    outlineData: fabricatedOutline,
    responseTables: {},
    parameterRegistry: buildParameterRegistry(),
    contentPlans: { 4: { plan: { evidence_pack: { sources: [] } } } },
    responseFileRequirements: RESPONSE_FILE_REQUIREMENTS,
    tenderMarkdown: TENDER_MARKDOWN,
    project: PROJECT,
  });
  assertions.push(assertion('无证据的事实主张被拦截', 'unsupported_claim',
    fabricated.levels.blocker.map((item) => item.code).join(','),
    fabricated.levels.blocker.some((item) => item.code === 'unsupported_claim')));

  return finish(statusFrom(assertions), 'AC7', '缺失事实标记待确认、不编造', method, assertions, [], {
    manual_codes: manualCodes,
    blocker_codes: fabricated.levels.blocker.map((item) => item.code),
  });
}

// ── AC8 ────────────────────────────────────────────────────────
function checkAc8() {
  const method = 'buildDeliveryReadinessReport：阻断 / 警告 / 人工确认三档并存且计数一致';
  const mixedOutline = buildOutline({ outline: [
    { id: '4', title: '技术偏离表', technical_topic_ids: ['T1'], content: '起升高度为13m，证书编号待确认。'.repeat(10) },
  ] });
  const report = buildDeliveryReadinessReport({
    bidPlan: buildBidPlan(),
    outlineData: mixedOutline,
    responseTables: {},
    parameterRegistry: buildParameterRegistry(),
    contentPlans: { 4: { plan: { evidence_pack: { sources: [] } } } },
    responseFileRequirements: RESPONSE_FILE_REQUIREMENTS,
    tenderMarkdown: TENDER_MARKDOWN,
    project: PROJECT,
  });
  const assertions = [
    assertion('报告输出三档', '3 档', Object.keys(report.levels).length, Object.keys(report.levels).length === 3),
    assertion('阻断档非空', '> 0', report.counts.blocker, report.counts.blocker > 0),
    assertion('警告档非空', '> 0', report.counts.warning, report.counts.warning > 0),
    assertion('人工确认档非空', '> 0', report.counts.manual_confirmation, report.counts.manual_confirmation > 0),
    assertion('计数与条目数一致', 'true',
      Object.keys(report.levels).every((key) => report.counts[key] === report.levels[key].length),
      Object.keys(report.levels).every((key) => report.counts[key] === report.levels[key].length)),
    assertion('有阻断时禁止导出', 'false', report.gate.can_export, report.gate.can_export === false),
  ];
  return finish(statusFrom(assertions), 'AC8', '导出前报告阻断/警告/人工确认分级', method, assertions, [], {
    counts: report.counts,
    blocker_codes: report.levels.blocker.map((item) => item.code),
    warning_codes: report.levels.warning.map((item) => item.code),
    manual_codes: report.levels.manual_confirmation.map((item) => item.code),
  });
}

// ── AC9 ────────────────────────────────────────────────────────
function checkAc9() {
  const method = 'visionFallback 错误映射 + aiService 接入点静态确认；真实模型调用需外部接口';
  const assertions = [];
  const evidence = [];

  const httpError = (status, body) => Object.assign(new Error(`HTTP ${status} ${body}`), { status, aiHttpResponse: body });
  const unsupported = httpError(400, '{"error":{"message":"this model does not support image input"}}');
  const mapped = toVisionFallbackError(unsupported, { filePath: 'kb/a.png', modelName: 'gemini-3.8-flash' });
  assertions.push(assertion('文本模型不支持图片时被识别', 'true', isVisionUnsupportedError(unsupported), isVisionUnsupportedError(unsupported) === true));
  assertions.push(assertion('提示包含明确的不支持说明', '当前文本模型或接口不支持图片输入',
    mapped.message, mapped.message.includes('当前文本模型或接口不支持图片输入')));
  assertions.push(assertion('提示给出替代路径', '视觉模型或 MinerU',
    mapped.message, /视觉模型/.test(mapped.message) && /MinerU/.test(mapped.message)));
  assertions.push(assertion('服务端 5xx 不误判', 'false', isVisionUnsupportedError(httpError(503, 'image not supported')), isVisionUnsupportedError(httpError(503, 'image not supported')) === false));

  const aiSource = path.join(SERVICES, 'aiService.cjs');
  const aiText = fs.existsSync(aiSource) ? fs.readFileSync(aiSource, 'utf8') : '';
  const wired = /require\(['"]\.\/visionFallback\.cjs['"]\)/.test(aiText) && /toVisionFallbackError\(error/.test(aiText);
  assertions.push(assertion('aiService 图片标注路径已接入降级提示', 'true', wired, wired === true));
  evidence.push({ wired_in_ai_service: wired });

  const notes = ['端到端仍需在设置里配置纯文本模型并导入一张图片，观察 UI 是否弹出该提示；本次以单元级映射与接入点静态确认为证据。'];
  return finish(statusFrom(assertions), 'AC9', '视觉模型不支持图片时的降级提示', method, assertions, notes, evidence);
}

module.exports = {
  checks: [checkAc1, checkAc2, checkAc3, checkAc4, checkAc5, checkAc6, checkAc7, checkAc8, checkAc9],
  inspectDocx,
  readZipEntries,
};
