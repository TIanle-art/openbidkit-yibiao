#!/usr/bin/env node
/**
 * 运行 AC1–AC9 验收检查，并把证据写入隔离输出目录。
 *
 * 默认输出：.trellis/tasks/09-17-openbid-recovery-acceptance/validation/<时间戳>/
 * 硬约束：绝不写入 docs/ai_generated 或任何现有交付件（R5）。
 */

const fs = require('node:fs');
const path = require('node:path');

const { checks } = require('./checks.cjs');

// client/scripts/validation -> client -> OpenBidKit_Yibiao -> apps -> 工作区根
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const DEFAULT_OUT = path.join(WORKSPACE_ROOT, '.trellis', 'tasks', '09-17-openbid-recovery-acceptance', 'validation');

function resolveOutDir() {
  const argIndex = process.argv.indexOf('--out');
  const target = argIndex >= 0 && process.argv[argIndex + 1]
    ? path.resolve(process.argv[argIndex + 1])
    : path.join(DEFAULT_OUT, new Date().toISOString().replace(/[:.]/g, '-'));
  if (target.includes(path.join('docs', 'ai_generated'))) {
    throw new Error('禁止把验证输出写入 docs/ai_generated');
  }
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function renderMarkdown(results, summary) {
  const lines = [];
  lines.push('# AC1–AC9 验收执行结果');
  lines.push('');
  lines.push(`- 生成时间：${summary.generated_at}`);
  lines.push(`- 输出目录：${summary.output_dir}`);
  lines.push(`- 状态统计：PASS ${summary.counts.PASS} / PARTIAL ${summary.counts.PARTIAL} / MANUAL-REQUIRED ${summary.counts['MANUAL-REQUIRED']} / BLOCKED ${summary.counts.BLOCKED} / FAIL ${summary.counts.FAIL}`);
  lines.push('');
  lines.push('| AC | 能力 | 状态 | 通过断言 | 总断言 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const item of results) {
    const passed = item.assertions.filter((entry) => entry.pass).length;
    lines.push(`| ${item.ac} | ${item.title} | ${item.status} | ${passed} | ${item.assertions.length} |`);
  }
  lines.push('');
  for (const item of results) {
    lines.push(`## ${item.ac} · ${item.title}`);
    lines.push('');
    lines.push(`- 状态：**${item.status}**`);
    lines.push(`- 方法：${item.method}`);
    lines.push('');
    lines.push('| 断言 | 期望 | 实际 | 结果 |');
    lines.push('| --- | --- | --- | --- |');
    for (const entry of item.assertions) {
      lines.push(`| ${entry.name} | ${entry.expected} | ${entry.actual} | ${entry.pass ? 'PASS' : 'FAIL'} |`);
    }
    if (item.notes?.length) {
      lines.push('');
      for (const note of item.notes) lines.push(`> ${note}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const outputDir = resolveOutDir();
  const results = [];
  for (const check of checks) {
    try {
      results.push(check());
    } catch (error) {
      results.push({
        ac: 'UNKNOWN',
        title: '检查执行异常',
        status: 'FAIL',
        method: String(error.stack || error.message),
        assertions: [],
        notes: [`检查脚本抛出异常：${error.message}`],
        evidence: [],
      });
    }
  }

  const counts = { PASS: 0, PARTIAL: 0, FAIL: 0, BLOCKED: 0, 'MANUAL-REQUIRED': 0 };
  for (const item of results) counts[item.status] = (counts[item.status] || 0) + 1;

  const summary = { generated_at: new Date().toISOString(), output_dir: outputDir, counts, results };
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'report.md'), renderMarkdown(results, summary), 'utf8');
  // 输出目录自忽略：验证产物不进入版本控制，也不参与交付（R5 / AC7）
  fs.writeFileSync(path.join(outputDir, '.gitignore'), '*\n', 'utf8');

  for (const item of results) {
    const passed = item.assertions.filter((entry) => entry.pass).length;
    process.stdout.write(`${item.ac} ${item.status} (${passed}/${item.assertions.length}) ${item.title}\n`);
  }
  process.stdout.write(`\n报告：${outputDir}\n`);
}

main();
