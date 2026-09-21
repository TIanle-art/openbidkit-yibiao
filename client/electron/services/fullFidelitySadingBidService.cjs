const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 赛鼎宁波起重设备项目 · 1:1 像素级全要素标书装配服务
 * 严格按照招标文件《NC2060.EQP.P01.90-037 起重设备谈判采购文件》第七章与真实标书《赛鼎 技术文件0818(1).pdf》1:1 结构复刻
 */
function createFullFidelitySadingBidService() {
  function escapeXml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * 构建 1:1 规范封面段落 OpenXML
   */
  function buildCoverParagraphsXml() {
    return `
      <w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr></w:p>
      <w:p>
        <w:pPr>
          <w:jc w:val="center"/>
          <w:spacing w:line="360" w:lineRule="auto"/>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/><w:color w:val="000000"/></w:rPr>
        </w:pPr>
        <w:r>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/><w:color w:val="000000"/></w:rPr>
          <w:t>中国化学赛鼎宁波工程有限公司</w:t>
        </w:r>
      </w:p>
      <w:p>
        <w:pPr>
          <w:jc w:val="center"/>
          <w:spacing w:line="360" w:lineRule="auto"/>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/><w:color w:val="000000"/></w:rPr>
        </w:pPr>
        <w:r>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/><w:color w:val="000000"/></w:rPr>
          <w:t>宁波太一碳元科技有限公司</w:t>
        </w:r>
      </w:p>
      <w:p>
        <w:pPr>
          <w:jc w:val="center"/>
          <w:spacing w:line="360" w:lineRule="auto"/>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/><w:color w:val="000000"/></w:rPr>
        </w:pPr>
        <w:r>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/><w:color w:val="000000"/></w:rPr>
          <w:t>230 吨/年高端碳材料项目</w:t>
        </w:r>
      </w:p>
      <w:p><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:p>
      <w:p><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:p>
      <w:p>
        <w:pPr>
          <w:jc w:val="center"/>
          <w:spacing w:before="240" w:after="240" w:line="500" w:lineRule="auto"/>
          <w:rPr><w:rFonts w:eastAsia="黑体" w:ascii="黑体"/><w:b/><w:sz w:val="72"/><w:szCs w:val="72"/><w:color w:val="000000"/></w:rPr>
        </w:pPr>
        <w:r>
          <w:rPr><w:rFonts w:eastAsia="黑体" w:ascii="黑体"/><w:b/><w:sz w:val="72"/><w:szCs w:val="72"/><w:color w:val="000000"/></w:rPr>
          <w:t>技 术 响 应 文 件</w:t>
        </w:r>
      </w:p>
      <w:p><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:p>
      <w:p><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:p>
      <w:p>
        <w:pPr>
          <w:ind w:left="2200"/>
          <w:spacing w:before="120" w:line="360" w:lineRule="auto"/>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="000000"/></w:rPr>
        </w:pPr>
        <w:r>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="000000"/></w:rPr>
          <w:t>采购编号：NC2060.EQP.P01.90-037</w:t>
        </w:r>
      </w:p>
      <w:p>
        <w:pPr>
          <w:ind w:left="2200"/>
          <w:spacing w:before="120" w:line="360" w:lineRule="auto"/>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="000000"/></w:rPr>
        </w:pPr>
        <w:r>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="000000"/></w:rPr>
          <w:t>标段（包）名称：起重设备</w:t>
        </w:r>
      </w:p>
      <w:p><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:p>
      <w:p><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:p>
      <w:p><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:p>
      <w:p>
        <w:pPr>
          <w:ind w:left="2200"/>
          <w:spacing w:before="100" w:line="360" w:lineRule="auto"/>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="000000"/></w:rPr>
        </w:pPr>
        <w:r>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="000000"/></w:rPr>
          <w:t>申请人： 河南省中原奥起实业有限公司  （盖单位章）</w:t>
        </w:r>
      </w:p>
      <w:p>
        <w:pPr>
          <w:ind w:left="2200"/>
          <w:spacing w:before="100" w:line="360" w:lineRule="auto"/>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="000000"/></w:rPr>
        </w:pPr>
        <w:r>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="000000"/></w:rPr>
          <w:t>法定代表人或其委托代理人：          （签字）</w:t>
        </w:r>
      </w:p>
      <w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr></w:p>
      <w:p>
        <w:pPr>
          <w:jc w:val="center"/>
          <w:spacing w:before="180" w:line="360" w:lineRule="auto"/>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="000000"/></w:rPr>
        </w:pPr>
        <w:r>
          <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="宋体"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="000000"/></w:rPr>
          <w:t>2026 年 8 月 16 日</w:t>
        </w:r>
      </w:p>
    `;
  }

  /**
   * 构建 1:1 赛鼎真实 12 章 24 项目录 OpenXML
   */
  function buildSadingTocXml() {
    const items = [
      { title: '1．响应函', pageNo: '3', bold: true, indent: 0 },
      { title: '2．法定代表人身份证明或附有法定代表人身份证明的授权委托书', pageNo: '4', bold: true, indent: 0 },
      { title: '2.1法定代表人身份证明', pageNo: '4', bold: false, indent: 400 },
      { title: '2.2授权委托书', pageNo: '5', bold: false, indent: 400 },
      { title: '3．资格审查资料', pageNo: '6', bold: true, indent: 0 },
      { title: '3.1 申请人基本情况表', pageNo: '6', bold: false, indent: 400 },
      { title: '3.2 生产能力证明', pageNo: '8', bold: false, indent: 400 },
      { title: '3.3 近两年财务状况表', pageNo: '19', bold: false, indent: 400 },
      { title: '3.4 质量保证能力证明', pageNo: '73', bold: false, indent: 400 },
      { title: '3.5 近五年同类物资供货业绩表', pageNo: '81', bold: false, indent: 400 },
      { title: '3.6 履约信用证明', pageNo: '123', bold: false, indent: 400 },
      { title: '3.7 近年发生的诉讼及仲裁情况', pageNo: '127', bold: false, indent: 400 },
      { title: '4.申请人资格声明', pageNo: '128', bold: true, indent: 0 },
      { title: '5.生产组织供应能力分析表', pageNo: '131', bold: true, indent: 0 },
      { title: '一、生产能力', pageNo: '131', bold: false, indent: 400 },
      { title: '二、运营能力', pageNo: '134', bold: false, indent: 400 },
      { title: '三、财务能力', pageNo: '135', bold: false, indent: 400 },
      { title: '四、应急保障能力', pageNo: '136', bold: false, indent: 400 },
      { title: '6.组织供应、运输、售后服务方案', pageNo: '138', bold: true, indent: 0 },
      { title: '7. 物资技术规格书', pageNo: '140', bold: true, indent: 0 },
      { title: '8. 拟投入本项目的主要生产设备、检验设备表', pageNo: '144', bold: true, indent: 0 },
      { title: '9. 物资运达施工现场后的保护措施和要求', pageNo: '155', bold: true, indent: 0 },
      { title: '10.谈判承诺书', pageNo: '156', bold: true, indent: 0 },
      { title: '11.生产企业简介', pageNo: '157', bold: true, indent: 0 },
      { title: '12.技术偏离表', pageNo: '177', bold: true, indent: 0 },
    ];

    const pXmls = items.map((item) => `
      <w:p>
        <w:pPr>
          <w:pStyle w:val="3"/>
          <w:tabs>
            <w:tab w:val="right" w:leader="dot" w:pos="9070"/>
          </w:tabs>
          <w:spacing w:before="${item.bold ? '60' : '20'}" w:line="230" w:lineRule="auto"/>
          ${item.indent > 0 ? `<w:ind w:left="${item.indent}"/>` : ''}
          <w:rPr>
            <w:rFonts w:eastAsia="宋体" w:ascii="Times New Roman"/>
            <w:sz w:val="21"/>
            <w:szCs w:val="21"/>
            <w:color w:val="000000"/>
            ${item.bold ? '<w:b/>' : ''}
          </w:rPr>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:rFonts w:eastAsia="宋体" w:ascii="Times New Roman"/>
            <w:sz w:val="21"/>
            <w:szCs w:val="21"/>
            <w:color w:val="000000"/>
            ${item.bold ? '<w:b/>' : ''}
          </w:rPr>
          <w:t>${escapeXml(item.title)}</w:t>
        </w:r>
        <w:r>
          <w:rPr>
            <w:rFonts w:eastAsia="宋体" w:ascii="Times New Roman"/>
            <w:sz w:val="21"/>
            <w:szCs w:val="21"/>
            <w:color w:val="000000"/>
          </w:rPr>
          <w:tab/>
        </w:r>
        <w:r>
          <w:rPr>
            <w:rFonts w:eastAsia="Times New Roman" w:ascii="Times New Roman"/>
            <w:sz w:val="21"/>
            <w:szCs w:val="21"/>
            <w:color w:val="000000"/>
            ${item.bold ? '<w:b/>' : ''}
          </w:rPr>
          <w:t>${escapeXml(item.pageNo)}</w:t>
        </w:r>
      </w:p>
    `);

    return `
      <w:sdt>
        <w:sdtPr>
          <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="宋体"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>
          <w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj>
        </w:sdtPr>
        <w:sdtContent>
          ${pXmls.join('\n')}
        </w:sdtContent>
      </w:sdt>
    `;
  }

  /**
   * 构建 1:1 赛鼎技术偏离表 OpenXML 表格
   */
  function buildSadingDeviationTable() {
    const rows = [
      { no: '1', item: '1. 总体供货要求', tenderReq: '起重设备按技术规格书要求整体成套供货，保证工艺运行', bidResp: '完全响应，整机及附属部件成套提供，满足防爆及运行工况', dev: '无偏离', note: '满足' },
      { no: '2', item: '2. 工作级别与机构', tenderReq: '整机工作级别不低于 A5，起升及运行机构满足规范标准', bidResp: '完全响应，整机工作级别 A5，机构按高寿命重载标准设计制造', dev: '无偏离', note: '满足' },
      { no: '3', item: '3. 电气与防护等级', tenderReq: '电机防护等级不低于 IP54/IP55，电气控制柜集中联锁保护', bidResp: '完全响应，电机防护 IP55，F级绝缘，控制箱 IP65，配双重限位', dev: '无偏离', note: '满足' },
      { no: '4', item: '4. 制造与安全检验', tenderReq: '执行 TSG 51-2023 及国家特种设备安全技术规范，提供见证报告', bidResp: '完全响应，编制专检 ITP 检验计划，出厂提供型式试验与自检合格证', dev: '无偏离', note: '满足' },
      { no: '5', item: '5. 交货期与售后服务', tenderReq: '按项目总进度节点交货，质保期内提供 24 小时现场响应服务', bidResp: '完全响应，按期交货，质保期内免费技术支持，2小时响应，24小时到场', dev: '无偏离', note: '满足' },
    ];

    const trs = [];
    trs.push(`
      <w:tr>
        <w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>
        <w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>序号</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>条款/部件名称</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>谈判文件要求</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="3400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>响应及承诺内容</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>偏离情况</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>说明</w:t></w:r></w:p></w:tc>
      </w:tr>
    `);

    for (const r of rows) {
      trs.push(`
        <w:tr>
          <w:trPr><w:cantSplit/></w:trPr>
          <w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${r.no}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${r.item}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${r.tenderReq}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="3400" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${r.bidResp}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="20"/></w:rPr><w:t>${r.dev}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${r.note}</w:t></w:r></w:p></w:tc>
        </w:tr>
      `);
    }

    return `
      <w:tbl>
        <w:tblPr>
          <w:tblW w:w="11800" w:type="dxa"/>
          <w:jc w:val="center"/>
          <w:tblBorders>
            <w:top w:val="single" w:sz="8" w:space="0" w:color="999999"/>
            <w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
            <w:bottom w:val="single" w:sz="8" w:space="0" w:color="999999"/>
            <w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
            <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
            <w:insideV w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
          </w:tblBorders>
        </w:tblPr>
        <w:tblGrid>
          <w:gridCol w:w="800"/><w:gridCol w:w="2000"/><w:gridCol w:w="3200"/><w:gridCol w:w="3400"/><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/>
        </w:tblGrid>
        ${trs.join('')}
      </w:tbl>
    `;
  }

  /**
   * 生成 1:1 赛鼎宁波起重设备投标文件 docx
   * @param {object} params
   * @param {string} params.masterDocxPath 原始高质量母版标书
   * @param {string} params.outputPath 目标产物路径
   */
  async function generateSadingNingboBid({ masterDocxPath, outputPath }) {
    if (!fs.existsSync(masterDocxPath)) {
      throw new Error(`找不到母版标书：${masterDocxPath}`);
    }

    const zip = new AdmZip(masterDocxPath);
    let docXml = zip.readAsText('word/document.xml');

    // 1. 全文清除红色文字，统一转为纯黑 (000000)
    docXml = docXml.replace(/w:color\s+w:val="FF0000"/gi, 'w:color w:val="000000"');
    docXml = docXml.replace(/w:val="FF0000"/gi, 'w:val="000000"');

    // 2. 清理 OCR 坐标残留字符
    docXml = docXml.replace(/1283335-322580/g, '');
    docXml = docXml.replace(/2011045-785495/g, '');
    docXml = docXml.replace(/-296545472440/g, '');
    docXml = docXml.replace(/212725392430/g, '');
    docXml = docXml.replace(/531241024765/g, '');
    docXml = docXml.replace(/2870835153670/g, '');

    const $ = cheerio.load(docXml, { xmlMode: true });

    // 3. 移除所有 sectPr 上的 w:titlePg，确保首页（第1页）正常渲染页眉
    $('w\\:sectPr').each((_, sect) => {
      $(sect).find('w\\:titlePg').remove();
    });

    // 4. 重构封面（Page 1）：替换前 31 个段落为标准化高保真封面元素
    let coverEndP = null;
    $('w\\:body > w\\:p').each((_, p) => {
      if (!coverEndP && $(p).find('w\\:sectPr').length > 0) {
        coverEndP = $(p);
      }
    });

    if (coverEndP && coverEndP.length) {
      coverEndP.prevAll().remove();
      coverEndP.before(buildCoverParagraphsXml());
    }

    // 5. 重构目录（Page 2）：居中标题并替换第一个 sdt
    $('w\\:body > w\\:p').each((_, p) => {
      const t = $(p).text().trim();
      if (t === '投标文件目录' || t === '目 录' || t === '目录') {
        $(p).find('w\\:t').first().text('目    录');
        $(p).find('w\\:t').slice(1).text('');
        let pPr = $(p).find('w\\:pPr');
        if (!pPr.length) {
          $(p).prepend('<w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="000000"/></w:rPr></w:pPr>');
        } else {
          pPr.find('w\\:jc').remove();
          pPr.append('<w:jc w:val="center"/>');
          pPr.find('w\\:spacing').remove();
          pPr.append('<w:spacing w:before="240" w:after="240"/>');
          let rPr = pPr.find('w\\:rPr');
          if (!rPr.length) {
            pPr.append('<w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="000000"/></w:rPr>');
          } else {
            rPr.find('w\\:sz').remove();
            rPr.find('w\\:color').remove();
            rPr.append('<w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="000000"/>');
          }
        }
      }
    });

    const firstSdt = $('w\\:sdt').first();
    if (firstSdt.length) {
      firstSdt.replaceWith(buildSadingTocXml());
    }

    const secondSdt = $('w\\:sdt').eq(1);
    if (secondSdt.length) {
      secondSdt.remove();
    }

    // 6. 替换第12章技术条款偏离表
    const deviationXml = buildSadingDeviationTable();
    let replacedDev = false;
    $('w\\:body > w\\:p').each((_, p) => {
      const text = $(p).text().trim();
      if (!replacedDev && /技术条款偏离表|技术偏离表/.test(text)) {
        const nextTbl = $(p).nextAll('w\\:tbl').first();
        if (nextTbl.length) {
          nextTbl.replaceWith(deviationXml);
          replacedDev = true;
        }
      }
    });

    // 7. 对全部表格注入 cantSplit, tblHeader 与表头底色 #EEF5FF
    $('w\\:tbl').each((_, tbl) => {
      const firstRow = $(tbl).find('w\\:tr').first();
      let firstTrPr = firstRow.find('w\\:trPr');
      if (!firstTrPr.length) {
        firstRow.prepend('<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>');
      } else {
        if (!firstTrPr.find('w\\:tblHeader').length) firstTrPr.prepend('<w:tblHeader/>');
        if (!firstTrPr.find('w\\:cantSplit').length) firstTrPr.append('<w:cantSplit/>');
      }

      firstRow.find('w\\:tc').each((_, tc) => {
        let tcPr = $(tc).find('w\\:tcPr');
        if (!tcPr.length) {
          $(tc).prepend('<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/></w:tcPr>');
        } else {
          const shd = tcPr.find('w\\:shd');
          if (!shd.length || shd.attr('w:fill') === 'FFFFFF' || shd.attr('w:fill') === 'auto') {
            shd.remove();
            tcPr.append('<w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/>');
          }
        }
      });

      $(tbl).find('w\\:tr').slice(1).each((_, tr) => {
        let trPr = $(tr).find('w\\:trPr');
        if (!trPr.length) {
          $(tr).prepend('<w:trPr><w:cantSplit/></w:trPr>');
        } else if (!trPr.find('w\\:cantSplit').length) {
          trPr.append('<w:cantSplit/>');
        }
      });
    });

    // 8. 为正文所有长段落（>30字）注入 2 字符首行缩进
    $('w\\:p').each((_, p) => {
      const t = $(p).text().trim();
      if (t.length > 30 && $(p).parents('w\\:tbl').length === 0 && $(p).parents('w\\:sdt').length === 0) {
        let pPr = $(p).find('w\\:pPr');
        if (!pPr.length) {
          $(p).prepend('<w:pPr><w:ind w:firstLineChars="200" w:firstLine="480"/></w:pPr>');
        } else {
          let ind = pPr.find('w\\:ind');
          if (!ind.length) {
            pPr.append('<w:ind w:firstLineChars="200" w:firstLine="480"/>');
          } else if (!ind.attr('w:firstLine') && !ind.attr('w:firstLineChars')) {
            ind.attr('w:firstLineChars', '200');
            ind.attr('w:firstLine', '480');
          }
        }
      }
    });

    // 9. 更新 header.xml 中的内容与下划线，确保显示《河南省中原奥起实业有限公司投标文件》
    const headerEntries = zip.getEntries().filter(e => e.entryName.startsWith('word/header') && e.entryName.endsWith('.xml'));
    for (const h of headerEntries) {
      let xml = zip.readAsText(h.entryName);
      xml = xml.replace(/华陆工程科技有限责任公司/g, '中国化学赛鼎宁波工程有限公司');
      xml = xml.replace(/24058-XJ-RM012/g, 'NC2060.EQP.P01.90-037');
      if (!xml.includes('w:bottom') && !xml.includes('w:pBdr')) {
        xml = xml.replace(/<w:pPr>/g, '<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr>');
      }
      zip.updateFile(h.entryName, Buffer.from(xml, 'utf-8'));
    }

    // 10. 写入更新后的 document.xml
    zip.updateFile('word/document.xml', Buffer.from($.xml(), 'utf-8'));

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // 写入文件（处理目标文件被用户在 Word 中打开占用锁定的情况）
    let actualSavedPath = outputPath;
    try {
      zip.writeZip(outputPath);
    } catch (err) {
      if (err.code === 'EBUSY') {
        const altPath = outputPath.replace(/\.docx$/, '_1比1像素级复刻版.docx');
        zip.writeZip(altPath);
        actualSavedPath = altPath;
      } else {
        throw err;
      }
    }

    const stats = fs.statSync(actualSavedPath);
    return {
      success: true,
      outputPath: actualSavedPath,
      fileSizeBytes: stats.size,
      fileSizeMb: Number((stats.size / 1024 / 1024).toFixed(2)),
      replacedDeviation: replacedDev,
      buyer: '中国化学赛鼎宁波工程有限公司',
      project: '宁波太一碳元科技有限公司 230 吨/年高端碳材料项目',
      procNo: 'NC2060.EQP.P01.90-037',
    };
  }

  return {
    generateSadingNingboBid,
    buildSadingDeviationTable,
  };
}

module.exports = {
  createFullFidelitySadingBidService,
};
