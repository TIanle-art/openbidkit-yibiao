import pymupdf
import sys
sys.stdout.reconfigure(encoding='utf-8')

pdf = pymupdf.open(r"d:\APPs\Downloads\文件\圣起过轨吊投标文件.pdf")
for p in [201, 202, 203, 204, 205, 206]:
    page = pdf[p-1]
    print(f"Guagui Page {p}: w={page.rect.width:.1f} pt ({page.rect.width/72:.2f} in), h={page.rect.height:.1f} pt ({page.rect.height/72:.2f} in), orientation={'Landscape' if page.rect.width > page.rect.height else 'Portrait'}")
sys.exit(0)





def clean_and_perfect_sading(docx_input, docx_output):
    print(f"Loading Sading: {docx_input}")
    doc = docx.Document(docx_input)
    
    # 1. Purge standalone page number paragraphs from body
    purged_page_nums = 0
    paras_to_remove = []
    for i, p in enumerate(doc.paragraphs):
        t = p.text.strip()
        if t.isdigit() and len(t) <= 3:
            # Check if it has drawings or sectPr
            has_dw = bool(p._p.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing'))
            has_sect = bool(p._p.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sectPr'))
            if not has_dw and not has_sect:
                paras_to_remove.append(p)
                purged_page_nums += 1

    for p in paras_to_remove:
        p._p.getparent().remove(p._p)
    print(f"   -> Purged {purged_page_nums} rogue page number paragraphs!")

    # 2. Rescale images to max 6.2 in width and 7.4 in height
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
    print(f"   -> Rescaled {rescaled_images} images to fit max {MAX_W}x{MAX_H} in!")

    # 3. Remove spacing from all paragraphs containing sectPr, ensure image paragraphs have lineRule="auto"
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

    print(f"   -> Removed exact spacing from {fixed_sect_spacing} sectPr paragraphs!")
    print(f"   -> Set auto spacing on {fixed_img_spacing} image paragraphs!")

    doc.save(docx_output)
    print(f"   -> Saved cleaned Sading to {docx_output}")

def clean_and_perfect_guagui(docx_input, docx_output):
    print(f"\nLoading Guagui: {docx_input}")
    doc = docx.Document(docx_input)

    # 1. Rescale images to max 6.2 in width and 7.4 in height
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
    print(f"   -> Rescaled {rescaled_images} images to fit max {MAX_W}x{MAX_H} in!")

    # 2. CRITICAL FIX: Remove spacing from all paragraphs containing sectPr!
    # And ensure all image paragraphs have lineRule="auto"
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

    print(f"   -> Removed exact spacing from {fixed_sect_spacing} sectPr paragraphs in Guagui!")
    print(f"   -> Set auto spacing on {fixed_img_spacing} image paragraphs in Guagui!")

    doc.save(docx_output)
    print(f"   -> Saved cleaned Guagui to {docx_output}")

if __name__ == "__main__":
    clean_and_perfect_guagui(
        r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_完美修复版.docx",
        r"d:\APPs\Downloads\文件\已生成标书成果\test_guagui_purged.docx"
    )





