const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 石家庄能源岛磨煤机过轨吊项目 · 1:1 像素级全要素标书装配服务
 * 严格按照中石化宁波工程招标文件《2082-D-01000-TM-RQ001-0006E 磨煤机过轨吊请购技术文件》与真实标书《圣起过轨吊投标文件.pdf》1:1 结构复刻
 */
function createFullFidelityGuaguiBidService() {
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
  function buildGuaguiCoverParagraphsXml() {
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
          <w:t>石家庄高新技术产业开发区能源岛项目</w:t>
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
          <w:t>中速磨煤机用过轨起重机设备采购</w:t>
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
          <w:t>设备采购招标项目</w:t>
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
          <w:t>投  标  文  件</w:t>
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
          <w:t>招标编号： 2082-D-01000-TM-RQ001-0006E</w:t>
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
          <w:t>标段（包）名称：磨煤机过轨吊</w:t>
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
          <w:t>投标人： （单位盖章 / CA 签章）河南圣起机械集团有限公司</w:t>
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
          <w:t>法定代表人（单位负责人）： （签字 / 个人 CA 签章）齐景亮</w:t>
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
          <w:t>2026 年 5 月 9 日</w:t>
        </w:r>
      </w:p>
    `;
  }

  /**
   * 构建过轨吊第 2 页目录 OpenXML
   */
  function buildGuaguiTocPart1Xml() {
    const items = [
      { title: '一、投标函', pageNo: '1', bold: true, indent: 0 },
      { title: '二、法定代表人（单位负责人）身份证明', pageNo: '3', bold: true, indent: 0 },
      { title: '三、联合体协议书(不适用）', pageNo: '4', bold: true, indent: 0 },
      { title: '四、投标保证金', pageNo: '5', bold: true, indent: 0 },
      { title: '五、商务和技术偏差表', pageNo: '6', bold: true, indent: 0 },
      { title: '五、分项报价表', pageNo: '7', bold: true, indent: 0 },
      { title: '分包与外购报价表', pageNo: '8', bold: false, indent: 240 },
      { title: '六、资格审查资料', pageNo: '9', bold: true, indent: 0 },
      { title: '（一）基本情况表', pageNo: '9', bold: false, indent: 240 },
      { title: '（1）营业执照（三证合一）', pageNo: '10', bold: false, indent: 480 },
      { title: '（2）特种设备生产许可证（含安装、修理、改造）', pageNo: '11', bold: false, indent: 480 },
      { title: '（3）基本账户开户许可证复印件', pageNo: '12', bold: false, indent: 480 },
      { title: '（4）其它资格资料', pageNo: '13', bold: false, indent: 480 },
      { title: ' 银行资信证明及 AAA 级信用等级证书', pageNo: '13', bold: false, indent: 720 },
      { title: ' 最近三年内发生重大产品质量问题证明', pageNo: '15', bold: false, indent: 720 },
      { title: ' 在全国企业信用信息公示系统中列入严重违法失信企业名单查询结果', pageNo: '16', bold: false, indent: 720 },
      { title: ' 在“信用中国”网站列入失信被执行人查询结果', pageNo: '17', bold: false, indent: 720 },
      { title: ' 在近三年内无行贿犯罪行为记录', pageNo: '19', bold: false, indent: 720 },
      { title: ' 质量管理体系认证证书', pageNo: '21', bold: false, indent: 720 },
      { title: ' 环境管理体系认证证书', pageNo: '22', bold: false, indent: 720 },
      { title: ' 职业健康安全管理体系认证证书', pageNo: '23', bold: false, indent: 720 },
      { title: ' 两化融合管理体系评定证书', pageNo: '24', bold: false, indent: 720 },
      { title: ' 武器装备质量管理体系认证证书', pageNo: '25', bold: false, indent: 720 },
      { title: ' 质量保证体系', pageNo: '26', bold: false, indent: 720 },
      { title: ' 企业简介', pageNo: '28', bold: false, indent: 720 },
      { title: ' 实用新型专利证书及获奖荣誉证书', pageNo: '35', bold: false, indent: 720 },
      { title: '（二）近年财务状况表', pageNo: '50', bold: false, indent: 240 },
      { title: '（三）近年完成的类似项目情况表', pageNo: '111', bold: false, indent: 240 },
      { title: '（四）正在供货和新承接的项目情况表', pageNo: '131', bold: false, indent: 240 },
    ];

    const pXmls = items.map((item) => `
      <w:p>
        <w:pPr>
          <w:pStyle w:val="3"/>
          <w:tabs>
            <w:tab w:val="right" w:leader="dot" w:pos="9070"/>
          </w:tabs>
          <w:spacing w:before="${item.bold ? '50' : '15'}" w:line="220" w:lineRule="auto"/>
          ${item.indent > 0 ? `<w:ind w:left="${item.indent}"/>` : ''}
          <w:rPr>
            <w:rFonts w:eastAsia="宋体" w:ascii="Times New Roman"/>
            <w:sz w:val="20"/>
            <w:szCs w:val="20"/>
            <w:color w:val="000000"/>
            ${item.bold ? '<w:b/>' : ''}
          </w:rPr>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:rFonts w:eastAsia="宋体" w:ascii="Times New Roman"/>
            <w:sz w:val="20"/>
            <w:szCs w:val="20"/>
            <w:color w:val="000000"/>
            ${item.bold ? '<w:b/>' : ''}
          </w:rPr>
          <w:t>${escapeXml(item.title)}</w:t>
        </w:r>
        <w:r>
          <w:rPr>
            <w:rFonts w:eastAsia="宋体" w:ascii="Times New Roman"/>
            <w:sz w:val="20"/>
            <w:szCs w:val="20"/>
            <w:color w:val="000000"/>
          </w:rPr>
          <w:tab/>
        </w:r>
        <w:r>
          <w:rPr>
            <w:rFonts w:eastAsia="Times New Roman" w:ascii="Times New Roman"/>
            <w:sz w:val="20"/>
            <w:szCs w:val="20"/>
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
          <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="宋体"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
          <w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj>
        </w:sdtPr>
        <w:sdtContent>
          ${pXmls.join('\n')}
        </w:sdtContent>
      </w:sdt>
    `;
  }

  /**
   * 构建过轨吊第 3 页目录 OpenXML
   */
  function buildGuaguiTocPart2Xml() {
    const items = [
      { title: '（五）近年发生的诉讼及仲裁情况', pageNo: '143', bold: false, indent: 240 },
      { title: '七、投标设备技术性能指标的详细描述', pageNo: '144', bold: true, indent: 0 },
      { title: '附件 1 技术规范', pageNo: '144', bold: false, indent: 240 },
      { title: '附件 2 供货范围', pageNo: '156', bold: false, indent: 240 },
      { title: '附件 3 技术资料和交付进度', pageNo: '158', bold: false, indent: 240 },
      { title: '附件 4 监造、检验', pageNo: '160', bold: false, indent: 240 },
      { title: '附件 5 性能验收试验', pageNo: '162', bold: false, indent: 240 },
      { title: '附件 6 技术服务和设计联络', pageNo: '163', bold: false, indent: 240 },
      { title: '附件 7 交货进度', pageNo: '165', bold: false, indent: 240 },
      { title: '附件 8 分包与外购', pageNo: '166', bold: false, indent: 240 },
      { title: '附件 9 大部件情况', pageNo: '167', bold: false, indent: 240 },
      { title: '附件 10 招标文件附图', pageNo: '168', bold: false, indent: 240 },
      { title: '附件 11 差异表', pageNo: '169', bold: false, indent: 240 },
      { title: '附件 12 投标人需要说明的其它问题', pageNo: '170', bold: false, indent: 240 },
      { title: ' 中速磨煤机用过轨起重机通用技术描述', pageNo: '170', bold: false, indent: 480 },
      { title: ' 先进性、经济性、环保性', pageNo: '171', bold: false, indent: 480 },
      { title: ' 新技术、新材料的应用', pageNo: '172', bold: false, indent: 480 },
      { title: ' 外协件厂家一览表', pageNo: '173', bold: false, indent: 480 },
      { title: ' 产品的主要制造工艺流程及特点', pageNo: '174', bold: false, indent: 480 },
      { title: ' 质量保证措施', pageNo: '175', bold: false, indent: 480 },
      { title: ' 检测手段', pageNo: '180', bold: false, indent: 480 },
      { title: ' 起重机试验的手段和方法', pageNo: '182', bold: false, indent: 480 },
      { title: ' 起重机推荐安装方案', pageNo: '184', bold: false, indent: 480 },
      { title: ' 设备包装和运输方案', pageNo: '190', bold: false, indent: 480 },
      { title: '八、技术支持资料', pageNo: '193', bold: true, indent: 0 },
      { title: '九、技术服务和质保期服务计划', pageNo: '196', bold: true, indent: 0 },
      { title: '十、其他资料', pageNo: '198', bold: true, indent: 0 },
      { title: '十二、招标代理服务费承诺书', pageNo: '199', bold: true, indent: 0 },
      { title: '图纸--附', pageNo: '200', bold: true, indent: 0 },
    ];

    const pXmls = items.map((item) => `
      <w:p>
        <w:pPr>
          <w:pStyle w:val="3"/>
          <w:tabs>
            <w:tab w:val="right" w:leader="dot" w:pos="9070"/>
          </w:tabs>
          <w:spacing w:before="${item.bold ? '50' : '15'}" w:line="220" w:lineRule="auto"/>
          ${item.indent > 0 ? `<w:ind w:left="${item.indent}"/>` : ''}
          <w:rPr>
            <w:rFonts w:eastAsia="宋体" w:ascii="Times New Roman"/>
            <w:sz w:val="20"/>
            <w:szCs w:val="20"/>
            <w:color w:val="000000"/>
            ${item.bold ? '<w:b/>' : ''}
          </w:rPr>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:rFonts w:eastAsia="宋体" w:ascii="Times New Roman"/>
            <w:sz w:val="20"/>
            <w:szCs w:val="20"/>
            <w:color w:val="000000"/>
            ${item.bold ? '<w:b/>' : ''}
          </w:rPr>
          <w:t>${escapeXml(item.title)}</w:t>
        </w:r>
        <w:r>
          <w:rPr>
            <w:rFonts w:eastAsia="宋体" w:ascii="Times New Roman"/>
            <w:sz w:val="20"/>
            <w:szCs w:val="20"/>
            <w:color w:val="000000"/>
          </w:rPr>
          <w:tab/>
        </w:r>
        <w:r>
          <w:rPr>
            <w:rFonts w:eastAsia="Times New Roman" w:ascii="Times New Roman"/>
            <w:sz w:val="20"/>
            <w:szCs w:val="20"/>
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
          <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="宋体"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
          <w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj>
        </w:sdtPr>
        <w:sdtContent>
          ${pXmls.join('\n')}
        </w:sdtContent>
      </w:sdt>
    `;
  }

  /**
   * 构建磨煤机过轨吊专属技术规范与偏离表 OpenXML
   */
  function buildGuaguiDeviationTable() {
    const rows = [
      { no: '1', item: '1. 设备名称及用途', tenderReq: '磨煤机专用过轨起重机（过轨吊），用于磨煤机磨辊及主要部件检修起吊', bidResp: '完全响应。选用中速磨煤机专用过轨起重机，刚度与悬臂跨度严格满足工艺要求', dev: '无偏离', note: '完全满足' },
      { no: '2', item: '2. 额定起重量与跨度', tenderReq: '起重量满足磨煤机大修最重件要求，悬臂过轨对接平稳，过轨锁紧可靠', bidResp: '完全响应。额定起重量 20t/5t，悬臂跨度 8.5m，过轨联锁精准定位', dev: '正偏离', note: '过轨锁紧双重联锁' },
      { no: '3', item: '3. 整机工作制与防爆', tenderReq: '整机工作级别 A5，电气防爆/防护等级 IP55，适应粉尘重工业环境', bidResp: '完全响应。整机 A5 级，起升机构 M5，全机防尘密闭，电机 IP55/F级绝缘', dev: '无偏离', note: '耐恶劣环境' },
      { no: '4', item: '4. 控制方式与保护', tenderReq: '地面遥控及手电门联动控制，具备过轨对中锁定、双起升限位与超载限制', bidResp: '采用无线遥控+备用悬挂手电门，配备机械电气双重过轨闭锁及数字超载限位', dev: '正偏离', note: '双控制回路冗余' },
      { no: '5', item: '5. 制造标准与检验', tenderReq: '执行 TSG 51 特种设备规程及 GB/T 3811，出厂配合监检并提供试验报告', bidResp: '完全响应。执行出厂整体预装及过轨试车，提供完备 ITP 质量记录及监验证书', dev: '无偏离', note: '国家特检认证' },
    ];

    const trs = [];
    trs.push(`
      <w:tr>
        <w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>
        <w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>序号</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>请购技术要求条款</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>招标文件技术规格</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="3400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>投标响应及设计参数</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>偏离情况</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>备注</w:t></w:r></w:p></w:tc>
      </w:tr>
    `);

    for (const r of rows) {
      trs.push(`
        <w:tr>
          <w:trPr><w:cantSplit/></w:trPr>
          <w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${r.no}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${r.item}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${r.tenderReq}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="3400" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${r.bidResp}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="20"/></w:rPr><w:t>${r.dev}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="20"/></w:rPr><w:t>${r.note}</w:t></w:r></w:p></w:tc>
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
          <w:gridCol w:w="800"/><w:gridCol w:w="2200"/><w:gridCol w:w="3000"/><w:gridCol w:w="3400"/><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/>
        </w:tblGrid>
        ${trs.join('')}
      </w:tbl>
    `;
  }

  /**
   * 生成 1:1 磨煤机过轨吊投标文件 docx
   * @param {object} params
   * @param {string} params.masterDocxPath 标书母版路径
   * @param {string} params.outputPath 目标产物路径
   */
  async function generateGuaguiBid({ masterDocxPath, outputPath }) {
    if (!fs.existsSync(masterDocxPath)) {
      throw new Error(`找不到母版标书：${masterDocxPath}`);
    }

    const zip = new AdmZip(masterDocxPath);
    let docXml = zip.readAsText('word/document.xml');

    // 1. 全局清除红色文字 -> 纯黑 000000
    docXml = docXml.replace(/w:color\s+w:val="FF0000"/gi, 'w:color w:val="000000"');
    docXml = docXml.replace(/w:val="FF0000"/gi, 'w:val="000000"');

    // 2. 清理 OCR 残留坐标与数字
    docXml = docXml.replace(/1283335-322580/g, '');
    docXml = docXml.replace(/2011045-785495/g, '');
    docXml = docXml.replace(/-296545472440/g, '');
    docXml = docXml.replace(/212725392430/g, '');
    docXml = docXml.replace(/531241024765/g, '');
    docXml = docXml.replace(/2870835153670/g, '');

    const $ = cheerio.load(docXml, { xmlMode: true });

    // 3. 移除所有 sectPr 上的 w:titlePg，使得首页第1页正常渲染页眉
    $('w\\:sectPr').each((_, sect) => {
      $(sect).find('w\\:titlePg').remove();
    });

    // 4. 重构封面（Page 1）：替换前 31 个段落
    let coverEndP = null;
    $('w\\:body > w\\:p').each((_, p) => {
      if (!coverEndP && $(p).find('w\\:sectPr').length > 0) {
        coverEndP = $(p);
      }
    });

    if (coverEndP && coverEndP.length) {
      coverEndP.prevAll().remove();
      coverEndP.before(buildGuaguiCoverParagraphsXml());
    }

    // 5. 重构目录（Page 2 & Page 3）：
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

    // 替换第一个 sdt 为过轨吊目录前半部分（Page 2）
    const firstSdt = $('w\\:sdt').first();
    if (firstSdt.length) {
      firstSdt.replaceWith(buildGuaguiTocPart1Xml());
    }

    // 替换第二个 sdt 为过轨吊目录后半部分（Page 3）
    const secondSdt = $('w\\:sdt').eq(1);
    if (secondSdt.length) {
      secondSdt.replaceWith(buildGuaguiTocPart2Xml());
    }

    // 6. 替换商务和技术偏差表
    const deviationXml = buildGuaguiDeviationTable();
    let replacedDev = false;
    $('w\\:body > w\\:p').each((_, p) => {
      const text = $(p).text().trim();
      if (!replacedDev && /技术条款偏离表|技术偏离表|商务和技术偏差表/.test(text)) {
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

    // 9. 更新所有 header 为《石家庄高新技术产业开发区能源岛项目中速磨煤机用过轨起重机设备采购 投标文件》
    const guaguiHeaderTitle = '石家庄高新技术产业开发区能源岛项目中速磨煤机用过轨起重机设备采购 投标文件';
    const headerEntries = zip.getEntries().filter(e => e.entryName.startsWith('word/header') && e.entryName.endsWith('.xml'));
    for (const h of headerEntries) {
      let xml = zip.readAsText(h.entryName);
      xml = xml.replace(/河南省中原奥起实业有限公司投标文件/g, guaguiHeaderTitle);
      xml = xml.replace(/华陆工程科技有限责任公司/g, '石家庄高新技术产业开发区能源岛项目');
      xml = xml.replace(/24058-XJ-RM012/g, '2082-D-01000-TM-RQ001-0006E');
      if (!xml.includes('w:bottom') && !xml.includes('w:pBdr')) {
        xml = xml.replace(/<w:pPr>/g, '<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr>');
      }
      zip.updateFile(h.entryName, Buffer.from(xml, 'utf-8'));
    }

    // 10. 更新页脚为圣起标语与页码
    const guaguiSlogan = '※投标单位：河南圣起机械集团有限公司    创新无限，信誉永恒！';
    const footerEntries = zip.getEntries().filter(e => e.entryName.startsWith('word/footer') && e.entryName.endsWith('.xml'));
    for (const f of footerEntries) {
      let xml = zip.readAsText(f.entryName);
      if (xml.includes('<w:p') && !xml.includes('河南圣起机械集团有限公司')) {
        xml = xml.replace(/(<w:p[^>]*>)/, `$1<w:r><w:rPr><w:rFonts w:eastAsia="宋体"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="666666"/></w:rPr><w:t>${escapeXml(guaguiSlogan)}    </w:t></w:r>`);
        zip.updateFile(f.entryName, Buffer.from(xml, 'utf-8'));
      }
    }

    // 11. 保存 document.xml
    zip.updateFile('word/document.xml', Buffer.from($.xml(), 'utf-8'));

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

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
      buyer: '中石化宁波工程有限公司 / 河北晟泰能源有限公司',
      project: '石家庄高新技术产业开发区能源岛项目中速磨煤机用过轨起重机设备采购',
      procNo: '2082-D-01000-TM-RQ001-0006E',
    };
  }

  return {
    generateGuaguiBid,
    buildGuaguiDeviationTable,
  };
}

module.exports = {
  createFullFidelityGuaguiBidService,
};
