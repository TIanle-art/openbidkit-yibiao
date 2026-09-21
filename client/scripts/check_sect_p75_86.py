import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

docx_path = r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_完美修复版.docx"
d = docx.Document(docx_path)

for i in range(75, 86):
    p = d.paragraphs[i]
    has_sect = "w:sectPr" in p._p.xml
    has_br = "w:br" in p._p.xml
    print(f"P[{i}]: text=\"{p.text.strip()}\", has_sectPr={has_sect}, has_br={has_br}")
