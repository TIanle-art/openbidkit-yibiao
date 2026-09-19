const test = require('node:test');
const assert = require('node:assert');
const { detectContamination, evaluateContaminationGate, HISTORICAL_FACT_RULES } = require('./contaminationGuard.cjs');

const SADING_CONTEXT = {
  projectName: '赛鼎工程有限公司 NC2060 起升机构设备采购',
  packageName: 'NC2060.EQP.P01.90-037 起重设备',
};

const GUAGUI_CONTEXT = {
  projectName: '石家庄高新技术产业开发区能源岛项目中速磨煤机用过轨起重机设备采购',
  packageName: '磨煤机过轨吊',
};

test('无关项目出现历史事实词时判定为阻断', () => {
  const result = detectContamination('本方案选用中速磨煤机专用过轨起重机，满足大修起吊要求。', SADING_CONTEXT);
  assert.equal(result.clean, false);
  assert.equal(result.blockers.length, 2);
  assert.ok(result.blockers.every((item) => item.severity === 'blocker'));
  assert.ok(result.blockers.some((item) => item.term === '磨煤机'));
  assert.ok(result.blockers.some((item) => /过轨/.test(item.term)));
});

test('当前项目本身就是该历史项目时按上下文豁免', () => {
  const result = detectContamination('本项目为中速磨煤机用过轨起重机设备采购，位于石家庄能源岛。', GUAGUI_CONTEXT);
  assert.equal(result.clean, true);
  assert.equal(result.blockers.length, 0);
  assert.ok(result.exempted.length >= 3);
  assert.ok(result.exempted.every((item) => item.severity === 'info'));
});

test('六个既定污染词全部可检出', () => {
  const terms = ['磨煤机', '过轨吊', '球磨机', '直吹式制粉', '锅炉稳燃', '石家庄项目'];
  for (const term of terms) {
    const result = detectContamination(`本标段技术方案涉及${term}相关内容。`, SADING_CONTEXT);
    assert.equal(result.clean, false, `未检出污染词：${term}`);
  }
});

test('每条规则至少覆盖一个既定术语', () => {
  const covered = new Set(HISTORICAL_FACT_RULES.flatMap((rule) => rule.terms));
  for (const term of ['磨煤机', '球磨机', '直吹式制粉', '锅炉稳燃', '石家庄']) {
    assert.ok(covered.has(term), `规则集缺少术语：${term}`);
  }
});

test('多段内容可定位到具体章节', () => {
  const result = detectContamination([
    { id: 'sec-1', title: '总体方案', content: '设备布置合理。' },
    { id: 'sec-2', title: '技术方案', content: '本设备配套球磨机系统。' },
  ], SADING_CONTEXT);
  assert.equal(result.scanned_segments, 2);
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].section_id, 'sec-2');
  assert.equal(result.blockers[0].rule_id, 'ball_mill');
  assert.match(result.blockers[0].context, /球磨机/);
});

test('无污染内容返回 clean', () => {
  const result = detectContamination('起升机构采用变频控制，额定起重量满足招标文件要求。', SADING_CONTEXT);
  assert.equal(result.clean, true);
  assert.equal(result.blockers.length, 0);
});

test('嵌套子章节中的污染同样能被扫到', () => {
  const result = detectContamination([
    { id: '1', title: '第一章 概述', content: '本章说明供货范围。', children: [
      { id: '1-1', title: '1.1 制粉系统', content: '配套球磨机一台。' },
    ] },
  ], SADING_CONTEXT);
  assert.equal(result.clean, false);
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].section_id, '1-1');
  assert.equal(result.scanned_segments, 2);
});

test('空内容不产生误报', () => {
  assert.equal(detectContamination('', SADING_CONTEXT).clean, true);
  assert.equal(detectContamination([], SADING_CONTEXT).clean, true);
  assert.equal(detectContamination(null, SADING_CONTEXT).clean, true);
});

test('交付闸门在污染时阻断并给出原因', () => {
  const gate = evaluateContaminationGate('供货范围包含球磨机一台。', SADING_CONTEXT);
  assert.equal(gate.blocked, true);
  assert.equal(gate.severity, 'blocker');
  assert.match(gate.reason, /禁止导出交付/);

  const cleanGate = evaluateContaminationGate('供货范围包含起升机构一套。', SADING_CONTEXT);
  assert.equal(cleanGate.blocked, false);
  assert.equal(cleanGate.severity, 'none');
});
