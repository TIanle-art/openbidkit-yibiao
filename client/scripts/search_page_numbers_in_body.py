import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

docx_path = r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_完美修复版.docx"
d = docx.Document(docx_path)

print("Searching for standalone numbers in body paragraphs:")
for i, p in enumerate(d.paragraphs[:150]):
    t = p.text.strip()
    if t.isdigit() and len(t) <= 3:
        # Check if there are section breaks or page breaks near it
        p_xml = p._p.xml
        has_sectPr = "w:sectPr" in p_xml
        has_page_break = "w:br" in p_xml and 'w:type="page"' in p_xml
        print(f"P[{i}]: text=\"{t}\", has_sectPr={has_sectPr}, has_page_break={has_page_break}")
