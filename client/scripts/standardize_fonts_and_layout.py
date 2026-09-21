import os
import sys
import docx
from docx.shared import Pt, Inches, RGBColor
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn

def standardize_document(docx_path, project_type):
    print(f"\n[STANDARDIZE] Processing {project_type}: {docx_path}")
    doc = docx.Document(docx_path)
    
    header_title = ""
    footer_text = ""
    if project_type == "sading":
        header_title = "河南省中原奥起实业有限公司投标文件"
    elif project_type == "guagui":
        header_title = "内蒙古长城发电有限公司上海庙煤电项目中速磨煤机用过轨起重机设备采购 投标文件"
        footer_text = "※投标单位：河南圣起机械集团有限公司 创新无限，信誉永恒！"

    # 1. Configure Real Section Headers & Footers
    for s_idx, sec in enumerate(doc.sections):
        # Configure Header
        if header_title and len(sec.header.paragraphs) > 0:
            hp = sec.header.paragraphs[0]
            hp.text = ""
            hr = hp.add_run(header_title)
            # Style header run: 9pt SimSun + Times New Roman
            rPr = hr._r.get_or_add_rPr()
            rFonts = parse_xml(r'<w:rFonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>')
            rPr.append(rFonts)
            sz = parse_xml(r'<w:sz xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="18"/>')
            rPr.append(sz)
            szCs = parse_xml(r'<w:szCs xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="18"/>')
            rPr.append(szCs)
            col = parse_xml(r'<w:color xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="666666"/>')
            rPr.append(col)
            # Header paragraph border bottom (standard thin dividing line)
            pPr = hp._p.get_or_add_pPr()
            pBdr = parse_xml(r'<w:pBdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr>')
            pPr.append(pBdr)

        # Configure Footer if applicable
        if footer_text and len(sec.footer.paragraphs) > 0:
            fp = sec.footer.paragraphs[0]
            fp.text = ""
            fr = fp.add_run(footer_text)
            frPr = fr._r.get_or_add_rPr()
            frFonts = parse_xml(r'<w:rFonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>')
            frPr.append(frFonts)
            fsz = parse_xml(r'<w:sz xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="18"/>')
            frPr.append(fsz)

    # 2. Traverse Paragraphs: Standardize Fonts, Sizes, and Clean Fake Header Lines
    cleaned_fake_headers = 0
    standardized_runs = 0
    
    for p in doc.paragraphs:
        t = p.text.strip()
        
        # Check if this is a duplicate body header line
        is_fake_header = False
        if header_title and (t == header_title or (header_title in t and len(t) < len(header_title) + 5)):
            is_fake_header = True
        if footer_text and (t == footer_text or (footer_text in t and len(t) < len(footer_text) + 5)):
            is_fake_header = True
            
        if is_fake_header:
            # If paragraph has sectPr, DO NOT delete, just clear runs to preserve section break!
            if p._p.find(qn('w:sectPr')) is not None:
                for r in p.runs:
                    r.text = ""
            else:
                # remove paragraph element cleanly
                p._p.getparent().remove(p._p)
            cleaned_fake_headers += 1
            continue

        # Standardize Runs in Paragraph
        for r in p.runs:
            standardized_runs += 1
            rPr = r._r.get_or_add_rPr()
            
            # 1) Fix w:rFonts: ensure eastAsia is 宋体 or 黑体, ascii is Times New Roman
            rFonts = rPr.find(qn('w:rFonts'))
            is_bold = r.bold or False
            is_heading = any(t.startswith(k) for k in ["1．", "2．", "3．", "4.", "5.", "6.", "7.", "8.", "9.", "10.", "11.", "12.", "13.", "一、", "二、", "三、", "四、", "五、", "六、", "七、", "八、", "九、", "十、", "技术响应文件", "投 标 文 件", "目 录"])
            target_chinese_font = "黑体" if (is_bold and is_heading) else "宋体"
            
            if rFonts is None:
                rFonts = parse_xml(f'<w:rFonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="{target_chinese_font}" w:cs="Times New Roman"/>')
                rPr.append(rFonts)
            else:
                rFonts.set(qn('w:ascii'), "Times New Roman")
                rFonts.set(qn('w:hAnsi'), "Times New Roman")
                rFonts.set(qn('w:eastAsia'), target_chinese_font)
                rFonts.set(qn('w:cs'), "Times New Roman")
                
            # 2) Standardize Font Sizes to Standard Chinese Typographic Scale
            # Map irregular float sizes to official pt sizes
            current_sz = 12.0
            sz_elem = rPr.find(qn('w:sz'))
            if sz_elem is not None and sz_elem.get(qn('w:val')):
                val = float(sz_elem.get(qn('w:val'))) / 2.0
                if val >= 28:
                    current_sz = 36.0 # 一号/特大
                elif val >= 20:
                    current_sz = 22.0 # 二号
                elif val >= 15:
                    current_sz = 16.0 # 三号 (章节大标题)
                elif val >= 13.5:
                    current_sz = 14.0 # 四号 (二级标题)
                elif val >= 11:
                    current_sz = 12.0 # 小四 (正文标准)
                elif val >= 9.5:
                    current_sz = 10.5 # 五号 (表格/目录)
                else:
                    current_sz = 9.0  # 小五 (注释/页眉页脚)
            elif is_heading:
                current_sz = 16.0 if is_bold else 14.0
            else:
                current_sz = 12.0 # default 小四
                
            val_half_pt = str(int(current_sz * 2))
            if sz_elem is not None:
                sz_elem.set(qn('w:val'), val_half_pt)
            else:
                rPr.append(parse_xml(f'<w:sz xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="{val_half_pt}"/>'))
                
            szCs_elem = rPr.find(qn('w:szCs'))
            if szCs_elem is not None:
                szCs_elem.set(qn('w:val'), val_half_pt)
            else:
                rPr.append(parse_xml(f'<w:szCs xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="{val_half_pt}"/>'))

            # 3) Ensure pure black font color
            col_elem = rPr.find(qn('w:color'))
            if col_elem is not None:
                col_elem.set(qn('w:val'), "000000")
            else:
                rPr.append(parse_xml(r'<w:color xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="000000"/>'))

    # 3. Standardize Tables: 10.5pt SimSun/Times New Roman, Centered/Left, Clean Borders
    for tbl in doc.tables:
        for row in tbl.rows:
            for cell in row.cells:
                for cp in cell.paragraphs:
                    for cr in cp.runs:
                        crPr = cr._r.get_or_add_rPr()
                        crFonts = crPr.find(qn('w:rFonts'))
                        if crFonts is not None:
                            crFonts.set(qn('w:eastAsia'), "宋体")
                            crFonts.set(qn('w:ascii'), "Times New Roman")
                        csz = crPr.find(qn('w:sz'))
                        if csz is not None:
                            csz.set(qn('w:val'), "21") # 10.5 pt
                        cszCs = crPr.find(qn('w:szCs'))
                        if cszCs is not None:
                            cszCs.set(qn('w:val'), "21")

    doc.save(docx_path)
    print(f"  [完成] 移除了 {cleaned_fake_headers} 行正文中的漂移假页眉/杂行")
    print(f"  [完成] 规范了 {standardized_runs} 个文字块的字体 (中文字体: 宋体/黑体, 英文字体: Times New Roman, 纯黑 000000)")
    print(f"  [完成] 字号全部按国标公文梯度对齐 (36pt/22pt/16pt/14pt/12pt/10.5pt)")
    print(f"  [完成] 文档保存成功: {docx_path}")

if __name__ == "__main__":
    targets = [
        (r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻.docx", "sading"),
        (r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_AI生成.docx", "sading"),
        (r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻.docx", "guagui"),
        (r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_AI生成.docx", "guagui")
    ]
    for path, p_type in targets:
        standardize_document(path, p_type)
