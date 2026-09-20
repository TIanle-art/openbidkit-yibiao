'use strict';

/**
 * 企业资料库 —— `profile` 类字段的取值来源。
 *
 * 铁律：**取不到就留空，绝不编造。**
 *   姓名、营业执照号、开户行账号这类值，编出来就是一份假的投标文件。
 *   宁可让格子里留着「【待填】」让人手填，也不能让模型顺手写个看起来像的数。
 *
 * 匹配顺序不能反：
 *   1. 精确匹配（剥掉小节编号前缀后）；
 *   2. 别名归一（「申请人名称」「单位名称」「投标人名称」都是企业名）；
 *   3. 都没有 → 返回空串。
 *   **不做模糊包含匹配**——「地址」能同时命中「单位地址」「采购人地址」「总部地址」，
 *   这三个根本不是一回事，猜错比留空更糟。
 *
 * 资料库里没有的键会被记进 missing，产物里输出成「待补资料清单」，
 * 那才是给用户的行动项：他知道该去补哪份证照。
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'company-profile.json';

/** 别名 → 规范键。左列是文档里可能出现的叫法。 */
const ALIAS_TO_KEY = {
  申请人名称: 'company_name',
  申请人: 'company_name',
  单位名称: 'company_name',
  投标人名称: 'company_name',
  供应商名称: 'company_name',
  企业名称: 'company_name',
  制造厂名称: 'company_name',

  单位性质: 'company_nature',
  企业性质: 'company_nature',

  地址: 'company_address',
  单位地址: 'company_address',
  注册地址: 'company_address',
  总部地址: 'company_address',
  企业地址: 'company_address',

  成立时间: 'founded_date',
  '成立和或注册日期': 'founded_date',
  '成立和/或注册日期': 'founded_date',
  注册日期: 'founded_date',

  经营期限: 'business_term',
  营业期限: 'business_term',

  姓名: 'legal_rep_name',
  法定代表人姓名: 'legal_rep_name',
  法人姓名: 'legal_rep_name',
  性别: 'legal_rep_gender',
  年龄: 'legal_rep_age',
  职务: 'legal_rep_title',
  // 注意：技术职称 ≠ 职务。「高级工程师」是职称，「董事长」是职务，混了就会把
  // 职务当成职称填进表里。既然资料里没有职称，就让它留空。
  技术职称: 'professional_title',

  邮政编码: 'postal_code',
  邮编: 'postal_code',

  联系人: 'contact_person',
  电话: 'phone',
  联系电话: 'phone',
  传真: 'fax',
  传真电话号码: 'fax',
  '传真/电话号码': 'fax',
  网址: 'website',
  '网址（或电子邮箱）': 'website',
  电子邮箱: 'email',

  总部地址: 'company_address',
  实收资本: 'paid_in_capital',

  员工总人数: 'staff_total',
  高级职称人员: 'staff_senior',
  中级职称人员: 'staff_middle',
  初级职称人员: 'staff_junior',
  技工: 'staff_technician',

  营业执照号: 'license_no',
  统一社会信用代码: 'license_no',

  注册资金: 'registered_capital',
  注册资本: 'registered_capital',
  实收资本: 'paid_in_capital',
  固定资产: 'fixed_assets',
  流动资产: 'current_assets',
  长期负债: 'long_term_liabilities',
  流动负债: 'current_liabilities',
  净值: 'net_worth',

  开户银行: 'bank_name',
  开立基本帐户银行的名称和地址: 'bank_name',
  开户行: 'bank_name',
  账号: 'bank_account',
  银行账号: 'bank_account',

  经营范围: 'business_scope',
  特种设备生产许可证: 'permit_no',
  开户银行名称和地址: 'bank_name',
  所属的集团公司: 'parent_group',
  员工总人数: 'staff_total',
  '物资（最大月生产能力）': 'max_monthly_capacity',
  '物资（已签合同）': 'signed_contract_monthly',
  '物资（剩余月生产能力）': 'remaining_monthly_capacity',
  '物资（交货周期）': 'delivery_cycle',
};

/**
 * 资料库模板：建库时写入，值为空。
 * 这些键覆盖本次 81 个 profile 字段里属于「企业自身登记信息」的那部分；
 * 业绩台账类（合同金额、交货日期、项目所在地……）是逐行数据，不在企业基本信息里，
 * 需要单独的业绩台账文件，目前同样「取不到就留空」。
 */
const TEMPLATE_KEYS = [
  'company_name',
  'company_nature',
  'company_address',
  'founded_date',
  'business_term',
  'legal_rep_name',
  'legal_rep_gender',
  'legal_rep_age',
  'legal_rep_title',
  'postal_code',
  'contact_person',
  'phone',
  'fax',
  'website_email',
  'email',
  'permit_no',
  'parent_group',
  'staff_total',
  'staff_senior',
  'staff_middle',
  'staff_junior',
  'staff_technician',
  'license_no',
  'registered_capital',
  'paid_in_capital',
  'fixed_assets',
  'current_assets',
  'long_term_liabilities',
  'current_liabilities',
  'net_worth',
  'bank_name',
  'bank_account',
  'business_scope',
];

function stripSectionPrefix(name) {
  return String(name || '')
    .replace(/^附件[一二三四五六七八九十百]+\s*/, '')
    .replace(/^第[一二三四五六七八九十百]+[章节篇]\s*/, '')
    .replace(/^\d+(?:\.\d+)*\s+/, '')
    .trim();
}

/** 括号、斜杠这类差异不影响匹配：「成立和/或注册日期」与「成立和或注册日期」是同一个键。 */
function canonicalize(name) {
  return stripSectionPrefix(name).replace(/[（(]/g, '（').replace(/[）)]/g, '）');
}

function createCompanyProfileStore({ app, storageDir } = {}) {
  const dir = storageDir || (app?.getPath ? app.getPath('userData') : '');
  if (!dir) throw new Error('拿不到 userData 目录，无法定位企业资料库');
  const filePath = path.join(dir, FILE_NAME);

  function load() {
    if (!fs.existsSync(filePath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * 建库：优先从种子文件复制（仓库里那份填好的真实资料），没有种子才写空模板。
   * 文件已存在则一律不动——用户手改过的资料不能被覆盖。
   */
  function ensureTemplate({ seedFile } = {}) {
    if (fs.existsSync(filePath)) return { created: false, filePath, profile: load(), source: 'existing' };
    if (seedFile && fs.existsSync(seedFile)) {
      const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
      return { created: true, filePath, profile: seed, source: 'seed' };
    }
    const fields = {};
    for (const key of TEMPLATE_KEYS) fields[key] = '';
    const profile = {
      version: 1,
      note: '企业资料库：值为空即「未采集」，填值时一律取不到就留空，绝不编造。',
      updated_at: new Date().toISOString(),
      fields,
      performance: [],
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
    return { created: true, filePath, profile, source: 'template' };
  }

  function save(profile) {
    const next = { ...(profile || {}), updated_at: new Date().toISOString() };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  /**
   * 按字段名取值。
   * @returns {{value: string, key: string, matched: boolean}}
   */
  function get(name) {
    const profile = load();
    const fields = profile?.fields || {};
    const raw = String(name || '').trim();
    const bare = canonicalize(raw);

    // 1. 规范键直取（资料库本身用规范键存）
    if (fields[bare]) return { value: String(fields[bare]), key: bare, matched: true };

    // 2. 别名归一
    const key = ALIAS_TO_KEY[bare] || ALIAS_TO_KEY[canonicalize(raw.replace(/（或电子邮箱）/, ''))];
    if (key && fields[key]) return { value: String(fields[key]), key, matched: true };

    // 3. 直接按文档字段名存过（用户可能照着文档里的名字补的）
    if (fields[raw]) return { value: String(fields[raw]), key: raw, matched: true };

    return { value: '', key: key || '', matched: false };
  }

  /** 业绩台账（逐行）。表格里的「项目名称/合同价格/交货日期」要按行取，不能取标量。 */
  function performanceRows() {
    return load()?.performance || [];
  }

  /** 取第 index 行（从 0 开始）业绩台账；没有就返回空对象。 */
  function getPerformanceRow(index) {
    const rows = performanceRows();
    return rows[index] || null;
  }

  return {
    filePath,
    load,
    save,
    get,
    ensureTemplate,
    performanceRows,
    getPerformanceRow,
    available: () => fs.existsSync(filePath),
  };
}

/** 文档里的业绩字段名 → 台账里的键。 */
const PERFORMANCE_FIELD_KEYS = {
  项目名称: 'project_name',
  项目所在地: 'project_location',
  采购人名称: 'buyer_name',
  采购人地址: 'buyer_address',
  采购人电话: 'buyer_phone',
  合同价格: 'contract_price',
  合同金额: 'contract_price',
  交货起始日期: 'delivery_start',
  交货截止日期: 'delivery_end',
  最终交货日期: 'delivery_end',
  合同编号: 'contract_no',
  数量: 'quantity',
  用户名称: 'buyer_name',
  销售项目名称: 'project_name',
  设备名称: 'goods_name',
};

/** 判断字段名是否属于业绩台账类（按行取值的那些）。 */
function performanceKeyOf(name) {
  const bare = canonicalize(name).replace(/^.*?\s+/, '');
  return PERFORMANCE_FIELD_KEYS[canonicalize(name)] || PERFORMANCE_FIELD_KEYS[bare] || '';
}

module.exports = {
  createCompanyProfileStore,
  ALIAS_TO_KEY,
  TEMPLATE_KEYS,
  PERFORMANCE_FIELD_KEYS,
  performanceKeyOf,
  FILE_NAME,
  _internal: { stripSectionPrefix, canonicalize },
};
