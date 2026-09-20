const test = require('node:test');
const assert = require('node:assert');
const {
  CATEGORY,
  buildApplyRequest,
  buildSectionAnchors,
  classifyTemplateCandidates,
  compactText,
  extractSectionNumber,
  findResponseSectionStart,
  findSectionAnchor,
  isManualFill,
  isSectionAnchor,
  parseBlockIndex,
  resolveFillBy,
} = require('./templateFieldClassifier.cjs');

/**
 * 一份被压缩过的招标文件块结构，只保留分类要用的骨架：
 * 514 之前是采购方内容（目录、申请人须知、评审办法、成交通知书），
 * 514「第六章 响应文件格式」之后是投标人要填的格式。
 */
const BLOCKS = [
  { index: 91, heading: true, text: '第二章 申请人须知' },
  { index: 96, heading: false, text: '编列内容' },
  { index: 299, heading: true, text: '附件二：成交通知书' },
  { index: 514, heading: true, text: '第六章 响应文件格式' },
  { index: 566, heading: false, text: '1．响应函' },
  { index: 625, heading: false, text: '3.1 申请人基本情况表' },
  { index: 645, heading: false, text: '3.5 近五年同类物资供货业绩表' },
  { index: 761, heading: false, text: '10.谈判承诺书' },
  { index: 781, heading: false, text: '13.技术偏离表' },
];

function candidate(overrides = {}) {
  return {
    candidate_id: 'c_test',
    kind: 'underlined-space',
    location: 'body/999:p/0',
    text: '',
    context: '',
    suggested_name: '',
    suggested_fill_by: 'ai',
    ...overrides,
  };
}

function classifyOne(overrides) {
  const result = classifyTemplateCandidates({ candidates: [candidate(overrides)], blocks: BLOCKS });
  return result.items[0];
}

test('块号能从 location 里解析出来', () => {
  assert.equal(parseBlockIndex('body/627:tbl/row/0/cell/1/p/0'), 627);
  assert.equal(parseBlockIndex('body/96:tbl/row/1/cell/2/p/0'), 96);
  assert.equal(parseBlockIndex('缺少块号'), -1);
});

test('汉字之间的排版空格会被合并，英文单词间的空格保留', () => {
  assert.equal(compactText('技 术 响 应 文 件'), '技术响应文件');
  assert.equal(compactText('Name of Bidder'), 'Name of Bidder');
});

test('标题锚点：短标题算锚点，带冒号或过长的正文不算', () => {
  assert.equal(isSectionAnchor({ heading: false }, '1．响应函'), true);
  assert.equal(isSectionAnchor({ heading: false }, '3.5 近五年同类物资供货业绩表'), true);
  assert.equal(isSectionAnchor({ heading: false }, '（1） 制造厂名称：'), false);
  assert.equal(isSectionAnchor({ heading: false }, '24'), false);
  assert.equal(
    isSectionAnchor({ heading: false }, '1.我们将按要求及时向谈判小组提交响应文件中所有复印件的原件。'),
    false,
  );
});

test('分区起点取「响应文件格式」，候选据此判断落在哪个区', () => {
  const anchors = buildSectionAnchors(BLOCKS);
  assert.equal(findResponseSectionStart(anchors), 514);
  assert.equal(findSectionAnchor(anchors, 627).text, '3.1 申请人基本情况表');
  assert.equal(findSectionAnchor(anchors, 540).text, '第六章 响应文件格式');
});

test('目录条目判为忽略（历史上这类噪声被当成字段）', () => {
  const item = classifyOne({
    location: 'body/96:tbl/row/1/cell/2/p/0',
    suggested_name: '编列内容（总则）',
    context: '本列表头：编列内容；第1列：1；第2列：总则',
  });
  assert.equal(item.category, CATEGORY.IGNORE);
  assert.match(item.reason, /目录条目/);
});

test('目录续表（没有表头）的条目同样判为忽略', () => {
  const item = classifyOne({
    location: 'body/99:tbl/row/19/cell/2/p/0',
    suggested_name: '谈判和评审',
    context: '第1列：6；第2列：谈判和评审',
  });
  assert.equal(item.category, CATEGORY.IGNORE);
  assert.match(item.reason, /目录条目/);
});

test('数据表里首列是数字的行不会被误当成目录', () => {
  const item = classifyOne({
    location: 'body/627:tbl/row/1/cell/1/p/0',
    suggested_name: '注册地址',
    context: '第1列：注册地址；第3列：邮政编码',
  });
  assert.equal(item.category, CATEGORY.TENDERER_FILL);
});

test('采购方内容区的条款空位判为忽略，且标记待人工确认', () => {
  const item = classifyOne({
    location: 'body/105:p/0',
    suggested_name: '',
    context: '自提交响应文件截止之日起算 90 天。',
  });
  assert.equal(item.category, CATEGORY.IGNORE);
  assert.equal(item.needs_review, true);
});

test('采购方内容区里的采购编号判为招标方信息', () => {
  const item = classifyOne({
    location: 'body/150:p/0',
    suggested_name: '采购编号',
    context: '关于贵方 采购谈判采购文件（采购编号为： ）',
  });
  assert.equal(item.category, CATEGORY.BUYER_INFO);
});

test('响应函里的采购编号是招标方信息，不由投标人自造', () => {
  const item = classifyOne({
    location: 'body/569:p/0',
    suggested_name: '采购编号',
    context: '我方已经仔细阅读 采购（采购编号： ）谈判文件',
  });
  assert.equal(item.category, CATEGORY.BUYER_INFO);
  // 这条曾经断言 'ai'，而 instruction 又写着「照抄原文，不得编造」——
  // 标签与说明打架，下游按 fill_by === 'ai' 调模型时，采购编号就被编出来了。
  // 现在归 'copy'：值取自招标文件原文，根本不经过模型。
  assert.equal(item.fill_by, 'copy');
  assert.notEqual(item.fill_by, 'ai');
  assert.match(item.instruction, /照抄/);
});

test('业绩表里的「采购人名称」是投标人的客户，判为投标人待填', () => {
  const item = classifyOne({
    location: 'body/647:tbl/row/2/cell/1/p/0',
    suggested_name: '采购人名称',
    context: '第1列：采购人名称',
  });
  assert.equal(item.category, CATEGORY.TENDERER_FILL);
  assert.match(item.reason, /投标人信息小节/);
});

test('偏离表里的采购编号仍是招标方信息，不被「整节都是投标人信息」带偏', () => {
  const item = classifyOne({
    location: 'body/782:p/0',
    suggested_name: '采购编号',
    context: '采购编号： ',
  });
  assert.equal(item.category, CATEGORY.BUYER_INFO);
  assert.match(item.reason, /项目标识/);
});

test('申请人基本情况表里的信息判为投标人待填', () => {
  const item = classifyOne({
    location: 'body/627:tbl/row/0/cell/1/p/0',
    suggested_name: '申请人名称',
    context: '第1列：申请人名称',
  });
  assert.equal(item.category, CATEGORY.TENDERER_FILL);
});

test('签字与盖章类判为人工填写', () => {
  const signed = classifyOne({ location: 'body/579:p/0', suggested_name: '申请人名称（公章）' });
  assert.equal(signed.fill_by, 'manual');
  assert.match(signed.instruction, /人工签署/);

  const signature = classifyOne({
    location: 'body/561:p/0',
    suggested_name: '法定代表人或其委托代理人',
    context: '法定代表人或其委托代理人： （签字）',
  });
  assert.equal(signature.fill_by, 'manual');
});

test('落款日期判人工，企业登记信息判 profile（不是让 AI 编）', () => {
  assert.equal(isManualFill('日期', '日期： 年 月 日'), true);
  assert.equal(isManualFill('成立时间', '成立时间： 年 月 日'), false);

  assert.equal(resolveFillBy('成立时间', '成立时间： 年 月 日'), 'profile');
  assert.equal(resolveFillBy('姓名', ''), 'profile');
  assert.equal(resolveFillBy('申请人名称', ''), 'profile');
  assert.equal(resolveFillBy('注册资金', ''), 'profile');
  // 人工优先于 profile：法定代表人姓名取自资料库，但「签字」那一栏必须人动手。
  assert.equal(resolveFillBy('法定代表人签字或盖章', ''), 'manual');
  assert.equal(resolveFillBy('法定代表人身份证号码', ''), 'manual');
  // 要成段写的才是 AI：项目描述、组织机构技术力量这类。
  assert.equal(resolveFillBy('项目描述', ''), 'ai');
  assert.equal(resolveFillBy('其他情况', ''), 'ai');
});

test('成交通知书整节不进白名单（投标人不提交这份文书）', () => {
  const item = classifyOne({
    location: 'body/307:p/0',
    suggested_name: '成交价',
    context: '成交价： 元。',
  });
  assert.equal(item.category, CATEGORY.IGNORE);
  assert.match(item.reason, /招标方出具的文书/);
});

test('取不到名字的空位不猜、不进白名单，但都标复核（不是静默丢）', () => {
  const result = classifyTemplateCandidates({
    candidates: [
      // 日期数字之间的排版空格——曾被当过一次「待填字段」，写下去把整行切碎了
      candidate({
        candidate_id: 'c_1',
        kind: 'underlined-space',
        location: 'body/671:p',
        text: '  ',
        suggested_name: '',
        context: '（5） 近期资产负债表（到 2024 年 12 月 31 日止）',
      }),
      // 真空位但取不到标签：不猜名字，交人工确认
      candidate({
        candidate_id: 'c_2',
        kind: 'underlined-space',
        location: 'body/569:p',
        text: '____________________',
        suggested_name: '',
        context: '文件中对申请方的约束。我方愿意参加 （标段包）的响应',
      }),
    ],
    blocks: BLOCKS,
  });

  assert.ok(result.items.every((item) => item.category === CATEGORY.IGNORE));
  assert.ok(result.items.every((item) => item.needs_review));
  assert.match(result.items[0].reason, /排版空格/);
  assert.match(result.items[1].reason, /交人工确认/);

  // 忽略不等于凭空消失：仍然逐条出现在忽略清单里，复核时看得到。
  const request = buildApplyRequest(result);
  assert.equal(request.fields.length, 0);
  assert.deepEqual(request.ignored_candidate_ids, ['c_1', 'c_2']);
});

test('「致」这类提示词会被规范成字段名', () => {
  const result = classifyTemplateCandidates({
    candidates: [candidate({ candidate_id: 'c_1', location: 'body/568:p/0', suggested_name: '致', context: '致： ' })],
    blocks: BLOCKS,
  });
  assert.equal(result.items[0].category, CATEGORY.BUYER_INFO);
  assert.equal(result.items[0].name, '采购人名称');
  assert.equal(buildApplyRequest(result).fields[0].name, '采购人名称');
});

test('同名但语义不同的字段会加上小节编号前缀，避免 apply 拒绝', () => {
  const result = classifyTemplateCandidates({
    candidates: [
      candidate({ candidate_id: 'c_1', location: 'body/647:tbl/row/0/cell/1/p/0', suggested_name: '项目名称', context: '第1列：项目名称' }),
      candidate({ candidate_id: 'c_2', location: 'body/569:p/0', suggested_name: '项目名称', context: '我方愿意参加 （标段包）的响应，本项目名称为 （项目名称）' }),
    ],
    blocks: BLOCKS,
  });
  const names = result.items.map((item) => item.name || item.suggested_name);
  assert.equal(names[0], '3.5 项目名称');
  assert.equal(names[1], '1 项目名称');
  assert.ok(result.items.every((item) => item.name_adjusted));
});

test('小节编号提取：数字编号、附件、章各取各的', () => {
  assert.equal(extractSectionNumber('3.5 近五年同类物资供货业绩表'), '3.5');
  assert.equal(extractSectionNumber('附件二：成交通知书'), '附件二');
  assert.equal(extractSectionNumber('第六章 响应文件格式'), '第六章');
  assert.equal(extractSectionNumber('响应函'), '');
});

test('文档没有「响应文件格式」分区时，带标签的空位仍按待填点处理', () => {
  const result = classifyTemplateCandidates({
    candidates: [
      candidate({
        candidate_id: 'c_a',
        kind: 'text-placeholder',
        location: 'body/4:p',
        text: '____________________',
        suggested_name: '申请人',
        context: '申请人：____________________  （盖单位章）',
      }),
      candidate({
        candidate_id: 'c_b',
        kind: 'existing-content-control',
        location: 'body/9:sdt',
        text: 'TOC \\h \\o "1-3"',
        suggested_name: '目录',
        context: 'TOC \\h \\o "1-3"',
      }),
    ],
    blocks: [{ index: 0, heading: false, text: '历史标书内容模板' }],
  });
  assert.equal(result.response_section_start, -1);
  assert.equal(result.items[0].category, CATEGORY.TENDERER_FILL);
  assert.equal(result.items[0].fill_by, 'manual');
  assert.equal(result.items[1].category, CATEGORY.IGNORE);
  assert.match(result.items[1].reason, /目录域/);
});

test('apply 请求覆盖全部候选：字段与忽略互不重叠，且合起来不漏', () => {
  const result = classifyTemplateCandidates({
    candidates: [
      candidate({ candidate_id: 'c_1', location: 'body/627:tbl/row/0/cell/1/p/0', suggested_name: '申请人名称', context: '第1列：申请人名称' }),
      candidate({ candidate_id: 'c_2', location: 'body/96:tbl/row/1/cell/2/p/0', suggested_name: '编列内容（总则）', context: '本列表头：编列内容；第1列：1；第2列：总则' }),
      candidate({ candidate_id: 'c_3', location: 'body/569:p/0', suggested_name: '采购编号', context: '采购编号： ' }),
    ],
    blocks: BLOCKS,
  });
  const request = buildApplyRequest(result);
  assert.deepEqual(request.fields.map((item) => item.candidate_id), ['c_1', 'c_3']);
  assert.deepEqual(request.ignored_candidate_ids, ['c_2']);

  const all = result.items.map((item) => item.candidate_id);
  assert.deepEqual(
    [...request.fields.map((item) => item.candidate_id), ...request.ignored_candidate_ids].sort(),
    [...all].sort(),
  );
  // 四类来源都要在这里：少了 copy 就等于允许「采购编号交给模型编」这种情况溜过去。
  assert.ok(
    request.fields.every((item) => item.name && ['ai', 'manual', 'profile', 'copy'].includes(item.fill_by)),
  );
});
