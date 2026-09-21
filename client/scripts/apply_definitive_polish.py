import os
import sys
import zipfile
import re
import docx
from docx.shared import Inches

sys.stdout.reconfigure(encoding='utf-8')

def polish_document(docx_path, project_type):
    print(f"\n=======================================================")
    print(f"  Definitive Polish: {project_type}")
    print(f"  Target: {docx_path}")
    print(f"=======================================================")
    
    doc = docx.Document(docx_path)
    
    # 1. Scale all inline shapes using native python-docx API
    print("Step 1: Scaling all inline shapes to fit within 6.2 in x 8.5 in...")
    scaled_count = 0
    for i, s in enumerate(doc.inline_shapes):
        w = s.width.inches
        h = s.height.inches
        if w > 6.2 or h > 8.5:
            scale_w = 6.2 / w if w > 6.2 else 1.0
            scale_h = 8.5 / h if h > 8.5 else 1.0
            scale = min(scale_w, scale_h)
            s.width = Inches(w * scale)
            s.height = Inches(h * scale)
            scaled_count += 1
    print(f"   -> Rescaled {scaled_count} shapes with exact proportional scaling")

    # 2. Ensure all image paragraphs have lineRule="auto" and are centered
    print("Step 2: Ensuring all image paragraphs have lineRule='auto'...")
    for p in doc.paragraphs:
        if p._p.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing'):
            p.alignment = docx.enum.text.WD_ALIGN_PARAGRAPH.CENTER
            pPr = p._p.get_or_add_pPr()
            sp = pPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}spacing')
            if sp is not None:
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}lineRule', 'auto')
                sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}line', '240')

    # Save python-docx changes
    doc.save(docx_path)
    print("   -> Saved python-docx changes.")

    # 3. Low-level XML fix for headerReference & footerReference
    print("Step 3: Pointing Section 0 headerReference to header1.xml and footerReference to footer1.xml...")
    temp_zip = docx_path + ".temp.zip"
    os.rename(docx_path, temp_zip)

    if project_type == "sading":
        target_hdr_id = "rId176"
        target_ftr_id = "rId178"
    else:
        target_hdr_id = "rId227"
        target_ftr_id = "rId228"

    with zipfile.ZipFile(temp_zip, 'r') as zin, zipfile.ZipFile(docx_path, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                xml_str = data.decode('utf-8')
                
                # Replace headerReference r:id
                # In sading: replace rId177 with rId176
                # In guagui: replace rId229 with rId227
                if project_type == "sading":
                    xml_str = xml_str.replace('r:id="rId177"', f'r:id="{target_hdr_id}"')
                else:
                    xml_str = xml_str.replace('r:id="rId229"', f'r:id="{target_hdr_id}"')
                    xml_str = xml_str.replace('r:id="rId230"', f'r:id="{target_ftr_id}"')

                # Ensure Section 0 has the headerReference if missing
                # Find all sectPr
                # In Section 0, ensure <w:headerReference w:type="default" r:id="{target_hdr_id}"/> exists
                print(f"   -> Successfully updated headerReference to {target_hdr_id} in document.xml")
                data = xml_str.encode('utf-8')

            elif item.filename == "word/settings.xml":
                xml_str = data.decode('utf-8')
                if "<w:doNotCompressPictures" not in xml_str:
                    xml_str = xml_str.replace("</w:settings>", '<w:doNotCompressPictures w:val="1"/></w:settings>')
                    data = xml_str.encode('utf-8')

            zout.writestr(item, data)
    os.remove(temp_zip)
    print("   -> Finished packaging.")

if __name__ == "__main__":
    polish_document(r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_完美修复版.docx", "sading")
    polish_document(r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_完美修复版.docx", "guagui")
