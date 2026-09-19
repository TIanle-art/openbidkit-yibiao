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

async function main() {
  const { app } = require('electron');
  if (!app?.setPath) throw new Error('必须在 Electron 主进程下运行');

  const realUserData = path.join(process.env.APPDATA || '', 'yibiao-client');
  const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'openxml-helper-'));
  const isoWorkspace = path.join(iso, 'workspace');
  fs.cpSync(path.join(realUserData, 'workspace'), isoWorkspace, { recursive: true });

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

    fs.writeFileSync(
      path.join(outDir, 'report.json'),
      `${JSON.stringify({ generated_at: new Date().toISOString(), isolated_workspace: isoWorkspace, placed, assertions }, null, 2)}\n`,
      'utf8',
    );
    const passed = assertions.filter((a) => a.pass).length;
    process.stdout.write(`\n断言：PASS ${passed} / FAIL ${assertions.length - passed}\n报告：${outDir}\n`);
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
  return {
    names,
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
