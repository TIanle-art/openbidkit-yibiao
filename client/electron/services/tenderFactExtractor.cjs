'use strict';

/**
 * 招标文件「已知事实」抽取器 —— `copy` 类字段的取值来源。
 *
 * 为什么必须单独做这件事：
 *   采购编号、采购人名称、标段（包）名称这类值，**招标文件正文里本来就写着**
 *   （例如「1.1.2 采购编号：NC2060.EQP.P01.90-037。」）。响应文件格式里的同名字段
 *   只是空位。如果这些空位交给生成模型去「撰写」，编出来的编号会让整份标书作废。
 *   所以 `copy` 类不经过模型，只做原文抽取：抽得到就填，抽不到就留空。
 *
 * 抽取范围只认「正文里带值的那一次出现」，空位不算：
 *   响应区的「采购编号：」后面是空的，正则要求值非空，自然跳过；
 *   前附表里的「采购编号：NC2060.EQP.P01.90-037。」才是真值来源。
 *
 * 真实文档里的坑：
 *   - 全半角括号混用：原文是「标段（包)名称」——左全角右半角，两边都写成可选才匹配得上；
 *   - 编号前缀：字段常被命名为「1 采购人名称」「10 采购人名称」，取值前要剥掉小节编号。
 */

const path = require('node:path');

/** 每个事实的正则。值必须非空，否则会抽到响应区里的空位。 */
const FACT_RULES = [
  {
    key: '采购编号',
    // 编号只由字母数字和 . - _ / 组成，遇到中文标点自然停下。
    patterns: [/采购编号(?:为)?\s*[：:]\s*([A-Za-z0-9][A-Za-z0-9._\-/]*)/],
  },
  {
    key: '采购人',
    patterns: [
      // 「采购人名称：中国化学赛鼎宁波工程有限公司 采购编号：……」——值遇到空格/句号即止。
      /采购人(?:名称)?\s*[：:]\s*([^\s：:，。；、（）()""]{4,})/,
      /采购人(?:名称)?\s+([^\s：:，。；、（）()""]{4,}公司)/,
    ],
  },
  {
    key: '项目名称',
    patterns: [
      /项目名称\s*[：:]\s*([^\n]{4,60}?)\s*(?=[。；]|$)/,
      /项目名称\s+([^\n]{4,60}?)\s*(?=[。；]|$)/,
    ],
  },
  {
    key: '标段（包）名称',
    patterns: [
      // 括号允许全角/半角/缺失，原文就是混着写的。
      /标段\s*[（(]\s*包\s*[）)]?\s*名称\s*[：:]\s*([^\s：:，。；、（）()]{1,40})/,
      /标段\s*[（(]\s*包\s*[）)]?\s*[：:]\s*([^\s：:，。；、（）()]{1,40})/,
    ],
  },
];

/** 字段名 → 事实键。顺序不能反：更具体的先判。 */
const FIELD_FACT_RULES = [
  { fact: '采购编号', test: (n) => /采购编号/.test(n) },
  { fact: '采购人', test: (n) => /采购人/.test(n) },
  { fact: '标段（包）名称', test: (n) => /标段/.test(n) },
  { fact: '项目名称', test: (n) => /项目名称/.test(n) },
];

/** 剥掉字段名前面的小节编号前缀：「1 采购人名称」→「采购人名称」。 */
function stripSectionPrefix(name) {
  return String(name || '')
    .replace(/^附件[一二三四五六七八九十百]+\s*/, '')
    .replace(/^第[一二三四五六七八九十百]+[章节篇]\s*/, '')
    .replace(/^\d+(?:\.\d+)*\s+/, '')
    .trim();
}

/** 把候选文本收拾成可比较的样子。 */
function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/** 去掉尾部句号、分号这类不属于值的标点。 */
function trimValue(value) {
  return String(value || '').replace(/[。；，、\s]+$/u, '').trim();
}

/**
 * 从 list-blocks 的块数组里抽取已知事实。
 *
 * @param {Array} blocks
 * @returns {{facts: Record<string,string>, evidence: Array, block_count: number}}
 */
function extractTenderFacts(blocks = []) {
  const facts = {};
  const evidence = [];
  let blockCount = 0;

  for (const block of blocks) {
    const text = normalizeText(block?.text);
    if (!text) continue;
    blockCount += 1;
    const blockIndex = Number.isInteger(block?.index) ? block.index : -1;

    for (const rule of FACT_RULES) {
      if (facts[rule.key]) continue; // 已有值就不再覆盖，先出现的通常是前附表
      for (const pattern of rule.patterns) {
        const matched = pattern.exec(text);
        if (!matched) continue;
        const value = trimValue(matched[1]);
        if (!value) continue;
        facts[rule.key] = value;
        evidence.push({ fact: rule.key, value, block: blockIndex, text: text.slice(0, 120) });
        break;
      }
    }
  }

  return { facts, evidence, block_count: blockCount };
}

/** 字段名对应的事实键；不属于已知事实返回 ''。 */
function factKeyForField(name) {
  const stripped = stripSectionPrefix(name);
  for (const rule of FIELD_FACT_RULES) {
    if (rule.test(stripped)) return rule.fact;
  }
  return '';
}

/** 按字段名取值；取不到返回空串（不猜、不编）。 */
function valueForField(facts, name) {
  const key = factKeyForField(name);
  if (!key) return '';
  return String(facts?.[key] || '');
}

module.exports = {
  extractTenderFacts,
  factKeyForField,
  valueForField,
  stripSectionPrefix,
  FACT_RULES,
  _internal: { normalizeText, trimValue },
};
