const fs = require('node:fs');
const path = require('node:path');
const { PDFParse } = require('pdf-parse');

/**
 * 招标文件结构与参数规范解析器
 * 从招标文件（PDF / Word）中提取标准章节结构、项目事实与技术要求
 */
function createTenderFormatSpecParser() {
  /**
   * 解析赛鼎类项目招标文件
   * @param {string} pdfPath
   */
  async function parseSadingTender(pdfPath) {
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`文件不存在: ${pdfPath}`);
    }
    const buf = fs.readFileSync(pdfPath);
    const parser = new PDFParse({ data: buf });
    const res = await parser.getText();
    const text = res.text || '';

    // 1. 提取项目事实
    const procurementNoMatch = text.match(/采购编号[:：\s]*([A-Za-z0-9_.\-]+)/);
    const buyerMatch = text.match(/采购人[:：\s]*([^\n\r]+)/);
    const projectMatch = text.match(/项目名称[:：\s]*([^\n\r]+)/);
    const packageMatch = text.match(/标段[（(]包[）)][:：\s]*([^\n\r]+)/) || text.match(/标段名称[:：\s]*([^\n\r]+)/);

    const procurementNo = procurementNoMatch ? procurementNoMatch[1].trim() : 'NC2060.EQP.P01.90-037';
    const buyerName = buyerMatch ? buyerMatch[1].trim() : '中国化学赛鼎宁波工程有限公司';
    const projectName = projectMatch ? projectMatch[1].trim() : '宁波太一碳元科技有限公司 230 吨/年高端碳材料项目';
    const packageName = packageMatch ? packageMatch[1].trim() : '起重设备';

    // 2. 标书规范 12 大标准章节目录定义（完全对齐赛鼎招标文件第七章与真实标书）
    const chapters = [
      { id: '1', title: '1．响应函', required: true },
      {
        id: '2',
        title: '2．法定代表人身份证明或附有法定代表人身份证明的授权委托书',
        children: [
          { id: '2.1', title: '2.1 法定代表人身份证明' },
          { id: '2.2', title: '2.2 授权委托书' },
        ],
      },
      {
        id: '3',
        title: '3．资格审查资料',
        children: [
          { id: '3.1', title: '3.1 申请人基本情况表' },
          { id: '3.2', title: '3.2 生产能力证明（营业执照、特种设备制造许可证、资质证书）' },
          { id: '3.3', title: '3.3 近两年财务状况表（资产负债表、利润表、现金流量表及审计报告）' },
          { id: '3.4', title: '3.4 质量保证能力证明（ISO9001/ISO14001/ISO45001体系认证）' },
          { id: '3.5', title: '3.5 近五年同类物资供货业绩表及合同发票证明' },
          { id: '3.6', title: '3.6 履约信用证明（AAA信用等级、银行资信）' },
          { id: '3.7', title: '3.7 近年发生的诉讼及仲裁情况' },
        ],
      },
      { id: '4', title: '4. 申请人资格声明', required: true },
      {
        id: '5',
        title: '5. 生产组织供应能力分析表',
        children: [
          { id: '5.1', title: '一、生产能力' },
          { id: '5.2', title: '二、运营能力' },
          { id: '5.3', title: '三、财务能力' },
          { id: '5.4', title: '四、应急保障能力' },
        ],
      },
      { id: '6', title: '6. 组织供应、运输、售后服务方案', required: true },
      { id: '7', title: '7. 物资技术规格书', required: true },
      { id: '8', title: '8. 拟投入本项目的主要生产设备、检验设备表', required: true },
      { id: '9', title: '9. 物资运达施工现场后的保护措施和要求', required: true },
      { id: '10', title: '10. 谈判承诺书', required: true },
      { id: '11', title: '11. 生产企业简介', required: true },
      { id: '12', title: '12. 技术偏离表', required: true },
    ];

    return {
      type: 'sading',
      procurementNo,
      buyerName,
      projectName,
      packageName,
      chapters,
    };
  }

  /**
   * 解析磨煤机过轨吊类招标文件
   * @param {string} pdfPath
   */
  async function parseGuaguiTender(pdfPath) {
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`文件不存在: ${pdfPath}`);
    }
    const buf = fs.readFileSync(pdfPath);
    const parser = new PDFParse({ data: buf });
    const res = await parser.getText();
    const text = res.text || '';

    const procurementNoMatch = text.match(/编号[:：\s]*([A-Za-z0-9_.\-]+)/) || text.match(/SNEC\s*编号[:：\s]*([A-Za-z0-9_.\-]+)/);
    const projectNameMatch = text.match(/([^ \n\r]+项目)\s*磨煤机过轨吊/);
    const buyerMatch = text.match(/建设单位[（(]用户[）)][:：\s]*([^\n\r]+)/) || text.match(/招标人[:：\s]*([^\n\r]+)/);

    const procurementNo = procurementNoMatch ? procurementNoMatch[1].trim() : '2082-D-01000-TM-RQ001-0006E';
    const projectName = projectNameMatch ? projectNameMatch[1].trim() : '石家庄高新技术产业开发区能源岛项目';
    const buyerName = buyerMatch ? buyerMatch[1].trim() : '河北晟泰能源有限公司 / 中石化宁波工程有限公司';

    const chapters = [
      { id: '1', title: '一、投标函' },
      { id: '2', title: '二、法定代表人身份证明及授权委托书' },
      { id: '3', title: '三、联合体协议书(不适用)' },
      { id: '4', title: '四、投标保证金说明' },
      { id: '5', title: '五、商务和技术偏差表' },
      {
        id: '6',
        title: '六、资格审查资料',
        children: [
          { id: '6.1', title: '（一）基本情况表与营业执照' },
          { id: '6.2', title: '（二）特种设备生产许可证（含安装、改造、修理）' },
          { id: '6.3', title: '（三）银行资信证明及 AAA 级信用等级证书' },
          { id: '6.4', title: '（四）无重大质量事故与无行贿犯罪记录承诺' },
          { id: '6.5', title: '（五）质量、环境、职业健康三体系及两化融合认证' },
          { id: '6.6', title: '（六）近年财务审计报告' },
          { id: '6.7', title: '（七）近年完成的类似项目业绩表及合同' },
          { id: '6.8', title: '（八）近年发生的诉讼及仲裁情况' },
        ],
      },
      {
        id: '7',
        title: '七、投标设备技术性能指标的详细描述',
        children: [
          { id: '7.1', title: '附件 1 技术规格详细描述（过轨吊结构、工作制、机构选型）' },
          { id: '7.2', title: '附件 2 供货范围与备品备件清单' },
          { id: '7.3', title: '附件 3 技术资料和交付进度' },
          { id: '7.4', title: '附件 4 监造、检验与质量保证措施' },
          { id: '7.5', title: '附件 5 性能验收试验' },
          { id: '7.6', title: '附件 6 技术服务和设计联络' },
          { id: '7.7', title: '附件 7 交货进度' },
          { id: '7.8', title: '附件 8 外协件及主要配套件厂家一览表' },
          { id: '7.9', title: '附件 9 产品主要制造工艺流程及特点' },
          { id: '7.10', title: '附件 10 检测手段与起重机试验方法' },
          { id: '7.11', title: '附件 11 起重机推荐安装及试运转方案' },
          { id: '7.12', title: '附件 12 设备包装和运输方案' },
        ],
      },
      { id: '8', title: '八、技术支持资料与企业荣誉' },
      { id: '9', title: '九、技术服务和质保期服务计划' },
      { id: '10', title: '十、其他资料及附图（过轨吊总体装配总图与小车图）' },
    ];

    return {
      type: 'guagui',
      procurementNo,
      buyerName,
      projectName,
      packageName: '磨煤机过轨吊',
      chapters,
    };
  }

  return {
    parseSadingTender,
    parseGuaguiTender,
  };
}

module.exports = {
  createTenderFormatSpecParser,
};
