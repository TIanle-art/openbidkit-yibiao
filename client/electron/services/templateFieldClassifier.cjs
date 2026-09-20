'use strict';
/**
 * 模板待填候选的分类器（「模板 Agent 分类环节」的第一层）。
 *
 * 背景：openxmlhelper 的 scan-template-fields 只回答「哪里是空的」，不回答
 * 「这个空位该不该填、该由谁填」。一份招标文件里同时混着三类空位：
 *
 *   - 响应文件格式里的空位（响应函、资格审查资料、承诺书……）→ 投标人要填
 *   - 指向本采购项目的标识（采购编号、项目名称、采购人……）→ 由招标方给定，投标人照抄
 *   - 采购文件自身的条款/目录/附件 → 投标人根本不填
 *
 * 全当字段会把整份招标文件变成待填表，所以必须先过这一道分类，产出的白名单
 * 才能交给 apply-template-fields。
 *
 * 判据分四层，从「结构性最强」到「语义」逐级下降。前一层能定就不再看后一层，
 * 因此每条候选都能说清是依据什么被判成这个类别（item.reason）。
 *
 *   ① 结构噪音（目录条目这类）：直接忽略
 *   ② 文档分区：候选落在「响应文件格式」区之前 → 采购方内容区
 *   ③ 小节归属：业绩表/资格声明/基本情况表这类小节 → 一律是投标人填自己的信息
 *   ④ 名字词表：采购方标识 → buyer_info；其余 → tenderer_fill
 *
 * 本模块不依赖 electron，纯 node 可 require，便于单测。
 */
const fs = require('node:fs');
const path = require('node:path');

const CATEGORY = {
  /** 投标人要填的空位（生成字段）。 */
  TENDERER_FILL: 'tenderer_fill',
  /** 由招标方给定、投标人照抄的信息（生成字段，但值来自采购文件）。 */
  BUYER_INFO: 'buyer_info',
  /** 采购文件自身内容，不生成字段。 */
  IGNORE: 'ignore',
};

const INSTRUCTION = {
  TENDERER_AI: '投标人针对本项目的自述内容，由 AI 依据招标文件与项目资料撰写。',
  TENDERER_MANUAL: '需人工签署、盖章或现场填写，不要由 AI 生成。',
  TENDERER_PROFILE: '值取自企业资料库（营业执照、资质、财务与业绩台账等）；取不到就留空，不得编造。',
  BUYER: '值取自本采购文件（采购编号、项目名称等），照抄原文；不得编造。',
};

/**
 * 企业登记/财务/业绩数据：值只能来自企业资料库。
 *
 * 这类字段以前一并标成 `ai`，但 instruction 又写着「不得编造」——标签与说明自相矛盾：
 * 下游只要按 `fill_by === 'ai'` 去调生成模型，法定代表人姓名、身份证号、性别、
 * 成立时间就会被「写」出来。所以单独给一类 `profile`：取不到就留空。
 *
 * 「项目描述」「经营范围」「组织机构、技术力量等」这类要成段写的**不在**这里，那些才是 ai。
 */
const PROFILE_NAME_PATTERNS = [
  /申请人名称/,
  /单位名称/,
  /制造厂名称/,
  /单位性质/,
  /申请人的性质/,
  /^地址$/,
  /注册地址/,
  /单位地址/,
  /总部地址/,
  /成立时间/,
  /成立和\/或注册日期/,
  /经营期限/,
  /^姓名$/,
  /法定代表人姓名/,
  /^性别$/,
  /^年龄$/,
  /^职务$/,
  /身份证号码/,
  /营业执照号/,
  /注册资金/,
  /实收资本/,
  /开户银行/,
  /开立基本帐户银行/,
  /^账号$/,
  /员工总人数/,
  /职称人员/,
  /^技工$/,
  /^联系人$/,
  /^电话$/,
  /联系电话/,
  /传真/,
  /邮政编码/,
  /网址/,
  /^净值$/,
  /固定资产/,
  /流动资产/,
  /长期负债/,
  /流动负债/,
  /合同金额/,
  /合同价格/,
  /合同编号/,
  /签字日期/,
  /^数量$/,
  /交货起始日期/,
  /最终交货日期/,
  /^物资（/,
  /^备注（/,
  /近期资产负债表/,
  // 业绩表/项目情况表里的「项目名称」「采购人名称」指的是投标人**自己过往业绩**
  // 的项目与客户，不是本项目的采购信息——值在业绩台账里，取不到就留空。
  // 曾经它们落到 ai，模型会凭空写一条业绩出来。
  /^项目名称$/,
  /^项目所在地$/,
  /采购人名称/,
  /采购人地址/,
  /采购人电话/,
  // 经营范围在营业执照上是登记事项，不是让模型自由发挥的自述。
  /^经营范围$/,
  /^技术职称$/,
];

/**
 * 小节标题若命中这些词，说明这一节整张表都是「投标人填自己的信息」。
 *
 * 这条判据很关键：它挡住了「采购人名称」的误判。业绩表里的「采购人名称」指的是
 * 投标人**以往业绩的客户**，不是本项目的采购人——投标人必须自己填。
 */
const TENDERER_SECTION_PATTERNS = [
  /申请人基本情况表/,
  /生产能力证明/,
  /财务状况/,
  /质量保证能力/,
  /供货业绩表/,
  /业绩表/,
  /履约信用/,
  /诉讼及仲裁/,
  /资质文件/,
  /资格声明/,
  /能力分析表/,
  // 「近三年的营业额」「最近三年…提供的物资」这类小节是投标人的业绩台账，
  // 表里也会有「项目名称」「采购人名称」——那是投标人以往业绩的客户与项目，
  // 不是本项目的。不在这里挡住，就会命中买家词表被判成招标方信息。
  /营业额/,
  /提供的物资/,
  /销售/,
  /供应、运输、售后服务方案/,
  /技术规格书/,
  /生产设备、检验设备表/,
  /保护措施/,
  /偏离表/,
  /报价表/,
  /报价综合说明/,
  /生产企业简介/,
  /其他资料/,
];

/**
 * 本采购项目的标识：采购编号、标段（包）名称……
 *
 * 这一组**无条件**判为招标方信息，优先于小节规则。原因是它们标识的是「这一次采购」，
 * 不管出现在哪一节里都是同一个值——技术偏离表表头上的采购编号，和响应函里的
 * 采购编号，指的都是本项目的编号。若按小节规则走，偏离表会被整节判成投标人信息，
 * 采购编号跟着被错判成「投标人自己填」。
 */
const PROJECT_IDENTITY_PATTERNS = [
  /采购编号/,
  /项目编号/,
  /招标编号/,
  /标段/,
  /标段包/,
  /包名称/,
  /包号/,
];

/**
 * 招标方一侧的信息，但**只在非投标人信息小节**里才算 buyer。
 *
 * 关键反例：业绩表里的「采购人名称」指的是投标人以往业绩的客户，得由投标人自己填。
 * 所以这一组不能像项目标识那样无条件生效。
 */
const BUYER_NAME_PATTERNS = [
  /^致$/,
  /采购人/,
  /招标人/,
  /谈判日期/,
  /谈判和评审/,
  /成交价/,
  /指定地点/,
  /项目名称/,
  /项目/,
  /项目施工现场/,
];

/**
 * 招标方自己出具的文书：成交通知书、中标通知书、合同条款、评审办法……
 *
 * 这些节里的空位**判 ignore**，而不是 buyer_info。区别在于用途：成交通知书是采购人
 * 发给中标人的，投标人递交响应文件时根本不提交这份文件——把它做成「招标方信息字段」
 * 塞进投标文件，等于凭空多出「成交价」「指定地点」两个废字段。
 * buyer_info 只留给**投标文件里确实要抄录**的项目标识（采购编号、项目名称）。
 */
const SELLER_DOCUMENT_SECTION_PATTERNS = [
  /成交通知书/,
  /中标通知书/,
  /成交通知/,
  /中标通知/,
  /合同条款及格式/,
  /评审办法/,
];

/** 名字命中这些词 → 必须人工签署/盖章，AI 不该代劳。 */
const MANUAL_NAME_PATTERNS = [
  /签字/,
  /簽字/,
  /盖章/,
  /公章/,
  /加盖/,
  /签署/,
  /身份证号码/,
  // 报价只能由人拍板。这类字段以前落 ai，模型会「报」出一个数——
  // 标书写错金额比空着严重得多，所以一律留空给人填。
  /报价/,
  /合价/,
  /总价/,
  /^大写$/,
  /小写/,
];

/** 上下文里出现这些，也说明这一处是要手签/盖章的落款。 */
const MANUAL_CONTEXT_PATTERNS = [
  /（签字）/,
  /（盖单位章）/,
  /（盖章）/,
  /加盖公章/,
  /签字或盖章/,
];

/** 目录条目：表头是「编列内容」「页码」这类，且首列是条款号。 */
const TOC_HEADER_PATTERN = /本列表头：(?:编列内容|页码|目录|页次)/;
const TOC_ROW_PATTERN = /第1列：\d+(?:\.\d+)*；/;

/** 目录域代码（TOC \h \o "1-3"）：由 Word 自己维护，不能当待填点。 */
const TOC_FIELD_PATTERN = /\bTOC\b[\s\S]*\\[ho]\b/;

/** 「响应文件格式」区：命中即认为其后整段是投标人要填的格式。 */
const RESPONSE_SECTION_PATTERN = /响应文件格式|投标文件格式/;

/**
 * 合并汉字之间的排版空格（「技 术 响 应 文 件」），但不动英文单词间的空格。
 *
 * 一轮全局替换会漏掉相邻的空位——替换吃掉第二个汉字后，下一次匹配只能从它后面
 * 开始，「技 术 响 应」会变成「技术 响应」。所以要替换到不再变化为止。
 */
function compactText(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  let previous;
  do {
    previous = text;
    text = text.replace(/(\p{Script=Han}) (\p{Script=Han})/gu, '$1$2');
  } while (text !== previous);
  return text;
}

/** 从候选 location（如 body/627:tbl/row/1/cell/2/p/0）里取块号。 */
function parseBlockIndex(location) {
  const matched = /body\/(\d+)/.exec(String(location || ''));
  return matched ? Number(matched[1]) : -1;
}

/**
 * 判断一个块是否像「章节/小节标题」，用来当分区锚点。
 *
 * list-blocks 的 heading 标记并不可靠：真实招标文件里「1．响应函」这类标题
 * 常常只是加粗正文（实测 514 之后的 29 个标题块里只有一个被识别为 heading），
 * 所以这里同时用文本形态兜底。
 *
 * 两条排除条件都是踩出来的：
 *   - 带句中标点（、，。；：）的是正文或字段标签，不是标题；
 *   - 纯数字是页码。
 */
function isSectionAnchor(block, text) {
  if (!text) return false;
  // heading 是文档自己给出的结构信号，优先于下面的形态猜测。
  // 真实标题常带冒号（「附件二：成交通知书」），若先按标点排除就会漏掉。
  if (block?.heading) return text.length <= 60;
  if (text.length > 30) return false;
  if (/[，。；：？！、]/.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  if (/^第[一二三四五六七八九十百]+[章节篇]/.test(text)) return true;
  if (/^附件[一二三四五六七八九十百]+/.test(text)) return true;
  if (/^\d+(?:\.\d+)*[．.、]?\s*\S/.test(text)) return true;
  return false;
}

/** 把块序列压成章节锚点表：[{ index, text }]，index 为块号。 */
function buildSectionAnchors(blocks) {
  const anchors = [];
  (blocks || []).forEach((block, index) => {
    const text = String(block?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    // 匹配用合并过汉字空格的副本：真实文档里小节标题常被排成「能 力 分 析 表」，
    // 不合并就匹配不上；展示仍用原文，免得产物里出现「第六章响应文件格式」这种粘连。
    const compact = compactText(block?.text);
    // 块号优先用块自带的 index（list-blocks 会带），没有才退回数组下标。
    // 两者混用会让「块号」和「候选 location 里的块号」对不上，分类整体错位。
    const blockIndex = Number.isInteger(block?.index) ? block.index : index;
    if (isSectionAnchor(block, compact)) anchors.push({ index: blockIndex, text, compact });
  });
  return anchors;
}

/** 取候选所在块之前（含该块）最近的章节锚点。 */
function findSectionAnchor(anchors, blockIndex) {
  if (blockIndex < 0) return null;
  let found = null;
  for (const anchor of anchors) {
    if (anchor.index <= blockIndex) found = anchor;
    else break;
  }
  return found;
}

/** 返回「响应文件格式」这个分区起点；找不到返回 -1。 */
function findResponseSectionStart(anchors) {
  const anchor = anchors.find((item) => RESPONSE_SECTION_PATTERN.test(item.compact || item.text));
  return anchor ? anchor.index : -1;
}

/** 小节是否整节都是投标人信息。 */
function isTendererSection(sectionText) {
  const text = String(sectionText || '');
  return TENDERER_SECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/** 小节是否是招标方出具的文书（成交通知书、合同条款……），整节不填。 */
function isSellerDocumentSection(sectionText) {
  const text = String(sectionText || '');
  return SELLER_DOCUMENT_SECTION_PATTERNS.some((pattern) => pattern.test(text));
}

function matchesAny(patterns, value) {
  const text = String(value || '');
  return patterns.some((pattern) => pattern.test(text));
}

/** 是否必须人工填写。签署日期（「日期： 年 月 日」）也算人工——当天日期只有人知道。 */
function isManualFill(name, context) {
  if (matchesAny(MANUAL_NAME_PATTERNS, name)) return true;
  if (matchesAny(MANUAL_CONTEXT_PATTERNS, context)) return true;
  if (/^(日期|日期：)$/.test(String(name || '').trim()) && /年\s*月\s*日/.test(String(context || ''))) {
    return true;
  }
  return false;
}

/**
 * 判断这个字段的值该从哪儿来：照抄招标文件 / 人工签署 / 企业资料库 / AI 撰写。
 *
 * 顺序不能反：
 *   1. `copy` 优先——采购编号这类值在招标文件里写着原文，交给模型就是让它编；
 *   2. 签字盖章其次（法定代表人姓名是从资料库取，但要签字的地方仍是人工）；
 *   3. 报价这类也归人工（见 MANUAL_NAME_PATTERNS 的说明）；
 *   4. 企业登记/台账数据取资料库，取不到留空；
 *   5. 剩下的才是由 AI 成段撰写的项目自述。
 *
 * **每类的 instruction 必须和它自己一致**：曾经 buyer_info 被打上 `ai`，
 * 说明却写「照抄原文，不得编造」——下游按 `fill_by === 'ai'` 调模型的那一刻，
 * 编号就被编出来了。所以「值从哪来」只有一处说了算，就是 fill_by。
 */
function resolveFillBy(name, context, category) {
  if (category === CATEGORY.BUYER_INFO) return 'copy';
  if (isManualFill(name, context)) return 'manual';
  if (matchesAny(PROFILE_NAME_PATTERNS, name)) return 'profile';
  return 'ai';
}

/**
 * 目录条目：原样保留在文档里，不是待填点。
 *
 * 两种形态都要认：
 *   - 带表头的（「本列表头：编列内容；第1列：1；第2列：总则」）；
 *   - 续表没有表头的（「第1列：6；第2列：谈判和评审」）——真实文档里一份目录常
 *     被排成好几张表，只有第一张带表头，只认表头会漏掉后面的整批条目。
 *
 * 只认第一列的形态仍不够：目录续表里首列就是条款号，而数据表首列通常是字段名。
 * 所以再加两条限制——第二列要短且不带冒号，避免把数据行当成目录。
 */
function isTableOfContentsEntry(context) {
  const text = String(context || '');
  if (TOC_HEADER_PATTERN.test(text)) return true;
  const row = /第1列：(\d+(?:\.\d+)*)；第2列：([^；]*)/.exec(text);
  if (!row) return false;
  const second = row[2].trim();
  return second.length > 0 && second.length <= 12 && !/[：:]/.test(second);
}

/**
 * 对单条候选分类。
 *
 * @returns {{category:string, reason:string, needs_review:boolean}}
 */
function classifyCandidate(candidate, { sectionText, sectionMatch, inResponseSection, partitioned = true }) {
  const name = String(candidate?.suggested_name || '').trim();
  const context = String(candidate?.context || '');
  // 展示用原文、匹配用合并过空格的副本（见 buildSectionAnchors 的说明）。
  const sectionLabel = String(sectionText || '');
  const section = String(sectionMatch ?? sectionText ?? '');

  if (isTableOfContentsEntry(context)) {
    return { category: CATEGORY.IGNORE, reason: '目录条目：表头是编列内容/页码且首列为条款号', needs_review: false };
  }

  if (TOC_FIELD_PATTERN.test(String(candidate?.text || '')) || TOC_FIELD_PATTERN.test(context)) {
    return { category: CATEGORY.IGNORE, reason: '目录域代码，由 Word 自动维护', needs_review: false };
  }

  // 招标方出具的文书整节不填。这条必须排在词表之前：成交通知书里的「成交价」
  // 确实是「招标方给的值」，光看名字会被判成 buyer_info。
  if (isSellerDocumentSection(section)) {
    return {
      category: CATEGORY.IGNORE,
      reason: `属于招标方出具的文书「${sectionLabel}」，投标人递交响应文件时不填`,
      needs_review: false,
    };
  }

  // 文档里找不到「响应文件格式」这样的分区锚点（例如一份只有要点清单的历史标书模板）。
  // 这时不能套用「分区之前一律是招标方条款」——那会把整篇都判成忽略。
  // 改为只靠候选自身判断：有标签的空位多半就是要填的，没标签的仍然忽略。
  if (!partitioned) {
    if (!name) {
      return { category: CATEGORY.IGNORE, reason: '文档没有「响应文件格式」分区可参照，且取不到标签', needs_review: true };
    }
    if (matchesAny(PROJECT_IDENTITY_PATTERNS, name)) {
      return { category: CATEGORY.BUYER_INFO, reason: '本采购项目标识，由招标方给定', needs_review: false };
    }
    if (isTendererSection(section)) {
      return { category: CATEGORY.TENDERER_FILL, reason: `属于投标人信息小节「${sectionLabel}」，由投标人填写`, needs_review: false };
    }
    if (matchesAny(BUYER_NAME_PATTERNS, name)) {
      return { category: CATEGORY.BUYER_INFO, reason: '招标方一侧的信息，投标人照抄', needs_review: false };
    }
    return {
      category: CATEGORY.TENDERER_FILL,
      reason: '文档无响应文件格式分区，按待填点处理（需人工复核）',
      needs_review: true,
    };
  }

  // 采购方内容区（响应文件格式之前）：招标文件的条款、须知、评审办法、附件都不由投标人填。
  if (!inResponseSection) {
    if (!name) {
      return { category: CATEGORY.IGNORE, reason: '采购方内容区，且取不到标签无法判断', needs_review: true };
    }
    if (matchesAny(PROJECT_IDENTITY_PATTERNS, name)
      || matchesAny(BUYER_NAME_PATTERNS, name)
      || matchesAny(BUYER_NAME_PATTERNS, context)) {
      return { category: CATEGORY.BUYER_INFO, reason: '采购方内容区，且是采购编号/项目名称等招标方信息', needs_review: false };
    }
    return { category: CATEGORY.IGNORE, reason: '采购方内容区（条款/须知/评审办法），投标人不填', needs_review: false };
  }

  // 响应文件格式区。
  if (!name) {
    // 取不到名字的空位一律不进白名单，但**必须标复核**——忽略 ≠ 没人知道。
    //
    // 曾经试过「不确定就先当待填」：把上下文简短的（如「（5） 近期资产负债表
    // （到 2024 年 12 月 31 日止）」）当字段写进去。渲染核对照出这是错的——
    // 那几格的正文只有空格（text 是 "  "），是日期数字之间的排版空格，不是待填点；
    // 强行写成字段后，占位符插在「到 2024 年 12 月 31 日」中间，反而把这一行切碎了。
    // 所以判据回到「有锚点才当字段」，无名的一律交人 —— 但不能悄悄丢：
    // reason 要写清是哪一类，且 needs_review 必须为真，复核清单里能逐条看到。
    const rawText = String(candidate?.text || '');
    const isLayoutSpace = rawText.trim().length === 0;
    return {
      category: CATEGORY.IGNORE,
      reason: isLayoutSpace
        ? '空位正文只有排版空格（夹在文字/数字之间），不是待填点'
        : '取不到标签的空位，交人工确认后再决定是否作为字段',
      needs_review: true,
    };
  }

  // 项目标识优先于小节规则：偏离表、报价表表头上的采购编号同样是本项目的编号。
  if (matchesAny(PROJECT_IDENTITY_PATTERNS, name)) {
    return { category: CATEGORY.BUYER_INFO, reason: '本采购项目标识，由招标方给定', needs_review: false };
  }

  if (isTendererSection(section)) {
    return {
      category: CATEGORY.TENDERER_FILL,
      reason: `属于投标人信息小节「${sectionLabel}」，由投标人填写`,
      needs_review: false,
    };
  }

  if (matchesAny(BUYER_NAME_PATTERNS, name)) {
    return { category: CATEGORY.BUYER_INFO, reason: '采购方给定的项目标识，投标人照抄', needs_review: false };
  }

  return { category: CATEGORY.TENDERER_FILL, reason: '响应文件待填点，由投标人填写', needs_review: false };
}

/**
 * 名字规范化。
 *
 * 扫描器的名字来自「标签锚点」，所以「致：＿＿＿」会取出「致」——那是提示词而不是
 * 字段名，实际要填的是采购人名称。这类一眼能看出的错名在这里统一纠正；
 * 纠正后若与其他字段重名，仍会走到下面的同名冲突处理。
 */
const NAME_ALIASES = new Map([
  ['致', '采购人名称'],
]);

function normalizeFieldName(name) {
  const text = String(name || '').trim();
  return NAME_ALIASES.get(text) || text;
}

/** 由类别与人工/AI 判据推导 instruction。 */
function instructionFor(category, fillBy) {
  if (category === CATEGORY.BUYER_INFO || fillBy === 'copy') return INSTRUCTION.BUYER;
  if (fillBy === 'manual') return INSTRUCTION.TENDERER_MANUAL;
  if (fillBy === 'profile') return INSTRUCTION.TENDERER_PROFILE;
  return INSTRUCTION.TENDERER_AI;
}

/**
 * 分类主入口。
 *
 * @param {object} input
 * @param {Array}  input.candidates scan-template-fields 的候选数组
 * @param {Array}  input.blocks     list-blocks 的块数组（同一份文档）
 * @param {string} [input.source]   文档路径，仅用于产物追溯
 */
function classifyTemplateCandidates({ candidates = [], blocks = [], source = '' } = {}) {
  const anchors = buildSectionAnchors(blocks);
  const responseStart = findResponseSectionStart(anchors);

  const items = (candidates || []).map((candidate) => {
    const blockIndex = parseBlockIndex(candidate?.location);
    const anchor = findSectionAnchor(anchors, blockIndex);
    const sectionText = anchor ? anchor.text : '';
    const inResponseSection = responseStart >= 0 && blockIndex >= responseStart;
    const verdict = classifyCandidate(candidate, {
      sectionText,
      sectionMatch: anchor ? anchor.compact : '',
      inResponseSection,
      partitioned: responseStart >= 0,
    });
    const name = String(candidate?.suggested_name || '').trim();
    const fillBy = verdict.category === CATEGORY.IGNORE
      ? ''
      : resolveFillBy(name, candidate?.context, verdict.category);

    return {
      candidate_id: String(candidate?.candidate_id || ''),
      kind: String(candidate?.kind || ''),
      location: String(candidate?.location || ''),
      // 空位正文。复核时要看它是不是只有空格（排版空格 ≠ 待填点），所以带进产物。
      text: String(candidate?.text || ''),
      block: blockIndex,
      section: sectionText,
      suggested_name: name,
      context: String(candidate?.context || ''),
      category: verdict.category,
      fill_by: fillBy,
      instruction: verdict.category === CATEGORY.IGNORE ? '' : instructionFor(verdict.category, fillBy),
      reason: verdict.reason,
      needs_review: verdict.needs_review,
      in_response_section: inResponseSection,
    };
  });

  // 先给每个待填候选定下字段名（含规范化），再做同名冲突处理。
  for (const item of items) {
    if (item.category === CATEGORY.IGNORE) continue;
    item.name = normalizeFieldName(item.suggested_name);
  }

  // 同名冲突处理：不同小节的同一个名字语义不同（业绩表里的「项目名称」是投标人
  // 自己的业绩项目，成交通知书里的「项目名称」是本项目的名称）。
  // apply-template-fields 要求同名字段的 fill_by 与 instruction 必须一致，
  // 所以这里给冲突组统一加上小节编号前缀，让两个字段各自成立。
  applySectionPrefixForConflicts(items);

  const summary = {
    total: items.length,
    [CATEGORY.TENDERER_FILL]: items.filter((item) => item.category === CATEGORY.TENDERER_FILL).length,
    [CATEGORY.BUYER_INFO]: items.filter((item) => item.category === CATEGORY.BUYER_INFO).length,
    [CATEGORY.IGNORE]: items.filter((item) => item.category === CATEGORY.IGNORE).length,
    needs_review: items.filter((item) => item.needs_review).length,
    manual: items.filter((item) => item.fill_by === 'manual').length,
    profile: items.filter((item) => item.fill_by === 'profile').length,
    ai: items.filter((item) => item.fill_by === 'ai').length,
    copy: items.filter((item) => item.fill_by === 'copy').length,
  };

  return {
    version: 1,
    source,
    generated_at: new Date().toISOString(),
    response_section_start: responseStart,
    anchor_count: anchors.length,
    summary,
    items,
  };
}

/**
 * 给「同名但类别或 instruction 不同」的字段加小节编号前缀。
 *
 * 前缀取小节标题里的编号（「3.5 近五年同类物资供货业绩表」→「3.5」），
 * 短且能指回原文，比自造的限定词可解释。
 */
function applySectionPrefixForConflicts(items) {
  const groups = new Map();
  for (const item of items) {
    if (item.category === CATEGORY.IGNORE || !item.name) continue;
    if (!groups.has(item.name)) groups.set(item.name, []);
    groups.get(item.name).push(item);
  }

  for (const [, group] of groups) {
    const signature = (item) => `${item.category}\u0000${item.fill_by}\u0000${item.instruction}`;
    if (new Set(group.map(signature)).size <= 1) continue;
    for (const item of group) {
      const prefix = extractSectionNumber(item.section);
      const base = item.name;
      item.name = prefix ? `${prefix} ${base}` : base;
      item.name_adjusted = true;
      item.name_adjust_reason = '同名但类别/填写方式不同，加小节编号前缀以区分';
    }
  }
}

/**
 * 从小节标题里取编号前缀：「3.5 近五年同类物资供货业绩表」→「3.5」；「附件二：成交通知书」→「附件二」。
 *
 * 编号后的空白是可选的：真实文档里「1．响应函」的编号和标题之间没有空格，
 * 要求必须有空白就会取不到编号，前缀为空 —— 同名字段便躲过区分，apply 直接报冲突。
 */
function extractSectionNumber(section) {
  const text = String(section || '').trim();
  const numbered = /^(\d+(?:\.\d+)*)[．.、]?\s*/.exec(text);
  if (numbered && numbered[1] !== text) return numbered[1];
  const attachment = /^(附件[一二三四五六七八九十百]+)/.exec(text);
  if (attachment) return attachment[1];
  const chapter = /^(第[一二三四五六七八九十百]+[章节篇])/.exec(text);
  if (chapter) return chapter[1];
  return '';
}

/** 字段名：优先用加过前缀的名字，否则用扫描器建议名。 */
function fieldNameOf(item) {
  return String(item.name || item.suggested_name || '').trim();
}

/**
 * 把分类结果转成 apply-template-fields 的请求体。
 *
 * 约定：tenderer_fill 与 buyer_info 都生成字段（两者都要填进投标文件，区别只在于
 * 值从哪来，写进 instruction）；ignore 进 ignored_candidate_ids。
 */
function buildApplyRequest(classification) {
  const fields = [];
  const ignoredCandidateIds = [];
  for (const item of classification?.items || []) {
    if (item.category === CATEGORY.IGNORE || !item.candidate_id) {
      if (item.candidate_id) ignoredCandidateIds.push(item.candidate_id);
      continue;
    }
    fields.push({
      candidate_id: item.candidate_id,
      name: fieldNameOf(item),
      fill_by: item.fill_by,
      instruction: item.instruction || undefined,
    });
  }
  return { fields, ignored_candidate_ids: ignoredCandidateIds };
}

/**
 * 走完「扫描 → 列块 → 分类」的一段，供脚本与产品流程共用。
 *
 * @param {object} service createOpenXmlHelperService 的返回值
 * @param {string} input   workspace 相对路径
 */
async function scanAndClassify(service, input, { timeoutMs = 300000 } = {}) {
  const scanResult = await service.runJob({
    action: 'scan-template-fields',
    request: { input },
    timeoutMs,
  });
  const candidates = readJobJson(scanResult?.jobDir, 'template-field-candidates.json')?.candidates || [];

  const blockResult = await service.runJob({
    action: 'list-blocks',
    request: { sources: [input] },
    timeoutMs,
  });
  const blockPayload = readJobJson(blockResult?.jobDir, 'blocks.json');
  const blocks = blockPayload?.sources?.[0]?.blocks || [];

  return {
    candidates,
    blocks,
    classification: classifyTemplateCandidates({ candidates, blocks, source: input }),
  };
}

function readJobJson(jobDir, fileName) {
  if (!jobDir) return null;
  const target = path.join(jobDir, fileName);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  CATEGORY,
  INSTRUCTION,
  buildApplyRequest,
  buildSectionAnchors,
  classifyCandidate,
  classifyTemplateCandidates,
  compactText,
  extractSectionNumber,
  fieldNameOf,
  findResponseSectionStart,
  findSectionAnchor,
  isManualFill,
  isSectionAnchor,
  isSellerDocumentSection,
  isTableOfContentsEntry,
  isTendererSection,
  parseBlockIndex,
  resolveFillBy,
  scanAndClassify,
};
