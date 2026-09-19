/**
 * 历史项目事实污染检测（通用交付闸门）
 *
 * 背景：赛鼎/过轨吊等 1:1 复刻脚本把历史项目的事实硬编码进产物，一旦被通用链路
 * 复用到别的标段，就会把「磨煤机 / 过轨吊 / 石家庄项目」等写进无关标书。
 * 这条检测是通用的、可配置的，不针对某个脚本，任何交付内容都要过这一关。
 *
 * 豁免原则：当前项目**就是**该历史项目时（例如正在复刻石家庄能源岛项目本身），
 * 命中词是合法事实，降级为 info，不构成阻断。豁免只能按项目上下文判定，
 * 不允许按调用方开关随意跳过。
 */

// 每条规则 = 一组同源的历史项目事实词 + 这些事实所属的项目/标段上下文。
const HISTORICAL_FACT_RULES = [
  {
    id: 'shijiazhuang_energy_island',
    label: '石家庄能源岛项目',
    terms: ['石家庄'],
    projectPatterns: [/石家庄[^\n]{0,20}能源岛|能源岛项目|高新技术产业开发区能源岛/],
  },
  {
    id: 'coal_mill_overhead_crane',
    label: '磨煤机过轨吊设备',
    terms: ['磨煤机', '过轨吊', '过轨起重机'],
    projectPatterns: [/石家庄[^\n]{0,20}能源岛|能源岛项目/],
  },
  {
    id: 'ball_mill',
    label: '球磨机',
    terms: ['球磨机'],
    projectPatterns: [],
  },
  {
    id: 'direct_firing_pulverizing',
    label: '直吹式制粉系统',
    terms: ['直吹式制粉'],
    projectPatterns: [],
  },
  {
    id: 'boiler_stable_combustion',
    label: '锅炉稳燃',
    terms: ['锅炉稳燃'],
    projectPatterns: [],
  },
];

const CONTEXT_RADIUS = 24;

function normalizeProjectText(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function toSegments(content) {
  if (!content) return [];
  if (typeof content === 'string') return [{ id: '', title: '', content }];
  if (Array.isArray(content)) {
    const segments = [];
    const walk = (items) => {
      items.forEach((item, index) => {
        if (typeof item === 'string') {
          if (item) segments.push({ id: String(segments.length), title: '', content: item });
          return;
        }
        const segment = {
          id: String(item?.id ?? `${segments.length}`),
          title: String(item?.title || ''),
          content: String(item?.content ?? item?.text ?? ''),
        };
        if (segment.content) segments.push(segment);
        // 目录是树：只扫顶层会漏掉子章节里的污染。
        if (Array.isArray(item?.children) && item.children.length) walk(item.children);
      });
    };
    walk(content);
    return segments;
  }
  if (typeof content === 'object') {
    return Object.entries(content).map(([key, value]) => ({
      id: key,
      title: String(value?.title || key),
      content: String(typeof value === 'string' ? value : (value?.content ?? '')),
    })).filter((item) => item.content);
  }
  return [];
}

function isCurrentProject(rule, context) {
  const haystack = normalizeProjectText([
    context?.projectName,
    context?.project_name,
    context?.packageName,
    context?.package_name,
    context?.tenderName,
    context?.tender_name,
  ].filter(Boolean).join('|'));
  if (!haystack) return false;
  return (rule.projectPatterns || []).some((pattern) => pattern.test(haystack));
}

function buildFinding(rule, term, segment, offset) {
  const start = Math.max(0, offset - CONTEXT_RADIUS);
  const end = Math.min(segment.content.length, offset + term.length + CONTEXT_RADIUS);
  return {
    rule_id: rule.id,
    rule_label: rule.label,
    term,
    section_id: segment.id,
    section_title: segment.title,
    offset,
    context: segment.content.slice(start, end).replace(/\s+/g, ' ').trim(),
  };
}

/**
 * 扫描交付内容中的历史项目事实污染。
 * @param {string|Array|Object} content 正文；可为字符串、段落数组或 {id: {content}} 映射
 * @param {Object} context 当前项目上下文 { projectName, packageName, tenderName }
 * @returns {{ clean: boolean, blockers: Array, exempted: Array, scanned_segments: number, scanned_chars: number }}
 */
function detectContamination(content, context = {}) {
  const segments = toSegments(content);
  const blockers = [];
  const exempted = [];
  let scannedChars = 0;

  for (const segment of segments) {
    scannedChars += segment.content.length;
    for (const rule of HISTORICAL_FACT_RULES) {
      const exempt = isCurrentProject(rule, context);
      for (const term of rule.terms) {
        let offset = segment.content.indexOf(term);
        while (offset !== -1) {
          const finding = buildFinding(rule, term, segment, offset);
          if (exempt) exempted.push({ ...finding, severity: 'info', reason: '命中词属于当前项目自身事实，按项目上下文豁免' });
          else blockers.push({ ...finding, severity: 'blocker' });
          offset = segment.content.indexOf(term, offset + term.length);
        }
      }
    }
  }

  return {
    clean: blockers.length === 0,
    blockers,
    exempted,
    scanned_segments: segments.length,
    scanned_chars: scannedChars,
  };
}

/**
 * 交付闸门：出现任一非豁免的历史项目事实词即阻断。
 */
function evaluateContaminationGate(content, context = {}) {
  const result = detectContamination(content, context);
  return {
    blocked: !result.clean,
    severity: result.clean ? 'none' : 'blocker',
    reason: result.clean
      ? '未发现历史项目事实污染'
      : `发现 ${result.blockers.length} 处历史项目事实污染，禁止导出交付`,
    details: result,
  };
}

module.exports = {
  HISTORICAL_FACT_RULES,
  detectContamination,
  evaluateContaminationGate,
};
