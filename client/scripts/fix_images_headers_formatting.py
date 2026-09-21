import os
import sys
import zipfile
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn

sys.stdout.reconfigure(encoding='utf-8')

def repair_document(docx_input, docx_output, project_type):
    print(f"\n=======================================================")
    print(f"  Repairing: {project_type}")
    print(f"  Input:  {docx_input}")
    print(f"  Output: {docx_output}")
    print(f"=======================================================")
    
    doc = docx.Document(docx_input)
    
    # 1. Config
    if project_type == "sading":
        header_text = "河南省中原奥起实业有限公司投标文件"
        footer_text = ""
        logo_path = r"d:\APPs\Downloads\文件\sading_logo.png"
        logo_w_in, logo_h_in = 0.45, 0.45
    else:
        header_text = "内蒙古长城发电有限公司上海庙煤电项目中速磨煤机用过轨起重机设备采购 投标文件"
        footer_text = "※投标单位：河南圣起机械集团有限公司 创新无限，信誉永恒！"
        logo_path = r"d:\APPs\Downloads\文件\shengqi_logo.png"
        logo_w_in, logo_h_in = 0.55, 0.45

    # 2. Fix All Image Paragraphs (CRITICAL: lineRule must be AUTO, NOT EXACT!)
    print("Step 1: Un-clipping all images, setting lineRule='auto' and centering...")
    unclipped_count = 0
    resized_count = 0
    MAX_W_EMU = int(6.2 * 914400) # 6.2 inches in EMUs
    MAX_H_EMU = int(8.6 * 914400) # 8.6 inches in EMUs

    def process_paragraph_images(p):
        nonlocal unclipped_count, resized_count
        drawings = p._p.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing')
        if drawings:
            # Paragraph formatting for images
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            pPr = p._p.get_or_add_pPr()
            # Remove exact line spacing, set auto
            sp = pPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}spacing')
            if sp is not None:
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}lineRule', 'auto')
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}line', '240')
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}before', '60')
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}after', '60')
            else:
                pPr.append(parse_xml(r'<w:spacing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:line="240" w:lineRule="auto" w:before="60" w:after="60"/>'))

            # Check and resize oversized images
            for d in drawings:
                ext = d.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}ext')
                if ext is not None:
                    cx = int(ext.get('cx', 0))
                    cy = int(ext.get('cy', 0))
                    if cx > MAX_W_EMU or cy > MAX_H_EMU:
                        scale_w = MAX_W_EMU / cx if cx > MAX_W_EMU else 1.0
                        scale_h = MAX_H_EMU / cy if cy > MAX_H_EMU else 1.0
                        scale = min(scale_w, scale_h)
                        new_cx = int(cx * scale)
                        new_cy = int(cy * scale)
                        ext.set('cx', str(new_cx))
                        ext.set('cy', str(new_cy))
                        resized_count += 1
            unclipped_count += 1

    for p in doc.paragraphs:
        process_paragraph_images(p)

    for t in doc.tables:
        for row in t.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    process_paragraph_images(p)

    print(f"   -> Unclipped {unclipped_count} image paragraphs (lineRule changed to 'auto')")
    print(f"   -> Rescaled {resized_count} oversized images to fit within page margins")

    # 3. Setup Standardized Header in Section 0 and Link All Sections
    print("Step 2: Injecting authentic 2-column header table and linking across all sections...")
    s0 = doc.sections[0]
    s0.different_first_page_header_footer = False
    
    # Ensure section 0 top margin accommodates header
    if s0.top_margin.inches < 0.6:
        s0.top_margin = Inches(0.65)
    s0.header_distance = Inches(0.3)

    # Clear section 0 header
    hdr0 = s0.header
    for hp in hdr0.paragraphs:
        hp.text = ""
    for ht in hdr0.tables:
        ht._tbl.getparent().remove(ht._tbl)

    # Create 2-column table in section 0 header
    htbl = hdr0.add_table(rows=1, cols=2, width=Inches(6.5))
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

    # Left cell: Text
    c_left = htbl.cell(0, 0)
    c_left.width = Inches(5.6)
    pl = c_left.paragraphs[0]
    pl.alignment = WD_ALIGN_PARAGRAPH.LEFT
    rl = pl.add_run(header_text)
    rl_rPr = rl._r.get_or_add_rPr()
    rl_rPr.append(parse_xml(r'<w:rFonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman" w:hint="eastAsia"/>'))
    rl_rPr.append(parse_xml(r'<w:sz xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="18"/>'))
    rl_rPr.append(parse_xml(r'<w:color xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="333333"/>'))

    # Right cell: Logo
    c_right = htbl.cell(0, 1)
    c_right.width = Inches(0.9)
    pr = c_right.paragraphs[0]
    pr.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    if os.path.exists(logo_path):
        rr = pr.add_run()
        rr.add_picture(logo_path, width=Inches(logo_w_in), height=Inches(logo_h_in))

    # Setup Footer in Section 0
    ftr0 = s0.footer
    for fp in ftr0.paragraphs:
        fp.text = ""
    if footer_text:
        fp = ftr0.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        fr = fp.add_run(footer_text)
        fr_rPr = fr._r.get_or_add_rPr()
        fr_rPr.append(parse_xml(r'<w:rFonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman" w:hint="eastAsia"/>'))
        fr_rPr.append(parse_xml(r'<w:sz xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="18"/>'))
        fr_rPr.append(parse_xml(r'<w:color xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="666666"/>'))

    # Now Link ALL subsequent sections to Section 0
    for s_idx, sec in enumerate(doc.sections[1:], start=1):
        sec.different_first_page_header_footer = False
        if sec.top_margin.inches < 0.6:
            sec.top_margin = Inches(0.65)
        sec.header_distance = Inches(0.3)
        
        # Clear local headers/footers to link cleanly
        for hp in sec.header.paragraphs:
            hp.text = ""
        for ht in list(sec.header.tables):
            ht._tbl.getparent().remove(ht._tbl)
        sec.header.is_linked_to_previous = True

        for fp in sec.footer.paragraphs:
            fp.text = ""
        for ft in list(sec.footer.tables):
            ft._tbl.getparent().remove(ft._tbl)
        sec.footer.is_linked_to_previous = True

    print(f"   -> Successfully linked header and footer across all {len(doc.sections)} sections!")

    # 4. Save and inject doNotCompressPictures
    doc.save(docx_output)
    print(f"   -> Saved: {docx_output}")

    temp_zip = docx_output + ".temp.zip"
    os.rename(docx_output, temp_zip)
    with zipfile.ZipFile(temp_zip, 'r') as zin, zipfile.ZipFile(docx_output, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/settings.xml":
                xml_str = data.decode('utf-8')
                if "<w:doNotCompressPictures" not in xml_str:
                    xml_str = xml_str.replace("</w:settings>", '<w:doNotCompressPictures w:val="1"/></w:settings>')
                    data = xml_str.encode('utf-8')
            zout.writestr(item, data)
    os.remove(temp_zip)
    print("   -> Image compression protection confirmed.")

if __name__ == "__main__":
    repair_document(
        r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_终极保真版.docx",
        r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_完美修复版.docx",
        "sading"
    )
    repair_document(
        r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_终极保真版.docx",
        r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_完美修复版.docx",
        "guagui"
    )
