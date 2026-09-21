import os
import sys
import re
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn

sys.stdout.reconfigure(encoding='utf-8')

def optimize_document(docx_input_path, docx_output_path, project_type):
    print(f"\n=======================================================")
    print(f"  Starting Master Optimization: {project_type}")
    print(f"  Input:  {docx_input_path}")
    print(f"  Output: {docx_output_path}")
    print(f"=======================================================")

    doc = docx.Document(docx_input_path)

    # -------------------------------------------------------------
    # 1. Configuration per project
    # -------------------------------------------------------------
    if project_type == "sading":
        header_text = "河南省中原奥起实业有限公司投标文件"
        footer_text = ""
        logo_path = r"d:\APPs\Downloads\文件\sading_logo.png"
        logo_w_in, logo_h_in = 0.45, 0.45
        rogue_patterns = [
            r"河南省中原奥起实业有限公司投标文件"
        ]
    elif project_type == "guagui":
        header_text = "内蒙古长城发电有限公司上海庙煤电项目中速磨煤机用过轨起重机设备采购 投标文件"
        footer_text = "※投标单位：河南圣起机械集团有限公司 创新无限，信誉永恒！"
        logo_path = r"d:\APPs\Downloads\文件\shengqi_logo.png"
        logo_w_in, logo_h_in = 0.55, 0.45
        rogue_patterns = [
            r"内蒙古长城发电有限公司上海庙煤电项目中速磨煤机用过轨起重机设备采购\s*投标文件",
            r"※投标单位：河南圣起机械集团有限公司.*创新无限，信誉永恒！"
        ]

    # -------------------------------------------------------------
    # 2. Purge Rogue Headers, Footers, and Logo Images from Body
    # -------------------------------------------------------------
    print("Step 1: Purging rogue headers/footers/logos from body paragraphs...")
    paras_to_remove = []
    purged_paras_count = 0
    purged_logos_count = 0

    # Identify cover end index
    cover_limit = 10 if project_type == "sading" else 6

    for i, p in enumerate(doc.paragraphs):
        if i < cover_limit:
            continue
        text_clean = re.sub(r"\s+", "", p.text)
        is_rogue_text = False
        for pat in rogue_patterns:
            pat_clean = re.sub(r"\s+", "", pat)
            if pat_clean in text_clean:
                is_rogue_text = True
                break

        # Check if paragraph has rogue logo drawing
        has_rogue_logo = False
        for r in p.runs:
            drawings = r._r.findall('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing')
            for d in drawings:
                ext = d.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}ext')
                if ext is not None:
                    cx = int(ext.get('cx', 0))
                    cy = int(ext.get('cy', 0))
                    w_in = cx / 914400.0
                    h_in = cy / 914400.0
                    if 0.3 < w_in < 1.5 and 0.3 < h_in < 1.5:
                        has_rogue_logo = True
                        break

        if is_rogue_text or (has_rogue_logo and len(text_clean) < 80):
            paras_to_remove.append(p)
            if is_rogue_text:
                purged_paras_count += 1
            if has_rogue_logo:
                purged_logos_count += 1

    # Remove the identified paragraphs from document DOM
    for p in paras_to_remove:
        p._p.getparent().remove(p._p)

    print(f"   -> Removed {purged_paras_count} rogue text paragraphs")
    print(f"   -> Removed {purged_logos_count} rogue logo paragraphs")

    # -------------------------------------------------------------
    # 3. Setup True Native Header and Footer
    # -------------------------------------------------------------
    print("Step 2: Injecting standardized 2-column native header and footer...")
    for s_idx, sec in enumerate(doc.sections):
        # Header
        hdr = sec.header
        for hp in hdr.paragraphs:
            hp.text = ""
        for ht in hdr.tables:
            ht._tbl.getparent().remove(ht._tbl)

        htbl = hdr.add_table(rows=1, cols=2, width=Inches(6.5))
        htbl.alignment = docx.enum.table.WD_TABLE_ALIGNMENT.CENTER
        
        # Bottom border
        htblBorders = parse_xml(r'''
            <w:tblBorders xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                <w:top w:val="none"/>
                <w:left w:val="none"/>
                <w:bottom w:val="single" w:sz="6" w:space="0" w:color="999999"/>
                <w:right w:val="none"/>
                <w:insideH w:val="none"/>
                <w:insideV w:val="none"/>
            </w:tblBorders>
        ''')
        htbl._tbl.tblPr.append(htblBorders)

        # Left Cell: Text
        c_left = htbl.cell(0, 0)
        c_left.width = Inches(5.6)
        pl = c_left.paragraphs[0]
        pl.alignment = WD_ALIGN_PARAGRAPH.LEFT
        rl = pl.add_run(header_text)
        rl_rPr = rl._r.get_or_add_rPr()
        rl_rPr.append(parse_xml(r'<w:rFonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman" w:hint="eastAsia"/>'))
        rl_rPr.append(parse_xml(r'<w:sz xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="18"/>'))
        rl_rPr.append(parse_xml(r'<w:color xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="333333"/>'))

        # Right Cell: Logo
        c_right = htbl.cell(0, 1)
        c_right.width = Inches(0.9)
        pr = c_right.paragraphs[0]
        pr.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        if os.path.exists(logo_path):
            rr = pr.add_run()
            rr.add_picture(logo_path, width=Inches(logo_w_in), height=Inches(logo_h_in))

        # Footer
        if footer_text:
            ftr = sec.footer
            if len(ftr.paragraphs) > 0:
                fp = ftr.paragraphs[0]
                fp.text = ""
                fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
                fr = fp.add_run(footer_text)
                fr_rPr = fr._r.get_or_add_rPr()
                fr_rPr.append(parse_xml(r'<w:rFonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman" w:hint="eastAsia"/>'))
                fr_rPr.append(parse_xml(r'<w:sz xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="18"/>'))
                fr_rPr.append(parse_xml(r'<w:color xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="666666"/>'))

    # -------------------------------------------------------------
    # 4. Standardize Fonts, Disable Grid Snapping & Lock Line Spacing
    # -------------------------------------------------------------
    print("Step 3: Enforcing Chinese font mapping, disabling grid snapping & locking spacing...")
    for p in doc.paragraphs:
        pPr = p._p.get_or_add_pPr()
        
        # snapToGrid = 0
        snap = pPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}snapToGrid')
        if snap is not None:
            snap.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val', '0')
        else:
            pPr.append(parse_xml(r'<w:snapToGrid xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="0"/>'))

        # Fix spacing
        spacing = pPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}spacing')
        if spacing is None:
            pPr.append(parse_xml(r'<w:spacing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:line="360" w:lineRule="exact" w:before="0" w:after="0"/>'))
        else:
            spacing.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}lineRule', 'exact')
            if not spacing.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}line'):
                spacing.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}line', '360')

        # Check runs for fonts
        for r in p.runs:
            rPr = r._r.get_or_add_rPr()
            rFonts = rPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rFonts')
            if rFonts is None:
                rPr.append(parse_xml(r'<w:rFonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman" w:hint="eastAsia"/>'))
            else:
                if not rFonts.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}eastAsia'):
                    rFonts.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}eastAsia', '宋体')
                rFonts.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}hint', 'eastAsia')

    # -------------------------------------------------------------
    # 5. Lock Table Widths and Prevent Row Splitting
    # -------------------------------------------------------------
    print("Step 4: Locking all table grids (w:tblLayout fixed) and preventing row splitting...")
    for t in doc.tables:
        tblPr = t._tbl.tblPr
        tblLayout = tblPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}tblLayout')
        if tblLayout is None:
            tblPr.append(parse_xml(r'<w:tblLayout xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:type="fixed"/>'))
        else:
            tblLayout.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}type', 'fixed')

        for row in t.rows:
            trPr = row._tr.get_or_add_trPr()
            if trPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}cantSplit') is None:
                trPr.append(parse_xml(r'<w:cantSplit xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'))

    # Save output
    doc.save(docx_output_path)
    print(f"   -> Successfully saved: {docx_output_path}")

    # -------------------------------------------------------------
    # 6. Inject doNotCompressPictures into settings.xml
    # -------------------------------------------------------------
    print("Step 5: Injecting <w:doNotCompressPictures w:val=\"1\"/> into settings.xml...")
    import zipfile
    temp_zip = docx_output_path + ".temp.zip"
    os.rename(docx_output_path, temp_zip)
    
    with zipfile.ZipFile(temp_zip, 'r') as zin, zipfile.ZipFile(docx_output_path, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/settings.xml":
                xml_str = data.decode('utf-8')
                if "<w:doNotCompressPictures" not in xml_str:
                    xml_str = xml_str.replace("</w:settings>", '<w:doNotCompressPictures w:val="1"/></w:settings>')
                    data = xml_str.encode('utf-8')
                    print("   -> Injected w:doNotCompressPictures into word/settings.xml")
            zout.writestr(item, data)
    os.remove(temp_zip)
    print("   -> Completed image compression protection injection.")

if __name__ == "__main__":
    optimize_document(
        r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_优化版.docx",
        r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_高保真旗舰版.docx",
        "sading"
    )
    optimize_document(
        r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_优化版.docx",
        r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_高保真旗舰版.docx",
        "guagui"
    )
