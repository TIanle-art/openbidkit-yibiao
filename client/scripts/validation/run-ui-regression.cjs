#!/usr/bin/env node
/**
 * 统一「真实界面回归」编排入口（单命令、可判定、留证）。
 *
 * 背景：仓库已有 CDP 直连能力（cdp-inspect.cjs）与两个界面驱动脚本
 * （content-version-ui-drive.js / workspace-project-drive.js），但都是**手动多步**：
 * 先播种、再手动启动真实应用、再 cdp-inspect 求值、再回读。既不可在 CI 里一条命令跑，
 * 也无法自动产出 PASS/FAIL 与截图。本脚本把这条链收敛成一个命令：
 *
 *   1) 用隔离 userData（os.tmpdir 下唯一目录）播种测试数据；
 *   2) 用隔离 userData + 随机回环端口启动**真实 Electron 应用**（GUI）；
 *   3) 通过 CDP 在真实渲染进程里执行**真实点击/输入**（复用已有驱动脚本）；
 *   4) 采集渲染层 console / 未捕获异常 / 页面截图；
 *   5) 关闭应用后回读数据库，确认交互结果**已落库**；
 *   6) 输出 report.json + ui-final.png，全部断言通过 exit 0，否则 exit 1。
 *
 * 与既有 e2e 的区别：e2e-front-half/full-chain/bid-flow 在 Electron 主进程里跑业务编排、
 * 不驱动界面；本脚本驱动的是**用户真正点击的渲染层**，经真实 preload→IPC→主进程服务。
 *
 * 安全边界：--user-data-dir 指向临时目录，绝不读写 %APPDATA%\yibiao-client；
 * 不联网；不读写真实标书/真实数据库；不接触生产凭据。
 *
 * 用法：cd client && npm run test:ui
 *       node scripts/validation/run-ui-regression.cjs [--out=<目录>] [--keep]
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const CLIENT_ROOT = path.resolve(__dirname, '..', '..');
const electronPath = require('electron');
const DRIVE_FILE = path.join(__dirname, 'content-version-ui-drive.js');
const FIXTURE = path.join(__dirname, 'content-version-ui.cjs');

function argValue(name, fallback) {
  const hit = process.argv.find((item) => item.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const OUT_DIR = path.resolve(argValue('out', path.join(os.tmpdir(), 'yibiao-ui-regression-' + Date.now())));
const USER_DATA = path.join(OUT_DIR, 'userdata');
const KEEP = process.argv.includes('--keep');
const SPAWN_TIMEOUT_MS = Number(argValue('timeout', '90000'));
const EVAL_TIMEOUT_MS = Number(argValue('eval-timeout', '60000'));

fs.mkdirSync(OUT_DIR, { recursive: true });
const report = {
  scenario: 'content-version-restore',
  generated_at: new Date().toISOString(),
  user_data: USER_DATA,
  assertions: [],
  console: [],
  page_exceptions: [],
  db: null,
  screenshot: null,
  errors: [],
};

function addAssertion(name, expected, actual, pass, note) {
  report.assertions.push({ name, expected, actual, pass: Boolean(pass), note: note || '' });
  console.log('  ' + (pass ? 'PASS' : 'FAIL') + ' ' + name + '（期望 ' + expected + ' / 实际 ' + actual + '）');
  return Boolean(pass);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function runFixture(action) {
  const res = spawnSync(electronPath, [FIXTURE, '--action=' + action, '--user-data=' + USER_DATA], {
    cwd: CLIENT_ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 60000,
  });
  const raw = (res.stdout || '').trim();
  try { return JSON.parse(raw); } catch (e) {
    throw new Error('fixture(' + action + ') 输出无法解析: ' + raw.slice(0, 400) + ' / stderr=' + (res.stderr || '').slice(0, 400));
  }
}

async function fetchTargets(port) {
  const res = await fetch('http://127.0.0.1:' + port + '/json/list');
  return res.json();
}

async function waitForPageTarget(port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const targets = await fetchTargets(port);
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl
        && (/index\.html/.test(t.url) || t.url === 'about:blank' || t.url.startsWith('file:')));
      if (page) return page;
    } catch {}
    await sleep(300);
  }
  throw new Error('等待 CDP page target 超时（' + timeoutMs + 'ms）');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 极简 CDP 客户端：按 id 关联响应；同时接收 Runtime/Log 事件用于留证。
class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.onEvent = () => {};
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('CDP 连接超时')), 15000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
      ws.addEventListener('error', (ev) => { clearTimeout(timer); reject(new Error('CDP WS 错误: ' + (ev.message || 'unknown'))); });
      ws.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message + ' (' + msg.error.code + ')')); else res(msg.result);
        } else if (msg.method) {
          this.onEvent(msg.method, msg.params || {});
        }
      });
    });
  }
  send(method, params, timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP ' + method + ' 超时')); }, timeoutMs || 30000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

function killTree(child) {
  if (!child || child.killed) return;
  try { child.kill(); } catch {}
  try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
}

async function main() {
  console.log('[ui-regression] out=' + OUT_DIR);
  console.log('[ui-regression] 隔离 userData=' + USER_DATA);

  // 1) 播种隔离数据
  const seed = runFixture('seed');
  console.log('[ui-regression] seed: version_count=' + seed.version_count + ' node_content=' + JSON.stringify(seed.node_content));
  addAssertion('seed_version_count>=2', '>=2', String(seed.version_count), Number(seed.version_count) >= 2);
  addAssertion('seed_content_is_ai', 'AI 重新生成的正文', String(seed.node_content), seed.node_content === 'AI 重新生成的正文');

  // 2) 启动真实应用（隔离 userData + 随机回环端口）
  const port = await freePort();
  console.log('[ui-regression] 启动 Electron，remote-debugging-port=' + port);
  const appEnv = { ...process.env };
  delete appEnv.ELECTRON_RUN_AS_NODE; // 关键：需要真实 GUI 主进程
  appEnv.ELECTRON_DISABLE_SECURITY_WARNINGS = '1';
  const child = spawn(electronPath, [
    '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + USER_DATA,
    '--remote-debugging-port=' + port,
    // 网络隔离：把所有域名解析为 NOTFOUND，远程公告/更新检查会立即失败并被应用优雅忽略，
    // 从而保证回归不联网、不引入线上公告弹窗、结果可重复（本用例只依赖本地 SQLite）。
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '.',
  ], { cwd: CLIENT_ROOT, env: appEnv, stdio: ['ignore', 'pipe', 'pipe'] });

  const appOutPath = path.join(OUT_DIR, 'electron-stdout.log');
  const appErrPath = path.join(OUT_DIR, 'electron-stderr.log');
  const outStream = fs.createWriteStream(appOutPath);
  const errStream = fs.createWriteStream(appErrPath);
  child.stdout.pipe(outStream);
  child.stderr.pipe(errStream);
  let appExited = false;
  let appExitCode = null;
  child.on('exit', (code) => { appExited = true; appExitCode = code; });

  let cdp = null;
  try {
    const page = await waitForPageTarget(port, SPAWN_TIMEOUT_MS);
    console.log('[ui-regression] page target: ' + page.url);

    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.connect();
    cdp.onEvent = (method, params) => {
      if (method === 'Runtime.consoleAPICalled') {
        const text = (params.args || []).map((a) => (a.value !== undefined ? a.value : a.description || a.type)).join(' ');
        report.console.push({ type: params.type, text: String(text) });
      } else if (method === 'Runtime.exceptionThrown') {
        const d = params.exceptionDetails || {};
        report.page_exceptions.push({ text: d.text, description: d.exception && d.exception.description });
      } else if (method === 'Log.entryAdded' && params.entry) {
        report.console.push({ type: 'log.' + params.entry.level, text: params.entry.text });
      }
    };
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');

    // 3) 等待渲染层挂载（body 有内容）
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const r = await cdp.send('Runtime.evaluate', { expression: 'document.body ? document.body.innerText.length : 0', returnByValue: true });
      if ((r.result && Number(r.result.value)) > 20) { ready = true; break; }
      await sleep(500);
    }
    addAssertion('renderer_ready', 'true', String(ready), ready);

    // 4) 在真实渲染进程执行真实交互（复用已有驱动脚本）
    const expr = fs.readFileSync(DRIVE_FILE, 'utf8');
    const evalRes = await cdp.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true, userGesture: true,
    }, EVAL_TIMEOUT_MS);
    if (evalRes.exceptionDetails) {
      throw new Error('页面内异常：' + (evalRes.exceptionDetails.exception && evalRes.exceptionDetails.exception.description || evalRes.exceptionDetails.text));
    }
    const parsed = JSON.parse(evalRes.result.value);
    const log = {};
    for (const line of (parsed.log || [])) {
      const i = line.indexOf('=');
      if (i > 0) log[line.slice(0, i)] = line.slice(i + 1);
    }
    console.log('[ui-regression] 界面驱动日志:');
    for (const k of Object.keys(log)) console.log('    ' + k + ' = ' + log[k]);
    fs.writeFileSync(path.join(OUT_DIR, 'drive-result.json'), JSON.stringify(parsed, null, 2), 'utf8');

    // 5) 断言（来自真实交互返回）
    const isTrue = (v) => v === 'true' || v === 'True';
    addAssertion('ui_step05', 'true', String(log.step05), isTrue(log.step05));
    addAssertion('ui_content_before_is_ai', 'true', String(log.contentBeforeIsAi), isTrue(log.contentBeforeIsAi));
    addAssertion('ui_open_version_button', 'true', String(log.openBtn), isTrue(log.openBtn));
    addAssertion('ui_dialog_opened', 'true', String(log.dialogOpened), isTrue(log.dialogOpened));
    addAssertion('ui_version_items>=2', '>=2', String(log.versionItems), Number(log.versionItems) >= 2);
    addAssertion('ui_has_manual_tag', 'true', String(log.hasManualTag), isTrue(log.hasManualTag));
    addAssertion('ui_manual_item_found', 'true', String(log.manualItemFound), isTrue(log.manualItemFound));
    addAssertion('ui_restore_btn_enabled', 'true & disabled=false', String(log.restoreBtnPresent), /^true/.test(String(log.restoreBtnPresent)) && String(log.restoreBtnPresent).includes('disabled=false'));
    addAssertion('ui_body_shows_manual_content', 'true', String(log.bodyShowsManualContent), isTrue(log.bodyShowsManualContent));
    addAssertion('ui_restore_version_listed', 'true', String(log.restoreVersionListed), isTrue(log.restoreVersionListed));
    addAssertion('ui_versions_after>=3', '>=3', String(log.versionsAfterRestore), Number(log.versionsAfterRestore) >= 3);

    // 5.5) 截图前清理可能遮挡的远程公告浮层（网络已隔离，正常应为 0；此处只做防御）
    const prepExpr = '(async () => {' +
      'const cards = Array.from(document.querySelectorAll(".remote-notice-card"));' +
      'for (const c of cards) { const b = Array.from(c.querySelectorAll("button")).find(x => x.textContent.trim() === "知道了"); if (b) b.click(); }' +
      'await new Promise(r => setTimeout(r, 400));' +
      'return JSON.stringify({ noticeCards: document.querySelectorAll(".remote-notice-card").length });' +
      '})()';
    let prep = { noticeCards: 0 };
    try {
      const prepRes = await cdp.send('Runtime.evaluate', { expression: prepExpr, returnByValue: true, awaitPromise: true }, 15000);
      if (prepRes.result && prepRes.result.value) prep = JSON.parse(prepRes.result.value);
    } catch (e) { report.errors.push('公告浮层清理失败: ' + e.message); }
    addAssertion('no_remote_notice_overlay', '0', String(prep.noticeCards), Number(prep.noticeCards) === 0);
    const noticeLogs = report.console.filter((x) => /remote-notice/.test(x.text)).length;
    console.log('[ui-regression] 远程公告 console 行数（应因网络隔离失败）= ' + noticeLogs);
    report.network_isolation = { blocked: true, remote_notice_console_lines: noticeLogs };

    // 6) 截图留证
    try {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, 15000);
      const shotPath = path.join(OUT_DIR, 'ui-final.png');
      fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
      report.screenshot = shotPath;
      console.log('[ui-regression] 截图: ' + shotPath);
    } catch (e) {
      report.errors.push('截图失败: ' + e.message);
    }
  } finally {
    if (cdp) cdp.close();
    killTree(child);
    await sleep(800);
    console.log('[ui-regression] 应用退出：exited=' + appExited + ' code=' + appExitCode);
  }

  // 7) 关闭后回读数据库，确认交互已落库（不是只在内存里显示）
  const readback = runFixture('read');
  report.db = readback;
  console.log('[ui-regression] 回读: node_content=' + JSON.stringify(readback.node_content) + ' version_count=' + readback.version_count);
  addAssertion('db_content_restored_to_manual', '人工写的正文（初版）', String(readback.node_content), readback.node_content === '人工写的正文（初版）');
  addAssertion('db_version_count>=3', '>=3', String(readback.version_count), Number(readback.version_count) >= 3);

  // 8) 汇总
  const passed = report.assertions.filter((a) => a.pass).length;
  const failed = report.assertions.length - passed;
  report.summary = { total: report.assertions.length, passed, failed, page_exceptions: report.page_exceptions.length };
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('\n[ui-regression] 汇总: ' + passed + '/' + report.assertions.length + ' 通过, ' + failed + ' 失败, 页面异常 ' + report.page_exceptions.length);
  console.log('[ui-regression] 证据目录: ' + OUT_DIR);

  if (failed > 0 || report.page_exceptions.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  report.errors.push(String(error && error.stack || error));
  try { fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8'); } catch {}
  console.error('[ui-regression] fatal: ' + (error && error.stack || error));
  process.exit(1);
});
