'use strict';

/**
 * 模板待填点填值流水线 —— 「扫描 → 分类 → 抽事实 → 填值 → 写入」的共享实现。
 *
 * 谁在用：
 *   - `scripts/fill-template-fields.cjs`（验证脚本，隔离 userData）
 *   - `ipc/templateFieldFillIpc.cjs`（应用内入口，真实 userData + 应用已配置的模型）
 *
 * 为什么抽成服务：链路只活脚本里等于没接进应用；两端共用同一实现，
 * 断言脚本验过的行为就是应用里跑的行为。
 */

const { scanAndClassify } = require('./templateFieldClassifier.cjs');
const { extractTenderFacts } = require('./tenderFactExtractor.cjs');
const { createTemplateFieldFiller } = require('./templateFieldFiller.cjs');

/** 把资料库 + 招标事实拼成模型唯一的依据（不给事实 = 让模型自己编）。 */
function buildCompanyBrief(profile, facts) {
  const f = profile?.fields || {};
  const lines = [
    f.company_name ? `企业名称：${f.company_name}` : '',
    f.company_nature ? `单位性质：${f.company_nature}` : '',
    f.founded_date ? `成立时间：${f.founded_date}` : '',
    f.registered_capital ? `注册资金：${f.registered_capital}` : '',
    f.company_address ? `注册地址：${f.company_address}` : '',
    f.legal_rep_name ? `法定代表人：${f.legal_rep_name}（${f.legal_rep_title || ''}）` : '',
    f.staff_total ? `员工总数：${f.staff_total}` : '',
    f.parent_group ? `所属集团：${f.parent_group}` : '',
    f.permit_no ? `资质：${f.permit_no}` : '',
    f.max_monthly_capacity ? `最大月生产能力：${f.max_monthly_capacity}` : '',
    f.net_worth ? `净资产（2025年）：${f.net_worth}` : '',
  ].filter(Boolean);
  const rows = profile?.performance || [];
  for (const row of rows) {
    lines.push(
      `近年同类业绩：${row.project_name || ''}（${row.project_location || ''}），`
      + `采购人 ${row.buyer_name || ''}，合同价格 ${row.contract_price || ''}，`
      + `交货 ${row.delivery_start || ''} 至 ${row.delivery_end || ''}`,
    );
  }
  if (facts && Object.keys(facts).length) {
    lines.push(`本项目（采购人侧）事实：${Object.entries(facts).map(([k, v]) => `${k}=${v}`).join('；')}`);
  }
  return lines.join('\n');
}

/**
 * 造 aiWriter：把「字段名 + 填写要求 + 企业事实简报」交给模型。
 * 明令禁止输出资料之外的编号/金额/日期——采购编号被编出来，整份响应文件作废。
 */
function createGroundedAiWriter({ chat, profileStore, facts }) {
  if (typeof chat !== 'function') return null;
  const brief = buildCompanyBrief(profileStore.load(), facts);
  return async ({ name, instruction }) => {
    const prompt = [
      '你是投标文件撰写助手。下面是一家企业的真实资料：',
      '',
      brief,
      '',
      `现在要为响应文件里的一个栏目写内容。栏目名：${name}`,
      instruction ? `填写要求：${instruction}` : '',
      '',
      '硬性要求：',
      '1. 只用上面给出的资料，禁止出现资料里没有的编号、金额、日期、证书号、人名；',
      '2. 200 字以内，一段中文，不要换行、不要用 Markdown 符号；',
      '3. 语气客观、书面，不夸张、不写「领先」「一流」这类无据形容词；',
      '4. 直接输出正文，不要任何前缀或解释。',
    ].filter(Boolean).join('\n');

    const text = await chat({ messages: [{ role: 'user', content: prompt }], max_tokens: 800 });
    return String(text || '').replace(/\s+/g, ' ').trim();
  };
}

/**
 * 跑完整条填值链。
 *
 * @param {object} input
 * @param {object} input.openXmlHelperService 已创建的助手服务
 * @param {string} input.input       workspace 相对路径（助手只认相对路径）
 * @param {string} input.output      产物 docx 的 workspace 相对路径
 * @param {string} [input.fieldsOutput] 填值清单 JSON 的 workspace 相对路径
 * @param {object} input.profileStore 已建库的企业资料库
 * @param {Function} [input.chat]    文本模型调用（ai.chat），不传则 ai 类标 pending_ai
 * @param {number} [input.timeoutMs]
 * @returns {Promise<{candidates:Array, classification:object, facts:object, evidence:Array,
 *                    filling:object, applied:object, ignoredCandidateIds:string[]}>}
 */
async function runTemplateFieldFilling({
  openXmlHelperService,
  input,
  output,
  fieldsOutput,
  profileStore,
  chat,
  timeoutMs = 300000,
}) {
  const { candidates, blocks, classification } = await scanAndClassify(openXmlHelperService, input, { timeoutMs });
  const { facts, evidence } = extractTenderFacts(blocks);

  const aiWriter = createGroundedAiWriter({ chat, profileStore, facts });
  const filler = createTemplateFieldFiller({ facts, profileStore, aiWriter });
  const filling = await filler.fillAsync(classification);

  const ignoredCandidateIds = classification.items
    .filter((item) => item.category === 'ignore')
    .map((item) => item.candidate_id);

  const applied = await openXmlHelperService.runJob({
    action: 'apply-template-fields',
    request: {
      input,
      output,
      ...(fieldsOutput ? { fields_output: fieldsOutput } : {}),
      fields: filling.fields.map((item) => ({
        candidate_id: item.candidate_id,
        name: item.name,
        fill_by: item.fill_by,
        instruction: item.instruction || undefined,
        value: item.value || undefined,
      })),
      ignored_candidate_ids: ignoredCandidateIds,
    },
    timeoutMs,
  });

  return { candidates, blocks, classification, facts, evidence, filling, applied, ignoredCandidateIds };
}

module.exports = {
  runTemplateFieldFilling,
  buildCompanyBrief,
  createGroundedAiWriter,
};
