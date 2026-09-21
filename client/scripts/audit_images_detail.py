import docx
import pymupdf
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

def audit_images(pdf_path, docx_path, name):
    print(f"\n=======================================================")
    print(f"  Image Audit: {name}")
    print(f"  PDF:  {pdf_path}")
    print(f"  DOCX: {docx_path}")
    print(f"=======================================================")
    
    pdf = pymupdf.open(pdf_path)
    doc = docx.Document(docx_path)
    
    # 1. Extract PDF images summary
    pdf_img_count = 0
    pdf_large_imgs = 0
    for p_no in range(len(pdf)):
        page = pdf[p_no]
        imgs = page.get_images()
        pdf_img_count += len(imgs)
        for img in imgs:
            xref = img[0]
            base_img = pdf.extract_image(xref)
            w, h = base_img['width'], base_img['height']
            if w > 500 or h > 500:
                pdf_large_imgs += 1
                
    print(f"1. 原版 PDF 图片要素:")
    print(f"   - PDF 总图片对象引用数: {pdf_img_count}")
    print(f"   - PDF 高分辨率大图 (扫描件/证照/图纸): {pdf_large_imgs}")
    
    # 2. Extract DOCX shapes summary
    print(f"\n2. DOCX 图片尺寸与比例采样 (前 20 张):")
    for i, s in enumerate(list(doc.inline_shapes)[:20]):
        w_in = s.width.inches
        h_in = s.height.inches
        ratio = round(w_in / h_in, 3) if h_in > 0 else 0
        print(f"   Shape [{i+1}]: {round(w_in,2)} in x {round(h_in,2)} in (宽高比: {ratio})")

audit_images(r"d:/APPs/Downloads/文件/赛鼎 技术文件0818(1).pdf", 
             r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_终极保真版.docx", 
             "赛鼎项目")

audit_images(r"d:/APPs/Downloads/文件/圣起过轨吊投标文件.pdf", 
             r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_终极保真版.docx", 
             "磨煤机项目")
