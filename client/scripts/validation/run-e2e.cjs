#!/usr/bin/env node
/**
 * 统一 e2e 入口（真实 Electron 主进程）。
 *
 * 三条 e2e 必须用真实 Electron GUI 主进程运行，因此必须 **清除** ELECTRON_RUN_AS_NODE
 * （全局若设为 1 会让 Electron 当 Node 跑、导致 GUI 行为失效/假失败）。
 *
 * 用法：cd client && node scripts/validation/run-e2e.cjs
 * 退出码：0 = 全部 exit 0；非 0 = 有脚本失败。
 */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLIENT_ROOT = path.resolve(__dirname, '..', '..');
const electronPath = require('electron');

const SCRIPTS = ['e2e-front-half.cjs', 'e2e-full-chain.cjs', 'e2e-bid-flow.cjs'];

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // 关键：e2e 需要真实 GUI 主进程

let failed = 0;
const summary = [];
for (const name of SCRIPTS) {
  const file = path.join(__dirname, name);
  console.log('\n===== ' + name + ' =====');
  const res = spawnSync(electronPath, [file], { stdio: 'inherit', cwd: CLIENT_ROOT, env });
  const code = res.status == null ? 1 : res.status;
  console.log('[run-e2e] ' + name + ' -> exit ' + code);
  summary.push({ name, code });
  if (code !== 0) failed += 1;
}

console.log('\n===== e2e 汇总 =====');
for (const item of summary) console.log('  ' + (item.code === 0 ? 'PASS' : 'FAIL') + '  ' + item.name + ' (exit ' + item.code + ')');
if (failed > 0) {
  console.error('[run-e2e] ' + failed + ' 个 e2e 脚本非零退出');
  process.exit(1);
}
console.log('[run-e2e] 全部 e2e 通过');
