const fs = require('node:fs');
const path = require('node:path');
const { buildDocxBuffer } = require('../electron/services/exportService.cjs');
const { printComparisonReport } = require('./test-compare-bid-format.cjs');

async function testComprehensiveBid() {
  const payload = {
    project_name: '凯越煤化50万吨/年甲醇制乙醇项目系统EPC工程第二批起重设备采购',
    document_title: '响 应 文 件',
    global_facts: {
      buyer_name: '华陆工程科技有限责任公司',
      procurement_no: '24058-XJ-RM012',
      package_name: '第二批起重设备-标段包01',
      bidder_name: '河南省中原奥起实业有限公司',
      representative_name: '张奥起',
      bid_date: '2025 年 02 月 09 日',
    },
    export_format: {
      template_name: '国家级重点工业项目标书标准规范',
      include_toc: true,
      page: {
        paper_size: 'a4',
        orientation: 'portrait',
        first_page_different: true,
        margin_top_cm: 2.07,
        margin_bottom_cm: 2.12,
        margin_left_cm: 2.5,
        margin_right_cm: 2.46,
        header_enabled: true,
        header_text: '凯越煤化50万吨/年甲醇制乙醇项目 响应技术文件',
        header_font: '宋体',
        header_size: '小五',
        header_alignment: '居中对齐',
        header_color: '#536176',
        footer_enabled: true,
        footer_distance_cm: 1.75,
        footer_font: '宋体',
        footer_size: '小五',
        footer_alignment: '居中对齐',
        footer_color: '#536176',
        page_number_enabled: true,
        page_number_format: '第{page}页 共{total}页',
        page_number_start: 1,
      },
      headings: [
        { font: '黑体', size: '小二', alignment: '居中对齐', bold: false, text_color: '#243048', spacing_before_pt: 12, spacing_after_pt: 12, first_line_indent_chars: 0, line_spacing: 1 },
        { font: '黑体', size: '四号', alignment: '居中对齐', bold: false, text_color: '#243048', spacing_before_pt: 10, spacing_after_pt: 10, first_line_indent_chars: 0, line_spacing: 1 },
        { font: '黑体', size: '小四', alignment: '两端对齐', bold: false, text_color: '#243048', spacing_before_pt: 6, spacing_after_pt: 6, first_line_indent_chars: 0, line_spacing: 1 },
      ],
      body_text: {
        font: '宋体',
        size: '小四',
        alignment: '两端对齐',
        spacing_before_pt: 0,
        spacing_after_pt: 0,
        first_line_indent_chars: 2,
        line_spacing_multiple: 1.35,
      },
      table: {
        border_width: 1,
        border_color: '#B0B8C8',
        cell_padding_pt: 6,
        full_width: true,
        header_row: { font: '黑体', size: '五号', alignment: '居中对齐', text_color: '#243048', background_color: '#EEF5FF' },
        body_cell: { font: '宋体', size: '五号', alignment: '左对齐', text_color: '#243048', background_color: '#FFFFFF' },
      },
      image: {
        max_width_percent: 90,
        alignment: '居中对齐',
        caption_font: '宋体',
        caption_size: '五号',
        caption_alignment: '居中对齐',
        caption_bold: false,
        caption_italic: false,
      },
    },
    outline: [
      {
        id: '1',
        title: '第一章 技术规格响应与偏离说明',
        level: 1,
        children: [
          {
            id: '1.1',
            title: '1.1 总体技术方案响应承诺',
            level: 2,
            content: `河南省中原奥起实业有限公司对华陆工程科技有限责任公司“凯越煤化50万吨/年甲醇制乙醇项目系统EPC工程第二批起重设备采购”（采购编号：24058-XJ-RM012）招标文件进行了深入严谨的技术评审。

本公司郑重承诺：我方完全理解并接受招标文件及相关技术规格书的技术要求、供货范围、质量检验标准及交货服务要求。投标所列产品均为我公司成熟可靠、性能优良、严格符合国家及行业现行规范的标准定型产品。

| 序号 | 招标文件技术要求条款 | 投标文件实际配置及参数响应 | 偏离类型 | 说明及支撑章节 |
| :---: | :--- | :--- | :---: | :--- |
| 1 | 额定起重量：主钩50t，副钩10t | QD50/10t标准配置，主钩50t，副钩10t | 无偏离 | 符合技术规格书第2.1款要求 |
| 2 | 起重机跨度：S=22.5m | 实际制造跨度S=22.5m，允差±2mm | 无偏离 | 优于国家标准GB/T 14405要求 |
| 3 | 防爆等级：ExdIICT4 Gb | 电气防爆等级全面达到ExdIICT4 Gb | 无偏离 | 采用国家防爆质检中心认证电气 |
| 4 | 起升速度调节方式：变频调速 | 起升与运行机构全变频调速，调速比1:10 | 正偏离 | 提升平稳度，减少工件晃动与冲击 |
| 5 | 整机工作级别：A5 | 主起升M5，运行机构M5，整机A5 | 无偏离 | 满足全寿命周期疲劳强度设计要求 |

图 1-1 起重机整体布置与技术参数响应示意图

针对上述技术要求，我公司在各工序执行严格的自检、互检和专检制度，确保出厂设备零缺陷交付。`
          }
        ]
      },
      {
        id: '2',
        title: '第二章 主要部件结构特点及制造工艺',
        level: 1,
        children: [
          {
            id: '2.1',
            title: '2.1 主梁及金属结构加工制造',
            level: 2,
            content: `起重机主梁采用偏轨箱形梁或正轨箱形梁结构，主梁腹板、上下盖板均采用大型数控等离子切割机下料，确保下料尺寸精度和拱度曲线平滑自然。

主梁组焊过程中严格采用埋弧自动焊和二氧化碳气体保护焊，主焊缝焊后进行100%外观检验及规范要求的射线探伤(RT)或超声波探伤(UT)，探伤级别达到一级焊缝标准。

| 部件名称 | 选用材质 | 制造工艺要求 | 检测方法及标准 | 检验频次 |
| :---: | :--- | :--- | :--- | :---: |
| 主梁上盖板 | Q355B (GB/T 1591) | 数控下料，反变形预压，埋弧自动焊 | 100%超声波探伤，符合NB/T 47013 | 每件全检 |
| 主梁下盖板 | Q355B (GB/T 1591) | 精确下料，对接焊缝打磨平整与母材平齐 | 100%射线探伤(RT)，I级合格 | 每件全检 |
| 端梁结构 | Q235B (GB/T 700) | 箱形整体焊接，镗孔机一次装夹加工车轮孔 | 激光测距与平行度检验 | 每批抽检 |
| 走台及栏杆 | Q235B (GB/T 700) | 花纹钢板防滑铺设，热镀锌防腐处理 | 目视外观及镀锌层厚度检验 | 100%全检 |

图 2-1 主梁结构优化截面与制造工艺示意图

金属结构制造完成后进行整机预组装，测量主梁上拱度、跨度、对角线差及车轮水平偏斜，全部指标合格后方可进入涂装工序。`
          }
        ]
      },
      {
        id: '3',
        title: '第三章 关键外协配套件选型一览表',
        level: 1,
        children: [
          {
            id: '3.1',
            title: '3.1 核心外协配套品牌与选型',
            level: 2,
            content: `为保证起重设备的长期安全稳定运行，本公司核心外协配套件均选用国内外一线知名品牌，所有外协件进厂均经过严格的入厂复验与质量追溯。

| 序号 | 配套件名称 | 规格型号 | 数量 | 推荐制造商/品牌 | 原产地 | 质保年限 |
| :---: | :--- | :--- | :---: | :--- | :---: | :---: |
| 1 | 主起升电动机 | YZR系列冶金起重电机 | 2台 | 佳木斯防爆电机 / 佳电股份 | 黑龙江 | 3年 |
| 2 | 主起升减速机 | 硬齿面中硬齿面圆柱齿轮减速器 | 2台 | 南京高精齿轮 (NGC) | 江苏 | 3年 |
| 3 | 液压推杆制动器 | YWZ9系列电力液压制动器 | 4套 | 焦作制动器 / 焦作华西 | 河南 | 2年 |
| 4 | 变频调速装置 | ACS880系列重载工程型变频器 | 1套 | ABB (中国) 有限公司 | 北京/芬兰 | 3年 |
| 5 | 可编程控制器PLC | S7-1500高性能控制器 | 1套 | 西门子 (Siemens) | 德国 | 3年 |
| 6 | 起重钢丝绳 | 8×36WS+IWR 高抗扭钢丝绳 | 400m | 贵州钢绳股份 (巨龙) | 贵州 | 2年 |

图 3-1 关键部件外协采购与入厂质检流转流程图

本公司与上述供应商均签订有长期战略供货协议，确保零配件原厂正品供应，供货周期有保障，并提供全生命周期的原厂配件技术服务。`
          }
        ]
      },
      {
        id: '4',
        title: '第四章 质量检验及试验控制计划(ITP)',
        level: 1,
        children: [
          {
            id: '4.1',
            title: '4.1 质量保证体系与关键见证点控制',
            level: 2,
            content: `本公司严格按照 ISO9001 质量管理体系要求运行，针对本工程设立项目专属质量保证机构，实行由总工程师负责的质量责任终身制。

下表为本项目起重设备检验试验控制计划（ITP），明确列出了各工序的检验标准、责任主体及买方/监理方的见证级别（H-停工待检点，W-现场见证点，R-记录确认点）。

| 序号 | 制造/检验工序环节 | 质量控制要求及依据标准 | 检验方法及仪器 | 承包商自检 | 监造/监理见证点 |
| :---: | :--- | :--- | :--- | :---: | :---: |
| 1 | 原材料复验 (钢板/型材) | GB/T 700, GB/T 1591, 质保书核对 | 材质单校对、力学性能复检 | 100%全检 | R |
| 2 | 坡口加工与拼焊装配 | 焊接工艺规程 WPS，清除氧化皮 | 焊缝卡尺检验坡口角度间隙 | 100%全检 | W |
| 3 | 主梁对接焊缝无损探伤 | NB/T 47013.2 射线探伤 / .3 超声波 | 射线探伤仪(RT)、超声探伤仪(UT) | 100%全检 | H |
| 4 | 预组装及几何尺寸检测 | 上拱度 F=(0.9~1.4)S/1000，对角线差 | 激光测距仪、高精度经纬仪 | 100%全检 | W |
| 5 | 表面喷砂除锈及涂装 | 达到 Sa2.5 级，漆膜干膜厚度达标 | 粗糙度仪、漆膜测厚仪 | 100%全检 | W |
| 6 | 厂内总装及空载运转试验 | 各机构运转平稳，无异常振动噪音 | 声级计、红外测温仪、转速表 | 100%全检 | W |
| 7 | 静载试验与动载试验 | 1.25倍静载，1.1倍动载起吊测试 | 标准砝码载荷、主梁挠度测定仪 | 100%全检 | H |

图 4-1 质量检验流程与出厂交付控制图

所有 H 点（停工待检点）必须提前 48 小时书面通知买方驻厂监造代表，经监造代表现场检验并签署合格见证单后方可转入下道工序。`
          }
        ]
      },
      {
        id: '5',
        title: '第五章 现场安装、调试与售后服务承诺',
        level: 1,
        children: [
          {
            id: '5.1',
            title: '5.1 现场施工组织与服务响应机制',
            level: 2,
            content: `设备运抵现场后，我方指派具备国家特种设备安装维修资质的专业项目团队负责现场吊装、轨道对中、电控接线与联合调试工作。

我公司设有 24 小时售后服务热线，并设立华北及西北常驻技术服务中心，确保在接收到用户报修或技术咨询通知后 30 分钟内做出响应，2 小时内派出专业工程师赶赴现场处置。

| 服务阶段 | 服务承诺事项 | 具体实施细则与保证措施 | 责任人 |
| :---: | :--- | :--- | :---: |
| 施工准备 | 现场勘验与方案交底 | 提前10天派出施工队长核对轨道标高与建筑限界 | 现场项目经理 |
| 安装调试 | 机械就位与电气联调 | 严格执行现场特种设备安装安全规程，提供吊装方案 | 机械/电气主管 |
| 监督检验 | 特种设备检验所报检 | 配合当地特检院完成法定监督检验并取得使用登记证 | 质量安全部 |
| 免费质保 | 交付投产后 36 个月 | 质保期内非人为损坏零件免费更换，提供季度巡检 | 售后服务部 |
| 终身维护 | 质保期满后持续服务 | 终身以优惠价提供原厂备件，每年提供免费健康体检 | 客户服务中心 |

图 5-1 项目现场安装调试组织架构与快速响应机制图

本公司秉承“质量第一、客户至上、精益求精”的经营理念，全力保障本项目起重设备安全可靠投产运行！`
          }
        ]
      }
    ]
  };

  const outputPath = path.join(__dirname, 'test-comprehensive-bid.docx');
  console.log('Generating comprehensive 5-chapter industrial bid docx...');
  const buffer = await buildDocxBuffer(payload);
  fs.writeFileSync(outputPath, buffer);
  console.log(`Successfully generated ${outputPath} (${buffer.length} bytes)`);

  printComparisonReport(outputPath);
}

testComprehensiveBid().catch(err => {
  console.error('Comprehensive Bid Test Error:', err);
  process.exit(1);
});
