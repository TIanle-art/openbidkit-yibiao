import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

docx_path = r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_完美修复版.docx"
d = docx.Document(docx_path)

print("Inspecting standalone number paragraphs and their spacing:")
for i, p in enumerate(d.paragraphs):
    t = p.text.strip()
    if t.isdigit() and len(t) <= 3:
        sp = p._p.get_or_add_pPr().find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}spacing')
        before = sp.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}before') if sp is not None else None
        print(f"P[{i}]: num='{t}', before={before}, sectPr={'w:sectPr' in p._p.xml}")

