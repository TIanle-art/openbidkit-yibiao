#!/usr/bin/env node
/**
 * 统一单元测试入口（只读、隔离）。
 *
 * 背景：本项目未配置 npm test 脚本，单测散落在 client/electron 与 client/scripts 下的
 * *.test.cjs，需用项目自带 Electron 运行时以 ELECTRON_RUN_AS_NODE=1 执行（否则会拉起 GUI）。
 *
 * 用法：cd client && node scripts/validation/run-unit-tests.cjs
 * 退出码：0 = 全部通过；非 0 = 有失败（与 electron --test 一致）。
 * 安全：仅执行测试文件；测试自身使用 mkdtemp/临时 userData，不写真实 %APPDATA%\\yibiao-client。
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CLIENT_ROOT = path.resolve(__dirname, '..', '..');
// 在纯 Node 进程中 require('electron') 返回 electron.exe 的绝对路径。
const electronPath = require('electron');

const SKIP_DIRS = new Set(['node_modules', '.git', 'release', 'release-build', 'dist', '.trellis']);

function collect(dir, re, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(path.join(dir, entry.name), re, acc);
    } else if (entry.isFile() && re.test(entry.name)) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

const cjsRoots = ['electron', 'scripts']
  .map((name) => path.join(CLIENT_ROOT, name))
  .filter((p) => fs.existsSync(p));
// src 下存在 ESM 单元测试（*.test.mjs，纯逻辑不依赖 Electron），旧入口只收集 *.test.cjs 会漏跑。
const mjsRoots = ['src', 'electron', 'scripts']
  .map((name) => path.join(CLIENT_ROOT, name))
  .filter((p) => fs.existsSync(p));

const cjsTests = [...new Set(cjsRoots.flatMap((root) => collect(root, /\.test\.cjs$/, [])))].sort();
const mjsTests = [...new Set(mjsRoots.flatMap((root) => collect(root, /\.test\.mjs$/, [])))].sort();
if (cjsTests.length === 0 && mjsTests.length === 0) {
  console.error('[run-unit-tests] 未找到任何 *.test.cjs / *.test.mjs，判为失败');
  process.exit(2);
}

console.log('[run-unit-tests] 使用 Electron: ' + electronPath);
console.log('[run-unit-tests] 收集到 ' + cjsTests.length + ' 个 *.test.cjs + ' + mjsTests.length + ' 个 *.test.mjs');

let status = 0;
if (cjsTests.length > 0) {
  const res = spawnSync(electronPath, ['--test', ...cjsTests, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: CLIENT_ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  if (res.status !== 0) status = res.status == null ? 1 : res.status;
}
if (mjsTests.length > 0) {
  const res2 = spawnSync(process.execPath, ['--test', ...mjsTests, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: CLIENT_ROOT,
    env: { ...process.env },
  });
  if (res2.status !== 0) status = res2.status == null ? 1 : res2.status;
}
process.exit(status);
