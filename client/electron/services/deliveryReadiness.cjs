/**
 * 导出前交付就绪度报告（AC8）
 *
 * 把分散的质量检查结果收敛成三档，UI 与导出闸门只认这三档：
 *   - blocker            导出前必须清零，否则禁止交付
 *   - warning            可导出，但必须在报告里明示
 *   - manual_confirmation 机器无法判定，必须人工确认后才能交付
 */

const { runBidQualityCheck } = require('./bidQualityService.cjs');
const { evaluateContaminationGate } = require('./contaminationGuard.cjs');

const UNKNOWN_PLACEHOLDER = '待确认';
const TECHNICAL_COVERAGE_WARNING_THRESHOLD = 80;

const LEVELS = ['blocker', 'warning', 'manual_confirmation'];

function collectSections(outlineData) {
  const sections = [];
  const walk = (items) => {
    for (const item of items || []) {
      if (!item || typeof item !== 'object') continue;
      sections.push({ id: String(item.id || ''), title: String(item.title || ''), content: String(item.content || '') });
      if (item.children?.length) walk(item.children);
    }
  };
  walk(outlineData?.outline);
  return sections;
}

function push(list, level, code, title, detail) {
  list.push({ level, code, title, detail });
}

/**
 * @param {Object} input 质量检查所需的全部输入，外加 project（项目上下文）
 * @returns {Object} 三档报告 + 闸门结论
 */
function buildDeliveryReadinessReport(input = {}) {
  const {
    bidPlan,
    outlineData,
    responseTables,
    parameterRegistry,
    contentPlans,
    responseFileRequirements,
    tenderMarkdown,
    project = {},
    rejectionRisks = [],
  } = input;

  const quality = runBidQualityCheck({
    bidPlan,
    outlineData,
    responseTables,
    parameterRegistry,
    contentPlans,
    responseFileRequirements,
    tenderMarkdown,
  });

  const sections = collectSections(outlineData);
  const contamination = evaluateContaminationGate(sections, project);

  const blockers = [];
  const warnings = [];
  const manual = [];

  if (contamination.blocked) {
    push(blockers, 'blocker', 'cross_project_contamination', '内容混入历史项目事实', {
      reason: contamination.reason,
      hits: contamination.details.blockers.map((item) => ({
        term: item.term,
        section_id: item.section_id,
        section_title: item.section_title,
        context: item.context,
      })),
    });
  }

  const response = quality.response_section_coverage || {};
  if (response.computable) {
    for (const item of response.missing_required || []) {
      push(blockers, 'blocker', 'missing_required_section', `响应文件必备章节缺失：${item.name}`, {
        category: item.category_label,
      });
    }
    for (const item of response.thin_sections || []) {
      push(warnings, 'warning', 'thin_section', `合规章节内容过短：${item.name}`, {
        node_id: item.node_id,
        content_chars: item.content_chars,
      });
    }
  } else {
    push(warnings, 'warning', 'response_sections_unparsable', '未能解析响应文件章节要求', {
      reason: response.reason || '未提供 responseFileRequirements',
    });
  }

  for (const conflict of quality.parameter_conflicts || []) {
    push(blockers, 'blocker', 'parameter_conflict', `投标参数与确认值冲突：${conflict.label}`, {
      confirmed_value: conflict.confirmed_value,
      occurrences: conflict.occurrences,
    });
  }

  for (const claim of quality.unsupported_claims || []) {
    push(blockers, 'blocker', 'unsupported_claim', '存在无证据支撑的企业事实主张', {
      section_id: claim.section_id,
      claim: claim.claim,
      matched_text: claim.matched_text,
    });
  }

  const coverage = quality.technical_coverage || {};
  if (!coverage.computable) {
    push(warnings, 'warning', 'technical_topics_missing', '未提取到技术主题，覆盖率无法计算', {});
  } else if (coverage.coverage_score < TECHNICAL_COVERAGE_WARNING_THRESHOLD) {
    push(warnings, 'warning', 'low_technical_coverage', `技术主题覆盖率偏低：${coverage.coverage_score}%`, {
      covered_count: coverage.covered_count,
      total_count: coverage.total_count,
      missing_topics: (coverage.missing_topics || []).map((item) => item.title),
    });
  }

  for (const type of quality.missing_tables || []) {
    push(warnings, 'warning', 'missing_response_table', `缺少响应表：${type}`, {});
  }

  for (const item of quality.duplicate_sections || []) {
    push(warnings, 'warning', 'duplicate_section', `章节内容重复：${item.left_section_id} 与 ${item.right_section_id}`, {
      duplicate_paragraphs: item.duplicate_paragraphs,
    });
  }

  const pendingSections = sections.filter((item) => item.content.includes(UNKNOWN_PLACEHOLDER));
  if (pendingSections.length) {
    push(manual, 'manual_confirmation', 'pending_facts', `仍有 ${pendingSections.length} 个章节含「${UNKNOWN_PLACEHOLDER}」占位，需人工补录`, {
      section_ids: pendingSections.map((item) => item.id),
      titles: pendingSections.map((item) => item.title).filter(Boolean),
    });
  }

  const pendingRisks = (rejectionRisks || []).filter((item) => item && item.status === 'pending');
  if (pendingRisks.length) {
    push(manual, 'manual_confirmation', 'pending_rejection_risks', `仍有 ${pendingRisks.length} 条废标/无效标风险待人工确认`, {
      titles: pendingRisks.map((item) => item.title).filter(Boolean),
    });
  }

  push(manual, 'manual_confirmation', 'docx_visual_fidelity', 'DOCX 视觉保真需人工在 Word/WPS 打开确认', {
    checklist: ['页眉页脚内容', '分节与页码', '主要样式与表格', '浮动对象锚点位置'],
  });

  const counts = {
    blocker: blockers.length,
    warning: warnings.length,
    manual_confirmation: manual.length,
  };

  return {
    generated_at: new Date().toISOString(),
    levels: { blocker: blockers, warning: warnings, manual_confirmation: manual },
    counts,
    gate: {
      blocked: counts.blocker > 0,
      can_export: counts.blocker === 0,
      requires_manual_confirmation: counts.manual_confirmation > 0,
      reasons: blockers.map((item) => `${item.code}: ${item.title}`),
    },
    quality,
    contamination,
    scanned_sections: sections.length,
  };
}

module.exports = {
  LEVELS,
  UNKNOWN_PLACEHOLDER,
  TECHNICAL_COVERAGE_WARNING_THRESHOLD,
  collectSections,
  buildDeliveryReadinessReport,
};
