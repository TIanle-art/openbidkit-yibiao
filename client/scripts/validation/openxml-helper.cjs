#!/usr/bin/env node
/**
 * Open XML 助手（openxmlhelper，.NET 10）可用性验证。
 *
 * 助手是「保留模板版式」的关键通路：它直接在模板 docx 上原地填 w:sdt 字段，
 * 不重新排版，因此版式天然保留。本脚本验证它在本机真的能跑起来。
 *
 * 前置：openxmlhelper 已编译
 *   dotnet build openxmlhelper/src/OpenXmlHelper/OpenXmlHelper.csproj
 * 运行（必须 Electron 主进程）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     --disable-gpu --no-sandbox scripts/validation/openxml-helper.cjs
 *
 * 输出目录：.trellis/tasks/09-17-openbid-recovery-acceptance/validation/openxml-helper/<时间戳>/
 * 硬约束：绝不写入 docs/ai_generated，源 workspace 只读（复制到隔离目录再跑）。
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
  'openxml-helper',
);

/** 用于验证的真实 docx（都在仓库 docs/ 下，不在 app workspace 内，需要拷进去）。 */
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
    from: path.join(
      WORKSPACE_ROOT,
      'docs',
      'raw_bids',
      '赛鼎工程',
      '赛鼎 宁波 历史标书内容模板.docx',
    ),
  },
];

const assertions = [];
const knownLimitations = [];
const cleanOnExit = [];

/** 收尾清理隔离目录。删不掉也不算失败——那几 MB 无关痛痒，真正的坑是以前那份 535MB 副本。 */
function cleanupIsolatedDirs() {
  for (const dir of cleanOnExit) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 忽略：清理失败不影响结论 */
    }
  }
}

process.on('exit', cleanupIsolatedDirs);

function assertion(name, expected, actual, pass, note = '') {
  assertions.push({ name, expected: String(expected), actual: String(actual), pass, note });
  const line = `  ${pass ? 'PASS' : 'FAIL'} ${name} (期望 ${expected} / 实际 ${actual})${note ? ` :: ${note}` : ''}`;
  process.stdout.write(`${line}\n`);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 名字是否能在上下文里找到「标签依据」。
 *
 * 判据是名字在上下文里以某一种标签形态出现：
 *   ① 后面跟冒号——「采购编号：▁▁」
 *   ② 被一对括号包着——「▁▁（谈判日期）」
 *   ③ 就是本列的表头——「本列表头：编列内容」
 *   ④ 紧跟在「第N列：」后面——表格同行标签
 *   ⑤ 形如「列名（行标签）」的合成名，两段各自成立即可
 *
 * 反例（改动前会通过不了）：名字「你方在」来自句子开头，上下文里虽然出现，
 * 但既不跟冒号也不在括号里，也不是表头，因此被判为凭空截取。
 */
function isAnchoredName(name, context) {
  const flat = (s) => String(s || '').replace(/\s+/g, '');
  const nm = flat(name).trim();
  if (!nm) return true;
  if (/^第\d+列$/.test(nm)) return false;

  const ctx = flat(context);
  if (ctx.includes(`${nm}：`) || ctx.includes(`${nm}:`)) return true;
  if (ctx.includes(`（${nm}）`) || ctx.includes(`(${nm})`)) return true;
  if (ctx.includes(`本列表头：${nm}`)) return true;
  if (new RegExp(`第\\d+列：${escapeRegExp(nm)}`).test(ctx)) return true;

  const combo = /^(.+?)（(.+)）$/.exec(String(name).trim());
  if (combo) {
    return isAnchoredName(combo[1], context) || isAnchoredName(combo[2], context);
  }
  return false;
}

async function main() {
  const { app } = require('electron');
  if (!app?.setPath) throw new Error('必须在 Electron 主进程下运行');

  const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'openxml-helper-'));
  const isoWorkspace = path.join(iso, 'workspace');
  // 隔离 workspace 只需要一个空目录。
  //
  // 以前这里把 %APPDATA%/yibiao-client/workspace 整个复制过来（约 535MB，含图片库、
  // 知识库、历史模板、mermaid 缓存），但助手只按「工作区相对路径」解析我们传进去的
  // 那几份 docx，别的目录一概不读（服务侧只用 getWorkspaceDir(app)，不碰数据库）。
  // 实测连跑十几次就把 C 盘写满——一次 ENOSPC 直接让脚本连第一行输出都写不出来。
  // 现在改成空目录 + 收尾自清，单次占用降到几 MB。
  fs.mkdirSync(isoWorkspace, { recursive: true });
  cleanOnExit.push(iso);

  // 把待验证的 docx 拷进隔离 workspace（助手只接受 workspace 相对路径）
  const sourceDir = 'diag-sources';
  fs.mkdirSync(path.join(isoWorkspace, sourceDir), { recursive: true });
  const placed = {};
  for (const s of SOURCES) {
    if (!fs.existsSync(s.from)) {
      process.stdout.write(`  SKIP ${s.label}（源文件不存在：${s.from}）\n`);
      continue;
    }
    const rel = `${sourceDir}/${path.basename(s.from)}`;
    fs.copyFileSync(s.from, path.join(isoWorkspace, rel));
    placed[s.key] = rel;
  }

  fs.mkdirSync(OUT_BASE, { recursive: true });
  const outDir = path.join(OUT_BASE, new Date().toISOString().replace(/[:.]/g, '-'));
  if (outDir.includes(path.join('docs', 'ai_generated'))) {
    throw new Error('禁止把验证输出写入 docs/ai_generated');
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '.gitignore'), '*\n');
  process.stdout.write(`\n[stage] 隔离 workspace -> ${isoWorkspace}\n`);
  process.stdout.write(`[stage] 输出目录 -> ${outDir}\n`);

  app.setPath('userData', iso);
  await app.whenReady();

  const { createOpenXmlHelperService } = require(
    path.join(CLIENT_DIR, 'electron', 'services', 'openXmlHelperService.cjs'),
  );
  const service = createOpenXmlHelperService({ app });
  const jobRoot = path.join(isoWorkspace, 'openxml-jobs');

  try {
    // 1) ping：助手能否拉起
    process.stdout.write('\n[stage] ping\n');
    let pingOk = false;
    let pingError = '';
    try {
      const ping = await service.runJob({ action: 'ping', timeoutMs: 60_000 });
      pingOk = ping?.ok === true;
      process.stdout.write(`  ping result: ${JSON.stringify(ping)}\n`);
    } catch (error) {
      pingError = String(error?.message || error);
      process.stdout.write(`  ping 失败: ${pingError}\n`);
    }
    assertion('Open XML 助手可启动（ping）', 'ok:true', pingOk ? 'ok:true' : `失败 ${pingError}`, pingOk);

    if (!pingOk) {
      fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), assertions }, null, 2)}\n`, 'utf8');
      process.stdout.write(`\n报告：${outDir}\n`);
      return;
    }

    // 2) list-blocks：能否列出招标文件的块结构
    if (placed.tender) {
      process.stdout.write('\n[stage] list-blocks（招标文件）\n');
      const result = await service.runJob({
        action: 'list-blocks',
        request: { sources: [placed.tender] },
        timeoutMs: 300_000,
      });
      const blocksFile = path.join(jobRoot, result?.job_id || '', 'blocks.json');
      // job id 未知时兜底扫描最近的任务目录
      const blocks = findLatestJobFile(jobRoot, 'blocks.json');
      const payload = blocks ? readJsonSafe(blocks) : readJsonSafe(blocksFile);
      const sources = payload?.sources || [];
      const totalBlocks = sources.reduce((sum, s) => sum + (s.blocks?.length || 0), 0);
      const headings = sources.flatMap((s) => (s.blocks || []).filter((b) => b.heading));
      process.stdout.write(`  result: ${JSON.stringify(result)}\n`);
      process.stdout.write(`  块数 ${totalBlocks}，其中标题块 ${headings.length}\n`);
      for (const h of headings.slice(0, 18)) {
        process.stdout.write(`    [L${h.outline_level ?? '-'}] ${String(h.text || '').slice(0, 46)}\n`);
      }
      assertion('招标文件块结构可解析', '> 0 块', `${totalBlocks} 块`, totalBlocks > 0);
      assertion('能识别出标题块', '> 0 个', `${headings.length} 个`, headings.length > 0);
      if (blocks) fs.copyFileSync(blocks, path.join(outDir, 'tender-blocks.json'));
    }

    // 3) scan-template-fields：能否扫出待填候选
    if (placed.contentTemplate) {
      process.stdout.write('\n[stage] scan-template-fields（历史标书内容模板）\n');
      const result = await service.runJob({
        action: 'scan-template-fields',
        request: { input: placed.contentTemplate },
        timeoutMs: 300_000,
      });
      process.stdout.write(`  result: ${JSON.stringify(result)}\n`);
      const candFile = findLatestJobFile(jobRoot, 'template-field-candidates.json');
      const payload = candFile ? readJsonSafe(candFile) : null;
      const candidates = payload?.candidates || payload?.fields || [];
      process.stdout.write(`  候选数 ${Array.isArray(candidates) ? candidates.length : 0}\n`);
      for (const c of (Array.isArray(candidates) ? candidates : []).slice(0, 12)) {
        process.stdout.write(`    ${c.candidate_id || c.id || '-'}  ${String(c.suggested_name || c.name || c.preview || '').slice(0, 40)}\n`);
      }
      assertion('模板待填候选可扫描', '> 0 个', `${Array.isArray(candidates) ? candidates.length : 0} 个`, Array.isArray(candidates) && candidates.length > 0);
      if (candFile) fs.copyFileSync(candFile, path.join(outDir, 'template-field-candidates.json'));
    }

    // 4) extract-chapters：按块区间抽章，验证版式（样式/页眉页脚/表格）是否带过来
    if (placed.tender) {
      process.stdout.write('\n[stage] extract-chapters（抽章 + 版式保留）\n');
      const sourceDocx = path.join(isoWorkspace, placed.tender);
      const sourceParts = inspectDocx(sourceDocx);
      const outputRel = `${sourceDir}/bid-template-extracted.docx`;
      const result = await service.runJob({
        action: 'extract-chapters',
        request: {
          sources: [placed.tender],
          chapters: [
            { id: '1', title: '响应函', startBlock: 566, endBlock: 583 },
            { id: '2', title: '法定代表人身份证明或附有法定代表人身份证明的授权委托书', startBlock: 584, endBlock: 623 },
            // 624–662 是「资格审查资料」，区间内含 1 张表（块 627 申请人基本情况表），
            // 用来验证表格也随章节带出。
            { id: '3', title: '资格审查资料', startBlock: 624, endBlock: 662 },
          ],
          output: outputRel,
        },
        timeoutMs: 300_000,
      });
      process.stdout.write(`  result: ${JSON.stringify(result)}\n`);
      process.stdout.write(
        `  源文档：部件 ${sourceParts.names.length}，页眉 ${sourceParts.headerParts}，页脚 ${sourceParts.footerParts}，`
        + `styles ${sourceParts.styleCount}，表格 ${sourceParts.tableCount}\n`,
      );
      const outDocx = path.join(isoWorkspace, outputRel);
      const exists = fs.existsSync(outDocx);
      assertion('抽章产物已生成', '存在', exists ? `${fs.statSync(outDocx).size} 字节` : '缺失', exists);

      if (exists) {
        fs.copyFileSync(outDocx, path.join(outDir, 'bid-template-extracted.docx'));
        const out = inspectDocx(outDocx);
        process.stdout.write(
          `  产物：部件 ${out.names.length}，页眉 ${out.headerParts}，页脚 ${out.footerParts}，`
          + `styles ${out.styleCount}，表格 ${out.tableCount}，段落 ${out.paragraphCount}\n`,
        );
        assertion('抽出的章节含目标正文', '响应函/授权委托书/法定代表人 齐全',
          `响应函=${out.hasResponseLetter} 委托书=${out.hasPoA} 法定代表人=${out.hasLegalRep}`,
          out.hasResponseLetter && out.hasPoA && out.hasLegalRep);
        assertion('保留样式表（styles.xml）', '非空', `${out.styleCount} 个样式`, out.hasStyles);
        assertion('页眉/页脚部件不丢失', `源 ${sourceParts.headerParts}/${sourceParts.footerParts}`,
          `产物 ${out.headerParts}/${out.footerParts}`,
          out.headerParts >= sourceParts.headerParts && out.footerParts >= sourceParts.footerParts);
        assertion('包内部件不丢失', `源 ${sourceParts.names.length}`, `产物 ${out.names.length}`,
          out.names.length >= sourceParts.names.length);
        assertion('含表格的章节带出表格', '> 0 个', `${out.tableCount} 个`, out.tableCount > 0);
      }
    }

    // 5) scan-template-fields + apply-template-fields：在模板上原位写 w:sdt，版式一点不动
    // OPENXML_TEST_TEMPLATE 可切换用哪份模板跑（默认招标文件；contentTemplate = 历史标书内容模板）
    const applySourceKey = process.env.OPENXML_TEST_TEMPLATE === 'contentTemplate' ? 'contentTemplate' : 'tender';
    if (placed[applySourceKey]) {
      process.stdout.write(`\n[stage] scan-template-fields（模板=${applySourceKey}，找待填点）\n`);
      const scan = await service.runJob({
        action: 'scan-template-fields',
        request: { input: placed[applySourceKey] },
        timeoutMs: 300_000,
      });
      process.stdout.write(`  result: ${JSON.stringify(scan)}\n`);
      const candFile = findLatestJobFile(jobRoot, 'template-field-candidates.json');
      const candidates = (candFile && readJsonSafe(candFile)?.candidates) || [];
      process.stdout.write(`  待填候选 ${candidates.length} 个\n`);
      for (const c of candidates.slice(0, 14)) {
        process.stdout.write(
          `    ${c.candidate_id}  kind=${c.kind}  建议名=${c.suggested_name || '-'}  文=${String(c.text || '').replace(/\s+/g, ' ').slice(0, 34)}\n`,
        );
      }
      assertion('模板待填候选可扫描', '> 0 个', `${candidates.length} 个`, candidates.length > 0);
      if (candFile) fs.copyFileSync(candFile, path.join(outDir, 'tender-field-candidates.json'));

      // 噪音三项不变量。这三条守的是 2026-09-20 的三处扫描器改动：
      // 一颗都不许漂回去——否则候选会重新膨胀到 408 个、且目录控件会再被当字段。
      const structural = candidates.filter((c) => c.kind === 'existing-content-control');
      assertion('目录等结构性控件不再作为候选', '0 个', `${structural.length} 个`, structural.length === 0,
        structural.slice(0, 3).map((c) => String(c.text || '').slice(0, 24)).join(' | '));

      const noLabelCells = candidates.filter(
        (c) => c.kind === 'empty-table-cell' && !String(c.context || '').trim(),
      );
      assertion('同行无标签的空单元格不再作为候选', '0 个', `${noLabelCells.length} 个`, noLabelCells.length === 0);

      // 去重口径同步实现：表格按「行」、段落按「段」，且空名字不参与按名去重
      // （否则同一范围里几个都叫不出名字的候选会被并成一个，那是丢信息）。
      const dupScope = (c) => (c.kind === 'empty-table-cell'
        ? String(c.location || '').replace(/\/cell\/\d+\/p\/\d+$/, '')
        : String(c.location || '').replace(/\/run\/\d+$/, ''));
      const nameSeen = new Map();
      for (const c of candidates) {
        const name = String(c.suggested_name || '').trim();
        if (!name) continue;
        const key = `${dupScope(c)}||${name}`;
        nameSeen.set(key, (nameSeen.get(key) || 0) + 1);
      }
      const dupNames = [...nameSeen.values()].filter((n) => n > 1).length;
      assertion('同一范围内同字段名不再重复', '0 组', `${dupNames} 组`, dupNames === 0);

      // 命名质量四条不变量。
      //
      // 这一组守的是「名字必须是真标签」这个性质。改动前扫描器在取不到标签时会
      // 「按标点切段取最后一段」兜底，产出一批散文碎片——「你方在」「我方已经仔细阅读」
      // 「若成交我方将以此作为提供第」之类，实测 20 多个，会把模板分类直接带偏。
      // 现在取不到就留空，因此下面这几条都能守住。
      const named = candidates.filter((c) => String(c.suggested_name || '').trim());
      const pureColumn = named.filter((c) => /^第\d+列$/.test(String(c.suggested_name).trim()));
      assertion('没有「第N列」这类纯列号名字', '0 个', `${pureColumn.length} 个`, pureColumn.length === 0,
        pureColumn.slice(0, 3).map((c) => String(c.suggested_name)).join(' | '));

      const tooLong = named.filter((c) => String(c.suggested_name).trim().length > 20);
      assertion('名字长度不超过 20 字', '0 个', `${tooLong.length} 个`, tooLong.length === 0,
        tooLong.slice(0, 2).map((c) => `${String(c.suggested_name).slice(0, 30)}…(${String(c.suggested_name).length})`).join(' | '));

      // 字段名不会带逗号句号分号，带上就说明它是从句子里截出来的。
      // 顿号「、」不算：它是枚举分隔符，「组织机构、技术力量等」这样的一串名词
      // 本身就是合法的提示语（原文档里就写在括号里）。
      const sentenceLike = named.filter((c) => /[，。；]/.test(String(c.suggested_name)));
      assertion('名字不含句子标点', '0 个', `${sentenceLike.length} 个`, sentenceLike.length === 0,
        sentenceLike.slice(0, 3).map((c) => String(c.suggested_name)).join(' | '));

      // 核心一条：每个名字都必须能在上下文里以「标签形态」找到落脚点——
      // 地名前有冒号、被括号包着、是表头列名、或紧跟在「第N列：」后面。
      // 找不到就说明它是凭空截出来的碎片。
      const unanchored = named.filter((c) => !isAnchoredName(c.suggested_name, c.context));
      const namedRatio = candidates.length ? ((named.length / candidates.length) * 100).toFixed(0) : '0';
      assertion('每个名字都能在上下文里找到标签依据', '0 个', `${unanchored.length} 个`, unanchored.length === 0,
        unanchored.slice(0, 4).map((c) => `${String(c.suggested_name)} ← ${String(c.context).slice(0, 34)}`).join(' | '));

      process.stdout.write(
        `  候选总数 ${candidates.length}（改动前为 408）；有名字 ${named.length} 个（${namedRatio}%）、`
        + `空名 ${candidates.length - named.length} 个（取不到可靠标签就留空，交由分类环节判断）\n`,
      );

      if (candidates.length > 0) {
        // 助手要求每个候选恰好归入 fields 或 ignored_candidate_ids。
        // 这里只给「有建议名」的前若干候选命名，其余全部忽略——真实流程由模板 Agent 分类。
        // OPENXML_TEST_KIND 可限定只命名某一类候选，用于二分定位写入器的问题。
        const kindFilter = String(process.env.OPENXML_TEST_KIND || '').trim();
        const eligible = kindFilter ? candidates.filter((c) => c.kind === kindFilter) : candidates;
        // OPENXML_TEST_NOOP=1：一个字段都不命名（全部忽略）。写入器不做任何改动，
        // 此时若校验仍失败，说明错误来自源文档本身而不是写入器。
        const noop = process.env.OPENXML_TEST_NOOP === '1';
        const named = noop ? [] : eligible.filter((c) => String(c.suggested_name || '').trim()).slice(0, 6);
        process.stdout.write(
          `  命中类别 ${kindFilter || '(全部)'}，命名 ${named.length} 个`
          + `${noop ? '（NOOP：全部忽略）' : `：${named.map((c) => c.kind).join(',')}`}\n`,
        );
        const fields = named.map((c) => ({
          candidate_id: c.candidate_id,
          name: String(c.suggested_name).trim(),
          fill_by: c.suggested_fill_by === 'manual' ? 'manual' : 'ai',
        }));
        const namedIds = new Set(fields.map((f) => f.candidate_id));
        const ignored = candidates.filter((c) => !namedIds.has(c.candidate_id)).map((c) => c.candidate_id);

        process.stdout.write(`\n[stage] apply-template-fields（命名 ${fields.length} 个，忽略 ${ignored.length} 个）\n`);
        const applyRel = `${sourceDir}/bid-template-fields.docx`;
        const fieldsRel = `${sourceDir}/bid-template-fields.json`;
        let applied = null;
        let applyError = '';
        try {
          applied = await service.runJob({
            action: 'apply-template-fields',
            request: {
              input: placed[applySourceKey],
              output: applyRel,
              fields_output: fieldsRel,
              fields,
              ignored_candidate_ids: ignored,
            },
            timeoutMs: 300_000,
          });
        } catch (error) {
          applyError = String(error?.message || error);
        }
        process.stdout.write(`  result: ${applied ? JSON.stringify(applied) : `失败 ${applyError}`}\n`);
        assertion('原位填字段写入成功', 'ok:true', applied?.ok === true ? 'ok:true' : applyError.slice(0, 160), applied?.ok === true);

        const applyDocx = path.join(isoWorkspace, applyRel);
        const exists = fs.existsSync(applyDocx);
        assertion('原位填字段产物已生成', '存在', exists ? `${fs.statSync(applyDocx).size} 字节` : '缺失', exists);

        if (exists) {
          fs.copyFileSync(applyDocx, path.join(outDir, 'bid-template-fields.docx'));
          const fieldsFile = path.join(isoWorkspace, fieldsRel);
          if (fs.existsSync(fieldsFile)) fs.copyFileSync(fieldsFile, path.join(outDir, 'bid-template-fields.json'));

          const out = inspectDocx(applyDocx);
          const srcParts = inspectDocx(path.join(isoWorkspace, placed[applySourceKey]));
          // 候选分两类落地：已有内容控件是「原地更新」，其余是「新建 sdt」。
          const existingCount = named.filter((c) => c.kind === 'existing-content-control').length;
          const createdCount = fields.length - existingCount;
          const expectedSdt = srcParts.sdtCount + createdCount;
          process.stdout.write(
            `  产物：部件 ${out.names.length}，页眉 ${out.headerParts}，页脚 ${out.footerParts}，`
            + `sdt ${out.sdtCount}（源 ${srcParts.sdtCount} + 新建 ${createdCount}），`
            + `字段标签 ${out.fieldTags.length}，底色样本 ${JSON.stringify([...new Set(out.fieldShadings)].slice(0, 3))}\n`,
          );
          process.stdout.write(`  字段名：${JSON.stringify(out.fieldAliases.slice(0, 8))}\n`);

          assertion('写入了 w:sdt 内容控件', `= ${expectedSdt} 个`, `${out.sdtCount} 个`, out.sdtCount === expectedSdt);
          assertion('字段带 yibiao:field 标签', `= ${fields.length} 个`,
            `${out.fieldTags.filter((t) => t.startsWith('yibiao:field:')).length} 个`,
            out.fieldTags.filter((t) => t.startsWith('yibiao:field:')).length === fields.length);
          // 新建的 sdt 才能同时拿到 alias：更新已有的 docPartObj 控件（目录）只落 tag，
          // 且其原内容会被占位段落替换——真实流程里模板 Agent 会把这类控件归入忽略。
          const aliasExpected = named
            .filter((c) => c.kind !== 'existing-content-control')
            .map((c) => String(c.suggested_name).trim());
          assertion('新建字段名写入 w:alias',
            aliasExpected.join('/'),
            out.fieldAliases.join('/'),
            aliasExpected.every((name) => out.fieldAliases.includes(name)));
          assertion('字段用淡红底 FCE8E6 标记', '含 FCE8E6', [...new Set(out.fieldShadings)].join(',') || '无',
            out.fieldShadings.includes('FCE8E6'));
          assertion('原位填写不丢部件（版式不动）', `源 ${srcParts.names.length}`,
            `产物 ${out.names.length}`,
            out.names.length >= srcParts.names.length);
          assertion('原位填写不动页眉页脚', `源 ${srcParts.headerParts}/${srcParts.footerParts}`,
            `产物 ${out.headerParts}/${out.footerParts}`,
            out.headerParts === srcParts.headerParts && out.footerParts === srcParts.footerParts);
          assertion('原位填写不动表格数', `源 ${srcParts.tableCount}`, `产物 ${out.tableCount}`,
            out.tableCount === srcParts.tableCount);

          if (existingCount > 0) {
            knownLimitations.push(
              `更新已有的 docPartObj 控件（目录，${existingCount} 个）时只写入 w:tag，不写 w:alias/w:id，`
              + '且原控件内容会被占位段落替换。真实流程应把这类控件归入 ignored_candidate_ids。',
            );
          }
        }
      }
    }

    fs.writeFileSync(
      path.join(outDir, 'report.json'),
      `${JSON.stringify({ generated_at: new Date().toISOString(), isolated_workspace: isoWorkspace, placed, assertions, known_limitations: knownLimitations }, null, 2)}\n`,
      'utf8',
    );
    const passed = assertions.filter((a) => a.pass).length;
    process.stdout.write(`\n断言：PASS ${passed} / FAIL ${assertions.length - passed}\n`);
    for (const item of knownLimitations) process.stdout.write(`已知限制：${item}\n`);
    process.stdout.write(`报告：${outDir}\n`);
  } finally {
    await service.close().catch(() => {});
  }

  app.exit(0);
}

/** 检查抽章产物的包内部件，确认样式/页眉页脚/编号/表格是否随章节带出。 */
function inspectDocx(file) {
  const AdmZip = require(path.join(CLIENT_DIR, 'node_modules', 'adm-zip'));
  const zip = new AdmZip(file);
  const names = zip.getEntries().map((entry) => entry.entryName);
  const read = (name) => {
    const entry = zip.getEntry(name);
    return entry ? entry.getData().toString('utf8') : '';
  };
  const documentXml = read('word/document.xml');
  const stylesXml = read('word/styles.xml');
  const tags = [...documentXml.matchAll(/<w:tag\s+w:val="([^"]*)"/g)].map((m) => m[1]);
  const aliases = [...documentXml.matchAll(/<w:alias\s+w:val="([^"]*)"/g)].map((m) => m[1]);
  return {
    names,
    documentXml,
    hasStyles: stylesXml.length > 0,
    styleCount: (stylesXml.match(/<w:style /g) || []).length,
    hasNumbering: names.includes('word/numbering.xml'),
    headerParts: names.filter((name) => /^word\/header\d*\.xml$/.test(name)).length,
    footerParts: names.filter((name) => /^word\/footer\d*\.xml$/.test(name)).length,
    tableCount: (documentXml.match(/<w:tbl>/g) || []).length,
    paragraphCount: (documentXml.match(/<w:p[ >]/g) || []).length,
    hasResponseLetter: documentXml.includes('响应函'),
    hasPoA: documentXml.includes('授权委托书'),
    hasLegalRep: documentXml.includes('法定代表人'),
    sdtCount: (documentXml.match(/<w:sdt>/g) || []).length,
    fieldTags: tags,
    fieldAliases: aliases,
    fieldShadings: [...documentXml.matchAll(/<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase()),
  };
}

/** 在 openxml-jobs 下找最近一次任务写出的指定文件。 */
function findLatestJobFile(jobRoot, fileName) {
  try {
    const jobs = fs
      .readdirSync(jobRoot)
      .map((name) => ({ name, stat: fs.statSync(path.join(jobRoot, name)) }))
      .filter((entry) => entry.stat.isDirectory())
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    for (const job of jobs) {
      const candidate = path.join(jobRoot, job.name, fileName);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
