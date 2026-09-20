#!/usr/bin/env node
/**
 * 模板待填候选「分类环节」的验收（electron 主进程）。
 *
 * 分类是「扫描 → 分类 → 填字段」这条链的中段：它把 158 个空位判成投标人待填、
 * 招标人信息、忽略。判错的代价很直接——目录条目会被写成待填字段、业绩表里的
 * 「采购人名称」会被当成本项目采购人。
 *
 * 因此这里的断言尽量用**独立于分类器实现的定义**去反测，而不是复述分类器的判据：
 * 例如「目录行」用 context 形态（第1列是条款号、第2列是短标题）另行定义，
 * 分类器若漏判，这条断言就会红。
 *
 * 运行（必须 Electron 主进程，且 PATH 里要有 .NET SDK）：
 *   export DOTNET_ROOT="C:\\Users\\Admin\\.dotnet"
 *   export PATH="/c/Users/Admin/.dotnet:/usr/bin:/bin:$PATH"
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     --disable-gpu --no-sandbox scripts/validation/template-field-classification.cjs
 *
 * 输出目录：.trellis/tasks/09-17-openbid-recovery-acceptance/validation/template-field-classification/<时间戳>/
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLIENT_DIR = path.resolve(__dirname, '..', '..');
const WORKSPACE_ROOT = path.resolve(CLIENT_DIR, '..', '..', '..');
const OUT_BASE = path.join(
  WORKSPACE_ROOT,
  '.trellis',
  'tasks',
  '09-17-openbid-recovery-acceptance',
  'validation',
  'template-field-classification',
);

const SOURCE = {
  key: 'tender',
  from: path.join(
    WORKSPACE_ROOT,
    'docs',
    'raw_bids',
    '赛鼎工程',
    '赛鼎 宁波',
    'NC2060.EQP.P01.90-037 起重设备',
    'NC2060.EQP.P01.90-037 起重设备谈判采购文件_已签章.docx',
  ),
};

const assertions = [];
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

function assertion(name, expected, actual, pass, note = '') {
  assertions.push({ name, expected: String(expected), actual: String(actual), pass, note });
  process.stdout.write(`  ${pass ? 'PASS' : 'FAIL'} ${name} (期望 ${expected} / 实际 ${actual})${note ? ` :: ${note}` : ''}\n`);
}

/** 目录行的独立定义：首列是条款号、第二列是短标题。不复用分类器的判据。 */
function looksLikeTocRow(item) {
  const row = /第1列：(\d+(?:\.\d+)*)；第2列：([^；]*)/.exec(String(item.context || ''));
  if (!row) return false;
  const second = row[2].trim();
  return second.length > 0 && second.length <= 12 && !/[：:]/.test(second);
}

function inspectDocx(file) {
  const AdmZip = require(path.join(CLIENT_DIR, 'node_modules', 'adm-zip'));
  const zip = new AdmZip(file);
  const names = zip.getEntries().map((entry) => entry.entryName);
  const entry = zip.getEntry('word/document.xml');
  const documentXml = entry ? entry.getData().toString('utf8') : '';
  // 逐个内容控件取出别名与正文文本，用来核对「占位符短、字段名不丢」。
  const controls = [...documentXml.matchAll(/<w:sdt>[\s\S]*?<\/w:sdt>/g)]
    .map((match) => match[0])
    .filter((block) => block.includes('yibiao:field:'));
  const readVal = (block, tag) => {
    const matched = new RegExp(`<w:${tag}\\s+w:val="([^"]*)"`).exec(block);
    return matched ? matched[1] : '';
  };
  return {
    names,
    documentXml,
    headerParts: names.filter((name) => /^word\/header\d*\.xml$/.test(name)).length,
    footerParts: names.filter((name) => /^word\/footer\d*\.xml$/.test(name)).length,
    tableCount: (documentXml.match(/<w:tbl>/g) || []).length,
    sdtCount: (documentXml.match(/<w:sdt>/g) || []).length,
    fieldTags: [...documentXml.matchAll(/<w:tag\s+w:val="([^"]*)"/g)].map((m) => m[1]),
    fieldAliases: controls.map((block) => readVal(block, 'alias')),
    placeholders: controls
      .map((block) => [...block.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''))
      .filter((text) => text.length > 0),
  };
}

async function main() {
  const { app } = require('electron');
  if (!app?.setPath) throw new Error('必须在 Electron 主进程下运行');

  const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'classify-validate-'));
  const isoWorkspace = path.join(iso, 'workspace');
  fs.mkdirSync(isoWorkspace, { recursive: true });
  cleanOnExit.push(iso);

  const sourceDir = 'diag-sources';
  fs.mkdirSync(path.join(isoWorkspace, sourceDir), { recursive: true });
  const rel = `${sourceDir}/${path.basename(SOURCE.from)}`;
  if (!fs.existsSync(SOURCE.from)) throw new Error(`源文件不存在：${SOURCE.from}`);
  fs.copyFileSync(SOURCE.from, path.join(isoWorkspace, rel));

  fs.mkdirSync(OUT_BASE, { recursive: true });
  const outDir = path.join(OUT_BASE, `verify-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  if (outDir.includes(path.join('docs', 'ai_generated'))) throw new Error('禁止把输出写入 docs/ai_generated');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '.gitignore'), '*\n');
  process.stdout.write(`[stage] 输出目录 -> ${outDir}\n`);

  app.setPath('userData', iso);
  await app.whenReady();

  const { createOpenXmlHelperService } = require(
    path.join(CLIENT_DIR, 'electron', 'services', 'openXmlHelperService.cjs'),
  );
  const { buildApplyRequest, scanAndClassify } = require(
    path.join(CLIENT_DIR, 'electron', 'services', 'templateFieldClassifier.cjs'),
  );
  const service = createOpenXmlHelperService({ app });

  try {
    const { candidates, classification } = await scanAndClassify(service, rel);
    const items = classification.items;
    process.stdout.write(
      `\n[stage] 分类：候选 ${candidates.length} → 待填 ${classification.summary.tenderer_fill} / `
      + `招标方 ${classification.summary.buyer_info} / 忽略 ${classification.summary.ignore}；`
      + `需复核 ${classification.summary.needs_review}，人工签署 ${classification.summary.manual}\n`,
    );

    // ① 分类完整性
    const counted = classification.summary.tenderer_fill
      + classification.summary.buyer_info
      + classification.summary.ignore;
    assertion('每个候选恰好归入一类', `${candidates.length} 个`, `${counted} 个`, counted === candidates.length);

    const request = buildApplyRequest(classification);
    const fieldIds = request.fields.map((item) => item.candidate_id);
    const allIds = items.map((item) => item.candidate_id);
    const overlap = fieldIds.filter((id) => request.ignored_candidate_ids.includes(id));
    assertion('白名单与忽略清单不重叠', '0 个', `${overlap.length} 个`, overlap.length === 0);
    assertion(
      '白名单与忽略清单合起来覆盖全部候选',
      `${allIds.length} 个`,
      `${fieldIds.length + request.ignored_candidate_ids.length} 个`,
      fieldIds.length + request.ignored_candidate_ids.length === allIds.length,
    );

    // ② 反测噪声：目录行必须被忽略（这条若漂了，整份目录会变成待填表）
    const tocRows = items.filter(looksLikeTocRow);
    const tocMissed = tocRows.filter((item) => item.category !== 'ignore');
    assertion('目录条目全部判为忽略', '0 个漏判', `${tocMissed.length} 个漏判（共 ${tocRows.length} 条目录行）`,
      tocMissed.length === 0,
      tocMissed.slice(0, 3).map((item) => `${item.suggested_name}→${item.category}`).join(' | '));

    // ③ 采购方内容区（响应文件格式之前）不该出现投标人待填
    const outside = items.filter((item) => !item.in_response_section);
    const wrongOutside = outside.filter((item) => item.category === 'tenderer_fill');
    assertion('采购方内容区不产生投标人待填字段', '0 个', `${wrongOutside.length} 个`, wrongOutside.length === 0,
      wrongOutside.slice(0, 3).map((item) => `${item.suggested_name}@${item.section}`).join(' | '));

    // ④ 响应区里各类表判得对不对（按小节断言，不依赖块号）
    const inSection = (keyword) => items.filter((item) => String(item.section || '').includes(keyword));
    const basicTable = inSection('申请人基本情况表');
    assertion('申请人基本情况表判为投标人待填', '全部待填',
      `${basicTable.filter((i) => i.category === 'tenderer_fill').length}/${basicTable.length}`,
      basicTable.length > 0 && basicTable.every((item) => item.category === 'tenderer_fill'));

    const performanceTable = inSection('供货业绩表');
    const buyerInPerformance = performanceTable.filter((item) => item.category === 'buyer_info');
    assertion('业绩表里的采购人名称不算招标方信息（那是投标人的客户）', '0 个', `${buyerInPerformance.length} 个`,
      buyerInPerformance.length === 0,
      buyerInPerformance.slice(0, 3).map((item) => item.suggested_name).join(' | '));
    assertion('业绩表本身被识别为待填', '> 0 个待填',
      `${performanceTable.filter((i) => i.category === 'tenderer_fill').length} 个`,
      performanceTable.some((item) => item.category === 'tenderer_fill'));

    const deviationTable = inSection('技术偏离表');
    const purchaseNo = deviationTable.filter((item) => /采购编号|标段/.test(item.suggested_name || ''));
    assertion('偏离表里的采购编号仍判为招标方信息', '全部 buyer_info',
      purchaseNo.map((item) => item.category).join('/') || '（无此候选）',
      purchaseNo.length > 0 && purchaseNo.every((item) => item.category === 'buyer_info'));

    // ④-2 招标方自己出具的文书整节不填：成交通知书里的「成交价」若进了白名单，
    // 投标文件里就会凭空多出一个废字段。
    const noticeSection = inSection('成交通知书');
    assertion('成交通知书整节不进白名单', '全部 ignore',
      noticeSection.map((item) => item.category).join('/') || '（无此小节）',
      noticeSection.length > 0 && noticeSection.every((item) => item.category === 'ignore'));

    // ⑤ 填写方式
    const manualNamed = items.filter(
      (item) => item.category !== 'ignore' && /签字|盖章|公章|加盖/.test(item.suggested_name || ''),
    );
    assertion('签字盖章类判为人工填写', '全部 manual',
      manualNamed.filter((item) => item.fill_by === 'manual').length + '/' + manualNamed.length,
      manualNamed.length > 0 && manualNamed.every((item) => item.fill_by === 'manual'));

    // 企业登记/财务数据必须走 profile：标成 ai 会让下游调生成模型把姓名、身份证号编出来。
    const profileItems = items.filter((item) => item.fill_by === 'profile');
    const profileLeaked = profileItems.filter((item) => item.name_generated || !item.suggested_name);
    assertion('企业登记信息归入 profile（不是 ai）', '> 0 个且都来自标签',
      `${profileItems.length} 个（异常 ${profileLeaked.length} 个）`,
      profileItems.length > 0 && profileLeaked.length === 0);
    assertion('profile 的说明是不许编造', '全部含「不得编造」',
      `${profileItems.filter((item) => /不得编造/.test(item.instruction)).length}/${profileItems.length}`,
      profileItems.every((item) => /不得编造/.test(item.instruction)));
    // 平台侧的 fill_by 只有 ai/manual 两种值时会被拒，这里确认第三类已被接受（写入在下面跑通）
    const fillByValues = [...new Set(items.filter((item) => item.category !== 'ignore').map((item) => item.fill_by))].sort();
    assertion('填写方式取值合法', 'ai/manual/profile 的子集', fillByValues.join(','),
      fillByValues.every((value) => ['ai', 'manual', 'profile'].includes(value)));

    // 取不到名字的空位：不猜名字、不进白名单，但必须标复核并逐条出现在忽略清单里。
    //
    // 这条守的是一段踩过的弯路：曾经把「上下文简短的无名空位」当待填写进模板，
    // 渲染后发现占位符插在「到 2024 年 12 月 31 日」中间——那几格的正文只有空格
    // （排版空格），根本不是待填点，写进去反而切碎了整行。
    // 只统计「因为找不到标签才被忽略」的：成交通知书那类是按结构判的（招标方文书），
    // 不需要复核，混进来会把口径搞乱。
    const unnamed = items.filter(
      (item) => !String(item.suggested_name || '').trim() && /取不到|无法判断|排版空格/.test(item.reason),
    );
    assertion('取不到标签的空位全部标复核（不静默丢）', '全部标复核',
      `${unnamed.filter((item) => item.needs_review).length}/${unnamed.length}`,
      unnamed.length > 0 && unnamed.every((item) => item.needs_review));
    assertion('取不到标签的空位一律不进白名单', '0 个',
      `${request.fields.filter((field) => unnamed.some((item) => item.candidate_id === field.candidate_id)).length} 个`,
      !request.fields.some((field) => unnamed.some((item) => item.candidate_id === field.candidate_id)));

    // 反测：段落里的「下划线空位」若正文只有空格，那是排版空格，必须判 ignore。
    //
    // 判据独立于分类器给的理由，直接看候选自己的 kind 与 text。
    // 曾经把这类当待填写进模板，渲染后占位符插在「到 2024 年 12 月 31 日」中间，
    // 把整行切碎——这条断言把那次教训钉住。
    // 只取 underlined-space：表格空单元格的 text 本来就是空的（空着才是待填），
    // 把它算进来会得出「158 条全是排版空格」这种假结论。
    const layoutSpaces = items.filter(
      (item) => item.kind === 'underlined-space' && !String(item.suggested_name || '').trim() && String(item.text || '').trim() === '',
    );
    const layoutSpaceMisjudged = layoutSpaces.filter((item) => item.category !== 'ignore');
    assertion('正文只有空格的下划线空位不会被当成待填点', '0 个', `${layoutSpaceMisjudged.length} 个`,
      layoutSpaces.length > 0 && layoutSpaceMisjudged.length === 0,
      `共 ${layoutSpaces.length} 条排版空格候选`);

    // apply-template-fields 的硬约束：同名字段的 fill_by 与 instruction 必须一致
    const byName = new Map();
    for (const field of request.fields) {
      const key = field.name;
      const signature = `${field.fill_by}\u0000${field.instruction || ''}`;
      if (!byName.has(key)) byName.set(key, new Set());
      byName.get(key).add(signature);
    }
    const inconsistent = [...byName.entries()].filter(([, set]) => set.size > 1);
    assertion('同名字段的填写方式一致', '0 组冲突', `${inconsistent.length} 组`, inconsistent.length === 0,
      inconsistent.slice(0, 3).map(([name]) => name).join(' | '));

    const emptyNamed = request.fields.filter((item) => !String(item.name || '').trim());
    assertion('白名单里没有空字段名', '0 个', `${emptyNamed.length} 个`, emptyNamed.length === 0);

    // ⑥ 端到端：把白名单交给 apply，版式必须一点不动
    process.stdout.write(`\n[stage] apply-template-fields（字段 ${request.fields.length} 个）\n`);
    let applied = null;
    let applyError = '';
    try {
      applied = await service.runJob({
        action: 'apply-template-fields',
        request: {
          input: rel,
          output: `${sourceDir}/classified.docx`,
          fields_output: `${sourceDir}/classified-fields.json`,
          fields: request.fields,
          ignored_candidate_ids: request.ignored_candidate_ids,
        },
        timeoutMs: 300000,
      });
    } catch (error) {
      applyError = String(error?.message || error);
    }
    assertion('分类后的白名单可直接用于写入', 'ok:true', applied?.ok === true ? 'ok:true' : applyError.slice(0, 160),
      applied?.ok === true);

    const outDocx = path.join(isoWorkspace, `${sourceDir}/classified.docx`);
    if (fs.existsSync(outDocx)) {
      fs.copyFileSync(outDocx, path.join(outDir, 'classified.docx'));
      const sourceDocx = path.join(isoWorkspace, rel);
      const src = inspectDocx(sourceDocx);
      const out = inspectDocx(outDocx);
      assertion('分类后写入不丢部件（版式不动）', `源 ${src.names.length}`, `产物 ${out.names.length}`,
        out.names.length >= src.names.length);
      assertion('分类后写入不动页眉页脚', `源 ${src.headerParts}/${src.footerParts}`,
        `产物 ${out.headerParts}/${out.footerParts}`,
        out.headerParts === src.headerParts && out.footerParts === src.footerParts);
      assertion('分类后写入不动表格数', `源 ${src.tableCount}`, `产物 ${out.tableCount}`,
        out.tableCount === src.tableCount);
      assertion('写入的内容控件数 = 源 + 新建', `= ${src.sdtCount + request.fields.length}`, `${out.sdtCount}`,
        out.sdtCount === src.sdtCount + request.fields.length);
      assertion('每个字段都带 yibiao:field 标签', `= ${request.fields.length}`,
        `${out.fieldTags.filter((tag) => tag.startsWith('yibiao:field:')).length}`,
        out.fieldTags.filter((tag) => tag.startsWith('yibiao:field:')).length === request.fields.length);

      // 占位符写在原本空着的下划线上，写长了会把一行撑成两行（=改版式）。
      // 这条守的是「长字段名退回短标记」这个行为：实测「【人工处理：法定代表人或其
      // 授权代理人签字】」把响应函的签署行折了行。
      const placeholders = out.placeholders;
      const tooLong = placeholders.filter((text) => [...text].length > 6);
      assertion('占位符文案不超过 6 字（不撑开原空位）', '0 个', `${tooLong.length} 个`, tooLong.length === 0,
        tooLong.slice(0, 3).map((text) => `${text}(${[...text].length}字)`).join(' | '));
      assertion('占位符数量与字段数一致', `= ${request.fields.length}`, `${placeholders.length}`,
        placeholders.length === request.fields.length);
      assertion('长字段名虽退回短标记，完整名仍写在 w:alias 里', `= ${request.fields.length}`,
        `${out.fieldAliases.length}`,
        out.fieldAliases.length === request.fields.length
        && request.fields.every((field) => out.fieldAliases.includes(field.name)));
    }

    fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify({
      generated_at: new Date().toISOString(),
      summary: classification.summary,
      response_section_start: classification.response_section_start,
      assertions,
    }, null, 2)}\n`, 'utf8');

    const passed = assertions.filter((item) => item.pass).length;
    process.stdout.write(`\n断言：PASS ${passed} / FAIL ${assertions.length - passed}\n`);
    process.stdout.write(`报告：${outDir}\n`);
  } finally {
    await service.close().catch(() => {});
  }

  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
