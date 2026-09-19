/**
 * 验收脚本共享夹具（只读，不写入任何交付目录）
 *
 * 夹具按赛鼎 NC2060 标段的结构伪造，字段与真实链路一致；
 * 目的是让每条 AC 都能在不调用外部模型、不启动 Electron 的前提下复现。
 */

const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.resolve(__dirname, '..');
// client/scripts/validation -> client -> OpenBidKit_Yibiao -> apps -> 工作区根
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

const PROJECT = {
  projectName: '赛鼎工程有限公司 NC2060 起重设备采购',
  packageName: 'NC2060.EQP.P01.90-037 起重设备',
  tenderName: 'NC2060.EQP.P01.90-037 起重设备 技术评分',
};

const GUAGUI_PROJECT = {
  projectName: '石家庄高新技术产业开发区能源岛项目中速磨煤机用过轨起重机设备采购',
  packageName: '磨煤机过轨吊',
};

const TENDER_MARKDOWN = [
  '# 招标文件（节选）',
  '',
  '## 第三章 供货范围',
  '',
  '| 设备名称 | 规格型号 | 数量 | 单位 |',
  '| --- | --- | --- | --- |',
  '| 电动葫芦 | LD5t | 2 | 台 |',
  '| 起升机构 | NC2060-QS | 1 | 套 |',
  '',
  '## 第五章 技术规格',
  '',
  '起升高度 12m，工作级别 A5，起升速度 8m/min。',
  '',
  '## 响应文件要求',
  '',
  '1. 投标函（必须提供）',
  '2. 法定代表人身份证明（必须提供）',
  '3. 近两年财务状况表（必须提供）',
  '4. 技术偏离表（必须提供）',
  '5. 联合体协议书（如适用）',
].join('\n');

const RESPONSE_FILE_REQUIREMENTS = TENDER_MARKDOWN.slice(TENDER_MARKDOWN.indexOf('## 响应文件要求'));

function buildOutline(overrides = {}) {
  const outline = overrides.outline || [
    { id: '1', title: '投标函', technical_topic_ids: [], content: '投标函正文，完全响应招标文件全部要求。'.repeat(12) },
    { id: '2', title: '法定代表人身份证明', technical_topic_ids: [], content: '法定代表人身份证明文件内容齐全。'.repeat(12) },
    { id: '3', title: '近两年财务状况表', technical_topic_ids: [], content: '近两年财务状况良好，资产负债率处于合理区间。'.repeat(12) },
    { id: '4', title: '技术偏离表', technical_topic_ids: ['T1', 'T2'], content: '起升高度 12m，工作级别 A5，无偏离。'.repeat(12) },
  ];
  return { outline };
}

function buildBidPlan() {
  return {
    technical_topics: [
      { id: 'T1', title: '起升机构', recommended_section: '技术偏离表', keywords: ['起升高度'] },
      { id: 'T2', title: '工作级别与速度', recommended_section: '技术偏离表', keywords: ['工作级别'] },
    ],
    required_tables: ['technical_deviation'],
    procurement_targets: [
      { name: 'LD5t 电动葫芦', model: 'LD5t', quantity: '2', unit: '台', category: 'equipment' },
      { name: 'NC2060-QS 起升机构', model: 'NC2060-QS', quantity: '1', unit: '套', category: 'equipment' },
    ],
  };
}

function buildParameterRegistry(confirmed = true) {
  return {
    parameters: [
      {
        key: 'lifting_height',
        label: '起升高度',
        tender_requirement: '起升高度 12m',
        bid_value: confirmed ? '12m' : '',
        status: confirmed ? 'CONFIRMED' : 'PENDING',
      },
    ],
  };
}

function buildContentPlans() {
  return {
    4: {
      plan: {
        evidence_pack: {
          sources: [{ content: '招标文件第五章：起升高度 12m，工作级别 A5，起升速度 8m/min。' }],
        },
      },
    },
  };
}

/**
 * 现有正式交付 DOCX（docs/ai_generated，只读输入，禁止写入）
 * 按文件名推断所属项目上下文：石家庄/磨煤机/过轨吊 属于 guagui 项目本身，
 * 其余按赛鼎项目判定，避免把「复刻石家庄项目」的合法内容误判为污染。
 */
function inferProjectContext(name) {
  return /石家庄|磨煤机|过轨吊/.test(name) ? GUAGUI_PROJECT : PROJECT;
}

function listDeliverableDocx() {
  const aiGenerated = path.join(WORKSPACE_ROOT, 'docs', 'ai_generated');
  if (!fs.existsSync(aiGenerated)) return [];
  return fs.readdirSync(aiGenerated)
    .filter((name) => /\.docx$/i.test(name) && !/^\~/.test(name))
    .map((name) => ({ name, file: path.join(aiGenerated, name), context: inferProjectContext(name) }));
}

module.exports = {
  REPO_ROOT,
  WORKSPACE_ROOT,
  PROJECT,
  GUAGUI_PROJECT,
  TENDER_MARKDOWN,
  RESPONSE_FILE_REQUIREMENTS,
  buildOutline,
  buildBidPlan,
  buildParameterRegistry,
  buildContentPlans,
  listDeliverableDocx,
  inferProjectContext,
};
