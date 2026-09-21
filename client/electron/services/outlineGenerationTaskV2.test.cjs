const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createInitialPrompt,
  createScorePlanningPrompt,
  createChildrenPrompt,
  enforceMinimumLeafTarget,
  readJson,
  createEmptyScoreDirectoryPlan,
} = require('./outlineGenerationTaskV2.cjs');

test('独立成册模式直接以技术评分大项作为一级目录', () => {
  const prompt = createInitialPrompt('按响应文件要求生成。', { standaloneTechnical: true });

  assert.match(prompt, /一级目录必须直接对应技术评分大项/);
  assert.match(prompt, /不得创建“技术方案”“项目管理方案”“监理大纲”“监理大纲（暗标）”“施工组织设计”“技术标”/);
  assert.match(prompt, /不得加入商务、资信、投标函、授权委托书/);
});

test('独立成册评分规划把根节点固定为评分项层级', () => {
  const prompt = createScorePlanningPrompt({ standaloneTechnical: true });

  assert.match(prompt, /score_item_level 固定为 1/);
  assert.match(prompt, /target_title 必须与 root_title 完全一致/);
  assert.match(prompt, /不得再创建“技术方案”“项目管理方案”“监理大纲”“监理大纲（暗标）”“施工组织设计”“技术标”/);
});

test('独立成册生成子目录时不重复评分项根标题', () => {
  const prompt = createChildrenPrompt({
    hasOriginalPlan: false,
    originalOnly: false,
    targetLeafCount: 10,
    allowRootChanges: false,
    standaloneTechnical: true,
  });

  assert.match(prompt, /现有一级根节点本身就是评分项映射节点/);
  assert.match(prompt, /不得在根节点下面再次生成同名评分项/);
  assert.doesNotMatch(prompt, /"title":"技术方案"/);
});

test('完整目录生成必须以 Bid Plan 技术主题作为覆盖权威清单', () => {
  const prompt = createChildrenPrompt({
    hasOriginalPlan: false,
    originalOnly: false,
    targetLeafCount: 20,
    allowRootChanges: false,
    standaloneTechnical: false,
  });

  assert.match(prompt, /bid-plan\.json/);
  assert.match(prompt, /technical_topics/);
  assert.match(prompt, /不得只复制响应文件格式或技术评分项/);
});

test('独立成册末级小节目标至少覆盖每个技术分支', () => {
  assert.equal(enforceMinimumLeafTarget(10, 0, 6), 10);
  assert.equal(enforceMinimumLeafTarget(14, 0, 6), 14);
  assert.equal(enforceMinimumLeafTarget(4, 0, 6), 6);
  assert.equal(enforceMinimumLeafTarget(10, 2, 5), 10);
  assert.equal(enforceMinimumLeafTarget(null, 0, 6), null);
  assert.equal(enforceMinimumLeafTarget(2, 0, 1, {
    maximumWords: 4000,
    sectionWords: 3000,
    strictSectionWords: true,
  }), 1);
  assert.throws(
    () => enforceMinimumLeafTarget(4, 0, 6, {
      maximumWords: 4000,
      sectionWords: 1000,
      strictSectionWords: true,
    }),
    /最多容纳 5 个 AI 生成小节，但独立成册目录至少需要 6 个/,
  );
});

// 回归：score-planning 阶段曾因未预置 score-directory-plan.json，
// 使 readJson 读到空内容并抛出裸的 "Unexpected end of JSON input"。
test('空文件报出可操作的缺失提示，而不是裸 JSON.parse 异常', () => {
  assert.throws(
    () => readJson('', 'score-directory-plan.json'),
    (error) => {
      assert.match(error.message, /score-directory-plan\.json 内容为空/);
      assert.match(error.message, /Agent 未写入该文件/);
      assert.doesNotMatch(error.message, /Unexpected end of JSON input/);
      return true;
    },
  );
  assert.throws(
    () => readJson('   \n  ', 'technical-score-groups.json'),
    /technical-score-groups\.json 内容为空/,
  );
});

test('预置的空评分规划骨架是 Schema 允许的合法起点', () => {
  const plan = createEmptyScoreDirectoryPlan();
  assert.deepEqual(plan, { allow_root_changes: false, branches: [], extra_titles: [] });
  assert.equal(typeof plan.allow_root_changes, 'boolean');
  assert.ok(Array.isArray(plan.branches));
  assert.ok(Array.isArray(plan.extra_titles));
  // 骨架必须能被读回，覆盖此前的崩溃路径。
  assert.deepEqual(readJson(JSON.stringify(plan), 'score-directory-plan.json'), plan);
});
