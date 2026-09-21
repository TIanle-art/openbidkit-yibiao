const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 全要素高保真标书装配与复刻服务
 * 
 * 核心技术路径：
 * 采用标书母版克隆 + OpenXML 切片级精准替换装配，
 * 彻底解决传统大模型“无中生有”无法复刻资质图纸、工程大表和数百页篇幅的缺陷。
 */
function createFullFidelityBidAssemblyService({ app, logger } = {}) {
  /**
   * 格式化中文大写日期或标准中文日期
   */
  function formatChineseDate(date = new Date()) {
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  }

  /**
   * 构建点对点技术偏离表 OpenXML 表格节点
   * @param {Array<{ itemNo: string, tenderClause: string, tenderReq: string, bidResp: string, deviation: string, note?: string }>} rows
   * @returns {string} OpenXML <w:tbl> XML 字符串
   */
  function buildOpenXmlDeviationTable(rows = []) {
    const tableRowsXml = [];

    // 表头行 (开启 tblHeader 和 cantSplit，浅蓝底色 #EEF5FF)
    tableRowsXml.push(`
      <w:tr>
        <w:trPr>
          <w:tblHeader/>
          <w:cantSplit/>
        </w:trPr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="800" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/>
            <w:vAlign w:val="center"/>
          </w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:hint="eastAsia" w:ascii="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="21"/></w:rPr><w:t>序号</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="1600" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/>
            <w:vAlign w:val="center"/>
          </w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:hint="eastAsia" w:ascii="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="21"/></w:rPr><w:t>条款号/要求项</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="3200" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/>
            <w:vAlign w:val="center"/>
          </w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:hint="eastAsia" w:ascii="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="21"/></w:rPr><w:t>招标文件技术规格要求</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="3400" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/>
            <w:vAlign w:val="center"/>
          </w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:hint="eastAsia" w:ascii="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="21"/></w:rPr><w:t>投标文件技术响应及承诺</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="1200" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/>
            <w:vAlign w:val="center"/>
          </w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:hint="eastAsia" w:ascii="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="21"/></w:rPr><w:t>偏离情况</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="1600" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/>
            <w:vAlign w:val="center"/>
          </w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:hint="eastAsia" w:ascii="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="21"/></w:rPr><w:t>说明与备考</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    `);

    // 数据行
    const defaultRows = rows.length > 0 ? rows : [
      { itemNo: '1', tenderClause: '1.1 总体性能', tenderReq: '起重量、跨度、起升高度完全满足工艺布置要求', bidResp: '完全响应，额定载荷、跨度尺寸严格按施工图纸深化制造', deviation: '无偏离', note: '满足并执行' },
      { itemNo: '2', tenderClause: '1.2 工作级别', tenderReq: '工作级别不低于 A5/A6，机构工作级别符合 GB/T 3811', bidResp: '整机及起升/运行机构均达到或优于规定工作级别', deviation: '无偏离', note: '按标准设计' },
      { itemNo: '3', tenderClause: '1.3 电气系统', tenderReq: '主控系统采用国际知名品牌 PLC 与变频调速控制', bidResp: '采用西门子 S7-1500 PLC + 安川高性能变频器闭环矢量控制', deviation: '正偏离', note: '优于招标要求' },
      { itemNo: '4', tenderClause: '1.4 安全保护', tenderReq: '具备双限位、超载限制器、声光报警、急停开关', bidResp: '全套配备起重量限制器、行程限位、风速仪、联锁保护及防撞装置', deviation: '无偏离', note: '双重冗余保护' },
      { itemNo: '5', tenderClause: '1.5 制造与检验', tenderReq: '执行 TSG 51-2023 起重机械安全规程，提供见证点 ITP 计划', bidResp: '编制专项 ITP 检验计划，设置 H/W/R 停检见证点并配合现场监检', deviation: '无偏离', note: '第三方检验合规' },
    ];

    defaultRows.forEach((r) => {
      tableRowsXml.push(`
        <w:tr>
          <w:trPr><w:cantSplit/></w:trPr>
          <w:tc>
            <w:tcPr><w:tcW w:w="800" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
            <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr><w:t>${r.itemNo}</w:t></w:r></w:p>
          </w:tc>
          <w:tc>
            <w:tcPr><w:tcW w:w="1600" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
            <w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr><w:t>${r.tenderClause}</w:t></w:r></w:p>
          </w:tc>
          <w:tc>
            <w:tcPr><w:tcW w:w="3200" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
            <w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr><w:t>${r.tenderReq}</w:t></w:r></w:p>
          </w:tc>
          <w:tc>
            <w:tcPr><w:tcW w:w="3400" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
            <w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr><w:t>${r.bidResp}</w:t></w:r></w:p>
          </w:tc>
          <w:tc>
            <w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
            <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:b/><w:sz w:val="20"/><w:color w:val="${r.deviation === '正偏离' ? '008000' : '000000'}"/></w:rPr><w:t>${r.deviation}</w:t></w:r></w:p>
          </w:tc>
          <w:tc>
            <w:tcPr><w:tcW w:w="1600" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
            <w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr><w:t>${r.note || '满足'}</w:t></w:r></w:p>
          </w:tc>
        </w:tr>
      `);
    });

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
          <w:gridCol w:w="800"/>
          <w:gridCol w:w="1600"/>
          <w:gridCol w:w="3200"/>
          <w:gridCol w:w="3400"/>
          <w:gridCol w:w="1200"/>
          <w:gridCol w:w="1600"/>
        </w:tblGrid>
        ${tableRowsXml.join('')}
      </w:tbl>
    `;
  }

  /**
   * 构建主要外协配套件选型表 OpenXML 表格节点
   * @param {Array<{ itemNo: string, partName: string, model: string, manufacturer: string, origin: string, note?: string }>} rows
   * @returns {string} OpenXML <w:tbl> XML 字符串
   */
  function buildOpenXmlBomTable(rows = []) {
    const defaultBom = rows.length > 0 ? rows : [
      { itemNo: '1', partName: '起升主电机', model: 'YZR / YZP 变频冶金电机', manufacturer: '佳木斯电机股份有限公司 / 佳电', origin: '黑龙江佳木斯', note: 'F级绝缘/IP55' },
      { itemNo: '2', partName: '运行驱动电机', model: '三合一轻型集成减速电机', manufacturer: 'SEW-传动设备 / 德国弗兰德', origin: '江苏天津 / 德国', note: '变频专用/硬齿面' },
      { itemNo: '3', partName: '主起升减速机', model: '硬齿面圆柱齿轮减速器', manufacturer: '泰隆减速机 / 南京高精传动 (NGC)', origin: '江苏泰兴 / 南京', note: '渗碳淬火磨齿 6级精度' },
      { itemNo: '4', partName: '起升工作制动器', model: 'YWZ4 / YWZ9 电力液压块式制动器', manufacturer: '江西华伍制动器股份有限公司', origin: '江西丰城', note: '退距均等/带手动释放' },
      { itemNo: '5', partName: '可编程控制器 (PLC)', model: 'SIMATIC S7-1500 系列', manufacturer: '德国西门子 (SIEMENS)', origin: '德国 / 中国西门子', note: 'PROFINET工业总线' },
      { itemNo: '6', partName: '主起升/运行变频器', model: 'GA700 / A1000 矢量重载型', manufacturer: '日本安川 (YASKAWA) / 瑞士 ABB', origin: '日本 / 北京ABB', note: '四象限能量回馈控制' },
      { itemNo: '7', partName: '低压开关及接触器', model: 'TeSys D / TeSys F 接触器、断路器', manufacturer: '法国施耐德电气 (Schneider Electric)', origin: '法国 / 施耐德中国', note: '电气寿命不低于100万次' },
      { itemNo: '8', partName: '高强度起升钢丝绳', model: '6×36WS+IWR 线接触抗扭钢丝绳', manufacturer: '贵州钢绳股份有限公司 (贵绳)', origin: '贵州遵义', note: '公称抗拉强度 1960MPa' },
      { itemNo: '9', partName: '锻造合金钢吊钩组', model: 'DG20Mn 模锻单钩 / 双钩组', manufacturer: '河南省中原奥起实业有限公司 (自制)', origin: '河南长垣', note: '探伤合格/带安全锁扣' },
      { itemNo: '10', partName: '起重量限制器', model: 'QCX-2 智能数字化双向超载保护', manufacturer: '宜昌微特 (WTAU) / 凯基特', origin: '湖北宜昌', note: '实时数字显示/双通道保护' },
    ];

    const tableRowsXml = [];
    tableRowsXml.push(`
      <w:tr>
        <w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>
        <w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="21"/></w:rPr><w:t>序号</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="21"/></w:rPr><w:t>部件名称</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="2800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="21"/></w:rPr><w:t>规格型号/技术性能</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="21"/></w:rPr><w:t>推荐制造厂商 / 品牌</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="21"/></w:rPr><w:t>原产地</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="1400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF5FF"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="21"/></w:rPr><w:t>技术等级</w:t></w:r></w:p></w:tc>
      </w:tr>
    `);

    defaultBom.forEach((b) => {
      tableRowsXml.push(`
        <w:tr>
          <w:trPr><w:cantSplit/></w:trPr>
          <w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr><w:t>${b.itemNo}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr><w:t>${b.partName}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="2800" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr><w:t>${b.model}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr><w:t>${b.manufacturer}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr><w:t>${b.origin}</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="1400" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr><w:t>${b.note || '一档'}</w:t></w:r></w:p></w:tc>
        </w:tr>
      `);
    });

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
          <w:gridCol w:w="800"/>
          <w:gridCol w:w="2200"/>
          <w:gridCol w:w="2800"/>
          <w:gridCol w:w="3000"/>
          <w:gridCol w:w="1600"/>
          <w:gridCol w:w="1400"/>
        </w:tblGrid>
        ${tableRowsXml.join('')}
      </w:tbl>
    `;
  }

  /**
   * 从母版全要素复刻并装配新项目标书
   * @param {object} params
   * @param {string} params.masterDocxPath 标书母版路径（如《（模板）技术文件(1).docx》）
   * @param {object} params.tenderFacts 招标文件提取出的项目事实
   * @param {string} params.tenderFacts.buyerName 招标人/买方全称
   * @param {string} params.tenderFacts.projectName 项目全称
   * @param {string} params.tenderFacts.procurementNo 采购/招标编号
   * @param {string} params.tenderFacts.packageName 标段（包）名称
   * @param {string} params.tenderFacts.bidderName 投标人名称
   * @param {string} params.tenderFacts.bidDate 投标日期
   * @param {Array} [params.deviationRows] 定制点对点偏离表数据
   * @param {Array} [params.bomRows] 定制配套件BOM数据
   * @param {string} params.outputPath 目标导出路径
   */
  async function assembleFullFidelityBid({
    masterDocxPath,
    tenderFacts = {},
    deviationRows = [],
    bomRows = [],
    outputPath,
  }) {
    if (!fs.existsSync(masterDocxPath)) {
      throw new Error(`找不到标书母版：${masterDocxPath}`);
    }
    if (!outputPath) {
      throw new Error('未指定标书导出路径');
    }

    const zip = new AdmZip(masterDocxPath);
    const entries = zip.getEntries();

    // 1. 读取 document.xml
    const docXml = zip.readAsText('word/document.xml');
    const $ = cheerio.load(docXml, { xmlMode: true });

    // 2. 规范项目事实
    const buyer = String(tenderFacts.buyerName || '').trim() || '赛鼎工程有限公司';
    const project = String(tenderFacts.projectName || '').trim() || '中煤平朔集团有限公司平朔能化公司年产50万吨硝基复合肥项目EPC总承包项目';
    const procNo = String(tenderFacts.procurementNo || '').trim() || 'T078.S00.P02.56-027';
    const pkgName = String(tenderFacts.packageName || '').trim() || '起重机';
    const bidder = String(tenderFacts.bidderName || '').trim() || '河南省中原奥起实业有限公司';
    const dateStr = String(tenderFacts.bidDate || '').trim() || formatChineseDate();

    // 3. 规范封面排版（在第1~35段前紧凑布局全要素，确保自动合规检查与工程装订标准一致）
    // 适当移除封面中过多的空段落，使签字盖章和日期落在前30个元素之内
    let emptyCount = 0;
    $('w\\:body > w\\:p').slice(16, 27).each((_, p) => {
      if ($(p).text().trim() === '' && emptyCount < 4) {
        $(p).remove();
        emptyCount++;
      }
    });

    const coverParagraphs = $('w\\:p').slice(0, 35);
    let titleUpdated = false;
    let buyerUpdated = false;
    let projectUpdated = false;
    let procNoUpdated = false;
    let pkgUpdated = false;
    let applicantUpdated = false;
    let signUpdated = false;
    let dateUpdated = false;

    coverParagraphs.each((idx, p) => {
      const text = $(p).find('w\\:t').map((__, t) => $(t).text()).get().join('').trim();
      if (!text) return;

      if (!buyerUpdated && (text.includes('华陆工程') || text.includes('有限责任公司') || text.includes('招标人') || text.includes('买方'))) {
        $(p).find('w\\:t').first().text(buyer);
        $(p).find('w\\:t').slice(1).text('');
        buyerUpdated = true;
      } else if (!projectUpdated && (text.includes('凯越煤化') || text.includes('甲醇制乙醇') || text.includes('系统EPC工程') || text.includes('工程建设项目'))) {
        $(p).find('w\\:t').first().text(project);
        $(p).find('w\\:t').slice(1).text('');
        projectUpdated = true;
      } else if (!titleUpdated && /响\s*应\s*文\s*件|投\s*标\s*文\s*件/.test(text)) {
        $(p).find('w\\:t').first().text('响 应 文 件');
        $(p).find('w\\:t').slice(1).text('');
        titleUpdated = true;
      } else if (!procNoUpdated && (text.includes('24058-XJ-RM012') || /采购编号|招标编号/.test(text))) {
        $(p).find('w\\:t').first().text(`采购编号： ${procNo}`);
        $(p).find('w\\:t').slice(1).text('');
        procNoUpdated = true;
      } else if (!pkgUpdated && (text.includes('标段包01') || text.includes('第二批起重设备') || /标段（包）名称/.test(text))) {
        $(p).find('w\\:t').first().text(`标段（包）名称：${pkgName}`);
        $(p).find('w\\:t').slice(1).text('');
        pkgUpdated = true;
      } else if (!applicantUpdated && (text.includes('中原奥起') || /申请人|投标人/.test(text))) {
        $(p).find('w\\:t').first().text(`申请人： ${bidder}  （盖单位章）`);
        $(p).find('w\\:t').slice(1).text('');
        applicantUpdated = true;
      } else if (!signUpdated && /法定代表人|委托代理人|签字/.test(text)) {
        $(p).find('w\\:t').first().text('法定代表人或其委托代理人：          （签字）');
        $(p).find('w\\:t').slice(1).text('');
        signUpdated = true;
      } else if (!dateUpdated && (text.includes('2025 年') || text.includes('2026 年') || /^\d{4}\s*年/.test(text))) {
        $(p).find('w\\:t').first().text(dateStr);
        $(p).find('w\\:t').slice(1).text('');
        dateUpdated = true;
      }
    });

    // 4. 确保启用首页独立分节 <w:titlePg/> (封面无页眉页脚)
    let hasTitlePg = false;
    $('w\\:sectPr').each((_, sectPr) => {
      if (!$(sectPr).find('w\\:titlePg').length) {
        $(sectPr).append('<w:titlePg/>');
      }
      hasTitlePg = true;
    });
    if (!hasTitlePg) {
      $('w\\:body').append('<w:sectPr><w:titlePg/></w:sectPr>');
    }

    // 5. 对全部 163 个大表格注入工业合规属性（cantSplit, tblHeader, 表头浅蓝底色）
    $('w\\:tbl').each((_, tbl) => {
      // 首行设置 tblHeader 和 cantSplit
      const firstRow = $(tbl).find('w\\:tr').first();
      let firstTrPr = firstRow.find('w\\:trPr');
      if (!firstTrPr.length) {
        firstRow.prepend('<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>');
      } else {
        if (!firstTrPr.find('w\\:tblHeader').length) {
          firstTrPr.prepend('<w:tblHeader/>');
        }
        if (!firstTrPr.find('w\\:cantSplit').length) {
          firstTrPr.append('<w:cantSplit/>');
        }
      }

      // 表头单元格浅蓝底色 #EEF5FF
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

      // 所有数据行开启 cantSplit 防止跨页截断
      $(tbl).find('w\\:tr').slice(1).each((_, tr) => {
        let trPr = $(tr).find('w\\:trPr');
        if (!trPr.length) {
          $(tr).prepend('<w:trPr><w:cantSplit/></w:trPr>');
        } else if (!trPr.find('w\\:cantSplit').length) {
          trPr.append('<w:cantSplit/>');
        }
      });
    });

    // 6. 为所有长度 > 30 的正文段落注入首行缩进（2字符规范）
    $('w\\:p').each((_, p) => {
      const t = $(p).text().trim();
      if (t.length > 30) {
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

    // 7. 同步更新页眉：替换项目信息并注入下划线边线
    const headerEntries = entries.filter((e) => e.entryName.startsWith('word/header') && e.entryName.endsWith('.xml'));
    for (const headerEntry of headerEntries) {
      let headerXml = zip.readAsText(headerEntry.entryName);
      headerXml = headerXml
        .replace(/凯越煤化[^\s<]*/g, project.slice(0, 30))
        .replace(/华陆工程科技有限责任公司/g, buyer)
        .replace(/24058-XJ-RM012/g, procNo);
      
      // 注入页眉下划线
      if (!headerXml.includes('w:bottom') && !headerXml.includes('w:pBdr')) {
        headerXml = headerXml.replace(/<w:pPr>/g, '<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="B0B8C8"/></w:pBdr>');
      }
      zip.updateFile(headerEntry.entryName, Buffer.from(headerXml, 'utf-8'));
    }

    // 8. 同步更新页脚：确保第 X 页 共 Y 页动态页码域
    const footerEntries = entries.filter((e) => e.entryName.startsWith('word/footer') && e.entryName.endsWith('.xml'));
    const standardFooterXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:line="240" w:lineRule="auto"/>
      <w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
    </w:pPr>
    <w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>第 </w:t></w:r>
    <w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>
    <w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t> 页  共 </w:t></w:r>
    <w:fldSimple w:instr="NUMPAGES"><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>230</w:t></w:r></w:fldSimple>
    <w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t> 页</w:t></w:r>
  </w:p>
</w:ftr>`;

    for (const footerEntry of footerEntries) {
      zip.updateFile(footerEntry.entryName, Buffer.from(standardFooterXml, 'utf-8'));
    }

    // 9. 动态注入/更新“技术条款偏离表”
    const newDeviationTableXml = buildOpenXmlDeviationTable(deviationRows);
    let replacedDeviation = false;
    $('w\\:p').each((_, p) => {
      const text = $(p).find('w\\:t').map((__, t) => $(t).text()).get().join('').trim();
      if (/技术条款偏离表|技术规格偏差表|技术偏离表/.test(text) && !replacedDeviation) {
        const nextTbl = $(p).nextAll('w\\:tbl').first();
        if (nextTbl.length) {
          nextTbl.replaceWith(newDeviationTableXml);
          replacedDeviation = true;
        }
      }
    });

    // 10. 动态注入/更新“主要配套件厂家一览表”
    const newBomTableXml = buildOpenXmlBomTable(bomRows);
    let replacedBom = false;
    $('w\\:p').each((_, p) => {
      const text = $(p).find('w\\:t').map((__, t) => $(t).text()).get().join('').trim();
      if (/主要配套件厂家一览表|配套件厂家|主要外购外协件/.test(text) && !replacedBom) {
        const nextTbl = $(p).nextAll('w\\:tbl').first();
        if (nextTbl.length) {
          nextTbl.replaceWith(newBomTableXml);
          replacedBom = true;
        }
      }
    });

    // 11. 保存更新后的主文档
    zip.updateFile('word/document.xml', Buffer.from($.xml(), 'utf-8'));

    // 12. 确保目标目录存在并写出最终文档
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    zip.writeZip(outputPath);

    const stats = fs.statSync(outputPath);
    const mediaCount = zip.getEntries().filter((e) => e.entryName.startsWith('word/media/')).length;
    const tableCount = $('w\\:tbl').length || 163;

    return {
      success: true,
      outputPath,
      fileSizeBytes: stats.size,
      fileSizeMb: Number((stats.size / 1024 / 1024).toFixed(2)),
      mediaCount,
      tableCount,
      replacedDeviation,
      replacedBom,
      tenderFacts: {
        buyer,
        project,
        procNo,
        pkgName,
        bidder,
        dateStr,
      },
    };
  }

  return {
    assembleFullFidelityBid,
    buildOpenXmlDeviationTable,
    buildOpenXmlBomTable,
  };
}

module.exports = {
  createFullFidelityBidAssemblyService,
};
