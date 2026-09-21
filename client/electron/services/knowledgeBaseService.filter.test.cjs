const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('./knowledgeBaseService.cjs');

test('短表格、列表和键值参数不被 too_short 过滤', () => {
  const result = _internals.filterBlocks([
    { id: 'R1', type: 'table', heading_path: ['商务要求'], content: '| 项目 | 要求 |\n|---|---|\n| 质保期 | 3年 |' },
    { id: 'R2', type: 'list', heading_path: [], content: '- 交货后30日内验收' },
    { id: 'R3', type: 'paragraph', heading_path: [], content: '截止时间：2026年10月1日' },
    { id: 'R4', type: 'paragraph', heading_path: [], content: '普通短句' },
  ]);

  assert.deepEqual(result.blocks.map((item) => item.content), [
    '| 项目 | 要求 |\n|---|---|\n| 质保期 | 3年 |',
    '- 交货后30日内验收',
    '截止时间：2026年10月1日',
  ]);
  assert.equal(result.filtered_blocks[0].reason, 'too_short');
});

test('覆盖率只统计真正进入知识条目的 block', () => {
  const report = _internals.createReport({
    blocks: [{ id: 'P1' }, { id: 'P2' }],
    filteredBlocks: [],
    candidateItems: [{}],
    finalItems: [{}],
    matches: [{ id: 'K1', block_ids: ['P1'] }],
    discarded: [],
    systemDiscarded: [{ block_ids: ['P2'] }],
    recoveryAttempts: [],
    batchSize: 1,
  });

  assert.equal(report.coverage_rate, 0.5);
  assert.equal(report.matched_rate, 0.5);
});
