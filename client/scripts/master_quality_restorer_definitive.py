import os
import sys
import zipfile
import re
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import parse_xml

sys.stdout.reconfigure(encoding='utf-8')

import io

def master_restore_sading(docx_input, docx_output):
    print(f"\n=======================================================")
    print(f"  MASTER RESTORATION: Sading Overhead Crane")
    print(f"  Input:  {docx_input}")
    print(f"  Output: {docx_output}")
    print(f"=======================================================")

    with open(docx_input, 'rb') as f:
        stream = io.BytesIO(f.read())
    doc = docx.Document(stream)


    # 1. Purge standalone page number paragraphs in body
    purged_page_nums = 0
    paras_to_remove = []
    for p in doc.paragraphs:
        t = p.text.strip()
        if t.isdigit() and len(t) <= 3:
            has_dw = bool(p._p.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing'))
            has_sect = bool(p._p.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sectPr'))
            if not has_dw and not has_sect:
                paras_to_remove.append(p)
                purged_page_nums += 1

    for p in paras_to_remove:
        p._p.getparent().remove(p._p)
    print(f"   [1/6] Purged {purged_page_nums} rogue page number paragraphs from body")

    # 2. Rescale images to max 6.2 in width and 7.4 in height (5,328,000 EMUs)
    rescaled_images = 0
    MAX_W = 6.2
    MAX_H = 7.4
    for s in doc.inline_shapes:
        w = s.width.inches
        h = s.height.inches
        if w > MAX_W or h > MAX_H:
            scale_w = MAX_W / w if w > MAX_W else 1.0
            scale_h = MAX_H / h if h > MAX_H else 1.0
            scale = min(scale_w, scale_h)
            s.width = Inches(w * scale)
            s.height = Inches(h * scale)
            rescaled_images += 1
    print(f"   [2/6] Rescaled {rescaled_images} images to fit max {MAX_W}x{MAX_H} in")

    # 3. Remove exact spacing from all sectPr paragraphs, set auto on image paragraphs
    fixed_sect_spacing = 0
    fixed_img_spacing = 0
    for p in doc.paragraphs:
        sect = p._p.find('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sectPr')
        dw = p._p.find('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing')
        pPr = p._p.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pPr')
        
        if sect is not None and pPr is not None:
            sp = pPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}spacing')
            if sp is not None:
                pPr.remove(sp)
                fixed_sect_spacing += 1
                
        if dw is not None and pPr is not None:
            sp = pPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}spacing')
            if sp is not None:
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}lineRule', 'auto')
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}line', '240')
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}before', '0')
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}after', '0')
                fixed_img_spacing += 1

    print(f"   [3/6] Removed spacing from {fixed_sect_spacing} sectPr paragraphs")
    print(f"   [4/6] Set auto line spacing on {fixed_img_spacing} image paragraphs")

    # 4. Merge split words and clean rogue tabs
    fixed_splits = 0
    for i in range(len(doc.paragraphs) - 1):
        p1 = doc.paragraphs[i]
        p2 = doc.paragraphs[i+1]
        t1 = p1.text.strip()
        t2 = p2.text.strip()
        if t1.endswith('成立时') and t2.startswith('间'):
            # merge
            p1.text = t1[:-3] # "地址：河南省新乡市长垣市魏庄工业区华豫大道中段路东100米"
            p2.text = "成立时间： 2014 年 7 月 9 日"
            fixed_splits += 1
        elif t1.endswith('授权\t河') and t2.startswith('南省'):
            p1.text = t1[:-1] # strip trailing '河'
            p2.text = "河南省" + t2[2:]
            fixed_splits += 1
        elif t1.endswith('（职') and t2.startswith('务'):
            p1.text = t1[:-2]
            p2.text = "（职务" + t2[1:]
            fixed_splits += 1

    print(f"   [5/6] Repaired {fixed_splits} broken split word phrases")

    # 5. Header setup: subtle hairline border, 0 cell padding
    s0 = doc.sections[0]
    s0.different_first_page_header_footer = False
    s0.top_margin = Inches(0.65)
    s0.header_distance = Inches(0.3)

    hdr0 = s0.header
    for hp in hdr0.paragraphs:
        hp.text = ""
    for ht in list(hdr0.tables):
        ht._tbl.getparent().remove(ht._tbl)

    htbl = hdr0.add_table(rows=1, cols=2, width=Inches(6.5))
    htbl.alignment = docx.enum.table.WD_TABLE_ALIGNMENT.CENTER
    htblBorders = parse_xml(r'''
        <w:tblBorders xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:top w:val="none"/>
            <w:left w:val="none"/>
            <w:bottom w:val="single" w:sz="2" w:space="0" w:color="D0D0D0"/>
            <w:right w:val="none"/>
            <w:insideH w:val="none"/>
            <w:insideV w:val="none"/>
        </w:tblBorders>
    ''')
    htbl._tbl.tblPr.append(htblBorders)

    c_left = htbl.cell(0, 0)
    c_left.width = Inches(5.6)
    pl = c_left.paragraphs[0]
    pl.alignment = WD_ALIGN_PARAGRAPH.LEFT
    rl = pl.add_run("河南省中原奥起实业有限公司投标文件")
    rl_rPr = rl._r.get_or_add_rPr()
    rl_rPr.append(parse_xml(r'<w:rFonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman" w:hint="eastAsia"/>'))
    rl_rPr.append(parse_xml(r'<w:sz xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="18"/>'))
    rl_rPr.append(parse_xml(r'<w:color xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="333333"/>'))

    c_right = htbl.cell(0, 1)
    c_right.width = Inches(0.9)
    pr = c_right.paragraphs[0]
    pr.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    logo_path = r"d:\APPs\Downloads\文件\sading_logo.png"
    if os.path.exists(logo_path):
        rr = pr.add_run()
        rr.add_picture(logo_path, width=Inches(0.45), height=Inches(0.45))

    for sec in doc.sections[1:]:
        sec.different_first_page_header_footer = False
        sec.top_margin = Inches(0.65)
        sec.header_distance = Inches(0.3)
        for hp in sec.header.paragraphs:
            hp.text = ""
        for ht in list(sec.header.tables):
            ht._tbl.getparent().remove(ht._tbl)
        sec.header.is_linked_to_previous = True

    temp_out = docx_output + ".tmp.docx"
    doc.save(temp_out)
    print(f"   [6/6] Saved intermediate python-docx changes to {temp_out}")

    # Inject XML fixes
    final_zip = docx_output + ".perfect.docx"
    with zipfile.ZipFile(temp_out, 'r') as zin, zipfile.ZipFile(final_zip, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                xml_str = data.decode('utf-8')
                xml_str = xml_str.replace('r:id="rId177"', 'r:id="rId176"')
                data = xml_str.encode('utf-8')
            elif item.filename == "word/settings.xml":
                xml_str = data.decode('utf-8')
                if "<w:doNotCompressPictures" not in xml_str:
                    xml_str = xml_str.replace("</w:settings>", '<w:doNotCompressPictures w:val="1"/></w:settings>')
                    data = xml_str.encode('utf-8')
            zout.writestr(item, data)
    
    if os.path.exists(temp_out):
        os.remove(temp_out)
    if os.path.exists(docx_output):
        os.remove(docx_output)
    os.rename(final_zip, docx_output)
    print(f"   -> Fully perfected Sading master file written to {docx_output}!")



def master_restore_guagui(docx_input, docx_output):
    print(f"\n=======================================================")
    print(f"  MASTER RESTORATION: Guagui Crane")
    print(f"  Input:  {docx_input}")
    print(f"  Output: {docx_output}")
    print(f"=======================================================")

    with open(docx_input, 'rb') as f:
        stream = io.BytesIO(f.read())
    doc = docx.Document(stream)


    # 1. Rescale images to max 6.2 in width and 7.4 in height (5,328,000 EMUs)
    rescaled_images = 0
    MAX_W = 6.2
    MAX_H = 7.4
    for s in doc.inline_shapes:
        w = s.width.inches
        h = s.height.inches
        if w > MAX_W or h > MAX_H:
            scale_w = MAX_W / w if w > MAX_W else 1.0
            scale_h = MAX_H / h if h > MAX_H else 1.0
            scale = min(scale_w, scale_h)
            s.width = Inches(w * scale)
            s.height = Inches(h * scale)
            rescaled_images += 1
    print(f"   [1/5] Rescaled {rescaled_images} images to fit max {MAX_W}x{MAX_H} in")

    # 2. CRITICAL FIX: Remove spacing from all paragraphs containing sectPr
    fixed_sect_spacing = 0
    fixed_img_spacing = 0
    for p in doc.paragraphs:
        sect = p._p.find('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sectPr')
        dw = p._p.find('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing')
        pPr = p._p.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pPr')
        
        if sect is not None and pPr is not None:
            sp = pPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}spacing')
            if sp is not None:
                pPr.remove(sp)
                fixed_sect_spacing += 1
                
        if dw is not None and pPr is not None:
            sp = pPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}spacing')
            if sp is not None:
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}lineRule', 'auto')
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}line', '240')
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}before', '0')
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}after', '0')
                fixed_img_spacing += 1

    print(f"   [2/5] Removed spacing from {fixed_sect_spacing} sectPr paragraphs in Guagui")
    print(f"   [3/5] Set auto line spacing on {fixed_img_spacing} image paragraphs in Guagui")

    # 3. Clean rogue multi-tabs
    cleaned_tabs = 0
    for p in doc.paragraphs:
        if "\t\t" in p.text:
            p.text = re.sub(r'\t{2,}', '\t', p.text)
            cleaned_tabs += 1
    print(f"   [4/5] Cleaned excessive tabs in {cleaned_tabs} paragraphs")

    # 4. Header & Footer setup: subtle hairline border, 0 cell padding
    s0 = doc.sections[0]
    s0.different_first_page_header_footer = False
    s0.top_margin = Inches(0.65)
    s0.header_distance = Inches(0.3)

    hdr0 = s0.header
    for hp in hdr0.paragraphs:
        hp.text = ""
    for ht in list(hdr0.tables):
        ht._tbl.getparent().remove(ht._tbl)

    htbl = hdr0.add_table(rows=1, cols=2, width=Inches(6.5))
    htbl.alignment = docx.enum.table.WD_TABLE_ALIGNMENT.CENTER
    htblBorders = parse_xml(r'''
        <w:tblBorders xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:top w:val="none"/>
            <w:left w:val="none"/>
            <w:bottom w:val="single" w:sz="2" w:space="0" w:color="D0D0D0"/>
            <w:right w:val="none"/>
            <w:insideH w:val="none"/>
            <w:insideV w:val="none"/>
        </w:tblBorders>
    ''')
    htbl._tbl.tblPr.append(htblBorders)

    c_left = htbl.cell(0, 0)
    c_left.width = Inches(5.6)
    pl = c_left.paragraphs[0]
    pl.alignment = WD_ALIGN_PARAGRAPH.LEFT
    rl = pl.add_run("内蒙古长城发电有限公司上海庙煤电项目中速磨煤机用过轨起重机设备采购 投标文件")
    rl_rPr = rl._r.get_or_add_rPr()
    rl_rPr.append(parse_xml(r'<w:rFonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman" w:hint="eastAsia"/>'))
    rl_rPr.append(parse_xml(r'<w:sz xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="18"/>'))
    rl_rPr.append(parse_xml(r'<w:color xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="333333"/>'))

    c_right = htbl.cell(0, 1)
    c_right.width = Inches(0.9)
    pr = c_right.paragraphs[0]
    pr.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    logo_path = r"d:\APPs\Downloads\文件\shengqi_logo.png"
    if os.path.exists(logo_path):
        rr = pr.add_run()
        rr.add_picture(logo_path, width=Inches(0.55), height=Inches(0.45))

    # Footer
    ftr0 = s0.footer
    for fp in ftr0.paragraphs:
        fp.text = ""
    fp = ftr0.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fr = fp.add_run("※投标单位：河南圣起机械集团有限公司 创新无限，信誉永恒！")
    fr_rPr = fr._r.get_or_add_rPr()
    fr_rPr.append(parse_xml(r'<w:rFonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman" w:hint="eastAsia"/>'))
    fr_rPr.append(parse_xml(r'<w:sz xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="18"/>'))
    fr_rPr.append(parse_xml(r'<w:color xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="666666"/>'))

    for sec in doc.sections[1:]:
        sec.different_first_page_header_footer = False
        sec.top_margin = Inches(0.65)
        sec.header_distance = Inches(0.3)
        for hp in sec.header.paragraphs:
            hp.text = ""
        for ht in list(sec.header.tables):
            ht._tbl.getparent().remove(ht._tbl)
        sec.header.is_linked_to_previous = True

        for f_p in sec.footer.paragraphs:
            f_p.text = ""
        sec.footer.is_linked_to_previous = True

    temp_out = docx_output + ".tmp.docx"
    doc.save(temp_out)
    print(f"   [5/5] Saved intermediate python-docx changes to {temp_out}")

    # Inject XML fixes
    final_zip = docx_output + ".perfect.docx"
    with zipfile.ZipFile(temp_out, 'r') as zin, zipfile.ZipFile(final_zip, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                xml_str = data.decode('utf-8')
                xml_str = xml_str.replace('r:id="rId229"', 'r:id="rId227"')
                xml_str = xml_str.replace('r:id="rId230"', 'r:id="rId228"')
                data = xml_str.encode('utf-8')
            elif item.filename == "word/settings.xml":
                xml_str = data.decode('utf-8')
                if "<w:doNotCompressPictures" not in xml_str:
                    xml_str = xml_str.replace("</w:settings>", '<w:doNotCompressPictures w:val="1"/></w:settings>')
                    data = xml_str.encode('utf-8')
            zout.writestr(item, data)
    
    if os.path.exists(temp_out):
        os.remove(temp_out)
    if os.path.exists(docx_output):
        os.remove(docx_output)
    os.rename(final_zip, docx_output)
    print(f"   -> Fully perfected Guagui master file written to {docx_output}!")


if __name__ == "__main__":
    out_dir = r"d:\APPs\Downloads\文件\已生成标书成果"
    
    # 1. Restore Sading
    sading_target = os.path.join(out_dir, "01-赛鼎起重机_原版复刻_完美修复版.docx")
    master_restore_sading(sading_target, sading_target)
    
    # Sync 优化版
    sading_opt = os.path.join(out_dir, "01-赛鼎起重机_原版复刻_优化版.docx")
    import shutil
    shutil.copyfile(sading_target, sading_opt)
    print(f"   -> Synced to {sading_opt}")

    # 2. Restore Guagui
    guagui_target = os.path.join(out_dir, "02-磨煤机过轨吊_原版复刻_完美修复版.docx")
    master_restore_guagui(guagui_target, guagui_target)
    
    # Sync 优化版
    guagui_opt = os.path.join(out_dir, "02-磨煤机过轨吊_原版复刻_优化版.docx")
    shutil.copyfile(guagui_target, guagui_opt)
    print(f"   -> Synced to {guagui_opt}")
