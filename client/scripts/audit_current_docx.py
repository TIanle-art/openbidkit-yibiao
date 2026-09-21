import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

def audit_docx_cover(docx_path, name):
    doc = docx.Document(docx_path)
    print(f"=== {name} DOCX Cover & Head Elements ===")
    print(f"Sections count: {len(doc.sections)}")
    s0 = doc.sections[0]
    print(f"Section 0 different_first_page_header_footer: {s0.different_first_page_header_footer}")
    print(f"Section 0 Header paragraphs: {[p.text for p in s0.header.paragraphs if p.text.strip()]}")
    print(f"Section 0 Header tables: {len(s0.header.tables)}")
    if len(s0.header.tables) > 0:
        tbl = s0.header.tables[0]
        cells_text = [cell.text.strip() for row in tbl.rows for cell in row.cells]
        print(f"Section 0 Header table cells: {cells_text}")
    print(f"Section 0 Footer paragraphs: {[p.text for p in s0.footer.paragraphs if p.text.strip()]}")
    
    print("\nFirst 20 Body Paragraphs:")
    for i, p in enumerate(doc.paragraphs[:25]):
        txt = p.text.strip()
        runs_info = []
        for r in p.runs:
            if r.text.strip():
                col = r.font.color.rgb if r.font.color else "default"
                sz = r.font.size.pt if r.font.size else "default"
                fn = r.font.name if r.font.name else "default"
                u = r.underline
                runs_info.append(f"'{r.text}'(font={fn}, sz={sz}, col={col}, u={u})")
        if txt:
            print(f"P[{i}]: {' '.join(runs_info)}")

print("--- Checking 01-赛鼎起重机_原版复刻_优化版.docx ---")
audit_docx_cover(r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_优化版.docx", "赛鼎优化版")
print("\n--- Checking 02-磨煤机过轨吊_原版复刻_优化版.docx ---")
audit_docx_cover(r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_优化版.docx", "磨煤机优化版")
