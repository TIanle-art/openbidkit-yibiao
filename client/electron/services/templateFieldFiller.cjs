'use strict';

/**
 * 模板字段填值器 —— 把「标出了哪些待填点」推进到「这些点里已经填上真值」。
 *
 * 四类来源，一个都不能混（混了就是让模型去编采购编号和报价）：
 *   copy    → 招标文件原文抽取的事实（采购编号 / 采购人 / 标段名称）
 *   profile → 企业资料库，取不到就留空
 *   manual  → 签字、盖章、报价，必须留给人，一律不动
 *   ai      → 项目自述类，交给生成模型（本次未接通模型时标 pending_ai）
 *
 * 产出带 `value` 的 fields 数组，直接喂给 apply-template-fields：
 * 有值写真值且去掉淡红底（红 = 待处理，正常 = 已填），无值保持占位符 + 淡红底。
 */

const { valueForField } = require('./tenderFactExtractor.cjs');
const { performanceKeyOf } = require('./companyProfileStore.cjs');

/** 真值长度超过这个数就提醒「可能撑坏原空位」，但不截断——截断真值比撑坏版式更糟。 */
const OVERFLOW_HINT_LENGTH = 40;

const FILL_STATUS = {
  FILLED: 'filled',
  LEFT_BLANK: 'left_blank',
  PENDING_AI: 'pending_ai',
};

function createTemplateFieldFiller({ facts = {}, profileStore = null, aiWriter = null } = {}) {
  const missingProfile = new Map();
  const missingFacts = new Map();
  // 业绩台账是「逐行」的：同一张表里第 n 次出现的「项目名称」要取第 n 行，
  // 不能所有行都填同一条业绩。按「小节 + 台账键」计数定位行号。
  const performanceCursor = new Map();

  /**
   * @param {object} classification classifyTemplateCandidates 的产物
   * @returns {{fields: Array, stats: object, missing_profile: Array, missing_facts: Array}}
   */
  function fill(classification) {
    const fields = [];
    const items = classification?.items || [];

    for (const item of items) {
      if (item.category === 'ignore') continue;
      const name = String(item.name || item.suggested_name || '').trim();
      if (!name) continue;

      const entry = {
        candidate_id: item.candidate_id,
        name,
        fill_by: item.fill_by,
        instruction: item.instruction || '',
        value: '',
        fill_status: FILL_STATUS.LEFT_BLANK,
        value_source: '',
      };

      if (item.fill_by === 'manual') {
        // 签字/盖章/报价：留给人。写任何值都是伪造签章。
        entry.fill_status = FILL_STATUS.LEFT_BLANK;
      } else if (item.fill_by === 'copy') {
        const value = valueForField(facts, name);
        if (value) {
          entry.value = value;
          entry.fill_status = FILL_STATUS.FILLED;
          entry.value_source = 'tender_fact';
        } else {
          missingFacts.set(name, (missingFacts.get(name) || 0) + 1);
        }
      } else if (item.fill_by === 'profile') {
        const perfKey = performanceKeyOf(name);
        if (perfKey && profileStore?.getPerformanceRow) {
          const cursorKey = `${item.section || ''}|${perfKey}`;
          const rowIndex = performanceCursor.get(cursorKey) || 0;
          performanceCursor.set(cursorKey, rowIndex + 1);
          const row = profileStore.getPerformanceRow(rowIndex);
          const cell = row ? String(row[perfKey] ?? '').trim() : '';
          if (cell) {
            entry.value = cell;
            entry.fill_status = FILL_STATUS.FILLED;
            entry.value_source = 'company_profile_performance';
            entry.performance_row = rowIndex;
          } else {
            missingProfile.set(`${name}（业绩第 ${rowIndex + 1} 行）`, (missingProfile.get(`${name}（业绩第 ${rowIndex + 1} 行）`) || 0) + 1);
          }
        } else {
          const hit = profileStore ? profileStore.get(name) : { value: '', matched: false };
          if (hit.matched && hit.value) {
            entry.value = hit.value;
            entry.fill_status = FILL_STATUS.FILLED;
            entry.value_source = 'company_profile';
          } else {
            missingProfile.set(name, (missingProfile.get(name) || 0) + 1);
          }
        }
      } else if (item.fill_by === 'ai') {
        entry.fill_status = FILL_STATUS.PENDING_AI;
      }

      if (entry.value && entry.value.length > OVERFLOW_HINT_LENGTH) entry.overflow_risk = true;
      fields.push(entry);
    }

    return {
      fields,
      missing_profile: [...missingProfile.entries()].map(([name, count]) => ({ name, count })),
      missing_facts: [...missingFacts.entries()].map(([name, count]) => ({ name, count })),
      stats: summarize(fields),
    };
  }

  /**
   * 异步版：ai 类会真的去调 writer。
   * 与 fill() 的区别只在 ai 分支——离线跑断言时不该因为没模型就报错。
   */
  async function fillAsync(classification) {
    const result = fill(classification);
    if (!aiWriter) return result;

    for (const entry of result.fields) {
      if (entry.fill_by !== 'ai') continue;
      try {
        const written = await aiWriter({
          name: entry.name,
          instruction: entry.instruction,
        });
        const value = String(written || '').trim();
        if (value) {
          entry.value = value;
          entry.fill_status = FILL_STATUS.FILLED;
          entry.value_source = 'ai';
        }
      } catch (error) {
        entry.ai_error = String(error?.message || error);
        entry.fill_status = FILL_STATUS.PENDING_AI;
      }
    }
    result.stats = summarize(result.fields);
    return result;
  }

  return { fill, fillAsync };
}

function summarize(fields) {
  const stats = {
    total: fields.length,
    filled: 0,
    left_blank: 0,
    pending_ai: 0,
    by_source: {},
    by_fill_by: {},
  };
  for (const entry of fields) {
    stats[entry.fill_status] = (stats[entry.fill_status] || 0) + 1;
    stats.by_fill_by[entry.fill_by] = (stats.by_fill_by[entry.fill_by] || 0) + 1;
    if (entry.value_source) {
      stats.by_source[entry.value_source] = (stats.by_source[entry.value_source] || 0) + 1;
    }
  }
  return stats;
}

/** 填值清单：给人工复核用，一眼看出哪些填了、值从哪来、哪些还空着。 */
function renderFillingMarkdown(sourceLabel, facts, result) {
  const lines = [
    `# 模板待填点填值结果（${sourceLabel}）`,
    '',
    `- 待填点：${result.stats.total}`,
    `- 已填真值：${result.stats.filled}`
      + `（招标文件原文 ${result.stats.by_source.tender_fact || 0}`
      + ` / 企业资料库 ${result.stats.by_source.company_profile || 0}`
      + ` / AI 撰写 ${result.stats.by_source.ai || 0}）`,
    `- 留空待人填：${result.stats.left_blank}`,
    `- 待接 AI：${result.stats.pending_ai}`,
    '',
    '## 从招标文件抓到的事实',
    '',
    '| 事实 | 值 |',
    '|---|---|',
  ];
  for (const [key, value] of Object.entries(facts || {})) {
    lines.push(`| ${key} | ${value} |`);
  }

  lines.push('', '## 已填字段', '', '| 字段名 | 填写方式 | 值 | 来源 |', '|---|---|---|---|');
  for (const entry of result.fields) {
    if (!entry.value) continue;
    const flag = entry.overflow_risk ? ' ⚠️超长' : '';
    lines.push(`| ${entry.name} | ${entry.fill_by} | ${entry.value}${flag} | ${entry.value_source} |`);
  }

  lines.push('', '## 仍为空（需人工）', '', '| 字段名 | 填写方式 | 状态 |', '|---|---|---|');
  for (const entry of result.fields) {
    if (entry.value) continue;
    lines.push(`| ${entry.name} | ${entry.fill_by} | ${entry.fill_status} |`);
  }

  if (result.missing_profile.length) {
    lines.push('', '## 待补企业资料（资料库里没有，取不到就留空，不编）', '', '| 字段名 | 出现次数 |', '|---|---|');
    for (const item of result.missing_profile) lines.push(`| ${item.name} | ${item.count} |`);
  }

  if (result.missing_facts.length) {
    lines.push('', '## 招标文件里也没抓到的 copy 字段', '', '| 字段名 | 出现次数 |', '|---|---|');
    for (const item of result.missing_facts) lines.push(`| ${item.name} | ${item.count} |`);
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  createTemplateFieldFiller,
  renderFillingMarkdown,
  FILL_STATUS,
  OVERFLOW_HINT_LENGTH,
};
