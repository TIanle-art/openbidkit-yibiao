import os
import sys
import re
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn

sys.stdout.reconfigure(encoding='utf-8')

# Ground truth TOC for Sading
SADING_TOC = [
    ("1．响应函", "3", 1),
    ("2．法定代表人身份证明或附有法定代表人身份证明的授权委托书", "4", 1),
    ("2.1法定代表人身份证明", "4", 2),
    ("2.2授权委托书", "5", 2),
    ("3．资格审查资料", "6", 1),
    ("3.1 申请人基本情况表", "6", 2),
    ("3.2 生产能力证明", "8", 2),
    ("3.3 近两年财务状况表", "19", 2),
    ("3.4 质量保证能力证明", "73", 2),
    ("3.5 近五年同类物资供货业绩表", "81", 2),
    ("3.6 履约信用证明", "123", 2),
    ("3.7 近年发生的诉讼及仲裁情况", "127", 2),
    ("4.申请人资格声明", "128", 1),
    ("5.生产组织供应能力分析表", "131", 1),
    ("一、生产能力", "131", 2),
    ("二、运营能力", "134", 2),
    ("三、财务能力", "135", 2),
    ("四、应急保障能力", "136", 2),
    ("6.组织供应、运输、售后服务方案", "138", 1),
    ("7. 物资技术规格书", "140", 1),
    ("8. 拟投入本项目的主要生产设备、检验设备表", "140", 1),
    ("9. 物资运达施工现场后的保护措施和要求", "155", 1),
    ("10.谈判承诺书", "156", 1),
    ("11.生产企业简介", "157", 1),
    ("12.技术偏离表", "177", 1),
]

# Ground truth TOC for Guagui
GUAGUI_TOC = [
    ("一、投标函", "1", 1),
    ("二、法定代表人（单位负责人）身份证明", "3", 1),
    ("三、联合体协议书(不适用）", "4", 1),
    ("四、投标保证金", "5", 1),
    ("五、商务和技术偏差表", "6", 1),
    ("五、分项报价表", "7", 1),
    ("分包与外购报价表", "8", 2),
    ("六、资格审查资料", "9", 1),
    ("（一）基本情况表", "9", 2),
    ("（1）营业执照（三证合一）", "10", 3),
    ("（2）特种设备生产许可证（含安装、修理、改造）", "11", 3),
    ("（3）基本账户开户许可证复印件", "12", 3),
    ("（4）其它资格资料", "13", 3),
    ("银行资信证明及AAA 级信用等级证书", "13", 4),
    ("最近三年内发生重大产品质量问题证明", "15", 4),
    ("在全国企业信用信息公示系统中列入严重违法失信企业名单查询结果", "16", 4),
    ("在“信用中国”网站（www.creditchina.gov.cn）或各级信用信息共享平台中列入失信被执行人、重大税收违法案件当事人名单查询结果截图", "17", 4),
    ("在近三年内投标人或其法定代表人、拟委任的项目负责人无行贿犯罪行为记录", "19", 4),
    ("质量管理体系认证证书", "21", 4),
    ("环境管理体系认证证书", "22", 4),
    ("职业健康安全管理体系认证证书", "23", 4),
    ("两化融合管理体系评定证书", "24", 4),
    ("武器装备质量管理体系认证证书", "25", 4),
    ("质量保证体系", "26", 4),
    ("企业简介", "28", 4),
    ("实用新型专利证书及获奖荣誉证书", "35", 4),
    ("（二）近年财务状况表", "50", 2),
    ("（三）近年完成的类似项目情况表", "111", 2),
    ("（四）正在供货和新承接的项目情况表", "131", 2),
    ("（五）近年发生的诉讼及仲裁情况", "143", 2),
    ("七、投标设备技术性能指标的详细描述", "144", 1),
    ("附件1 技术规范", "144", 2),
    ("附件2 供货范围", "156", 2),
    ("附件3 技术资料和交付进度", "158", 2),
    ("附件4 监造、检验", "160", 2),
    ("附件5 性能验收试验", "162", 2),
    ("附件6 技术服务和设计联络", "163", 2),
    ("附件7 交货进度", "165", 2),
    ("附件8 分包与外购", "166", 2),
    ("附件9 大部件情况", "167", 2),
    ("附件10 招标文件附图", "168", 2),
    ("附件11 差异表", "169", 2),
    ("附件12 投标人需要说明的其它问题", "170", 2),
    ("中速磨煤机用过轨起重机通用技术描述", "170", 3),
    ("先进性、经济性、环保性", "171", 3),
    ("新技术、新材料的应用", "172", 3),
    ("外协件厂家一览表", "173", 3),
    ("产品的主要制造工艺流程及特点", "174", 3),
    ("质量保证措施", "175", 3),
    ("检测手段", "180", 3),
    ("起重机试验的手段和方法", "182", 3),
    ("起重机推荐安装方案", "184", 3),
    ("设备包装和运输方案", "190", 3),
    ("八、技术支持资料", "193", 1),
    ("九、技术服务和质保期服务计划", "196", 1),
    ("十、其他资料", "198", 1),
    ("十二、招标代理服务费承诺书", "199", 1),
    ("图纸--附", "", 1)
]

def style_run(run, font_name="宋体", size_pt=12.0, bold=False, color_hex="000000", underline=False):
    run.font.name = font_name
    run.font.size = Pt(size_pt)
    run.bold = bold
    run.underline = underline
    rPr = run._r.get_or_add_rPr()
    # EastAsia font mapping
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = parse_xml(f'<w:rFonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="{font_name}" w:cs="Times New Roman" w:hint="eastAsia"/>')
        rPr.append(rFonts)
    else:
        rFonts.set(qn('w:eastAsia'), font_name)
        rFonts.set(qn('w:hint'), 'eastAsia')
    # Color
    if color_hex != "000000":
        run.font.color.rgb = RGBColor(int(color_hex[:2], 16), int(color_hex[2:4], 16), int(color_hex[4:], 16))

def set_p_formatting(p, align=WD_ALIGN_PARAGRAPH.LEFT, line_spacing_pt=18.0, space_before_pt=0, space_after_pt=0):
    p.alignment = align
    pPr = p._p.get_or_add_pPr()
    # snapToGrid = 0
    snap = pPr.find(qn('w:snapToGrid'))
    if snap is None:
        pPr.append(parse_xml(r'<w:snapToGrid xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="0"/>'))
    else:
        snap.set(qn('w:val'), '0')
    # spacing
    spacing = pPr.find(qn('w:spacing'))
    line_twips = str(int(line_spacing_pt * 20))
    before_twips = str(int(space_before_pt * 20))
    after_twips = str(int(space_after_pt * 20))
    if spacing is None:
        pPr.append(parse_xml(f'<w:spacing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:line="{line_twips}" w:lineRule="exact" w:before="{before_twips}" w:after="{after_twips}"/>'))
    else:
        spacing.set(qn('w:lineRule'), 'exact')
        spacing.set(qn('w:line'), line_twips)
        spacing.set(qn('w:before'), before_twips)
        spacing.set(qn('w:after'), after_twips)

def build_sading_flagship_v2(input_path, output_path):
    print("\n>>> Building Sading Flagship V2...")
    doc = docx.Document(input_path)

    # 1. Locate Body start (P[43] or wherever "1．响应函" appears)
    body_start_idx = None
    for i, p in enumerate(doc.paragraphs):
        t = p.text.strip()
        if "1．响应函" in t and "\t" not in t and "..." not in t:
            body_start_idx = i
            break
    print(f"   Body starts at P[{body_start_idx}]")

    # Keep all body paragraphs from body_start_idx onwards
    body_elements = []
    # Purge rogue headers/footers in body
    for p in doc.paragraphs[body_start_idx:]:
        t = p.text.strip()
        if len(t) < 80 and any(k in t for k in ["河南省中原奥起实业有限公司投标文件"]):
            continue
        body_elements.append(p)

    # Reconstruct document from scratch or modify in place
    # We can delete paragraphs 0 to body_start_idx - 1
    paras_to_remove = doc.paragraphs[:body_start_idx]
    for p in paras_to_remove:
        p._p.getparent().remove(p._p)

    # Now insert Cover & TOC before the first paragraph of body!
    ref_p = doc.paragraphs[0]._p

    def insert_p_before(text=""):
        new_p = parse_xml(r'<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')
        ref_p.getparent().insert(ref_p.getparent().index(ref_p), new_p)
        p_obj = docx.text.paragraph.Paragraph(new_p, doc)
        if text:
            p_obj.add_run(text)
        return p_obj

    # --- BUILD SADING COVER ---
    # Top space
    p_sp1 = insert_p_before()
    set_p_formatting(p_sp1, line_spacing_pt=30)
    
    # Title Lines (All Centered, SimSun, 20 pt = 小初)
    p_t1 = insert_p_before("中国化学赛鼎宁波工程有限公司")
    set_p_formatting(p_t1, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing_pt=32)
    style_run(p_t1.runs[0], font_name="宋体", size_pt=20.0, bold=False)

    p_t2 = insert_p_before("宁波太一碳元科技有限公司")
    set_p_formatting(p_t2, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing_pt=32)
    style_run(p_t2.runs[0], font_name="宋体", size_pt=20.0, bold=False)

    p_t3 = insert_p_before()
    set_p_formatting(p_t3, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing_pt=32)
    r1 = p_t3.add_run("230")
    style_run(r1, font_name="Times New Roman", size_pt=20.0, bold=True)
    r2 = p_t3.add_run("吨/年高端碳材料项目")
    style_run(r2, font_name="宋体", size_pt=20.0, bold=False)

    # Vertical Space
    p_sp2 = insert_p_before()
    set_p_formatting(p_sp2, line_spacing_pt=60)
    p_sp3 = insert_p_before()
    set_p_formatting(p_sp3, line_spacing_pt=60)

    # Sub-Title
    p_sub = insert_p_before("技术响应文件")
    set_p_formatting(p_sub, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing_pt=24)
    style_run(p_sub.runs[0], font_name="宋体", size_pt=15.0, bold=True)

    # Vertical Space
    p_sp4 = insert_p_before()
    set_p_formatting(p_sp4, line_spacing_pt=50)

    # Form Fields (Left Indented ~1.4 inches)
    # 1. 采购编号
    p_f1 = insert_p_before()
    set_p_formatting(p_f1, align=WD_ALIGN_PARAGRAPH.LEFT, line_spacing_pt=26)
    p_f1.paragraph_format.left_indent = Inches(1.4)
    r = p_f1.add_run("采购编号：")
    style_run(r, font_name="宋体", size_pt=14.0)
    r_val = p_f1.add_run("NC2060.EQP.P01.90-037")
    style_run(r_val, font_name="宋体", size_pt=12.0, underline=True)

    # 2. 标段名称
    p_f2 = insert_p_before()
    set_p_formatting(p_f2, align=WD_ALIGN_PARAGRAPH.LEFT, line_spacing_pt=26)
    p_f2.paragraph_format.left_indent = Inches(1.4)
    r = p_f2.add_run("标段（包）名称：")
    style_run(r, font_name="宋体", size_pt=14.0)
    r_val = p_f2.add_run("起重设备")
    style_run(r_val, font_name="宋体", size_pt=12.0, underline=True)

    # Space
    p_sp5 = insert_p_before()
    set_p_formatting(p_sp5, line_spacing_pt=50)

    # 3. 申请人
    p_f3 = insert_p_before()
    set_p_formatting(p_f3, align=WD_ALIGN_PARAGRAPH.LEFT, line_spacing_pt=26)
    p_f3.paragraph_format.left_indent = Inches(1.0)
    r = p_f3.add_run("申请人：")
    style_run(r, font_name="宋体", size_pt=14.0)
    r_val = p_f3.add_run("河南省中原奥起实业有限公司")
    style_run(r_val, font_name="宋体", size_pt=14.0, underline=True)
    r_seal = p_f3.add_run(" （盖单位章）")
    style_run(r_seal, font_name="宋体", size_pt=14.0)

    # 4. 法定代表人
    p_f4 = insert_p_before()
    set_p_formatting(p_f4, align=WD_ALIGN_PARAGRAPH.LEFT, line_spacing_pt=26)
    p_f4.paragraph_format.left_indent = Inches(1.0)
    r = p_f4.add_run("法定代表人或其委托代理人：")
    style_run(r, font_name="宋体", size_pt=14.0)
    r_blank = p_f4.add_run("              ")
    style_run(r_blank, font_name="宋体", size_pt=14.0, underline=True)
    r_sign = p_f4.add_run("（签字）")
    style_run(r_sign, font_name="宋体", size_pt=14.0)

    # 5. 日期
    p_f5 = insert_p_before()
    set_p_formatting(p_f5, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing_pt=26)
    r = p_f5.add_run("2026")
    style_run(r, font_name="Times New Roman", size_pt=14.0, bold=True, underline=True)
    r = p_f5.add_run(" 年 ")
    style_run(r, font_name="宋体", size_pt=14.0)
    r = p_f5.add_run(" 8 ")
    style_run(r, font_name="Times New Roman", size_pt=14.0, bold=True, underline=True)
    r = p_f5.add_run(" 月 ")
    style_run(r, font_name="宋体", size_pt=14.0)
    r = p_f5.add_run(" 16 ")
    style_run(r, font_name="Times New Roman", size_pt=14.0, bold=True, underline=True)
    r = p_f5.add_run(" 日")
    style_run(r, font_name="宋体", size_pt=14.0)

    # Cover Page Break
    p_brk1 = insert_p_before()
    p_brk1.add_run().add_break(docx.enum.text.WD_BREAK.PAGE)

    # --- BUILD SADING TOC ---
    p_toc_title = insert_p_before("目    录")
    set_p_formatting(p_toc_title, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing_pt=24, space_before_pt=12, space_after_pt=12)
    style_run(p_toc_title.runs[0], font_name="黑体", size_pt=16.0, bold=True)

    for title, page_no, level in SADING_TOC:
        p_item = insert_p_before()
        set_p_formatting(p_item, align=WD_ALIGN_PARAGRAPH.LEFT, line_spacing_pt=18.0)
        pPr = p_item._p.get_or_add_pPr()
        tabs = parse_xml(r'''
            <w:tabs xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                <w:tab w:val="right" w:leader="dot" w:pos="8640"/>
            </w:tabs>
        ''')
        pPr.append(tabs)

        indent = Inches(0.25 * (level - 1))
        if indent > 0:
            p_item.paragraph_format.left_indent = indent

        r_title = p_item.add_run(title)
        is_h1 = (level == 1)
        style_run(r_title, font_name="宋体" if not is_h1 else "黑体", size_pt=11.0 if not is_h1 else 11.5, bold=is_h1)

        r_tab = p_item.add_run("\t")
        r_page = p_item.add_run(page_no)
        style_run(r_page, font_name="Times New Roman", size_pt=10.5, bold=is_h1)

    # TOC Page Break
    p_brk2 = insert_p_before()
    p_brk2.add_run().add_break(docx.enum.text.WD_BREAK.PAGE)

    # Save
    doc.save(output_path)
    print(f"   -> Successfully saved Sading Flagship V2 to {output_path}")

def build_guagui_flagship_v2(input_path, output_path):
    print("\n>>> Building Guagui Flagship V2...")
    doc = docx.Document(input_path)

    # 1. Locate Body start (P[73] or wherever "一、投标函" appears without \t)
    body_start_idx = None
    for i, p in enumerate(doc.paragraphs):
        t = p.text.strip()
        if "一、投标函" in t and "\t" not in t and "..." not in t:
            body_start_idx = i
            break
    print(f"   Body starts at P[{body_start_idx}]")

    # Purge rogue headers/footers in body
    purged_paras = 0
    paras_to_remove = []
    for i, p in enumerate(doc.paragraphs[body_start_idx:]):
        t = p.text.strip()
        if len(t) < 120 and any(k in t for k in [
            "内蒙古长城发电有限公司上海庙煤电项目中速磨煤机用过轨起重机设备采购",
            "※投标单位：河南圣起机械集团有限公司",
            "创新无限，信誉永恒！"
        ]):
            paras_to_remove.append(p)
            purged_paras += 1

    for p in paras_to_remove:
        p._p.getparent().remove(p._p)
    print(f"   -> Purged {purged_paras} rogue header/footer paragraphs in body!")

    # Remove cover & old TOC paragraphs (paragraphs before the new body)
    cover_and_toc_old = doc.paragraphs[:body_start_idx]
    for p in cover_and_toc_old:
        p._p.getparent().remove(p._p)

    # Reference paragraph is now the first paragraph of body
    ref_p = doc.paragraphs[0]._p

    def insert_p_before(text=""):
        new_p = parse_xml(r'<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')
        ref_p.getparent().insert(ref_p.getparent().index(ref_p), new_p)
        p_obj = docx.text.paragraph.Paragraph(new_p, doc)
        if text:
            p_obj.add_run(text)
        return p_obj

    # --- BUILD GUAGUI COVER ---
    p_sp1 = insert_p_before()
    set_p_formatting(p_sp1, line_spacing_pt=40)

    # Title 3 lines (SimHei 18 pt, Centered)
    p_t1 = insert_p_before("内蒙古长城发电有限公司上海庙煤电项目")
    set_p_formatting(p_t1, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing_pt=30)
    style_run(p_t1.runs[0], font_name="黑体", size_pt=18.0, bold=True)

    p_t2 = insert_p_before("中速磨煤机用过轨起重机设备采购")
    set_p_formatting(p_t2, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing_pt=30)
    style_run(p_t2.runs[0], font_name="黑体", size_pt=18.0, bold=True)

    p_t3 = insert_p_before("设备采购招标项目")
    set_p_formatting(p_t3, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing_pt=30)
    style_run(p_t3.runs[0], font_name="黑体", size_pt=18.0, bold=True)

    # Large Space
    p_sp2 = insert_p_before()
    set_p_formatting(p_sp2, line_spacing_pt=60)
    p_sp3 = insert_p_before()
    set_p_formatting(p_sp3, line_spacing_pt=60)

    # Giant Centered "投 标 文 件" (SimHei 45 pt)
    p_main = insert_p_before("投    标    文    件")
    set_p_formatting(p_main, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing_pt=50)
    style_run(p_main.runs[0], font_name="黑体", size_pt=45.0, bold=True)

    # Large Space
    p_sp4 = insert_p_before()
    set_p_formatting(p_sp4, line_spacing_pt=70)
    p_sp5 = insert_p_before()
    set_p_formatting(p_sp5, line_spacing_pt=70)

    # Form Fields
    p_f1 = insert_p_before()
    set_p_formatting(p_f1, align=WD_ALIGN_PARAGRAPH.LEFT, line_spacing_pt=28)
    p_f1.paragraph_format.left_indent = Inches(1.2)
    r = p_f1.add_run("投 标 人：")
    style_run(r, font_name="黑体", size_pt=16.0, bold=True)
    r_val = p_f1.add_run("（单位CA 签章）河南圣起机械集团有限公司")
    style_run(r_val, font_name="黑体", size_pt=15.0, underline=True)

    p_f2 = insert_p_before()
    set_p_formatting(p_f2, align=WD_ALIGN_PARAGRAPH.LEFT, line_spacing_pt=28)
    p_f2.paragraph_format.left_indent = Inches(1.2)
    r = p_f2.add_run("法定代表人（单位负责人）：")
    style_run(r, font_name="黑体", size_pt=16.0, bold=True)
    r_val = p_f2.add_run("（个人CA 签章）齐景亮")
    style_run(r_val, font_name="黑体", size_pt=15.0, underline=True)

    p_f3 = insert_p_before()
    set_p_formatting(p_f3, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing_pt=28, space_before_pt=16)
    r = p_f3.add_run("2021 年 7 月 9 日")
    style_run(r, font_name="黑体", size_pt=16.0, bold=True)

    # Cover Page Break
    p_brk1 = insert_p_before()
    p_brk1.add_run().add_break(docx.enum.text.WD_BREAK.PAGE)

    # --- BUILD GUAGUI TOC ---
    p_toc_title = insert_p_before("投标文件目录")
    set_p_formatting(p_toc_title, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing_pt=24, space_before_pt=12, space_after_pt=12)
    style_run(p_toc_title.runs[0], font_name="黑体", size_pt=16.0, bold=True)

    for title, page_no, level in GUAGUI_TOC:
        p_item = insert_p_before()
        set_p_formatting(p_item, align=WD_ALIGN_PARAGRAPH.LEFT, line_spacing_pt=17.0)
        pPr = p_item._p.get_or_add_pPr()
        tabs = parse_xml(r'''
            <w:tabs xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                <w:tab w:val="right" w:leader="dot" w:pos="8640"/>
            </w:tabs>
        ''')
        pPr.append(tabs)

        indent = Inches(0.2 * (level - 1))
        if indent > 0:
            p_item.paragraph_format.left_indent = indent

        r_title = p_item.add_run(title)
        is_h1 = (level == 1)
        style_run(r_title, font_name="宋体" if not is_h1 else "黑体", size_pt=10.5 if not is_h1 else 11.5, bold=is_h1)

        if page_no:
            r_tab = p_item.add_run("\t")
            r_page = p_item.add_run(page_no)
            style_run(r_page, font_name="Times New Roman", size_pt=10.5, bold=is_h1)

    # TOC Page Break
    p_brk2 = insert_p_before()
    p_brk2.add_run().add_break(docx.enum.text.WD_BREAK.PAGE)

    # Save
    doc.save(output_path)
    print(f"   -> Successfully saved Guagui Flagship V2 to {output_path}")

if __name__ == "__main__":
    build_sading_flagship_v2(
        r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_高保真旗舰版.docx",
        r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_终极保真版.docx"
    )
    build_guagui_flagship_v2(
        r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_高保真旗舰版.docx",
        r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_终极保真版.docx"
    )
